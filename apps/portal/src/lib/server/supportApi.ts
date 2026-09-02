import "server-only";

import { z } from "zod";

import type { OrderRecord } from "@/lib/types";

const DEFAULT_API_PORT = "4000";
export const SUPPORT_API_TIMEOUT_MS = 5_000;
export const SUPPORT_API_MAX_RESPONSE_BYTES = 512 * 1024;

const orderRecordSchema = z.object({
  orderId: z.string().min(1),
  customerName: z.string().min(1),
  status: z.string().min(1),
  estimatedDeliveryDate: z.string().min(1),
  carrier: z.string().min(1),
  trackingNumber: z.string().min(1),
});

export class SupportApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string, cause?: unknown) {
    super(message, { cause });
    this.name = "SupportApiError";
    this.status = status;
    this.code = code;
  }
}

export interface SupportApiResponse {
  status: number;
  payload: unknown;
  correlationId: string | null;
}

function getSupportApiBaseUrl(): string {
  const configured = process.env.SUPPORT_API_BASE_URL?.trim();
  const candidate =
    configured ||
    `http://127.0.0.1:${process.env.SUPPORT_API_PORT ?? DEFAULT_API_PORT}`;

  let parsed: URL;
  try {
    if (candidate.includes("?") || candidate.includes("#")) {
      throw new TypeError("query and fragment data are not allowed");
    }
    parsed = new URL(candidate);
  } catch {
    throw new SupportApiError(
      "The Support API configuration is invalid.",
      500,
      "INVALID_SUPPORT_API_CONFIGURATION",
    );
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(hostname);
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    !hostname ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    (parsed.protocol === "http:" && !isLoopback)
  ) {
    throw new SupportApiError(
      "The Support API configuration is invalid.",
      500,
      "INVALID_SUPPORT_API_CONFIGURATION",
    );
  }

  const pathname = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${pathname}`;
}

function getSupportApiHeaders(configuredHeaders?: HeadersInit): Headers {
  const headers = new Headers(configuredHeaders);
  const token = process.env.SUPPORT_API_TOKEN?.trim();

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return headers;
}

async function requestSupportApi<T>(
  pathname: string,
  init?: RequestInit,
  consume?: (response: Response, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const baseUrl = getSupportApiBaseUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUPPORT_API_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      ...init,
      cache: "no-store",
      headers: getSupportApiHeaders(init?.headers),
      redirect: "manual",
      signal: controller.signal,
    });
    if (!consume) throw new TypeError("A Support API response consumer is required.");
    return await consume(response, controller.signal);
  } catch (cause) {
    if (cause instanceof SupportApiError) throw cause;
    throw new SupportApiError(
      "The Support API is unavailable.",
      502,
      controller.signal.aborted || (cause instanceof DOMException && cause.name === "AbortError")
        ? "SUPPORT_API_TIMEOUT"
        : "SUPPORT_API_UNAVAILABLE",
      cause,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > SUPPORT_API_MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new SupportApiError(
      "The Support API response exceeded the allowed size.",
      502,
      "SUPPORT_API_RESPONSE_TOO_LARGE",
    );
  }

  try {
    if (!response.body) throw new TypeError("The Support API response has no body.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    const aborted = new Promise<never>((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > SUPPORT_API_MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new SupportApiError(
          "The Support API response exceeded the allowed size.",
          502,
          "SUPPORT_API_RESPONSE_TOO_LARGE",
        );
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (cause) {
    if (cause instanceof SupportApiError || (cause instanceof DOMException && cause.name === "AbortError")) {
      throw cause;
    }
    throw new SupportApiError(
      "The Support API returned an invalid response.",
      502,
      "INVALID_SUPPORT_API_RESPONSE",
      cause,
    );
  }
}

export async function fetchOrderFromSupportApi(
  orderId: string,
): Promise<OrderRecord | null> {
  return requestSupportApi(
    `/orders/${encodeURIComponent(orderId)}`,
    { headers: { Accept: "application/json" } },
    async (response, signal) => {
      if (response.status === 404) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new SupportApiError(
          "The Support API rejected the order lookup.",
          502,
          "ORDER_LOOKUP_FAILED",
        );
      }
      const result = orderRecordSchema.safeParse(await readJson(response, signal));
      if (!result.success) {
        throw new SupportApiError(
          "The Support API returned an invalid order.",
          502,
          "INVALID_ORDER_API_RESPONSE",
          result.error,
        );
      }
      return result.data;
    },
  );
}

export async function postSupportCaseToSupportApi(
  payload: Record<string, unknown>,
  correlationId: string,
): Promise<SupportApiResponse> {
  return requestSupportApi(
    "/support-cases",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Correlation-ID": correlationId,
      },
      body: JSON.stringify(payload),
    },
    async (response, signal) => ({
      status: response.status,
      payload: await readJson(response, signal),
      correlationId: response.headers.get("x-correlation-id"),
    }),
  );
}
