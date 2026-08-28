import { expect, test, type Page } from "@playwright/test";

const COPY = {
  searchPlaceholder: "Search foods",
} as const;

const DISABLED_MORE_BACKGROUND_COLOR = "oklch(0.446 0.03 256.802)";
const DISABLED_MORE_TEXT_COLOR = "oklch(0.872 0.01 258.338)";

async function useBrowserLanguages(
  page: Page,
  languages: string[],
): Promise<void> {
  await page.addInitScript((tags: string[]) => {
    Object.defineProperty(window.navigator, "languages", {
      configurable: true,
      get: () => tags,
    });
  }, languages);
}

test.describe("Substitution request lock", () => {
  test("new Search and MORE! hold the request lock while a valid local Food Quantity commit stays operable and starts no request", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);

    let postCount = 0;
    const initialGate = Promise.withResolvers<void>();
    const moreGate = Promise.withResolvers<void>();
    await page.route("**/api/v1/substitutes/search", async (route) => {
      postCount += 1;
      if (postCount === 1) {
        await initialGate.promise;
      }
      if (postCount === 2) {
        await moreGate.promise;
      }
      await route.continue();
    });

    await page.goto("/");
    const searchInput = page.getByPlaceholder(COPY.searchPlaceholder);
    await searchInput.fill("margherita");
    await page.locator("#food-suggestion-option-1").click();
    await expect.poll(() => postCount).toBe(1);

    const numberInput = page.locator("[data-quantity-number]");
    const unitSelect = page.locator("[data-quantity-unit]");
    await expect(searchInput).toBeFocused();
    await expect(numberInput).toBeDisabled();
    await expect(unitSelect).toBeDisabled();

    initialGate.resolve();
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    await expect(numberInput).toBeEnabled();
    await expect(unitSelect).toBeEnabled();

    await numberInput.fill("2");
    await numberInput.press("Enter");
    await expect(numberInput).toBeFocused();
    await expect(numberInput).toBeEnabled();
    await expect(unitSelect).toBeEnabled();
    expect(postCount).toBe(1);
    await expect(page.locator("[data-card-spinner]")).toHaveCount(0);
    await expect(page.locator("[data-editor-status]")).toHaveText("");

    const moreButton = page.locator("[data-more-button]");
    await moreButton.click();
    await expect.poll(() => postCount).toBe(2);
    await expect(moreButton).toBeFocused();
    await expect(moreButton).toHaveAttribute("aria-disabled", "true");
    await expect(moreButton).toHaveCSS(
      "background-color",
      DISABLED_MORE_BACKGROUND_COLOR,
    );
    await expect(moreButton).toHaveCSS("color", DISABLED_MORE_TEXT_COLOR);
    await expect(numberInput).toBeDisabled();
    await expect(unitSelect).toBeDisabled();

    moreGate.resolve();
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    await expect(moreButton).toHaveAttribute("aria-disabled", "false");
    await expect(numberInput).toBeEnabled();
    await expect(unitSelect).toBeEnabled();
  });
});
