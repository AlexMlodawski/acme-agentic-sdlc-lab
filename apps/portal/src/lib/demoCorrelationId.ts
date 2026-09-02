export const DEFAULT_DEMO_CORRELATION_ID = "ACME-LAB-LOCAL";

const MAX_CORRELATION_ID_LENGTH = 128;
const SAFE_CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

export function isSafeDemoCorrelationId(value: string | undefined | null): value is string {
  return typeof value === "string"
    && value.length <= MAX_CORRELATION_ID_LENGTH
    && SAFE_CORRELATION_ID.test(value);
}

export function resolveDemoCorrelationId(value: string | undefined | null): string {
  const candidate = value?.trim();
  return isSafeDemoCorrelationId(candidate)
    ? candidate
    : DEFAULT_DEMO_CORRELATION_ID;
}
