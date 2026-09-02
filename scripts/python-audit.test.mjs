import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertContainedPath,
  auditEnvironment,
  buildPythonAuditPlan,
  executeExecutable,
  executableCandidates,
  formatPublicOutput,
  parsePipAuditResult,
  runPythonAudit,
} from "./python-audit.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("audit environment disables user uv, pip, keyring, and env-file configuration", () => {
  const environment = auditEnvironment({
    HOME: "/synthetic/home",
    UV_INDEX: "https://private.invalid/simple",
    UV_NO_CONFIG: "0",
  });
  assert.equal(environment.HOME, "/synthetic/home");
  assert.equal(environment.UV_INDEX, undefined);
  assert.equal(environment.UV_NO_CONFIG, "1");
  assert.equal(environment.UV_NO_ENV_FILE, "1");
  assert.equal(environment.UV_KEYRING_PROVIDER, "disabled");
  assert.equal(environment.PIP_CONFIG_FILE, os.devNull);
});

async function createRepository(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "acme-python-audit-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "agents", "store_support_agent"), { recursive: true });
  await writeFile(path.join(root, ".python-version"), "3.12.10\n");
  await writeFile(path.join(root, "agents", "store_support_agent", "uv.lock"), "version = 1\n");
  return root;
}

function fakeResolver(name) {
  return `/synthetic/bin/${name}`;
}

function successfulExecutor(document = {
  dependencies: [
    { name: "alpha", version: "1.0.0", vulns: [] },
    { name: "pytest", version: "8.4.2", vulns: [] },
  ],
}) {
  return async (_executable, args, options) => {
    if (options.stage === "export") {
      const output = args[args.indexOf("--output-file") + 1];
      await writeFile(output, "alpha==1.0.0\npytest==8.4.2\n");
    } else {
      const output = args[args.indexOf("--output") + 1];
      await writeFile(output, `${JSON.stringify(document)}\n`);
    }
    return { exitCode: 0, stdout: "", stderr: "", error: undefined };
  };
}

test("Windows and POSIX executable candidate plans are deterministic", () => {
  assert.deepEqual(
    executableCandidates("uv", {
      environment: { PATH: "C:\\Tools", PATHEXT: ".EXE;.CMD" },
      platform: "win32",
    }).map((candidate) => path.win32.basename(candidate).toLowerCase()),
    ["uv.exe", "uv.com", "uv.cmd", "uv.bat"],
  );
  assert.deepEqual(
    executableCandidates("uv", {
      environment: { PATH: "/usr/local/bin:/usr/bin" },
      platform: "linux",
    }),
    [path.posix.resolve("/usr/local/bin/uv"), path.posix.resolve("/usr/bin/uv")],
  );
});

test("Windows command wrappers execute through ComSpec without EINVAL", {
  skip: process.platform !== "win32",
}, async (t) => {
  const root = await createRepository(t);
  const wrapper = path.join(root, "synthetic-tool.cmd");
  await writeFile(wrapper, "@echo 1.2.3\r\n");
  const result = executeExecutable(wrapper, [], { cwd: root });
  assert.equal(result.error, undefined);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.trim(), "1.2.3");
});

test("audit plan exports every locked group and pins pip-audit", () => {
  const temporary = path.resolve("release-evidence", ".python-audit-work", "run-test");
  const plan = buildPythonAuditPlan({
    uv: "uv",
    projectDirectory: path.resolve("agents", "store_support_agent"),
    temporaryDirectory: temporary,
    pythonVersion: "3.12.10",
  });
  assert.ok(plan.export.args.includes("--locked"));
  assert.ok(plan.export.args.includes("--all-groups"));
  assert.deepEqual(
    plan.export.args.slice(
      plan.export.args.indexOf("--no-group"),
      plan.export.args.indexOf("--no-group") + 2,
    ),
    ["--no-group", "audit"],
  );
  assert.ok(plan.export.args.includes("--all-extras"));
  assert.ok(plan.export.args.includes("--no-emit-project"));
  assert.ok(plan.export.args.includes("--offline"));
  assert.equal(plan.audit.executable, "uv");
  assert.ok(plan.audit.args.includes("--locked"));
  assert.deepEqual(
    plan.audit.args.slice(
      plan.audit.args.indexOf("--only-group"),
      plan.audit.args.indexOf("--only-group") + 2,
    ),
    ["--only-group", "audit"],
  );
  assert.ok(plan.audit.args.includes("pip-audit"));
  assert.ok(plan.audit.args.includes("--disable-pip"));
  assert.ok(plan.audit.args.includes("--no-deps"));
  assertContainedPath(temporary, plan.requirements);
  assertContainedPath(temporary, plan.result);
});

