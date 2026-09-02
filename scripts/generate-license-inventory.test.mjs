import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildPythonCommandPlan,
  formatSuccess,
  generateLicenseInventory,
  resolveNodeLicense,
} from "./generate-license-inventory.mjs";

async function createFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "acme-license-inventory-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "agents", "store_support_agent"), { recursive: true });

  const packageLock = {
    name: "fixture-root",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {
      "": { name: "fixture-root", version: "1.0.0", license: "MIT" },
      "node_modules/mit-package": { version: "1.0.0", license: "MIT" },
      "node_modules/tool/node_modules/mit-package": { version: "1.0.0", license: "MIT" },
      "node_modules/lgpl-package": { version: "2.0.0", license: "LGPL-3.0-only" },
      "node_modules/missing-package": { version: "3.0.0" },
      "node_modules/lock-only-package": { version: "4.0.0", license: "MIT" },
    },
  };
  await writeFile(path.join(root, "package-lock.json"), `${JSON.stringify(packageLock, null, 2)}\n`);
  await writeFile(path.join(root, ".python-version"), "3.12.10\n");
  await writeFile(path.join(root, "agents", "store_support_agent", "uv.lock"), "version = 1\n");
  await writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "fixture-root",
    version: "1.0.0",
    license: "MIT",
  }));

  const installed = [
    ["mit-package", { name: "mit-package", version: "1.0.0", license: "MIT" }],
    ["lgpl-package", { name: "lgpl-package", version: "2.0.0", license: "LGPL-3.0-only" }],
    ["missing-package", { name: "missing-package", version: "3.0.0" }],
  ];
  for (const [name, manifest] of installed) {
    const directory = path.join(root, "node_modules", name);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "package.json"), JSON.stringify(manifest));
  }
  const duplicateDirectory = path.join(root, "node_modules", "tool", "node_modules", "mit-package");
  await mkdir(duplicateDirectory, { recursive: true });
  await writeFile(path.join(duplicateDirectory, "package.json"), JSON.stringify({
    name: "mit-package",
    version: "1.0.0",
    license: "MIT",
  }));

  return root;
}

const pythonRows = [
  { name: "py-mit", version: "1.0.0", license_expression: "MIT", license: null },
  { name: "py-lgpl", version: "2.0.0", license_expression: null, license: "LGPL-2.1-or-later" },
  { name: "py-missing", version: "3.0.0", license_expression: null, license: null },
  { name: "py_mit", version: "1.0.0", license_expression: "MIT", license: null },
];

