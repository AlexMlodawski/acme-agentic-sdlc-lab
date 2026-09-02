import type { AgentMode, AgentProvider } from "@/lib/agent/AgentProvider";
import { OrchestrateAgentProvider } from "@/lib/agent/OrchestrateAgentProvider";
import {
  StubAgentProvider,
  type OrderLookup,
} from "@/lib/agent/StubAgentProvider";

export interface AgentProviderOptions {
  mode?: string;
  lookupOrder: OrderLookup;
}

export class InvalidAgentModeError extends Error {
  readonly code = "AGENT_MODE_INVALID";

  constructor() {
    super("AGENT_MODE must be either stub or orchestrate.");
    this.name = "InvalidAgentModeError";
  }
}

export function resolveAgentMode(
  value = process.env.AGENT_MODE,
): AgentMode {
  if (value === undefined) return "stub";

  const normalized = value.trim().toLowerCase();
  if (normalized === "stub" || normalized === "orchestrate") {
    return normalized;
  }

  throw new InvalidAgentModeError();
}

export function createAgentProvider(options: AgentProviderOptions): AgentProvider {
  const mode = resolveAgentMode(options.mode);

  if (mode === "orchestrate") {
    return new OrchestrateAgentProvider();
  }

  return new StubAgentProvider(options.lookupOrder);
}
