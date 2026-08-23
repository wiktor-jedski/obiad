import { expect, test, type Page } from "@playwright/test";

/**
 * Real-stack MORE! result-paging scenario (task 37, task 38; ARCH-001,
 * ARCH-002, ARCH-003, ARCH-008, ARCH-011, ARCH-018, ARCH-019, ARCH-020,
 * ARCH-022, REQ-041, REQ-042, REQ-043, REQ-045, REQ-047, REQ-064,
 * REQ-065, REQ-066, ISSUE-011).
 *
 * This scenario runs against the self-cleaning real stack behind `bun run
 * test:e2e`: disposable loopback PostgreSQL 17, fixed Fiber at
 * `127.0.0.1:8080`, and the strict-port optimized Vite preview at
 * `http://127.0.0.1:4173` (ISSUE-006, ISSUE-011).
 *
 * It verifies that:
 * - Activating MORE! commits `pageIndex: 1` with the same selected Food
 *   Object and committed Food Quantity and starts one generated-client
 *   `POST /api/v1/substitutes/search` request with `pageIndex: 1` (REQ-041).
 * - While the real request is held at the browser boundary, the current
 *   page-0 cards remain visible and the spinner inside the focused MORE!
 *   control replaces its visible label (REQ-047, P11-G5).
 * - Fulfillment removes the spinner; the three page-1 cards replace all
 *   three page-0 cards (ranks 4 through 6) instead of appending, match
 *   the backend ranking, remain unique across observed pages, and show no
 *   card transition or animation (REQ-041, REQ-042, P11-G7).
 * - Intermediate activations leave MORE! as `document.activeElement`
 *   (REQ-065).
 * - Selecting a new Food Object from page 2 resets `pageIndex` to 0, sends
 *   `pageIndex: 0`, renders that input's ranks 1 through 3, and retains
 *   Search focus (REQ-045, REQ-064, P11-G9).
 * - Traversing all real pages for a seeded Pizza-family input (Pizza
 *   Margherita, 36 eligible substitutes) reaches a full three-card last
 *   page (page 11); MORE! is omitted on the last page (`hasMore: false`)
 *   and programmatic focus moves to the stable results heading (REQ-043,
 *   REQ-066, P11-G6, P11-G9).
 * - All 36 Food Object IDs across the complete Pizza Margherita search
 *   are unique (REQ-042, P11-G8).
 * - Traversing all real pages for a seeded no-family input (Chicken
 *   breast in Polish, 37 eligible substitutes) reaches a partial
 *   one-card last page (page 12); MORE! is omitted and programmatic focus
 *   moves to the stable results heading (REQ-043, REQ-066, P11-G6, P11-G9).
 * - All 37 Food Object IDs across the complete Chicken breast search are
 *   unique (REQ-042, P11-G8).
 * - Valid Food Quantity edits on later and last pages continue to request
 *   and render the unchanged current page.
 */

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

/**
 * Complete seeded designated acceptance ranking fixtures (ISSUE-002, REQ-072).
 * Pizza Margherita (ID 1, 1 serving = 350 g, Food Family ID 1):
 * Total 36 eligible candidates (ranks 0..35 across 12 pages, pageIndex 0..11).
 * Page 11 is a full three-card last page.
 */
const PIZZA_ALL_PAGES: readonly (readonly number[])[] = [
  [13, 29, 26], // page 0: Gyoza, Paella, Pancakes
  [30, 3, 35], // page 1: Pho, Lasagna, Pastel de nata
  [14, 4, 21], // page 2: Oat milk, Pierogi, Beef cheeseburger
  [28, 24, 25], // page 3: Oatmeal, Pickled cucumbers, Tomatoes
  [10, 31, 36], // page 4: Milk, Beetroot borscht, Cheesecake
  [34, 8, 37], // page 5: Bandeja paisa, Mixed berries, Orange juice
  [33, 15, 32], // page 6: Mondongo, Kebab, Coleslaw
  [9, 16, 17], // page 7: Apple juice, Gyros, Polish chicken soup
  [12, 20, 38], // page 8: Greek yogurt, Protein shake, Goulash
  [22, 11, 27], // page 9: Fried chicken wings, Skyr yogurt, Omelette
  [7, 6, 5], // page 10: Beef steak, Pork chop, Chicken breast
  [23, 18, 19], // page 11: Turkey breast, Butter, Olive oil (full 3-card last page)
] as const;

/**
 * Chicken breast (ID 5, 100 g, no food family):
 * Total 37 eligible candidates (ranks 0..36 across 13 pages, pageIndex 0..12).
 * Page 12 is a partial one-card last page.
 */
