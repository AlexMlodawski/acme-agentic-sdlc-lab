import { timingSafeEqual } from "node:crypto";

const BEARER_AUTHORIZATION = /^Bearer ([^\s]+)$/i;

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer);
}

export function hasValidBearerToken(
  authorization: string | readonly string[] | undefined,
  expectedToken: string | undefined,
): boolean {
  if (expectedToken === undefined) {
    return true;
  }

  const candidate = Array.isArray(authorization)
    ? authorization[0]
    : authorization;
  const match = candidate === undefined
    ? null
    : BEARER_AUTHORIZATION.exec(candidate);

  if (match?.[1] === undefined) {
    return false;
  }

  return constantTimeEqual(match[1], expectedToken);
}
