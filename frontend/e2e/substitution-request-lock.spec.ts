import { expect, test, type Page } from "@playwright/test";
import type { SubstituteSearchRequest } from "../src/client/types.gen";

const COPY = {
  en: {
    searchPlaceholder: "Search foods",
    moreButton: "MORE!",
    quantityLabel: "Quantity",
    unitLabel: "Unit",
    servings: "servings",
    loadingNutritionValues: "Loading nutrition values",
    updatingQuantities: "Updating quantities",
  },
  pl: {
    searchPlaceholder: "Szukaj potraw",
    moreButton: "WIĘCEJ!",
    quantityLabel: "Ilość",
    unitLabel: "Jednostka",
    servings: "porcje",
    loadingNutritionValues: "Ładowanie wartości odżywczych",
    updatingQuantities: "Aktualizowanie ilości",
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

interface SubstitutePost {
  body: SubstituteSearchRequest;
  status: number | null;
}

interface SuggestionGet {
  url: string;
  status: number | null;
}

interface RequestLog {
  posts: SubstitutePost[];
  suggestionGets: SuggestionGet[];
}

function trackRequests(page: Page): RequestLog {
  const posts: SubstitutePost[] = [];
  const suggestionGets: SuggestionGet[] = [];

  page.on("request", (request) => {
    const url = request.url();
    if (
      request.method() === "POST" &&
      url.includes("/api/v1/substitutes/search")
    ) {
      posts.push({
        // SAFETY: The request payload matches the generated API contract.
        body: request.postDataJSON() as SubstituteSearchRequest,
        status: null,
      });
    } else if (
      request.method() === "GET" &&
      url.includes("/api/v1/food-suggestions")
    ) {
      suggestionGets.push({
        url,
        status: null,
      });
    }
  });

  page.on("response", (response) => {
    const request = response.request();
    const url = request.url();
    if (
      request.method() === "POST" &&
      url.includes("/api/v1/substitutes/search")
    ) {
      const post = posts.find((entry) => entry.status === null);
      if (post !== undefined) {
        post.status = response.status();
      }
    } else if (
      request.method() === "GET" &&
      url.includes("/api/v1/food-suggestions")
    ) {
      const getEntry = suggestionGets.find((entry) => entry.status === null);
      if (getEntry !== undefined) {
        getEntry.status = response.status();
      }
    }
  });

  return { posts, suggestionGets };
}

test.describe("Substitution request lock", () => {
  test("new Search, valid Food Quantity recalculation, and MORE! separately hold the lock, disable related controls while preserving initiating focus, discard repeated intents across pointer/keyboard/blur/dispatch, keep suggestion GETs in independent lane, and produce no queued POST upon release (P12-G1, P12-G2, REQ-048)", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const { posts, suggestionGets } = trackRequests(page);

    let postCount = 0;
    let releaseGate1: () => void = () => {};
    const gate1 = new Promise<void>((resolve) => {
      releaseGate1 = resolve;
    });
    let releaseGate2: () => void = () => {};
    const gate2 = new Promise<void>((resolve) => {
      releaseGate2 = resolve;
    });
    let releaseGate3: () => void = () => {};
    const gate3 = new Promise<void>((resolve) => {
      releaseGate3 = resolve;
    });

    await page.route("**/api/v1/substitutes/search", async (route) => {
      postCount += 1;
      if (postCount === 1) {
        await gate1;
      } else if (postCount === 2) {
        await gate2;
      } else if (postCount === 3) {
        await gate3;
      }
      await route.continue();
    });

    await page.goto("/");
    const searchInput = page.getByPlaceholder(COPY.en.searchPlaceholder);
    await searchInput.fill("margherita");

    const pizzaOption = page.locator("#food-suggestion-option-1");
    await expect(pizzaOption).toBeVisible();

    await pizzaOption.click();

    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]?.body).toEqual({
      foodObjectId: 1,
      quantity: { value: 1, unit: "serving" },
      pageIndex: 0,
    });

    await expect(searchInput).toBeFocused();

    const numberInput = page.locator("[data-quantity-number]");
    const unitSelect = page.locator("[data-quantity-unit]");
    await expect(numberInput).toBeDisabled();
    await expect(unitSelect).toBeDisabled();

    await numberInput.dispatchEvent("click");
    await unitSelect.dispatchEvent("change");
    await numberInput.dispatchEvent("keydown", { key: "Enter" });
    await page.locator("[data-quantity-editor]").dispatchEvent("focusout");

    await numberInput.click({ force: true });
    await numberInput.press("Enter");

    expect(posts).toHaveLength(1);

    const getsBeforeTyping = suggestionGets.length;
    await searchInput.fill("chicken");
    await expect
      .poll(() => suggestionGets.length)
      .toBeGreaterThan(getsBeforeTyping);

    const chickenOption = page.locator("#food-suggestion-option-5");
    await expect(chickenOption).toBeVisible();
    await expect(chickenOption).toHaveAttribute("aria-disabled", "true");

    await chickenOption.click({ force: true });
    await searchInput.press("Enter");
    expect(posts).toHaveLength(1);

    releaseGate1();
    await expect.poll(() => posts[0]?.status).toBe(200);

    await expect(page.locator("[data-interaction-state]")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );

    expect(posts).toHaveLength(1);

    await expect(numberInput).toBeEnabled();
    await expect(unitSelect).toBeEnabled();

    await numberInput.fill("2");
    await numberInput.press("Enter");

    await expect.poll(() => posts.length).toBe(2);
    expect(posts[1]?.body).toEqual({
      foodObjectId: 1,
      quantity: { value: 2, unit: "serving" },
      pageIndex: 0,
    });

    await expect(numberInput).toBeFocused();

    await expect(numberInput).toBeDisabled();
    await expect(unitSelect).toBeDisabled();

    await numberInput.press("Enter");
    await numberInput.dispatchEvent("keydown", { key: "Enter" });
    await unitSelect.dispatchEvent("change");
    await page.locator("[data-quantity-editor]").dispatchEvent("focusout");

    const moreButton = page.locator("[data-more-button]");
    if ((await moreButton.count()) > 0) {
      await expect(moreButton).toHaveAttribute("aria-disabled", "true");
      await moreButton.dispatchEvent("click");
    }

    expect(posts).toHaveLength(2);

    await searchInput.focus();
    const getsBeforeTyping2 = suggestionGets.length;
    await searchInput.fill("pho");
    await expect
      .poll(() => suggestionGets.length)
      .toBeGreaterThan(getsBeforeTyping2);

    const phoOption = page.locator("#food-suggestion-option-30");
    await expect(phoOption).toBeVisible();
    await expect(phoOption).toHaveAttribute("aria-disabled", "true");

    await phoOption.click({ force: true });
    expect(posts).toHaveLength(2);

    releaseGate2();
    await expect.poll(() => posts[1]?.status).toBe(200);

    expect(posts).toHaveLength(2);
    await expect(numberInput).toBeEnabled();
    await expect(unitSelect).toBeEnabled();

    await expect(moreButton).toBeVisible();
    await expect(moreButton).toHaveAttribute("aria-disabled", "false");

    await moreButton.click();

    await expect.poll(() => posts.length).toBe(3);
    expect(posts[2]?.body).toEqual({
      foodObjectId: 1,
      quantity: { value: 2, unit: "serving" },
      pageIndex: 1,
    });

    await expect(moreButton).toBeFocused();

    await expect(moreButton).toHaveAttribute("aria-disabled", "true");
    await expect(moreButton).toHaveCSS(
      "background-color",
      DISABLED_MORE_BACKGROUND_COLOR,
    );
    await expect(moreButton).toHaveCSS("color", DISABLED_MORE_TEXT_COLOR);
    await expect(numberInput).toBeDisabled();
    await expect(unitSelect).toBeDisabled();

    await moreButton.click({ force: true });
    await moreButton.press("Enter");
    await moreButton.dispatchEvent("click");
    await numberInput.dispatchEvent("keydown", { key: "Enter" });
    await unitSelect.dispatchEvent("change");

    expect(posts).toHaveLength(3);

    await searchInput.focus();
    const getsBeforeTyping3 = suggestionGets.length;
    await searchInput.fill("milk");
    await expect
      .poll(() => suggestionGets.length)
      .toBeGreaterThan(getsBeforeTyping3);

    const milkOption = page.locator("#food-suggestion-option-10");
    await expect(milkOption).toBeVisible();
    await expect(milkOption).toHaveAttribute("aria-disabled", "true");

    await milkOption.click({ force: true });
    expect(posts).toHaveLength(3);

    releaseGate3();
    await expect.poll(() => posts[2]?.status).toBe(200);

    expect(posts).toHaveLength(3);
    await expect(moreButton).toHaveAttribute("aria-disabled", "false");
    await expect(numberInput).toBeEnabled();
    await expect(unitSelect).toBeEnabled();

    await searchInput.focus();
    await searchInput.fill("chicken");
    const newChickenOption = page.locator("#food-suggestion-option-5");
    await expect(newChickenOption).toBeVisible();
    await expect(newChickenOption).not.toHaveAttribute("aria-disabled", "true");

    await newChickenOption.click();
    await expect.poll(() => posts.length).toBe(4);
    expect(posts[3]?.body).toEqual({
      foodObjectId: 5,
      quantity: { value: 100, unit: "g" },
      pageIndex: 0,
    });
  });
});
