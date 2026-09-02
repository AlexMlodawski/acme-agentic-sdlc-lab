import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { assertSecretFreeLocalEnvironment } from "./local-environment.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const npmCli = process.env.npm_execpath;
if (
  typeof npmCli !== "string"
  || !path.isAbsolute(npmCli)
  || path.basename(npmCli).toLowerCase() !== "npm-cli.js"
) {
  throw new Error("Start the local profile through npm run dev.");
}
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

const apiPort = process.env.SUPPORT_API_PORT?.trim() || "4000";
const portalPort = process.env.PORTAL_PORT?.trim() || "3000";
for (const [name, value] of [["SUPPORT_API_PORT", apiPort], ["PORTAL_PORT", portalPort]]) {
  if (!/^\d{1,5}$/u.test(value) || Number(value) < 1 || Number(value) > 65_535) {
    throw new Error(`${name} must be a valid TCP port.`);
  }
}
if (apiPort === portalPort) throw new Error("Portal and Support API ports must differ.");
assertSecretFreeLocalEnvironment(projectRoot);

const common = {
  ...inherited,
  NODE_ENV: "development",
  NEXT_TELEMETRY_DISABLED: "1",
  DEMO_CORRELATION_ID: "ACME-LAB-LOCAL",
};
const children = [
  spawn(process.execPath, [npmCli, "run", "dev", "-w", "services/support-api"], {
    cwd: projectRoot,
    env: {
      ...common,
      SUPPORT_API_HOST: "127.0.0.1",
      SUPPORT_API_PORT: apiPort,
      SUPPORT_API_REQUIRE_AUTH: "0",
      SUPPORT_API_TOKEN: "",
      OTEL_ENABLED: "0",
    },
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  }),
  spawn(process.execPath, [npmCli, "run", "dev", "-w", "apps/portal"], {
    cwd: projectRoot,
    env: {
      ...common,
      PORT: portalPort,
      SUPPORT_API_BASE_URL: `http://127.0.0.1:${apiPort}`,
      SUPPORT_API_TOKEN: "",
      AGENT_MODE: "stub",
    },
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  }),
];

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  process.exitCode = exitCode;
}

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => stop(0));
for (const child of children) {
  child.once("error", () => stop(1));
  child.once("exit", (code) => {
    if (!stopping) stop(code === 0 ? 0 : 1);
  });
}

console.log(`PORTAL_URL=http://127.0.0.1:${portalPort}`);
console.log(`SUPPORT_API_URL=http://127.0.0.1:${apiPort}`);
console.log("LOCAL_PROFILE=ZERO_SECRET_STUB");
