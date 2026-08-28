import { expect, test, type Page } from "@playwright/test";
import type { SubstituteSearchRequest } from "../src/client/types.gen";

const ITERATIONS = 20;

const SEARCH_LIMIT_MS = 500;

const MORE_LIMIT_MS = 500;

const FIRST_CARD_LIMIT_MS = 1000;

const PIZZA_FOOD_OBJECT_ID = 1;

const PIZZA_QUERY = "margherita";

const PIZZA_QUANTITY = { value: 1, unit: "serving" } as const;

const PIZZA_PAGE_1_IDS = [30, 3, 35] as const;

interface PerfPost {
  startTime: number;

  responseEnd: number;
}

interface PerfFirstCard {
  submission: number;

  visibleAt: number | null;
}

declare global {
  interface Window {
    __perf?: {
      posts: PerfPost[];

      firstCards: PerfFirstCard[];

      reset(): void;
    };
  }
}

async function useBrowserLanguages(page: Page): Promise<void> {
  await page.addInitScript(
    (tags: string[]) => {
      Object.defineProperty(window.navigator, "languages", {
        configurable: true,
        get: () => tags,
      });
    },
    ["en-US"],
  );
}

async function installPerformanceHarness(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const posts: PerfPost[] = [];
    const firstCards: PerfFirstCard[] = [];

    const FIRST_CARD_DEADLINE_MS = 3000;

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!(entry instanceof PerformanceResourceTiming)) {
          continue;
        }
        if (
          entry.name.includes("/api/v1/substitutes/search") &&
          entry.initiatorType === "fetch"
        ) {
          posts.push({
            startTime: entry.startTime,
            responseEnd: entry.responseEnd,
          });
        }
      }
    });
    observer.observe({ type: "resource" });

    document.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }
        const option = target.closest('[id^="food-suggestion-option-"]');
        if (option === null) {
          return;
        }
        const submission = performance.now();
        const entry: PerfFirstCard = { submission, visibleAt: null };
        firstCards.push(entry);
        let sawAbsent = false;
        const deadline = submission + FIRST_CARD_DEADLINE_MS;
        const sample = () => {
          const now = performance.now();
          if (now > deadline) {
            return;
          }
          const card = document.querySelector('[data-result-card-rank="0"]');
          if (card !== null) {
            const bounds = card.getBoundingClientRect();
            const motionWrapper = card.closest("[data-result-card-motion]");
            const wrapperOpacity =
              motionWrapper === null
                ? 1
                : Number.parseFloat(getComputedStyle(motionWrapper).opacity);
            const opacity =
              Number.parseFloat(getComputedStyle(card).opacity) *
              wrapperOpacity;
            if (
              sawAbsent &&
              bounds.width > 0 &&
              bounds.height > 0 &&
              opacity > 0
            ) {
              entry.visibleAt = now;
              return;
            }
          } else {
            sawAbsent = true;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      },
      true,
    );

    window.__perf = {
      posts,
      firstCards,
      reset() {
        posts.length = 0;
        firstCards.length = 0;
      },
    };
  });
}

interface TrackedPost {
  body: SubstituteSearchRequest;
  status: number | null;
}

interface PostLedger {
  posts: TrackedPost[];

  maxActive: number;
  reset(): void;
}

function trackSubstitutePosts(page: Page): PostLedger {
  const posts: TrackedPost[] = [];
  let active = 0;
  let maxActive = 0;
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
      active += 1;
      maxActive = Math.max(maxActive, active);
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
      active -= 1;
    }
  });
  return {
    posts,
    get maxActive(): number {
      return maxActive;
    },
    reset() {
      posts.length = 0;
      active = 0;
      maxActive = 0;
    },
  };
}

async function renderedCardIDs(page: Page): Promise<number[]> {
  const cards = page.locator("[data-result-card]");
  return cards.evaluateAll((elements) =>
    elements.map((element) =>
      Number(element.getAttribute("data-food-object-id")),
    ),
  );
}

interface SearchAndFirstCardSamples {
  searchMs: number;

  firstCardMs: number;
}

async function readSearchAndFirstCardSamples(
  page: Page,
  iteration: number,
): Promise<SearchAndFirstCardSamples> {
  return page.evaluate((index) => {
    const harness = window.__perf;
    if (harness === undefined) {
      throw new Error("performance harness missing");
    }
    const searchPost = harness.posts[2 * index];
    const firstCard = harness.firstCards[index];
    if (searchPost === undefined || firstCard === undefined) {
      throw new Error(`missing performance samples for iteration ${index}`);
    }
    if (firstCard.visibleAt === null) {
      throw new Error(
        `the first Result Card never became visible in iteration ${index}`,
      );
    }
    return {
      searchMs: searchPost.responseEnd - searchPost.startTime,
      firstCardMs: firstCard.visibleAt - firstCard.submission,
    };
  }, iteration);
}

