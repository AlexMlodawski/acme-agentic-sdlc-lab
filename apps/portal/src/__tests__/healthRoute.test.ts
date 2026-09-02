import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/health/route";

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/health", () => {
  it("returns a stable, secret-free readiness response", async () => {
    vi.stubEnv("WXO_API_KEY", "must-not-appear");
    vi.stubEnv("SUPPORT_API_TOKEN", "must-not-appear");

    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(body)).toEqual({
      status: "ready",
      service: "acme-support-portal",
    });
    expect(body).not.toContain("must-not-appear");
  });
});
