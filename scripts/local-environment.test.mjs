import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertSecretFreeLocalEnvironment,
  findRuntimeEnvFiles,
} from "./local-environment.mjs";

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "acme-local-environment-"));
  mkdirSync(path.join(root, "apps", "portal"), { recursive: true });
  mkdirSync(path.join(root, "services", "support-api"), { recursive: true });
  return root;
}

test("allows an example file but no runtime environment files", (context) => {
  const root = fixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, ".env.example"), "SAFE_EXAMPLE=value\n", "utf8");

  assert.deepEqual(findRuntimeEnvFiles(root), []);
  assert.doesNotThrow(() => assertSecretFreeLocalEnvironment(root));
});

test("rejects ignored environment files at the root or either service", (context) => {
  const root = fixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, ".ENV"), "LOCAL_ONLY=value\n", "utf8");
  writeFileSync(path.join(root, "apps", "portal", ".Env.Production"), "PORTAL=value\n", "utf8");
  writeFileSync(path.join(root, "services", "support-api", ".env.development.local"), "API=value\n", "utf8");

  assert.deepEqual(findRuntimeEnvFiles(root), [
    ".ENV",
    "apps/portal/.Env.Production",
    "services/support-api/.env.development.local",
  ]);
  assert.throws(
    () => assertSecretFreeLocalEnvironment(root),
    /zero-secret local profile refuses runtime environment files/u,
  );
});

test("requires an absolute project root", () => {
  assert.throws(() => findRuntimeEnvFiles("relative"), /absolute path/u);
});
