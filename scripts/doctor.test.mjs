import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  formatDoctorOutput,
  readDeclaredVersions,
  runDoctor,
} from "./doctor.mjs";

async function createRepository(t, overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "acme-doctor-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
  await mkdir(path.join(root, "scripts"));
  await writeFile(path.join(root, ".node-version"), `${overrides.node ?? "24.19.0"}\n`);
  await writeFile(path.join(root, ".python-version"), `${overrides.python ?? "3.12.10"}\n`);
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({ packageManager: `npm@${overrides.npm ?? "11.17.0"}` }, null, 2)}\n`,
  );
  await writeFile(
    path.join(root, ".github", "workflows", "ci.yml"),
    [
      "steps:",
      "  - uses: astral-sh/setup-uv@synthetic-pinned-sha",
      "    with:",
      `      version: "${overrides.workflowUv ?? "0.12.0"}"`,
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "README.md"),
    `Requires Python 3.12.10 and \`uv\` \`${overrides.readmeUv ?? "0.12.0"}\`.\n`,
  );
  return root;
}

function fakeFind(name) {
  return `/synthetic/bin/${name}`;
}

function fakeExecute(versions = {}) {
  return (executable, args) => {
    const name = path.basename(executable);
    let stdout = "";
    let stderr = "";
    if (name === "git" && args[0] === "--version") stdout = `git version ${versions.git ?? "2.51.0"}\n`;
    else if (name === "git") stdout = "true\n";
    else if (name === "npm") stdout = `${versions.npm ?? "11.17.0"}\n`;
    else if (name === "uv") stdout = `uv ${versions.uv ?? "0.12.0"}\n`;
    else if (name.startsWith("python") || name === "py") {
      stderr = `Python ${versions.python ?? "3.12.10"}\n`;
    }
    return { exitCode: 0, stdout, stderr, error: undefined };
  };
}

async function snapshotFiles(root) {
  const output = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replaceAll("\\", "/");
      if (entry.isDirectory()) await visit(absolute);
      else output.push([relative, await readFile(absolute, "utf8")]);
    }
  }
  await visit(root);
  return output.sort(([left], [right]) => left.localeCompare(right));
}

test("declared versions must agree across pin files, packageManager, README, and CI", async (t) => {
  const root = await createRepository(t);
  assert.deepEqual(await readDeclaredVersions(root), {
    node: "24.19.0",
    npm: "11.17.0",
    python: "3.12.10",
    uv: "0.12.0",
  });
  const mismatch = await createRepository(t, { readmeUv: "0.11.0" });
  await assert.rejects(readDeclaredVersions(mismatch), /same exact uv version/u);
});

test("doctor passes exact required versions and reports optional Chromium", async (t) => {
  const root = await createRepository(t);
  const before = await snapshotFiles(root);
  const result = await runDoctor({
    root,
    platform: "linux",
    nodeVersion: "24.19.0",
    find: fakeFind,
    execute: fakeExecute(),
    chromiumProbe: () => true,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.overallStatus, "pass");
  assert.equal(result.checks.every((check) => check.status === "pass"), true);
  assert.deepEqual(await snapshotFiles(root), before, "doctor must be read-only");
});

test("required version mismatch is fail and nonzero", async (t) => {
  const root = await createRepository(t);
  const result = await runDoctor({
    root,
    platform: "linux",
    nodeVersion: "24.19.0",
    find: fakeFind,
    execute: fakeExecute({ uv: "0.11.0" }),
    chromiumProbe: () => false,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.overallStatus, "fail");
  assert.equal(result.checks.find((check) => check.id === "uv")?.status, "fail");
  assert.equal(result.checks.find((check) => check.id === "chromium")?.status, "not_asserted");
});

test("missing required Python is not_completed and nonzero", async (t) => {
  const root = await createRepository(t);
  const result = await runDoctor({
    root,
    platform: "linux",
    nodeVersion: "24.19.0",
    find: (name) => name.startsWith("python") ? null : fakeFind(name),
    execute: fakeExecute(),
    chromiumProbe: () => false,
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.overallStatus, "not_completed");
  assert.equal(result.checks.find((check) => check.id === "python")?.status, "not_completed");
});

test("optional missing Chromium does not fail required toolchain", async (t) => {
  const root = await createRepository(t);
  const result = await runDoctor({
    root,
    platform: "win32",
    nodeVersion: "24.19.0",
    find: fakeFind,
    execute: fakeExecute(),
    chromiumProbe: () => false,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.overallStatus, "pass");
  assert.equal(result.checks.at(-1)?.status, "not_asserted");
});

test("doctor output exposes only tool ids, statuses, and safe versions", () => {
  const output = formatDoctorOutput({
    checks: [
      { id: "node", status: "pass", expected: "24.19.0", actual: "24.19.0" },
      { id: "chromium", status: "not_asserted", expected: null, actual: null },
    ],
    overallStatus: "pass",
  });
  assert.equal(
    output,
    [
      "DOCTOR_NODE_STATUS=pass",
      "DOCTOR_NODE_EXPECTED=24.19.0",
      "DOCTOR_NODE_ACTUAL=24.19.0",
      "DOCTOR_CHROMIUM_STATUS=not_asserted",
      "DOCTOR_REQUIRED_STATUS=pass",
      "",
    ].join("\n"),
  );
  assert.doesNotMatch(output, /https?:|[\\/]Users[\\/]|[\\/]home[\\/]|token|secret/iu);
});
