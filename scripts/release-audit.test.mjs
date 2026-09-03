import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, rm, writeFile, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createCommandPlan,
  deriveOverallStatus,
  parseArguments,
  redactText,
  resolveNpmInvocation,
  runReleaseAudit,
  safeEnvironment,
  validateCandidate,
} from "./release-audit.mjs";

const schemaPath = fileURLToPath(
  new URL("../contracts/release-evidence.schema.json", import.meta.url),
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    ...options,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result;
}

async function createRepository(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "acme-release-audit-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  run("git", ["init", "-q"], { cwd: directory });
  run("git", ["config", "user.name", "Acme Audit Test"], { cwd: directory });
  run("git", ["config", "user.email", "audit@example.invalid"], { cwd: directory });
  await writeFile(path.join(directory, "README.md"), "synthetic repository\n");
  await writeFile(
    path.join(directory, ".gitignore"),
    "release-evidence/\nsbom.cdx.json\nlicense-inventory.json\nclean-archive-verify.json\n",
  );
  run("git", ["add", "README.md", ".gitignore"], { cwd: directory });
  run("git", ["commit", "-q", "-m", "test: initialize synthetic repository"], { cwd: directory });
  return directory;
}

function successfulExecutor() {
  return async (step, { root }) => {
    if (step.id === "sbom") {
      await writeFile(
        path.join(root, "sbom.cdx.json"),
        '{"bomFormat":"CycloneDX","specVersion":"1.6"}\n',
      );
    }
    if (step.id === "license-inventory") {
      await writeFile(
        path.join(root, "license-inventory.json"),
        '{"schema_version":1,"generation_status":"pass","legal_review_status":"not_asserted","summary":{"component_count":0,"node_component_count":0,"python_component_count":0,"needs_review_count":0},"components":[]}\n',
      );
    }
    if (step.id === "verify-archive") {
      const sourceSha = run("git", ["rev-parse", "HEAD"], { cwd: root }).stdout.trim();
      await writeFile(
        path.join(root, "clean-archive-verify.json"),
        `${JSON.stringify({ schema_version: 1, verification_status: "pass", source_sha: sourceSha, archive_sha256: "0".repeat(64), tracked_file_count: 0, profiles_verified: ["local-development", "production-build"], lifecycle_verified: ["install", "verify", "reset", "uninstall"] })}\n`,
      );
    }
    return {
      exitCode: 0,
      stdout: ["C:\\", "Users\\synthetic-user\\repo token=synthetic-test-token\n"].join(""),
      stderr: `${["Author", "ization"].join("")}: Bearer synthetic-bearer-value\n`,
      error: undefined,
      signal: null,
    };
  };
}

test("Quick and Full plans contain the required hard gates", () => {
  const quick = createCommandPlan("Quick");
  assert.deepEqual(
    quick.map((step) => step.id),
    [
      "doctor",
      "git-fsck",
      "current-tree-scan",
      "history-scan",
      "documentation-scan",
      "lint",
      "typecheck",
      "tests",
      "build",
      "npm-audit",
      "python-audit",
      "sbom",
    ],
  );
  assert.deepEqual(
    createCommandPlan("full").map((step) => step.id),
    [
      ...quick.map((step) => step.id),
      "verify-agent",
      "license-inventory",
      "e2e-local",
      "e2e-built",
      "verify-archive",
    ],
  );
  assert.ok(createCommandPlan("Full").every((step) => step.hardGate));
});

