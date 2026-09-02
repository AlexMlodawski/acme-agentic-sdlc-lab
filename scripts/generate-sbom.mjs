import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const packageLockPath = path.resolve(root, "package-lock.json");
const uvLockPath = path.resolve(root, "agents/store_support_agent/uv.lock");
const protectedOutputSegments = new Set([".git", ".venv", "node_modules"]);
const npmDistributionHosts = new Set(["registry.npmjs.org"]);
const pypiDistributionHosts = new Set(["files.pythonhosted.org"]);
const sriAlgorithms = new Map([
  ["sha1", ["SHA-1", 20]],
  ["sha256", ["SHA-256", 32]],
  ["sha384", ["SHA-384", 48]],
  ["sha512", ["SHA-512", 64]],
]);
const uvAlgorithms = new Map([
  ["sha1", ["SHA-1", 40]],
  ["sha256", ["SHA-256", 64]],
  ["sha384", ["SHA-384", 96]],
  ["sha512", ["SHA-512", 128]],
]);

function outputArgument(args) {
  if (args.length === 1 && !args[0].startsWith("-")) return args[0];
  if (args.length === 2 && new Set(["--output", "-o"]).has(args[0])) return args[1];
  throw new Error("exactly one output argument is required");
}

function normalizedPath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function safeOutputPath(requestedOutput) {
  const absoluteRoot = path.resolve(root);
  const outputPath = path.resolve(absoluteRoot, requestedOutput);
  const relative = path.relative(absoluteRoot, outputPath);
  if (
    relative === ""
    || relative === ".."
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new Error("output must remain inside the repository");
  }
  if (relative.split(path.sep).some((segment) => protectedOutputSegments.has(segment.toLowerCase()))) {
    throw new Error("output targets a protected repository directory");
  }
  if (new Set([normalizedPath(packageLockPath), normalizedPath(uvLockPath)]).has(normalizedPath(outputPath))) {
    throw new Error("output would overwrite an input");
  }
  try {
    await lstat(outputPath);
    throw new Error("output already exists");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  let cursor = path.dirname(outputPath);
  while (normalizedPath(cursor) !== normalizedPath(absoluteRoot)) {
    try {
      const metadata = await lstat(cursor);
      if (metadata.isSymbolicLink()) throw new Error("output parent may not be a symbolic link");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error("output parent escapes repository");
    cursor = parent;
  }
  if (normalizedPath(await realpath(absoluteRoot)) !== normalizedPath(absoluteRoot)) {
    throw new Error("repository root may not be linked");
  }
  return outputPath;
}

function npmNameFromPath(packagePath) {
  const marker = "node_modules/";
  const index = packagePath.lastIndexOf(marker);
  return index < 0 ? null : packagePath.slice(index + marker.length);
}

function encodeNpmName(name) {
  if (!name.startsWith("@")) return encodeURIComponent(name);
  const slash = name.indexOf("/");
  if (slash < 0) return encodeURIComponent(name);
  return `${encodeURIComponent(name.slice(0, slash))}/${encodeURIComponent(name.slice(slash + 1))}`;
}

function npmPurl(name, version) {
  return `pkg:npm/${encodeNpmName(name)}@${encodeURIComponent(version)}`;
}

function pypiPurl(name, version) {
  const normalized = name.toLowerCase().replace(/[_.]+/gu, "-");
  return `pkg:pypi/${encodeURIComponent(normalized)}@${encodeURIComponent(version)}`;
}

function safePublicUrl(candidate, allowedHosts) {
  if (typeof candidate !== "string" || candidate === "") return null;
  try {
    const parsed = new URL(candidate);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:"
      || parsed.username !== ""
      || parsed.password !== ""
      || parsed.search !== ""
      || parsed.hash !== ""
      || !allowedHosts.has(host)) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

function hashesFromIntegrity(integrity) {
  if (typeof integrity !== "string") return [];
  const hashes = [];
  for (const token of integrity.trim().split(/\s+/u)) {
    const match = /^(sha1|sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})(?:\?.*)?$/u.exec(token);
    if (!match) continue;
    const [algorithm, expectedBytes] = sriAlgorithms.get(match[1]);
    const decoded = Buffer.from(match[2], "base64");
    if (decoded.length !== expectedBytes) continue;
    hashes.push({ alg: algorithm, content: decoded.toString("hex") });
  }
  return uniqueSorted(hashes, (value) => `${value.alg}|${value.content}`);
}

function hashFromUv(value) {
  if (typeof value !== "string") return null;
  const match = /^(sha1|sha256|sha384|sha512):([0-9a-f]+)$/iu.exec(value);
  if (!match) return null;
  const [algorithm, expectedCharacters] = uvAlgorithms.get(match[1].toLowerCase());
  if (match[2].length !== expectedCharacters) return null;
  return { alg: algorithm, content: match[2].toLowerCase() };
}

function uniqueSorted(values, key) {
  return [...new Map(values.map((value) => [key(value), value])).values()]
    .sort((left, right) => compareText(key(left), key(right)));
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function component({ type, name, version, purl, license, hashes = [], references = [] }) {
  const result = { type, "bom-ref": purl, name, version, purl };
  if (license) result.licenses = [{ expression: license }];
  if (hashes.length > 0) result.hashes = hashes;
  if (references.length > 0) result.externalReferences = references;
  return result;
}

function mergeComponents(existing, incoming) {
  if (!existing) return incoming;
  const merged = { ...existing };
  if (existing.type !== "application" && incoming.type === "application") merged.type = "application";
  const licenses = [...(existing.licenses ?? []), ...(incoming.licenses ?? [])];
  const hashes = [...(existing.hashes ?? []), ...(incoming.hashes ?? [])];
  const references = [...(existing.externalReferences ?? []), ...(incoming.externalReferences ?? [])];
  if (licenses.length > 0) {
    merged.licenses = uniqueSorted(licenses, (value) => value.expression ?? value.license?.id ?? "");
  }
  if (hashes.length > 0) {
    merged.hashes = uniqueSorted(hashes, (value) => `${value.alg}|${value.content}`);
  }
  if (references.length > 0) {
    merged.externalReferences = uniqueSorted(
      references,
      (value) => `${value.type}|${value.url}|${JSON.stringify(value.hashes ?? [])}`,
    );
  }
  return merged;
}

function addComponent(components, value) {
  components.set(value["bom-ref"], mergeComponents(components.get(value["bom-ref"]), value));
}

function npmComponents(lock) {
  if (!lock || typeof lock !== "object" || !lock.packages || typeof lock.packages !== "object") {
    throw new Error("unsupported package lock");
  }
  const rootPackage = lock.packages[""] ?? {};
  const rootName = rootPackage.name ?? lock.name;
  const rootVersion = rootPackage.version ?? lock.version;
  if (typeof rootName !== "string" || typeof rootVersion !== "string") {
    throw new Error("root package identity is missing");
  }

  const rootComponent = component({
    type: "application",
    name: rootName,
    version: rootVersion,
    purl: npmPurl(rootName, rootVersion),
    license: typeof rootPackage.license === "string" ? rootPackage.license : null,
  });
  const components = new Map();

  for (const [packagePath, entry] of Object.entries(lock.packages)) {
    if (packagePath === "" || !entry || typeof entry !== "object" || entry.link === true) continue;
    const registryName = npmNameFromPath(packagePath);
    const name = registryName ?? (typeof entry.name === "string" ? entry.name : null);
    const version = entry.version;
    if (typeof name !== "string" || name === "" || typeof version !== "string" || version === "") {
      if (registryName !== null) throw new Error("locked npm package identity is incomplete");
      continue;
    }

    const hashes = hashesFromIntegrity(entry.integrity);
    const references = [];
    const distribution = safePublicUrl(entry.resolved, npmDistributionHosts);
    if (distribution) references.push({ type: "distribution", url: distribution });
    addComponent(components, component({
      type: registryName === null ? "application" : "library",
      name,
      version,
      purl: npmPurl(name, version),
      license: typeof entry.license === "string" ? entry.license : null,
      hashes,
      references,
    }));
  }
  return { rootComponent, components };
}

function uvPackageBlocks(text) {
  return text.split(/^\[\[package\]\]\s*$/mu).slice(1);
}

function uvComponents(text) {
  const components = new Map();
  for (const block of uvPackageBlocks(text)) {
    const nameMatch = /^name = "([^"]+)"$/mu.exec(block);
    const versionMatch = /^version = "([^"]+)"$/mu.exec(block);
    const sourceMatch = /^source = \{ ([^}]+) \}$/mu.exec(block);
    if (!nameMatch || !versionMatch || !sourceMatch) throw new Error("uv package identity is incomplete");
    const name = nameMatch[1];
    const version = versionMatch[1];
    const isLocal = /\b(?:virtual|editable|directory)\s*=/u.test(sourceMatch[1]);
    const references = [];
    const artifactPattern = /\{[^{}\r\n]*\burl = "([^"]+)"[^{}\r\n]*\bhash = "([^"]+)"[^{}\r\n]*\}/gu;
    for (const match of block.matchAll(artifactPattern)) {
      const distribution = safePublicUrl(match[1], pypiDistributionHosts);
      if (!distribution) continue;
      const hash = hashFromUv(match[2]);
      const reference = { type: "distribution", url: distribution };
      if (hash) reference.hashes = [hash];
      references.push(reference);
    }
    addComponent(components, component({
      type: isLocal ? "application" : "library",
      name,
      version,
      purl: pypiPurl(name, version),
      references,
    }));
  }
  return components;
}

