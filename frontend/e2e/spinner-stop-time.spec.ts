import { expect, test, type Page } from "@playwright/test";
import type { SubstituteSearchRequest } from "../src/client/types.gen";

/**
 * Real-stack Spinner stop-time and single card loading spinner scenario
 * (task 40; ARCH-001, ARCH-002, ARCH-008, ARCH-011, ARCH-019, ARCH-020,
 * ARCH-022, REQ-049, REQ-081, REQ-082, ISSUE-010, ISSUE-012; P12-G3).
 *
 * This scenario runs against the self-cleaning real stack behind `bun run
 * test:e2e`: disposable loopback PostgreSQL 17, fixed Fiber at
 * `127.0.0.1:8080`, and the strict-port optimized Vite preview at
 * `http://127.0.0.1:4173` (ISSUE-006, ISSUE-012).
 *
 * It verifies that:
 * - Every selected-food and result-card spinner is bound directly to the real
 *   Substitution Search pending interval (ARCH-019, REQ-049).
 * - There is no `MINIMUM_SEARCH_LOADING_DURATION_MS`, trailing timer, or
 *   artificial loading floor.
 * - During a pending new Search, exactly one centered 16px aria-hidden spinner
 *   appears in the selected-food summary while non-image card content is hidden,
 *   quantity controls are disabled, and polite loading status is exposed (REQ-081).
 * - During a pending Food Quantity recalculation, one centered spinner appears
 *   in the selected-food summary and one in each of the three result cards (4 total),
 *   while card dimensions stay settled, result images stay visible, and
 *   related controls are disabled (REQ-081, ISSUE-010).
 * - A browser-side observer measuring each visible `[data-card-spinner]` against
 *   the matching same-origin POST `PerformanceResourceTiming.responseEnd` proves
 *   that all spinners remain present while pending and are absent no later than
 *   100 ms after response end (REQ-049, P12-G3).
 * - During a pending MORE! request, no spinner is rendered in any card or the
 *   MORE! control, while the MORE! control retains its localized label and
 *   gray non-operable presentation (REQ-082).
 * - Each measured pending period retains exactly one active POST, no queued
 *   POST, and releasing each gate produces no queued POST.
 */

const COPY = {
  en: {
    searchPlaceholder: "Search foods",
    moreButton: "MORE!",
    loadingNutritionValues: "Loading nutrition values",
    updatingQuantities: "Updating quantities",
  },
  pl: {
    searchPlaceholder: "Szukaj potraw",
    moreButton: "WIĘCEJ!",
    loadingNutritionValues: "Ładowanie wartości odżywczych",
    updatingQuantities: "Aktualizowanie ilości",
  },
} as const;

/** Gray background of a pending non-operable MORE! control (REQ-082). */
const DISABLED_MORE_BACKGROUND_COLOR = "oklch(0.446 0.03 256.802)";
/** Gray text of a pending non-operable MORE! control (REQ-082). */
const DISABLED_MORE_TEXT_COLOR = "oklch(0.872 0.01 258.338)";

/** Maximum allowed delay (ms) from HTTP responseEnd to spinner removal (REQ-049). */
const MAXIMUM_SPINNER_STOP_DELAY_MS = 100;

/** One browser-observed spinner-count transition. */
interface SpinnerEvent {
  count: number;
  timestamp: number;
}

/** Browser-side spinner observer exposed to the timing assertions. */
interface SpinnerTracker {
  events: SpinnerEvent[];
  getRemovalTimeAfter(minTime: number): number | null;
}

declare global {
  interface Window {
    /** Browser-side spinner observer installed before application startup. */
    __spinnerTracker: SpinnerTracker;
  }
}

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

/**
 * Installs a browser-side MutationObserver that records the exact timestamps
 * of `[data-card-spinner]` presence and removal.
 */
