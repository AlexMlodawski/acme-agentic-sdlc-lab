import assert from "node:assert/strict";
import test from "node:test";

import {
  assertChildrenStopped,
  assertLoopbackPortsAvailable,
  buildPreviewManifest,
  buildRuntimeEnvironments,
  createGuidedCorrelationId,
  createPrefixedOutput,
  INSTANA_BLUE_OTLP_HTTP_ENDPOINT,
  maskSecret,
  openPreviews,
  redactRuntimeOutput,
  selectPreviews,
  startPreviewServer,
  summarizeSession,
  usesSplitServiceProcesses,
  validateAgentId,
  validateInstanaAgentKey,
  validateInstanaLogicalHost,
  validatePort,
  validatePortPair,
  validateWxoEndpoint,
  waitForHttp,
  windowsTaskkillArguments,
} from "./guided-launcher.mjs";

test("port validation accepts defaults and rejects collisions or invalid values", () => {
  assert.deepEqual(validatePort(3000, "Portal port"), { ok: true, value: "3000" });
  assert.deepEqual(validatePort("65535", "API port"), { ok: true, value: "65535" });
  assert.equal(validatePort("0", "Portal port").ok, false);
  assert.equal(validatePort("not-a-port", "Portal port").ok, false);
  assert.deepEqual(validatePortPair(3000, 4000), {
    ok: true,
    value: { portal: "3000", api: "4000" },
  });
  assert.equal(validatePortPair(3000, 3000).ok, false);
});

test("WXO endpoint and agent validation stays inside the supported account-backed boundary", () => {
  const valid = validateWxoEndpoint(
    "https://api.us-south.dl.watson-orchestrate.ibm.com/instances/demo",
  );
  assert.deepEqual(valid, {
    ok: true,
    value: "https://api.us-south.dl.watson-orchestrate.ibm.com/instances/demo",
  });
  assert.equal(
    validateWxoEndpoint("http://api.us-south.dl.watson-orchestrate.ibm.com/instances/demo").ok,
    false,
  );
  assert.equal(
    validateWxoEndpoint("https://api.us-south.dl.watson-orchestrate.ibm.com/instances/demo?x=1").ok,
    false,
  );
  assert.equal(validateAgentId("store-support-agent").ok, true);
  assert.equal(validateAgentId("bad agent id").ok, false);
});

test("Instana guided values are bounded and correlation identifiers are synthetic", () => {
  assert.deepEqual(validateInstanaLogicalHost("acme-guided-lab"), {
    ok: true,
    value: "acme-guided-lab",
  });
  for (const value of ["", "bad host", "_private", "x".repeat(129)]) {
    assert.equal(validateInstanaLogicalHost(value).ok, false);
  }

  assert.deepEqual(validateInstanaAgentKey("synthetic-agent-key"), {
    ok: true,
    value: "synthetic-agent-key",
  });
  for (const value of ["", "bad\nkey", "key\n", "\tkey", "x".repeat(4_097)]) {
    assert.equal(validateInstanaAgentKey(value).ok, false);
  }

  const first = createGuidedCorrelationId();
  const second = createGuidedCorrelationId();
  assert.match(first, /^ACME-GUIDED-[0-9a-f-]{36}$/u);
  assert.notEqual(first, second);
});

