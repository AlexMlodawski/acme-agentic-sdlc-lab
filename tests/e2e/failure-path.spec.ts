import { expect, test } from "@playwright/test";

test("rejects malformed and unknown orders with safe customer messages", async ({ page }) => {
  const browserOrigins = new Set<string>();
  const orderRequests: string[] = [];
  page.on("request", (request) => {
    const requestUrl = new URL(request.url());
    browserOrigins.add(requestUrl.origin);
    if (requestUrl.pathname.startsWith("/api/orders/")) {
      orderRequests.push(requestUrl.pathname);
    }
  });

  await page.goto("/");

  const input = page.getByTestId("order-id-input");
  const submit = page.getByTestId("order-lookup-button");
  const error = page.getByTestId("order-lookup-error");

  await input.fill("not-an-order");
  await submit.click();
  await expect(error).toContainText("Enter an order ID in the format ACME-1234.");
  await expect(page.getByTestId("order-status-card")).toHaveCount(0);
  expect(orderRequests).toEqual([]);

  await input.fill("ACME-4040");
  const responsePromise = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());
    return response.request().method() === "GET"
      && responseUrl.pathname === "/api/orders/ACME-4040";
  });
  await submit.click();

  expect((await responsePromise).status()).toBe(404);
  await expect(error).toContainText(
    "We couldn't find that order. Check the ID and try again.",
  );
  await expect(error).not.toContainText(
    /ORDER_NOT_FOUND|Internal Server Error|services\/support-api|stack trace/iu,
  );
  await expect(page.getByTestId("order-status-card")).toHaveCount(0);
  await expect(page.getByTestId("assistant-toggle")).toHaveCount(0);
  await expect(page.getByTestId("support-case-order-required")).toBeVisible();

  expect(orderRequests).toEqual(["/api/orders/ACME-4040"]);
  expect([...browserOrigins]).toEqual([new URL(page.url()).origin]);
});