const CHICKEN_ALL_PAGES: readonly (readonly number[])[] = [
  [23, 11, 6], // page 0: Turkey breast, Skyr yogurt, Pork chop
  [7, 20, 12], // page 1: Beef steak, Protein shake, Greek yogurt
  [17, 38, 22], // page 2: Polish chicken soup, Goulash, Fried chicken wings
  [16, 27, 33], // page 3: Gyros, Omelette, Mondongo
  [15, 10, 34], // page 4: Kebab, Milk, Bandeja paisa
  [21, 3, 29], // page 5: Beef cheeseburger, Lasagna, Paella
  [2, 30, 13], // page 6: Pizza Capricciosa, Pho, Gyoza
  [1, 36, 24], // page 7: Pizza Margherita, Cheesecake, Pickled cucumbers
  [26, 25, 28], // page 8: Pancakes, Tomatoes, Oatmeal
  [4, 35, 14], // page 9: Pierogi, Pastel de nata, Oat milk
  [32, 31, 18], // page 10: Coleslaw, Beetroot borscht, Butter
  [19, 8, 37], // page 11: Olive oil, Mixed berries, Orange juice
  [9], // page 12: Apple juice (partial 1-card last page)
] as const;

/** Overrides `navigator.languages` before the application scripts run. */
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

/** One observed generated-client Substitution Search POST. */
interface SubstitutePost {
  body: {
    foodObjectId?: number;
    quantity?: { value: number; unit: string };
    pageIndex?: number;
  };
  status: number | null;
}

/**
 * Records every generated-client `POST /api/v1/substitutes/search` request
 * and the status of its real-stack response.
 */
