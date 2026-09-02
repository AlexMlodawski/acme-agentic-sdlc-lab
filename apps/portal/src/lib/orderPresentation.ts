import type { OrderRecord } from "@/lib/types";

export type TimelineStepState = "complete" | "current" | "upcoming";

export interface OrderTimelineStep {
  label: string;
  detail: string;
  state: TimelineStepState;
}

export interface OrderPresentation {
  itemName: string;
  itemVariant: string;
  sku: string;
  quantity: number;
  subtotal: string;
  shipping: string;
  tax: string;
  total: string;
  destination: string;
  returnSummary: string;
}

const KNOWN_ORDER_PRESENTATION: Readonly<Record<string, OrderPresentation>> = {
  "ACME-1042": {
    itemName: "Voyager carry-on",
    itemVariant: "Slate / 22 inch",
    sku: "TRV-VGR-22-SLT",
    quantity: 1,
    subtotal: "$189.00",
    shipping: "Included",
    tax: "$15.12",
    total: "$204.12",
    destination: "Chicago, IL 60611",
    returnSummary: "Eligible for return review for 30 days after delivery.",
  },
  "ACME-2048": {
    itemName: "Everyday commuter pack",
    itemVariant: "Moss / 24 liter",
    sku: "BAG-CMT-24-MOS",
    quantity: 1,
    subtotal: "$129.00",
    shipping: "Included",
    tax: "$10.32",
    total: "$139.32",
    destination: "Austin, TX 78701",
    returnSummary: "Eligible for return review for 30 days after delivery.",
  },
  "ACME-3096": {
    itemName: "Weekender duffel",
    itemVariant: "Navy / 38 liter",
    sku: "BAG-WKD-38-NVY",
    quantity: 1,
    subtotal: "$149.00",
    shipping: "Included",
    tax: "$11.92",
    total: "$160.92",
    destination: "Portland, OR 97205",
    returnSummary: "Return review is available for 30 days from the delivery date.",
  },
};

const FALLBACK_PRESENTATION: OrderPresentation = {
  itemName: "Acme order item",
  itemVariant: "Standard configuration",
  sku: "ACME-ITEM",
  quantity: 1,
  subtotal: "See receipt",
  shipping: "See receipt",
  tax: "See receipt",
  total: "See receipt",
  destination: "Saved delivery address",
  returnSummary: "Eligibility is confirmed after the order has been reviewed.",
};

export function getOrderPresentation(orderId: string): OrderPresentation {
  return KNOWN_ORDER_PRESENTATION[orderId.trim().toUpperCase()] ?? FALLBACK_PRESENTATION;
}

export function getOrderTimeline(order: OrderRecord): readonly OrderTimelineStep[] {
  const status = order.status.trim().toLowerCase();

  if (["delivered", "complete", "completed"].includes(status)) {
    return [
      { label: "Order confirmed", detail: "Payment received", state: "complete" },
      { label: "Prepared", detail: "Packed for delivery", state: "complete" },
      { label: "In transit", detail: order.carrier, state: "complete" },
      { label: "Delivered", detail: "Delivery completed", state: "current" },
    ];
  }

  if (["shipped", "in_transit", "in transit"].includes(status)) {
    return [
      { label: "Order confirmed", detail: "Payment received", state: "complete" },
      { label: "Prepared", detail: "Packed for delivery", state: "complete" },
      { label: "In transit", detail: order.carrier, state: "current" },
      { label: "Delivered", detail: "Expected next", state: "upcoming" },
    ];
  }

  if (["delayed", "exception"].includes(status)) {
    return [
      { label: "Order confirmed", detail: "Payment received", state: "complete" },
      { label: "Prepared", detail: "Packed for delivery", state: "complete" },
      { label: "In transit", detail: "Carrier delay reported", state: "current" },
      { label: "Delivered", detail: "Pending carrier update", state: "upcoming" },
    ];
  }

  if (status === "cancelled") {
    return [
      { label: "Order confirmed", detail: "Payment received", state: "complete" },
      { label: "Cancelled", detail: "Order will not ship", state: "current" },
      { label: "Refund review", detail: "Follow your payment method", state: "upcoming" },
    ];
  }

  return [
    { label: "Order confirmed", detail: "Payment received", state: "complete" },
    { label: "Preparing", detail: "Getting your order ready", state: "current" },
    { label: "In transit", detail: order.carrier, state: "upcoming" },
    { label: "Delivered", detail: "Final step", state: "upcoming" },
  ];
}
