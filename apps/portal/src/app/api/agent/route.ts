import { NextResponse } from "next/server";
import { z } from "zod";

import {
  AGENT_THREAD_ID_PATTERN,
  NotConfiguredError,
} from "@/lib/agent/AgentProvider";
import {
  createAgentProvider,
  InvalidAgentModeError,
} from "@/lib/agent/providerFactory";
import { OrchestrateProviderError } from "@/lib/agent/OrchestrateAgentProvider";
import { validateJsonPostRequest } from "@/lib/server/requestSecurity";
import { fetchOrderFromSupportApi } from "@/lib/server/supportApi";

const ORDER_ID_PATTERN = /^ACME-\d{4}$/i;

const messageSchema = z
  .object({
    message: z.string().trim().min(1).max(1_000),
    orderId: z
      .string()
      .trim()
      .regex(ORDER_ID_PATTERN)
      .transform((value) => value.toUpperCase())
      .optional(),
    threadId: z.string().trim().regex(AGENT_THREAD_ID_PATTERN).optional(),
  })
  .strict();

function invalidMessageResponse(parsed: z.SafeParseError<unknown>) {
  const fields = new Set(parsed.error.issues.map((issue) => issue.path[0]));
  if (fields.has("orderId")) {
    return NextResponse.json(
      { error: "Order ID must use ACME-NNNN.", code: "INVALID_ORDER_ID" },
      { status: 400 },
    );
  }
  if (fields.has("threadId")) {
    return NextResponse.json(
      { error: "The conversation identifier is invalid.", code: "INVALID_THREAD_ID" },
      { status: 400 },
    );
  }
  return NextResponse.json(
    { error: "A message between 1 and 1000 characters is required.", code: "INVALID_MESSAGE" },
    { status: 400 },
  );
}

function providerMessage(message: string, orderId: string | undefined): string {
  if (!orderId) return message;
  return JSON.stringify({
    schema: "acme-assistant-message-v1",
    applicationContext: { currentOrderId: orderId },
    customerMessage: message,
  });
}

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const securityRejection = validateJsonPostRequest(request);
  if (securityRejection) {
    return NextResponse.json(
      { error: securityRejection.error, code: securityRejection.code },
      { status: securityRejection.status },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", code: "INVALID_REQUEST" },
      { status: 400 },
    );
  }

  const parsed = messageSchema.safeParse(body);
  if (!parsed.success) {
    return invalidMessageResponse(parsed);
  }

  try {
    const provider = createAgentProvider({
      lookupOrder: fetchOrderFromSupportApi,
    });
    const reply = await provider.sendMessage(
      providerMessage(parsed.data.message, parsed.data.orderId),
      parsed.data.threadId,
    );
    return NextResponse.json({
      ...reply,
      ...(parsed.data.orderId ? { orderId: parsed.data.orderId } : {}),
    });
  } catch (error) {
    if (error instanceof InvalidAgentModeError) {
      return NextResponse.json(
        { error: "The agent mode is invalid.", code: error.code },
        { status: 503 },
      );
    }

    if (error instanceof NotConfiguredError) {
      return NextResponse.json(
        {
          error: "The Orchestrate agent provider is not configured.",
          code: error.code,
        },
        { status: 503 },
      );
    }

    if (error instanceof OrchestrateProviderError) {
      if (error.code === "ORCHESTRATE_TIMEOUT") {
        return NextResponse.json(
          { error: "The Store Support Agent timed out.", code: "AGENT_TIMEOUT" },
          { status: 504 },
        );
      }
      if (
        error.code === "ORCHESTRATE_RESPONSE_TOO_LARGE" ||
        error.code === "INVALID_ORCHESTRATE_RESPONSE"
      ) {
        return NextResponse.json(
          { error: "The Store Support Agent returned an invalid response.", code: "INVALID_AGENT_RESPONSE" },
          { status: 502 },
        );
      }
    }

    return NextResponse.json(
      { error: "The Store Support Agent is unavailable.", code: "AGENT_UNAVAILABLE" },
      { status: 502 },
    );
  }
}