test("redaction removes credentials, private keys, and absolute user path prefixes", () => {
  const windowsHome = ["C:\\", "Users\\fixture-user"].join("");
  const escapedWindowsHome = windowsHome.replaceAll("\\", "\\\\");
  const linuxHome = ["/home", "/fixture-user"].join("");
  const macHome = ["/Users", "/fixture-user"].join("");
  const wslHome = ["/mnt", "/c", "/Users", "/fixture-user"].join("");
  const uncPath = ["\\\\", "fixture-host", "\\private-share", "\\report.log"].join("");
  const escapedUncPath = uncPath.replaceAll("\\", "\\\\");
  const escapedWslPath = `${wslHome}/project/report.log`.replaceAll("/", "\\/");
  const slashUncPath = ["//", "fixture-host", "/private-share", "/report.log"].join("");
  const spacedWindowsHome = ["C:\\", "Users\\Fixture Person"].join("");
  const encodedWindowsPath = `file:///${encodeURI(`${spacedWindowsHome}\\project\\report.log`)}`;
  const githubToken = ["ghp", "_123456789012345678901234567890"].join("");
  const privateKey = [
    "-----BEGIN ",
    "PRIVATE KEY-----\nprivate-material\n-----END ",
    "PRIVATE KEY-----",
  ].join("");
  const authorizationFixture = `${["Author", "ization"].join("")}: Bearer bearer-value`;
  const instanaKeyName = ["INSTANA", "AGENT", "KEY"].join("_");
  const instanaHeaderName = ["x", "instana", "key"].join("-");
  const input = [
    `${windowsHome}\\project\\report.log`,
    `${escapedWindowsHome}\\\\project\\\\report.log`,
    `${linuxHome}/project/report.log`,
    `${macHome}/project/report.log`,
    `${wslHome}/project/report.log`,
    escapedWslPath,
    slashUncPath,
    `${spacedWindowsHome}\\project\\report.log`,
    encodedWindowsPath,
    uncPath,
    escapedUncPath,
    "token=super-secret-value",
    '"GITHUB_TOKEN": "json-secret-value"',
    authorizationFixture,
    `${instanaKeyName}=instana-secret-value`,
    `${instanaHeaderName}: header-secret-value`,
    "tool --api-key command-line-secret",
    "https://person:password@example.invalid/path",
    githubToken,
    privateKey,
  ].join("\n");
  const output = redactText(input, windowsHome);
  for (const forbidden of [
    "fixture-user",
    "fixture-host",
    "private-share",
    "super-secret-value",
    "json-secret-value",
    "bearer-value",
    "instana-secret-value",
    "header-secret-value",
    "command-line-secret",
    "person:password",
    githubToken,
    "private-material",
    "Fixture Person",
  ]) {
    assert.doesNotMatch(output, new RegExp(forbidden, "u"));
  }
  assert.match(output, /\[REDACTED_(?:SECRET|USER_PATH)\]/u);
});

test("path redaction preserves adjacent evidence fields and regex-like text", () => {
  const uncPath = ["\\\\", "fixture-host", "\\private-share", "\\report.log"].join("");
  const slashUncPath = ["//", "fixture-host", "/private-share", "/report.log"].join("");
  const regexLikeText = ["matcher=", "\\\\", "d+", "\\\\", "w+", " status=PASS"].join("");
  for (const path of [uncPath, slashUncPath]) {
    const output = redactText(`${path},status=PASS`, "");
    assert.equal(output, "[REDACTED_USER_PATH],status=PASS");
  }
  assert.equal(redactText(regexLikeText, ""), regexLikeText);
});

test("candidate and CLI arguments reject traversal and unknown options", () => {
  assert.equal(validateCandidate("v0.1.0-rc.1"), "v0.1.0-rc.1");
  assert.throws(() => validateCandidate("../escape"), /Candidate/u);
  const credentialLikeCandidate = ["ghp", "_123456789012345678901234567890"].join("");
  assert.throws(() => validateCandidate(credentialLikeCandidate), /credential/u);
  assert.deepEqual(
    parseArguments(["--mode", "full", "--candidate", "v0.1.0-rc.1", "--allow-dirty"]),
    { mode: "Full", candidate: "v0.1.0-rc.1", allowDirty: true, dryRun: false },
  );
  assert.throws(() => parseArguments(["--wat", "value"]), /Unknown argument/u);
});

test("Windows npm fallback uses ComSpec and npm_execpath uses the Node CLI", () => {
  assert.deepEqual(
    resolveNpmInvocation(["run", "lint"], {
      environment: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      platform: "win32",
      nodeExecutable: "C:\\node.exe",
    }),
    {
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "npm run lint"],
    },
  );
  assert.deepEqual(
    resolveNpmInvocation(["run", "lint"], {
      environment: { npm_execpath: "C:\\npm\\bin\\npm-cli.js" },
      platform: "win32",
      nodeExecutable: "C:\\node.exe",
    }),
    {
      command: "C:\\node.exe",
      args: ["C:\\npm\\bin\\npm-cli.js", "run", "lint"],
    },
  );
});

