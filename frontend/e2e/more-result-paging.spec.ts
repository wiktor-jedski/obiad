import { expect, test, type Page } from "@playwright/test";
import type { SubstituteSearchRequest } from "../src/client/types.gen";

const COPY = {
  en: {
    searchPlaceholder: "Search foods",
    moreButton: "MORE!",
    foundSubstitutions: "Found substitutions",
  },
  pl: {
    searchPlaceholder: "Szukaj potraw",
    moreButton: "WIĘCEJ!",
    foundSubstitutions: "Znalezione zamienniki",
  },
} as const;

const DISABLED_MORE_BACKGROUND_COLOR = "oklch(0.446 0.03 256.802)";

const DISABLED_MORE_TEXT_COLOR = "oklch(0.872 0.01 258.338)";

const PIZZA_ALL_PAGES: readonly (readonly number[])[] = [
  [13, 29, 26],
  [30, 3, 35],
  [14, 4, 21],
  [28, 24, 25],
  [10, 31, 36],
  [34, 8, 37],
  [33, 15, 32],
  [9, 16, 17],
  [12, 20, 38],
  [22, 11, 27],
  [7, 6, 5],
  [23, 18, 19],
] as const;

const CHICKEN_ALL_PAGES: readonly (readonly number[])[] = [
  [23, 11, 6],
  [7, 20, 12],
  [17, 38, 22],
  [16, 27, 33],
  [15, 10, 34],
  [21, 3, 29],
  [2, 30, 13],
  [1, 36, 24],
  [26, 25, 28],
  [4, 35, 14],
  [32, 31, 18],
  [19, 8, 37],
  [9],
] as const;

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

function trackSubstitutePosts(page: Page): SubstitutePost[] {
  const posts: SubstitutePost[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/v1/substitutes/search")
    ) {
      posts.push({
        // SAFETY: The request payload matches the generated API contract.
        body: request.postDataJSON() as SubstituteSearchRequest,
        status: null,
      });
    }
  });
  page.on("response", (response) => {
    const request = response.request();
    if (
      request.method() === "POST" &&
      request.url().includes("/api/v1/substitutes/search")
    ) {
      const post = posts.find((entry) => entry.status === null);
      if (post !== undefined) {
        post.status = response.status();
      }
    }
  });
  return posts;
}

async function selectFoodObject(
  page: Page,
  query: string,
  foodObjectId: number,
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  const searchInput = page.getByPlaceholder(copy.searchPlaceholder);
  await searchInput.fill(query);
  const option = page.locator(`#food-suggestion-option-${foodObjectId}`);
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.locator("[data-result-grid]")).toBeVisible();
  await expect(page.locator("[data-result-card]")).toHaveCount(3);
}

async function renderedCardIDs(page: Page): Promise<number[]> {
  const cards = page.locator("[data-result-card]");
  return cards.evaluateAll((elements) =>
    elements.map((element) =>
      Number(element.getAttribute("data-food-object-id")),
    ),
  );
}

