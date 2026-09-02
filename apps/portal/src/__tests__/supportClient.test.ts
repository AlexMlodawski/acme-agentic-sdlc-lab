import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSupportCase,
  getDemoCorrelationId,
  mapSupportCaseRequest,
  SupportClientError,
} from "@/lib/supportClient";

const INPUT = {
  orderId: " acme-1042 ",
  selectedPriority: "high" as const,
  description: " The order is delayed and assistance is required. ",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("support case request mapper", () => {
  it("normalizes the form values to the public API contract", () => {
    const payload = mapSupportCaseRequest(INPUT);

    expect(payload).toEqual({
      orderId: "ACME-1042",
      priority: "high",
      description: "The order is delayed and assistance is required.",
    });
    expect(INPUT.orderId).toBe(" acme-1042 ");
  });
});

describe("support case API client", () => {
  it("propagates the configured correlation ID and parses a success response", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_CORRELATION_ID", "BOB27-TEST-001");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          caseId: "CASE-20260827-001",
          status: "created",
          priority: "high",
          correlationId: "BOB27-TEST-001",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(createSupportCase(INPUT, fetcher)).resolves.toMatchObject({
      caseId: "CASE-20260827-001",
      priority: "high",
    });

    const requestInit = fetcher.mock.calls[0]?.[1];
    expect(new Headers(requestInit?.headers).get("x-correlation-id")).toBe("BOB27-TEST-001");
    expect(getDemoCorrelationId()).toBe("BOB27-TEST-001");
  });

  it.each([
    ["an overlong value", "X".repeat(129)],
    ["an unsafe value", "contains spaces"],
  ])("replaces %s before exposing it to the browser", (_label, value) => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_CORRELATION_ID", value);
    expect(getDemoCorrelationId()).toBe("ACME-LAB-LOCAL");
  });

  it("exposes only safe API error metadata", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Internal Server Error",
          code: "SUPPORT_API_UNAVAILABLE",
          correlationId: "ACME-LAB-LOCAL",
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(createSupportCase(INPUT, fetcher)).rejects.toMatchObject({
      name: "SupportClientError",
      status: 503,
      code: "SUPPORT_API_UNAVAILABLE",
      correlationId: "ACME-LAB-LOCAL",
    } satisfies Partial<SupportClientError>);
  });

  it("normalizes a network failure", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("connection refused"));

    await expect(createSupportCase(INPUT, fetcher)).rejects.toMatchObject({
      status: 0,
      code: "SUPPORT_API_UNAVAILABLE",
      correlationId: "ACME-LAB-LOCAL",
    });
  });

  it("rejects an invalid success payload", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: "created" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(createSupportCase(INPUT, fetcher)).rejects.toMatchObject({
      code: "INVALID_SUPPORT_API_RESPONSE",
    });
  });
});
