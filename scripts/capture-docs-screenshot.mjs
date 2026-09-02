import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const origin = "http://127.0.0.1:3000";
const output = path.join(process.cwd(), "docs", "assets", "acme-agentic-support.png");
await mkdir(path.dirname(output), { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.getByTestId("order-id-input").fill("ACME-1042");
  await page.getByTestId("order-lookup-button").click();
  await page.getByTestId("order-status-card").waitFor();
  await page.getByTestId("assistant-toggle").click();
  await page.getByTestId("assistant-input").fill(
    "What is this order's status and the standard return window?",
  );
  await page.getByTestId("assistant-send").click();
  await page.getByTestId("assistant-msg-assistant").last().waitFor();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.addStyleTag({
    content: [
      "header { position: static !important; }",
      "a[href='#main-content'] { display: none !important; }",
    ].join("\n"),
  });
  await page.getByTestId("order-status-card").screenshot({ path: output });
  console.log("DOCS_SCREENSHOT=PASS");
} finally {
  await browser.close();
}
