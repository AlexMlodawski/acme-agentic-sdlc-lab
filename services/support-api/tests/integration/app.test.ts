import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";
import { testConfig, validSupportCase } from "../helpers.js";

describe("Support API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({ config: testConfig(), logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("reports health and readiness without nondeterministic fields", async () => {
    const health = await app.inject({ method: "GET", url: "/health" });
    const ready = await app.inject({ method: "GET", url: "/ready" });

    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok", service: "acme-support-api" });
    expect(health.headers["x-correlation-id"]).toBe("ACME-LAB-LOCAL");
    expect(ready.statusCode).toBe(200);
  });

  it("rejects unexpected health-check query parameters", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health?unexpected=true",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("REQUEST_VALIDATION_FAILED");
  });

  it("returns an existing order as a direct record", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/orders/ACME-1042",
      headers: { "x-correlation-id": "ORDER-LOOKUP-1" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-correlation-id"]).toBe("ORDER-LOOKUP-1");
    expect(response.json()).toEqual({
      orderId: "ACME-1042",
      customerName: "Jordan Lee",
      status: "delayed",
      estimatedDeliveryDate: "2026-08-26",
      carrier: "Acme Express",
      trackingNumber: "AX-88271042",
    });
  });

  it("normalizes a lowercase order identifier allowed by the contract", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/orders/acme-1042",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().orderId).toBe("ACME-1042");
  });

  it("does not require auth when a dormant token exists in the disabled profile", async () => {
    await app.close();
    app = await buildApp({
      config: testConfig({
        requireAuth: false,
        supportApiToken: "dormant-demo-token",
      }),
      logger: false,
    });

    const response = await app.inject({ method: "GET", url: "/orders/ACME-1042" });
    expect(response.statusCode).toBe(200);
  });

  it("returns a safe 404 for the deterministic missing order", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/orders/ACME-4040",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "Not Found",
      code: "ORDER_NOT_FOUND",
      correlationId: "ACME-LAB-LOCAL",
      message: "No order was found for ACME-4040.",
    });
  });

  it("creates a case with the correct contract and propagates correlation", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/support-cases",
      headers: { "x-correlation-id": "ACME-LAB-LOCAL" },
      payload: validSupportCase,
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers["x-correlation-id"]).toBe("ACME-LAB-LOCAL");
    expect(response.json()).toEqual({
      caseId: "CASE-20260827-001",
      status: "created",
      priority: "high",
      correlationId: "ACME-LAB-LOCAL",
    });
  });

  it("returns 400 for ordinary validation failures", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/support-cases",
      payload: {
        orderId: "not-an-order",
        priority: "critical",
        description: "short",
        unexpected: true,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Bad Request",
      code: "REQUEST_VALIDATION_FAILED",
      correlationId: "ACME-LAB-LOCAL",
      message: "The request did not satisfy the API contract.",
    });
  });

  it("returns a safe 400 for malformed JSON", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/support-cases",
      headers: { "content-type": "application/json" },
      payload: '{"orderId":',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Bad Request",
      code: "REQUEST_VALIDATION_FAILED",
      correlationId: "ACME-LAB-LOCAL",
      message: "The request did not satisfy the API contract.",
    });
  });

  it("replaces malformed correlation identifiers with the demo default", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-correlation-id": "contains spaces and is rejected" },
    });

    expect(response.headers["x-correlation-id"]).toBe("ACME-LAB-LOCAL");
  });
});

describe("optional bearer protection", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({
      config: testConfig({
        requireAuth: true,
        supportApiToken: "demo-api-token",
      }),
      logger: false,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("keeps health and readiness public", async () => {
    const health = await app.inject({ method: "GET", url: "/health" });
    const ready = await app.inject({ method: "GET", url: "/ready" });

    expect(health.statusCode).toBe(200);
    expect(ready.statusCode).toBe(200);
  });

  it("returns a safe 401 for a missing or incorrect token", async () => {
    const missing = await app.inject({
      method: "GET",
      url: "/orders/ACME-1042",
      headers: { "x-correlation-id": "AUTH-MISSING-1" },
    });
    const incorrect = await app.inject({
      method: "POST",
      url: "/support-cases",
      headers: {
        authorization: "Bearer wrong-token",
        "x-correlation-id": "AUTH-WRONG-1",
      },
      payload: validSupportCase,
    });

    expect(missing.statusCode).toBe(401);
    expect(missing.headers["www-authenticate"]).toBe(
      'Bearer realm="acme-support-api"',
    );
    expect(missing.json()).toEqual({
      error: "Unauthorized",
      code: "UNAUTHORIZED",
      correlationId: "AUTH-MISSING-1",
      message: "A valid bearer token is required.",
    });
    expect(incorrect.statusCode).toBe(401);
    expect(incorrect.json()).toMatchObject({
      code: "UNAUTHORIZED",
      correlationId: "AUTH-WRONG-1",
    });
    expect(incorrect.body).not.toContain("wrong-token");
    expect(incorrect.body).not.toContain("demo-api-token");
  });

  it("authenticates before parsing or validating protected request bodies", async () => {
    const malformed = await app.inject({
      method: "POST",
      url: "/support-cases",
      headers: {
        "content-type": "application/json",
        "x-correlation-id": "AUTH-BEFORE-PARSE-1",
      },
      payload: '{"description":"must not be parsed"',
    });
    const invalidSchema = await app.inject({
      method: "POST",
      url: "/support-cases",
      headers: { "x-correlation-id": "AUTH-BEFORE-VALIDATION-1" },
      payload: { unexpected: true },
    });

    expect(malformed.statusCode).toBe(401);
    expect(malformed.json()).toMatchObject({
      code: "UNAUTHORIZED",
      correlationId: "AUTH-BEFORE-PARSE-1",
    });
    expect(invalidSchema.statusCode).toBe(401);
    expect(invalidSchema.json()).toMatchObject({
      code: "UNAUTHORIZED",
      correlationId: "AUTH-BEFORE-VALIDATION-1",
    });
  });

  it("accepts the configured token for order lookup and case creation", async () => {
    const headers = { authorization: "Bearer demo-api-token" };
    const order = await app.inject({
      method: "GET",
      url: "/orders/ACME-1042",
      headers,
    });
    const supportCase = await app.inject({
      method: "POST",
      url: "/support-cases",
      headers,
      payload: validSupportCase,
    });

    expect(order.statusCode).toBe(200);
    expect(order.json().orderId).toBe("ACME-1042");
    expect(supportCase.statusCode).toBe(201);
    expect(supportCase.json().caseId).toBe("CASE-20260827-001");
  });
});
