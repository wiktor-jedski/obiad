import { expect, test, type Page } from "@playwright/test";
import { isLandingDialogueRequest } from "./request-purpose";

const COPY = {
  en: {
    searchPlaceholder: "Search foods",
    selectedFood: "Selected food",
  },
  pl: {
    searchPlaceholder: "Szukaj potraw",
    selectedFood: "Wybrany produkt",
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
  test("English searches focus the selected heading; infinite pages preserve editor focus through the full final page without live result announcements", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    test.setTimeout(60_000);
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
      if (isLandingDialogueRequest(route.request())) {
        await route.continue();
        return;
      }
      postCount += 1;
      if (postCount === 1) {
        await newSearchGate;
      } else if (postCount === 2) {
        await moreGate;
      }
      await route.continue();
    });

    await page.goto("/");
    const heading = page.locator("[data-selected-food-heading]");
    const searchInput = page.getByPlaceholder(COPY.en.searchPlaceholder);

    await selectFoodObject(page, "margherita", 1, COPY.en);

    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "loadingNew",
    );
    await expect(searchInput).toBeFocused();
    await expect(heading).toHaveText(COPY.en.selectedFood);
    await expect(heading).not.toBeFocused();

    releaseNewSearchGate();
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    await expect(page.locator("[data-result-card]")).toHaveCount(3);
    await expect(heading).toHaveText(COPY.en.selectedFood);
    await expect(heading).toBeFocused();

    let snapshot = await liveRegionEntries(page);
    expectNoResultLiveAnnouncements(snapshot, "new Search (English)");

    const editor = page.locator("[data-nutrition-editor=quantity]");
    await expect(page.locator('[data-card-reveal-state="shown"]')).toHaveCount(
      4,
    );
    await editor.focus();
    await page.locator("[data-pagination-sentinel]").scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => scrollY);

    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "loadingMore",
    );
    await expect(editor).toBeFocused();
    await expect(heading).not.toBeFocused();

    releaseMoreGate();
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    await expect
      .poll(() => renderedCardIDs(page))
      .toEqual(PIZZA_ALL_PAGES.slice(0, 2).flat());
    await expect(editor).toBeFocused();

    expect(
      Math.abs((await page.evaluate(() => scrollY)) - scrollBefore),
    ).toBeLessThan(2);
    let next = await liveRegionEntries(page);
    expectNoResultLiveAnnouncements(
      next.slice(snapshot.length),
      "intermediate pagination page (English)",
    );
    snapshot = next;

    for (let pageIndex = 2; pageIndex <= 10; pageIndex++) {
      await page.locator("[data-pagination-sentinel]").scrollIntoViewIfNeeded();
      await expect
        .poll(() => renderedCardIDs(page))
        .toEqual(PIZZA_ALL_PAGES.slice(0, pageIndex + 1).flat());
      await expect(editor).toBeFocused();
    }

    await page.locator("[data-pagination-sentinel]").scrollIntoViewIfNeeded();
    await expect
      .poll(() => renderedCardIDs(page))
      .toEqual(PIZZA_ALL_PAGES.slice(0, 12).flat());
    await expect(page.locator("[data-pagination-spinner]")).toHaveCount(0);
    await expect(heading).toHaveText(COPY.en.selectedFood);
    await expect(editor).toBeFocused();

    next = await liveRegionEntries(page);
    expectNoResultLiveAnnouncements(
      next.slice(snapshot.length),
      "full last page (English)",
    );
    expectNoResultLiveAnnouncements(next, "whole English flow (REQ-085)");
  });

  test("Polish searches focus the selected heading; infinite pages preserve editor focus through the partial final page without live result announcements", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["pl-PL"]);
    test.setTimeout(60_000);
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
      if (isLandingDialogueRequest(route.request())) {
        await route.continue();
        return;
      }
      postCount += 1;
      if (postCount === 1) {
        await newSearchGate;
      } else if (postCount === 2) {
        await moreGate;
      }
      await route.continue();
    });

    await page.goto("/");
    const heading = page.locator("[data-selected-food-heading]");
    const searchInput = page.getByPlaceholder(COPY.pl.searchPlaceholder);

    await selectFoodObject(page, "kurczaka", 5, COPY.pl);

    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "loadingNew",
    );
    await expect(searchInput).toBeFocused();
    await expect(heading).toHaveText(COPY.pl.selectedFood);
    await expect(heading).not.toBeFocused();

    releaseNewSearchGate();
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    await expect(page.locator("[data-result-card]")).toHaveCount(3);
    await expect(heading).toHaveText(COPY.pl.selectedFood);
    await expect(heading).toBeFocused();

    let snapshot = await liveRegionEntries(page);
    expectNoResultLiveAnnouncements(snapshot, "new Search (Polish)");

    const editor = page.locator("[data-nutrition-editor=quantity]");
    await expect(page.locator('[data-card-reveal-state="shown"]')).toHaveCount(
      4,
    );
    await editor.focus();
    await page.locator("[data-pagination-sentinel]").scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => scrollY);

    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "loadingMore",
    );
    await expect(editor).toBeFocused();
    await expect(heading).not.toBeFocused();

    releaseMoreGate();
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    await expect
      .poll(() => renderedCardIDs(page))
      .toEqual(CHICKEN_ALL_PAGES.slice(0, 2).flat());
    await expect(editor).toBeFocused();

    expect(
      Math.abs((await page.evaluate(() => scrollY)) - scrollBefore),
    ).toBeLessThan(2);
    let next = await liveRegionEntries(page);
    expectNoResultLiveAnnouncements(
      next.slice(snapshot.length),
      "intermediate pagination page (Polish)",
    );
    snapshot = next;

    for (let pageIndex = 2; pageIndex <= 11; pageIndex++) {
      await page.locator("[data-pagination-sentinel]").scrollIntoViewIfNeeded();
      await expect
        .poll(() => renderedCardIDs(page))
        .toEqual(CHICKEN_ALL_PAGES.slice(0, pageIndex + 1).flat());
      await expect(editor).toBeFocused();
    }

    await page.locator("[data-pagination-sentinel]").scrollIntoViewIfNeeded();
    await expect
      .poll(() => renderedCardIDs(page))
      .toEqual(CHICKEN_ALL_PAGES.slice(0, 13).flat());
    await expect(page.locator("[data-pagination-spinner]")).toHaveCount(0);
    await expect(page.locator("[data-result-card]")).toHaveCount(37);
    await expect(heading).toHaveText(COPY.pl.selectedFood);
    await expect(editor).toBeFocused();

    next = await liveRegionEntries(page);
    expectNoResultLiveAnnouncements(
      next.slice(snapshot.length),
      "partial last page (Polish)",
    );
    expectNoResultLiveAnnouncements(next, "whole Polish flow (REQ-085)");
  });
});

