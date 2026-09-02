import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import {
  defaultResource,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";

import type { AppConfig } from "./config.js";

export interface TelemetryHandle {
  readonly enabled: boolean;
  shutdown(): Promise<void>;
}

export interface TelemetryDiagnosticEvent {
  readonly event: "otel_exporter_configured" | "otel_trace_export";
  readonly status: "PASS" | "FAIL";
  readonly destination: "generic" | "instana";
  readonly protocol: "http/json";
  readonly span_count?: number;
  readonly duration_ms?: number;
}

type TelemetryDiagnosticWriter = (event: TelemetryDiagnosticEvent) => void;

function writeTelemetryDiagnostic(event: TelemetryDiagnosticEvent): void {
  try {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  } catch {
    // Diagnostics are best-effort and contain no exporter URL, headers, or
    // payload. A logging failure must not affect the application.
  }
}

function traceExporterUrl(endpoint: string | undefined): string | undefined {
  if (endpoint === undefined) {
    return undefined;
  }

  const withoutTrailingSlash = endpoint.replace(/\/+$/, "");
  return withoutTrailingSlash.endsWith("/v1/traces")
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}/v1/traces`;
}

export function observeTraceExporter(
  delegate: OTLPTraceExporter,
  destination: "generic" | "instana",
  writeDiagnostic: TelemetryDiagnosticWriter = writeTelemetryDiagnostic,
): OTLPTraceExporter {
  const observed = {
    export(
      spans: Parameters<OTLPTraceExporter["export"]>[0],
      callback: Parameters<OTLPTraceExporter["export"]>[1],
    ) {
      const startedAt = performance.now();
      delegate.export(spans, (result) => {
        writeDiagnostic({
          event: "otel_trace_export",
          status: result.code === 0 ? "PASS" : "FAIL",
          destination,
          protocol: "http/json",
          span_count: spans.length,
          duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
        });
        callback(result);
      });
    },
    forceFlush() {
      return delegate.forceFlush();
    },
    shutdown() {
      return delegate.shutdown();
    },
  };

  return observed as OTLPTraceExporter;
}

export async function initializeTelemetry(
  config: AppConfig,
): Promise<TelemetryHandle> {
  if (!config.otelEnabled) {
    return { enabled: false, shutdown: async () => undefined };
  }

  const resource = defaultResource().merge(
    resourceFromAttributes({
      ...config.otelResourceAttributes,
      "service.name": config.serviceName,
      "deployment.environment": config.deploymentEnvironment,
    }),
  );
  const exporterUrl = traceExporterUrl(config.otelExporterEndpoint);
  // A short timeout prevents collector outages from delaying shutdown or
  // affecting the request path. The standard general OTLP endpoint gets the
  // signal-specific /v1/traces suffix.
  const traceExporter = observeTraceExporter(
    new OTLPTraceExporter({
      timeoutMillis: 2_000,
      ...(exporterUrl === undefined ? {} : { url: exporterUrl }),
      ...(config.otelExporterHeaders === undefined
        ? {}
        : { headers: config.otelExporterHeaders }),
    }),
    config.otelDestination,
  );
  const sdk = new NodeSDK({
    // Direct SaaS export uses the approved x-instana-host alias. Disabling
    // discovery prevents Windows MachineGuid, user and executable paths from
    // becoming resource attributes.
    autoDetectResources: false,
    resource,
    traceExporter,
    // The lab exports application request traces only: no host metrics, OTel
    // logs, filesystem spans, or unrelated library instrumentation.
    logRecordProcessors: [],
    metricReaders: [],
    instrumentations: [
      new HttpInstrumentation({
        // This API accepts no query parameters. Skipping query-bearing
        // requests prevents arbitrary public query values from becoming the
        // standard url.query span attribute.
        ignoreIncomingRequestHook: (request) => request.url?.includes("?") === true,
      }),
    ],
  });

  await sdk.start();
  writeTelemetryDiagnostic({
    event: "otel_exporter_configured",
    status: "PASS",
    destination: config.otelDestination,
    protocol: "http/json",
  });

  return {
    enabled: true,
    async shutdown() {
      let timeout: NodeJS.Timeout | undefined;
      const deadline = new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, 3_000);
        timeout.unref();
      });

      try {
        try {
          await Promise.race([sdk.shutdown(), deadline]);
        } catch {
          // Telemetry is best-effort. An unavailable collector must never turn
          // an otherwise clean API shutdown into an application failure.
        }
      } finally {
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
      }
    },
  };
}
