import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { lstat, readFile } from "node:fs/promises";
import process from "node:process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import readline from "node:readline";

import { assertSecretFreeLocalEnvironment } from "./local-environment.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_PORTS = Object.freeze({
  portal: 3000,
  api: 4000,
});

export const WXO_HOST_PATTERN =
  /^api\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.dl\.watson-orchestrate\.ibm\.com$/u;

const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const PORT_PATTERN = /^\d{1,5}$/u;
const WXO_INSTANCE_PATTERN = /^\/instances\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

const INHERITED_ENV_NAMES = [
  "SystemRoot", "SYSTEMROOT", "WINDIR", "ComSpec", "COMSPEC", "Path", "PATH",
  "PATHEXT", "TEMP", "TMP", "TMPDIR", "LOCALAPPDATA", "APPDATA", "HOME",
  "USERPROFILE", "TERM", "COLORTERM",
];

const DOCUMENT_PREVIEWS = Object.freeze([
  { id: "guide", label: "Guided launcher guide", relativePath: "docs/guided-launcher.md" },
  { id: "quickstart", label: "Local quickstart", relativePath: "docs/quickstart-local.md" },
  { id: "case-study", label: "Case study", relativePath: "docs/case-study.md" },
  { id: "workshop", label: "Workshop", relativePath: "docs/workshop.md" },
  { id: "bob-shell", label: "Bob Shell CI/CD controls", relativePath: "docs/bob-shell-cicd.md" },
  { id: "screenshot", label: "Portal screenshot", relativePath: "docs/assets/acme-agentic-support.png" },
]);

const APPLICATION_PREVIEW_IDS = Object.freeze(["portal", "api-health"]);

let activeServiceGroup = null;
let activePrompter = null;
let activeWaitAbortController = null;
let activePreviewServer = null;
let shutdownRequested = false;
let shutdownPromise = null;

export class GuidedLauncherCancelledError extends Error {
  constructor() {
    super("Guided launcher cancelled.");
    this.name = "GuidedLauncherCancelledError";
  }
}