for (const language of ["en-US", "pl-PL"]) {
  test(`${language}: failed pagination and failed new searches do not move focus`, async ({
    page,
  }) => {
    await useBrowserLanguages(page, [language]);
    const copy = language === "en-US" ? COPY.en : COPY.pl;
    await page.goto("/");
    await selectFoodObject(page, "margherita", 1, copy);
    await expect(page.locator('[data-card-reveal-state="shown"]')).toHaveCount(
      4,
    );
    await page.route("**/api/v1/substitutes/search", async (route) => {
      if (isLandingDialogueRequest(route.request())) await route.continue();
      else await route.abort();
    });
    const editor = page.locator("[data-nutrition-editor=quantity]");
    await editor.focus();
    await page.locator("[data-pagination-sentinel]").scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => scrollY);
    await expect(page.locator("[data-retry-message]")).toBeVisible();
    await expect(editor).toBeFocused();
    expect(
      Math.abs((await page.evaluate(() => scrollY)) - scrollBefore),
    ).toBeLessThan(2);
    await expect(page.locator("[data-result-card]")).toHaveCount(3);
    await selectFoodObject(
      page,
      language === "en-US" ? "chicken" : "kurczak",
      5,
      copy,
    );
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "newSearchFailure",
    );
    await expect(page.getByPlaceholder(copy.searchPlaceholder)).toBeFocused();
  });
}
