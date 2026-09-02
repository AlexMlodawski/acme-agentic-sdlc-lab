import "server-only";

import { z } from "zod";

import {
  AGENT_THREAD_ID_PATTERN,
  NotConfiguredError,
  type AgentProvider,
} from "@/lib/agent/AgentProvider";
import {
  defaultMcspV2TokenProvider,
  type McspV2TokenConfiguration,
  type OrchestrateAccessTokenSource,
} from "@/lib/agent/McspV2TokenProvider";
import type { AgentReply } from "@/lib/types";

export const ORCHESTRATE_DEFAULT_TIMEOUT_MS = 60_000;
export const ORCHESTRATE_MIN_TIMEOUT_MS = 5_000;
export const ORCHESTRATE_MAX_TIMEOUT_MS = 120_000;
export const ORCHESTRATE_MAX_RESPONSE_BYTES = 512 * 1024;

const MAX_AGENT_MESSAGE_CHARACTERS = 100_000;
const OFFICIAL_WXO_HOST_PATTERN =
  /^api\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.dl\.watson-orchestrate\.ibm\.com$/;

const endpointSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:"
        && OFFICIAL_WXO_HOST_PATTERN.test(url.hostname)
        && url.port === ""
        && !url.username
        && !url.password
        && !url.search
        && !url.hash;
    } catch {
      return false;
    }
  })
  .transform((value) => value.replace(/\/+$/, ""));

const threadIdentifierSchema = z
  .string()
  .trim()
  .regex(AGENT_THREAD_ID_PATTERN);

const agentIdentifierSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);

const configSchema = z.object({
  apiEndpoint: endpointSchema.refine((value) => {
    try {
      return /^\/instances\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(
        new URL(value).pathname,
      );
    } catch {
      return false;
    }
  }),
  agentId: agentIdentifierSchema,
  apiKey: z.string().trim().min(1).max(16_384),
  timeoutMs: z.number().int().min(ORCHESTRATE_MIN_TIMEOUT_MS).max(ORCHESTRATE_MAX_TIMEOUT_MS),
});

const contentPartSchema = z.union([
  z.string().max(MAX_AGENT_MESSAGE_CHARACTERS),
  z
    .object({
      text: z.string().max(MAX_AGENT_MESSAGE_CHARACTERS).optional(),
      content: z.string().max(MAX_AGENT_MESSAGE_CHARACTERS).optional(),
    })
    .passthrough()
    .refine((part) => typeof part.text === "string" || typeof part.content === "string"),
]);

const completionResponseSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z
              .object({
                content: z.union([
                  z.string().max(MAX_AGENT_MESSAGE_CHARACTERS),
                  z.array(contentPartSchema).max(1_000),
                ]),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .min(1)
      .max(100),
    thread_id: threadIdentifierSchema,
  })
  .passthrough();

export type OrchestrateProviderErrorCode =
  | "ORCHESTRATE_TIMEOUT"
  | "ORCHESTRATE_UNAVAILABLE"
  | "ORCHESTRATE_UPSTREAM_ERROR"
  | "ORCHESTRATE_RESPONSE_TOO_LARGE"
  | "INVALID_ORCHESTRATE_RESPONSE";

export class OrchestrateProviderError extends Error {
  readonly code: OrchestrateProviderErrorCode;
  readonly status?: number;

  constructor(code: OrchestrateProviderErrorCode, message: string, status?: number) {
    super(message);
    this.name = "OrchestrateProviderError";
    this.code = code;
    this.status = status;
  }
}

function readConfiguration() {
  const configuredTimeout = process.env.WXO_REQUEST_TIMEOUT_MS?.trim();
  const timeoutMs = configuredTimeout === undefined || configuredTimeout === ""
    ? ORCHESTRATE_DEFAULT_TIMEOUT_MS
    : /^\d+$/.test(configuredTimeout)
      ? Number(configuredTimeout)
      : Number.NaN;
  const result = configSchema.safeParse({
    apiEndpoint: process.env.WXO_API_ENDPOINT,
    agentId: process.env.WXO_AGENT_ID,
    apiKey: process.env.WXO_API_KEY,
    timeoutMs,
  });

  if (!result.success) {
    throw new NotConfiguredError();
  }

  return result.data;
}

async function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  let removeAbortListener: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", onAbort);
  });

  try {
    return await Promise.race([reader.read(), aborted]);
  } finally {
    removeAbortListener();
  }
}