function asTrimmedString(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function validatePort(value, label = "Port") {
  const candidate = asTrimmedString(value);
  if (!PORT_PATTERN.test(candidate)) {
    return { ok: false, error: `${label} must be a number from 1 to 65535.` };
  }
  const numeric = Number(candidate);
  if (numeric < 1 || numeric > 65_535) {
    return { ok: false, error: `${label} must be a number from 1 to 65535.` };
  }
  return { ok: true, value: String(numeric) };
}

export function validatePortPair(portalPort, apiPort) {
  const portal = validatePort(portalPort, "Portal port");
  if (!portal.ok) return portal;
  const api = validatePort(apiPort, "Support API port");
  if (!api.ok) return api;
  if (portal.value === api.value) {
    return { ok: false, error: "Portal and Support API ports must differ." };
  }
  return { ok: true, value: { portal: portal.value, api: api.value } };
}

export function validateWxoEndpoint(value) {
  const candidate = asTrimmedString(value).replace(/\/+$/u, "");
  if (candidate === "") {
    return { ok: false, error: "WXO API endpoint is required for the account-backed profile." };
  }

  try {
    const url = new URL(candidate);
    const valid = url.protocol === "https:"
      && WXO_HOST_PATTERN.test(url.hostname)
      && url.port === ""
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && WXO_INSTANCE_PATTERN.test(url.pathname);
    if (!valid) {
      return {
        ok: false,
        error: "Use the official HTTPS WXO endpoint: https://api.<region>.dl.watson-orchestrate.ibm.com/instances/<instance>.",
      };
    }
    return { ok: true, value: candidate };
  } catch {
    return { ok: false, error: "WXO API endpoint must be a valid HTTPS URL." };
  }
}

export function validateAgentId(value) {
  const candidate = asTrimmedString(value);
  if (!AGENT_ID_PATTERN.test(candidate)) {
    return {
      ok: false,
      error: "WXO agent ID must start with a letter or number and contain only letters, numbers, ., _, :, or -.",
    };
  }
  return { ok: true, value: candidate };
}

export function maskSecret(value) {
  return asTrimmedString(value) === "" ? "[not provided]" : "[provided; hidden]";
}

export function profileLabel(profile) {
  return profile === "orchestrate" ? "WXO account-backed (server-side adapter)" : "Local mock (zero-secret)";
}

export function buildRuntimeEnvironments({
  profile = "stub",
  portalPort,
  apiPort,
  wxo = {},
  inherited = {},
} = {}) {
  const ports = validatePortPair(portalPort, apiPort);
  if (!ports.ok) throw new Error(ports.error);
  if (profile !== "stub" && profile !== "orchestrate") {
    throw new Error("Guided profile must be stub or orchestrate.");
  }

  const common = {
    ...Object.fromEntries(
      INHERITED_ENV_NAMES
        .filter((name) => inherited && inherited[name] !== undefined)
        .map((name) => [name, inherited[name]]),
    ),
    NODE_ENV: "development",
    NEXT_TELEMETRY_DISABLED: "1",
    DEMO_CORRELATION_ID: "ACME-LAB-GUIDED",
  };
  const api = {
    ...common,
    SUPPORT_API_HOST: "127.0.0.1",
    SUPPORT_API_PORT: ports.value.api,
    SUPPORT_API_REQUIRE_AUTH: "0",
    SUPPORT_API_TOKEN: "",
    OTEL_ENABLED: "0",
  };
  const portal = {
    ...common,
    PORT: ports.value.portal,
    SUPPORT_API_BASE_URL: `http://127.0.0.1:${ports.value.api}`,
    SUPPORT_API_TOKEN: "",
    AGENT_MODE: profile,
  };

  if (profile === "orchestrate") {
    const endpoint = validateWxoEndpoint(wxo.apiEndpoint);
    if (!endpoint.ok) throw new Error(endpoint.error);
    const agentId = validateAgentId(wxo.agentId);
    if (!agentId.ok) throw new Error(agentId.error);
    const apiKey = asTrimmedString(wxo.apiKey);
    if (apiKey === "") throw new Error("WXO API key is required for the account-backed profile.");

    portal.WXO_API_ENDPOINT = endpoint.value;
    portal.WXO_AGENT_ID = agentId.value;
    portal.WXO_API_KEY = apiKey;
  }

  return { api, portal };
}

function filePreview(root, item, previewPort) {
  const absolute = path.resolve(root, item.relativePath);
  return {
    id: item.id,
    label: item.label,
    url: previewPort === undefined
      ? pathToFileURL(absolute).href
      : `http://127.0.0.1:${previewPort}/${item.relativePath
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/")}`,
    path: absolute,
  };
}

export function buildPreviewManifest({
  root = projectRoot,
  portalPort = DEFAULT_PORTS.portal,
  apiPort = DEFAULT_PORTS.api,
  previewPort,
} = {}) {
  const ports = validatePortPair(portalPort, apiPort);
  if (!ports.ok) throw new Error(ports.error);
  if (previewPort !== undefined) {
    const preview = validatePort(previewPort, "Preview port");
    if (!preview.ok) throw new Error(preview.error);
  }
  const portal = {
    id: "portal",
    label: "Acme portal",
    url: `http://127.0.0.1:${ports.value.portal}/`,
  };
  const apiHealth = {
    id: "api-health",
    label: "Support API health",
    url: `http://127.0.0.1:${ports.value.api}/health`,
  };
  return [
    portal,
    apiHealth,
    ...DOCUMENT_PREVIEWS.map((item) => filePreview(root, item, previewPort)),
  ];
}

export function selectPreviews(manifest, selection = "all") {
  const requested = selection === "application"
    ? APPLICATION_PREVIEW_IDS
    : selection === "documentation"
      ? manifest.filter((item) => !APPLICATION_PREVIEW_IDS.includes(item.id)).map((item) => item.id)
      : selection === "all"
        ? manifest.map((item) => item.id)
        : [];
  return manifest.filter((item) => requested.includes(item.id));
}

export function summarizeSession({ profile, portalPort, apiPort, wxo = {} }) {
  const lines = [
    `Profile: ${profileLabel(profile)}`,
    `Portal: http://127.0.0.1:${portalPort}`,
    `Support API: http://127.0.0.1:${apiPort}`,
    "Telemetry: disabled by this launcher",
    "Secrets: kept in memory only; never written to a file or sent to the browser",
  ];
  if (profile === "orchestrate") {
    let host = "[invalid or not provided]";
    try {
      host = new URL(wxo.apiEndpoint).host;
    } catch {
      // The prompt validation reports the actionable error before this summary.
    }
    lines.push(`WXO endpoint host: ${host}`);
    lines.push(`WXO agent ID: ${asTrimmedString(wxo.agentId) || "[not provided]"}`);
    lines.push(`WXO API key: ${maskSecret(wxo.apiKey)}`);
    lines.push("WXO environment: operator-selected; Draft or Live is not inferred by this launcher");
    lines.push("WXO boundary: chat request only; no import, deployment, or promotion");
  }
  return lines;
}

export function redactRuntimeOutput(text, secrets = []) {
  let result = String(text);
  for (const secret of secrets) {
    const candidate = asTrimmedString(secret);
    if (candidate !== "") result = result.split(candidate).join("[REDACTED]");
  }
  return result
    .replace(/(WXO_API_KEY\s*[=:]\s*)[^\s]+/giu, "$1[REDACTED]")
    .replace(/(INSTANA_AGENT_KEY\s*[=:]\s*)[^\s]+/giu, "$1[REDACTED]");
}

function inheritedEnvironment() {
  return Object.fromEntries(
    INHERITED_ENV_NAMES
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]]),
  );
}

