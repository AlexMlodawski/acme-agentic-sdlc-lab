import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const schemaUrl = new URL("../contracts/bob-review.schema.json", import.meta.url);
const schema = JSON.parse(readFileSync(schemaUrl, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

export function validateBobReviewSchema(report) {
  if (!validate(report)) {
    throw new Error("Bob review report does not conform to contracts/bob-review.schema.json.");
  }
  return report;
}
