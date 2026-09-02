import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

export const MCSP_V2_TOKEN_TIMEOUT_MS = 10_000;
export const MCSP_V2_MAX_RESPONSE_BYTES = 64 * 1024;

const MCSP_V2_IAM_ORIGIN = "https://account-iam.platform.saas.ibm.com";
const INSTANCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const OFFICIAL_WXO_HOST_PATTERN =
  /^api\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.dl\.watson-orchestrate\.ibm\.com$/;

const tokenResponseSchema = z
  .object({
    token: z.string().trim().min(1).max(16_384),
  })
  .passthrough();

const jwtClaimsSchema = z.object({
  exp: z.number().int().positive(),
  iat: z.number().int().nonnegative(),
});

export interface McspV2TokenConfiguration {
  apiEndpoint: string;
  apiKey: string;
}

export interface OrchestrateAccessTokenSource {
  getToken(configuration: McspV2TokenConfiguration): Promise<string>;
  invalidate(configuration: McspV2TokenConfiguration, rejectedToken: string): void;
}

interface CachedToken {
  token: string;
  refreshAtMs: number;
}

export type McspV2TokenErrorCode =
  | "MCSP_V2_ENDPOINT_INVALID"
  | "MCSP_V2_TIMEOUT"
  | "MCSP_V2_UNAVAILABLE"
  | "MCSP_V2_UPSTREAM_ERROR"
  | "MCSP_V2_RESPONSE_TOO_LARGE"
  | "MCSP_V2_RESPONSE_INVALID";

export class McspV2TokenError extends Error {
  readonly code: McspV2TokenErrorCode;
  readonly status?: number;

  constructor(code: McspV2TokenErrorCode, status?: number) {
    super("The watsonx Orchestrate authentication service is unavailable.");
    this.name = "McspV2TokenError";
    this.code = code;
    this.status = status;
  }
}

const tokenCache = new Map<string, CachedToken>();
const tokenRequests = new Map<string, Promise<CachedToken>>();

function configurationCacheKey(configuration: McspV2TokenConfiguration): string {
  return createHash("sha256")
    .update(configuration.apiEndpoint)
    .update("\0")
    .update(configuration.apiKey)
    .digest("hex");
}

function serviceInstanceId(apiEndpoint: string): string {
  try {
    const url = new URL(apiEndpoint);
    const match = url.pathname.match(/^\/instances\/([^/]+)\/?$/);
    const instanceId = match?.[1];
    if (
      url.protocol !== "https:"
      || !OFFICIAL_WXO_HOST_PATTERN.test(url.hostname)
      || url.port !== ""
      || url.username
      || url.password
      || url.search
      || url.hash
      || !instanceId
      || !INSTANCE_ID_PATTERN.test(instanceId)
    ) {
      throw new Error("invalid endpoint");
    }
    return instanceId;
  } catch {
    throw new McspV2TokenError("MCSP_V2_ENDPOINT_INVALID");
  }
}

function parseJwtRefreshTime(token: string, nowMs: number): number {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[1]) {
      throw new Error("invalid JWT");
    }
    const encodedClaims = parts[1];
    if (encodedClaims.length > 32 * 1024) {
      throw new Error("oversized JWT claims");
    }
    const claims = jwtClaimsSchema.parse(
      JSON.parse(Buffer.from(encodedClaims, "base64url").toString("utf8")),
    );
    if (claims.exp <= claims.iat || claims.exp * 1_000 <= nowMs) {
      throw new Error("expired JWT");
    }
    return (claims.iat + (claims.exp - claims.iat) * 0.8) * 1_000;
  } catch {
    throw new McspV2TokenError("MCSP_V2_RESPONSE_INVALID");
  }
}

async function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  let removeAbortListener: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", onAbort);
  });

  try {
    return await Promise.race([reader.read(), aborted]);
  } finally {
    removeAbortListener();
  }
}

async function readBoundedTokenResponse(
  response: Response,
  signal: AbortSignal,
): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MCSP_V2_MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new McspV2TokenError("MCSP_V2_RESPONSE_TOO_LARGE");
  }
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await readStreamChunk(reader, signal);
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > MCSP_V2_MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new McspV2TokenError("MCSP_V2_RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (signal.aborted) {
      void reader.cancel().catch(() => undefined);
    }
    throw error;
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

export class McspV2TokenProvider implements OrchestrateAccessTokenSource {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async getToken(configuration: McspV2TokenConfiguration): Promise<string> {
    const cacheKey = configurationCacheKey(configuration);
    const cached = tokenCache.get(cacheKey);
    if (cached && this.now() < cached.refreshAtMs) {
      return cached.token;
    }

    const activeRequest = tokenRequests.get(cacheKey);
    if (activeRequest) {
      return (await activeRequest).token;
    }

    const request = this.exchangeToken(configuration);
    tokenRequests.set(cacheKey, request);
    try {
      const fresh = await request;
      tokenCache.set(cacheKey, fresh);
      return fresh.token;
    } finally {
      if (tokenRequests.get(cacheKey) === request) {
        tokenRequests.delete(cacheKey);
      }
    }
  }

  invalidate(configuration: McspV2TokenConfiguration, rejectedToken: string): void {
    const cacheKey = configurationCacheKey(configuration);
    if (tokenCache.get(cacheKey)?.token === rejectedToken) {
      tokenCache.delete(cacheKey);
    }
  }

  private async exchangeToken(
    configuration: McspV2TokenConfiguration,
  ): Promise<CachedToken> {
    const instanceId = serviceInstanceId(configuration.apiEndpoint);
    const requestUrl = new URL(
      `/api/2.0/services/${encodeURIComponent(instanceId)}/apikeys/token`,
      MCSP_V2_IAM_ORIGIN,
    );
    requestUrl.search = new URLSearchParams({
      includeBuiltinActions: "false",
      includeCustomActions: "false",
      includeRoles: "true",
      prefixRolesWithDefinitionScope: "false",
    }).toString();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MCSP_V2_TOKEN_TIMEOUT_MS);
    try {
      const response = await this.fetcher(requestUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ apikey: configuration.apiKey }),
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new McspV2TokenError("MCSP_V2_UPSTREAM_ERROR", response.status);
      }

      let payload: unknown;
      try {
        payload = JSON.parse(await readBoundedTokenResponse(response, controller.signal));
      } catch (error) {
        if (error instanceof McspV2TokenError) {
          throw error;
        }
        if (controller.signal.aborted) {
          throw error;
        }
        throw new McspV2TokenError("MCSP_V2_RESPONSE_INVALID");
      }
      const parsed = tokenResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new McspV2TokenError("MCSP_V2_RESPONSE_INVALID");
      }

      return {
        token: parsed.data.token,
        refreshAtMs: parseJwtRefreshTime(parsed.data.token, this.now()),
      };
    } catch (error) {
      if (error instanceof McspV2TokenError) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new McspV2TokenError("MCSP_V2_TIMEOUT");
      }
      throw new McspV2TokenError("MCSP_V2_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const defaultMcspV2TokenProvider = new McspV2TokenProvider();

export function resetMcspV2TokenCacheForTests(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Token cache reset is available only in tests.");
  }
  tokenCache.clear();
  tokenRequests.clear();
}
