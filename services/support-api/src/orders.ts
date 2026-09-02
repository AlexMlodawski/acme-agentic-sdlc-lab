import type { OrderRecord } from "./types.js";

const ORDER_FIXTURES: readonly OrderRecord[] = [
    {
      orderId: "ACME-1042",
      customerName: "Jordan Lee",
      status: "delayed",
      estimatedDeliveryDate: "2026-08-26",
      carrier: "Acme Express",
      trackingNumber: "AX-88271042",
    },
    {
      orderId: "ACME-2048",
      customerName: "Casey Morgan",
      status: "shipped",
      estimatedDeliveryDate: "2026-08-28",
      carrier: "Acme Express",
      trackingNumber: "AX-88272048",
    },
    {
      orderId: "ACME-3096",
      customerName: "Taylor Kim",
      status: "delivered",
      estimatedDeliveryDate: "2026-08-22",
      carrier: "Acme Express",
      trackingNumber: "AX-88273096",
    },
];

const ORDERS: ReadonlyMap<string, OrderRecord> = new Map(
  ORDER_FIXTURES.map((order) => [order.orderId, Object.freeze(order)] as const),
);

export function normalizeOrderId(orderId: string): string {
  return orderId.trim().toUpperCase();
}

export function findOrder(orderId: string): OrderRecord | undefined {
  return ORDERS.get(normalizeOrderId(orderId));
}

export function listOrders(): readonly OrderRecord[] {
  return [...ORDERS.values()];
}
