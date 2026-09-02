import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { Socket } from "node:net";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SUPPORT_API_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PROJECT_ROOT = path.resolve(SUPPORT_API_ROOT, "../..");
const TSX_CLI = path.join(PROJECT_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const CHILD_FIXTURE = path.join(
  SUPPORT_API_ROOT,
  "tests",
  "fixtures",
  "telemetry-server.ts",
);
const TEST_AGENT_KEY = "SENTINEL-INSTANA-AGENT-KEY";
const TEST_INSTANA_HOST = "acme-telemetry-wire-test";
const MAX_CAPTURE_BYTES = 1024 * 1024;

interface CapturedRequest {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

interface TestReceiver {
  readonly endpoint: string;
  readonly requests: CapturedRequest[];
  close(): Promise<void>;
}

interface ChildEvent {
  readonly event?: string;
  readonly status?: string;
  readonly port?: number;
}

interface ChildHarness {
  readonly child: ChildProcessWithoutNullStreams;
  stdout: string;
  stderr: string;
}

interface OtlpAnyValue {
  readonly stringValue?: string;
  readonly intValue?: number | string;
  readonly boolValue?: boolean;
  readonly arrayValue?: { readonly values?: readonly OtlpAnyValue[] };
}

interface OtlpAttribute {
  readonly key?: string;
  readonly value?: OtlpAnyValue;
}

interface OtlpSpan {
  readonly name?: string;
  readonly attributes?: readonly OtlpAttribute[];
  readonly status?: { readonly code?: number };
}

interface OtlpResourceSpan {
  readonly resource?: { readonly attributes?: readonly OtlpAttribute[] };
  readonly scopeSpans?: readonly {
    readonly spans?: readonly OtlpSpan[];
  }[];
}

interface OtlpPayload {
  readonly resourceSpans?: readonly OtlpResourceSpan[];
}

interface ExportedSpan {
  readonly resource: ReadonlyMap<string, unknown>;
  readonly span: OtlpSpan;
  readonly attributes: ReadonlyMap<string, unknown>;
}

const safeEnvironmentNames = [
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "ComSpec",
  "COMSPEC",
  "Path",
  "PATH",
  "PATHEXT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LOCALAPPDATA",
  "APPDATA",
  "ProgramData",
  "PROGRAMDATA",
  "ProgramFiles",
  "PROGRAMFILES",
  "ProgramFiles(x86)",
  "PROGRAMFILES(X86)",
  "USERPROFILE",
] as const;

function boundedAppend(current: string, chunk: string): string {
  const combined = `${current}${chunk}`;
  return combined.length <= MAX_CAPTURE_BYTES
    ? combined
    : combined.slice(combined.length - MAX_CAPTURE_BYTES);
}

function childEnvironment(endpoint: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of safeEnvironmentNames) {
    const value = process.env[name];
    if (value !== undefined) {
      environment[name] = value;
    }
  }

  return {
    ...environment,
    CI: "1",
    NODE_ENV: "test",
    OTEL_SDK_DISABLED: "false",
    OTEL_TRACES_SAMPLER: "always_on",
    OTEL_BSP_SCHEDULE_DELAY: "25",
    OTEL_BSP_EXPORT_TIMEOUT: "2500",
    OTEL_BSP_MAX_EXPORT_BATCH_SIZE: "64",
    OTEL_BSP_MAX_QUEUE_SIZE: "128",
    TELEMETRY_TEST_OTLP_ENDPOINT: endpoint,
  };
}

function startChild(endpoint: string): ChildHarness {
  const child = spawn(process.execPath, [TSX_CLI, CHILD_FIXTURE], {
    cwd: SUPPORT_API_ROOT,
    env: childEnvironment(endpoint),
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const harness: ChildHarness = { child, stdout: "", stderr: "" };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    harness.stdout = boundedAppend(harness.stdout, chunk);
  });
  child.stderr.on("data", (chunk: string) => {
    harness.stderr = boundedAppend(harness.stderr, chunk);
  });
  return harness;
}

function childEvents(harness: ChildHarness): readonly ChildEvent[] {
  return harness.stdout
    .split(/\r?\n/u)
    .filter((line) => line.trim().startsWith("{"))
    .flatMap((line): ChildEvent[] => {
      try {
        return [JSON.parse(line) as ChildEvent];
      } catch {
        return [];
      }
    });
}

async function waitUntil<T>(
  read: () => T | undefined,
  timeoutMs: number,
  description: string,
): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const value = read();
    if (value !== undefined) {
      return value;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function waitForEvent(
  harness: ChildHarness,
  predicate: (event: ChildEvent) => boolean,
  timeoutMs: number,
): Promise<ChildEvent> {
  return waitUntil(
    () => childEvents(harness).find(predicate),
    timeoutMs,
    "the telemetry child event",
  );
}

async function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }

  return new Promise((resolve, reject) => {
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      resolve({ code, signal });
    };
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      reject(new Error("Timed out waiting for the telemetry child to exit"));
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

async function stopChild(harness: ChildHarness): Promise<void> {
  if (harness.child.exitCode !== null || harness.child.signalCode !== null) {
    return;
  }

  harness.child.stdin.end("shutdown\n");
  try {
    await waitForExit(harness.child, 6_000);
  } catch {
    harness.child.kill();
    await waitForExit(harness.child, 3_000).catch(() => undefined);
  }
}

async function startReceiver(respond: boolean): Promise<TestReceiver> {
  const requests: CapturedRequest[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    let length = 0;
    request.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length <= MAX_CAPTURE_BYTES) {
        chunks.push(chunk);
      } else {
        request.destroy(new Error("OTLP test payload exceeded its limit"));
      }
    });
    request.on("end", () => {
      requests.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      if (respond) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      }
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The OTLP test receiver did not bind a TCP port");
  }

  return {
    endpoint: `http://127.0.0.1:${(address as AddressInfo).port}`,
    requests,
    async close() {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    },
  };
}

