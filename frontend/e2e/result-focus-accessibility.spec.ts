import { expect, test, type Page } from "@playwright/test";

/**
 * Real-stack result-focus accessibility scenario (task 45, Phase 15;
 * ARCH-001, ARCH-002, ARCH-003, ARCH-011, ARCH-020, ARCH-022, REQ-083,
 * REQ-085, ISSUE-014; P15-G3, P15-G5, P15-G7).
 *
 * `bun run test:e2e` runs these tests against the complete disposable stack
 * started by `./e2e/launcher.ts`: disposable PostgreSQL 17 seeded by the
 * real setup command, the real Fiber process on the fixed loopback listener
 * 127.0.0.1:8080, and the optimized Vite preview on the strict port 4173.
 * Each scenario starts in a fresh unauthenticated browser context.
 *
 * Task 45 completes the nonzero successful-result focus transition over
 * task 44: after the rendered page replaces a successful new Search, an
 * intermediate MORE! page, or the last page, keyboard focus moves to the
 * stable programmatically focusable localized results heading (the
 * `data-substitutions-heading` element, `tabindex="-1"`). The superseded
 * Search-focus (REQ-064), MORE!-focus (REQ-065), and last-page-only
 * heading-focus (REQ-066) success paths are removed. Failure focus,
 * request identity, result order, layout, and color stay unchanged, and
 * successful nonzero states stay free of result-count and result-status
 * live-region messages (REQ-085, ISSUE-014).
 *
 * It verifies, in English and Polish:
 * - The localized results heading is `document.activeElement` ONLY after
 *   each response renders for a successful new Search, an intermediate
 *   MORE! page, and both full and partial last pages (REQ-083, P15-G3):
 *   while a new Search is pending the result region — and the heading — is
 *   not yet rendered and Search keeps focus; while a MORE! request is
 *   pending the retained heading exists but is not the active element and
 *   the focused MORE! control keeps focus.
 * - No result-count or result-status live-region insertion or update
 *   happens during any successful transition (REQ-085, P15-G5, P15-G7): a
 *   MutationObserver records every live-region (`[aria-live]`,
 *   `[role="status"]`, `[role="alert"]`) insertion and text update for the
 *   whole flow, and the only observed live text is the existing polite
 *   loading announcement; no entry matches a result-count or result-status
 *   message shape.
 * - The English flow traverses all 12 pages of Pizza Margherita (36
 *   eligible substitutes) and ends on the full three-card last page
 *   (page 11); the Polish flow traverses all 13 pages of Chicken breast
 *   (37 eligible substitutes) and ends on the partial one-card last page
 *   (page 12). MORE! is omitted on each last page (`hasMore: false`).
 *
 * The existing new-Search failure and MORE! failure scenarios in
 * `substitution-request-failures.spec.ts` run unchanged in the same suite
 * and keep their established focus (ISSUE-013); this scenario exercises
 * only successful transitions, so it never renders the retry status
 * region.
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
 * Complete seeded designated acceptance ranking fixtures (ISSUE-002,
 * REQ-072), used to prove that each requested page actually rendered
 * before the heading-focus assertion. Pizza Margherita (ID 1, 1 serving =
 * 350 g, Food Family ID 1): 36 eligible candidates across 12 pages; page
 * 11 is the full three-card last page. Chicken breast (ID 5, 100 g, no
 * food family): 37 eligible candidates across 13 pages; page 12 is the
 * partial one-card last page.
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

/** One recorded live-region insertion or text update (REQ-085). */
interface LiveRegionEntry {
  readonly kind: "insert" | "update";
  readonly text: string;
}

/**
 * The browser-window slot the MutationObserver fills before the
 * application scripts run (declared here so the spec reads and writes it
 * without an unchecked inline cast).
 */
declare global {
  interface Window {
    __liveRegionEntries?: LiveRegionEntry[];
  }
}

/**
 * REQ-085 result-count or result-status message shape: the app must never
 * send such text through a live region after a successful result state
 * loads. The allowed existing announcements — the polite busy status
 * (`Loading nutrition values` / `Ładowanie wartości odżywczych`, `Updating
 * quantities` / `Aktualizowanie ilości`), the quantity-validation message,
 * and the ISSUE-013 retry message — never match this pattern in the
 * successful transitions this scenario drives, and the retry status region
 * is never rendered here.
 */
const RESULT_COUNT_OR_STATUS =
  /(found|znaleziono|showing|wyświetlono|substitutions?|results?|zamiennik|wynik)/i;

/**
 * Installs a MutationObserver before the application scripts run that
 * records every live-region (`[aria-live]`, `[role="status"]`,
 * `[role="alert"]`) element insertion and text update on
 * `window.__liveRegionEntries`. Insertions and updates with empty text are
 * not recorded (they carry no message).
 */
