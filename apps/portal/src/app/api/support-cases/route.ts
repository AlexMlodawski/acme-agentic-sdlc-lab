import { NextResponse } from "next/server";
import { z } from "zod";

import {
  isSafeDemoCorrelationId,
  resolveDemoCorrelationId,
} from "@/lib/demoCorrelationId";
import {
  postSupportCaseToSupportApi,
  SupportApiError,
} from "@/lib/server/supportApi";
import { validateJsonPostRequest } from "@/lib/server/requestSecurity";

const supportCasePayloadSchema = z.object({
  orderId: z.string().trim().regex(/^ACME-\d{4}$/i).transform((value) => value.toUpperCase()),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  description: z.string().trim().min(10).max(1000),
}).strict();

export const dynamic = "force-dynamic";

function getCorrelationId(request: Request): string {
  const requested = request.headers.get("x-correlation-id")?.trim();

  if (isSafeDemoCorrelationId(requested)) {
    return requested;
  }

  return resolveDemoCorrelationId(process.env.DEMO_CORRELATION_ID);
}

export async function POST(request: Request) {
  const correlationId = getCorrelationId(request);
  const securityRejection = validateJsonPostRequest(request);
  if (securityRejection) {
    return NextResponse.json(
      {
        error: securityRejection.error,
        code: securityRejection.code,
        correlationId,
      },
      {
        status: securityRejection.status,
        headers: { "X-Correlation-ID": correlationId },
      },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", code: "INVALID_REQUEST", correlationId },
      { status: 400, headers: { "X-Correlation-ID": correlationId } },
    );
  }

  const parsed = supportCasePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", code: "INVALID_REQUEST", correlationId },
      { status: 400, headers: { "X-Correlation-ID": correlationId } },
    );
  }

  try {
    const result = await postSupportCaseToSupportApi(parsed.data, correlationId);
    const responseCorrelationId = result.correlationId ?? correlationId;

    return NextResponse.json(result.payload, {
      status: result.status,
      headers: { "X-Correlation-ID": responseCorrelationId },
    });
  } catch (error) {
    const code = error instanceof SupportApiError
      ? error.code
      : "SUPPORT_API_UNAVAILABLE";

    return NextResponse.json(
      {
        error: "Support service unavailable",
        code,
        correlationId,
      },
      { status: 502, headers: { "X-Correlation-ID": correlationId } },
    );
  }
}