async function installSpinnerObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const events: SpinnerEvent[] = [];

    const record = () => {
      const count = document.querySelectorAll("[data-card-spinner]").length;
      const last = events[events.length - 1];
      if (last === undefined || last.count !== count) {
        events.push({ count, timestamp: performance.now() });
      }
    };

    const observer = new MutationObserver(record);
    const attach = () => {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
      });
      record();
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", attach);
    } else {
      attach();
    }

    window.__spinnerTracker = {
      events,
      getRemovalTimeAfter(minTime: number) {
        for (let i = 0; i < events.length; i += 1) {
          const event = events[i];
          if (event && event.timestamp >= minTime && event.count === 0) {
            return event.timestamp;
          }
        }
        return null;
      },
    };
  });
}

/** One observed generated-client Substitution Search POST. */
interface TrackedPost {
  body: SubstituteSearchRequest;
  status: number | null;
}

/** Tracks generated-client POST requests. */
function trackSubstitutePosts(page: Page): TrackedPost[] {
  const posts: TrackedPost[] = [];

  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/v1/substitutes/search")
    ) {
      // SAFETY: This branch only handles the generated client's substitute-search route, whose body is SubstituteSearchRequest.
      posts.push({
        body: request.postDataJSON() as SubstituteSearchRequest,
        status: null,
      });
    }
  });

  page.on("response", (response) => {
    if (
      response.request().method() === "POST" &&
      response.url().includes("/api/v1/substitutes/search")
    ) {
      const post = posts.find((entry) => entry.status === null);
      if (post !== undefined) {
        post.status = response.status();
      }
    }
  });

  return posts;
}

