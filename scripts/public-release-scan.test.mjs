import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  containsAbsoluteUserPath,
  containsHighConfidenceSecret,
  containsOpaqueProviderCredential,
} from "./content-policy.mjs";

const scanner = fileURLToPath(new URL("./public-release-scan.mjs", import.meta.url));
const documentationScanner = fileURLToPath(new URL("./documentation-scan.mjs", import.meta.url));
const contentPolicy = fileURLToPath(new URL("./content-policy.mjs", import.meta.url));

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

async function createRepository(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "acme-release-scan-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  await copyFile(scanner, path.join(directory, "scan.mjs"));
  await copyFile(documentationScanner, path.join(directory, "documentation-scan.mjs"));
  await copyFile(contentPolicy, path.join(directory, "content-policy.mjs"));
  assert.equal(run("git", ["init", "-q"], { cwd: directory }).status, 0);
  return directory;
}

async function addAll(directory) {
  assert.equal(run("git", ["add", "--all"], { cwd: directory }).status, 0);
}

function scan(directory, options = {}) {
  return run(process.execPath, [path.join(directory, "scan.mjs")], {
    cwd: directory,
    ...options,
  });
}

test("scans every tracked regular file, including extensionless and example files", async (t) => {
  const directory = await createRepository(t);
  await writeFile(path.join(directory, "README"), "safe extensionless content\n");
  await writeFile(path.join(directory, ".env.example"), "TOKEN=<load-at-runtime>\n");
  await writeFile(path.join(directory, "uv.lock"), "version = 1\n");
  await addAll(directory);

  const result = scan(directory);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /SECRET_SCAN=PASS/u);
  assert.match(result.stdout, /UNSCANNED_FILE_SCAN=PASS/u);
});

test("ignores ambient Git routing variables and rejects a non-root working directory", async (t) => {
  const directory = await createRepository(t);
  await writeFile(path.join(directory, "README.md"), "Synthetic safe content.\n");
  await addAll(directory);
  const result = scan(directory, {
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: path.join(directory, "missing-global-config"),
      GIT_DIR: path.join(directory, "missing-git-dir"),
      GIT_INDEX_FILE: path.join(directory, "missing-index"),
      GIT_NAMESPACE: "synthetic-namespace",
      GIT_OBJECT_DIRECTORY: path.join(directory, "missing-objects"),
      GIT_WORK_TREE: path.join(directory, "missing-work-tree"),
    },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /SECRET_SCAN=PASS/u);

  const subdirectory = path.join(directory, "subdirectory");
  await mkdir(subdirectory);
  const wrongRoot = run(process.execPath, [path.join(directory, "scan.mjs")], {
    cwd: subdirectory,
  });
  assert.equal(wrongRoot.status, 2);
  assert.equal(wrongRoot.stdout.trim(), "RELEASE_SCAN_ERROR=FAIL");
  assert.equal(wrongRoot.stderr, "");
});

test("rejects a synthetic secret in an extensionless file without disclosing it", async (t) => {
  const directory = await createRepository(t);
  const syntheticSecret = "ghp_" + "A".repeat(30);
  await writeFile(path.join(directory, "payload"), syntheticSecret);
  await addAll(directory);

  const result = scan(directory);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /SECRET_SCAN=FAIL/u);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(syntheticSecret, "u"));
});

test("rejects additional high-confidence provider credential formats", async (t) => {
  const directory = await createRepository(t);
  const syntheticSecret = "npm_" + "B".repeat(30);
  await writeFile(path.join(directory, "payload.txt"), syntheticSecret);
  await addAll(directory);

  const result = scan(directory);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /SECRET_SCAN=FAIL/u);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(syntheticSecret, "u"));
});

test("rejects synthetic IBM Bob credentials without disclosing them", async (t) => {
  const directory = await createRepository(t);
  const bobPrefix = ["bob", "prod", "bob-apikey"].join("_") + "_";
  const rawSecret = bobPrefix + "D".repeat(64);
  const assignedSecret = bobPrefix + "E".repeat(64);
  const bobApiKeyName = ["BOB", "API", "KEY"].join("_");
  const wxoApiKeyName = ["WXO", "API", "KEY"].join("_");
  assert.equal(containsHighConfidenceSecret(rawSecret), true);
  assert.equal(
    containsOpaqueProviderCredential(`${bobApiKeyName}=${assignedSecret}`),
    true,
  );
  assert.equal(
    containsOpaqueProviderCredential(`{ ${bobApiKeyName}: apiKey }`),
    false,
  );
  assert.equal(containsOpaqueProviderCredential(`{ ${wxoApiKeyName}: apiKey }`), true);
  await writeFile(path.join(directory, "raw-bob-credential.txt"), `${rawSecret}\n`);
  await writeFile(
    path.join(directory, "assigned-bob-credential.txt"),
    `${bobApiKeyName}=${assignedSecret}\n`,
  );
  await addAll(directory);

  const result = scan(directory);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /SECRET_SCAN=FAIL/u);
  for (const secret of [rawSecret, assignedSecret]) {
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret, "u"));
  }
});

