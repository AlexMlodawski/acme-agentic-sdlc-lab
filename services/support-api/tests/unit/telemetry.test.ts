import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { describe, expect, it, vi } from "vitest";

import {
  observeTraceExporter,
  type TelemetryDiagnosticEvent,
} from "../../src/telemetry.js";

function fakeExporter(resultCode: 0 | 1) {
  return {
    export: vi.fn((spans: unknown[], callback: (result: { code: number }) => void) => {
      expect(spans).toHaveLength(1);
      callback({ code: resultCode });
    }),
    forceFlush: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => undefined),
  } as unknown as OTLPTraceExporter;
}

describe("observed OTLP exporter", () => {
  it.each([
    [0, "PASS"],
    [1, "FAIL"],
  ] as const)("reports completion code %s without exporter details", (code, status) => {
    const delegate = fakeExporter(code);
    const diagnostics: TelemetryDiagnosticEvent[] = [];
    const exporter = observeTraceExporter(
      delegate,
      "instana",
      (event) => diagnostics.push(event),
    );
    const callback = vi.fn();

    exporter.export([{}] as never, callback);

    expect(callback).toHaveBeenCalledWith({ code });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        event: "otel_trace_export",
        status,
        destination: "instana",
        protocol: "http/json",
        span_count: 1,
      }),
    ]);
    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain("header");
    expect(serialized).not.toContain("endpoint");
    expect(serialized).not.toContain("error");
  });
});