function npmCliPath() {
  const candidate = process.env.npm_execpath;
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)
    || path.basename(candidate).toLowerCase() !== "npm-cli.js") {
    throw new Error("Start the guided launcher through `npm run guided`.");
  }
  return candidate;
}

function spawnNpm(args, options) {
  return spawn(process.execPath, [npmCliPath(), ...args], {
    ...options,
    detached: process.platform !== "win32",
    shell: false,
    windowsHide: true,
  });
}

export function createPrefixedOutput(label, secrets, writer = (value) => process.stdout.write(value)) {
  let remainder = "";
  return {
    write(chunk) {
      const text = remainder + String(chunk);
      const lines = text.split(/\r\n|\r|\n/u);
      remainder = lines.pop() ?? "";
      for (const line of lines) writer(`[${label}] ${redactRuntimeOutput(line, secrets)}\n`);
    },
    flush() {
      if (remainder !== "") {
        writer(`[${label}] ${redactRuntimeOutput(remainder, secrets)}\n`);
        remainder = "";
      }
    },
  };
}

function attachChildOutput(child, label, secrets) {
  const standardOutput = createPrefixedOutput(label, secrets);
  const errorOutput = createPrefixedOutput(label, secrets);
  child.stdout?.on("data", (chunk) => standardOutput.write(chunk.toString("utf8")));
  child.stderr?.on("data", (chunk) => errorOutput.write(chunk.toString("utf8")));
  child.once("close", () => {
    standardOutput.flush();
    errorOutput.flush();
  });
}

function childClose(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => child.once("close", resolve));
}

export function windowsTaskkillArguments(pid, { force = false } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("Child PID must be a positive integer.");
  return ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])];
}

function terminateChildTree(child, { force = false } = {}) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  if (process.platform === "win32") {
    if (!Number.isInteger(child.pid) || child.pid <= 0) {
      try {
        return Promise.resolve(child.kill(force ? "SIGKILL" : "SIGTERM"));
      } catch {
        return Promise.resolve(false);
      }
    }
    return new Promise((resolve) => {
      const killer = spawn("taskkill.exe", windowsTaskkillArguments(child.pid, { force }), {
        detached: true,
        stdio: "ignore",
        shell: false,
        windowsHide: true,
      });
      killer.once("error", () => {
        try {
          resolve(child.kill(force ? "SIGKILL" : "SIGTERM"));
        } catch {
          resolve(false);
        }
      });
      killer.once("close", (code) => resolve(code === 0));
    });
  }
  try {
    // Non-Windows children are detached below, so the negative PID targets the
    // complete launcher-owned process group rather than an unrelated process.
    process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
    return Promise.resolve(true);
  } catch {
    try {
      return Promise.resolve(child.kill(force ? "SIGKILL" : "SIGTERM"));
    } catch {
      return Promise.resolve(false);
    }
  }
}

