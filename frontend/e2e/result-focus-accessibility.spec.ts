import { expect, test, type Page } from "@playwright/test";

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

interface LiveRegionEntry {
  readonly kind: "insert" | "update";
  readonly text: string;
}

declare global {
  interface Window {
    __liveRegionEntries?: LiveRegionEntry[];
  }
}

const RESULT_COUNT_OR_STATUS =
  /(found|znaleziono|showing|wyświetlono|substitutions?|results?|zamiennik|wynik)/i;

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

async function liveRegionEntries(
  page: Page,
): Promise<readonly LiveRegionEntry[]> {
  return page.evaluate(() => {
    const store = window.__liveRegionEntries;
    return store === undefined ? [] : store;
  });
}

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

async function renderedCardIDs(page: Page): Promise<number[]> {
  const cards = page.locator("[data-result-card]");
  return cards.evaluateAll((elements) =>
    elements.map((element) =>
      Number(element.getAttribute("data-food-object-id")),
    ),
  );
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
}

test.describe("Result focus and accessibility", () => {
  test("after every successful English result page — a new Search, an intermediate MORE! page, and the full three-card last page — the localized results heading becomes document.activeElement only after the response renders, with no result-count or result-status live-region insertion or update (P15-G3, P15-G5, REQ-083, REQ-085)", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
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
    const searchInput = page.getByPlaceholder(COPY.en.searchPlaceholder);

    await selectFoodObject(page, "margherita", 1, COPY.en);

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
    await expect(heading).toHaveText(COPY.en.foundSubstitutions);
    await expect(heading).toBeFocused();

    let snapshot = await liveRegionEntries(page);
    expectNoResultLiveAnnouncements(snapshot, "new Search (English)");

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

    for (let pageIndex = 2; pageIndex <= 10; pageIndex++) {
      const button = page.locator("[data-more-button]");
      await expect(button).toBeVisible();
      await button.click();
      await expect
        .poll(() => renderedCardIDs(page))
        .toEqual([...PIZZA_ALL_PAGES[pageIndex]!]);
      await expect(heading).toBeFocused();
    }

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
    expectNoResultLiveAnnouncements(next, "whole English flow (REQ-085)");
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

    for (let pageIndex = 2; pageIndex <= 11; pageIndex++) {
      const button = page.locator("[data-more-button]");
      await expect(button).toBeVisible();
      await button.click();
      await expect
        .poll(() => renderedCardIDs(page))
        .toEqual([...CHICKEN_ALL_PAGES[pageIndex]!]);
      await expect(heading).toBeFocused();
    }

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
    expectNoResultLiveAnnouncements(next, "whole Polish flow (REQ-085)");
  });
});
