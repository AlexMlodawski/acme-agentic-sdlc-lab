import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import {
  assertSafeBobReviewWorkspace,
  snapshotBobReviewWorkspace,
} from "./bob-review-workspace.mjs";

const FIXTURE_PREFIX = "acme-bob-workspace-test-";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    ...options,
  });
  assert.equal(result.error, undefined);
  return result;
}

function runGit(directory, args, options = {}) {
  const result = run("git", ["-c", "core.autocrlf=false", ...args], {
    cwd: directory,
    ...options,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout.trim();
}

async function safeFixtureCleanup(directory) {
  const [temporaryRoot, canonical, metadata] = await Promise.all([
    realpath(os.tmpdir()),
    realpath(directory),
    lstat(directory),
  ]);
  const relative = path.relative(temporaryRoot, canonical);
  assert.equal(metadata.isSymbolicLink(), false);
  assert.equal(metadata.isDirectory(), true);
  assert.equal(path.dirname(relative), ".");
  assert.match(path.basename(relative), /^acme-bob-workspace-test-[A-Za-z0-9_-]+$/u);
  await rm(canonical, { recursive: true, force: true });
}

async function writeRepositoryFile(directory, relative, content) {
  const absolute = path.join(directory, ...relative.split("/"));
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

function commitAll(directory, message = "synthetic candidate") {
  runGit(directory, ["add", "--all"]);
  return commitIndex(directory, message);
}

function commitIndex(directory, message) {
  runGit(directory, [
    "-c", "user.name=Acme Test",
    "-c", "user.email=test@example.invalid",
    "commit", "-q", "-m", message,
  ]);
  return runGit(directory, ["rev-parse", "HEAD"]);
}

async function createRepository(t, extraFiles = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), FIXTURE_PREFIX));
  t.after(async () => safeFixtureCleanup(directory));
  runGit(directory, ["init", "-q", "--initial-branch=main"]);
  await writeRepositoryFile(directory, ".gitignore", ".cache/\n");
  await writeRepositoryFile(directory, "AGENTS.md", "# Public repository instructions\n\nUse fictional Acme data.\n");
  await writeRepositoryFile(directory, "README.md", "# Synthetic candidate\n");
  for (const [relative, content] of Object.entries(extraFiles)) {
    await writeRepositoryFile(directory, relative, content);
  }
  const sha = commitAll(directory);
  return { directory, sha };
}

test("accepts an exact clean candidate and the tracked root AGENTS.md", async (t) => {
  const { directory, sha } = await createRepository(t, {
    "src/value.txt": "stable\n",
  });

  const result = await assertSafeBobReviewWorkspace(directory, { expectedSha: sha });
  assert.equal(result.candidateSha, sha);
  assert.deepEqual(result.trackedFiles, [
    ".gitignore",
    "AGENTS.md",
    "README.md",
    "src/value.txt",
  ]);
  assert.equal(result.trackedFileCount, 4);
  assert.ok(result.trackedBytes > 0);
  assert.match(result.snapshotSha256, /^[0-9a-f]{64}$/u);
  assert.equal(await snapshotBobReviewWorkspace(directory), result.snapshotSha256);
});

test("binds the root AGENTS.md blob to trusted controller instructions", async (t) => {
  const trusted = await createRepository(t);
  const trustedBlob = runGit(trusted.directory, ["rev-parse", "HEAD:AGENTS.md"]);
  const changed = await createRepository(t, {
    "AGENTS.md": "# Candidate-owned replacement instructions\n",
  });
  await assert.rejects(
    assertSafeBobReviewWorkspace(changed.directory, {
      expectedSha: changed.sha,
      expectedRootAgentsBlob: trustedBlob,
    }),
    /does not match the trusted controller/u,
  );
  const accepted = await assertSafeBobReviewWorkspace(trusted.directory, {
    expectedSha: trusted.sha,
    expectedRootAgentsBlob: trustedBlob,
  });
  assert.equal(accepted.candidateSha, trusted.sha);
});

test("snapshot is deterministic across clones and excludes Git metadata", async (t) => {
  const { directory, sha } = await createRepository(t, {
    "src/binary.bin": Buffer.from([0, 1, 2, 255]),
  });
  const first = await snapshotBobReviewWorkspace(directory);
  await writeFile(path.join(directory, ".git", "snapshot-noise"), "not candidate content\n");
  assert.equal(await snapshotBobReviewWorkspace(directory), first);

  const cloneParent = await mkdtemp(path.join(os.tmpdir(), FIXTURE_PREFIX));
  t.after(async () => safeFixtureCleanup(cloneParent));
  const clone = path.join(cloneParent, "clone");
  runGit(path.dirname(directory), ["clone", "-q", "--no-local", directory, clone]);
  const cloned = await assertSafeBobReviewWorkspace(clone, { expectedSha: sha });
  assert.equal(cloned.snapshotSha256, first);
});