function normalizeComponent(value) {
  const result = { ...value };
  if (result.licenses) {
    result.licenses = uniqueSorted(result.licenses, (item) => item.expression ?? item.license?.id ?? "");
  }
  if (result.hashes) {
    result.hashes = uniqueSorted(result.hashes, (item) => `${item.alg}|${item.content}`);
  }
  if (result.externalReferences) {
    result.externalReferences = uniqueSorted(
      result.externalReferences,
      (item) => `${item.type}|${item.url}|${JSON.stringify(item.hashes ?? [])}`,
    );
  }
  return result;
}

async function main() {
  const requestedOutput = outputArgument(process.argv.slice(2));
  const outputPath = await safeOutputPath(requestedOutput);

  const [packageLockText, uvLockText] = await Promise.all([
    readFile(packageLockPath, "utf8"),
    readFile(uvLockPath, "utf8"),
  ]);
  const npm = npmComponents(JSON.parse(packageLockText));
  const pypi = uvComponents(uvLockText);
  const combined = new Map(npm.components);
  for (const value of pypi.values()) addComponent(combined, value);

  const components = [...combined.values()]
    .map(normalizeComponent)
    .sort((left, right) => compareText(left["bom-ref"], right["bom-ref"]));
  const bom = {
    $schema: "http://cyclonedx.org/schema/bom-1.6.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: { component: normalizeComponent(npm.rootComponent) },
    components,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(bom, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  console.log(`SBOM_NPM_COMPONENTS=${npm.components.size}`);
  console.log(`SBOM_PYPI_COMPONENTS=${pypi.size}`);
  console.log(`SBOM_COMPONENTS=${components.length}`);
  console.log("SBOM_GENERATION=PASS");
}

try {
  await main();
} catch {
  console.log("SBOM_GENERATION=FAIL");
  process.exitCode = 2;
}
