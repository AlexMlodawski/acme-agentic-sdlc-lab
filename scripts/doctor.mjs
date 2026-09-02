import { accessSync, constants as fsConstants, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { executeExecutable, findExecutable } from "./python-audit.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWED_STATUSES = new Set(["pass", "fail", "not_completed", "not_asserted"]);

function exactVersion(value, label) {
  const version = String(value ?? "").trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new TypeError(`${label} version declaration is invalid.`);
  }
  return version;
}

export async function readDeclaredVersions(root) {
  const [nodeSource, pythonSource, packageSource, workflowSource, readmeSource] = await Promise.all([
    readFile(path.join(root, ".node-version"), "utf8"),
    readFile(path.join(root, ".python-version"), "utf8"),
    readFile(path.join(root, "package.json"), "utf8"),
    readFile(path.join(root, ".github", "workflows", "ci.yml"), "utf8"),
    readFile(path.join(root, "README.md"), "utf8"),
  ]);
  const packageDocument = JSON.parse(packageSource);
  const packageManager = typeof packageDocument.packageManager === "string"
    ? /^npm@(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/u.exec(packageDocument.packageManager)
    : null;
  if (packageManager === null) throw new TypeError("packageManager must pin an exact npm version.");

  const setupIndex = workflowSource.search(/astral-sh\/setup-uv@/u);
  const setupBlock = setupIndex < 0 ? "" : workflowSource.slice(setupIndex, setupIndex + 500);
  const workflowUv = /\bversion:\s*["']?(\d+\.\d+\.\d+)["']?/u.exec(setupBlock)?.[1];
  const readmeUv = /`uv`\s+`?(\d+\.\d+\.\d+)`?/u.exec(readmeSource)?.[1];
  if (workflowUv === undefined || readmeUv === undefined || workflowUv !== readmeUv) {
    throw new TypeError("README and CI must declare the same exact uv version.");
  }

  return {
    node: exactVersion(nodeSource, "Node.js"),
    npm: exactVersion(packageManager[1], "npm"),
    python: exactVersion(pythonSource, "Python"),
    uv: exactVersion(workflowUv, "uv"),
  };
}

function capturedCommand(executable, args, options) {
  try {
    return options.execute(executable, args, {
      cwd: options.root,
      environment: options.environment,
      platform: options.platform,
      timeoutMs: 30_000,
    });
  } catch (error) {
    return {
      exitCode: null,
      stdout: "",
      stderr: "",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

function unavailableCheck(id, expected = null) {
  return { id, required: true, status: "not_completed", expected, actual: null };
}

function versionCheck(id, expected, executable, args, pattern, options) {
  if (executable === null) return unavailableCheck(id, expected);
  const result = capturedCommand(executable, args, options);
  if (result.error || result.exitCode !== 0) return unavailableCheck(id, expected);
  const actual = pattern.exec(`${result.stdout ?? ""}\n${result.stderr ?? ""}`)?.[1] ?? null;
  if (actual === null || !/^[0-9A-Za-z.+_-]+$/u.test(actual)) {
    return unavailableCheck(id, expected);
  }
  return {
    id,
    required: true,
    status: actual === expected ? "pass" : "fail",
    expected,
    actual,
  };
}

function gitCheck(executable, options) {
  if (executable === null) return unavailableCheck("git");
  const version = capturedCommand(executable, ["--version"], options);
  const repository = capturedCommand(executable, ["rev-parse", "--is-inside-work-tree"], options);
  const actual = /git version ([0-9A-Za-z.+_-]+)/iu.exec(
    `${version.stdout ?? ""}\n${version.stderr ?? ""}`,
  )?.[1] ?? null;
  if (
    version.error
    || version.exitCode !== 0
    || repository.error
    || repository.exitCode !== 0
    || String(repository.stdout).trim() !== "true"
    || actual === null
  ) {
    return unavailableCheck("git");
  }
  return { id: "git", required: true, status: "pass", expected: null, actual };
}

function pythonCheck(expected, options) {
  const [major, minor] = expected.split(".");
  const commands = options.platform === "win32"
    ? [
        { name: "py", args: [`-${major}.${minor}`, "--version"] },
        { name: `python${major}.${minor}`, args: ["--version"] },
        { name: "python", args: ["--version"] },
        { name: "python3", args: ["--version"] },
      ]
    : [
        { name: `python${major}.${minor}`, args: ["--version"] },
        { name: "python3", args: ["--version"] },
        { name: "python", args: ["--version"] },
      ];
  const observed = [];
  for (const command of commands) {
    const executable = options.find(command.name);
    if (executable === null) continue;
    const result = capturedCommand(executable, command.args, options);
    if (result.error || result.exitCode !== 0) continue;
    const actual = /Python\s+(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/u.exec(
      `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    )?.[1];
    if (actual === expected) {
      return { id: "python", required: true, status: "pass", expected, actual };
    }
    if (actual !== undefined) observed.push(actual);
  }
  if (observed.length === 0) return unavailableCheck("python", expected);
  return { id: "python", required: true, status: "fail", expected, actual: observed[0] };
}

function defaultChromiumProbe(root) {
  try {
    const require = createRequire(path.join(root, "scripts", "doctor.mjs"));
    const { chromium } = require("@playwright/test");
    const executable = chromium.executablePath();
    accessSync(executable, fsConstants.R_OK);
    return statSync(executable).isFile();
  } catch {
    return false;
  }
}

function overallRequiredStatus(checks) {
  const required = checks.filter((check) => check.required);
  if (required.some((check) => check.status === "fail")) return "fail";
  if (required.some((check) => check.status === "not_completed")) return "not_completed";
  if (required.some((check) => check.status === "not_asserted")) return "not_asserted";
  return "pass";
}

export async function runDoctor({
  root = REPOSITORY_ROOT,
  environment = process.env,
  platform = process.platform,
  nodeVersion = process.versions.node,
  find = (name) => findExecutable(name, { environment, platform }),
  execute = executeExecutable,
  chromiumProbe = defaultChromiumProbe,
} = {}) {
  const absoluteRoot = path.resolve(root);
  let declarations;
  try {
    declarations = await readDeclaredVersions(absoluteRoot);
  } catch {
    const check = {
      id: "declarations",
      required: true,
      status: "fail",
      expected: null,
      actual: null,
    };
    return { checks: [check], overallStatus: "fail", exitCode: 1 };
  }

  const options = { root: absoluteRoot, environment, platform, find, execute };
  const checks = [
    { id: "declarations", required: true, status: "pass", expected: null, actual: null },
    gitCheck(find("git"), options),
    {
      id: "node",
      required: true,
      status: nodeVersion === declarations.node ? "pass" : "fail",
      expected: declarations.node,
      actual: /^[0-9A-Za-z.+_-]+$/u.test(nodeVersion) ? nodeVersion : null,
    },
    versionCheck(
      "npm",
      declarations.npm,
      find("npm"),
      ["--version"],
      /(?:^|\s)(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?:\s|$)/u,
      options,
    ),
    pythonCheck(declarations.python, options),
    versionCheck(
      "uv",
      declarations.uv,
      find("uv"),
      ["--version"],
      /\buv\s+(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/u,
      options,
    ),
    {
      id: "chromium",
      required: false,
      status: chromiumProbe(absoluteRoot) ? "pass" : "not_asserted",
      expected: null,
      actual: null,
    },
  ];
  for (const check of checks) {
    if (!ALLOWED_STATUSES.has(check.status)) throw new Error("Doctor produced an invalid status.");
  }
  const overallStatus = overallRequiredStatus(checks);
  return {
    checks,
    overallStatus,
    exitCode: overallStatus === "pass" ? 0 : overallStatus === "fail" ? 1 : 2,
  };
}

export function formatDoctorOutput(result) {
  const lines = [];
  for (const check of result.checks) {
    const prefix = `DOCTOR_${check.id.toUpperCase()}`;
    lines.push(`${prefix}_STATUS=${check.status}`);
    if (check.expected !== null) lines.push(`${prefix}_EXPECTED=${check.expected}`);
    if (check.actual !== null) lines.push(`${prefix}_ACTUAL=${check.actual}`);
  }
  lines.push(`DOCTOR_REQUIRED_STATUS=${result.overallStatus}`);
  return `${lines.join("\n")}\n`;
}

async function main() {
  const result = await runDoctor();
  process.stdout.write(formatDoctorOutput(result));
  process.exitCode = result.exitCode;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) await main();
