import { loadConfig } from "./config.js";
import { initializeTelemetry } from "./telemetry.js";

const config = loadConfig();
const telemetry = await initializeTelemetry(config);
// Fastify is loaded after telemetry initialization so auto-instrumentation can
// patch the HTTP modules before the application imports them.
const { buildApp } = await import("./app.js");
const app = await buildApp({ config });

let stopping = false;

async function stop(signal: string): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;

  app.log.info({ event: "shutdown_started", signal }, "shutting down");
  try {
    await app.close();
    await telemetry.shutdown();
    app.log.info({ event: "shutdown_complete" }, "shutdown complete");
  } catch (error) {
    app.log.error({ err: error, event: "shutdown_failed" }, "shutdown failed");
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));

try {
  const address = await app.listen({ host: config.host, port: config.port });
  app.log.info(
    {
      event: "service_started",
      address,
      otel_enabled: telemetry.enabled,
    },
    "Acme Support API listening",
  );
} catch (error) {
  app.log.fatal({ err: error, event: "startup_failed" }, "service startup failed");
  await app.close();
  await telemetry.shutdown();
  process.exitCode = 1;
}