test("filtered subprocess environment does not double-load npm configuration", () => {
  const environment = safeEnvironment(process.env);
  assert.equal(environment.NPM_CONFIG_USERCONFIG, os.devNull);
  assert.equal(environment.NPM_CONFIG_GLOBALCONFIG, undefined);
  assert.equal(environment.GIT_NO_LAZY_FETCH, "1");
  assert.equal(environment.GIT_NO_REPLACE_OBJECTS, "1");
  assert.equal(environment.GIT_CONFIG_GLOBAL, process.platform === "win32" ? "NUL" : os.devNull);
  assert.equal(environment.GIT_DIR, undefined);
  assert.equal(environment.GIT_INDEX_FILE, undefined);
  const invocation = resolveNpmInvocation(["--version"], { environment });
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: "utf8",
    env: environment,
    shell: false,
    windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${result.stdout ?? ""}${result.stderr ?? ""}`);
});

test("overall status gives hard failures and incomplete gates precedence", () => {
  assert.equal(deriveOverallStatus([{ hard_gate: true, status: "pass" }]), "pass");
  assert.equal(deriveOverallStatus([{ hard_gate: true, status: "not_asserted" }]), "not_asserted");
  assert.equal(deriveOverallStatus([{ hard_gate: true, status: "not_completed" }]), "not_completed");
  assert.equal(
    deriveOverallStatus([
      { hard_gate: true, status: "not_completed" },
      { hard_gate: true, status: "fail" },
    ]),
    "fail",
  );
});

test("successful synthetic audit writes redacted logs, source identity, report, and SBOM", async (t) => {
  const root = await createRepository(t);
  const result = await runReleaseAudit({
    root,
    mode: "Quick",
    candidate: "v0.1.0-rc.1",
    execute: successfulExecutor(),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.overall_status, "pass");
  assert.equal(result.report.hard_gate_passed, true);
  assert.match(result.report.source.sha, /^[0-9a-f]{40}$/u);
  assert.equal(result.report.source.dirty, false);
  assert.equal(result.report.source.status_porcelain.length, 0);
  assert.equal(result.report.steps.length, 14);
  assert.equal(result.report.steps.every((step) => step.status === "pass"), true);

  const report = JSON.parse(await readFile(path.join(result.outputDirectory, "report.json"), "utf8"));
  assert.equal(report.candidate, "v0.1.0-rc.1");
  const summary = await readFile(path.join(result.outputDirectory, "audit-summary.md"), "utf8");
  assert.match(summary, /Overall status: `pass`/u);
  assert.match(summary, /not release approval/u);
  const environment = JSON.parse(
    await readFile(path.join(result.outputDirectory, "environment.json"), "utf8"),
  );
  assert.match(environment.node_version, /^\d+\.\d+\.\d+/u);
  assert.equal(typeof environment.platform, "string");
  const checksums = await readFile(path.join(result.outputDirectory, "checksums.sha256"), "utf8");
  assert.match(checksums, /^[0-9a-f]{64}  audit-summary\.md$/mu);
  assert.match(checksums, /^[0-9a-f]{64}  report\.json$/mu);
  assert.doesNotMatch(checksums, /evidence-complete\.json/u);
  const completion = JSON.parse(
    await readFile(path.join(result.outputDirectory, "evidence-complete.json"), "utf8"),
  );
  assert.equal(completion.completion_status, "pass");
  assert.equal(completion.audit_status, "pass");
  assert.equal(completion.source_sha, result.report.source.sha);
  assert.equal(
    completion.report_sha256,
    createHash("sha256")
      .update(await readFile(path.join(result.outputDirectory, "report.json")))
      .digest("hex"),
  );
  assert.equal(
    completion.checksums_sha256,
    createHash("sha256").update(checksums, "utf8").digest("hex"),
  );
  const lintLog = await readFile(path.join(result.outputDirectory, "steps", "07-lint.log"), "utf8");
  assert.doesNotMatch(lintLog, /synthetic-user|synthetic-test-token|bearer-value/u);
  assert.match(lintLog, /\[REDACTED_/u);
  assert.equal(
    JSON.parse(await readFile(path.join(result.outputDirectory, "artifacts", "sbom.cdx.json"), "utf8")).bomFormat,
    "CycloneDX",
  );
});

test("successive Full audits capture a reviewable license inventory without a stale source", async (t) => {
  const root = await createRepository(t);
  const first = await runReleaseAudit({
    root,
    mode: "Full",
    candidate: "v0.1.0-rc.license-1",
    execute: successfulExecutor(),
  });
  assert.equal(first.exitCode, 0);
  const firstStep = first.report.steps.find((step) => step.id === "license-inventory");
  assert.equal(firstStep?.status, "pass");
  assert.equal(firstStep?.artifact, "artifacts/license-inventory.json");
  const firstArtifact = JSON.parse(await readFile(
    path.join(first.outputDirectory, "artifacts", "license-inventory.json"),
    "utf8",
  ));
  assert.equal(firstArtifact.generation_status, "pass");
  assert.equal(firstArtifact.legal_review_status, "not_asserted");
  await assert.rejects(readFile(path.join(root, "license-inventory.json"), "utf8"), /ENOENT/u);
  const archiveStep = first.report.steps.find((step) => step.id === "verify-archive");
  assert.equal(archiveStep?.artifact, "artifacts/clean-archive-verify.json");
  assert.equal(
    JSON.parse(await readFile(
      path.join(first.outputDirectory, "artifacts", "clean-archive-verify.json"),
      "utf8",
    )).verification_status,
    "pass",
  );
  await assert.rejects(readFile(path.join(root, "clean-archive-verify.json"), "utf8"), /ENOENT/u);

  const second = await runReleaseAudit({
    root,
    mode: "Full",
    candidate: "v0.1.0-rc.license-2",
    execute: successfulExecutor(),
  });
  assert.equal(second.exitCode, 0);
  assert.equal(
    JSON.parse(await readFile(
      path.join(second.outputDirectory, "artifacts", "license-inventory.json"),
      "utf8",
    )).legal_review_status,
    "not_asserted",
  );
});

test("a dirty tree blocks commands unless explicitly allowed", async (t) => {
  const root = await createRepository(t);
  await writeFile(path.join(root, "README.md"), "dirty synthetic repository\n");
  let executions = 0;
  const result = await runReleaseAudit({
    root,
    mode: "Quick",
    candidate: "dirty-candidate",
    execute: async () => {
      executions += 1;
      throw new Error("executor must not be called");
    },
  });
  assert.equal(executions, 0);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.source.dirty, true);
  assert.equal(result.report.steps[0].status, "fail");
  assert.equal(result.report.steps.slice(1, -1).every((step) => step.status === "not_completed"), true);
  assert.equal(result.report.steps.at(-1)?.status, "pass");
});

test("failed and interrupted hard gates produce a nonzero result", async (t) => {
  const root = await createRepository(t);
  const executor = async (step, { root: repositoryRoot }) => {
    if (step.id === "lint") return { exitCode: 2, stdout: "lint failed", stderr: "" };
    if (step.id === "typecheck") {
      return { exitCode: null, stdout: "", stderr: "", error: new Error("spawn interrupted") };
    }
    if (step.id === "sbom") {
      await writeFile(path.join(repositoryRoot, "sbom.cdx.json"), "{}\n");
    }
    return { exitCode: 0, stdout: "ok", stderr: "" };
  };
  const result = await runReleaseAudit({
    root,
    mode: "Quick",
    candidate: "failed-candidate",
    execute: executor,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.overall_status, "fail");
  assert.equal(result.report.steps.find((step) => step.id === "lint")?.status, "fail");
  assert.equal(
    result.report.steps.find((step) => step.id === "typecheck")?.status,
    "not_completed",
  );
});

test("fails the final source binding if HEAD changes during the audit", async (t) => {
  const root = await createRepository(t);
  const initialSha = run("git", ["rev-parse", "HEAD"], { cwd: root }).stdout.trim();
  const executeBase = successfulExecutor();
  let changed = false;
  const candidate = "changed-source";
  await assert.rejects(
    runReleaseAudit({
      root,
      mode: "Quick",
      candidate,
      execute: async (step, context) => {
        if (!changed && step.id === "lint") {
          changed = true;
          await writeFile(path.join(root, "README.md"), "changed during audit\n");
          run("git", ["add", "README.md"], { cwd: root });
          run("git", ["commit", "-q", "-m", "change source during audit"], { cwd: root });
        }
        return executeBase(step, context);
      },
    }),
    /Source state changed before evidence finalization/u,
  );
  const output = path.join(root, "release-evidence", candidate);
  const report = JSON.parse(await readFile(path.join(output, "report.json"), "utf8"));
  assert.equal(report.overall_status, "fail");
  assert.equal(report.steps.find((step) => step.id === "source-final-state")?.status, "fail");
  assert.equal(report.source.sha, initialSha);
  assert.notEqual(initialSha, run("git", ["rev-parse", "HEAD"], { cwd: root }).stdout.trim());
  await assert.rejects(readFile(path.join(output, "evidence-complete.json"), "utf8"), /ENOENT/u);
});

test("rejects clean-archive evidence from another source commit", async (t) => {
  const root = await createRepository(t);
  const executeBase = successfulExecutor();
  const result = await runReleaseAudit({
    root,
    mode: "Full",
    candidate: "mismatched-archive",
    execute: async (step, context) => {
      const execution = await executeBase(step, context);
      if (step.id === "verify-archive") {
        const artifact = JSON.parse(await readFile(path.join(root, "clean-archive-verify.json"), "utf8"));
        artifact.source_sha = "f".repeat(40);
        await writeFile(path.join(root, "clean-archive-verify.json"), `${JSON.stringify(artifact)}\n`);
      }
      return execution;
    },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.steps.find((step) => step.id === "verify-archive")?.status, "fail");
});

test("does not create an authoritative completion marker when finalization fails", async (t) => {
  const root = await createRepository(t);
  const candidate = "incomplete-bundle";
  await assert.rejects(
    runReleaseAudit({
      root,
      mode: "Quick",
      candidate,
      execute: successfulExecutor(),
      writeCompletion: async () => {
        throw new Error("synthetic finalization failure");
      },
    }),
    /synthetic finalization failure/u,
  );
  const output = path.join(root, "release-evidence", candidate);
  assert.equal(JSON.parse(await readFile(path.join(output, "report.json"), "utf8")).candidate, candidate);
  await assert.rejects(readFile(path.join(output, "evidence-complete.json"), "utf8"), /ENOENT/u);
});

test("dry-run records the plan as not_asserted without invoking commands", async (t) => {
  const root = await createRepository(t);
  const result = await runReleaseAudit({
    root,
    mode: "Full",
    candidate: "dry-run-candidate",
    dryRun: true,
    execute: async () => {
      throw new Error("executor must not be called during dry-run");
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.overall_status, "not_asserted");
  assert.equal(result.report.hard_gate_passed, false);
  assert.equal(result.report.steps[0].status, "pass");
  assert.equal(result.report.steps.slice(1, -1).every((step) => step.status === "not_asserted"), true);
  assert.equal(result.report.steps.at(-1)?.status, "pass");
});

test("existing candidate output is never overwritten", async (t) => {
  const root = await createRepository(t);
  await runReleaseAudit({
    root,
    mode: "Quick",
    candidate: "immutable-output",
    dryRun: true,
  });
  await assert.rejects(
    runReleaseAudit({
      root,
      mode: "Quick",
      candidate: "immutable-output",
      allowDirty: true,
      dryRun: true,
    }),
    /EEXIST|exist/iu,
  );
});

test("schema permits only the four evidence status values", async () => {
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  assert.deepEqual(
    schema.$defs.status.enum,
    ["pass", "fail", "not_completed", "not_asserted"],
  );
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.$defs.step.additionalProperties, false);
});
