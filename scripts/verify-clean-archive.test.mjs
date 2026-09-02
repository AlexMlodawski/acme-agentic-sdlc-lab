import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  archiveSourcePathWithinBudget,
  isStrictlyContained,
  parseTreeManifest,
  resolveNpmInvocation,
  verifyCleanArchive,
  verifyExtractedTree,
} from "./verify-clean-archive.mjs";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    ...options,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${result.stdout ?? ""}${result.stderr ?? ""}`);
  return result;
}

async function createFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "acme-archive-verify-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const manifest = {
    name: "acme-agentic-sdlc-lab",
    version: "0.1.0",
    private: true,
    license: "Apache-2.0",
    scripts: {
      verify: "node -e \"process.stdout.write('verify-pass')\"",
      "e2e:local": "node -e \"process.stdout.write('local-pass')\"",
      "e2e:built": "node -e \"process.stdout.write('built-pass')\"",
      reset: "node -e \"process.stdout.write('reset-pass')\"",
      "uninstall:project": "node -e \"process.stdout.write('uninstall-pass')\"",
    },
  };
  const lock = {
    name: manifest.name,
    version: manifest.version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: manifest.name,
        version: manifest.version,
        license: manifest.license,
      },
    },
  };
  await writeFile(path.join(root, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(root, "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
  await writeFile(
    path.join(root, ".gitignore"),
    "clean-archive-verify.json\nnode_modules/\nrelease-evidence/\n",
  );
  await writeFile(path.join(root, "README.md"), "Synthetic archive verification fixture.\n");
  run("git", ["init", "-q"], { cwd: root });
  run("git", ["config", "user.name", "Acme Archive Test"], { cwd: root });
  run("git", ["config", "user.email", "archive-test@acme.example"], { cwd: root });
  run("git", ["config", "commit.gpgsign", "false"], { cwd: root });
  run("git", ["add", "--all"], { cwd: root });
  run("git", ["commit", "-q", "-m", "test archive verification"], { cwd: root });
  return root;
}

test("containment rejects equality and prefix collisions", () => {
  const root = path.resolve("safe-root");
  assert.equal(isStrictlyContained(root, path.join(root, "child")), true);
  assert.equal(isStrictlyContained(root, root), false);
  assert.equal(isStrictlyContained(root, `${root}-collision`), false);
});

test("Windows archive source paths have a conservative length budget", () => {
  assert.equal(archiveSourcePathWithinBudget("C:\\Temp\\acme-av-123456", "win32"), true);
  assert.equal(
    archiveSourcePathWithinBudget(`C:\\${"deep\\".repeat(30)}acme-av-123456`, "win32"),
    false,
  );
  assert.equal(archiveSourcePathWithinBudget("/an/arbitrarily/long/non-windows/path", "linux"), true);
});

test("tree manifest accepts regular portable files and rejects unsafe entries", () => {
  const objectId = "a".repeat(40);
  assert.deepEqual(
    parseTreeManifest(Buffer.from(`100644 blob ${objectId}     4\tREADME.md\0`, "utf8")),
    [{ path: "README.md", mode: "100644", objectId, size: 4 }],
  );
  for (const fixture of [
    `120000 blob ${objectId}     4\tlink\0`,
    `100644 blob ${objectId}     4\t../escape\0`,
    `100644 blob ${objectId}     4\tdir\\file\0`,
    `100644 blob ${objectId}     4\tCON.txt\0`,
    `100644 blob ${objectId}     4\tname.\0`,
    `100644 blob ${objectId}     4\tReadme.md\u0000100644 blob ${objectId}     4\tREADME.md\0`,
  ]) {
    assert.throws(() => parseTreeManifest(Buffer.from(fixture, "utf8")));
  }
});

test("Windows npm fallback is explicit and does not use a shell string", () => {
  assert.deepEqual(
    resolveNpmInvocation(["run", "verify"], {
      environment: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      platform: "win32",
      nodeExecutable: "C:\\node.exe",
    }),
    {
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "npm.cmd", "run", "verify"],
    },
  );
});

test("same-size extracted content substitution fails the Git object check", async (t) => {
  const root = await createFixture(t);
  const extracted = await mkdtemp(path.join(os.tmpdir(), "acme-archive-content-"));
  t.after(async () => rm(extracted, { recursive: true, force: true }));
  await writeFile(path.join(extracted, "README.md"), "evil");
  const hash = spawnSync("git", ["hash-object", "--stdin"], {
    cwd: root,
    encoding: "utf8",
    input: "good",
    shell: false,
    windowsHide: true,
  });
  assert.equal(hash.status, 0);
  await assert.rejects(
    verifyExtractedTree(extracted, [{
      path: "README.md",
      size: 4,
      mode: "100644",
      objectId: hash.stdout.trim(),
    }], root),
    /content hash/u,
  );
});

test("verifies an exact clean synthetic archive and removes owned temporary state", async (t) => {
  const root = await createFixture(t);
  const result = await verifyCleanArchive({ root });
  assert.equal(result.verification_status, "pass");
  assert.match(result.source_sha, /^[0-9a-f]{40}$/u);
  assert.match(result.archive_sha256, /^[0-9a-f]{64}$/u);
  assert.equal(result.tracked_file_count, 4);
  assert.deepEqual(result.profiles_verified, ["local-development", "production-build"]);
  assert.deepEqual(result.lifecycle_verified, ["install", "verify", "reset", "uninstall"]);
  const report = JSON.parse(await readFile(path.join(root, "clean-archive-verify.json"), "utf8"));
  assert.deepEqual(report, result);
  const status = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  assert.equal(status.status, 0);
  assert.equal(status.stdout, "");
  await assert.rejects(
    lstat(path.join(root, "release-evidence")),
    (error) => error?.code === "ENOENT",
  );
});

test("dirty source and an existing report fail before archive commands", async (t) => {
  const dirtyRoot = await createFixture(t);
  await writeFile(path.join(dirtyRoot, "README.md"), "Dirty fixture.\n");
  await assert.rejects(verifyCleanArchive({ root: dirtyRoot }), /clean/u);

  const reportRoot = await createFixture(t);
  await writeFile(path.join(reportRoot, "clean-archive-verify.json"), "{}\n");
  await assert.rejects(verifyCleanArchive({ root: reportRoot }), /already exists/u);
});

test("rejects replacement refs before archiving an apparently clean SHA", async (t) => {
  const root = await createFixture(t);
  const head = run("git", ["rev-parse", "HEAD"], { cwd: root }).stdout.trim();
  const tree = run("git", ["rev-parse", "HEAD^{tree}"], { cwd: root }).stdout.trim();
  const replacement = run("git", ["commit-tree", tree, "-m", "synthetic replacement"], {
    cwd: root,
  }).stdout.trim();
  run("git", ["replace", head, replacement], { cwd: root });

  await assert.rejects(verifyCleanArchive({ root }), /replacement refs/u);
  await assert.rejects(
    readFile(path.join(root, "clean-archive-verify.json"), "utf8"),
    (error) => error?.code === "ENOENT",
  );
});

test("rejects grafted and shallow source graphs", async (t) => {
  const graftedRoot = await createFixture(t);
  const graftedHead = run("git", ["rev-parse", "HEAD"], { cwd: graftedRoot }).stdout.trim();
  await writeFile(path.join(graftedRoot, ".git", "info", "grafts"), `${graftedHead}\n`);
  await assert.rejects(verifyCleanArchive({ root: graftedRoot }), /graft file/u);

  const source = await createFixture(t);
  await writeFile(path.join(source, "README.md"), "Synthetic second commit.\n");
  run("git", ["add", "--all"], { cwd: source });
  run("git", ["commit", "-q", "-m", "second archive fixture"], { cwd: source });
  const cloneParent = await mkdtemp(path.join(os.tmpdir(), "acme-archive-shallow-"));
  t.after(async () => rm(cloneParent, { recursive: true, force: true }));
  const shallowRoot = path.join(cloneParent, "clone");
  run("git", ["clone", "-q", "--depth", "1", pathToFileURL(source).href, shallowRoot]);
  await assert.rejects(verifyCleanArchive({ root: shallowRoot }), /shallow/u);
});

test("does not publish a pass report when owned temporary cleanup fails", async (t) => {
  const root = await createFixture(t);
  const systemTemporaryRoot = await realpath(os.tmpdir());
  const cleanupParent = await mkdtemp(path.join(systemTemporaryRoot, "acme-archive-cleanup-test-"));
  let capturedWork;
  t.after(async () => {
    const metadata = await lstat(cleanupParent);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("test cleanup parent is unsafe");
    }
    const actualCleanupParent = await realpath(cleanupParent);
    if (
      path.resolve(actualCleanupParent).toLowerCase() !== path.resolve(cleanupParent).toLowerCase()
      || !isStrictlyContained(systemTemporaryRoot, actualCleanupParent)
    ) {
      throw new Error("test cleanup parent changed");
    }
    await rm(actualCleanupParent, { recursive: true, force: false, maxRetries: 3 });
  });
  await assert.rejects(
    verifyCleanArchive({
      root,
      temporaryDirectory: cleanupParent,
      cleanupRun: async (workRoot, runDirectory) => {
        capturedWork = { workRoot, runDirectory };
        throw new Error("synthetic cleanup failure");
      },
    }),
    /cleanup failure/u,
  );
  await assert.rejects(
    readFile(path.join(root, "clean-archive-verify.json"), "utf8"),
    (error) => error?.code === "ENOENT",
  );
  assert.notEqual(capturedWork, undefined);
  assert.equal(capturedWork.workRoot, cleanupParent);
  assert.equal(isStrictlyContained(capturedWork.workRoot, capturedWork.runDirectory), true);
  assert.equal(isStrictlyContained(root, capturedWork.runDirectory), false);
});
