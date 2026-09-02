import { describe, expect, it } from "vitest";

import { findOrder, listOrders, normalizeOrderId } from "../../src/orders.js";

describe("deterministic order lookup", () => {
  it("returns the canonical fictional order", () => {
    expect(findOrder("ACME-1042")).toEqual({
      orderId: "ACME-1042",
      customerName: "Jordan Lee",
      status: "delayed",
      estimatedDeliveryDate: "2026-08-26",
      carrier: "Acme Express",
      trackingNumber: "AX-88271042",
    });
  });

  it("normalizes whitespace and case", () => {
    expect(normalizeOrderId("  acme-2048 ")).toBe("ACME-2048");
    expect(findOrder("  acme-2048 ")?.orderId).toBe("ACME-2048");
  });

  it("keeps the not-found fixture absent and never generates records", () => {
    expect(findOrder("ACME-4040")).toBeUndefined();
    expect(listOrders()).toHaveLength(3);
    expect(listOrders().map((order) => order.orderId)).toEqual([
      "ACME-1042",
      "ACME-2048",
      "ACME-3096",
    ]);
  });
});
