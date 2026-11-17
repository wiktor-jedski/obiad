import { expect, test } from "@playwright/test";
import { isLandingDialogueRequest } from "./request-purpose";

test("search requests lock selection, but pending pagination permits local edits", async ({
  page,
}) => {
  const initialGate = Promise.withResolvers<void>();
  const pageGate = Promise.withResolvers<void>();
  const requests: unknown[] = [];
  await page.route("**/api/v1/substitutes/search", async (route) => {
    if (isLandingDialogueRequest(route.request())) return route.continue();
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) await initialGate.promise;
    if (requests.length === 2) await pageGate.promise;
    await route.continue();
  });
  await page.goto("/");
  await page
    .getByRole("combobox", { name: /Interface language|Język interfejsu/ })
    .selectOption("en");
  const search = page.getByRole("combobox", { name: "Search", exact: true });
  await search.fill("margherita");
  await page.locator("#food-suggestion-option-1").click();
  await expect.poll(() => requests.length).toBe(1);
  await search.press("Enter");
  expect(requests).toHaveLength(1);
  initialGate.resolve();
  await expect(
    page
      .locator("[data-selected-food-summary]")
      .locator("xpath=ancestor::*[@data-card-reveal]"),
  ).toHaveAttribute("data-card-reveal-state", "shown");
  const quantity = page.locator("[data-nutrition-editor=quantity]");
  await expect(quantity).toHaveValue("1");
  await page.locator("[data-pagination-sentinel]").scrollIntoViewIfNeeded();
  await expect.poll(() => requests.length).toBe(2);
  await expect(page.locator("[data-pagination-spinner]")).toBeVisible();
  await expect(page.locator("[data-result-card]")).toHaveCount(3);
  await quantity.fill("2");
  await expect(quantity).toBeFocused();
  await quantity.press("Enter");
  await expect(quantity).toHaveValue("2");
  await expect(page.locator("[data-nutrition-editor=calories]")).toHaveValue(
    "1750",
  );
  await expect(page.locator("[data-result-card-calories]")).toHaveText([
    "1750 kcal",
    "1750 kcal",
    "1750 kcal",
  ]);
  await page.locator("[data-pagination-sentinel]").scrollIntoViewIfNeeded();
  await page.waitForTimeout(1100);
  expect(requests).toHaveLength(2);
  pageGate.resolve();
  await expect(page.locator("[data-result-card]")).toHaveCount(6);
  await expect(page.locator("[data-pagination-spinner]")).toHaveCount(0);
  await expect(page.locator("[data-result-card-calories]")).toHaveText(
    Array(6).fill("1750 kcal"),
  );
  expect(requests).toEqual([
    { foodObjectId: 1, pageIndex: 0 },
    { foodObjectId: 1, pageIndex: 1 },
  ]);
});