test("runtime environments keep credentials server-side and never inherit arbitrary names", () => {
  const environments = buildRuntimeEnvironments({
    profile: "orchestrate",
    portalPort: 3000,
    apiPort: 4000,
    wxo: {
      apiEndpoint: "https://api.us-south.dl.watson-orchestrate.ibm.com/instances/demo",
      agentId: "store-support-agent",
      apiKey: "synthetic-guided-key",
    },
    instana: {
      enabled: true,
      agentKey: "synthetic-instana-key",
      logicalHost: "acme-guided-lab",
      correlationId: "ACME-GUIDED-00000000-0000-4000-8000-000000000000",
    },
    inherited: {
      PATH: "synthetic-path",
      WXO_API_KEY: "synthetic-inherited-value",
      BOB_API_KEY: "synthetic-inherited-value",
      INSTANA_AGENT_KEY: "synthetic-inherited-instana-value",
      INSTANA_OTLP_HTTP_ENDPOINT: "https://attacker.invalid",
      COMPUTERNAME: "private-host",
    },
  });

  assert.equal(environments.portal.WXO_API_KEY, "synthetic-guided-key");
  assert.equal(environments.api.WXO_API_KEY, undefined);
  assert.equal(environments.portal.BOB_API_KEY, undefined);
  assert.equal(environments.api.BOB_API_KEY, undefined);
  assert.equal(environments.portal.SUPPORT_API_TOKEN, "");
  assert.equal(environments.api.OTEL_ENABLED, "1");
  assert.equal(environments.api.INSTANA_AGENT_KEY, "synthetic-instana-key");
  assert.equal(environments.portal.INSTANA_AGENT_KEY, undefined);
  assert.equal(environments.api.INSTANA_OTLP_HTTP_ENDPOINT, INSTANA_BLUE_OTLP_HTTP_ENDPOINT);
  assert.equal(environments.api.INSTANA_OTLP_HOST, "acme-guided-lab");
  assert.equal(environments.api.DEMO_CORRELATION_ID, environments.portal.DEMO_CORRELATION_ID);
  assert.equal(
    environments.portal.NEXT_PUBLIC_DEMO_CORRELATION_ID,
    environments.api.DEMO_CORRELATION_ID,
  );
  assert.equal(environments.api.COMPUTERNAME, undefined);

  const mock = buildRuntimeEnvironments({ profile: "stub", portalPort: 3000, apiPort: 4000 });
  assert.equal(mock.portal.AGENT_MODE, "stub");
  assert.equal(mock.portal.WXO_API_KEY, undefined);
  assert.equal(mock.api.OTEL_ENABLED, "0");
  assert.equal(mock.api.DEMO_CORRELATION_ID, "ACME-LAB-GUIDED");
  assert.equal(usesSplitServiceProcesses("stub", {}), false);
  assert.equal(usesSplitServiceProcesses("stub", { enabled: true }), true);
  assert.equal(usesSplitServiceProcesses("orchestrate", {}), true);

  assert.throws(
    () => buildRuntimeEnvironments({
      profile: "stub",
      portalPort: 3000,
      apiPort: 4000,
      instana: { enabled: false, agentKey: "unexpected" },
    }),
    /disabled/u,
  );
});

test("preview manifest separates application URLs from repository documents", () => {
  const manifest = buildPreviewManifest({ root: "C:\\synthetic\\acme", portalPort: 3001, apiPort: 4001 });
  assert.deepEqual(manifest.slice(0, 2).map((item) => item.id), ["portal", "api-health"]);
  assert.equal(manifest.some((item) => item.id === "guide" && item.url.startsWith("file:")), true);
  assert.deepEqual(
    manifest
      .filter((item) => ["bob-plan", "bob-build", "wxo-import", "portal-connect", "release-review"].includes(item.id))
      .map((item) => item.id),
    ["bob-plan", "bob-build", "wxo-import", "portal-connect", "release-review"],
  );
  assert.deepEqual(selectPreviews(manifest, "application").map((item) => item.id), ["portal", "api-health"]);
  assert.equal(selectPreviews(manifest, "documentation").every((item) => item.id !== "portal"), true);
  assert.equal(selectPreviews(manifest, "all").length, manifest.length);
});