async function trackLiveRegions(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const LIVE_SELECTOR = '[aria-live], [role="status"], [role="alert"]';
    const entries: LiveRegionEntry[] = [];
    window.__liveRegionEntries = entries;
    const record = (kind: LiveRegionEntry["kind"], node: Element): void => {
      const text = (node.textContent ?? "").trim();
      if (text !== "") {
        entries.push({ kind, text });
      }
    };
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const added of mutation.addedNodes) {
          if (!(added instanceof Element)) {
            continue;
          }
          if (added.matches(LIVE_SELECTOR)) {
            record("insert", added);
          }
          added
            .querySelectorAll(LIVE_SELECTOR)
            .forEach((node) => record("insert", node));
        }
        if (mutation.type === "characterData") {
          const parent = mutation.target.parentElement;
          if (parent !== null && parent.matches(LIVE_SELECTOR)) {
            record("update", parent);
          }
        }
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
}

/** Returns the recorded live-region entries observed so far. */
async function liveRegionEntries(
  page: Page,
): Promise<readonly LiveRegionEntry[]> {
  return page.evaluate(() => {
    const store = window.__liveRegionEntries;
    return store === undefined ? [] : store;
  });
}

/**
 * Asserts that the live-region entries recorded since the previous
 * snapshot contain no result-count or result-status message (REQ-085).
 */
function expectNoResultLiveAnnouncements(
  entries: readonly LiveRegionEntry[],
  label: string,
): void {
  const offenders = entries.filter((entry) =>
    RESULT_COUNT_OR_STATUS.test(entry.text),
  );
  expect(
    offenders,
    `${label}: no result-count or result-status live-region insertion or update (REQ-085)`,
  ).toEqual([]);
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

/** Drives one pointer selection of the given seeded suggestion option. */
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
}

