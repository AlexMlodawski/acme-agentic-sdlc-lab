import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MCSP_V2_MAX_RESPONSE_BYTES,
  MCSP_V2_TOKEN_TIMEOUT_MS,
  McspV2TokenProvider,
  resetMcspV2TokenCacheForTests,
} from "@/lib/agent/McspV2TokenProvider";

const API_ENDPOINT =
  "https://api.us-east-1.dl.watson-orchestrate.ibm.com/instances/demo-instance";
const API_KEY = "SENTINEL-MCSP-V2-KEY-NOT-A-SECRET";
const CONFIGURATION = { apiEndpoint: API_ENDPOINT, apiKey: API_KEY };

function jwt(iat: number, exp: number, marker = "token"): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat, exp, marker })}.signature`;
}

function tokenResponse(token: string): Response {
  return new Response(JSON.stringify({ token }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.useRealTimers();
  resetMcspV2TokenCacheForTests();
});

describe("McspV2TokenProvider", () => {
  it("uses the fixed MCSP V2 service token endpoint and sends the API key only in JSON", async () => {
    const accessToken = jwt(1_000, 1_100);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(tokenResponse(accessToken));
    const provider = new McspV2TokenProvider(fetcher, () => 1_000_000);

    await expect(provider.getToken(CONFIGURATION)).resolves.toBe(accessToken);
    expect(fetcher).toHaveBeenCalledOnce();
    const [input, init] = fetcher.mock.calls[0] ?? [];
    const url = new URL(String(input));
    expect(url.origin).toBe("https://account-iam.platform.saas.ibm.com");
    expect(url.pathname).toBe("/api/2.0/services/demo-instance/apikeys/token");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      includeBuiltinActions: "false",
      includeCustomActions: "false",
      includeRoles: "true",
      prefixRolesWithDefinitionScope: "false",
    });
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("authorization")).toBeNull();
    expect(JSON.parse(String(init?.body))).toEqual({ apikey: API_KEY });
  });

  it("reuses a cached JWT until 80 percent of its TTL", async () => {
    let nowMs = 1_000_000;
    const first = jwt(1_000, 1_100, "first");
    const second = jwt(1_081, 1_181, "second");
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse(first))
      .mockResolvedValueOnce(tokenResponse(second));
    const provider = new McspV2TokenProvider(fetcher, () => nowMs);

    await expect(provider.getToken(CONFIGURATION)).resolves.toBe(first);
    nowMs = 1_079_999;
    await expect(provider.getToken(CONFIGURATION)).resolves.toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    nowMs = 1_080_000;
    await expect(provider.getToken(CONFIGURATION)).resolves.toBe(second);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent token exchanges into one request", async () => {
    const accessToken = jwt(1_000, 1_100);
    let resolveResponse: ((response: Response) => void) | undefined;
    const responsePromise = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetcher = vi.fn<typeof fetch>().mockReturnValue(responsePromise);
    const provider = new McspV2TokenProvider(fetcher, () => 1_000_000);

    const first = provider.getToken(CONFIGURATION);
    const second = provider.getToken(CONFIGURATION);
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolveResponse?.(tokenResponse(accessToken));
    await expect(Promise.all([first, second])).resolves.toEqual([accessToken, accessToken]);
  });

  it("invalidates only the rejected cached token", async () => {
    const first = jwt(1_000, 1_100, "first");
    const second = jwt(1_000, 1_100, "second");
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse(first))
      .mockResolvedValueOnce(tokenResponse(second));
    const provider = new McspV2TokenProvider(fetcher, () => 1_000_000);
    await provider.getToken(CONFIGURATION);
    provider.invalidate(CONFIGURATION, "some-other-token");
    await expect(provider.getToken(CONFIGURATION)).resolves.toBe(first);
    provider.invalidate(CONFIGURATION, first);
    await expect(provider.getToken(CONFIGURATION)).resolves.toBe(second);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fails before fetch for a non-terminal service-instance endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const provider = new McspV2TokenProvider(fetcher);
    await expect(provider.getToken({
      apiEndpoint: `${API_ENDPOINT}/extra`,
      apiKey: API_KEY,
    })).rejects.toMatchObject({ code: "MCSP_V2_ENDPOINT_INVALID" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    "https://evil.example/instances/demo-instance",
    "https://api.us-east-1.dl.watson-orchestrate.ibm.com.evil.example/instances/demo-instance",
    "https://api.us-east-1.dl.watson-orchestrate.ibm.com:444/instances/demo-instance",
    "https://user@api.us-east-1.dl.watson-orchestrate.ibm.com/instances/demo-instance",
  ])("rejects a hostile WXO host before token exchange: %s", async (apiEndpoint) => {
    const fetcher = vi.fn<typeof fetch>();
    const provider = new McspV2TokenProvider(fetcher);
    await expect(provider.getToken({ apiEndpoint, apiKey: API_KEY })).rejects.toMatchObject({
      code: "MCSP_V2_ENDPOINT_INVALID",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([302, 401, 500])("normalizes IAM HTTP %s without exposing secret data", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(`echo ${API_KEY}`, { status }),
    );
    const provider = new McspV2TokenProvider(fetcher);
    const request = provider.getToken(CONFIGURATION);
    await expect(request).rejects.toMatchObject({ code: "MCSP_V2_UPSTREAM_ERROR", status });
    await expect(request).rejects.not.toThrow(API_KEY);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("error");
  });

  it("rejects oversized, malformed, and expired token responses", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", {
        status: 200,
        headers: { "Content-Length": String(MCSP_V2_MAX_RESPONSE_BYTES + 1) },
      }))
      .mockResolvedValueOnce(tokenResponse("not-a-jwt"))
      .mockResolvedValueOnce(tokenResponse(jwt(900, 999)));
    const provider = new McspV2TokenProvider(fetcher, () => 1_000_000);
    await expect(provider.getToken(CONFIGURATION)).rejects.toMatchObject({
      code: "MCSP_V2_RESPONSE_TOO_LARGE",
    });
    await expect(provider.getToken(CONFIGURATION)).rejects.toMatchObject({
      code: "MCSP_V2_RESPONSE_INVALID",
    });
    await expect(provider.getToken(CONFIGURATION)).rejects.toMatchObject({
      code: "MCSP_V2_RESPONSE_INVALID",
    });
  });

  it("times out a stalled IAM exchange", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
    );
    const provider = new McspV2TokenProvider(fetcher);
    const request = provider.getToken(CONFIGURATION);
    const rejection = expect(request).rejects.toMatchObject({ code: "MCSP_V2_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(MCSP_V2_TOKEN_TIMEOUT_MS);
    await rejection;
  });

  it("keeps the IAM timeout active while the response body stalls after headers", async () => {
    vi.useFakeTimers();
    const stalledBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"token":"'));
      },
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(stalledBody, { status: 200 }),
    );
    const provider = new McspV2TokenProvider(fetcher);

    const request = provider.getToken(CONFIGURATION);
    const rejection = expect(request).rejects.toMatchObject({ code: "MCSP_V2_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(MCSP_V2_TOKEN_TIMEOUT_MS);
    await rejection;
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