test("session summaries and child output are safe to show in the terminal", () => {
  const summary = summarizeSession({
    profile: "orchestrate",
    portalPort: "3000",
    apiPort: "4000",
    wxo: {
      apiEndpoint: "https://api.us-south.dl.watson-orchestrate.ibm.com/instances/demo",
      agentId: "store-support-agent",
      apiKey: "synthetic-guided-key",
    },
    instana: {
      enabled: true,
      agentKey: "synthetic-instana-key",
      logicalHost: "acme-guided-lab",
      correlationId: "ACME-GUIDED-00000000-0000-4000-8000-000000000000",
    },
  }).join("\n");
  assert.match(summary, /WXO API key: \[provided; hidden\]/u);
  assert.match(summary, /Instana Agent Key: \[provided; hidden\]/u);
  assert.match(summary, /Instana blue SaaS OTLP\/HTTP enabled/u);
  assert.match(summary, /Profile: WXO account-backed/u);
  assert.doesNotMatch(summary, /synthetic-guided-key/u);
  assert.doesNotMatch(summary, /synthetic-instana-key/u);
  assert.equal(maskSecret(""), "[not provided]");
  assert.equal(maskSecret("synthetic-guided-key"), "[provided; hidden]");

  const output = redactRuntimeOutput(
    "WXO_API_KEY=synthetic-guided-key\nresponse=synthetic-guided-key\nx-instana-key: synthetic-instana-key",
    ["synthetic-guided-key", "synthetic-instana-key"],
  );
  assert.doesNotMatch(output, /synthetic-guided-key/u);
  assert.doesNotMatch(output, /synthetic-instana-key/u);
  assert.match(output, /\[REDACTED\]/u);

  const localInstanaSummary = summarizeSession({
    profile: "stub",
    portalPort: 3000,
    apiPort: 4000,
    instana: {
      enabled: true,
      agentKey: "synthetic-instana-key",
      logicalHost: "acme-guided-lab",
      correlationId: "ACME-GUIDED-00000000-0000-4000-8000-000000000000",
    },
  }).join("\n");
  assert.match(localInstanaSummary, /Profile: Local mock \(Instana telemetry enabled\)/u);
  assert.doesNotMatch(localInstanaSummary, /zero-secret/u);

  const writes = [];
  const buffered = createPrefixedOutput(
    "portal",
    ["synthetic-guided-key"],
    (value) => writes.push(value),
  );
  buffered.write("WXO_API_KEY=synthetic-guided-");
  buffered.write("key\nresponse=synthetic-");
  buffered.write("guided-key");
  buffered.flush();
  const joined = writes.join("");
  assert.doesNotMatch(joined, /synthetic-guided-key/u);
  assert.equal(joined.match(/\[REDACTED\]/gu)?.length, 2);

  const interleavedWrites = [];
  const stdout = createPrefixedOutput(
    "portal",
    ["synthetic-guided-key"],
    (value) => interleavedWrites.push(value),
  );
  const stderr = createPrefixedOutput(
    "portal",
    ["synthetic-guided-key"],
    (value) => interleavedWrites.push(value),
  );
  stdout.write("synthetic-guided-");
  stderr.write("independent warning\n");
  stdout.write("key\n");
  stdout.flush();
  stderr.flush();
  const interleaved = interleavedWrites.join("");
  assert.doesNotMatch(interleaved, /synthetic-guided-key|synthetic-guided-/u);
  assert.match(interleaved, /\[REDACTED\]/u);
});

test("readiness stops when the owned process is unavailable", async () => {
  let requests = 0;
  const ready = await waitForHttp("http://127.0.0.1:1/health", {
    timeoutMs: 100,
    continueWhile: () => false,
    fetchImpl: async () => {
      requests += 1;
      return { ok: true };
    },
  });
  assert.equal(ready, false);
  assert.equal(requests, 0);
});

test("Windows process-tree shutdown reserves force for the bounded fallback", () => {
  assert.deepEqual(windowsTaskkillArguments(1234), ["/PID", "1234", "/T"]);
  assert.deepEqual(
    windowsTaskkillArguments(1234, { force: true }),
    ["/PID", "1234", "/T", "/F"],
  );
  assert.throws(() => windowsTaskkillArguments(0), /positive integer/u);
  assert.doesNotThrow(() => assertChildrenStopped([{ exitCode: 0, signalCode: null }]));
  assert.throws(
    () => assertChildrenStopped([{ exitCode: null, signalCode: null }]),
    /Unable to stop every launcher-owned child process/u,
  );
});

test("openPreviews reports successful and missing previews without writing files", async () => {
  const manifest = [
    { id: "portal", label: "Portal", url: "http://127.0.0.1:3000/" },
    { id: "guide", label: "Guide", url: "file:///missing-guide.md", path: "C:\\missing-guide.md" },
  ];
  const openedUrls = [];
  const result = await openPreviews(manifest, "all", async (url) => openedUrls.push(url));
  assert.deepEqual(openedUrls, ["http://127.0.0.1:3000/"]);
  assert.deepEqual(result.opened.map((item) => item.id), ["portal"]);
  assert.deepEqual(result.skipped.map((item) => item.id), ["guide"]);
});

test("preview server exposes only the checked-in preview allowlist on loopback", async (context) => {
  const server = await startPreviewServer(process.cwd());
  context.after(() => server.stop());

  const guide = await fetch(`${server.baseUrl}/docs/guided-launcher.md`);
  assert.equal(guide.status, 200);
  assert.match(guide.headers.get("content-type") ?? "", /text\/plain/u);
  assert.match(await guide.text(), /Guided launcher/u);

  const traversal = await fetch(`${server.baseUrl}/package.json`);
  assert.equal(traversal.status, 404);

  await assert.rejects(
    assertLoopbackPortsAvailable([server.port]),
    /already in use/u,
  );
  await server.stop();
  await assert.doesNotReject(assertLoopbackPortsAvailable([server.port]));
});