test("pip-audit and its tool graph are repository locked", async () => {
  const [project, lock] = await Promise.all([
    readFile(path.join(repositoryRoot, "agents", "store_support_agent", "pyproject.toml"), "utf8"),
    readFile(path.join(repositoryRoot, "agents", "store_support_agent", "uv.lock"), "utf8"),
  ]);
  assert.match(project, /audit\s*=\s*\[\s*"pip-audit==2\.10\.1",?\s*\]/u);
  assert.match(lock, /\[\[package\]\]\s*name = "pip-audit"\s*version = "2\.10\.1"/u);
});

test("containment rejects sibling-prefix paths on Windows and Linux", () => {
  assert.doesNotThrow(() => assertContainedPath("C:\\audit", "C:\\audit\\run-1", "win32"));
  assert.throws(
    () => assertContainedPath("C:\\audit", "C:\\audit-escape\\run-1", "win32"),
    /escaped/u,
  );
  assert.doesNotThrow(() => assertContainedPath("/audit", "/audit/run-1", "linux"));
  assert.throws(() => assertContainedPath("/audit", "/audit-escape/run-1", "linux"), /escaped/u);
});

test("pip-audit JSON parsing counts dependencies, findings, and skipped entries", () => {
  assert.deepEqual(
    parsePipAuditResult({
      dependencies: [
        { name: "one", vulns: [{ id: "SYNTHETIC-1" }] },
        { name: "two", vulns: [], skip_reason: "synthetic" },
      ],
    }),
    { dependencies: 2, vulnerabilities: 1, skipped: 1 },
  );
  assert.throws(() => parsePipAuditResult({}), /dependency list/u);
});

test("successful audit removes only its unique contained work directory", async (t) => {
  const root = await createRepository(t);
  const outcome = await runPythonAudit({
    root,
    resolveExecutable: fakeResolver,
    execute: successfulExecutor(),
  });
  assert.deepEqual(outcome, {
    uvStatus: "pass",
    exportStatus: "pass",
    auditStatus: "pass",
    dependencyCount: 2,
    vulnerabilityCount: 0,
    skippedCount: 0,
    reason: "completed",
    exitCode: 0,
  });
  const workRoot = path.join(root, "release-evidence", ".python-audit-work");
  assert.deepEqual(await readdir(workRoot), []);
  assert.equal(
    await readFile(path.join(root, "agents", "store_support_agent", "uv.lock"), "utf8"),
    "version = 1\n",
  );
});

test("a finding or skipped dependency is a hard failure", async (t) => {
  const root = await createRepository(t);
  const findingDocument = {
    dependencies: [
      { name: "alpha", version: "1.0.0", vulns: [{ id: "SYNTHETIC-1" }] },
    ],
  };
  const execute = successfulExecutor(findingDocument);
  const outcome = await runPythonAudit({
    root,
    resolveExecutable: fakeResolver,
    execute: async (...args) => {
      const result = await execute(...args);
      return args[2].stage === "audit" ? { ...result, exitCode: 1 } : result;
    },
  });
  assert.equal(outcome.auditStatus, "fail");
  assert.equal(outcome.vulnerabilityCount, 1);
  assert.equal(outcome.exitCode, 1);
});

test("missing uv is not_completed and does not create audit work", async (t) => {
  const root = await createRepository(t);
  const outcome = await runPythonAudit({
    root,
    resolveExecutable: () => null,
    execute: async () => {
      throw new Error("must not execute");
    },
  });
  assert.equal(outcome.uvStatus, "not_completed");
  assert.equal(outcome.exitCode, 2);
  await assert.rejects(readdir(path.join(root, "release-evidence")), /ENOENT/u);
});

test("public output contains only statuses and counts", () => {
  const output = formatPublicOutput({
    uvStatus: "pass",
    exportStatus: "pass",
    auditStatus: "fail",
    dependencyCount: 42,
    vulnerabilityCount: 1,
    skippedCount: 0,
    exitCode: 1,
  });
  assert.equal(
    output,
    [
      "PYTHON_UV_STATUS=pass",
      "PYTHON_LOCK_EXPORT_STATUS=pass",
      "PYTHON_AUDIT_STATUS=fail",
      "PYTHON_AUDITED_DEPENDENCIES=42",
      "PYTHON_VULNERABILITY_FINDINGS=1",
      "PYTHON_SKIPPED_DEPENDENCIES=0",
      "PYTHON_DEPENDENCY_AUDIT=FAIL",
      "",
    ].join("\n"),
  );
  assert.doesNotMatch(output, /https?:|requirements|[\\/]Users[\\/]|[\\/]home[\\/]/iu);
});
