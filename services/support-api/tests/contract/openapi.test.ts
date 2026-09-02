import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import SwaggerParser from "@apidevtools/swagger-parser";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

interface ContractDocument {
  readonly servers?: readonly { readonly url?: string; readonly description?: string }[];
  readonly "x-runtime-profiles"?: {
    readonly local?: { readonly authentication?: string };
    readonly external?: { readonly authentication?: string };
  };
  readonly security?: readonly Record<string, readonly string[]>[];
  readonly paths: Record<
    string,
    {
      readonly get?: {
        readonly security?: readonly Record<string, readonly string[]>[];
        readonly responses?: Record<string, unknown>;
      };
      readonly post?: {
        readonly responses?: Record<string, unknown>;
      };
    }
  >;
  readonly components: {
    readonly securitySchemes?: Record<
      string,
      { readonly type?: string; readonly scheme?: string }
    >;
    readonly schemas: Record<
      string,
      {
        readonly required?: readonly string[];
        readonly properties?: Record<string, unknown>;
      }
    >;
  };
}

const contractPath = fileURLToPath(
  new URL("../../../../contracts/support-api.yaml", import.meta.url),
);

describe("OpenAPI contract", () => {
  it("is valid and exposes all required paths", async () => {
    await expect(SwaggerParser.validate(contractPath)).resolves.toBeDefined();

    const contract = parse(await readFile(contractPath, "utf8")) as ContractDocument;
    expect(Object.keys(contract.paths)).toEqual(
      expect.arrayContaining([
        "/health",
        "/ready",
        "/orders/{orderId}",
        "/support-cases",
      ]),
    );
  });

  it("documents protected operations and public health checks", async () => {
    const contract = parse(await readFile(contractPath, "utf8")) as ContractDocument;

    expect(contract.security).toEqual([{ bearerAuth: [] }]);
    expect(contract.components.securitySchemes?.bearerAuth).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
    expect(contract.paths["/health"]?.get?.security).toEqual([]);
    expect(contract.paths["/ready"]?.get?.security).toEqual([]);
    expect(contract.paths["/orders/{orderId}"]?.get?.responses).toHaveProperty("401");
    expect(contract.paths["/support-cases"]?.post?.responses).toHaveProperty("401");
    expect(contract.paths["/support-cases"]?.post?.responses).toHaveProperty("500");
    expect(contract.servers?.map((server) => server.url)).toEqual([
      "http://127.0.0.1:4000",
      "https://support-api.example.invalid",
    ]);
    expect(contract["x-runtime-profiles"]?.local?.authentication).toBe("optional");
    expect(contract["x-runtime-profiles"]?.external?.authentication).toBe("required bearer");
  });

  it("requires priority and rejects the non-contract priorityLevel field", async () => {
    const contract = parse(await readFile(contractPath, "utf8")) as ContractDocument;
    const request = contract.components.schemas.SupportCaseRequest;

    expect(request).toBeDefined();
    expect(request?.required).toContain("priority");
    expect(request?.properties).toHaveProperty("priority");
    expect(request?.properties).not.toHaveProperty("priorityLevel");
  });
});
