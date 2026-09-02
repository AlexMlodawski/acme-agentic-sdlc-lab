import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/supportApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/supportApi")>(
    "@/lib/server/supportApi",
  );
  return {
    ...actual,
    fetchOrderFromSupportApi: vi.fn(),
    postSupportCaseToSupportApi: vi.fn(),
  };
});

import { POST as postAgent } from "@/app/api/agent/route";
import { POST as postSupportCase } from "@/app/api/support-cases/route";
import { postSupportCaseToSupportApi } from "@/lib/server/supportApi";

const routes = [
  ["agent", postAgent, "/api/agent"],
  ["support cases", postSupportCase, "/api/support-cases"],
] as const;

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("portal POST route security", () => {
  it.each(routes)("rejects text/plain on %s", async (_name, handler, pathname) => {
    const response = await handler(
      new Request(`http://127.0.0.1:3000${pathname}`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toMatchObject({
      code: "UNSUPPORTED_MEDIA_TYPE",
    });
  });

  it.each(routes)("rejects a foreign Origin on %s", async (_name, handler, pathname) => {
    const response = await handler(
      new Request(`http://localhost:3000${pathname}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Host: "127.0.0.1:3000",
          Origin: "https://foreign.example.invalid",
        },
        body: "{}",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "ORIGIN_NOT_ALLOWED",
    });
  });

  it("accepts same-origin JSON when Next normalizes request.url to localhost", async () => {
    vi.mocked(postSupportCaseToSupportApi).mockResolvedValue({
      status: 201,
      payload: { caseId: "CASE-20260827-001" },
      correlationId: "ACME-LAB-LOCAL",
    });

    const response = await postSupportCase(
      new Request("http://localhost:3000/api/support-cases", {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Host: "127.0.0.1:3000",
          Origin: "http://127.0.0.1:3000",
        },
        body: JSON.stringify({
          orderId: "ACME-1042",
          priority: "high",
          description: "The delayed order needs priority assistance.",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(postSupportCaseToSupportApi).toHaveBeenCalledTimes(1);
  });

  it("accepts same-origin HTTPS behind a TLS-terminating proxy", async () => {
    vi.mocked(postSupportCaseToSupportApi).mockResolvedValue({
      status: 201,
      payload: { caseId: "CASE-20260827-001" },
      correlationId: "ACME-LAB-LOCAL",
    });

    const response = await postSupportCase(
      new Request("http://localhost:3000/api/support-cases", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Host: "portal.example.test",
          Origin: "https://portal.example.test",
          "X-Forwarded-Proto": "https",
        },
        body: JSON.stringify({
          orderId: "ACME-1042",
          priority: "high",
          description: "The delayed order needs priority assistance.",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(postSupportCaseToSupportApi).toHaveBeenCalledTimes(1);
  });

  it("rejects non-contract fields before calling the Support API", async () => {
    const response = await postSupportCase(new Request("http://localhost:3000/api/support-cases", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({
        orderId: "ACME-1042",
        priorityLevel: "high",
        description: "The delayed order needs priority assistance.",
      }),
    }));

    expect(response.status).toBe(400);
    expect(postSupportCaseToSupportApi).not.toHaveBeenCalled();
  });
});