test("rejects a synthetic GitLab token and generated release evidence", async (t) => {
  const directory = await createRepository(t);
  const syntheticSecret = "glpat-" + "C".repeat(30);
  await writeFile(path.join(directory, "payload.txt"), syntheticSecret);
  await writeFile(path.join(directory, "sbom.cdx.json"), "{}\n");
  await addAll(directory);

  const result = scan(directory);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /SECRET_SCAN=FAIL/u);
  assert.match(result.stdout, /FORBIDDEN_FILE_SCAN=FAIL/u);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(syntheticSecret, "u"));
});

test("rejects credential files and private references in lock files", async (t) => {
  const directory = await createRepository(t);
  await writeFile(path.join(directory, "client.pem"), "synthetic placeholder\n");
  await writeFile(
    path.join(directory, "uv.lock"),
    "source = \"http://" + "localhost:" + "3005/package\"\n",
  );
  await addAll(directory);

  const result = scan(directory);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FORBIDDEN_FILE_SCAN=FAIL/u);
  assert.match(result.stdout, /PRIVATE_INFRA_REFERENCE_SCAN=FAIL/u);
});

test("enforces path and content policy without case-sensitive or dotfile gaps", async (t) => {
  const directory = await createRepository(t);
  const wxoName = ["WXO", "API", "KEY"].join("_");
  const instanaName = ["INSTANA", "AGENT", "KEY"].join("_");
  const opaqueWxoValue = ["opaque", "wxo", "fixture", "value"].join("-");
  const opaqueInstanaValue = ["opaque", "instana", "fixture", "value"].join("-");
  const lowercaseUserPath = ["c:", "users", "fixture-user", "asset.txt"].join("\\");
  const legacyUserPath = ["D:", "Documents and Settings", "fixture-user", "asset.txt"].join("\\");
  const rootUserPath = ["", "root", "fixture-user", "asset.txt"].join("/");
  const uncUserPath = ["", "", "synthetic-host", "private-share", "asset.txt"].join("\\");
  const uppercasePrivateMarker = ["BOB-ECOSYSTEM", "SHOWCASE"].join("-");

  await writeFile(path.join(directory, ".ENV"), `${wxoName}=${opaqueWxoValue}\n`);
  await writeFile(
    path.join(directory, "credentials.json"),
    `${JSON.stringify({ [instanaName]: opaqueInstanaValue })}\n`,
  );
  await writeFile(path.join(directory, ".npmrc"), "synthetic placeholder\n");
  await mkdir(path.join(directory, "Showcase"));
  await writeFile(path.join(directory, "Showcase", "README.md"), "Synthetic fixture.\n");
  await writeFile(
    path.join(directory, "README.md"),
    `${lowercaseUserPath}\n${legacyUserPath}\n${rootUserPath}\n${uncUserPath}\n${uppercasePrivateMarker}\n`,
  );
  await addAll(directory);

  const result = scan(directory);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /SECRET_SCAN=FAIL/u);
  assert.match(result.stdout, /ABSOLUTE_USER_PATH_SCAN=FAIL/u);
  assert.match(result.stdout, /PRIVATE_INFRA_REFERENCE_SCAN=FAIL/u);
  assert.match(result.stdout, /FORBIDDEN_FILE_SCAN=FAIL/u);
  for (const sensitiveValue of [
    opaqueWxoValue,
    opaqueInstanaValue,
    lowercaseUserPath,
    legacyUserPath,
    rootUserPath,
    uncUserPath,
  ]) {
    assert.equal(
      (result.stdout + result.stderr).toLowerCase().includes(sensitiveValue.toLowerCase()),
      false,
    );
  }
});

