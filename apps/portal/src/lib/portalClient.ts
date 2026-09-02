import { z } from "zod";

import { AGENT_THREAD_ID_PATTERN } from "@/lib/agent/AgentProvider";
import type {
  AgentReply,
  AssistantMessageRequest,
  OrderRecord,
} from "@/lib/types";

const ORDER_ID_PATTERN = /^ACME-\d{4}$/;

const orderRecordSchema = z.object({
  orderId: z.string().min(1),
  customerName: z.string().min(1),
  status: z.string().min(1),
  estimatedDeliveryDate: z.string().min(1),
  carrier: z.string().min(1),
  trackingNumber: z.string().min(1),
});

const agentReplySchema = z.object({
  message: z.string().min(1).max(100_000),
  orderId: z.string().regex(ORDER_ID_PATTERN).optional(),
  threadId: z.string().regex(AGENT_THREAD_ID_PATTERN).optional(),
  source: z.enum(["stub", "orchestrate"]),
}).strict();

const agentErrorCodes = new Set([
  "AGENT_MODE_INVALID",
  "AGENT_REQUEST_FAILED",
  "AGENT_TIMEOUT",
  "AGENT_UNAVAILABLE",
  "INVALID_AGENT_RESPONSE",
  "INVALID_MESSAGE",
  "INVALID_ORDER_ID",
  "INVALID_REQUEST",
  "INVALID_THREAD_ID",
  "ORCHESTRATE_NOT_CONFIGURED",
  "ORIGIN_NOT_ALLOWED",
  "UNSUPPORTED_MEDIA_TYPE",
]);

export interface SendAssistantMessageOptions {
  fetcher?: typeof fetch;
}

export class PortalApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "PortalApiError";
    this.status = status;
    this.code = code;
  }
}

async function readResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorCode(payload: unknown, fallback: string): string {
  return payload &&
    typeof payload === "object" &&
    "code" in payload &&
    typeof payload.code === "string"
    ? payload.code
    : fallback;
}

function assistantErrorCode(payload: unknown): string {
  const candidate = errorCode(payload, "AGENT_REQUEST_FAILED");
  return agentErrorCodes.has(candidate) ? candidate : "AGENT_REQUEST_FAILED";
}

export async function lookupOrder(
  orderId: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<OrderRecord> {
  const normalizedOrderId = orderId.trim().toUpperCase();
  let response: Response;

  try {
    response = await fetcher(`/api/orders/${encodeURIComponent(normalizedOrderId)}`, {
      cache: "no-store",
    });
  } catch (cause) {
    throw new PortalApiError(
      cause instanceof Error ? cause.message : "Order service unavailable",
      0,
      "ORDER_API_UNAVAILABLE",
    );
  }

  const payload = await readResponse(response);

  if (!response.ok) {
    throw new PortalApiError(
      response.status === 404 ? "We couldn't find that order." : "We couldn't retrieve this order.",
      response.status,
      errorCode(payload, "ORDER_LOOKUP_FAILED"),
    );
  }

  const result = orderRecordSchema.safeParse(payload);
  if (!result.success) {
    throw new PortalApiError(
      "The order service returned an invalid response.",
      response.status,
      "INVALID_ORDER_API_RESPONSE",
    );
  }

  return result.data;
}

export async function sendAssistantMessage(
  input: AssistantMessageRequest,
  options: SendAssistantMessageOptions = {},
): Promise<AgentReply> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const hasOrderId = input.orderId !== undefined;
  const hasThreadId = input.threadId !== undefined;
  const orderId = input.orderId?.trim().toUpperCase();
  const threadId = input.threadId?.trim();
  let response: Response;

  try {
    response = await fetcher("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: input.message.trim(),
        ...(hasOrderId ? { orderId } : {}),
        ...(hasThreadId ? { threadId } : {}),
      }),
    });
  } catch {
    throw new PortalApiError(
      "The Store Support Agent is temporarily unavailable.",
      0,
      "AGENT_UNAVAILABLE",
    );
  }

  const payload = await readResponse(response);

  if (!response.ok) {
    throw new PortalApiError(
      "The Store Support Agent is temporarily unavailable.",
      response.status,
      assistantErrorCode(payload),
    );
  }

  const result = agentReplySchema.safeParse(payload);
  if (!result.success) {
    throw new PortalApiError(
      "The Store Support Agent returned an invalid response.",
      response.status,
      "INVALID_AGENT_RESPONSE",
    );
  }

  return result.data;
}
