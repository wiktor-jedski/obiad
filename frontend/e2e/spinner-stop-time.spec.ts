import { expect, test, type Page } from "@playwright/test";

const COPY = {
  en: {
    searchPlaceholder: "Search foods",
    moreButton: "MORE!",
    loadingNutritionValues: "Loading nutrition values",
  },
  pl: {
    searchPlaceholder: "Szukaj potraw",
    moreButton: "WIĘCEJ!",
    loadingNutritionValues: "Ładowanie wartości odżywczych",
  },
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

test.describe("Spinner-free card presentation", () => {
  for (const [lang, copy] of [
    ["en-US", COPY.en],
    ["pl-PL", COPY.pl],
  ] as const) {
    test(`[${lang}] new Search, MORE!, and local quantity commits render no card spinner while MORE! keeps its disabled opacity`, async ({
      page,
    }) => {
      await useBrowserLanguages(page, [lang]);

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
      await page.getByPlaceholder(copy.searchPlaceholder).fill("margherita");
      await page.locator("#food-suggestion-option-1").click();
      await expect.poll(() => postCount).toBe(1);

      const numberInput = page.locator("[data-quantity-number]");
      const unitSelect = page.locator("[data-quantity-unit]");
      await expect(page.locator("[data-card-spinner]")).toHaveCount(0);
      await expect(numberInput).toBeDisabled();
      await expect(unitSelect).toBeDisabled();
      await expect(page.locator("#quantity-editor-status")).toHaveText(
        copy.loadingNutritionValues,
      );

      initialGate.resolve();
      await expect(page.locator("main")).toHaveAttribute(
        "data-interaction-state",
        "results",
      );
      await numberInput.fill("2");
      await numberInput.press("Enter");

      expect(postCount).toBe(1);
      await expect(page.locator("[data-card-spinner]")).toHaveCount(0);
      await expect(numberInput).toBeEnabled();
      await expect(unitSelect).toBeEnabled();
      await expect(page.locator("#quantity-editor-status")).toHaveText("");
      await expect(
        page.locator("[data-selected-input-region]"),
      ).not.toHaveAttribute("aria-busy", "true");
      await expect(page.locator("[data-result-region]")).not.toHaveAttribute(
        "aria-busy",
        "true",
      );

      const moreButton = page.locator("[data-more-button]");
      await moreButton.click();
      await expect.poll(() => postCount).toBe(2);
      await expect(page.locator("[data-card-spinner]")).toHaveCount(0);
      await expect(moreButton).toHaveAttribute("aria-disabled", "true");
      await expect(moreButton).toHaveCSS(
        "background-color",
        DISABLED_MORE_BACKGROUND_COLOR,
      );
      await expect(moreButton).toHaveCSS("color", DISABLED_MORE_TEXT_COLOR);

      moreGate.resolve();
      await expect(page.locator("main")).toHaveAttribute(
        "data-interaction-state",
        "results",
      );
      await expect(page.locator("[data-card-spinner]")).toHaveCount(0);
    });
  }
});
