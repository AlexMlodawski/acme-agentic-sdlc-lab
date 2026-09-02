import { NextResponse } from "next/server";

import {
  fetchOrderFromSupportApi,
  SupportApiError,
} from "@/lib/server/supportApi";

const ORDER_ID_PATTERN = /^ACME-\d{4}$/;

interface RouteContext {
  params: Promise<{ orderId: string }>;
}

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext) {
  const { orderId: rawOrderId } = await context.params;
  const orderId = rawOrderId.trim().toUpperCase();

  if (!ORDER_ID_PATTERN.test(orderId)) {
    return NextResponse.json(
      { error: "Invalid order ID", code: "INVALID_ORDER_ID" },
      { status: 400 },
    );
  }

  try {
    const order = await fetchOrderFromSupportApi(orderId);

    if (!order) {
      return NextResponse.json(
        { error: "Order not found", code: "ORDER_NOT_FOUND" },
        { status: 404 },
      );
    }

    return NextResponse.json(order, { status: 200 });
  } catch (error) {
    const code = error instanceof SupportApiError
      ? error.code
      : "SUPPORT_API_UNAVAILABLE";

    return NextResponse.json(
      { error: "Order service unavailable", code },
      { status: 502 },
    );
  }
}
