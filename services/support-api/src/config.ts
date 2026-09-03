const DEFAULT_CORRELATION_ID = "ACME-LAB-LOCAL";
const DEFAULT_SERVICE_NAME = "acme-support-api";
const DEFAULT_DEPLOYMENT_ENVIRONMENT = "local-lab";
const INSTANA_OTLP_HTTP_HOST = "otlp-http-blue-saas.instana.io";
const MAX_CORRELATION_ID_LENGTH = 128;
const SAFE_CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const SAFE_RESOURCE_ATTRIBUTE_NAMES = new Set([
  "deployment.environment",
  "service.name",
  "service.namespace",
  "service.version",
]);

export type OtlpDestination = "generic" | "instana";

export interface AppConfig {
  readonly host: string;
  readonly port: number;
  readonly logLevel: string;
  readonly requireAuth: boolean;
  readonly supportApiToken?: string;
  readonly correlationId: string;
  readonly serviceName: string;
  readonly deploymentEnvironment: string;
  readonly corsOrigins: readonly string[];
  readonly otelEnabled: boolean;
  readonly otelExporterEndpoint?: string;
  readonly otelExporterHeaders?: Readonly<Record<string, string>>;
  readonly otelDestination: OtlpDestination;
  readonly otelResourceAttributes?: Readonly<Record<string, string>>;
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return 4000;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("SUPPORT_API_PORT must be an integer between 1 and 65535");
  }

  return parsed;
}

function parseStrictBoolean(
  name: string,
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
      return true;
    case "0":
    case "false":
      return false;
    default:
      throw new Error(`${name} must be one of: 1, 0, true, false`);
  }
}

function parseSafeResourceAttributes(
  serialized: string | undefined,
): Readonly<Record<string, string>> | undefined {
  const normalized = optionalNonEmpty(serialized);
  if (normalized === undefined) {
    return undefined;
  }

  const result: Record<string, string> = {};
  for (const rawEntry of normalized.split(",")) {
    const entry = rawEntry.trim();
    const separator = entry.indexOf("=");
    const key = separator < 0 ? "" : entry.slice(0, separator).trim();
    const value = separator < 0 ? "" : entry.slice(separator + 1).trim();
    if (
      !SAFE_RESOURCE_ATTRIBUTE_NAMES.has(key) ||
      value.length === 0 ||
      value.length > 128 ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value) ||
      Object.hasOwn(result, key)
    ) {
      throw new Error(
        "OTEL_RESOURCE_ATTRIBUTES contains an unsupported or unsafe entry",
      );
    }
    result[key] = value;
  }
  return result;
}

function optionalNonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized === "" ? undefined : normalized;
}

function parseCorrelationId(value: string | undefined): string {
  const normalized = optionalNonEmpty(value);
  if (normalized === undefined) return DEFAULT_CORRELATION_ID;
  if (
    normalized.length > MAX_CORRELATION_ID_LENGTH
    || !SAFE_CORRELATION_ID.test(normalized)
  ) {
    throw new Error("DEMO_CORRELATION_ID must be a bounded safe identifier");
  }
  return normalized;
}

function validateInstanaAgentKey(value: string | undefined): string {
  const raw = value ?? "";
  const normalized = optionalNonEmpty(value);
  if (
    normalized === undefined ||
    raw.length > 4_096 ||
    /[\u0000-\u001f\u007f]/u.test(raw)
  ) {
    throw new Error(
      "INSTANA_AGENT_KEY is required and must be a bounded single-line value",
    );
  }
  return normalized;
}

function validateInstanaHost(value: string | undefined): string {
  const normalized = optionalNonEmpty(value);
  if (
    normalized === undefined ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(normalized)
  ) {
    throw new Error("INSTANA_OTLP_HOST must be a safe service identity");
  }
  return normalized;
}

function validateInstanaHttpEndpoint(value: string | undefined): string {
  const normalized = optionalNonEmpty(value);
  if (normalized === undefined) {
    throw new Error("INSTANA_OTLP_HTTP_ENDPOINT is required");
  }

  let endpoint: URL;
  try {
    endpoint = new URL(normalized);
  } catch {
    throw new Error("INSTANA_OTLP_HTTP_ENDPOINT must be a valid HTTPS URL");
  }

  if (
    endpoint.protocol !== "https:" ||
    endpoint.hostname.toLowerCase() !== INSTANA_OTLP_HTTP_HOST ||
    (endpoint.port !== "" && endpoint.port !== "443") ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.search !== "" ||
    endpoint.hash !== "" ||
    !new Set(["/", "/v1/traces"]).has(endpoint.pathname)
  ) {
    throw new Error(
      "INSTANA_OTLP_HTTP_ENDPOINT must be the approved blue SaaS OTLP/HTTP endpoint",
    );
  }

  return normalized;
}