test.describe("MORE! result paging", () => {
  test("traversing all 12 pages of Pizza Margherita (full three-card last page) proves the pending gray non-operable MORE! state, replacement without animation, results heading focus after every successful page with MORE! omitted on the last page, unique IDs across all pages, new-search reset from page 2, and valid quantity edit on the last page", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const posts = trackSubstitutePosts(page);

    let postCount = 0;
    let releaseMoreGate: () => void = () => {};
    const moreGate = new Promise<void>((resolve) => {
      releaseMoreGate = resolve;
    });

    await page.route("**/api/v1/substitutes/search", async (route) => {
      postCount += 1;
      if (postCount === 2) {
        await moreGate;
      }
      await route.continue();
    });

    await page.goto("/");
    await selectFoodObject(page, "margherita", 1, COPY.en);

    expect(posts.length).toBe(1);
    expect(posts[0]?.body).toEqual({
      foodObjectId: 1,
      pageIndex: 0,
    });
    const page0IDs = await renderedCardIDs(page);
    expect(page0IDs).toEqual([...PIZZA_ALL_PAGES[0]!]);

    const moreButton = page.locator("[data-more-button]");
    await expect(moreButton).toBeVisible();
    await expect(moreButton).toHaveText(COPY.en.moreButton);
    await expect(moreButton).toHaveAttribute("aria-label", COPY.en.moreButton);
    await expect(page.locator("[data-more-spinner]")).toHaveCount(0);
    await expect(moreButton).toHaveAttribute("aria-disabled", "false");

    await moreButton.click();

    await expect.poll(() => posts.length).toBe(2);
    expect(posts[1]?.body).toEqual({
      foodObjectId: 1,
      pageIndex: 1,
    });

    await expect(page.locator("[data-interaction-state]")).toHaveAttribute(
      "data-interaction-state",
      "loadingMore",
    );

    const pendingCards = await renderedCardIDs(page);
    expect(pendingCards).toEqual([...PIZZA_ALL_PAGES[0]!]);

    await expect(moreButton).toBeFocused();

    await expect(page.locator("[data-more-spinner]")).toHaveCount(0);
    await expect(moreButton).toHaveText(COPY.en.moreButton);
    await expect(moreButton).toHaveAttribute("aria-disabled", "true");
    await expect(moreButton).toHaveCSS(
      "background-color",
      DISABLED_MORE_BACKGROUND_COLOR,
    );
    await expect(moreButton).toHaveCSS("color", DISABLED_MORE_TEXT_COLOR);
    await moreButton.dispatchEvent("click");
    expect(posts).toHaveLength(2);

    releaseMoreGate();

    await expect(moreButton).toHaveText(COPY.en.moreButton);
    await expect(moreButton).toHaveAttribute("aria-disabled", "false");
    await expect(page.locator("[data-interaction-state]")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );

    const page1Cards = page.locator("[data-result-card]");
    await expect(page1Cards).toHaveCount(3);
    const page1IDs = await renderedCardIDs(page);
    expect(page1IDs).toEqual([...PIZZA_ALL_PAGES[1]!]);

    const observedIDs = [...page0IDs, ...page1IDs];
    expect(new Set(observedIDs).size).toBe(observedIDs.length);

    const animations = await page1Cards.evaluateAll((elements) =>
      elements.map((element) => {
        const style = window.getComputedStyle(element);
        return {
          animationName: style.animationName,
          transitionProperty: style.transitionProperty,
        };
      }),
    );
    for (const anim of animations) {
      expect(anim.animationName === "none" || anim.animationName === "").toBe(
        true,
      );
    }

    await moreButton.click();

    await expect.poll(() => posts.length).toBe(3);
    expect(posts[2]?.body).toEqual({
      foodObjectId: 1,
      pageIndex: 2,
    });

    await expect
      .poll(() => renderedCardIDs(page))
      .toEqual([...PIZZA_ALL_PAGES[2]!]);
    const page2IDs = await renderedCardIDs(page);
    expect(page2IDs).toEqual([...PIZZA_ALL_PAGES[2]!]);

    await expect(page.locator("[data-substitutions-heading]")).toBeFocused();

    const searchInput = page.getByPlaceholder(COPY.en.searchPlaceholder);
    await searchInput.fill("chicken");
    const chickenOption = page.locator("#food-suggestion-option-5");
    await expect(chickenOption).toBeVisible();
    await chickenOption.click();

    await expect.poll(() => posts.length).toBe(4);
    expect(posts[3]?.body).toEqual({
      foodObjectId: 5,
      pageIndex: 0,
    });

    await expect
      .poll(() => renderedCardIDs(page))
      .toEqual([...CHICKEN_ALL_PAGES[0]!]);
    expect(await renderedCardIDs(page)).toEqual([...CHICKEN_ALL_PAGES[0]!]);

    await expect(page.locator("[data-substitutions-heading]")).toBeFocused();

    await selectFoodObject(page, "margherita", 1, COPY.en);

    await expect
      .poll(() => renderedCardIDs(page))
      .toEqual([...PIZZA_ALL_PAGES[0]!]);

    const allPizzaRenderedIDs: number[] = [...PIZZA_ALL_PAGES[0]!];

    for (let pageIdx = 1; pageIdx <= 10; pageIdx++) {
      const btn = page.locator("[data-more-button]");
      await expect(btn).toBeVisible();
      await expect(btn).toHaveText(COPY.en.moreButton);
      await btn.click();

      const expectedPageIDs = [...PIZZA_ALL_PAGES[pageIdx]!];
      await expect.poll(() => renderedCardIDs(page)).toEqual(expectedPageIDs);
      const currentIDs = await renderedCardIDs(page);
      expect(currentIDs).toEqual(expectedPageIDs);
      expect(currentIDs.length).toBe(3);
      allPizzaRenderedIDs.push(...currentIDs);

      await expect(page.locator("[data-substitutions-heading]")).toBeFocused();
    }

    const btnToLastPage = page.locator("[data-more-button]");
    await expect(btnToLastPage).toBeVisible();
    await btnToLastPage.click();

    const expectedLastPageIDs = [...PIZZA_ALL_PAGES[11]!];
    await expect.poll(() => renderedCardIDs(page)).toEqual(expectedLastPageIDs);
    const lastPageIDs = await renderedCardIDs(page);
    expect(lastPageIDs).toEqual(expectedLastPageIDs);
    expect(lastPageIDs.length).toBe(3);
    allPizzaRenderedIDs.push(...lastPageIDs);

    await expect(page.locator("[data-more-button]")).toHaveCount(0);

    const heading = page.locator("[data-substitutions-heading]");
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText(COPY.en.foundSubstitutions);
    await expect(heading).toBeFocused();

    expect(allPizzaRenderedIDs.length).toBe(36);
    expect(new Set(allPizzaRenderedIDs).size).toBe(36);
    expect(allPizzaRenderedIDs).toEqual(PIZZA_ALL_PAGES.flat());

    const quantityNumberInput = page.locator("#quantity-number");
    await expect(quantityNumberInput).toBeVisible();
    await quantityNumberInput.fill("2");
    await quantityNumberInput.press("Enter");

    await expect.poll(() => posts.at(-1)?.body.pageIndex).toBe(11);
    expect(posts.at(-1)?.body).toEqual({
      foodObjectId: 1,
      pageIndex: 11,
    });

    await expect.poll(() => renderedCardIDs(page)).toEqual(expectedLastPageIDs);
    expect(await renderedCardIDs(page)).toEqual(expectedLastPageIDs);
    await expect(page.locator("[data-more-button]")).toHaveCount(0);
  });

  test("traversing all 13 pages of Chicken breast in Polish (partial one-card last page) proves unique IDs across all pages, results heading focus after every successful page with MORE! omitted on the partial last page, and valid quantity edit on the partial last page", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["pl-PL"]);
    const posts = trackSubstitutePosts(page);

    await page.goto("/");
    await selectFoodObject(page, "kurczaka", 5, COPY.pl);

    expect(posts.length).toBe(1);
    expect(posts[0]?.body).toEqual({
      foodObjectId: 5,
      pageIndex: 0,
    });
    const page0IDs = await renderedCardIDs(page);
    expect(page0IDs).toEqual([...CHICKEN_ALL_PAGES[0]!]);

    const allChickenRenderedIDs: number[] = [...page0IDs];

    for (let pageIdx = 1; pageIdx <= 11; pageIdx++) {
      const moreBtn = page.locator("[data-more-button]");
      await expect(moreBtn).toBeVisible();
      await expect(moreBtn).toHaveText(COPY.pl.moreButton);
      await moreBtn.click();

      const expectedPageIDs = [...CHICKEN_ALL_PAGES[pageIdx]!];
      await expect.poll(() => renderedCardIDs(page)).toEqual(expectedPageIDs);
      const currentIDs = await renderedCardIDs(page);
      expect(currentIDs).toEqual(expectedPageIDs);
      expect(currentIDs.length).toBe(3);
      allChickenRenderedIDs.push(...currentIDs);

      await expect(page.locator("[data-substitutions-heading]")).toBeFocused();
    }

    const btnToLastPage = page.locator("[data-more-button]");
    await expect(btnToLastPage).toBeVisible();
    await btnToLastPage.click();

    const expectedLastPageIDs = [...CHICKEN_ALL_PAGES[12]!];
    await expect.poll(() => renderedCardIDs(page)).toEqual(expectedLastPageIDs);
    const lastPageIDs = await renderedCardIDs(page);
    expect(lastPageIDs).toEqual(expectedLastPageIDs);
    expect(lastPageIDs.length).toBe(1);
    allChickenRenderedIDs.push(...lastPageIDs);

    await expect(page.locator("[data-more-button]")).toHaveCount(0);
    await expect(page.locator("[data-result-card]")).toHaveCount(1);

    const heading = page.locator("[data-substitutions-heading]");
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText(COPY.pl.foundSubstitutions);
    await expect(heading).toBeFocused();

    expect(allChickenRenderedIDs.length).toBe(37);
    expect(new Set(allChickenRenderedIDs).size).toBe(37);
    expect(allChickenRenderedIDs).toEqual(CHICKEN_ALL_PAGES.flat());

    const quantityNumberInput = page.locator("#quantity-number");
    await expect(quantityNumberInput).toBeVisible();
    await quantityNumberInput.fill("200");
    await quantityNumberInput.press("Enter");

    await expect.poll(() => posts.at(-1)?.body.pageIndex).toBe(12);
    expect(posts.at(-1)?.body).toEqual({
      foodObjectId: 5,
      pageIndex: 12,
    });

    await expect.poll(() => renderedCardIDs(page)).toEqual(expectedLastPageIDs);
    expect(await renderedCardIDs(page)).toEqual(expectedLastPageIDs);
    await expect(page.locator("[data-more-button]")).toHaveCount(0);
    await expect(page.locator("[data-result-card]")).toHaveCount(1);
  });
  test("MORE! preserves the Food Quantity controls through pending and fulfilled paging", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const posts = trackSubstitutePosts(page);

    let postCount = 0;
    let releaseMoreGate: () => void = () => {};
    const moreGate = new Promise<void>((resolve) => {
      releaseMoreGate = resolve;
    });

    await page.route("**/api/v1/substitutes/search", async (route) => {
      postCount += 1;
      if (postCount === 2) {
        await moreGate;
      }
      await route.continue();
    });

    await page.goto("/");
    await selectFoodObject(page, "margherita", 1, COPY.en);

    const numberInput = page.locator("[data-quantity-number]");
    const unitSelect = page.locator("[data-quantity-unit]");
    const [numberInputClass, unitSelectClass] = await Promise.all([
      numberInput.getAttribute("class"),
      unitSelect.getAttribute("class"),
    ]);
    expect(numberInputClass).not.toBeNull();
    expect(unitSelectClass).not.toBeNull();

    await page.locator("[data-more-button]").click();
    await expect.poll(() => posts.length).toBe(2);
    await expect(numberInput).toHaveAttribute("class", numberInputClass!);
    await expect(unitSelect).toHaveAttribute("class", unitSelectClass!);

    releaseMoreGate();
    await expect(page.locator("[data-result-card]")).toHaveCount(3);
    await expect(numberInput).toHaveAttribute("class", numberInputClass!);
    await expect(unitSelect).toHaveAttribute("class", unitSelectClass!);
  });
});