async function readBoundedText(response: Response, signal: AbortSignal): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > ORCHESTRATE_MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new OrchestrateProviderError(
      "ORCHESTRATE_RESPONSE_TOO_LARGE",
      "The watsonx Orchestrate response exceeded the allowed size.",
    );
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await readStreamChunk(reader, signal);
      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > ORCHESTRATE_MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new OrchestrateProviderError(
          "ORCHESTRATE_RESPONSE_TOO_LARGE",
          "The watsonx Orchestrate response exceeded the allowed size.",
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (signal.aborted) {
      void reader.cancel().catch(() => undefined);
    }
    throw error;
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(body);
}

function extractMessage(content: z.infer<typeof contentPartSchema> | z.infer<typeof contentPartSchema>[]) {
  const parts = Array.isArray(content) ? content : [content];
  const message = parts
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      return part.text ?? part.content ?? "";
    })
    .join("")
    .trim();

  if (!message) {
    throw new OrchestrateProviderError(
      "INVALID_ORCHESTRATE_RESPONSE",
      "The watsonx Orchestrate response did not contain an agent message.",
    );
  }

  return message;
}

export class OrchestrateAgentProvider implements AgentProvider {
  readonly mode = "orchestrate" as const;

  constructor(
    private readonly tokenSource: OrchestrateAccessTokenSource = defaultMcspV2TokenProvider,
  ) {}

  async sendMessage(message: string, threadId?: string): Promise<AgentReply> {
    const config = readConfiguration();
    const parsedThreadId = threadId === undefined
      ? undefined
      : threadIdentifierSchema.safeParse(threadId);
    if (parsedThreadId && !parsedThreadId.success) {
      throw new OrchestrateProviderError(
        "INVALID_ORCHESTRATE_RESPONSE",
        "The conversation identifier is invalid.",
      );
    }

    try {
      const tokenConfiguration: McspV2TokenConfiguration = {
        apiEndpoint: config.apiEndpoint,
        apiKey: config.apiKey,
      };
      let accessToken = await this.tokenSource.getToken(tokenConfiguration);
      let result = await this.requestCompletion(
        config,
        message,
        parsedThreadId?.success ? parsedThreadId.data : undefined,
        accessToken,
      );

      if (result.status === 401) {
        this.tokenSource.invalidate(tokenConfiguration, accessToken);
        accessToken = await this.tokenSource.getToken(tokenConfiguration);
        result = await this.requestCompletion(
          config,
          message,
          parsedThreadId?.success ? parsedThreadId.data : undefined,
          accessToken,
        );
      }
      if (result.status === 401) {
        throw new OrchestrateProviderError(
          "ORCHESTRATE_UPSTREAM_ERROR",
          "watsonx Orchestrate rejected the agent request.",
          result.status,
        );
      }

      let payload: unknown;
      try {
        payload = JSON.parse(result.rawBody);
      } catch {
        throw new OrchestrateProviderError(
          "INVALID_ORCHESTRATE_RESPONSE",
          "watsonx Orchestrate returned an invalid response.",
        );
      }

      const parsed = completionResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new OrchestrateProviderError(
          "INVALID_ORCHESTRATE_RESPONSE",
          "watsonx Orchestrate returned an invalid response.",
        );
      }

      const firstChoice = parsed.data.choices[0];
      if (!firstChoice) {
        throw new OrchestrateProviderError(
          "INVALID_ORCHESTRATE_RESPONSE",
          "watsonx Orchestrate returned an invalid response.",
        );
      }
      return {
        message: extractMessage(firstChoice.message.content),
        source: "orchestrate",
        threadId: parsed.data.thread_id,
      };
    } catch (error) {
      if (error instanceof NotConfiguredError || error instanceof OrchestrateProviderError) {
        throw error;
      }
      throw new OrchestrateProviderError(
        "ORCHESTRATE_UNAVAILABLE",
        "watsonx Orchestrate is unavailable.",
      );
    }
  }

  private async requestCompletion(
    config: z.infer<typeof configSchema>,
    message: string,
    threadId: string | undefined,
    accessToken: string,
  ): Promise<{ status: number; rawBody: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(
        `${config.apiEndpoint}/v1/orchestrate/${encodeURIComponent(config.agentId)}/chat/completions`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            ...(threadId ? { "X-IBM-THREAD-ID": threadId } : {}),
          },
          body: JSON.stringify({
            messages: [{ role: "user", content: message }],
            stream: false,
          }),
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        if (response.status === 401) {
          return { status: response.status, rawBody: "" };
        }
        throw new OrchestrateProviderError(
          "ORCHESTRATE_UPSTREAM_ERROR",
          "watsonx Orchestrate rejected the agent request.",
          response.status,
        );
      }

      return {
        status: response.status,
        rawBody: await readBoundedText(response, controller.signal),
      };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new OrchestrateProviderError(
          "ORCHESTRATE_TIMEOUT",
          "The watsonx Orchestrate request timed out.",
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
