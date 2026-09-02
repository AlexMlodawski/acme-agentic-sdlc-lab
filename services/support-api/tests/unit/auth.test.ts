import { describe, expect, it } from "vitest";

import { hasValidBearerToken } from "../../src/auth.js";

describe("bearer authentication", () => {
  it("keeps authentication disabled when no token is configured", () => {
    expect(hasValidBearerToken(undefined, undefined)).toBe(true);
  });

  it.each([
    undefined,
    "",
    "Basic demo-api-token",
    "Bearer",
    "Bearer wrong-token",
    "Bearer demo-api-token extra",
  ])("rejects an invalid Authorization value %s", (authorization) => {
    expect(hasValidBearerToken(authorization, "demo-api-token")).toBe(false);
  });

  it("accepts a matching bearer token with a case-insensitive scheme", () => {
    expect(
      hasValidBearerToken("bearer demo-api-token", "demo-api-token"),
    ).toBe(true);
  });
});
