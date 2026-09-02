import { createHash, timingSafeEqual } from "node:crypto";

const BEARER_AUTHORIZATION = /^Bearer ([^\s]+)$/i;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
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

  return timingSafeEqual(digest(match[1]), digest(expectedToken));
}
