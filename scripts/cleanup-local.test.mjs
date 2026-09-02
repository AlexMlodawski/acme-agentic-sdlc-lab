import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertContained,
  cleanupLocal,
  parseCleanupArguments,
} from "./cleanup-local.mjs";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    ...options,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${result.stdout ?? ""}${result.stderr ?? ""}`);
}

async function syntheticRepository(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "acme-cleanup-test-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await writeFile(
    path.join(root, "package.json"),
    '{"name":"acme-agentic-sdlc-lab"}\n',
  );
  run("git", ["init", "-q"], { cwd: root });
  run("git", ["config", "user.name", "Acme Cleanup Test"], { cwd: root });
  run("git", ["config", "user.email", "cleanup-test@acme.example"], { cwd: root });
  run("git", ["add", "package.json"], { cwd: root });
  run("git", ["commit", "-q", "-m", "initialize cleanup fixture"], { cwd: root });
  return root;
}

test("cleanup CLI requires an exact mode and confirmation", () => {
  assert.deepEqual(
    parseCleanupArguments(["--mode", "reset", "--confirm"]),
    { mode: "reset", confirm: true },
  );
  assert.throws(() => parseCleanupArguments(["--mode", "reset"]), /--confirm/u);
  assert.deepEqual(
    parseCleanupArguments(["--mode", "evidence", "--confirm"]),
    { mode: "evidence", confirm: true },
  );
  assert.throws(
    () => parseCleanupArguments(["--mode", "purge", "--confirm"]),
    /reset, uninstall, or evidence/u,
  );
  assert.throws(() => parseCleanupArguments(["--confirm", "--unexpected"]), /Unknown/u);
});

test("containment rejects the repository root and path traversal", async (t) => {
  const root = await syntheticRepository(t);
  assert.throws(() => assertContained(root, root), /strictly contained/u);
  assert.throws(() => assertContained(root, path.join(root, "..", "outside")), /strictly contained/u);
  assert.equal(assertContained(root, path.join(root, "dist")), path.join(root, "dist"));
});

test("cleanup rejects a nested lookalike that is not the actual Git root", async (t) => {
  const root = await syntheticRepository(t);
  const nested = path.join(root, "nested");
  await mkdir(nested);
  await writeFile(path.join(nested, "package.json"), '{"name":"acme-agentic-sdlc-lab"}\n');
  await assert.rejects(
    cleanupLocal({ root: nested, mode: "reset", confirm: true }),
    /actual Git repository root/u,
  );
});

test("reset removes only known generated targets and preserves dependencies", async (t) => {
  const root = await syntheticRepository(t);
  await mkdir(path.join(root, "services", "support-api", "dist"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "kept"), { recursive: true });
  await mkdir(path.join(root, "release-evidence", "candidate"), { recursive: true });
  await writeFile(path.join(root, "services", "support-api", "dist", "server.js"), "generated\n");
  await writeFile(path.join(root, "node_modules", "kept", "index.js"), "dependency\n");
  await writeFile(path.join(root, "release-evidence", "candidate", "summary.json"), "{}\n");
  await writeFile(path.join(root, "source.txt"), "source\n");

  const result = await cleanupLocal({ root, mode: "reset", confirm: true });
  assert.deepEqual(result.removed, ["services/support-api/dist"]);
  assert.equal(await readFile(path.join(root, "source.txt"), "utf8"), "source\n");
  assert.equal(await readFile(path.join(root, "node_modules", "kept", "index.js"), "utf8"), "dependency\n");
  assert.equal(
    await readFile(path.join(root, "release-evidence", "candidate", "summary.json"), "utf8"),
    "{}\n",
  );
});

test("uninstall removes known dependency state and preserves source", async (t) => {
  const root = await syntheticRepository(t);
  await mkdir(path.join(root, "node_modules"), { recursive: true });
  await mkdir(path.join(root, "agents", "store_support_agent", ".venv"), { recursive: true });
  await mkdir(path.join(root, "release-evidence", "candidate"), { recursive: true });
  await writeFile(path.join(root, "node_modules", "package.txt"), "generated\n");
  await writeFile(path.join(root, "README.md"), "source\n");
  await writeFile(path.join(root, "release-evidence", "candidate", "summary.json"), "{}\n");

  const result = await cleanupLocal({ root, mode: "uninstall", confirm: true });
  assert.deepEqual(
    result.removed,
    ["agents/store_support_agent/.venv", "node_modules"],
  );
  assert.equal(await readFile(path.join(root, "README.md"), "utf8"), "source\n");
  assert.equal(
    await readFile(path.join(root, "release-evidence", "candidate", "summary.json"), "utf8"),
    "{}\n",
  );
});

test("evidence cleanup is an explicit separate mode", async (t) => {
  const root = await syntheticRepository(t);
  await mkdir(path.join(root, "release-evidence", "candidate"), { recursive: true });
  await writeFile(path.join(root, "release-evidence", "candidate", "summary.json"), "{}\n");

  const result = await cleanupLocal({ root, mode: "evidence", confirm: true });
  assert.deepEqual(result.removed, ["release-evidence"]);
  await assert.rejects(
    readFile(path.join(root, "release-evidence", "candidate", "summary.json"), "utf8"),
    (error) => error?.code === "ENOENT",
  );
});

test("tracked content under an allowlisted target blocks every removal", async (t) => {
  const root = await syntheticRepository(t);
  await mkdir(path.join(root, "coverage"), { recursive: true });
  await writeFile(path.join(root, "coverage", "tracked.txt"), "keep\n");
  await mkdir(path.join(root, "apps", "portal", ".next"), { recursive: true });
  await writeFile(path.join(root, "apps", "portal", ".next", "generated.txt"), "keep too\n");
  run("git", ["add", "-f", "coverage/tracked.txt"], { cwd: root });
  run("git", ["commit", "-q", "-m", "track protected fixture"], { cwd: root });

  await assert.rejects(
    cleanupLocal({
      root,
      mode: "reset",
      confirm: true,
      environment: {
        ...process.env,
        GIT_CONFIG_GLOBAL: path.join(root, "missing-global-config"),
        GIT_DIR: path.join(root, "missing-git-dir"),
        GIT_INDEX_FILE: path.join(root, "missing-index"),
        GIT_WORK_TREE: root,
      },
    }),
    /tracked source/u,
  );
  assert.equal(await readFile(path.join(root, "coverage", "tracked.txt"), "utf8"), "keep\n");
  assert.equal(
    await readFile(path.join(root, "apps", "portal", ".next", "generated.txt"), "utf8"),
    "keep too\n",
  );
});
