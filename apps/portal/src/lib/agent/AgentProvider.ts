import type { AgentReply } from "@/lib/types";

export type AgentMode = "stub" | "orchestrate";

export const AGENT_THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AgentProvider {
  readonly mode: AgentMode;
  sendMessage(message: string, threadId?: string): Promise<AgentReply>;
}

export class NotConfiguredError extends Error {
  readonly code = "ORCHESTRATE_NOT_CONFIGURED";

  constructor() {
    super(
      "The watsonx Orchestrate provider requires a verified tenant connection and is not configured in this offline demo.",
    );
    this.name = "NotConfiguredError";
  }
}
