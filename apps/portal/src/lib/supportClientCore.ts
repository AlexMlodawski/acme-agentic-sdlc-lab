import { z } from "zod";

import { resolveDemoCorrelationId } from "@/lib/demoCorrelationId";
import type { SupportCaseResult, SupportPriority } from "@/lib/types";

const supportCaseResultSchema = z.object({
  caseId: z.string().min(1),
  status: z.literal("created"),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  correlationId: z.string().min(1),
});

export interface CreateSupportCaseInput {
  orderId: string;
  selectedPriority: SupportPriority;
  description: string;
}

interface SupportClientErrorOptions {
  status: number;
  code: string;
  correlationId: string;
  cause?: unknown;
}

export class SupportClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly correlationId: string;

  constructor(message: string, options: SupportClientErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "SupportClientError";
    this.status = options.status;
    this.code = options.code;
    this.correlationId = options.correlationId;
  }
}

export function getDemoCorrelationId(): string {
  return resolveDemoCorrelationId(process.env.NEXT_PUBLIC_DEMO_CORRELATION_ID);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readErrorDetails(
  payload: unknown,
  response: Response,
): Pick<SupportClientErrorOptions, "code" | "correlationId"> {
  const body = payload && typeof payload === "object" ? payload : {};
  const code = "code" in body && typeof body.code === "string"
    ? body.code
    : "SUPPORT_CASE_REQUEST_FAILED";
  const correlationId =
    "correlationId" in body && typeof body.correlationId === "string"
      ? body.correlationId
      : response.headers.get("x-correlation-id") ?? getDemoCorrelationId();

  return { code, correlationId };
}

export async function createSupportCaseWithMapper(
  input: CreateSupportCaseInput,
  mapRequest: (value: CreateSupportCaseInput) => Record<string, unknown>,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<SupportCaseResult> {
  const correlationId = getDemoCorrelationId();
  let response: Response;

  try {
    response = await fetcher("/api/support-cases", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Correlation-ID": correlationId,
      },
      body: JSON.stringify(mapRequest(input)),
    });
  } catch (cause) {
    throw new SupportClientError("The support service is currently unavailable.", {
      status: 0,
      code: "SUPPORT_API_UNAVAILABLE",
      correlationId,
      cause,
    });
  }

  const payload = await readJson(response);

  if (!response.ok) {
    const details = readErrorDetails(payload, response);
    throw new SupportClientError("The support case could not be created.", {
      status: response.status,
      ...details,
    });
  }

  const result = supportCaseResultSchema.safeParse(payload);

  if (!result.success) {
    throw new SupportClientError("The support service returned an invalid response.", {
      status: response.status,
      code: "INVALID_SUPPORT_API_RESPONSE",
      correlationId: response.headers.get("x-correlation-id") ?? correlationId,
      cause: result.error,
    });
  }

  return result.data;
}