test("snapshot changes with tracked content but not with timestamps", async (t) => {
  const { directory } = await createRepository(t);
  const first = await snapshotBobReviewWorkspace(directory);
  const readme = path.join(directory, "README.md");
  await writeFile(readme, "# Changed synthetic candidate\n");
  const second = await snapshotBobReviewWorkspace(directory);
  assert.notEqual(second, first);
  await writeFile(readme, "# Synthetic candidate\n");
  assert.equal(await snapshotBobReviewWorkspace(directory), first);
});

test("rejects abbreviated, uppercase, and non-HEAD candidate identities", async (t) => {
  const { directory, sha } = await createRepository(t);
  await assert.rejects(
    assertSafeBobReviewWorkspace(directory, { expectedSha: sha.slice(0, 12) }),
    /exact lowercase 40-character SHA/u,
  );
  await assert.rejects(
    assertSafeBobReviewWorkspace(directory, { expectedSha: sha.toUpperCase() }),
    /exact lowercase 40-character SHA/u,
  );
  await writeRepositoryFile(directory, "CHANGE.md", "second commit\n");
  const secondSha = commitAll(directory, "second synthetic candidate");
  assert.notEqual(secondSha, sha);
  await assert.rejects(
    assertSafeBobReviewWorkspace(directory, { expectedSha: sha }),
    /does not match the exact approved SHA/u,
  );
});

test("rejects tracked and untracked workspace changes", async (t) => {
  const tracked = await createRepository(t);
  await writeFile(path.join(tracked.directory, "README.md"), "changed\n");
  await assert.rejects(
    assertSafeBobReviewWorkspace(tracked.directory, { expectedSha: tracked.sha }),
    /must be clean/u,
  );

  const untracked = await createRepository(t);
  await writeFile(path.join(untracked.directory, "untracked.txt"), "untracked\n");
  await assert.rejects(
    assertSafeBobReviewWorkspace(untracked.directory, { expectedSha: untracked.sha }),
    /must be clean/u,
  );
});

test("rejects index flags that could conceal a workspace change", async (t) => {
  const { directory, sha } = await createRepository(t);
  runGit(directory, ["update-index", "--assume-unchanged", "README.md"]);
  await writeFile(path.join(directory, "README.md"), "concealed change\n");
  await assert.rejects(
    assertSafeBobReviewWorkspace(directory, { expectedSha: sha }),
    /Assume-unchanged and skip-worktree/u,
  );
});

test("rejects ignored files and directories without treating them as candidate content", async (t) => {
  const { directory, sha } = await createRepository(t);
  await writeRepositoryFile(directory, ".cache/private.bin", Buffer.from([1, 2, 3]));
  await assert.rejects(
    assertSafeBobReviewWorkspace(directory, { expectedSha: sha }),
    /untracked or ignored directory/u,
  );
});

test("rejects candidate-owned Bob control paths case-insensitively", async (t) => {
  for (const relative of [
    ".bob/settings.json",
    ".bobrules",
    ".BOBRULES-ASK",
    "nested/.BOBIGNORE",
    ".claude/config.json",
    "deep/.Agents/config.json",
  ]) {
    await t.test(relative, async (subtest) => {
      const { directory, sha } = await createRepository(subtest, { [relative]: "{}\n" });
      await assert.rejects(
        assertSafeBobReviewWorkspace(directory, { expectedSha: sha }),
        /prohibited Bob control path/u,
      );
    });
  }
});

test("rejects AGENTS.md outside the repository root", async (t) => {
  const { directory, sha } = await createRepository(t, {
    "docs/AGENTS.md": "candidate-owned nested instructions\n",
  });
  await assert.rejects(
    assertSafeBobReviewWorkspace(directory, { expectedSha: sha }),
    /Only the tracked root AGENTS\.md/u,
  );
});

test("rejects Git-index symbolic links", async (t) => {
  const { directory } = await createRepository(t);
  const blob = runGit(directory, ["hash-object", "-w", "--stdin"], { input: "README.md" });
  runGit(directory, ["update-index", "--add", "--cacheinfo", `120000,${blob},linked-file`]);
  const sha = commitIndex(directory, "synthetic symbolic link");
  await assert.rejects(
    assertSafeBobReviewWorkspace(directory, { expectedSha: sha }),
    /Symbolic links/u,
  );
});

test("rejects Git submodules", async (t) => {
  const { directory, sha: referencedCommit } = await createRepository(t);
  runGit(directory, [
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${referencedCommit},vendor/module`,
  ]);
  const sha = commitIndex(directory, "synthetic submodule entry");
  await assert.rejects(
    assertSafeBobReviewWorkspace(directory, { expectedSha: sha }),
    /submodules/u,
  );
});

test("rejects filesystem symbolic links", { skip: process.platform === "win32" }, async (t) => {
  const { directory } = await createRepository(t);
  const link = path.join(directory, "workspace-link");
  const result = run("ln", ["-s", "README.md", link]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  await assert.rejects(snapshotBobReviewWorkspace(directory), /Symbolic links/u);
});

test("rejects special filesystem entries", { skip: process.platform === "win32" }, async (t) => {
  const { directory } = await createRepository(t);
  const fifo = path.join(directory, "workspace-fifo");
  const result = run("mkfifo", [fifo]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  await assert.rejects(snapshotBobReviewWorkspace(directory), /special entry/u);
});
