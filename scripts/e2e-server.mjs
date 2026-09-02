import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { assertSecretFreeLocalEnvironment } from "./local-environment.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [profile, servicePort, apiPort = servicePort] = process.argv.slice(2);

const profiles = new Map([
  ["api", { workspace: "services/support-api", script: "dev", service: "api", nodeEnv: "development" }],
  ["portal", { workspace: "apps/portal", script: "dev", service: "portal", nodeEnv: "development" }],
  ["api-built", { workspace: "services/support-api", script: "start", service: "api", nodeEnv: "production" }],
  ["portal-built", { workspace: "apps/portal", script: "start", service: "portal", nodeEnv: "production" }],
]);
const selectedProfile = profiles.get(profile);

if (!selectedProfile) {
  throw new Error("E2E server profile must be api, portal, api-built, or portal-built.");
}
for (const [name, value] of [["service port", servicePort], ["API port", apiPort]]) {
  if (typeof value !== "string" || !/^\d{1,5}$/u.test(value)
    || Number(value) < 1 || Number(value) > 65_535) {
    throw new Error(`E2E ${name} must be a valid TCP port.`);
  }
}

const npmCli = process.env.npm_execpath;
if (typeof npmCli !== "string" || !path.isAbsolute(npmCli)
  || path.basename(npmCli).toLowerCase() !== "npm-cli.js") {
  throw new Error("Start E2E through an npm workspace script.");
}

const requiredArtifact = profile === "api-built"
  ? path.join(projectRoot, "services", "support-api", "dist", "server.js")
  : profile === "portal-built"
    ? path.join(projectRoot, "apps", "portal", ".next", "BUILD_ID")
    : undefined;
if (requiredArtifact && !existsSync(requiredArtifact)) {
  throw new Error("Built E2E requires current build artifacts. Run npm run build first.");
}
assertSecretFreeLocalEnvironment(projectRoot);

const inheritedNames = [
  "SystemRoot", "SYSTEMROOT", "WINDIR", "ComSpec", "COMSPEC", "Path", "PATH",
  "PATHEXT", "TEMP", "TMP", "TMPDIR", "LOCALAPPDATA", "APPDATA", "HOME",
  "USERPROFILE", "TERM", "COLORTERM",
];
const inherited = Object.fromEntries(
  inheritedNames
    .filter((name) => process.env[name] !== undefined)
    .map((name) => [name, process.env[name]]),
);
const common = {
  ...inherited,
  CI: process.env.CI === "1" ? "1" : "",
  NODE_ENV: selectedProfile.nodeEnv,
  NEXT_TELEMETRY_DISABLED: "1",
  DEMO_CORRELATION_ID: "ACME-LAB-E2E",
};

const environment = selectedProfile.service === "api"
  ? {
      ...common,
      SUPPORT_API_HOST: "127.0.0.1",
      SUPPORT_API_PORT: servicePort,
      SUPPORT_API_REQUIRE_AUTH: "0",
      SUPPORT_API_TOKEN: "",
      OTEL_ENABLED: "0",
    }
  : {
      ...common,
      PORT: servicePort,
      SUPPORT_API_BASE_URL: `http://127.0.0.1:${apiPort}`,
      SUPPORT_API_TOKEN: "",
      AGENT_MODE: "stub",
    };

const child = spawn(
  process.execPath,
  [npmCli, "run", selectedProfile.script, "-w", selectedProfile.workspace],
  {
    cwd: projectRoot,
    env: environment,
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  },
);

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  if (child.exitCode === null) child.kill("SIGTERM");
  process.exitCode = exitCode;
}

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => stop(0));
child.once("error", () => stop(1));
child.once("exit", (code) => {
  if (!stopping) stop(code === 0 ? 0 : 1);
});
