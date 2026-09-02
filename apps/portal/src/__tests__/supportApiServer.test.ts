import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchOrderFromSupportApi,
  postSupportCaseToSupportApi,
  SUPPORT_API_MAX_RESPONSE_BYTES,
  SUPPORT_API_TIMEOUT_MS,
} from "@/lib/server/supportApi";

const orderRecord = {
  orderId: "ACME-1042",
  customerName: "Jordan Lee",
  status: "delayed",
  estimatedDeliveryDate: "2026-08-26",
  carrier: "Acme Express",
  trackingNumber: "AX-88271042",
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("server-side Support API authentication", () => {
  it("forwards the configured bearer token for GET and POST", async () => {
    vi.stubEnv("SUPPORT_API_TOKEN", "  server-only-token  ");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(orderRecord), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            caseId: "CASE-20260827-001",
            status: "created",
            priority: "high",
            correlationId: "ACME-LAB-LOCAL",
          }),
          {
            status: 201,
            headers: {
              "Content-Type": "application/json",
              "X-Correlation-ID": "ACME-LAB-LOCAL",
            },
          },
        ),
      );
    vi.stubGlobal("fetch", fetcher);

    await fetchOrderFromSupportApi("ACME-1042");
    await postSupportCaseToSupportApi(
      {
        orderId: "ACME-1042",
        priority: "high",
        description: "The order is delayed and assistance is required.",
      },
      "ACME-LAB-LOCAL",
    );

    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const call of fetcher.mock.calls) {
      const headers = new Headers(call[1]?.headers);
      expect(headers.get("authorization")).toBe("Bearer server-only-token");
      expect(call[1]?.redirect).toBe("manual");
    }
  });

  it("preserves the local no-token behavior", async () => {
    vi.stubEnv("SUPPORT_API_TOKEN", "   ");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(orderRecord), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);

    await fetchOrderFromSupportApi("ACME-1042");

    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    expect(headers.has("authorization")).toBe(false);
  });

  it.each([
    "http://support.example.invalid",
    "https://user:password@support.example.invalid",
    "https://support.example.invalid?",
    "https://support.example.invalid?region=internal",
    "https://support.example.invalid#private",
    "https://support.example.invalid:99999",
  ])("rejects unsafe base URL %s before fetch", async (baseUrl) => {
    vi.stubEnv("SUPPORT_API_BASE_URL", baseUrl);
    vi.stubEnv("SUPPORT_API_TOKEN", "SENTINEL-TRANSPORT-TOKEN");
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);

    const result = fetchOrderFromSupportApi("ACME-1042");

    await expect(result).rejects.toMatchObject({
      code: "INVALID_SUPPORT_API_CONFIGURATION",
      status: 500,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    "http://localhost:4000",
    "http://127.0.0.1:4000",
    "http://[::1]:4000",
    "https://support.example.invalid",
  ])("allows approved transport for %s", async (baseUrl) => {
    vi.stubEnv("SUPPORT_API_BASE_URL", baseUrl);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(orderRecord), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(fetchOrderFromSupportApi("ACME-1042")).resolves.toEqual(
      orderRecord,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("manual");
  });

  it("rejects a non-loopback plain HTTP backend", async () => {
    vi.stubEnv("SUPPORT_API_BASE_URL", "http://internal.example.invalid/api");
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);

    await expect(fetchOrderFromSupportApi("ACME-1042")).rejects.toMatchObject({
      code: "INVALID_SUPPORT_API_CONFIGURATION",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not follow Support API redirects", async () => {
    vi.stubEnv("SUPPORT_API_BASE_URL", "https://support.example.invalid");
    vi.stubEnv("SUPPORT_API_TOKEN", "SENTINEL-REDIRECT-TOKEN");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: {
          Location: "http://redirect.example.invalid/orders/ACME-1042",
        },
      }),
    );
    vi.stubGlobal("fetch", fetcher);

    const result = fetchOrderFromSupportApi("ACME-1042");

    await expect(result).rejects.toMatchObject({
      code: "ORDER_LOOKUP_FAILED",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("manual");
  });

  it("bounds a stalled Support API request", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
    );
    vi.stubGlobal("fetch", fetcher);

    const request = fetchOrderFromSupportApi("ACME-1042");
    const rejection = expect(request).rejects.toMatchObject({
      code: "SUPPORT_API_TIMEOUT",
      status: 502,
    });
    await vi.advanceTimersByTimeAsync(SUPPORT_API_TIMEOUT_MS);
    await rejection;
  });

  it("keeps the timeout active while a response body stalls after headers", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new ReadableStream<Uint8Array>({ start() {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);

    const request = fetchOrderFromSupportApi("ACME-1042");
    const rejection = expect(request).rejects.toMatchObject({
      code: "SUPPORT_API_TIMEOUT",
      status: 502,
    });
    await vi.advanceTimersByTimeAsync(SUPPORT_API_TIMEOUT_MS);
    await rejection;
  });

  it("rejects an oversized Support API response before reading its body", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(orderRecord), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(SUPPORT_API_MAX_RESPONSE_BYTES + 1),
        },
      }),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(fetchOrderFromSupportApi("ACME-1042")).rejects.toMatchObject({
      code: "SUPPORT_API_RESPONSE_TOO_LARGE",
      status: 502,
    });
  });
});
