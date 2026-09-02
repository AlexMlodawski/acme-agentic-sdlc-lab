import type { FastifyRequest } from "fastify";

const MAX_CORRELATION_ID_LENGTH = 128;
const SAFE_CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

export function resolveCorrelationId(
  request: FastifyRequest,
  fallback: string,
): string {
  const header = request.headers["x-correlation-id"];
  const candidate = Array.isArray(header) ? header[0] : header;

  if (
    candidate === undefined ||
    candidate.length > MAX_CORRELATION_ID_LENGTH ||
    !SAFE_CORRELATION_ID.test(candidate)
  ) {
    return fallback;
  }

  return candidate;
}
