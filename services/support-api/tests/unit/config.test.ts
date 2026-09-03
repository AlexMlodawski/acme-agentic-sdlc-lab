import { describe, expect, it } from "vitest";

import { configDefaults, loadConfig } from "../../src/config.js";

describe("loadConfig", () => {
  it("provides deterministic local defaults", () => {
    const config = loadConfig({});

    expect(config).toMatchObject({
      host: "127.0.0.1",
      port: 4000,
      correlationId: "ACME-LAB-LOCAL",
      serviceName: "acme-support-api",
      deploymentEnvironment: "local-lab",
      otelEnabled: false,
      otelDestination: "generic",
      requireAuth: false,
    });
    expect(configDefaults.correlationId).toBe("ACME-LAB-LOCAL");
    expect(config.supportApiToken).toBeUndefined();
  });

  it("builds the Instana OTLP headers in memory for the approved endpoint", () => {
    const config = loadConfig({
      OTEL_ENABLED: "1",
      INSTANA_AGENT_KEY: "SENTINEL-INSTANA-AGENT-KEY",
      INSTANA_OTLP_HTTP_ENDPOINT:
        "https://otlp-http-blue-saas.instana.io:443",
      INSTANA_OTLP_HOST: "acme-local-lab",
    });

    expect(config.otelDestination).toBe("instana");
    expect(config.otelExporterEndpoint).toBe(
      "https://otlp-http-blue-saas.instana.io:443",
    );
    expect(config.otelExporterHeaders).toEqual({
      "x-instana-key": "SENTINEL-INSTANA-AGENT-KEY",
      "x-instana-host": "acme-local-lab",
    });
  });

  it.each([
    "http://otlp-http-blue-saas.instana.io:443",
    "https://otlp-http-blue-saas.instana.io.attacker.invalid:443",
    "https://user@otlp-http-blue-saas.instana.io:443",
    "https://otlp-http-blue-saas.instana.io:444",
    "https://otlp-http-blue-saas.instana.io:443/v1/metrics",
    "https://otlp-http-blue-saas.instana.io:443?unsafe=1",
  ])("rejects an unapproved Instana endpoint %s", (endpoint) => {
    expect(() =>
      loadConfig({
        OTEL_ENABLED: "1",
        INSTANA_AGENT_KEY: "SENTINEL-INSTANA-AGENT-KEY",
        INSTANA_OTLP_HTTP_ENDPOINT: endpoint,
        INSTANA_OTLP_HOST: "acme-local-lab",
      }),
    ).toThrow("approved blue SaaS OTLP/HTTP endpoint");
  });

  it("requires the complete dedicated Instana configuration", () => {
    expect(() =>
      loadConfig({
        OTEL_ENABLED: "1",
        INSTANA_OTLP_HTTP_ENDPOINT:
          "https://otlp-http-blue-saas.instana.io:443",
        INSTANA_OTLP_HOST: "acme-local-lab",
      }),
    ).toThrow("INSTANA_AGENT_KEY is required");

    expect(() =>
      loadConfig({
        OTEL_ENABLED: "0",
        INSTANA_AGENT_KEY: "SENTINEL-INSTANA-AGENT-KEY",
        INSTANA_OTLP_HTTP_ENDPOINT:
          "https://otlp-http-blue-saas.instana.io:443",
        INSTANA_OTLP_HOST: "acme-local-lab",
      }),
    ).toThrow("OTEL_ENABLED must be enabled");
  });

  it("accepts explicit safe configuration", () => {
    const config = loadConfig({
      SUPPORT_API_PORT: "4400",
      SUPPORT_API_HOST: "0.0.0.0",
      SUPPORT_API_REQUIRE_AUTH: "1",
      SUPPORT_API_TOKEN: "  SENTINEL-SUPPORT-API-TOKEN  ",
      DEMO_CORRELATION_ID: "TEST-42",
      OTEL_ENABLED: "true",
      CORS_ORIGIN: "https://portal.example.invalid, http://127.0.0.1:3000",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
      OTEL_RESOURCE_ATTRIBUTES:
        "service.namespace=acme,deployment.environment=test",
    });

    expect(config.port).toBe(4400);
    expect(config.host).toBe("0.0.0.0");
    expect(config.requireAuth).toBe(true);
    expect(config.supportApiToken).toBe("SENTINEL-SUPPORT-API-TOKEN");
    expect(config.correlationId).toBe("TEST-42");
    expect(config.otelEnabled).toBe(true);
    expect(config.corsOrigins).toEqual([
      "https://portal.example.invalid",
      "http://127.0.0.1:3000",
    ]);
    expect(config.otelExporterEndpoint).toBe("http://127.0.0.1:4318");
    expect(config.otelResourceAttributes).toEqual({
      "service.namespace": "acme",
      "deployment.environment": "test",
    });
  });

  it.each(["bad\nkey", "key\n", "\tkey", "X".repeat(4_097)])(
    "rejects an unsafe Instana Agent Key",
    (agentKey) => {
      expect(() =>
        loadConfig({
          OTEL_ENABLED: "1",
          INSTANA_AGENT_KEY: String(agentKey),
          INSTANA_OTLP_HTTP_ENDPOINT:
            "https://otlp-http-blue-saas.instana.io:443",
          INSTANA_OTLP_HOST: "acme-local-lab",
        }),
      ).toThrow("INSTANA_AGENT_KEY is required");
    },
  );

  it.each(["X".repeat(129), "contains spaces", "_missing-leading-alphanumeric"])(
    "rejects an unsafe demonstration correlation ID",
    (correlationId) => {
      expect(() => loadConfig({ DEMO_CORRELATION_ID: correlationId })).toThrow(
        "DEMO_CORRELATION_ID must be a bounded safe identifier",
      );
    },
  );

  it.each([
    "host.name=physical-workstation",
    "process.owner=local-user",
    "process.executable.path=C:/private/path",
    "secret.value=must-not-export",
    "service.namespace=value with spaces",
    "service.version=v1,service.version=v2",
  ])("rejects unsafe resource metadata %s", (attributes) => {
    expect(() =>
      loadConfig({ OTEL_RESOURCE_ATTRIBUTES: attributes }),
    ).toThrow("unsupported or unsafe entry");
  });

  it.each([undefined, "", "   "])(
    "fails closed when auth is required without a token (%s)",
    (token) => {
      expect(() =>
        loadConfig({
          SUPPORT_API_REQUIRE_AUTH: "true",
          ...(token === undefined ? {} : { SUPPORT_API_TOKEN: token }),
        }),
      ).toThrow(
        "SUPPORT_API_TOKEN is required when SUPPORT_API_REQUIRE_AUTH is enabled",
      );
    },
  );

  it.each(["0", "false", " FALSE "])(
    "accepts explicit disabled auth value %s without a token",
    (value) => {
      expect(
        loadConfig({ SUPPORT_API_REQUIRE_AUTH: value }).requireAuth,
      ).toBe(false);
    },
  );

  it.each(["0.0.0.0", "192.0.2.10"])(
    "fails closed when a non-loopback host disables auth (%s)",
    (host) => {
      expect(() =>
        loadConfig({
          SUPPORT_API_HOST: host,
          SUPPORT_API_REQUIRE_AUTH: "0",
        }),
      ).toThrow("SUPPORT_API_REQUIRE_AUTH must be enabled for a non-loopback host");
    },
  );

  it.each(["", "yes", "on", "2"])(
    "rejects non-boolean SUPPORT_API_REQUIRE_AUTH value %j",
    (value) => {
      expect(() => loadConfig({ SUPPORT_API_REQUIRE_AUTH: value })).toThrow(
        "SUPPORT_API_REQUIRE_AUTH must be one of: 1, 0, true, false",
      );
    },
  );

  it.each(["", "yes", "on", "2"])(
    "rejects non-boolean OTEL_ENABLED value %j",
    (value) => {
      expect(() => loadConfig({ OTEL_ENABLED: value })).toThrow(
        "OTEL_ENABLED must be one of: 1, 0, true, false",
      );
    },
  );

  it.each(["0", "-1", "65536", "not-a-port", "12.5"])(
    "rejects invalid port %s",
    (port) => {
      expect(() => loadConfig({ SUPPORT_API_PORT: port })).toThrow(
        "SUPPORT_API_PORT must be an integer between 1 and 65535",
      );
    },
  );
});
