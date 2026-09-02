import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants as fsConstants,
} from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON_PROJECT = "agents/store_support_agent";
const PYTHON_HELPER = [
  "import importlib.metadata as metadata",
  "import json",
  "import sys",
  "expected = tuple(int(part) for part in sys.argv[1].split('.'))",
  "if sys.version_info[:3] != expected:",
  "    raise SystemExit(86)",
  "items = []",
  "for distribution in metadata.distributions():",
  "    package_metadata = distribution.metadata",
  "    items.append({",
  "        'name': package_metadata.get('Name'),",
  "        'version': distribution.version,",
  "        'license_expression': package_metadata.get('License-Expression'),",
  "        'license': package_metadata.get('License'),",
  "    })",
  "print(json.dumps(items, ensure_ascii=True, separators=(',', ':'), sort_keys=True))",
].join("\n");

const SAFE_NPM_NAME = /^(?:@[A-Za-z0-9._~-]+\/)?[A-Za-z0-9._~-]+$/u;
const SAFE_PYTHON_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9.!+_-]*$/u;
const SAFE_LICENSE_EXPRESSION = /^[A-Za-z0-9][A-Za-z0-9.+(): _-]*$/u;
const AMBIGUOUS_LICENSE = /^(?:unknown|none|n\/a|unlicensed|bsd|gpl|lgpl|apache|mpl|public domain)$/iu;
const NON_EXPRESSION_LICENSE = /^(?:see\s+licen[cs]e|licen[cs]e\s+file)/iu;
const PROTECTED_OUTPUT_SEGMENTS = new Set([".git", "node_modules", ".venv"]);

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizedPathForComparison(value, platform = process.platform) {
  const resolved = path.resolve(value);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isContained(root, candidate, platform = process.platform) {
  const rootValue = normalizedPathForComparison(root, platform);
  const candidateValue = normalizedPathForComparison(candidate, platform);
  const relative = path.relative(rootValue, candidateValue);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function outputArgument(args) {
  if (args.length !== 2 || args[0] !== "--output" || args[1].trim() === "") {
    throw new Error("exactly one explicit --output value is required");
  }
  return args[1];
}

function safeIdentity(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${label} is missing or unsafe`);
  }
  return value;
}

function classifyLicense(value) {
  if (typeof value !== "string") {
    return { expression: null, declared: value !== undefined && value !== null };
  }
  const expression = value.trim();
  if (
    expression === ""
    || expression.length > 240
    || !SAFE_LICENSE_EXPRESSION.test(expression)
    || AMBIGUOUS_LICENSE.test(expression)
    || NON_EXPRESSION_LICENSE.test(expression)
  ) {
    return { expression: null, declared: expression !== "" };
  }
  return { expression, declared: true };
}

function licenseResult(expression, licenseSource, needsReview) {
  return {
    license_expression: expression,
    license_source: licenseSource,
    needs_review: needsReview,
  };
}

export function resolveNodeLicense(installedValue, lockedValue) {
  const installed = classifyLicense(installedValue);
  const locked = classifyLicense(lockedValue);
  if (installed.expression !== null && locked.expression !== null) {
    if (installed.expression !== locked.expression) {
      return licenseResult(null, "conflicting_node_metadata", true);
    }
    return licenseResult(installed.expression, "installed_package_json", false);
  }
  if (installed.expression !== null) {
    if (locked.declared) return licenseResult(null, "conflicting_node_metadata", true);
    return licenseResult(installed.expression, "installed_package_json", false);
  }
  if (locked.expression !== null) {
    if (installed.declared) return licenseResult(null, "conflicting_node_metadata", true);
    return licenseResult(locked.expression, "package_lock", false);
  }
  if (installed.declared || locked.declared) {
    return licenseResult(null, "ambiguous_node_metadata", true);
  }
  return licenseResult(null, "not_declared", true);
}

export function resolvePythonLicense(row) {
  const expression = classifyLicense(row?.license_expression);
  if (expression.expression !== null) {
    return licenseResult(expression.expression, "python_metadata_license_expression", false);
  }
  if (expression.declared) {
    return licenseResult(null, "ambiguous_python_metadata", true);
  }
  const legacy = classifyLicense(row?.license);
  if (legacy.expression !== null) {
    return licenseResult(legacy.expression, "python_metadata_license", false);
  }
  if (legacy.declared) {
    return licenseResult(null, "ambiguous_python_metadata", true);
  }
  return licenseResult(null, "not_declared", true);
}

function npmNameFromPackagePath(packagePath) {
  const normalized = packagePath.replaceAll("\\", "/");
  const marker = "node_modules/";
  const index = normalized.lastIndexOf(marker);
  return index < 0 ? null : normalized.slice(index + marker.length);
}

async function readInstalledPackageManifest(root, packagePath) {
  const relativeManifest = packagePath === "" ? "package.json" : `${packagePath}/package.json`;
  const manifestPath = path.resolve(root, ...relativeManifest.split("/"));
  if (!isContained(root, manifestPath)) throw new Error("installed package path escapes repository");
  let resolvedManifest;
  try {
    resolvedManifest = await realpath(manifestPath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const resolvedRoot = await realpath(root);
  if (!isContained(resolvedRoot, resolvedManifest)) {
    throw new Error("installed package manifest resolves outside repository");
  }
  return JSON.parse(await readFile(resolvedManifest, "utf8"));
}

function componentKey(component) {
  const normalizedName = component.ecosystem === "pypi"
    ? component.name.toLowerCase().replace(/[_.]+/gu, "-")
    : component.name;
  return `${component.ecosystem}\u0000${normalizedName}\u0000${component.version}`;
}

function sourceRank(source) {
  return [
    "installed_package_json",
    "python_metadata_license_expression",
    "python_metadata_license",
    "package_lock",
    "not_declared",
  ].indexOf(source);
}

function mergeComponent(existing, incoming) {
  if (existing === undefined) return incoming;
  if (existing.license_expression !== incoming.license_expression) {
    return {
      ...existing,
      license_expression: null,
      license_source: "conflicting_component_metadata",
      needs_review: true,
    };
  }
  const sources = [existing.license_source, incoming.license_source];
  sources.sort((left, right) => {
    const leftRank = sourceRank(left);
    const rightRank = sourceRank(right);
    if (leftRank !== rightRank) return leftRank - rightRank;
    return compareText(left, right);
  });
  return {
    ...existing,
    license_source: sources[0],
    needs_review: existing.needs_review || incoming.needs_review,
  };
}

function deduplicatedComponents(components) {
  const result = new Map();
  const ordered = [...components].sort((left, right) => compareText(
    `${componentKey(left)}\u0000${left.name}\u0000${left.license_expression ?? ""}\u0000${left.license_source}`,
    `${componentKey(right)}\u0000${right.name}\u0000${right.license_expression ?? ""}\u0000${right.license_source}`,
  ));
  for (const component of ordered) {
    const key = componentKey(component);
    result.set(key, mergeComponent(result.get(key), component));
  }
  return [...result.values()].sort((left, right) => compareText(componentKey(left), componentKey(right)));
}

export async function collectNodeComponents(root, lockDocument) {
  if (
    !lockDocument
    || typeof lockDocument !== "object"
    || lockDocument.lockfileVersion !== 3
    || !lockDocument.packages
    || typeof lockDocument.packages !== "object"
  ) {
    throw new Error("package-lock.json must use lockfileVersion 3");
  }
  const components = [];
  for (const packagePath of Object.keys(lockDocument.packages).sort(compareText)) {
    const locked = lockDocument.packages[packagePath];
    if (!locked || typeof locked !== "object" || locked.link === true) continue;
    const installed = await readInstalledPackageManifest(root, packagePath);
    const derivedName = npmNameFromPackagePath(packagePath);
    const lockedName = typeof locked.name === "string"
      ? locked.name
      : packagePath === ""
        ? lockDocument.name
        : derivedName;
    const lockedVersion = typeof locked.version === "string"
      ? locked.version
      : packagePath === ""
        ? lockDocument.version
        : null;
    const installedName = typeof installed?.name === "string" ? installed.name : null;
    const installedVersion = typeof installed?.version === "string" ? installed.version : null;
    if (installedName !== null && locked.name !== undefined && installedName !== locked.name) {
      throw new Error("installed npm package name differs from package lock");
    }
    if (installedVersion !== null && lockedVersion !== null && installedVersion !== lockedVersion) {
      throw new Error("installed npm package version differs from package lock");
    }
    const name = safeIdentity(installedName ?? lockedName, SAFE_NPM_NAME, "npm package name");
    const version = safeIdentity(installedVersion ?? lockedVersion, SAFE_VERSION, "npm package version");
    components.push({
      name,
      version,
      ecosystem: "npm",
      ...resolveNodeLicense(installed?.license, locked.license),
    });
  }
  return deduplicatedComponents(components);
}

export function componentsFromPythonMetadata(rows) {
  if (!Array.isArray(rows)) throw new Error("Python metadata result must be an array");
  const components = rows.map((row) => ({
    name: safeIdentity(row?.name, SAFE_PYTHON_NAME, "Python package name"),
    version: safeIdentity(row?.version, SAFE_VERSION, "Python package version"),
    ecosystem: "pypi",
    ...resolvePythonLicense(row),
  }));
  return deduplicatedComponents(components);
}

function executableCandidates(name, { environment = process.env, platform = process.platform } = {}) {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const directories = String(environment.Path ?? environment.PATH ?? "").split(pathApi.delimiter).filter(Boolean);
  const extensions = platform === "win32"
    ? String(environment.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  const hasExtension = platform === "win32" && pathApi.extname(name) !== "";
  return directories.flatMap((directory) => (
    hasExtension ? [pathApi.join(directory, name)] : extensions.map((extension) => pathApi.join(directory, `${name}${extension}`))
  ));
}

export function findExecutable(name, options = {}) {
  const mode = (options.platform ?? process.platform) === "win32" ? fsConstants.F_OK : fsConstants.X_OK;
  for (const candidate of executableCandidates(name, options)) {
    try {
      accessSync(candidate, mode);
      return candidate;
    } catch {
      // Continue searching PATH without exposing candidate paths.
    }
  }
  return null;
}

function safeChildEnvironment(environment) {
  const retained = {};
  const safeKeys = new Set([
    "ALLUSERSPROFILE",
    "APPDATA",
    "COMSPEC",
    "HOME",
    "HOMEDRIVE",
    "HOMEPATH",
    "LOCALAPPDATA",
    "PATH",
    "Path",
    "PATHEXT",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "WINDIR",
  ]);
  for (const [key, value] of Object.entries(environment)) {
    if (safeKeys.has(key.toUpperCase()) && typeof value === "string") retained[key] = value;
  }
  return {
    ...retained,
    NO_COLOR: "1",
    PIP_NO_INDEX: "1",
    UV_NO_CONFIG: "1",
    UV_NO_PROGRESS: "1",
    UV_OFFLINE: "1",
    UV_PYTHON_DOWNLOADS: "never",
  };
}

export function buildPythonCommandPlan(pythonVersion) {
  if (!/^3\.12\.\d+$/u.test(pythonVersion)) {
    throw new Error(".python-version must pin an exact Python 3.12 patch version");
  }
  return {
    args: [
      "run",
      "--project",
      PYTHON_PROJECT,
      "--offline",
      "--frozen",
      "--no-sync",
      "--python",
      pythonVersion,
      "python",
      "-I",
      "-c",
      PYTHON_HELPER,
      pythonVersion,
    ],
  };
}

export function executeExecutable(executable, args, {
  cwd,
  environment,
  platform = process.platform,
} = {}) {
  const extension = path.extname(executable).toLowerCase();
  const command = platform === "win32" && new Set([".cmd", ".bat"]).has(extension)
    ? (environment.ComSpec ?? environment.COMSPEC ?? process.env.ComSpec ?? "cmd.exe")
    : executable;
  const commandArgs = command === executable ? args : ["/d", "/s", "/c", executable, ...args];
  return spawnSync(command, commandArgs, {
    cwd,
    env: environment,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
}

export async function collectPythonMetadata({
  root,
  environment = process.env,
  platform = process.platform,
  find = (name) => findExecutable(name, { environment, platform }),
  execute = executeExecutable,
} = {}) {
  const pythonVersion = (await readFile(path.join(root, ".python-version"), "utf8")).trim();
  const plan = buildPythonCommandPlan(pythonVersion);
  const uv = find("uv");
  if (uv === null) throw new Error("uv is unavailable");
  const childEnvironment = safeChildEnvironment(environment);
  const result = execute(uv, plan.args, {
    cwd: root,
    environment: childEnvironment,
    platform,
  });
  if (result.error || result.status !== 0) throw new Error("Python metadata collection failed");
  let rows;
  try {
    rows = JSON.parse(String(result.stdout ?? "").trim());
  } catch {
    throw new Error("Python metadata output is invalid");
  }
  return rows;
}

async function assertSafeOutput(root, requestedOutput) {
  const absoluteRoot = path.resolve(root);
  const outputPath = path.resolve(absoluteRoot, requestedOutput);
  if (!isContained(absoluteRoot, outputPath) || outputPath === absoluteRoot) {
    throw new Error("output must remain inside the repository");
  }
  const relativeParts = path.relative(absoluteRoot, outputPath).split(path.sep);
  if (relativeParts.some((part) => PROTECTED_OUTPUT_SEGMENTS.has(part.toLowerCase()))) {
    throw new Error("output targets a protected repository directory");
  }
  const protectedInputs = [
    path.join(absoluteRoot, "package-lock.json"),
    path.join(absoluteRoot, "agents", "store_support_agent", "uv.lock"),
  ];
  if (protectedInputs.some((input) => normalizedPathForComparison(input) === normalizedPathForComparison(outputPath))) {
    throw new Error("output would overwrite a lockfile");
  }
  try {
    await lstat(outputPath);
    throw new Error("output already exists");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const parent = path.dirname(outputPath);
  let cursor = parent;
  while (cursor !== absoluteRoot) {
    try {
      const metadata = await lstat(cursor);
      if (metadata.isSymbolicLink()) throw new Error("output parent may not be a symbolic link");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const next = path.dirname(cursor);
    if (next === cursor || !isContained(absoluteRoot, next)) {
      throw new Error("output parent escapes repository");
    }
    cursor = next;
  }
  const resolvedRoot = await realpath(absoluteRoot);
  const existingAncestor = await realpath(cursor);
  if (!isContained(resolvedRoot, existingAncestor)) throw new Error("repository path is unsafe");
  return outputPath;
}

export async function generateLicenseInventory({
  root = REPOSITORY_ROOT,
  output,
  pythonRows,
  environment = process.env,
  platform = process.platform,
  find,
  execute,
} = {}) {
  if (typeof output !== "string" || output.trim() === "") {
    throw new Error("an explicit output path is required");
  }
  const absoluteRoot = path.resolve(root);
  const outputPath = await assertSafeOutput(absoluteRoot, output);
  const lockDocument = JSON.parse(await readFile(path.join(absoluteRoot, "package-lock.json"), "utf8"));
  const [nodeComponents, collectedPythonRows] = await Promise.all([
    collectNodeComponents(absoluteRoot, lockDocument),
    pythonRows === undefined
      ? collectPythonMetadata({ root: absoluteRoot, environment, platform, find, execute })
      : Promise.resolve(pythonRows),
  ]);
  const pythonComponents = componentsFromPythonMetadata(collectedPythonRows);
  const components = deduplicatedComponents([...nodeComponents, ...pythonComponents]);
  const summary = {
    component_count: components.length,
    node_component_count: nodeComponents.length,
    python_component_count: pythonComponents.length,
    needs_review_count: components.filter((component) => component.needs_review).length,
  };
  const inventory = {
    schema_version: 1,
    generation_status: "pass",
    legal_review_status: "not_asserted",
    summary,
    components,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(inventory, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return summary;
}

export function formatSuccess(summary) {
  return [
    `LICENSE_INVENTORY_NODE_COMPONENTS=${summary.node_component_count}`,
    `LICENSE_INVENTORY_PYTHON_COMPONENTS=${summary.python_component_count}`,
    `LICENSE_INVENTORY_COMPONENTS=${summary.component_count}`,
    `LICENSE_INVENTORY_NEEDS_REVIEW=${summary.needs_review_count}`,
    "LICENSE_INVENTORY_GENERATION_STATUS=pass",
    "LICENSE_LEGAL_REVIEW_STATUS=not_asserted",
    "",
  ].join("\n");
}

async function main() {
  try {
    const output = outputArgument(process.argv.slice(2));
    const summary = await generateLicenseInventory({ output });
    process.stdout.write(formatSuccess(summary));
  } catch {
    process.stdout.write("LICENSE_INVENTORY_GENERATION_STATUS=fail\nLICENSE_LEGAL_REVIEW_STATUS=not_asserted\n");
    process.exitCode = 2;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) await main();
