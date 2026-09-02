import { describe, expect, it } from "vitest";

import {
  formatDeliveryDate,
  formatOrderStatus,
  getOrderStatusTone,
} from "@/lib/formatters";

describe("portal formatters", () => {
  it("formats stable order status labels", () => {
    expect(formatOrderStatus("in_transit")).toBe("In Transit");
    expect(formatOrderStatus(" delayed ")).toBe("Delayed");
  });

  it("formats date-only values without a local timezone shift", () => {
    expect(formatDeliveryDate("2026-08-26")).toBe("August 26, 2026");
    expect(formatDeliveryDate("not-a-date")).toBe("Date unavailable");
  });

  it("maps known statuses to accessible presentation tones", () => {
    expect(getOrderStatusTone("delayed")).toBe("warning");
    expect(getOrderStatusTone("delivered")).toBe("success");
    expect(getOrderStatusTone("in_transit")).toBe("neutral");
  });
});
