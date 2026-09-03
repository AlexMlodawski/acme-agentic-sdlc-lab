import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertPublicSafeBobReview,
  renderBobReviewMarkdown,
  sha256Text,
  validateBobReviewReport,
} from "./bob-review-report.mjs";
import { validateBobReviewSchema } from "./bob-review-schema.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportDirectory = path.join(projectRoot, "artifacts", "bob-review");
const reportPath = path.join(reportDirectory, "report.json");
const markdownPath = path.join(reportDirectory, "report.md");
const completionPath = path.join(reportDirectory, "evidence-complete.json");

const reportText = await readFile(reportPath, "utf8");
const report = JSON.parse(reportText);
validateBobReviewSchema(report);
validateBobReviewReport(report);
assertPublicSafeBobReview(report);
const markdown = await readFile(markdownPath, "utf8");
if (markdown.replaceAll("\r\n", "\n") !== renderBobReviewMarkdown(report)) {
  throw new Error("report.md does not match the validated report.json rendering.");
}
const completion = JSON.parse(await readFile(completionPath, "utf8"));
const expectedCompletionKeys = [
  "candidateSha", "controllerSha", "markdownSha256", "reportSha256", "reportStatus", "schemaVersion",
];
if (JSON.stringify(Object.keys(completion).sort()) !== JSON.stringify(expectedCompletionKeys)) {
  throw new Error("Bob review completion marker has unsupported fields.");
}
if (completion.schemaVersion !== "1.0" || completion.reportStatus !== "pass"
  || completion.candidateSha !== report.candidate.sha
  || completion.controllerSha !== report.controller.sha
  || completion.reportSha256 !== sha256Text(reportText)
  || completion.markdownSha256 !== sha256Text(markdown)) {
  throw new Error("Bob review completion marker does not bind the validated evidence.");
}

if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, [
    "## Bob Shell advisory review",
    "",
    `- Candidate: \`${report.candidate.sha}\``,
    `- Controller: \`${report.controller.sha}\``,
    `- Execution: \`${report.review.status}\``,
    `- Source mutation guard: \`${report.review.sourceMutationGuard}\``,
    `- Recommendation: \`${report.recommendation}\``,
    "- Authority: advisory; human release decision required",
    "",
  ].join("\n"), "utf8");
}

console.log("BOB_REVIEW_REPORT=pass");
console.log(`BOB_REVIEW_CANDIDATE_SHA=${report.candidate.sha}`);
console.log(`BOB_REVIEW_RECOMMENDATION=${report.recommendation}`);
