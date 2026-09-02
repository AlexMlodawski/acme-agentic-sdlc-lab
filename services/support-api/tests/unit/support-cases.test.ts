import { describe, expect, it } from "vitest";

import {
  createSupportCaseService,
} from "../../src/support-cases.js";
import { validSupportCase } from "../helpers.js";

describe("support-case domain service", () => {
  it("returns the same deterministic demo identifier across repeated calls", () => {
    const service = createSupportCaseService();

    expect(service.create(validSupportCase, "CORR-1")).toEqual({
      caseId: "CASE-20260827-001",
      status: "created",
      priority: "high",
      correlationId: "CORR-1",
    });
    expect(service.create(validSupportCase, "CORR-2").caseId).toBe(
      "CASE-20260827-001",
    );
  });

  it("preserves the requested priority", () => {
    const service = createSupportCaseService();
    expect(service.create({ ...validSupportCase, priority: "urgent" }, "CORR-OK")).toMatchObject({
      priority: "urgent",
      correlationId: "CORR-OK",
    });
  });
});
