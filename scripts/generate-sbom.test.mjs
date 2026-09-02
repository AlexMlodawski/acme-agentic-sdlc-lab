import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const generator = fileURLToPath(new URL("./generate-sbom.mjs", import.meta.url));

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

async function createFixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "acme-sbom-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "agents", "store_support_agent"), { recursive: true });
  await copyFile(generator, path.join(directory, "generate.mjs"));

  const sha512 = Buffer.alloc(64, 0xab).toString("base64");
  const unsafeResolved = `https://${"fixture-user"}:${"fixture-password"}@${"packages" + ".corp"}/unsafe.tgz`;
  const packageLock = {
    name: "acme-fixture",
    version: "1.2.3",
    lockfileVersion: 3,
    packages: {
      "": {
        name: "acme-fixture",
        version: "1.2.3",
        license: "Apache-2.0",
        workspaces: ["apps/portal"],
      },
      "apps/portal": {
        name: "@acme/portal",
        version: "1.2.3",
        license: "Apache-2.0",
      },
      "node_modules/left-pad": {
        version: "1.3.0",
        resolved: "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz",
        integrity: `sha512-${sha512}`,
        license: "MIT",
      },
      "node_modules/tool/node_modules/left-pad": {
        version: "1.3.0",
        resolved: "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz",
        integrity: `sha512-${sha512}`,
        license: "MIT",
      },
      "node_modules/unsafe-package": {
        version: "4.5.6",
        resolved: unsafeResolved,
        integrity: `sha512-${sha512}`,
        license: "MIT",
      },
    },
  };
  await writeFile(
    path.join(directory, "package-lock.json"),
    `${JSON.stringify(packageLock, null, 2)}\n`,
  );

  const pythonHash = "cd".repeat(32);
  const unsafeArtifact = `https://${"fixture-user"}:${"fixture-password"}@${"packages" + ".corp"}/private.whl`;
  const uvLock = [
    "version = 1",
    "",
    "[[package]]",
    'name = "python-demo"',
    'version = "2.0.0"',
    'source = { registry = "https://pypi.org/simple" }',
    `sdist = { url = "https://files.pythonhosted.org/packages/python-demo-2.0.0.tar.gz", hash = "sha256:${pythonHash}", size = 1 }`,
    "",
    "[[package]]",
    'name = "local-agent"',
    'version = "1.2.3"',
    'source = { virtual = "." }',
    "",
    "[[package]]",
    'name = "private-source-fixture"',
    'version = "3.0.0"',
    `source = { registry = "https://${"packages" + ".corp"}/simple" }`,
    `sdist = { url = "${unsafeArtifact}", hash = "sha256:${pythonHash}", size = 1 }`,
    "",
  ].join("\n");
  await writeFile(path.join(directory, "agents", "store_support_agent", "uv.lock"), uvLock);
  return { directory, pythonHash, unsafeArtifact, unsafeResolved };
}

function generate(directory, output) {
  return run(process.execPath, ["generate.mjs", "--output", output], { cwd: directory });
}

test("creates a deterministic combined CycloneDX 1.6 BOM without network input", async (t) => {
  const { directory, pythonHash, unsafeArtifact, unsafeResolved } = await createFixture(t);
  const first = generate(directory, "out/first.cdx.json");
  const second = generate(directory, "out/second.cdx.json");
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.equal(first.stderr, "");
  assert.match(first.stdout, /SBOM_GENERATION=PASS/u);
  assert.doesNotMatch(first.stdout, /first\.cdx|acme-sbom-/u);

  const firstText = await readFile(path.join(directory, "out", "first.cdx.json"), "utf8");
  const secondText = await readFile(path.join(directory, "out", "second.cdx.json"), "utf8");
  assert.equal(firstText, secondText);
  assert.doesNotMatch(firstText, new RegExp(unsafeResolved.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.doesNotMatch(firstText, new RegExp(unsafeArtifact.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.doesNotMatch(firstText, new RegExp(directory.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));

  const bom = JSON.parse(firstText);
  assert.equal(bom.bomFormat, "CycloneDX");
  assert.equal(bom.specVersion, "1.6");
  assert.equal(bom.version, 1);
  assert.equal(bom.metadata.component.name, "acme-fixture");
  assert.equal(bom.metadata.component.version, "1.2.3");
  assert.equal(new Set(bom.components.map((item) => item["bom-ref"])).size, bom.components.length);

  const leftPad = bom.components.find((item) => item.purl === "pkg:npm/left-pad@1.3.0");
  assert.ok(leftPad);
  assert.deepEqual(leftPad.hashes, [{ alg: "SHA-512", content: "ab".repeat(64) }]);
  assert.deepEqual(leftPad.externalReferences, [{
    type: "distribution",
    url: "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz",
  }]);
  assert.equal(bom.components.filter((item) => item.purl === leftPad.purl).length, 1);

  const workspace = bom.components.find((item) => item.name === "@acme/portal");
  assert.equal(workspace?.type, "application");
  assert.equal(workspace?.purl, "pkg:npm/%40acme/portal@1.2.3");

  const pythonDemo = bom.components.find((item) => item.purl === "pkg:pypi/python-demo@2.0.0");
  assert.ok(pythonDemo);
  assert.deepEqual(pythonDemo.externalReferences, [{
    type: "distribution",
    url: "https://files.pythonhosted.org/packages/python-demo-2.0.0.tar.gz",
    hashes: [{ alg: "SHA-256", content: pythonHash }],
  }]);
  assert.equal(bom.components.find((item) => item.name === "local-agent")?.type, "application");
  assert.equal(
    bom.components.find((item) => item.name === "private-source-fixture")?.externalReferences,
    undefined,
  );

  for (const item of [bom.metadata.component, ...bom.components]) {
    assert.match(item.type, /^(application|library)$/u);
    assert.equal(typeof item.name, "string");
    assert.equal(typeof item.version, "string");
    assert.equal(item["bom-ref"], item.purl);
    for (const hash of item.hashes ?? []) assert.match(hash.content, /^[0-9a-f]+$/u);
  }
});

test("refuses to overwrite either lockfile", async (t) => {
  const { directory } = await createFixture(t);
  const before = await readFile(path.join(directory, "package-lock.json"), "utf8");
  const result = generate(directory, "package-lock.json");
  const after = await readFile(path.join(directory, "package-lock.json"), "utf8");

  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.equal(result.stdout.trim(), "SBOM_GENERATION=FAIL");
  assert.equal(result.stderr, "");
  assert.equal(after, before);
});

test("refuses traversal, protected directories, and any existing output", async (t) => {
  const { directory } = await createFixture(t);
  const outside = path.resolve(directory, "..", "outside-sbom.json");
  assert.equal(generate(directory, outside).status, 2);
  assert.equal(generate(directory, ".git/sbom.json").status, 2);
  await writeFile(path.join(directory, "existing.json"), "preserve\n");
  assert.equal(generate(directory, "existing.json").status, 2);
  assert.equal(await readFile(path.join(directory, "existing.json"), "utf8"), "preserve\n");
});