function parseOrigins(value: string | undefined): readonly string[] {
  const defaults = ["http://127.0.0.1:3000", "http://localhost:3000"];
  if (value === undefined || value.trim() === "") {
    return defaults;
  }

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const host = optionalNonEmpty(environment.SUPPORT_API_HOST) ?? "127.0.0.1";
  const supportApiToken = optionalNonEmpty(environment.SUPPORT_API_TOKEN);
  const requireAuth = parseStrictBoolean(
    "SUPPORT_API_REQUIRE_AUTH",
    environment.SUPPORT_API_REQUIRE_AUTH,
    false,
  );
  if (requireAuth && supportApiToken === undefined) {
    throw new Error(
      "SUPPORT_API_TOKEN is required when SUPPORT_API_REQUIRE_AUTH is enabled",
    );
  }
  if (!new Set(["127.0.0.1", "::1", "localhost"]).has(host.toLowerCase()) && !requireAuth) {
    throw new Error(
      "SUPPORT_API_REQUIRE_AUTH must be enabled for a non-loopback host",
    );
  }
  const endpoint = optionalNonEmpty(environment.OTEL_EXPORTER_OTLP_ENDPOINT);
  const instanaAgentKeyRaw = environment.INSTANA_AGENT_KEY;
  const instanaAgentKey = optionalNonEmpty(instanaAgentKeyRaw);
  const instanaEndpoint = optionalNonEmpty(
    environment.INSTANA_OTLP_HTTP_ENDPOINT,
  );
  const instanaHost = optionalNonEmpty(environment.INSTANA_OTLP_HOST);
  const instanaConfigured =
    instanaAgentKey !== undefined ||
    instanaEndpoint !== undefined ||
    instanaHost !== undefined;
  const resourceAttributes = parseSafeResourceAttributes(
    environment.OTEL_RESOURCE_ATTRIBUTES,
  );
  const otelEnabled = parseStrictBoolean(
    "OTEL_ENABLED",
    environment.OTEL_ENABLED,
    false,
  );
  if (instanaConfigured && !otelEnabled) {
    throw new Error("OTEL_ENABLED must be enabled for Instana OTLP export");
  }
  const validatedInstanaEndpoint = instanaConfigured
    ? validateInstanaHttpEndpoint(instanaEndpoint)
    : undefined;
  const instanaHeaders = instanaConfigured
    ? {
        "x-instana-key": validateInstanaAgentKey(instanaAgentKeyRaw),
        "x-instana-host": validateInstanaHost(instanaHost),
      }
    : undefined;
  const exporterEndpoint = validatedInstanaEndpoint ?? endpoint;

  return {
    host,
    port: parsePort(environment.SUPPORT_API_PORT),
    logLevel: optionalNonEmpty(environment.LOG_LEVEL) ?? "info",
    requireAuth,
    ...(supportApiToken === undefined ? {} : { supportApiToken }),
    correlationId: parseCorrelationId(environment.DEMO_CORRELATION_ID),
    serviceName:
      optionalNonEmpty(environment.OTEL_SERVICE_NAME) ?? DEFAULT_SERVICE_NAME,
    deploymentEnvironment:
      optionalNonEmpty(environment.DEPLOYMENT_ENVIRONMENT) ??
      DEFAULT_DEPLOYMENT_ENVIRONMENT,
    corsOrigins: parseOrigins(environment.CORS_ORIGIN),
    otelEnabled,
    otelDestination: instanaConfigured ? "instana" : "generic",
    ...(exporterEndpoint === undefined
      ? {}
      : { otelExporterEndpoint: exporterEndpoint }),
    ...(instanaHeaders === undefined
      ? {}
      : { otelExporterHeaders: instanaHeaders }),
    ...(resourceAttributes === undefined
      ? {}
      : { otelResourceAttributes: resourceAttributes }),
  };
}

export const configDefaults = {
  correlationId: DEFAULT_CORRELATION_ID,
  serviceName: DEFAULT_SERVICE_NAME,
  deploymentEnvironment: DEFAULT_DEPLOYMENT_ENVIRONMENT,
} as const;