test.describe("Spinner stop time and card loading spinners (REQ-049, REQ-081, REQ-082, P12-G3)", () => {
  for (const [lang, copy] of [
    ["en-US", COPY.en],
    ["pl-PL", COPY.pl],
  ] as const) {
    test(`[${lang}] spinners remain present while pending, stop within 100ms after responseEnd, keep card dimensions, and render no spinner during MORE! (REQ-049, REQ-081, REQ-082, P12-G3)`, async ({
      page,
    }) => {
      await useBrowserLanguages(page, [lang]);
      await installSpinnerObserver(page);
      const posts = trackSubstitutePosts(page);

      // Browser-boundary gates for controlling the real Fiber responses (P12-G1, P12-G3)
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
      const searchInput = page.getByPlaceholder(copy.searchPlaceholder);
      await searchInput.fill("margherita");

      const pizzaOption = page.locator("#food-suggestion-option-1");
      await expect(pizzaOption).toBeVisible();

      // =========================================================================
      // 1. Initial New Search Request (P12-G3, REQ-049, REQ-081)
      // =========================================================================
      await pizzaOption.click();

      // Exactly 1 POST initiated
      await expect.poll(() => posts.length).toBe(1);
      expect(posts[0]?.body).toEqual({
        foodObjectId: 1,
        quantity: { value: 1, unit: "serving" },
        pageIndex: 0,
      });

      const selectedCard = page.locator("[data-selected-food-summary]");
      const selectedSpinner = selectedCard.locator("[data-card-spinner]");
      const numberInput = page.locator("[data-quantity-number]");
      const unitSelect = page.locator("[data-quantity-unit]");
      const editorStatus = page.locator("#quantity-editor-status");

      // While pending: exactly 1 centered 16px aria-hidden spinner in selected food
      await expect(selectedSpinner).toHaveCount(1);
      await expect(page.locator("[data-card-spinner]")).toHaveCount(1);
      await expect(page.locator("[data-new-search-spinner]")).toHaveCount(0);
      await expect(page.locator("[data-value-spinner]")).toHaveCount(0);

      const initialSpinnerInfo = await selectedSpinner.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          width: Number.parseFloat(style.width),
          height: Number.parseFloat(style.height),
          ariaHidden: element.getAttribute("aria-hidden"),
        };
      });
      expect(initialSpinnerInfo).toEqual({
        width: 16,
        height: 16,
        ariaHidden: "true",
      });

      // Non-image content hidden behind spinner, controls disabled, polite busy status
      await expect(selectedCard.locator("[data-card-content]")).toHaveCSS(
        "opacity",
        "0",
      );
      await expect(numberInput).toBeDisabled();
      await expect(unitSelect).toBeDisabled();
      await expect(editorStatus).toHaveText(copy.loadingNutritionValues);
      expect(posts).toHaveLength(1);

      // Release Gate 1: real response completes
      releaseGate1();
      await expect.poll(() => posts[0]?.status).toBe(200);

      // Results state rendered
      await expect(page.locator("[data-interaction-state]")).toHaveAttribute(
        "data-interaction-state",
        "results",
      );

      // Assert no spinner remains
      await expect(page.locator("[data-card-spinner]")).toHaveCount(0);
      expect(posts).toHaveLength(1);

      // Measure browser timing between PerformanceResourceTiming.responseEnd and spinner removal
      const searchTiming1 = await page.evaluate(() => {
        const tracker = window.__spinnerTracker;
        const entries = performance
          .getEntriesByType("resource")
          .filter(
            (entry): entry is PerformanceResourceTiming =>
              entry instanceof PerformanceResourceTiming &&
              entry.name.includes("/api/v1/substitutes/search") &&
              entry.initiatorType === "fetch",
          );
        const postEntry = entries[0];
        if (!postEntry) {
          return {
            error: "No PerformanceResourceTiming entry found for post 1",
          };
        }
        const removalTime = tracker.getRemovalTimeAfter(postEntry.startTime);
        return {
          responseEnd: postEntry.responseEnd,
          removalTime,
          events: tracker.events,
        };
      });

      expect("error" in searchTiming1).toBe(false);
      if (!("error" in searchTiming1)) {
        expect(searchTiming1.removalTime).not.toBeNull();
        const delay = searchTiming1.removalTime! - searchTiming1.responseEnd;
        // The spinner is removed no later than 100 ms after responseEnd (REQ-049)
        expect(delay).toBeGreaterThanOrEqual(-5);
        expect(delay).toBeLessThanOrEqual(MAXIMUM_SPINNER_STOP_DELAY_MS);
      }

      // Record settled card dimensions for recalculation check (REQ-081)
      const resultCards = page.locator("[data-result-card]");
      await expect(resultCards).toHaveCount(3);
      const settledSelectedSize = await selectedCard.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      });
      const settledCardSizes = await resultCards.evaluateAll((elements) =>
        elements.map((element) => {
          const bounds = element.getBoundingClientRect();
          return { width: bounds.width, height: bounds.height };
        }),
      );

      // =========================================================================
      // 2. Food Quantity Recalculation Request (P12-G3, REQ-049, REQ-081)
      // =========================================================================
      await numberInput.fill("2");
      await numberInput.press("Enter");

      // Exactly 1 new POST for recalculation
      await expect.poll(() => posts.length).toBe(2);
      expect(posts[1]?.body).toEqual({
        foodObjectId: 1,
        quantity: { value: 2, unit: "serving" },
        pageIndex: 0,
      });

      // While pending recalculation:
      // - exactly 1 spinner on selected-food card + 1 on each of the 3 result cards = 4 total
      await expect(selectedCard.locator("[data-card-spinner]")).toHaveCount(1);
      await expect(resultCards.locator("[data-card-spinner]")).toHaveCount(3);
      await expect(page.locator("[data-card-spinner]")).toHaveCount(4);
      await expect(page.locator("[data-value-spinner]")).toHaveCount(0);

      // - Settled card dimensions do not change (REQ-081)
      const pendingSelectedSize = await selectedCard.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      });
      const pendingCardSizes = await resultCards.evaluateAll((elements) =>
        elements.map((element) => {
          const bounds = element.getBoundingClientRect();
          return { width: bounds.width, height: bounds.height };
        }),
      );
      expect(pendingSelectedSize).toEqual(settledSelectedSize);
      expect(pendingCardSizes).toEqual(settledCardSizes);

      // - Result images stay visible while non-image content is hidden
      await expect(selectedCard.locator("[data-card-content]")).toHaveCSS(
        "opacity",
        "0",
      );
      const cardContents = page.locator(
        "[data-result-card] [data-card-content]",
      );
      for (let i = 0; i < 3; i += 1) {
        await expect(cardContents.nth(i)).toHaveCSS("opacity", "0");
        await expect(
          resultCards.nth(i).locator("[data-result-card-image]"),
        ).toBeVisible();
      }

      // - Related controls are disabled during recalculation lock
      await expect(numberInput).toBeDisabled();
      await expect(unitSelect).toBeDisabled();
      await expect(editorStatus).toHaveText(copy.updatingQuantities);
      expect(posts).toHaveLength(2);

      // Release Gate 2: real recalculation response completes
      releaseGate2();
      await expect.poll(() => posts[1]?.status).toBe(200);

      // Assert no spinner remains
      await expect(page.locator("[data-card-spinner]")).toHaveCount(0);
      expect(posts).toHaveLength(2);

      // Measure browser timing between PerformanceResourceTiming.responseEnd and recalculation spinner removal
      const searchTiming2 = await page.evaluate(() => {
        const tracker = window.__spinnerTracker;
        const entries = performance
          .getEntriesByType("resource")
          .filter(
            (entry): entry is PerformanceResourceTiming =>
              entry instanceof PerformanceResourceTiming &&
              entry.name.includes("/api/v1/substitutes/search") &&
              entry.initiatorType === "fetch",
          );
        const postEntry = entries[1];
        if (!postEntry) {
          return {
            error: "No PerformanceResourceTiming entry found for post 2",
          };
        }
        const removalTime = tracker.getRemovalTimeAfter(postEntry.startTime);
        return {
          responseEnd: postEntry.responseEnd,
          removalTime,
          events: tracker.events,
        };
      });

      expect("error" in searchTiming2).toBe(false);
      if (!("error" in searchTiming2)) {
        expect(searchTiming2.removalTime).not.toBeNull();
        const delay = searchTiming2.removalTime! - searchTiming2.responseEnd;
        // Spinners removed no later than 100 ms after responseEnd (REQ-049)
        expect(delay).toBeGreaterThanOrEqual(-5);
        expect(delay).toBeLessThanOrEqual(MAXIMUM_SPINNER_STOP_DELAY_MS);
      }

      // =========================================================================
      // 3. MORE! Paging Request (P12-G3, REQ-082)
      // =========================================================================
      const moreButton = page.locator("[data-more-button]");
      await expect(moreButton).toBeVisible();
      await expect(moreButton).toHaveText(copy.moreButton);

      await moreButton.click();

      // Exactly 1 new POST for page 1
      await expect.poll(() => posts.length).toBe(3);
      expect(posts[2]?.body).toEqual({
        foodObjectId: 1,
        quantity: { value: 2, unit: "serving" },
        pageIndex: 1,
      });

      // While MORE! is pending:
      // - Renders NO spinner (0 card spinners, 0 more spinners)
      await expect(page.locator("[data-card-spinner]")).toHaveCount(0);
      await expect(page.locator("[data-more-spinner]")).toHaveCount(0);

      // - Retains localized label and gray non-operable presentation (REQ-082)
      await expect(moreButton).toHaveText(copy.moreButton);
      await expect(moreButton).toHaveAttribute("aria-disabled", "true");
      await expect(moreButton).toHaveCSS(
        "background-color",
        DISABLED_MORE_BACKGROUND_COLOR,
      );
      await expect(moreButton).toHaveCSS("color", DISABLED_MORE_TEXT_COLOR);

      // - Related controls disabled
      await expect(numberInput).toBeDisabled();
      await expect(unitSelect).toBeDisabled();
      expect(posts).toHaveLength(3);

      // Release Gate 3: real MORE! response completes
      releaseGate3();
      await expect.poll(() => posts[2]?.status).toBe(200);

      // Settles on page 1 without spinner
      await expect(page.locator("[data-card-spinner]")).toHaveCount(0);
      expect(posts).toHaveLength(3);
    });
  }
});