export function assertChildrenStopped(children) {
  const survivors = children.filter((child) => child.exitCode === null && child.signalCode === null);
  if (survivors.length > 0) {
    throw new Error("Unable to stop every launcher-owned child process.");
  }
}

async function stopChildren(children) {
  const active = children.filter((child) => child.exitCode === null && child.signalCode === null);
  await Promise.all(active.map((child) => terminateChildTree(child)));
  await Promise.race([
    Promise.all(active.map(childClose)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  const remaining = active.filter((child) => child.exitCode === null && child.signalCode === null);
  await Promise.all(remaining.map((child) => terminateChildTree(child, { force: true })));
  await Promise.race([
    Promise.all(remaining.map(childClose)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  assertChildrenStopped(remaining);
}

export class GuidedServiceGroup {
  constructor({ children, profile, portalPort, apiPort, secrets }) {
    this.children = children;
    this.profile = profile;
    this.portalPort = portalPort;
    this.apiPort = apiPort;
    this.secrets = secrets;
    this.stopping = false;
    this.unexpectedExit = null;
    this.stopPromise = null;
    const recordUnexpectedExit = (reason) => {
      if (this.stopping || this.unexpectedExit !== null) return;
      this.unexpectedExit = reason;
      void this.stop().catch(() => {
        // The foreground shutdown path reports a surviving launcher-owned process.
      });
    };
    for (const child of children) {
      child.once("error", (error) => {
        recordUnexpectedExit(error.message);
      });
      child.once("exit", (code, signal) => {
        recordUnexpectedExit(`child exited with ${signal ?? `code ${code}`}`);
      });
    }
  }

  get portalUrl() {
    return `http://127.0.0.1:${this.portalPort}`;
  }

  get apiUrl() {
    return `http://127.0.0.1:${this.apiPort}`;
  }

  get isRunning() {
    return !this.stopping
      && this.unexpectedExit === null
      && this.children.every((child) => child.exitCode === null && child.signalCode === null);
  }

  async stop() {
    if (!this.stopPromise) {
      this.stopping = true;
      this.stopPromise = stopChildren(this.children);
    }
    await this.stopPromise;
  }
}

export function startServices({
  profile = "stub",
  portalPort,
  apiPort,
  wxo = {},
  root = projectRoot,
} = {}) {
  assertSecretFreeLocalEnvironment(root);
  const environments = buildRuntimeEnvironments({
    profile,
    portalPort,
    apiPort,
    wxo,
    inherited: inheritedEnvironment(),
  });
  const secrets = profile === "orchestrate" ? [wxo.apiKey] : [];
  const children = [];

  if (profile === "stub") {
    const child = spawnNpm(["run", "dev"], {
      cwd: root,
      env: {
        ...environments.api,
        // dev-local.mjs receives these values and still owns the zero-secret profile.
        SUPPORT_API_PORT: environments.api.SUPPORT_API_PORT,
        PORTAL_PORT: environments.portal.PORT,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    attachChildOutput(child, "local", secrets);
    children.push(child);
  } else {
    const api = spawnNpm(["run", "dev", "-w", "services/support-api"], {
      cwd: root,
      env: environments.api,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const portal = spawnNpm(["run", "dev", "-w", "apps/portal"], {
      cwd: root,
      env: environments.portal,
      stdio: ["ignore", "pipe", "pipe"],
    });
    attachChildOutput(api, "api", secrets);
    attachChildOutput(portal, "portal", secrets);
    children.push(api, portal);
  }

  return new GuidedServiceGroup({
    children,
    profile,
    portalPort: environments.portal.PORT,
    apiPort: environments.api.SUPPORT_API_PORT,
    secrets,
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function assertLoopbackPortsAvailable(ports) {
  const validated = ports.map((port) => {
    const result = validatePort(port, "Service port");
    if (!result.ok) throw new Error(result.error);
    return Number(result.value);
  });
  const guards = [];
  try {
    for (const port of validated) {
      const guard = createServer();
      guards.push(guard);
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          guard.removeListener("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          guard.removeListener("error", onError);
          resolve();
        };
        guard.once("error", onError);
        guard.once("listening", onListening);
        guard.listen({ host: "127.0.0.1", port });
      });
    }
  } catch {
    throw new Error("Selected portal or Support API port is already in use.");
  } finally {
    await Promise.all(guards.map((guard) => new Promise((resolve) => {
      if (!guard.listening) {
        resolve();
        return;
      }
      guard.close(() => resolve());
    })));
  }
}

export async function waitForHttp(
  url,
  { timeoutMs = 45_000, fetchImpl = fetch, signal, continueWhile = () => true } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted || !continueWhile()) return false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1_500);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      if (response.ok && continueWhile()) return true;
    } catch {
      // The dev servers need a few seconds to compile; retry until the deadline.
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
    await delay(250);
  }
  return false;
}

const PREVIEW_CONTENT_TYPES = Object.freeze({
  ".md": "text/plain; charset=utf-8",
  ".png": "image/png",
});

function previewPathForRequest(requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, "http://127.0.0.1").pathname);
  } catch {
    return null;
  }
  const relative = pathname.replace(/^\/+|\/+$/gu, "").replaceAll("\\", "/");
  return DOCUMENT_PREVIEWS.some((item) => item.relativePath === relative) ? relative : null;
}

export class GuidedPreviewServer {
  constructor(server, root, port) {
    this.server = server;
    this.root = root;
    this.port = port;
    this.stopping = false;
  }

  get baseUrl() {
    return `http://127.0.0.1:${this.port}`;
  }

  async stop() {
    if (this.stopping) return;
    this.stopping = true;
    this.server.closeAllConnections?.();
    this.server.closeIdleConnections?.();
    await new Promise((resolve) => this.server.close(() => resolve()));
  }
}

export async function startPreviewServer(root = projectRoot) {
  const resolvedRoot = path.resolve(root);
  const allowed = new Map(DOCUMENT_PREVIEWS.map((item) => [item.relativePath, item]));
  const server = createServer(async (request, response) => {
    const relativePath = previewPathForRequest(request.url ?? "");
    if (relativePath === null) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found\n");
      return;
    }
    const absolutePath = path.resolve(resolvedRoot, relativePath);
    if (!absolutePath.startsWith(`${resolvedRoot}${path.sep}`) || !allowed.has(relativePath)) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found\n");
      return;
    }
    try {
      const metadata = await lstat(absolutePath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("preview target is not a regular file");
      const body = await readFile(absolutePath);
      const type = PREVIEW_CONTENT_TYPES[path.extname(relativePath).toLowerCase()]
        ?? "application/octet-stream";
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-length": body.byteLength,
        "content-type": type,
        "x-content-type-options": "nosniff",
      });
      if (request.method === "HEAD") response.end();
      else response.end(body);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found\n");
    }
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host: "127.0.0.1", port: 0 });
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : null;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    server.close();
    throw new Error("Preview server did not receive a valid loopback port.");
  }
  return new GuidedPreviewServer(server, resolvedRoot, port);
}

async function openUrl(url) {
  const command = process.platform === "win32"
    ? "explorer.exe"
    : process.platform === "darwin"
      ? "open"
      : "xdg-open";
  const child = spawn(command, [url], {
    detached: true,
    stdio: "ignore",
    shell: false,
    windowsHide: true,
  });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", resolve);
  });
  child.unref();
}

