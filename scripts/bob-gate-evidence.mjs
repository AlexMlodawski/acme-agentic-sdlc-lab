import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DECIMAL_ID_PATTERN = /^[1-9][0-9]{0,30}$/u;

export const BOB_DETERMINISTIC_GATES = Object.freeze([
  Object.freeze({ name: "Locked Node installation", command: "npm ci --ignore-scripts" }),
  Object.freeze({ name: "Playwright Chromium installation", command: "npx --no-install playwright install --with-deps chromium" }),
  Object.freeze({ name: "Repository preflight", command: "npm run preflight" }),
  Object.freeze({ name: "Repository verification", command: "npm run verify" }),
  Object.freeze({ name: "Development browser acceptance", command: "npm run e2e:local" }),
  Object.freeze({ name: "Production-build browser acceptance", command: "npm run e2e:built" }),
]);

function exactKeys(value, keys) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && keys.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => keys.includes(key));
}

export function buildBobGateEvidence({ candidateSha, controllerSha, workflowRunId, workflowRunAttempt }) {
  const evidence = {
    schemaVersion: "1.0",
    sourceJob: "deterministic-gates",
    candidateSha,
    controllerSha,
    workflowRunId,
    workflowRunAttempt,
    status: "pass",
    gates: BOB_DETERMINISTIC_GATES.map((gate) => ({
      ...gate,
      status: "pass",
      evidence: "Exit code 0 in the isolated exact-candidate GitHub-hosted job.",
    })),
  };
  return validateBobGateEvidence(evidence, { candidateSha, controllerSha, workflowRunId, workflowRunAttempt });
}

export function validateBobGateEvidence(evidence, expected = {}) {
  const rootKeys = [
    "schemaVersion", "sourceJob", "candidateSha", "controllerSha", "workflowRunId",
    "workflowRunAttempt", "status", "gates",
  ];
  if (!exactKeys(evidence, rootKeys)) throw new Error("Gate evidence has missing or unsupported fields.");
  if (evidence.schemaVersion !== "1.0" || evidence.sourceJob !== "deterministic-gates"
    || evidence.status !== "pass") {
    throw new Error("Gate evidence does not represent a completed deterministic-gates job.");
  }
  if (!SHA_PATTERN.test(evidence.candidateSha) || !SHA_PATTERN.test(evidence.controllerSha)) {
    throw new Error("Gate evidence contains an invalid commit identity.");
  }
  if (!DECIMAL_ID_PATTERN.test(evidence.workflowRunId)
    || !DECIMAL_ID_PATTERN.test(evidence.workflowRunAttempt)) {
    throw new Error("Gate evidence contains an invalid workflow-run identity.");
  }
  for (const field of ["candidateSha", "controllerSha", "workflowRunId", "workflowRunAttempt"]) {
    if (expected[field] !== undefined && evidence[field] !== expected[field]) {
      throw new Error(`Gate evidence ${field} does not match the active review.`);
    }
  }
  if (!Array.isArray(evidence.gates) || evidence.gates.length !== BOB_DETERMINISTIC_GATES.length) {
    throw new Error("Gate evidence does not contain the complete reviewed gate set.");
  }
  evidence.gates.forEach((gate, index) => {
    const expectedGate = BOB_DETERMINISTIC_GATES[index];
    if (!exactKeys(gate, ["name", "command", "status", "evidence"])
      || gate.name !== expectedGate.name || gate.command !== expectedGate.command
      || gate.status !== "pass"
      || gate.evidence !== "Exit code 0 in the isolated exact-candidate GitHub-hosted job.") {
      throw new Error(`Gate evidence item ${index} does not match the reviewed gate contract.`);
    }
  });
  return evidence;
}

export async function readBobGateEvidence(file, expected = {}) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error("Unable to read deterministic gate evidence.");
  }
  return validateBobGateEvidence(parsed, expected);
}

function parseWriteArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error("Gate evidence writer received an unknown or incomplete option.");
    }
    values[name.slice(2)] = value;
  }
  const allowed = new Set(["candidate", "controller", "run-id", "run-attempt", "output"]);
  if (Object.keys(values).some((key) => !allowed.has(key)) || Object.keys(values).length !== allowed.size) {
    throw new Error("Gate evidence writer requires candidate, controller, run-id, run-attempt, and output.");
  }
  return values;
}

async function main() {
  const values = parseWriteArguments(process.argv.slice(2));
  const evidence = buildBobGateEvidence({
    candidateSha: values.candidate,
    controllerSha: values.controller,
    workflowRunId: values["run-id"],
    workflowRunAttempt: values["run-attempt"],
  });
  const output = path.resolve(values.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  console.log("BOB_DETERMINISTIC_GATE_EVIDENCE=pass");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unable to write gate evidence.");
    process.exitCode = 1;
  }
}
