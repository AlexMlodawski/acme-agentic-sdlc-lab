import { afterEach, describe, expect, it, vi } from "vitest";

import { NotConfiguredError } from "@/lib/agent/AgentProvider";
import type { OrchestrateAccessTokenSource } from "@/lib/agent/McspV2TokenProvider";
import {
  ORCHESTRATE_DEFAULT_TIMEOUT_MS,
  ORCHESTRATE_MAX_RESPONSE_BYTES,
  OrchestrateAgentProvider,
} from "@/lib/agent/OrchestrateAgentProvider";

const API_ENDPOINT =
  "https://api.us-east-1.dl.watson-orchestrate.ibm.com/instances/demo-instance";
const AGENT_ID = "00000000-0000-0000-0000-000000000000";
const API_KEY = "SENTINEL-WXO-API-KEY-NOT-A-SECRET";
const ACCESS_TOKEN = "SENTINEL-SHORT-LIVED-JWT-NOT-A-SECRET";
const THREAD_ID = "11111111-1111-1111-1111-111111111111";

function configureProvider() {
  vi.stubEnv("WXO_API_ENDPOINT", API_ENDPOINT);
  vi.stubEnv("WXO_AGENT_ID", AGENT_ID);
  vi.stubEnv("WXO_API_KEY", API_KEY);
}

function tokenSource(tokens: string[] = [ACCESS_TOKEN]) {
  return {
    getToken: vi.fn<OrchestrateAccessTokenSource["getToken"]>()
      .mockImplementation(async () => tokens.shift() ?? ACCESS_TOKEN),
    invalidate: vi.fn<OrchestrateAccessTokenSource["invalidate"]>(),
  } satisfies OrchestrateAccessTokenSource;
}

