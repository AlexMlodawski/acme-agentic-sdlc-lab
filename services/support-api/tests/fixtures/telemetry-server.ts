import type { AddressInfo } from "node:net";

import { loadConfig, type AppConfig } from "../../src/config.js";
import {
  initializeTelemetry,
  type TelemetryHandle,
} from "../../src/telemetry.js";

const TEST_AGENT_KEY = "SENTINEL-INSTANA-AGENT-KEY";
const TEST_INSTANA_HOST = "acme-telemetry-wire-test";

function loopbackCollectorEndpoint(): string {
  const serialized = process.env.TELEMETRY_TEST_OTLP_ENDPOINT;
  if (serialized === undefined) {
    throw new Error("The telemetry test collector endpoint is required");
  }

  const endpoint = new URL(serialized);
  if (
    endpoint.protocol !== "http:" ||
    endpoint.hostname !== "127.0.0.1" ||
    endpoint.port === "" ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.pathname !== "/" ||
    endpoint.search !== "" ||
    endpoint.hash !== ""
  ) {
    throw new Error("The telemetry test collector must be a loopback HTTP origin");
  }

  return endpoint.origin;
}

async function run(): Promise<void> {
  const endpoint = loopbackCollectorEndpoint();
  const baseConfig = loadConfig({
    SUPPORT_API_HOST: "127.0.0.1",
    SUPPORT_API_PORT: "4000",
    SUPPORT_API_REQUIRE_AUTH: "0",
    DEMO_CORRELATION_ID: "ACME-LAB-LOCAL",
    LOG_LEVEL: "silent",
    OTEL_ENABLED: "1",
    OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
    OTEL_RESOURCE_ATTRIBUTES:
      "service.namespace=acme-lab,service.version=wire-test",
    OTEL_SERVICE_NAME: "acme-support-api",
    DEPLOYMENT_ENVIRONMENT: "local-lab",
  });
  const config: AppConfig = {
    ...baseConfig,
    otelDestination: "instana",
    otelExporterHeaders: {
      "x-instana-key": TEST_AGENT_KEY,
      "x-instana-host": TEST_INSTANA_HOST,
    },
  };

  let telemetry: TelemetryHandle | undefined;
  let app: Awaited<ReturnType<typeof import("../../src/app.js")["buildApp"]>> | undefined;
  try {
    telemetry = await initializeTelemetry(config);
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp({ config });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("The telemetry test API did not bind a TCP port");
    }

    process.stdout.write(
      `${JSON.stringify({
        event: "telemetry_test_ready",
        port: (address as AddressInfo).port,
      })}\n`,
    );

    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
      if (chunk.includes("shutdown")) {
        break;
      }
    }
  } finally {
    await app?.close();
    await telemetry?.shutdown();
  }
}

try {
  await run();
  process.stdout.write(
    `${JSON.stringify({ event: "telemetry_test_stopped", status: "PASS" })}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      event: "telemetry_test_stopped",
      status: "FAIL",
      reason: error instanceof Error ? error.message : "unknown test failure",
    })}\n`,
  );
  process.exitCode = 1;
}
