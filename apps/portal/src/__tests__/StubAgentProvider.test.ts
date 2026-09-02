import { describe, expect, it, vi } from "vitest";

import { StubAgentProvider } from "@/lib/agent/StubAgentProvider";

const ORDER = {
  orderId: "ACME-1042",
  customerName: "Jordan Lee",
  status: "delayed",
  estimatedDeliveryDate: "2026-08-26",
  carrier: "Acme Express",
  trackingNumber: "AX-88271042",
};

describe("StubAgentProvider", () => {
  it("uses the Support API lookup for a status question", async () => {
    const lookup = vi.fn(async () => ORDER);
    const provider = new StubAgentProvider(lookup);

    const reply = await provider.sendMessage("Where is order acme-1042?");

    expect(lookup).toHaveBeenCalledWith("ACME-1042");
    expect(reply.message).toContain("Order ACME-1042 is delayed");
    expect(reply.message).toContain("August 26, 2026");
    expect(reply.message).toContain("AX-88271042");
  });

  it("asks for an order ID instead of guessing", async () => {
    const lookup = vi.fn(async () => ORDER);
    const provider = new StubAgentProvider(lookup);

    const reply = await provider.sendMessage("Where is my delivery?");

    expect(lookup).not.toHaveBeenCalled();
    expect(reply.message).toContain("Please share the order ID");
  });

  it("reports a missing order without inventing an alternative", async () => {
    const provider = new StubAgentProvider(vi.fn(async () => null));

    const reply = await provider.sendMessage("Track ACME-4040");

    expect(reply.message).toContain("couldn't find order ACME-4040");
    expect(reply.message).toContain("won't guess");
  });

  it("answers a return-only question without calling the order service", async () => {
    const lookup = vi.fn(async () => ORDER);
    const provider = new StubAgentProvider(lookup);

    const reply = await provider.sendMessage("What is the return policy?");

    expect(lookup).not.toHaveBeenCalled();
    expect(reply.message).toContain("30 days");
    expect(reply.message).toMatch(/cannot|confirmed only/);
  });

  it("keeps order facts separate from return-policy guidance", async () => {
    const provider = new StubAgentProvider(vi.fn(async () => ORDER));

    const reply = await provider.sendMessage(
      "What is the status of ACME-1042 and can I return it?",
    );

    expect(reply.message).toContain("Order ACME-1042 is delayed");
    expect(reply.message).toContain("\n\nReturn-policy guidance:");
  });

  it("uses the specific 48-hour damaged-item rule", async () => {
    const provider = new StubAgentProvider(vi.fn(async () => ORDER));

    const reply = await provider.sendMessage("The item is damaged. Can I return it?");

    expect(reply.message).toContain("within 48 hours");
    expect(reply.message).toContain("prepaid return label");
  });

  it("does not promise a refund for personalized products", async () => {
    const provider = new StubAgentProvider(vi.fn(async () => ORDER));

    const reply = await provider.sendMessage("Can I return a personalized product?");

    expect(reply.message).toContain("not eligible");
    expect(reply.message).toContain("cannot promise a refund");
  });

  it("handles a tool failure without exposing an exception", async () => {
    const provider = new StubAgentProvider(
      vi.fn(async () => {
        throw new Error("socket 127.0.0.1:4000 refused");
      }),
    );

    const reply = await provider.sendMessage("Track ACME-1042");

    expect(reply.message).toContain("couldn't check the order status");
    expect(reply.message).not.toContain("socket");
  });
});
