import type { AppConfig } from "../src/config.js";
import { loadConfig } from "../src/config.js";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...loadConfig({}),
    logLevel: "silent",
    ...overrides,
  };
}

export const validSupportCase = {
  orderId: "ACME-1042",
  priority: "high",
  description: "The order is delayed and the customer needs assistance.",
} as const;