test.describe("Result focus and accessibility", () => {
  test("after every successful English result page — a new Search, an intermediate MORE! page, and the full three-card last page — the localized results heading becomes document.activeElement only after the response renders, with no result-count or result-status live-region insertion or update (P15-G3, P15-G5, REQ-083, REQ-085)", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    await trackLiveRegions(page);

    // Hold the new-Search response and the first MORE! response at the
    // browser boundary so the pending focus state can be observed before
    // either response renders (P15-G3, REQ-083).
    let postCount = 0;
    let releaseNewSearchGate: () => void = () => {};
    const newSearchGate = new Promise<void>((resolve) => {
      releaseNewSearchGate = resolve;
    });
    let releaseMoreGate: () => void = () => {};
    const moreGate = new Promise<void>((resolve) => {
      releaseMoreGate = resolve;
    });
    await page.route("**/api/v1/substitutes/search", async (route) => {
      postCount += 1;
      if (postCount === 1) {
        await newSearchGate;
      } else if (postCount === 2) {
        await moreGate;
      }
      await route.continue();
    });

    await page.goto("/");
    const heading = page.locator("[data-substitutions-heading]");
    const searchInput = page.getByPlaceholder(COPY.en.searchPlaceholder);

    // --- Successful new Search: the heading is active only after the
    // response renders (REQ-083). ---
    await selectFoodObject(page, "margherita", 1, COPY.en);

    // While the new Search is pending, the result region — and with it the
    // heading — is not yet rendered, and Search keeps focus: the heading
    // cannot be the active element before the response renders.
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "loadingNew",
    );
    await expect(searchInput).toBeFocused();
    await expect(heading).toHaveCount(0);

    // Fulfillment renders the result page; only then does the heading
    // become the active element.
    releaseNewSearchGate();
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    await expect(page.locator("[data-result-card]")).toHaveCount(3);
    await expect(heading).toHaveText(COPY.en.foundSubstitutions);
    await expect(heading).toBeFocused();

    let snapshot = await liveRegionEntries(page);
    expectNoResultLiveAnnouncements(snapshot, "new Search (English)");

    // --- Successful intermediate MORE! page (page 1): the retained heading
    // exists while pending but is not the active element; after the
    // response renders the heading becomes the active element (REQ-083). ---
    const moreButton = page.locator("[data-more-button]");
    await expect(moreButton).toBeVisible();
    await moreButton.click();

    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "loadingMore",
    );
    await expect(moreButton).toBeFocused();
    await expect(heading).not.toBeFocused();

    releaseMoreGate();
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    await expect
      .poll(() => renderedCardIDs(page))
      .toEqual([...PIZZA_ALL_PAGES[1]!]);
    await expect(heading).toBeFocused();

    let next = await liveRegionEntries(page);
    expectNoResultLiveAnnouncements(
      next.slice(snapshot.length),
      "intermediate MORE! page (English)",
    );
    snapshot = next;

    // --- Remaining intermediate pages 2 through 10: the heading is the
    // active element after each successful page renders. ---
    for (let pageIndex = 2; pageIndex <= 10; pageIndex++) {
      const button = page.locator("[data-more-button]");
      await expect(button).toBeVisible();
      await button.click();
      await expect
        .poll(() => renderedCardIDs(page))
        .toEqual([...PIZZA_ALL_PAGES[pageIndex]!]);
      await expect(heading).toBeFocused();
    }

    // --- Full three-card last page (page 11): MORE! is omitted and the
    // heading is the active element after the response renders. ---
    const lastButton = page.locator("[data-more-button]");
    await expect(lastButton).toBeVisible();
    await lastButton.click();
    await expect
      .poll(() => renderedCardIDs(page))
      .toEqual([...PIZZA_ALL_PAGES[11]!]);
    await expect(page.locator("[data-more-button]")).toHaveCount(0);
    await expect(heading).toHaveText(COPY.en.foundSubstitutions);
    await expect(heading).toBeFocused();

    next = await liveRegionEntries(page);
    expectNoResultLiveAnnouncements(
      next.slice(snapshot.length),
      "full last page (English)",
    );
    expectNoResultLiveAnnouncements(
      next,
      "whole English flow (REQ-085)",
    );
  });

  test("after every successful Polish result page — a new Search, an intermediate MORE! page, and the partial one-card last page — the localized results heading becomes document.activeElement only after the response renders, with no result-count or result-status live-region insertion or update (P15-G3, P15-G7, REQ-083, REQ-085)", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["pl-PL"]);
    await trackLiveRegions(page);

    let postCount = 0;
    let releaseNewSearchGate: () => void = () => {};
    const newSearchGate = new Promise<void>((resolve) => {
      releaseNewSearchGate = resolve;
    });
    let releaseMoreGate: () => void = () => {};
    const moreGate = new Promise<void>((resolve) => {
      releaseMoreGate = resolve;
    });
    await page.route("**/api/v1/substitutes/search", async (route) => {
      postCount += 1;
      if (postCount === 1) {
        await newSearchGate;
      } else if (postCount === 2) {
        await moreGate;
      }
      await route.continue();
    });

    await page.goto("/");
    const heading = page.locator("[data-substitutions-heading]");
    const searchInput = page.getByPlaceholder(COPY.pl.searchPlaceholder);

    // --- Successful new Search (Polish): the heading is active only after
    // the response renders (REQ-083). ---
    await selectFoodObject(page, "kurczaka", 5, COPY.pl);

    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "loadingNew",
    );
    await expect(searchInput).toBeFocused();
    await expect(heading).toHaveCount(0);

    releaseNewSearchGate();
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    await expect(page.locator("[data-result-card]")).toHaveCount(3);
    await expect(heading).toHaveText(COPY.pl.foundSubstitutions);
    await expect(heading).toBeFocused();

    let snapshot = await liveRegionEntries(page);
    expectNoResultLiveAnnouncements(snapshot, "new Search (Polish)");

    // --- Successful intermediate MORE! page (page 1, Polish): the retained
    // heading exists while pending but is not the active element; after the
    // response renders the heading becomes the active element (REQ-083). ---
    const moreButton = page.locator("[data-more-button]");
    await expect(moreButton).toBeVisible();
    await moreButton.click();

    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "loadingMore",
    );
    await expect(moreButton).toBeFocused();
    await expect(heading).not.toBeFocused();

    releaseMoreGate();
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    await expect
      .poll(() => renderedCardIDs(page))
      .toEqual([...CHICKEN_ALL_PAGES[1]!]);
    await expect(heading).toBeFocused();

    let next = await liveRegionEntries(page);
    expectNoResultLiveAnnouncements(
      next.slice(snapshot.length),
      "intermediate MORE! page (Polish)",
    );
    snapshot = next;

    // --- Remaining intermediate pages 2 through 11: the heading is the
    // active element after each successful page renders. ---
    for (let pageIndex = 2; pageIndex <= 11; pageIndex++) {
      const button = page.locator("[data-more-button]");
      await expect(button).toBeVisible();
      await button.click();
      await expect
        .poll(() => renderedCardIDs(page))
        .toEqual([...CHICKEN_ALL_PAGES[pageIndex]!]);
      await expect(heading).toBeFocused();
    }

    // --- Partial one-card last page (page 12): MORE! is omitted and the
    // heading is the active element after the response renders. ---
    const lastButton = page.locator("[data-more-button]");
    await expect(lastButton).toBeVisible();
    await lastButton.click();
    await expect
      .poll(() => renderedCardIDs(page))
      .toEqual([...CHICKEN_ALL_PAGES[12]!]);
    await expect(page.locator("[data-more-button]")).toHaveCount(0);
    await expect(page.locator("[data-result-card]")).toHaveCount(1);
    await expect(heading).toHaveText(COPY.pl.foundSubstitutions);
    await expect(heading).toBeFocused();

    next = await liveRegionEntries(page);
    expectNoResultLiveAnnouncements(
      next.slice(snapshot.length),
      "partial last page (Polish)",
    );
    expectNoResultLiveAnnouncements(
      next,
      "whole Polish flow (REQ-085)",
    );
  });
});
