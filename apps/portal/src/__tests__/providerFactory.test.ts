import { describe, expect, it, vi } from "vitest";

import { NotConfiguredError } from "@/lib/agent/AgentProvider";
import {
  createAgentProvider,
  InvalidAgentModeError,
  resolveAgentMode,
} from "@/lib/agent/providerFactory";

describe("AgentProvider factory", () => {
  it("uses the deterministic stub by default", () => {
    expect(resolveAgentMode(undefined)).toBe("stub");
    expect(
      createAgentProvider({ lookupOrder: vi.fn(async () => null) }).mode,
    ).toBe("stub");
  });

  it("creates a non-simulating Orchestrate boundary", async () => {
    const provider = createAgentProvider({
      mode: "orchestrate",
      lookupOrder: vi.fn(async () => null),
    });

    expect(provider.mode).toBe("orchestrate");
    await expect(provider.sendMessage("Hello")).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it("fails closed for an explicit invalid or blank mode", () => {
    expect(() => resolveAgentMode("typo")).toThrow(InvalidAgentModeError);
    expect(() => resolveAgentMode("   ")).toThrow(InvalidAgentModeError);
    expect(() =>
      createAgentProvider({
        mode: "unexpected",
        lookupOrder: vi.fn(async () => null),
      }),
    ).toThrow(InvalidAgentModeError);
  });

});