export async function openPreviews(manifest, selection = "all", opener = openUrl) {
  const previews = selectPreviews(manifest, selection);
  const opened = [];
  const skipped = [];
  for (const preview of previews) {
    if (preview.path) {
      try {
        const metadata = await lstat(preview.path);
        if (!metadata.isFile() || metadata.isSymbolicLink()) {
          skipped.push({ ...preview, reason: "preview target is not a regular file" });
          continue;
        }
      } catch {
        skipped.push({ ...preview, reason: "file is missing" });
        continue;
      }
    }
    try {
      await opener(preview.url);
      opened.push(preview);
    } catch (error) {
      skipped.push({ ...preview, reason: error instanceof Error ? error.message : "browser opener failed" });
    }
    await delay(120);
  }
  return { opened, skipped };
}

function createPromptSession(input = process.stdin, output = process.stdout) {
  return new PromptSession(input, output);
}

class PromptSession {
  constructor(input, output) {
    this.input = input;
    this.output = output;
    this.pendingReject = null;
    this.cancelSecret = null;
    this.rl = readline.createInterface({ input, output, terminal: true });
  }

  ask(question) {
    return new Promise((resolve, reject) => {
      this.pendingReject = reject;
      const onSigint = () => {
        this.pendingReject = null;
        this.rl.close();
        reject(new GuidedLauncherCancelledError());
      };
      this.rl.once("SIGINT", onSigint);
      this.rl.question(question, (answer) => {
        this.pendingReject = null;
        this.rl.removeListener("SIGINT", onSigint);
        resolve(answer);
      });
    });
  }

