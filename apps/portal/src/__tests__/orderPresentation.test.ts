import { describe, expect, it } from "vitest";

import { getOrderPresentation, getOrderTimeline } from "@/lib/orderPresentation";
import type { OrderRecord } from "@/lib/types";

function order(status: string): OrderRecord {
  return {
    orderId: "ACME-1042",
    customerName: "Jordan Lee",
    status,
    estimatedDeliveryDate: "2026-08-26",
    carrier: "Acme Express",
    trackingNumber: "AX-88271042",
  };
}

describe("order presentation", () => {
  it("keeps known order details deterministic and normalizes the lookup ID", () => {
    expect(getOrderPresentation(" acme-1042 ")).toMatchObject({
      itemName: "Voyager carry-on",
      sku: "TRV-VGR-22-SLT",
      total: "$204.12",
    });
    expect(getOrderPresentation("ACME-2048")).toMatchObject({
      itemName: "Everyday commuter pack",
      total: "$139.32",
    });
  });

  it("uses an honest receipt fallback for an order without a UI projection", () => {
    expect(getOrderPresentation("ACME-9999")).toMatchObject({
      itemName: "Acme order item",
      subtotal: "See receipt",
      total: "See receipt",
    });
  });

  it.each([
    ["delayed", "In transit", "Carrier delay reported"],
    ["shipped", "In transit", "Acme Express"],
    ["delivered", "Delivered", "Delivery completed"],
    ["processing", "Preparing", "Getting your order ready"],
  ])("marks the correct current timeline step for %s", (status, label, detail) => {
    const timeline = getOrderTimeline(order(status));
    const current = timeline.filter((step) => step.state === "current");

    expect(current).toEqual([{ label, detail, state: "current" }]);
  });
});
