import { expect, test, type Page } from "@playwright/test";
import type { SubstituteSearchRequest } from "../src/client/types.gen";

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

const DISABLED_MORE_BACKGROUND_COLOR = "oklch(0.446 0.03 256.802)";

const DISABLED_MORE_TEXT_COLOR = "oklch(0.872 0.01 258.338)";

const MAXIMUM_SPINNER_STOP_DELAY_MS = 100;

interface SpinnerEvent {
  count: number;
  timestamp: number;
}

interface SpinnerTracker {
  events: SpinnerEvent[];
  getRemovalTimeAfter(minTime: number): number | null;
}

declare global {
  interface Window {
    __spinnerTracker: SpinnerTracker;
  }
}

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

interface TrackedPost {
  body: SubstituteSearchRequest;
  status: number | null;
}

function trackSubstitutePosts(page: Page): TrackedPost[] {
  const posts: TrackedPost[] = [];

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

      await pizzaOption.click();

      await expect.poll(() => posts.length).toBe(1);
      expect(posts[0]?.body).toEqual({
        foodObjectId: 1,
        pageIndex: 0,
      });

      const selectedCard = page.locator("[data-selected-food-summary]");
      const selectedSpinner = selectedCard.locator("[data-card-spinner]");
      const numberInput = page.locator("[data-quantity-number]");
      const unitSelect = page.locator("[data-quantity-unit]");
      const editorStatus = page.locator("#quantity-editor-status");

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

      await expect(selectedCard.locator("[data-card-content]")).toHaveCSS(
        "opacity",
        "0",
      );
      await expect(numberInput).toBeDisabled();
      await expect(unitSelect).toBeDisabled();
      await expect(editorStatus).toHaveText(copy.loadingNutritionValues);
      expect(posts).toHaveLength(1);

      releaseGate1();
      await expect.poll(() => posts[0]?.status).toBe(200);

      await expect(page.locator("[data-interaction-state]")).toHaveAttribute(
        "data-interaction-state",
        "results",
      );

      await expect(page.locator("[data-card-spinner]")).toHaveCount(0);
      expect(posts).toHaveLength(1);

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

        expect(delay).toBeGreaterThanOrEqual(-5);
        expect(delay).toBeLessThanOrEqual(MAXIMUM_SPINNER_STOP_DELAY_MS);
      }

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

      await numberInput.fill("2");
      await numberInput.press("Enter");

      await expect.poll(() => posts.length).toBe(2);
      expect(posts[1]?.body).toEqual({
        foodObjectId: 1,
        pageIndex: 0,
      });

      await expect(selectedCard.locator("[data-card-spinner]")).toHaveCount(1);
      await expect(resultCards.locator("[data-card-spinner]")).toHaveCount(3);
      await expect(page.locator("[data-card-spinner]")).toHaveCount(4);
      await expect(page.locator("[data-value-spinner]")).toHaveCount(0);

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

      await expect(numberInput).toBeDisabled();
      await expect(unitSelect).toBeDisabled();
      await expect(editorStatus).toHaveText(copy.updatingQuantities);
      expect(posts).toHaveLength(2);

      releaseGate2();
      await expect.poll(() => posts[1]?.status).toBe(200);

      await expect(page.locator("[data-card-spinner]")).toHaveCount(0);
      expect(posts).toHaveLength(2);

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

        expect(delay).toBeGreaterThanOrEqual(-5);
        expect(delay).toBeLessThanOrEqual(MAXIMUM_SPINNER_STOP_DELAY_MS);
      }

      const moreButton = page.locator("[data-more-button]");
      await expect(moreButton).toBeVisible();
      await expect(moreButton).toHaveText(copy.moreButton);

      await moreButton.click();

      await expect.poll(() => posts.length).toBe(3);
      expect(posts[2]?.body).toEqual({
        foodObjectId: 1,
        pageIndex: 1,
      });

      await expect(page.locator("[data-card-spinner]")).toHaveCount(0);
      await expect(page.locator("[data-more-spinner]")).toHaveCount(0);

      await expect(moreButton).toHaveText(copy.moreButton);
      await expect(moreButton).toHaveAttribute("aria-disabled", "true");
      await expect(moreButton).toHaveCSS(
        "background-color",
        DISABLED_MORE_BACKGROUND_COLOR,
      );
      await expect(moreButton).toHaveCSS("color", DISABLED_MORE_TEXT_COLOR);

      await expect(numberInput).toBeDisabled();
      await expect(unitSelect).toBeDisabled();
      expect(posts).toHaveLength(3);

      releaseGate3();
      await expect.poll(() => posts[2]?.status).toBe(200);

      await expect(page.locator("[data-card-spinner]")).toHaveCount(0);
      expect(posts).toHaveLength(3);
    });
  }
});