  async secret(question) {
    this.rl.close();
    this.rl = null;
    try {
      return await readMaskedSecret(this.input, this.output, question, (cancel) => {
        this.cancelSecret = cancel;
      });
    } finally {
      this.cancelSecret = null;
      this.rl = readline.createInterface({ input: this.input, output: this.output, terminal: true });
    }
  }

  close() {
    this.rl?.close();
  }

  cancel() {
    this.cancelSecret?.();
    const reject = this.pendingReject;
    this.pendingReject = null;
    this.rl?.close();
    reject?.(new GuidedLauncherCancelledError());
  }
}

function readMaskedSecret(input, output, question, registerCancel) {
  if (typeof input.setRawMode !== "function") {
    throw new Error("Secret input requires an interactive terminal.");
  }
  return new Promise((resolve, reject) => {
    let value = "";
    let escape = false;
    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (escape) {
          if (/[A-Za-z~]$/u.test(character)) escape = false;
          continue;
        }
        if (character === "\u001b") {
          escape = true;
          continue;
        }
        if (character === "\u0003") {
          cleanup();
          reject(new GuidedLauncherCancelledError());
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          output.write("\n");
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            output.write("\b \b");
          }
          continue;
        }
        if (character >= " " && character !== "\u007f") {
          value += character;
          output.write("•");
        }
      }
    };
    const cleanup = () => {
      input.removeListener("data", onData);
      input.setRawMode(false);
      input.pause();
      registerCancel?.(null);
    };
    registerCancel?.(() => {
      cleanup();
      reject(new GuidedLauncherCancelledError());
    });
    output.write(question);
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    input.on("data", onData);
  });
}

async function askValidated(prompter, question, validate, defaultValue = "") {
  while (true) {
    const suffix = defaultValue === "" ? "" : ` [${defaultValue}]`;
    const answer = asTrimmedString(await prompter.ask(`${question}${suffix}: `)) || defaultValue;
    const result = validate(answer);
    if (result.ok) return result.value;
    console.log(`  ! ${result.error}`);
  }
}

async function askChoice(prompter, title, choices) {
  console.log(`\n${title}`);
  choices.forEach(([key, label], index) => console.log(`  ${index + 1}) ${label} [${key}]`));
  while (true) {
    const answer = asTrimmedString(await prompter.ask("Wybór: "));
    const numeric = Number(answer);
    const selected = Number.isInteger(numeric) && numeric >= 1 && numeric <= choices.length
      ? choices[numeric - 1]
      : choices.find(([key]) => key === answer.toLowerCase());
    if (selected) return selected[0];
    console.log("  ! Wybierz numer z listy.");
  }
}

function printPreviewSummary(manifest, selection) {
  const selected = selectPreviews(manifest, selection);
  console.log("\nPodglądy do otwarcia:");
  for (const preview of selected) console.log(`  - ${preview.label}: ${preview.url}`);
}

