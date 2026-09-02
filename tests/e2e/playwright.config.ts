import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const e2eDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(e2eDirectory, "../..");
const apiPort = Number(process.env.PLAYWRIGHT_API_PORT ?? 4000);
const portalPort = Number(process.env.PLAYWRIGHT_PORTAL_PORT ?? 3000);

if (![apiPort, portalPort].every((port) => Number.isInteger(port) && port > 0 && port <= 65_535)) {
  throw new Error("Playwright ports must be valid TCP ports.");
}
if (apiPort === portalPort) throw new Error("Portal and API ports must differ.");

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { outputFolder: path.join(projectRoot, "playwright-report"), open: "never" }]],
  outputDir: path.join(projectRoot, "test-results"),
  use: {
    baseURL: `http://127.0.0.1:${portalPort}`,
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
    locale: "en-US",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `node scripts/e2e-server.mjs api ${apiPort}`,
      cwd: projectRoot,
      url: `http://127.0.0.1:${apiPort}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: `node scripts/e2e-server.mjs portal ${portalPort} ${apiPort}`,
      cwd: projectRoot,
      url: `http://127.0.0.1:${portalPort}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