function trackSubstitutePosts(page: Page): SubstitutePost[] {
  const posts: SubstitutePost[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/v1/substitutes/search")
    ) {
      posts.push({
        body: request.postDataJSON() as SubstitutePost["body"],
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

/** Drives one pointer selection and waits for the initial result state. */
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

/** Returns the Food Object IDs of all currently rendered result cards. */
async function renderedCardIDs(page: Page): Promise<number[]> {
  const cards = page.locator("[data-result-card]");
  return cards.evaluateAll((elements) =>
    elements.map((element) =>
      Number(element.getAttribute("data-food-object-id")),
    ),
  );
}

test.describe("MORE! result paging", () => {
  test("traversing all 12 pages of Pizza Margherita (full three-card last page) proves pending spinner, replacement without animation, MORE! focus on intermediate pages, results heading focus on the last page with MORE! omitted, unique IDs across all pages, new-search reset from page 2, and valid quantity edit on the last page", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const posts = trackSubstitutePosts(page);

    // Hold the second POST (the first MORE! request) at the browser boundary
    // so the pending interval, focus, and retained cards can be asserted (P11-G5, REQ-047).
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

    // Verify page 0 loaded with expected ranks [13, 29, 26]
    expect(posts.length).toBe(1);
    expect(posts[0]?.body).toEqual({
      foodObjectId: 1,
      quantity: { value: 1, unit: "serving" },
      pageIndex: 0,
    });
    const page0IDs = await renderedCardIDs(page);
    expect(page0IDs).toEqual([...PIZZA_ALL_PAGES[0]!]);

    // The MORE! button is rendered after the result grid with visible label "MORE!"
    const moreButton = page.locator("[data-more-button]");
    await expect(moreButton).toBeVisible();
    await expect(moreButton).toHaveText(COPY.en.moreButton);
    await expect(moreButton).toHaveAttribute("aria-label", COPY.en.moreButton);
    await expect(page.locator("[data-more-spinner]")).toHaveCount(0);

    // Click MORE! once
    await moreButton.click();

    // Assert request 2 was submitted with pageIndex 1 and unchanged foodObjectId and quantity
    await expect.poll(() => posts.length).toBe(2);
    expect(posts[1]?.body).toEqual({
      foodObjectId: 1,
      quantity: { value: 1, unit: "serving" },
      pageIndex: 1,
    });

    // P11-G5 / REQ-047: For the complete pending interval, the current cards
    // remain visible and the spinner inside the focused control replaces its visible label.
    await expect(page.locator("[data-interaction-state]")).toHaveAttribute(
      "data-interaction-state",
      "loadingMore",
    );

    // Current page 0 cards remain rendered and visible
    const pendingCards = await renderedCardIDs(page);
    expect(pendingCards).toEqual([...PIZZA_ALL_PAGES[0]!]);

    // Focus is on MORE!
    await expect(moreButton).toBeFocused();

    // The spinner inside the MORE! control is visible and aria-hidden
    const spinner = page.locator("[data-more-button] [data-more-spinner]");
    await expect(spinner).toBeVisible();
    await expect(spinner).toHaveAttribute("aria-hidden", "true");

    // The visible label "MORE!" is replaced by the spinner
    await expect(moreButton).not.toHaveText(COPY.en.moreButton);

    // Fulfill the request: release the gate
    releaseMoreGate();

    // Fulfillment removes the spinner and restores the visible label
    await expect(page.locator("[data-more-spinner]")).toHaveCount(0);
    await expect(moreButton).toHaveText(COPY.en.moreButton);
    await expect(page.locator("[data-interaction-state]")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );

    // P11-G7 / REQ-041 / REQ-042: The three page-1 IDs replace all three page-0
    // IDs instead of appending, match backend ranks 4 through 6, remain unique
    // across observed pages, and show no card transition or animation.
    const page1Cards = page.locator("[data-result-card]");
    await expect(page1Cards).toHaveCount(3);
    const page1IDs = await renderedCardIDs(page);
    expect(page1IDs).toEqual([...PIZZA_ALL_PAGES[1]!]);

    // Verify all IDs across page 0 and page 1 are unique
    const observedIDs = [...page0IDs, ...page1IDs];
    expect(new Set(observedIDs).size).toBe(observedIDs.length);

    // Verify no card transition or animation is running
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

    // Second intermediate activation: click MORE! to request page 2 (ranks 7 through 9)
    await moreButton.click();

    await expect.poll(() => posts.length).toBe(3);
    expect(posts[2]?.body).toEqual({
      foodObjectId: 1,
      quantity: { value: 1, unit: "serving" },
      pageIndex: 2,
    });

    await expect
      .poll(() => renderedCardIDs(page))
      .toEqual([...PIZZA_ALL_PAGES[2]!]);
    const page2IDs = await renderedCardIDs(page);
    expect(page2IDs).toEqual([...PIZZA_ALL_PAGES[2]!]);

    // REQ-065: Intermediate success leaves MORE! as document.activeElement
    await expect(moreButton).toBeFocused();

    // P11-G9 / REQ-045 / REQ-064: A new suggestion selection from page 2 commits
    // page 0, starts request with pageIndex: 0, renders ranks 1-3 of the new food,
    // and keeps focus on the Search field.
    const searchInput = page.getByPlaceholder(COPY.en.searchPlaceholder);
    await searchInput.fill("chicken");
    const chickenOption = page.locator("#food-suggestion-option-5");
    await expect(chickenOption).toBeVisible();
    await chickenOption.click();

    await expect.poll(() => posts.length).toBe(4);
    expect(posts[3]?.body).toEqual({
      foodObjectId: 5,
      quantity: { value: 100, unit: "g" },
      pageIndex: 0,
    });

    // Chicken breast page 0 ranks [23, 11, 6] replace page 2's cards
    await expect
      .poll(() => renderedCardIDs(page))
      .toEqual([...CHICKEN_ALL_PAGES[0]!]);
    expect(await renderedCardIDs(page)).toEqual([...CHICKEN_ALL_PAGES[0]!]);

    // Search field retains focus (REQ-064)
    await expect(searchInput).toBeFocused();

    // Now re-select Pizza Margherita to traverse all 12 pages from page 0 to page 11
    await searchInput.fill("margherita");
    const pizzaOption = page.locator("#food-suggestion-option-1");
    await expect(pizzaOption).toBeVisible();
    await pizzaOption.click();

    await expect
      .poll(() => renderedCardIDs(page))
      .toEqual([...PIZZA_ALL_PAGES[0]!]);

    const allPizzaRenderedIDs: number[] = [...PIZZA_ALL_PAGES[0]!];

    // Traverse pages 1 through 10 (intermediate pages)
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

      // REQ-065: MORE! is document.activeElement on intermediate pages
      await expect(btn).toBeFocused();
    }

    // P11-G6 / REQ-043 / REQ-066 / P11-G9: Click MORE! to advance to page 11 (full 3-card last page)
    const btnToLastPage = page.locator("[data-more-button]");
    await expect(btnToLastPage).toBeVisible();
    await btnToLastPage.click();

    const expectedLastPageIDs = [...PIZZA_ALL_PAGES[11]!];
    await expect.poll(() => renderedCardIDs(page)).toEqual(expectedLastPageIDs);
    const lastPageIDs = await renderedCardIDs(page);
    expect(lastPageIDs).toEqual(expectedLastPageIDs);
    expect(lastPageIDs.length).toBe(3);
    allPizzaRenderedIDs.push(...lastPageIDs);

    // REQ-043 / P11-G6: Last page shows all remaining API IDs and omits MORE! control
    await expect(page.locator("[data-more-button]")).toHaveCount(0);

    // REQ-066 / P11-G9: Programmatic focus moves to the stable results heading on last page
    const heading = page.locator("[data-substitutions-heading]");
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText(COPY.en.foundSubstitutions);
    await expect(heading).toBeFocused();

    // P11-G8 / REQ-042: All 36 Food Object IDs across all 12 pages of the complete
    // Substitution Search are unique and match the expected fixture ranks.
    expect(allPizzaRenderedIDs.length).toBe(36);
    expect(new Set(allPizzaRenderedIDs).size).toBe(36);
    expect(allPizzaRenderedIDs).toEqual(PIZZA_ALL_PAGES.flat());

    // Existing valid Food Quantity edits on the last page continue to request and render the unchanged current page
    const quantityNumberInput = page.locator("#quantity-number");
    await expect(quantityNumberInput).toBeVisible();
    await quantityNumberInput.fill("2");
    await quantityNumberInput.press("Enter");

    // Assert that the request was sent with pageIndex: 11 (unchanged current page)
    await expect.poll(() => posts.at(-1)?.body.pageIndex).toBe(11);
    expect(posts.at(-1)?.body).toEqual({
      foodObjectId: 1,
      quantity: { value: 2, unit: "serving" },
      pageIndex: 11,
    });

    // Cards remain the same 3 IDs [23, 18, 19] and MORE! remains omitted
    await expect.poll(() => renderedCardIDs(page)).toEqual(expectedLastPageIDs);
    expect(await renderedCardIDs(page)).toEqual(expectedLastPageIDs);
    await expect(page.locator("[data-more-button]")).toHaveCount(0);
  });

  test("traversing all 13 pages of Chicken breast in Polish (partial one-card last page) proves unique IDs across all pages, MORE! focus on intermediate pages, results heading focus on the partial last page with MORE! omitted, and valid quantity edit on the partial last page", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["pl-PL"]);
    const posts = trackSubstitutePosts(page);

    await page.goto("/");
    await selectFoodObject(page, "kurczaka", 5, COPY.pl);

    // Page 0 IDs for Chicken breast [23, 11, 6]
    expect(posts.length).toBe(1);
    expect(posts[0]?.body).toEqual({
      foodObjectId: 5,
      quantity: { value: 100, unit: "g" },
      pageIndex: 0,
    });
    const page0IDs = await renderedCardIDs(page);
    expect(page0IDs).toEqual([...CHICKEN_ALL_PAGES[0]!]);

    const allChickenRenderedIDs: number[] = [...page0IDs];

    // Traverse pages 1 through 11 (intermediate pages)
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

      // REQ-065: MORE! is document.activeElement on intermediate pages
      await expect(moreBtn).toBeFocused();
    }

    // P11-G6 / REQ-043 / REQ-066 / P11-G9: Click MORE! to advance to page 12 (partial 1-card last page)
    const btnToLastPage = page.locator("[data-more-button]");
    await expect(btnToLastPage).toBeVisible();
    await btnToLastPage.click();

    const expectedLastPageIDs = [...CHICKEN_ALL_PAGES[12]!];
    await expect.poll(() => renderedCardIDs(page)).toEqual(expectedLastPageIDs);
    const lastPageIDs = await renderedCardIDs(page);
    expect(lastPageIDs).toEqual(expectedLastPageIDs);
    expect(lastPageIDs.length).toBe(1);
    allChickenRenderedIDs.push(...lastPageIDs);

    // REQ-043 / P11-G6: Partial last page shows all remaining API IDs (1 card) and omits MORE! control
    await expect(page.locator("[data-more-button]")).toHaveCount(0);
    await expect(page.locator("[data-result-card]")).toHaveCount(1);

    // REQ-066 / P11-G9: Programmatic focus moves to the stable results heading on partial last page
    const heading = page.locator("[data-substitutions-heading]");
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText(COPY.pl.foundSubstitutions);
    await expect(heading).toBeFocused();

    // P11-G8 / REQ-042: All 37 Food Object IDs across all 13 pages of the complete
    // Substitution Search are unique and match the expected fixture ranks.
    expect(allChickenRenderedIDs.length).toBe(37);
    expect(new Set(allChickenRenderedIDs).size).toBe(37);
    expect(allChickenRenderedIDs).toEqual(CHICKEN_ALL_PAGES.flat());

    // Valid Food Quantity edit on partial last page requests and renders unchanged current page
    const quantityNumberInput = page.locator("#quantity-number");
    await expect(quantityNumberInput).toBeVisible();
    await quantityNumberInput.fill("200");
    await quantityNumberInput.press("Enter");

    // Assert that the request was sent with pageIndex: 12 (unchanged current page)
    await expect.poll(() => posts.at(-1)?.body.pageIndex).toBe(12);
    expect(posts.at(-1)?.body).toEqual({
      foodObjectId: 5,
      quantity: { value: 200, unit: "g" },
      pageIndex: 12,
    });

    // Card remains the single ID [9] and MORE! remains omitted
    await expect.poll(() => renderedCardIDs(page)).toEqual(expectedLastPageIDs);
    expect(await renderedCardIDs(page)).toEqual(expectedLastPageIDs);
    await expect(page.locator("[data-more-button]")).toHaveCount(0);
    await expect(page.locator("[data-result-card]")).toHaveCount(1);
  });
});