async function startAndWait(config) {
  console.log(`\nUruchamiam ${profileLabel(config.profile)}...`);
  try {
    await assertLoopbackPortsAvailable([config.portalPort, config.apiPort]);
  } catch (error) {
    console.log(`! ${error instanceof Error ? error.message : "Wybrane porty są niedostępne."}`);
    return null;
  }
  const group = startServices(config);
  activeServiceGroup = group;
  const waitAbortController = new AbortController();
  activeWaitAbortController = waitAbortController;
  const [apiReady, portalReady] = await Promise.all([
    waitForHttp(`${group.apiUrl}/health`, {
      signal: waitAbortController.signal,
      continueWhile: () => group.isRunning,
    }),
    waitForHttp(`${group.portalUrl}/api/health`, {
      signal: waitAbortController.signal,
      continueWhile: () => group.isRunning,
    }),
  ]);
  if (activeWaitAbortController === waitAbortController) activeWaitAbortController = null;
  await delay(300);
  if (!apiReady || !portalReady || !group.isRunning) {
    console.log("! Usługi nie zgłosiły gotowości w ciągu 45 s. Sprawdź komunikaty powyżej.");
    await group.stop();
    if (activeServiceGroup === group) activeServiceGroup = null;
    return null;
  }
  console.log(`Gotowe: ${group.portalUrl}`);
  console.log(`Gotowe: ${group.apiUrl}`);
  return group;
}

async function reconcileServiceGroup(group) {
  if (!group || group.isRunning) return group;
  await group.stop();
  if (activeServiceGroup === group) activeServiceGroup = null;
  console.log("! Usługi launchera zatrzymały się nieoczekiwanie. Użyj opcji 5, aby uruchomić je ponownie.");
  return null;
}

async function runLoop(prompter, config, manifest, serviceGroup) {
  let group = serviceGroup;
  while (true) {
    if (shutdownRequested) break;
    group = await reconcileServiceGroup(group);
    console.log("\nMenu sesji guided jest aktywne. Terminal pozostaje otwarty:");
    console.log("  1) Otwórz portal");
    console.log("  2) Otwórz wszystkie dokumenty i podglądy");
    console.log("  3) Otwórz portal, API health i wszystkie dokumenty");
    console.log("  4) Pokaż konfigurację bez sekretów");
    console.log("  5) Uruchom ponownie usługi");
    console.log("  0) Zakończ sesję i zatrzymaj usługi");
    const choice = asTrimmedString(await prompter.ask("Wybór: "));
    if (choice === "0" || choice.toLowerCase() === "q" || choice.toLowerCase() === "exit") break;
    group = await reconcileServiceGroup(group);

    if (choice === "1") {
      if (!group) {
        console.log("! Usługi nie działają. Wybierz ponowne uruchomienie.");
        continue;
      }
      const result = await openPreviews(manifest, "application");
      reportOpened(result);
    } else if (choice === "2") {
      const result = await openPreviews(manifest, "documentation");
      reportOpened(result);
    } else if (choice === "3") {
      if (!group) {
        console.log("! Portal/API nie działa; otwieram same dokumenty.");
        const result = await openPreviews(manifest, "documentation");
        reportOpened(result);
        continue;
      }
      const result = await openPreviews(manifest, "all");
      reportOpened(result);
    } else if (choice === "4") {
      console.log(summarizeSession(config).map((line) => `  ${line}`).join("\n"));
    } else if (choice === "5") {
      if (group) await group.stop();
      if (activeServiceGroup === group) activeServiceGroup = null;
      group = await startAndWait(config);
      if (group) {
        const result = await openPreviews(manifest, "application");
        reportOpened(result);
      }
    } else {
      console.log("  ! Wybierz opcję 0–5.");
    }
  }
  if (group) await group.stop();
  if (activeServiceGroup === group) activeServiceGroup = null;
}

function reportOpened({ opened, skipped }) {
  if (opened.length > 0) console.log(`Wysłano do systemu prośbę otwarcia ${opened.length} podglądów w domyślnej przeglądarce.`);
  for (const item of skipped) console.log(`! Nie otworzono ${item.label}: ${item.reason}`);
}

function requestShutdown() {
  shutdownRequested = true;
  activeWaitAbortController?.abort();
  activePrompter?.cancel();
  const currentResources = Promise.all([
    activeServiceGroup?.stop() ?? Promise.resolve(),
    activePreviewServer?.stop() ?? Promise.resolve(),
  ]);
  shutdownPromise = shutdownPromise
    ? Promise.all([shutdownPromise, currentResources])
    : currentResources;
  return shutdownPromise;
}

