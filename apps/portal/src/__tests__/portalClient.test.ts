import { describe, expect, it, vi } from "vitest";

import {
  lookupOrder,
  sendAssistantMessage,
} from "@/lib/portalClient";

const ORDER = {
  orderId: "ACME-1042",
  customerName: "Jordan Lee",
  status: "delayed",
  estimatedDeliveryDate: "2026-08-26",
  carrier: "Acme Express",
  trackingNumber: "AX-88271042",
};

describe("portal API client", () => {
  it("normalizes an order ID and validates the lookup response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(ORDER), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(lookupOrder(" acme-1042 ", fetcher)).resolves.toEqual(ORDER);
    expect(fetcher).toHaveBeenCalledWith("/api/orders/ACME-1042", { cache: "no-store" });
  });

  it("turns a missing order into a safe typed error", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ code: "ORDER_NOT_FOUND" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(lookupOrder("ACME-4040", fetcher)).rejects.toMatchObject({
      status: 404,
      code: "ORDER_NOT_FOUND",
      message: "We couldn't find that order.",
    });
  });

  it("validates deterministic agent replies", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: "Order ACME-1042 is delayed.",
          orderId: "ACME-1042",
          source: "stub",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(sendAssistantMessage({ message: "Status of ACME-1042?" }, { fetcher })).resolves.toMatchObject({
      orderId: "ACME-1042",
      source: "stub",
    });
  });

  it("sends and validates the optional Orchestrate thread ID", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: "The order is delayed and the standard return window is 30 days.",
          source: "orchestrate",
          threadId: "11111111-1111-1111-1111-111111111111",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      sendAssistantMessage({
        message: "What about its return policy?",
        threadId: "00000000-0000-0000-0000-000000000000",
      }, { fetcher }),
    ).resolves.toMatchObject({
      source: "orchestrate",
      threadId: "11111111-1111-1111-1111-111111111111",
    });

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      message: "What about its return policy?",
      threadId: "00000000-0000-0000-0000-000000000000",
    });
  });

  it("sends canonical optional order context", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: "Order ACME-1042 is delayed.",
          orderId: "ACME-1042",
          source: "orchestrate",
          threadId: "11111111-1111-1111-1111-111111111111",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(sendAssistantMessage({
      message: " Where is this order? ",
      orderId: " acme-1042 ",
      threadId: " 00000000-0000-0000-0000-000000000000 ",
    }, { fetcher })).resolves.toMatchObject({
      orderId: "ACME-1042",
      source: "orchestrate",
    });

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      message: "Where is this order?",
      orderId: "ACME-1042",
      threadId: "00000000-0000-0000-0000-000000000000",
    });
  });

  it("rejects response expansion and unknown server error codes", async () => {
    const expandedResponse = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        message: "Order ACME-1042 is delayed.",
        source: "orchestrate",
        threadId: "11111111-1111-1111-1111-111111111111",
        tenantMetadata: "must-not-cross",
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    await expect(sendAssistantMessage({ message: "Hello" }, { fetcher: expandedResponse }))
      .rejects.toMatchObject({ code: "INVALID_AGENT_RESPONSE" });

    const unknownError = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ code: "UNTRUSTED_UPSTREAM_CODE" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(sendAssistantMessage({ message: "Hello" }, { fetcher: unknownError }))
      .rejects.toMatchObject({ code: "AGENT_REQUEST_FAILED", status: 502 });
  });
});
