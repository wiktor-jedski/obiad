import { expect, test } from "@playwright/test";
import { isLandingDialogueRequest } from "./request-purpose";

for (const language of ["en-US", "pl-PL"]) {
  for (const responseDelay of [0, 1300]) {
    test(`${language}: pagination spinner lasts at least one painted second and waits for a ${responseDelay} ms response`, async ({
      page,
    }) => {
      await page.addInitScript((tag) => {
        Object.defineProperty(navigator, "languages", { get: () => [tag] });
      }, language);
      let posts = 0;
      let nextPageResponded = false;
      page.on("response", (response) => {
        const request = response.request();
        if (
          !isLandingDialogueRequest(request) &&
          request.url().includes("/api/v1/substitutes/search") &&
          request.postDataJSON()?.pageIndex === 1
        ) {
          nextPageResponded = true;
        }
      });
      await page.route("**/api/v1/substitutes/search", async (route) => {
        if (isLandingDialogueRequest(route.request())) {
          await route.continue();
          return;
        }
        posts += 1;
        if (posts === 2 && responseDelay > 0) {
          const delay = Promise.withResolvers<void>();
          setTimeout(delay.resolve, responseDelay);
          await delay.promise;
        }
        await route.continue();
      });
      await page.goto("/");
      await page
        .getByRole("combobox", {
          name: language === "en-US" ? "Search" : "Szukaj",
          exact: true,
        })
        .fill("margherita");
      await page.locator("#food-suggestion-option-1").click();
      await expect(
        page.locator('[data-card-reveal-state="shown"]'),
      ).toHaveCount(4);
      await expect(
        page.locator("[data-card-reveal] .loader, [data-card-spinner]"),
      ).toHaveCount(0);

      const timing = page.evaluate(() => {
        const result = Promise.withResolvers<{ start: number; end: number }>();
        let start: number | undefined;
        const sample = (now: number) => {
          const spinner = document.querySelector("[data-pagination-spinner]");
          if (spinner && spinner.getBoundingClientRect().height > 0) {
            start ??= now;
          } else if (start !== undefined) {
            result.resolve({ start, end: now });
            return;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
        return result.promise;
      });
      await page.locator("[data-pagination-sentinel]").scrollIntoViewIfNeeded();
      await expect(page.locator("[data-pagination-spinner]")).toBeVisible();
      await expect(page.locator("[data-result-card]")).toHaveCount(3);
      const quantity = page.locator("[data-nutrition-editor=quantity]");
      // Editing a retained card does not need another HTTP request, even while a page is pending.
      await quantity.evaluate((element) => {
        if (!(element instanceof HTMLInputElement))
          throw new TypeError("Expected quantity input");
        element.focus({ preventScroll: true });
      });
      await quantity.fill("2");
      await quantity.press("Enter");
      await expect(quantity).toBeEnabled();
      await expect(page.locator("[data-result-card]")).toHaveCount(6);
      const measured = await timing;
      expect(measured.end - measured.start).toBeGreaterThanOrEqual(1000);
      expect(nextPageResponded).toBe(true);
      expect(posts).toBe(2);
      await expect(
        page.locator("[data-card-reveal] .loader, [data-card-spinner]"),
      ).toHaveCount(0);
    });
  }
}

test("a failed page retains cards and an explicit retry receives its own one-second spinner", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "languages", { get: () => ["en-US"] });
  });
  let posts = 0;
  await page.route("**/api/v1/substitutes/search", async (route) => {
    if (isLandingDialogueRequest(route.request())) {
      await route.continue();
      return;
    }
    posts += 1;
    if (posts === 2) await route.abort();
    else await route.continue();
  });
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Search", exact: true })
    .fill("margherita");
  await page.locator("#food-suggestion-option-1").click();
  await expect(page.locator('[data-card-reveal-state="shown"]')).toHaveCount(4);
  for (const retry of [false, true]) {
    const timing = page.evaluate(() => {
      const result = Promise.withResolvers<number>();
      let start: number | undefined;
      const sample = (now: number) => {
        const spinner = document.querySelector("[data-pagination-spinner]");
        if (spinner && spinner.getBoundingClientRect().height > 0)
          start ??= now;
        else if (start !== undefined) {
          result.resolve(now - start);
          return;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      return result.promise;
    });
    if (retry) await page.getByRole("button", { name: "Try again" }).click();
    else
      await page.locator("[data-pagination-sentinel]").scrollIntoViewIfNeeded();
    expect(await timing).toBeGreaterThanOrEqual(1000);
    await expect(page.locator("[data-result-card]")).toHaveCount(retry ? 6 : 3);
    if (!retry) {
      await expect(page.locator("[data-retry-message]")).toBeVisible();
      expect(posts).toBe(2);
      // Remaining at the sentinel must not trigger an automatic retry.
      await page.evaluate(async () => {
        const frame = Promise.withResolvers<void>();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => frame.resolve()),
        );
        await frame.promise;
      });
      expect(posts).toBe(2);
    }
  }
  expect(posts).toBe(3);
});