async function runGuidedLauncher() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Guided launcher requires an interactive terminal. Run `npm run guided` in PowerShell, cmd, or a terminal.");
  }

  const prompter = createPromptSession();
  activePrompter = prompter;
  const onSignal = () => {
    void requestShutdown();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  let config;
  try {
    console.log("ACME guided launch");
    console.log("Ten proces pozostaje aktywny do wybrania opcji 0 albo zamknięcia terminala.");
    console.log("Domyślna ścieżka jest lokalna i bez sekretów. WXO oznacza wyłącznie server-side chat request; launcher nie rozpoznaje Draft/Live.");

    const portalPort = await askValidated(
      prompter,
      "Port portalu",
      (value) => validatePort(value, "Portal port"),
      String(DEFAULT_PORTS.portal),
    );
    let apiPort;
    while (true) {
      apiPort = await askValidated(
        prompter,
        "Port Support API",
        (value) => validatePort(value, "Support API port"),
        String(DEFAULT_PORTS.api),
      );
      const pair = validatePortPair(portalPort, apiPort);
      if (pair.ok) break;
      console.log(`  ! ${pair.error}`);
    }

    const profile = await askChoice(prompter, "Wybierz profil asystenta", [
      ["stub", "Local mock — deterministyczny, zero-secret"],
      ["orchestrate", "WXO account-backed — połączenie server-side; środowisko weryfikuje operator"],
    ]);
    const wxo = {};
    if (profile === "orchestrate") {
      wxo.apiEndpoint = await askValidated(prompter, "Podaj WXO API endpoint", validateWxoEndpoint);
      wxo.agentId = await askValidated(prompter, "Podaj WXO agent ID", validateAgentId);
      while (true) {
        wxo.apiKey = await prompter.secret("Podaj klucz WXO (wpis jest ukryty): ");
        if (asTrimmedString(wxo.apiKey) !== "") break;
        console.log("  ! Klucz nie może być pusty.");
      }
    }

    config = { profile, portalPort, apiPort, wxo };
    console.log("\nKonfiguracja sesji (bez sekretów):");
    console.log(summarizeSession(config).map((line) => `  ${line}`).join("\n"));

    const finalAction = await askChoice(prompter, "Ostatni krok — co uruchomić?", [
      ["application", "Portal + Support API w wybranym profilu"],
      ["documentation", "Tylko dokumenty i podglądy repo"],
      ["all", "Portal + API oraz wszystkie dokumenty i podglądy"],
      ["cancel", "Anuluj bez uruchamiania"],
    ]);
    if (finalAction === "cancel") return;

    const previewServer = await startPreviewServer(projectRoot);
    activePreviewServer = previewServer;
    if (shutdownRequested) throw new GuidedLauncherCancelledError();
    const manifest = buildPreviewManifest({
      root: projectRoot,
      portalPort,
      apiPort,
      previewPort: previewServer.port,
    });
    printPreviewSummary(manifest, finalAction);
    let serviceGroup = null;
    if (finalAction === "application" || finalAction === "all") {
      serviceGroup = await startAndWait(config);
      if (shutdownRequested) throw new GuidedLauncherCancelledError();
    }
    if (finalAction === "documentation" || finalAction === "all") {
      const selection = serviceGroup ? "all" : "documentation";
      const result = await openPreviews(manifest, selection);
      reportOpened(result);
    } else if (serviceGroup) {
      const result = await openPreviews(manifest, "application");
      reportOpened(result);
    }

    await runLoop(prompter, config, manifest, serviceGroup);
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    await requestShutdown();
    activePrompter = null;
    activeServiceGroup = null;
    activePreviewServer = null;
    prompter.close();
    if (config?.wxo) config.wxo.apiKey = "";
  }
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  runGuidedLauncher().catch((error) => {
    if (error instanceof GuidedLauncherCancelledError) {
      console.log("\nSesja anulowana.");
      process.exitCode = 0;
    } else {
      console.error(`Guided launcher failed: ${error instanceof Error ? error.message : "unknown error"}`);
      process.exitCode = 1;
    }
  });
}