test("rejects opaque credentials in declarations, environment access, commands, and headers", async (t) => {
  const directory = await createRepository(t);
  const wxoName = ["WXO", "API", "KEY"].join("_");
  const instanaName = ["INSTANA", "AGENT", "KEY"].join("_");
  const supportName = ["SUPPORT", "API", "TOKEN"].join("_");
  const connectionName = ["WXO", "CONNECTION", "ACME", "SUPPORT", "API", "API", "TOKEN"].join("_");
  const apiTokenField = ["api", "token"].join("_");
  const instanaHeader = ["x", "instana", "key"].join("-");
  const authorizationHeader = ["Author", "ization"].join("");
  const opaqueValues = [
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven",
  ].map(
    (value) => ["opaque", value, "fixture", "value"].join("-"),
  );
  await writeFile(path.join(directory, "settings.txt"), [
    `const ${wxoName} = "${opaqueValues[0]}";`,
    `process.env.${instanaName} = "${opaqueValues[1]}";`,
    `setx ${supportName} ${opaqueValues[2]}`,
    `${instanaHeader}: ${opaqueValues[3]}`,
    `${authorizationHeader}: Bearer ${opaqueValues[4]}`,
    `${connectionName} = "${opaqueValues[5]}";`,
    `${apiTokenField}: "${opaqueValues[6]}"`,
    `headers.set("${instanaHeader}", "${opaqueValues[7]}");`,
    `headers.set("${authorizationHeader}", "Bearer ${opaqueValues[8]}");`,
    `process.env["${wxoName}"] = "${opaqueValues[9]}";`,
    `os.environ["${connectionName}"] = "${opaqueValues[10]}"`,
    "",
  ].join("\n"));
  await addAll(directory);

  const result = scan(directory);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /SECRET_SCAN=FAIL/u);
  for (const opaqueValue of opaqueValues) {
    assert.equal((result.stdout + result.stderr).includes(opaqueValue), false);
  }
});

test("rejects credentials embedded in HTTPS URL userinfo", async (t) => {
  const directory = await createRepository(t);
  const user = ["synthetic", "user"].join("-");
  const password = ["opaque", "url", "fixture", "value"].join("-");
  const host = ["packages", "example", "com"].join(".");
  const url = ["https", "://", user, ":", password, "@", host, "/path"].join("");
  await writeFile(path.join(directory, "settings.txt"), `${url}\n`);
  await addAll(directory);

  const result = scan(directory);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /SECRET_SCAN=FAIL/u);
  assert.equal((result.stdout + result.stderr).includes(password), false);
});

test("rejects an opaque MCSP apikey in a serialized JSON capture", async (t) => {
  const directory = await createRepository(t);
  const jsonKey = ["api", "key"].join("");
  const opaqueValue = ["opaque", "mcsp", "fixture", "value"].join("-");
  await writeFile(
    path.join(directory, "request-capture.json"),
    `${JSON.stringify({ [jsonKey]: opaqueValue })}\n`,
  );
  await addAll(directory);

  const result = scan(directory);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /SECRET_SCAN=FAIL/u);
  assert.equal((result.stdout + result.stderr).includes(opaqueValue), false);
});

test("scans tracked path strings for secret and private-infrastructure markers", async (t) => {
  const directory = await createRepository(t);
  const tokenLikeName = "ghp_" + "P".repeat(30);
  const privateMarker = ["BOB-ECOSYSTEM", "SHOWCASE"].join("-");
  const sensitivePath = `${tokenLikeName}-${privateMarker}.txt`;
  await writeFile(path.join(directory, sensitivePath), "Synthetic safe content.\n");
  await addAll(directory);

  const result = scan(directory);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /PATH_SECRET_FINDINGS=1/u);
  assert.match(result.stdout, /PATH_PRIVATE_REFERENCE_FINDINGS=1/u);
  assert.match(result.stdout, /SECRET_SCAN=FAIL/u);
  assert.match(result.stdout, /PRIVATE_INFRA_REFERENCE_SCAN=FAIL/u);
  assert.equal((result.stdout + result.stderr).includes(tokenLikeName), false);
  assert.equal((result.stdout + result.stderr).includes(privateMarker), false);
});

test("rejects a tracked symbolic-link mode without following the target", async (t) => {
  const directory = await createRepository(t);
  const object = run("git", ["hash-object", "-w", "--stdin"], {
    cwd: directory,
    input: "outside-target",
  }).stdout.trim();
  assert.match(object, /^[a-f0-9]{40,64}$/u);
  assert.equal(
    run("git", ["update-index", "--add", "--cacheinfo", `120000,${object},unsafe-link`], {
      cwd: directory,
    }).status,
    0,
  );

  const result = scan(directory);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FORBIDDEN_FILE_SCAN=FAIL/u);
});