async function createSupportCase(port: number): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/support-cases`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-correlation-id": "ACME-LAB-OTEL",
    },
    body: JSON.stringify({
      orderId: "ACME-1042",
      priority: "high",
      description: "The order is delayed and the customer needs assistance.",
    }),
  });
}

function anyValue(value: OtlpAnyValue | undefined): unknown {
  if (value?.stringValue !== undefined) return value.stringValue;
  if (value?.intValue !== undefined) return Number(value.intValue);
  if (value?.boolValue !== undefined) return value.boolValue;
  if (value?.arrayValue !== undefined) {
    return (value.arrayValue.values ?? []).map((item) => anyValue(item));
  }
  return undefined;
}

function attributes(entries: readonly OtlpAttribute[] | undefined): ReadonlyMap<string, unknown> {
  return new Map(
    (entries ?? []).flatMap((entry): [string, unknown][] =>
      entry.key === undefined ? [] : [[entry.key, anyValue(entry.value)]],
    ),
  );
}

function exportedSpans(requests: readonly CapturedRequest[]): readonly ExportedSpan[] {
  return requests.flatMap((request) => {
    const payload = JSON.parse(request.body) as OtlpPayload;
    return (payload.resourceSpans ?? []).flatMap((resourceSpan) => {
      const resource = attributes(resourceSpan.resource?.attributes);
      return (resourceSpan.scopeSpans ?? []).flatMap((scope) =>
        (scope.spans ?? []).map((span) => ({
          resource,
          span,
          attributes: attributes(span.attributes),
        })),
      );
    });
  });
}

function assertNoDiagnosticLeak(harness: ChildHarness, endpoint: string): void {
  const output = `${harness.stdout}\n${harness.stderr}`;
  expect(output).not.toContain(TEST_AGENT_KEY);
  expect(output).not.toContain(endpoint);
}

describe("support API OTLP/HTTP wire behavior", () => {
  it(
    "exports a successful request with safe Instana headers and resources",
    { timeout: 25_000 },
    async () => {
      const receiver = await startReceiver(true);
      const harness = startChild(receiver.endpoint);
      try {
        const ready = await waitForEvent(
          harness,
          (event) => event.event === "telemetry_test_ready",
          12_000,
        );
        expect(ready.port).toEqual(expect.any(Number));

        const response = await createSupportCase(ready.port as number);
        expect(response.status).toBe(201);
        expect(await response.json()).toMatchObject({
          status: "created",
          correlationId: "ACME-LAB-OTEL",
        });

        harness.child.stdin.end("shutdown\n");
        const exit = await waitForExit(harness.child, 8_000);
        expect(exit).toEqual({ code: 0, signal: null });
        await waitUntil(
          () => (receiver.requests.length > 0 ? receiver.requests : undefined),
          2_000,
          "an OTLP request",
        );

        expect(
          childEvents(harness).some(
            (event) => event.event === "otel_trace_export" && event.status === "PASS",
          ),
        ).toBe(true);
        for (const request of receiver.requests) {
          expect(request.method).toBe("POST");
          expect(request.url).toBe("/v1/traces");
          expect(request.headers["content-type"]).toMatch(/^application\/json/u);
          expect(request.headers["x-instana-key"]).toBe(TEST_AGENT_KEY);
          expect(request.headers["x-instana-host"]).toBe(TEST_INSTANA_HOST);
          expect(request.headers.authorization).toBeUndefined();
          expect(request.body).not.toContain(TEST_AGENT_KEY);
        }

        const requestSpan = exportedSpans(receiver.requests).find(
          (item) => item.attributes.get("http.route") === "/support-cases",
        );
        expect(requestSpan).toBeDefined();
        expect(requestSpan?.span.name).toBe("POST /support-cases");
        expect(requestSpan?.attributes.get("http.response.status_code")).toBe(201);
        expect(requestSpan?.attributes.get("demo.correlation_id")).toBe("ACME-LAB-OTEL");
        expect(requestSpan?.resource.get("service.name")).toBe("acme-support-api");
        expect(requestSpan?.resource.get("deployment.environment")).toBe("local-lab");
        const forbiddenResourceNames = [...(requestSpan?.resource.keys() ?? [])].filter(
          (name) =>
            /^(?:host|os|process|user)\./u.test(name) ||
            name === "service.instance.id",
        );
        expect(forbiddenResourceNames).toEqual([]);
        assertNoDiagnosticLeak(harness, receiver.endpoint);
      } finally {
        await stopChild(harness);
        await receiver.close();
      }
    },
  );

  it(
    "keeps serving and shuts down within a bound when the receiver is unavailable",
    { timeout: 25_000 },
    async () => {
      const receiver = await startReceiver(false);
      const harness = startChild(receiver.endpoint);
      try {
        const ready = await waitForEvent(
          harness,
          (event) => event.event === "telemetry_test_ready",
          12_000,
        );
        expect(ready.port).toEqual(expect.any(Number));

        const requestStartedAt = performance.now();
        const response = await createSupportCase(ready.port as number);
        const requestDuration = performance.now() - requestStartedAt;
        expect(response.status).toBe(201);
        expect(requestDuration).toBeLessThan(1_500);

        await waitForEvent(
          harness,
          (event) => event.event === "otel_trace_export" && event.status === "FAIL",
          6_000,
        );
        expect(harness.child.exitCode).toBeNull();
        const health = await fetch(`http://127.0.0.1:${ready.port as number}/health`);
        expect(health.status).toBe(200);

        const shutdownStartedAt = performance.now();
        harness.child.stdin.end("shutdown\n");
        const exit = await waitForExit(harness.child, 6_000);
        const shutdownDuration = performance.now() - shutdownStartedAt;
        expect(exit).toEqual({ code: 0, signal: null });
        expect(shutdownDuration).toBeLessThan(4_500);
        expect(receiver.requests.length).toBeGreaterThan(0);
        expect(receiver.requests.length).toBeLessThanOrEqual(4);
        assertNoDiagnosticLeak(harness, receiver.endpoint);
      } finally {
        await stopChild(harness);
        await receiver.close();
      }
    },
  );
});
