import { afterEach, describe, expect, it, vi } from "vitest";

const tokenMocks = vi.hoisted(() => ({
  getToken: vi.fn().mockResolvedValue("route-test-access-token"),
  invalidate: vi.fn(),
}));

vi.mock("@/lib/server/supportApi", () => ({
  fetchOrderFromSupportApi: vi.fn(),
}));

vi.mock("@/lib/agent/McspV2TokenProvider", () => ({
  defaultMcspV2TokenProvider: tokenMocks,
}));

import { POST } from "@/app/api/agent/route";

const API_ENDPOINT =
  "https://api.us-east-1.dl.watson-orchestrate.ibm.com/instances/demo-instance";
const AGENT_ID = "00000000-0000-0000-0000-000000000000";
const THREAD_ID = "11111111-1111-1111-1111-111111111111";

function agentRequest(body: unknown) {
  return new Request("http://127.0.0.1:3000/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function configureOrchestrate() {
  vi.stubEnv("AGENT_MODE", "orchestrate");
  vi.stubEnv("WXO_API_ENDPOINT", API_ENDPOINT);
  vi.stubEnv("WXO_AGENT_ID", AGENT_ID);
  vi.stubEnv("WXO_API_KEY", "route-test-api-key");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  tokenMocks.getToken.mockClear();
  tokenMocks.invalidate.mockClear();
});

describe("POST /api/agent", () => {
  it("rejects an invalid or over-broad request body", async () => {
    const response = await POST(agentRequest({ message: "Hello", unexpected: true }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_MESSAGE" });

    const invalidThread = await POST(agentRequest({ message: "Hello", threadId: "bad id" }));
    expect(invalidThread.status).toBe(400);
    await expect(invalidThread.json()).resolves.toMatchObject({ code: "INVALID_THREAD_ID" });

    const invalidOrder = await POST(agentRequest({ message: "Hello", orderId: "ORDER-1042" }));
    expect(invalidOrder.status).toBe(400);
    await expect(invalidOrder.json()).resolves.toMatchObject({ code: "INVALID_ORDER_ID" });
  });

  it("returns a safe 503 when orchestrate mode is not configured", async () => {
    vi.stubEnv("AGENT_MODE", "orchestrate");
    vi.stubEnv("WXO_API_ENDPOINT", "");
    vi.stubEnv("WXO_AGENT_ID", "");
    vi.stubEnv("WXO_API_KEY", "");

    const response = await POST(agentRequest({ message: "Hello" }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "The Orchestrate agent provider is not configured.",
      code: "ORCHESTRATE_NOT_CONFIGURED",
    });
  });

  it("returns only the safe agent response and continues the validated thread", async () => {
    configureOrchestrate();
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: "Order ACME-1042 is delayed." } }],
        thread_id: THREAD_ID,
        internal_tenant_metadata: "must be discarded",
      }), { status: 200 }),
    );
    vi.stubGlobal("fetch", upstream);

    const response = await POST(agentRequest({ message: "Track ACME-1042", threadId: THREAD_ID }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: "Order ACME-1042 is delayed.",
      source: "orchestrate",
      threadId: THREAD_ID,
    });
    expect(new Headers(upstream.mock.calls[0]?.[1]?.headers).get("x-ibm-thread-id")).toBe(THREAD_ID);
  });

  it("passes normalized current-order context in a versioned server-side envelope", async () => {
    configureOrchestrate();
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: "Order ACME-1042 is delayed." } }],
        thread_id: THREAD_ID,
      }), { status: 200 }),
    );
    vi.stubGlobal("fetch", upstream);

    const response = await POST(agentRequest({
      message: " Where is this order? ",
      orderId: " acme-1042 ",
      threadId: THREAD_ID,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: "Order ACME-1042 is delayed.",
      orderId: "ACME-1042",
      source: "orchestrate",
      threadId: THREAD_ID,
    });
    const upstreamBody = JSON.parse(String(upstream.mock.calls[0]?.[1]?.body));
    expect(JSON.parse(upstreamBody.messages[0].content)).toEqual({
      schema: "acme-assistant-message-v1",
      applicationContext: { currentOrderId: "ACME-1042" },
      customerMessage: "Where is this order?",
    });
    expect(new Headers(upstream.mock.calls[0]?.[1]?.headers).get("x-ibm-thread-id")).toBe(THREAD_ID);
  });

  it("maps invalid upstream payloads to a bounded public error", async () => {
    configureOrchestrate();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ choices: [] }), { status: 200 }),
      ),
    );

    const response = await POST(agentRequest({ message: "Hello" }));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "The Store Support Agent returned an invalid response.",
      code: "INVALID_AGENT_RESPONSE",
    });
  });

  it("normalizes upstream errors without reflecting credentials", async () => {
    configureOrchestrate();
    const secret = process.env.WXO_API_KEY as string;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(`upstream detail containing ${secret}`, { status: 500 }),
      ),
    );

    const response = await POST(agentRequest({ message: "Hello" }));
    expect(response.status).toBe(502);
    const payload = await response.text();
    expect(payload).toContain("AGENT_UNAVAILABLE");
    expect(payload).not.toContain(secret);
  });
});