test("enforces shared provider, URL-userinfo, and escaped-path policy", async (t) => {
  const directory = await createRepository(t);
  const providerName = ["WXO", "API", "KEY"].join("_");
  const headerName = ["x", "instana", "key"].join("-");
  const opaqueValue = ["opaque", "shared", "fixture", "value"].join("-");
  const unsafeProviderValues = [
    `${providerName} = "str${opaqueValue}"`,
    `${providerName} = "string-${opaqueValue}"`,
    `${providerName} = "optional-${opaqueValue}"`,
    `${providerName} = "none-${opaqueValue}"`,
    `ENV ${providerName}=${opaqueValue}`,
    `- ${providerName}=${opaqueValue}`,
    `curl -H "${headerName}: ${opaqueValue}" https://acme.example`,
    `os.environ.setdefault("${providerName}", "${opaqueValue}")`,
    `headers.append("${headerName}", "${opaqueValue}")`,
    `headers.add("${headerName}", "${opaqueValue}")`,
  ];
  for (const value of unsafeProviderValues) {
    assert.equal(containsOpaqueProviderCredential(value), true);
  }

  const opaqueUrl = [
    "https", "://", "account", ":", opaqueValue, "@", "service.example.invalid", "/path",
  ].join("");
  assert.equal(containsHighConfidenceSecret(opaqueUrl), true);

  const escapedDrive = ["C:", "\\\\", "Users", "\\\\", "fixture-user", "\\\\", "file.txt"].join("");
  const escapedUnc = ["\\\\\\\\", "fixture-host", "\\\\", "private-share", "\\\\", "file.txt"].join("");
  assert.equal(containsAbsoluteUserPath(escapedDrive), true);
  assert.equal(containsAbsoluteUserPath(escapedUnc), true);

  await writeFile(path.join(directory, "unsafe-provider.txt"), `${unsafeProviderValues.join("\n")}\n${opaqueUrl}\n`);
  await writeFile(path.join(directory, "unsafe-paths.txt"), `${escapedDrive}\n${escapedUnc}\n`);
  await addAll(directory);

  const result = scan(directory);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /SECRET_SCAN=FAIL/u);
  assert.match(result.stdout, /ABSOLUTE_USER_PATH_SCAN=FAIL/u);
  assert.equal((result.stdout + result.stderr).includes(opaqueValue), false);
});

test("allows exact unquoted annotations, continuations, references, placeholders, and synthetic URL fixtures", async (t) => {
  const directory = await createRepository(t);
  const providerName = ["WXO", "API", "KEY"].join("_");
  const tokenField = ["api", "token"].join("_");
  const headerName = ["x", "instana", "key"].join("-");
  const placeholder = ["<", "load-at-runtime", ">"].join("");
  const safeValues = [
    `${providerName} = str`,
    `${providerName} = string`,
    `${providerName} = Optional[str]`,
    `${providerName} = None`,
    `${tokenField} = (\n  load_runtime_value()\n)`,
    `${providerName} = process.env.${providerName}`,
    `headers.set("${headerName}", config.instanaKey)`,
    `headers.append("${headerName}", environment.instanaKey)`,
    `os.environ.setdefault("${providerName}", os.environ.get("RUNTIME_KEY"))`,
    `ENV ${providerName}=${placeholder}`,
    `- ${providerName}=${"$" + "{RUNTIME_KEY}"}`,
    `curl -H "${headerName}: ${placeholder}" https://acme.example`,
  ];
  for (const value of safeValues) {
    assert.equal(containsOpaqueProviderCredential(value), false, value);
  }

  const fixtureUrl = ["https", "://", "user", ":", "password", "@", "service.example.invalid", "/path"].join("");
  const expressionUrl = ["https", "://", "${RUNTIME_USER}", ":", "${RUNTIME_PASS}", "@", "service.example.invalid", "/path"].join("");
  assert.equal(containsHighConfidenceSecret(fixtureUrl), false);
  assert.equal(containsHighConfidenceSecret(expressionUrl), false);

  await writeFile(path.join(directory, "safe-policy.txt"), `${safeValues.join("\n")}\n${fixtureUrl}\n${expressionUrl}\n`);
  await addAll(directory);
  const result = scan(directory);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /SECRET_SCAN=PASS/u);
  assert.match(result.stdout, /ABSOLUTE_USER_PATH_SCAN=PASS/u);
});
