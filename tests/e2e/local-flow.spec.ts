import { expect, test } from "@playwright/test";

test("local zero-secret customer-support journey", async ({ page }) => {
  const browserOrigins = new Set<string>();
  page.on("request", (request) => browserOrigins.add(new URL(request.url()).origin));

  await page.goto("/");
  await expect(page).toHaveTitle("Acme Customer Care | Orders and support");
  await expect(page.getByRole("heading", {
    level: 1,
    name: "Support for every step of your order.",
  })).toBeVisible();

  await page.getByTestId("order-id-input").fill("ACME-1042");
  await page.getByTestId("order-lookup-button").click();
  await expect(page.getByTestId("order-status-card")).toBeVisible();
  await expect(page.getByTestId("order-status-value")).toContainText("Delayed");

  await page.getByTestId("assistant-toggle").click();
  await expect(page.getByTestId("assistant-input")).toBeVisible();
  await page.getByTestId("assistant-input").fill("What is the status of ACME-1042?");
  await page.getByTestId("assistant-send").click();
  await expect(page.getByTestId("assistant-msg-assistant").last()).toContainText(/ACME-1042/iu);
  await expect(page.getByTestId("assistant-msg-assistant").last()).toContainText(/delayed/iu);

  await page.getByTestId("assistant-input").fill("What is the standard return window?");
  await page.getByTestId("assistant-send").click();
  await expect(page.getByTestId("assistant-msg-assistant").last()).toContainText(/30/iu);

  await page.getByTestId("assistant-reset").click();
  await expect(page.getByTestId("assistant-msg-user")).toHaveCount(0);

  await page.getByTestId("priority-select").selectOption("high");
  await page.getByTestId("support-case-description").fill(
    "The order is delayed and the customer needs assistance.",
  );
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/support-cases") && response.request().method() === "POST",
  );
  await page.getByTestId("create-support-case-button").click();
  expect((await responsePromise).status()).toBe(201);
  await expect(page.getByTestId("support-case-success")).toBeVisible();

  expect([...browserOrigins]).toEqual([new URL(page.url()).origin]);
});