async function readMoreSample(page: Page, iteration: number): Promise<number> {
  return page.evaluate((index) => {
    const post = window.__perf?.posts[2 * index + 1];
    if (post === undefined) {
      throw new Error(`missing MORE! sample for iteration ${index}`);
    }
    return post.responseEnd - post.startTime;
  }, iteration);
}

test.describe("Search performance", () => {
  test("20 consecutive Pizza Margherita searches and 20 consecutive MORE! requests each end within 500 ms, each of the same 20 searches shows its first Result Card within 1 s, and exactly 20 measured POSTs of each type complete one at a time (P18-G2, P18-G3, P18-G4, P18-G5, P18-G6, REQ-074, REQ-075)", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await useBrowserLanguages(page);
    await installPerformanceHarness(page);
    const ledger = trackSubstitutePosts(page);

    await page.goto("/");
    const search = page.getByRole("combobox", { name: "Search" });
    const option = page.locator(
      `#food-suggestion-option-${PIZZA_FOOD_OBJECT_ID}`,
    );
    const moreButton = page.locator("[data-more-button]");

    await search.fill(PIZZA_QUERY);
    await expect(option).toBeVisible();
    await option.click();
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    await expect(page.locator("[data-result-card]")).toHaveCount(3);
    await expect(moreButton).toBeVisible();
    await moreButton.click();
    await expect
      .poll(() => renderedCardIDs(page), { timeout: 30_000 })
      .toEqual([...PIZZA_PAGE_1_IDS]);

    await page.evaluate(() => {
      window.__perf?.reset();
    });
    ledger.reset();

    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      await search.fill(PIZZA_QUERY);
      await expect(option).toBeVisible();
      await option.click();

      await expect
        .poll(() => page.evaluate(() => window.__perf?.posts.length ?? 0), {
          timeout: 30_000,
        })
        .toBeGreaterThanOrEqual(2 * iteration + 1);
      await expect
        .poll(
          () =>
            page.evaluate(
              (index) => window.__perf?.firstCards[index]?.visibleAt ?? null,
              iteration,
            ),
          { timeout: 15_000 },
        )
        .not.toBeNull();

      await expect(page.locator("main")).toHaveAttribute(
        "data-interaction-state",
        "results",
      );

      const samples = await readSearchAndFirstCardSamples(page, iteration);
      console.log(
        `[performance] Search sample ${iteration}: ${samples.searchMs.toFixed(1)} ms (limit ${SEARCH_LIMIT_MS} ms)`,
      );
      console.log(
        `[performance] First card sample ${iteration}: ${samples.firstCardMs.toFixed(1)} ms (limit ${FIRST_CARD_LIMIT_MS} ms)`,
      );
      expect(
        samples.searchMs,
        `Search sample ${iteration} must not exceed ${SEARCH_LIMIT_MS} ms`,
      ).toBeLessThanOrEqual(SEARCH_LIMIT_MS);
      expect(
        samples.firstCardMs,
        `First card sample ${iteration} must not exceed ${FIRST_CARD_LIMIT_MS} ms`,
      ).toBeLessThanOrEqual(FIRST_CARD_LIMIT_MS);

      await expect(moreButton).toBeVisible();
      await moreButton.click();
      await expect
        .poll(() => page.evaluate(() => window.__perf?.posts.length ?? 0), {
          timeout: 30_000,
        })
        .toBeGreaterThanOrEqual(2 * iteration + 2);
      await expect
        .poll(() => renderedCardIDs(page), { timeout: 30_000 })
        .toEqual([...PIZZA_PAGE_1_IDS]);

      const moreMs = await readMoreSample(page, iteration);
      console.log(
        `[performance] MORE! sample ${iteration}: ${moreMs.toFixed(1)} ms (limit ${MORE_LIMIT_MS} ms)`,
      );
      expect(
        moreMs,
        `MORE! sample ${iteration} must not exceed ${MORE_LIMIT_MS} ms`,
      ).toBeLessThanOrEqual(MORE_LIMIT_MS);
    }

    const totals = await page.evaluate(() => {
      const harness = window.__perf;
      return {
        posts: harness?.posts.length ?? 0,
        firstCards: harness?.firstCards.length ?? 0,
      };
    });
    expect(totals.posts).toBe(ITERATIONS * 2);
    expect(totals.firstCards).toBe(ITERATIONS);
    expect(ledger.posts).toHaveLength(ITERATIONS * 2);
    expect(
      ledger.posts.filter((post) => post.body.pageIndex === 0),
    ).toHaveLength(ITERATIONS);
    expect(
      ledger.posts.filter((post) => post.body.pageIndex === 1),
    ).toHaveLength(ITERATIONS);
    expect(ledger.maxActive).toBeLessThanOrEqual(1);
    for (const post of ledger.posts) {
      expect(post.body.foodObjectId).toBe(PIZZA_FOOD_OBJECT_ID);
      expect(post.status).toBe(200);
    }
  });
});
