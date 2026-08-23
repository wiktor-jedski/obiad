import { expect, test, type Page } from "@playwright/test";

/**
 * Real-stack intermediate MORE! result-paging scenario (task 37; ARCH-001,
 * ARCH-002, ARCH-003, ARCH-008, ARCH-011, ARCH-018, ARCH-019, ARCH-020,
 * ARCH-022, REQ-041, REQ-042, REQ-047, REQ-065, ISSUE-011).
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
 * - A second intermediate activation requests page 2 (`pageIndex: 2`),
 *   replaces the cards with ranks 7 through 9, and leaves MORE! as
 *   `document.activeElement` (REQ-065).
 */

const COPY = {
  en: {
    searchPlaceholder: "Search foods",
    moreButton: "MORE!",
    foundSubstitutions: "Found substitutions",
  },
  pl: {
    searchPlaceholder: "Szukaj potraw",
    moreButton: "MORE!",
    foundSubstitutions: "Znalezione zamienniki",
  },
} as const;

/**
 * Seeded designated acceptance ranking fixtures (ISSUE-002, REQ-072).
 * Pizza Margherita (ID 1, 1 serving = 350 g):
 * - Page 0 (ranks 1-3): [13, 29, 26] (Gyoza, Paella, Pancakes)
 * - Page 1 (ranks 4-6): [30, 3, 35] (Pho, Lasagna, Pastel de nata)
 * - Page 2 (ranks 7-9): [14, 4, 21] (Oat milk, Pierogi, Beef cheeseburger)
 */
const PIZZA_SEEDED_RANKS = {
  page0: [13, 29, 26],
  page1: [30, 3, 35],
  page2: [14, 4, 21],
} as const;

/**
 * Chicken breast (ID 5, 100 g):
 * - Page 0 (ranks 1-3): [23, 11, 6] (Turkey breast, Skyr yogurt, Pork chop)
 * - Page 1 (ranks 4-6): [7, 20, 12] (Beef steak, Protein shake, Greek yogurt)
 * - Page 2 (ranks 7-9): [17, 38, 22] (Polish chicken soup, Goulash, Fried chicken wings)
 */
const CHICKEN_SEEDED_RANKS = {
  page0: [23, 11, 6],
  page1: [7, 20, 12],
  page2: [17, 38, 22],
} as const;

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
  test("activating MORE! commits pageIndex 1, shows the spinner in the focused control while retaining page-0 cards, replaces cards with ranks 4 through 6 on fulfillment without animation, and advances to page 2 on second activation leaving MORE! focused", async ({
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
    expect(page0IDs).toEqual([...PIZZA_SEEDED_RANKS.page0]);

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
    expect(pendingCards).toEqual([...PIZZA_SEEDED_RANKS.page0]);

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
    expect(page1IDs).toEqual([...PIZZA_SEEDED_RANKS.page1]);

    // Verify all IDs across page 0 and page 1 are unique
    const observedIDs = [...page0IDs, ...page1IDs];
    const uniqueIDs = new Set(observedIDs);
    expect(uniqueIDs.size).toBe(observedIDs.length);

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

    // Second intermediate success: click MORE! again to request page 2 (ranks 7 through 9)
    await moreButton.click();

    await expect.poll(() => posts.length).toBe(3);
    expect(posts[2]?.body).toEqual({
      foodObjectId: 1,
      quantity: { value: 1, unit: "serving" },
      pageIndex: 2,
    });

    // Wait for page 2 response to arrive and cards to update
    await expect
      .poll(() => renderedCardIDs(page))
      .toEqual([...PIZZA_SEEDED_RANKS.page2]);
    const page2IDs = await renderedCardIDs(page);
    expect(page2IDs).toEqual([...PIZZA_SEEDED_RANKS.page2]);

    // Verify all 9 observed Food Object IDs across pages 0, 1, and 2 are unique (REQ-042)
    const allObserved = [...page0IDs, ...page1IDs, ...page2IDs];
    expect(new Set(allObserved).size).toBe(9);

    // REQ-065: Intermediate success leaves MORE! as document.activeElement
    await expect(moreButton).toBeFocused();
    const isActiveElement = await page.evaluate(
      () =>
        document.activeElement === document.querySelector("[data-more-button]"),
    );
    expect(isActiveElement).toBe(true);
  });

  test("paging works in Polish with Chicken breast fixture, preserving unique IDs across pages and focus on MORE!", async ({
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
    expect(page0IDs).toEqual([...CHICKEN_SEEDED_RANKS.page0]);

    const moreButton = page.locator("[data-more-button]");
    await expect(moreButton).toBeVisible();
    await expect(moreButton).toHaveText(COPY.pl.moreButton);

    // Click MORE! for page 1
    await moreButton.click();

    await expect.poll(() => posts.length).toBe(2);
    expect(posts[1]?.body).toEqual({
      foodObjectId: 5,
      quantity: { value: 100, unit: "g" },
      pageIndex: 1,
    });

    await expect
      .poll(() => renderedCardIDs(page))
      .toEqual([...CHICKEN_SEEDED_RANKS.page1]);
    const page1IDs = await renderedCardIDs(page);
    expect(page1IDs).toEqual([...CHICKEN_SEEDED_RANKS.page1]);

    // Unique IDs across pages 0 and 1
    const combined = [...page0IDs, ...page1IDs];
    expect(new Set(combined).size).toBe(6);

    // MORE! remains document.activeElement (REQ-065)
    await expect(moreButton).toBeFocused();
  });
});