function completion(message = "Order ACME-1042 is delayed.", threadId = THREAD_ID) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content: message } }],
      thread_id: threadId,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("OrchestrateAgentProvider", () => {
  it("fails closed without complete server-side configuration", async () => {
    vi.stubEnv("WXO_API_ENDPOINT", "");
    vi.stubEnv("WXO_AGENT_ID", "");
    vi.stubEnv("WXO_API_KEY", "");
    const source = tokenSource();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    await expect(
      new OrchestrateAgentProvider(source).sendMessage("Hello"),
    ).rejects.toBeInstanceOf(NotConfiguredError);
    expect(source.getToken).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects an invalid endpoint shape and out-of-range timeout", async () => {
    configureProvider();
    vi.stubEnv(
      "WXO_API_ENDPOINT",
      "https://api.us-east-1.dl.watson-orchestrate.ibm.com/not-an-instance",
    );
    await expect(
      new OrchestrateAgentProvider(tokenSource()).sendMessage("Hello"),
    ).rejects.toBeInstanceOf(NotConfiguredError);

    vi.stubEnv("WXO_API_ENDPOINT", API_ENDPOINT);
    vi.stubEnv("WXO_REQUEST_TIMEOUT_MS", "120001");
    await expect(
      new OrchestrateAgentProvider(tokenSource()).sendMessage("Hello"),
    ).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it.each([
    "https://evil.example/instances/demo-instance",
    "https://api.us-east-1.dl.watson-orchestrate.ibm.com.evil.example/instances/demo-instance",
    "https://api.us-east-1.dl.watson-orchestrate.ibm.com:444/instances/demo-instance",
    "https://user@api.us-east-1.dl.watson-orchestrate.ibm.com/instances/demo-instance",
    "https://api.us-east-1.dl.watson-orchestrate.ibm.com/instances/demo-instance/extra",
  ])("rejects a non-official or non-terminal WXO endpoint: %s", async (endpoint) => {
    configureProvider();
    vi.stubEnv("WXO_API_ENDPOINT", endpoint);
    const source = tokenSource();
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);

    await expect(
      new OrchestrateAgentProvider(source).sendMessage("Hello"),
    ).rejects.toBeInstanceOf(NotConfiguredError);
    expect(source.getToken).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses the official non-streaming endpoint and keeps API-key exchange server-side", async () => {
    configureProvider();
    const source = tokenSource();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completion());
    vi.stubGlobal("fetch", fetcher);

    await expect(
      new OrchestrateAgentProvider(source).sendMessage("Track ACME-1042", THREAD_ID),
    ).resolves.toEqual({
      message: "Order ACME-1042 is delayed.",
      source: "orchestrate",
      threadId: THREAD_ID,
    });

    expect(source.getToken).toHaveBeenCalledWith({
      apiEndpoint: API_ENDPOINT,
      apiKey: API_KEY,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const call = fetcher.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error("Expected an upstream fetch call");
    const [url, init] = call;
    expect(url).toBe(`${API_ENDPOINT}/v1/orchestrate/${AGENT_ID}/chat/completions`);
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(headers.get("x-ibm-thread-id")).toBe(THREAD_ID);
    expect(headers.get("authorization")).not.toContain(API_KEY);
    expect(init?.redirect).toBe("error");
    expect(JSON.parse(String(init?.body))).toEqual({
      messages: [{ role: "user", content: "Track ACME-1042" }],
      stream: false,
    });
  });

  it("parses structured text and requires a response thread UUID", async () => {
    configureProvider();
    const source = tokenSource();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: [
          { type: "text", text: "Standard returns: " },
          { text: "30 days." },
        ] } }],
        thread_id: THREAD_ID,
      }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      new OrchestrateAgentProvider(source).sendMessage("Return policy"),
    ).resolves.toMatchObject({
      message: "Standard returns: 30 days.",
      threadId: THREAD_ID,
    });

    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: "Missing ID" } }] })),
    );
    await expect(
      new OrchestrateAgentProvider(source).sendMessage("Hello"),
    ).rejects.toMatchObject({ code: "INVALID_ORCHESTRATE_RESPONSE" });
  });

  it("times out a stalled upstream request using the bounded default", async () => {
    configureProvider();
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
    vi.stubGlobal("fetch", fetcher);
    const request = new OrchestrateAgentProvider(tokenSource()).sendMessage("Hello");
    const rejection = expect(request).rejects.toMatchObject({ code: "ORCHESTRATE_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(ORCHESTRATE_DEFAULT_TIMEOUT_MS);
    await rejection;
  });

  it("keeps the timeout active while the response body stalls after headers", async () => {
    configureProvider();
    vi.useFakeTimers();
    const stalledBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"choices":['));
      },
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(stalledBody, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetcher);

    const request = new OrchestrateAgentProvider(tokenSource()).sendMessage("Hello");
    const rejection = expect(request).rejects.toMatchObject({ code: "ORCHESTRATE_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(ORCHESTRATE_DEFAULT_TIMEOUT_MS);
    await rejection;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refreshes once after 401 and then succeeds", async () => {
    configureProvider();
    const source = tokenSource(["expired-token", "fresh-token"]);
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(completion());
    vi.stubGlobal("fetch", fetcher);

    await expect(
      new OrchestrateAgentProvider(source).sendMessage("Hello"),
    ).resolves.toMatchObject({ source: "orchestrate", threadId: THREAD_ID });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(source.invalidate).toHaveBeenCalledOnce();
    expect(source.invalidate).toHaveBeenCalledWith(
      { apiEndpoint: API_ENDPOINT, apiKey: API_KEY },
      "expired-token",
    );
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("authorization"))
      .toBe("Bearer fresh-token");
  });

  it("refreshes exactly once when the replacement token is also rejected", async () => {
    configureProvider();
    const source = tokenSource(["expired-token", "replacement-token"]);
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetcher);

    await expect(
      new OrchestrateAgentProvider(source).sendMessage("Hello"),
    ).rejects.toMatchObject({ code: "ORCHESTRATE_UPSTREAM_ERROR", status: 401 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(source.getToken).toHaveBeenCalledTimes(2);
    expect(source.invalidate).toHaveBeenCalledOnce();
  });

  it.each([403, 429, 500])(
    "normalizes upstream HTTP %s without retries or reflected secrets",
    async (status) => {
      configureProvider();
      const source = tokenSource();
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(`upstream echoed ${API_KEY} ${ACCESS_TOKEN}`, { status }),
      );
      vi.stubGlobal("fetch", fetcher);
      const request = new OrchestrateAgentProvider(source).sendMessage("Hello");
      await expect(request).rejects.toMatchObject({ code: "ORCHESTRATE_UPSTREAM_ERROR", status });
      await expect(request).rejects.not.toThrow(API_KEY);
      await expect(request).rejects.not.toThrow(ACCESS_TOKEN);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(source.invalidate).not.toHaveBeenCalled();
    },
  );

  it("does not retry a network failure", async () => {
    configureProvider();
    const source = tokenSource();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("network failure"));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      new OrchestrateAgentProvider(source).sendMessage("Hello"),
    ).rejects.toMatchObject({ code: "ORCHESTRATE_UNAVAILABLE" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(source.invalidate).not.toHaveBeenCalled();
  });

  it("rejects redirects without making a second authenticated request", async () => {
    configureProvider();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 302, headers: { Location: "https://redirect.example.test/collect" } }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      new OrchestrateAgentProvider(tokenSource()).sendMessage("Hello"),
    ).rejects.toMatchObject({ code: "ORCHESTRATE_UPSTREAM_ERROR", status: 302 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("error");
  });

  it("rejects oversized and schema-invalid responses", async () => {
    configureProvider();
    const oversized = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("", {
        status: 200,
        headers: { "Content-Length": String(ORCHESTRATE_MAX_RESPONSE_BYTES + 1) },
      }),
    );
    vi.stubGlobal("fetch", oversized);
    await expect(
      new OrchestrateAgentProvider(tokenSource()).sendMessage("Hello"),
    ).rejects.toMatchObject({ code: "ORCHESTRATE_RESPONSE_TOO_LARGE" });

    const invalid = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", invalid);
    await expect(
      new OrchestrateAgentProvider(tokenSource()).sendMessage("Hello"),
    ).rejects.toMatchObject({ code: "INVALID_ORCHESTRATE_RESPONSE" });
  });
});