test("generates a deterministic, deduplicated inventory for MIT, LGPL, and missing metadata", async (t) => {
  const root = await createFixture(t);
  const first = await generateLicenseInventory({ root, output: "out/first.json", pythonRows });
  const second = await generateLicenseInventory({ root, output: "out/second.json", pythonRows });
  await generateLicenseInventory({ root, output: "out/reversed.json", pythonRows: [...pythonRows].reverse() });
  const firstText = await readFile(path.join(root, "out", "first.json"), "utf8");
  const secondText = await readFile(path.join(root, "out", "second.json"), "utf8");
  const reversedText = await readFile(path.join(root, "out", "reversed.json"), "utf8");
  assert.equal(firstText, secondText);
  assert.equal(firstText, reversedText);
  assert.deepEqual(first, second);
  assert.equal(first.node_component_count, 5);
  assert.equal(first.python_component_count, 3);
  assert.equal(first.component_count, 8);
  assert.equal(first.needs_review_count, 2);

  const inventory = JSON.parse(firstText);
  assert.equal(inventory.generation_status, "pass");
  assert.equal(inventory.legal_review_status, "not_asserted");
  assert.deepEqual(inventory.summary, first);
  assert.deepEqual(
    inventory.components.map((component) => `${component.ecosystem}:${component.name}@${component.version}`),
    [...inventory.components]
      .map((component) => `${component.ecosystem}:${component.name}@${component.version}`)
      .sort(),
  );

  const nodeMit = inventory.components.find((component) => component.name === "mit-package");
  assert.deepEqual(nodeMit, {
    name: "mit-package",
    version: "1.0.0",
    ecosystem: "npm",
    license_expression: "MIT",
    license_source: "installed_package_json",
    needs_review: false,
  });
  assert.equal(inventory.components.filter((component) => component.name === "mit-package").length, 1);
  assert.equal(
    inventory.components.find((component) => component.name === "lgpl-package")?.license_expression,
    "LGPL-3.0-only",
  );
  assert.equal(
    inventory.components.find((component) => component.name === "py-lgpl")?.license_expression,
    "LGPL-2.1-or-later",
  );
  for (const name of ["missing-package", "py-missing"]) {
    const component = inventory.components.find((item) => item.name === name);
    assert.equal(component?.license_expression, null);
    assert.equal(component?.license_source, "not_declared");
    assert.equal(component?.needs_review, true);
  }
  assert.doesNotMatch(firstText, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.doesNotMatch(firstText, /https?:|fixture-secret|token=/iu);
});

test("does not guess ambiguous or conflicting Node license metadata", () => {
  assert.deepEqual(resolveNodeLicense("LGPL", "LGPL"), {
    license_expression: null,
    license_source: "ambiguous_node_metadata",
    needs_review: true,
  });
  assert.deepEqual(resolveNodeLicense("MIT", "Apache-2.0"), {
    license_expression: null,
    license_source: "conflicting_node_metadata",
    needs_review: true,
  });
});

test("Python command is exact, offline, frozen, and cannot sync or download", () => {
  const plan = buildPythonCommandPlan("3.12.10");
  assert.deepEqual(plan.args.slice(0, 9), [
    "run",
    "--project",
    "agents/store_support_agent",
    "--offline",
    "--frozen",
    "--no-sync",
    "--python",
    "3.12.10",
    "python",
  ]);
  assert.equal(plan.args.at(-1), "3.12.10");
  assert.match(plan.args.at(-2), /sys\.version_info\[:3\] != expected/u);
  assert.throws(() => buildPythonCommandPlan("3.11.9"), /exact Python 3\.12/u);
});

test("refuses lockfiles, existing outputs, and paths outside the repository", async (t) => {
  const root = await createFixture(t);
  await assert.rejects(
    generateLicenseInventory({ root, output: "package-lock.json", pythonRows }),
    /lockfile|already exists/u,
  );
  await assert.rejects(
    generateLicenseInventory({ root, output: "agents/store_support_agent/uv.lock", pythonRows }),
    /lockfile|already exists/u,
  );
  await writeFile(path.join(root, "existing.json"), "keep\n");
  await assert.rejects(
    generateLicenseInventory({ root, output: "existing.json", pythonRows }),
    /already exists/u,
  );
  assert.equal(await readFile(path.join(root, "existing.json"), "utf8"), "keep\n");
  await assert.rejects(
    generateLicenseInventory({ root, output: "../outside.json", pythonRows }),
    /inside the repository/u,
  );
});

test("CLI success output contains counts and separates generation from legal review", () => {
  const output = formatSuccess({
    node_component_count: 4,
    python_component_count: 3,
    component_count: 7,
    needs_review_count: 2,
  });
  assert.equal(output, [
    "LICENSE_INVENTORY_NODE_COMPONENTS=4",
    "LICENSE_INVENTORY_PYTHON_COMPONENTS=3",
    "LICENSE_INVENTORY_COMPONENTS=7",
    "LICENSE_INVENTORY_NEEDS_REVIEW=2",
    "LICENSE_INVENTORY_GENERATION_STATUS=pass",
    "LICENSE_LEGAL_REVIEW_STATUS=not_asserted",
    "",
  ].join("\n"));
  assert.doesNotMatch(output, /LEGAL_REVIEW_STATUS=pass/u);
});
