import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const RUNTIME_DIRECTORIES = [".", "apps/portal", "services/support-api"];

function isRuntimeEnvFile(name) {
  const normalized = name.toLowerCase();
  return normalized === ".env"
    || (normalized.startsWith(".env.") && normalized !== ".env.example");
}

export function findRuntimeEnvFiles(projectRoot) {
  if (typeof projectRoot !== "string" || !path.isAbsolute(projectRoot)) {
    throw new Error("Project root must be an absolute path.");
  }

  const findings = [];
  for (const relativeDirectory of RUNTIME_DIRECTORIES) {
    const directory = path.resolve(projectRoot, relativeDirectory);
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (isRuntimeEnvFile(entry.name)) {
        findings.push(path.relative(projectRoot, path.join(directory, entry.name)).replaceAll("\\", "/"));
      }
    }
  }
  return findings.sort();
}

export function assertSecretFreeLocalEnvironment(projectRoot) {
  const findings = findRuntimeEnvFiles(projectRoot);
  if (findings.length > 0) {
    throw new Error(
      `The zero-secret local profile refuses runtime environment files: ${findings.join(", ")}`,
    );
  }
}
