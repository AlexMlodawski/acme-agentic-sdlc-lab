import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    passWithNoTests: false,
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
    },
  },
});
