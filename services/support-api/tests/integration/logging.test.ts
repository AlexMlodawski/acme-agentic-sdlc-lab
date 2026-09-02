import { Writable } from "node:stream";

import pino from "pino";
import { describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";
import { testConfig, validSupportCase } from "../helpers.js";

function createLogCapture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });

  return {
    lines,
    logger: pino({ level: "info", base: null }, stream),
  };
}

function parseRecords(lines: readonly string[]) {
  return lines
    .flatMap((line) => line.trim().split("\n"))
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function expectFragmentsAbsent(logOutput: string, fragments: readonly string[]) {
  for (const fragment of fragments) {
    expect(logOutput).not.toContain(fragment);
  }
}

describe("structured logging", () => {
  it("records safe, searchable fields without exposing the bearer token", async () => {
    const { lines, logger } = createLogCapture();
    const app = await buildApp({
      config: testConfig({
        logLevel: "info",
        supportApiToken: "SENTINEL-SUPPORT-API-TOKEN",
      }),
      loggerInstance: logger,
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/support-cases",
        headers: {
          authorization: "Bearer SENTINEL-SUPPORT-API-TOKEN",
          "x-correlation-id": "LOG-TRACE-201",
        },
        payload: validSupportCase,
      });
      expect(response.statusCode).toBe(201);

      const records = parseRecords(lines);
      const completed = records.find(
        (record) => record["http.route"] === "/support-cases",
      );

      expect(completed).toMatchObject({
        "service.name": "acme-support-api",
        "deployment.environment": "local-lab",
        correlation_id: "LOG-TRACE-201",
        "http.method": "POST",
        "http.route": "/support-cases",
        "http.status_code": 201,
        order_id: "ACME-1042",
      });
      expect(JSON.stringify(completed)).not.toContain("authorization");
      expect(JSON.stringify(completed)).not.toContain("api_token");
      expect(lines.join("\n")).not.toContain("SENTINEL-SUPPORT-API-TOKEN");
    } finally {
      await app.close();
    }
  });

  it("does not log any fragment of an invalid order identifier", async () => {
    const { lines, logger } = createLogCapture();
    const app = await buildApp({
      config: testConfig({
        logLevel: "info",
        supportApiToken: "SENTINEL-SUPPORT-API-TOKEN",
      }),
      loggerInstance: logger,
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/orders/SENTINEL-ORDERID-LEAK-7391",
        headers: {
          authorization: "Bearer SENTINEL-SUPPORT-API-TOKEN",
          "x-correlation-id": "LOG-VALIDATION-ORDER",
        },
      });
      expect(response.statusCode).toBe(400);

      const records = parseRecords(lines);
      const validation = records.find(
        (record) => record["error.code"] === "REQUEST_VALIDATION_FAILED",
      );
      expect(validation).toMatchObject({
        "http.route": "/orders/:orderId",
        "http.status_code": 400,
        "error.message": "The request did not satisfy the API contract.",
      });
      expect(validation).not.toHaveProperty("order_id");
      expect(validation).not.toHaveProperty("err");
      expect(records.every((record) => record.order_id === undefined)).toBe(true);
      expectFragmentsAbsent(lines.join("\n"), [
        "SENTINEL",
        "SENTINEL-ORDERID",
        "ORDERID-LEAK",
        "7391",
      ]);
    } finally {
      await app.close();
    }
  });

  it("does not log any fragment of a malformed JSON payload", async () => {
    const { lines, logger } = createLogCapture();
    const app = await buildApp({
      config: testConfig({
        logLevel: "info",
        supportApiToken: "SENTINEL-SUPPORT-API-TOKEN",
      }),
      loggerInstance: logger,
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/support-cases",
        headers: {
          authorization: "Bearer SENTINEL-SUPPORT-API-TOKEN",
          "content-type": "application/json",
          "x-correlation-id": "LOG-VALIDATION-JSON",
        },
        payload:
          '{"orderId":"ACME-1042","description":"SENTINEL-JSON-LEAK-8675309"',
      });
      expect(response.statusCode).toBe(400);

      const records = parseRecords(lines);
      const validation = records.find(
        (record) => record["error.code"] === "REQUEST_VALIDATION_FAILED",
      );
      expect(validation).toMatchObject({
        "http.route": "/support-cases",
        "http.status_code": 400,
        "error.message": "The request did not satisfy the API contract.",
      });
      expect(validation).not.toHaveProperty("order_id");
      expect(validation).not.toHaveProperty("err");
      expectFragmentsAbsent(lines.join("\n"), [
        "SENTINEL",
        "SENTINEL-JSON",
        "JSON-LEAK",
        "8675309",
      ]);
    } finally {
      await app.close();
    }
  });
});
