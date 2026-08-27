import { expect, test, type Page } from "@playwright/test";
import type { SubstituteSearchRequest } from "../src/client/types.gen";

/**
 * Real-stack Search performance scenario (task 54, Phase 18; ARCH-022,
 * REQ-074, REQ-075, ISSUE-018).
 *
 * The launcher runs this scenario in performance-only mode
 * (`bun run test:performance`, `./e2e/launcher.ts performance`): it starts
 * the identical optimized real stack — the optimized Vite build through
 * Vite preview, the real Fiber server, a disposable loopback-only
 * PostgreSQL 17 container, and the pinned Playwright Chromium — and then
 * runs only this scenario, alone with one Playwright worker. No standard
 * end-to-end suite load shares the run, so the timing samples measure only
 * the real stack (P18-G1, P18-G6, ARCH-022).
 *
 * ISSUE-018 measurement boundary:
 *
 * - Fixture: Pizza Margherita (Food Object 1) with its default `1 serving`
 *   quantity, the stable seeded acceptance fixture.
 * - 20 measured iterations. Each iteration starts one new Search, measures
 *   its first Result Card, and then activates MORE!, so the same 20 Search
 *   iterations supply the 20 first-card samples.
 * - Before sampling, one complete, unmeasured new Search and MORE! flow
 *   warms the browser, optimized Vite preview, Fiber process, PostgreSQL
 *   connection, and query paths.
 * - Each Search and MORE! request is measured from
 *   `PerformanceResourceTiming.startTime` through `responseEnd`.
 * - First-card time is measured from the browser event that submits the
 *   selected suggestion through the first animation frame in which the
 *   first ranked Result Card has a nonempty layout box and computed
 *   opacity greater than zero.
 * - Each measured response and rendered state is awaited before the next
 *   action, so only one Substitution Search request is active.
 *
 * Phase gate (plan.md Phase 18, P18-G2..P18-G6):
 *
 * - 20 consecutive Search samples are at most 500 ms (P18-G2, REQ-074).
 * - 20 consecutive MORE! samples are at most 500 ms (P18-G3, REQ-074).
 * - The same 20 new Search iterations each make their first Result Card
 *   visible at most 1 second after submission (P18-G4, REQ-075).
 * - The scenario reports each sample index, type, measured milliseconds,
 *   and fixed limit (P18-G5) and checks each sample immediately, exiting
 *   after the first limit breach instead of running or hiding later
 *   samples (P18-G6).
 * - Exactly 20 measured POSTs of each type complete; no automatic retry,
 *   cached response, relaxed limit, or standard end-to-end suite load
 *   contributes to the measurements. The owning TanStack Query uses
 *   `retry: false` and `gcTime: 0`, so every new search and MORE!
 *   activation starts one fresh generated-client POST; the scenario only
 *   measures and never changes a threshold.
 */

/** The 20 measured iterations per ISSUE-018. */
const ITERATIONS = 20;
/** Every Search request must end within 500 ms (REQ-074, P18-G2). */
const SEARCH_LIMIT_MS = 500;
/** Every MORE! request must end within 500 ms (REQ-074, P18-G3). */
const MORE_LIMIT_MS = 500;
/** The first Result Card must become visible within 1 s (REQ-075, P18-G4). */
const FIRST_CARD_LIMIT_MS = 1000;

/** The stable seeded fixture: Pizza Margherita (ISSUE-018, ISSUE-002). */
const PIZZA_FOOD_OBJECT_ID = 1;
/** The Search Query whose suggestions surface the Pizza Margherita option. */
const PIZZA_QUERY = "margherita";
/** The default Food Quantity the fixture submits: 1 serving (ISSUE-018). */
const PIZZA_QUANTITY = { value: 1, unit: "serving" } as const;
/**
 * The seeded page-1 replacement cards of the Pizza Margherita search
 * (ISSUE-002, REQ-072): Pho (30), Lasagna (3), Pastel de nata (35) in
 * rank order — the cards every measured MORE! activation renders.
 */
const PIZZA_PAGE_1_IDS = [30, 3, 35] as const;

/** One recorded Substitution Search `PerformanceResourceTiming` entry. */
interface PerfPost {
  /** The fetch start boundary (ISSUE-018). */
  startTime: number;
  /** The response end boundary (ISSUE-018). */
  responseEnd: number;
}

/** One recorded first-card visibility sample of one new Search. */
interface PerfFirstCard {
  /** The browser event that submitted the selected suggestion (ISSUE-018). */
  submission: number;
  /**
   * The first animation frame in which the first ranked Result Card had a
   * nonempty layout box and computed opacity greater than zero; `null`
   * when the sampler deadline elapsed first (ISSUE-018).
   */
  visibleAt: number | null;
}

/**
 * The browser-window measurement harness the spec installs before the
 * application scripts run (declared here so the spec reads and writes it
 * without an unchecked inline cast).
 */
declare global {
  interface Window {
    __perf?: {
      /** Every Substitution Search POST resource entry, in completion order. */
      posts: PerfPost[];
      /** One first-card sample per submitted suggestion, in submission order. */
      firstCards: PerfFirstCard[];
      /** Discards every recorded sample (used after the unmeasured warm-up). */
      reset(): void;
    };
  }
}

/** Overrides `navigator.languages` before the application scripts run. */
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

/**
 * Installs the browser-side performance harness before the application
 * scripts run (task 54, ISSUE-018):
 *
 * - a `PerformanceObserver` records every `fetch` resource entry for
 *   `POST /api/v1/substitutes/search`, capturing exactly the
 *   `startTime` through `responseEnd` boundary of each Search and MORE!
 *   request;
 * - a capture-phase document click listener arms the first-card sampler on
 *   the browser event that submits a suggestion (the click on one
 *   `#food-suggestion-option-*` row), and a `requestAnimationFrame`
 *   sampler records the first frame in which the first ranked Result Card
 *   (`[data-result-card-rank="0"]`) has a nonempty layout box and computed
 *   opacity greater than zero. The sampler requires the card to have been
 *   absent from at least one earlier frame so a retained card from the
 *   previous iteration's completed page can never be mistaken for the new
 *   page's first card (the previous result region is unmounted during the
 *   `loadingNew` transition). The sampler stops at a deadline so a failed
 *   search cannot sample forever; the scenario then fails the sample.
 */
async function installPerformanceHarness(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const posts: PerfPost[] = [];
    const firstCards: PerfFirstCard[] = [];
    /** The first-card sampler deadline: far beyond the 1 s limit (REQ-075). */
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

/** One observed generated-client Substitution Search POST. */
interface TrackedPost {
  body: SubstituteSearchRequest;
  status: number | null;
}

/** One Node-side Substitution Search request ledger. */
interface PostLedger {
  posts: TrackedPost[];
  /** The greatest number of Substitution Search POSTs in flight at once. */
  maxActive: number;
  reset(): void;
}

/**
 * Records every generated-client `POST /api/v1/substitutes/search` request
 * and its real-stack response status, and tracks the greatest number of
 * such requests in flight at once (P18-G2, P18-G3: no overlapping
 * Substitution Search request).
 */
function trackSubstitutePosts(page: Page): PostLedger {
  const posts: TrackedPost[] = [];
  let active = 0;
  let maxActive = 0;
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

/** Returns the Food Object IDs of all currently rendered result cards. */
async function renderedCardIDs(page: Page): Promise<number[]> {
  const cards = page.locator("[data-result-card]");
  return cards.evaluateAll((elements) =>
    elements.map((element) =>
      Number(element.getAttribute("data-food-object-id")),
    ),
  );
}

/** One new-Search iteration's measured Search and first-card samples. */
interface SearchAndFirstCardSamples {
  /** The Search request duration: `responseEnd - startTime` (ISSUE-018). */
  searchMs: number;
  /** The first-card duration: `visibleAt - submission` (ISSUE-018). */
  firstCardMs: number;
}

/**
 * Reads the current iteration's Search request and first-card samples from
 * the browser harness. Both boundaries come from the recorded
 * timestamps, so the Node-side read cannot distort them.
 */
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

/**
 * Reads the current iteration's MORE! request sample from the browser
 * harness: `responseEnd - startTime` of the iteration's second POST
 * (ISSUE-018).
 */
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

    // --- Unmeasured warm-up (ISSUE-018): one complete new Search and MORE!
    // flow warms the browser, optimized Vite preview, Fiber process,
    // PostgreSQL connection, and query paths. ---
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
    // Discard the warm-up's recorded measurements: exactly the 20 measured
    // iterations below supply the reported samples (P18-G6).
    await page.evaluate(() => {
      window.__perf?.reset();
    });
    ledger.reset();

    // --- 20 measured iterations (ISSUE-018). Each iteration starts one new
    // Search, measures its first Result Card, and then activates MORE!, so
    // the same 20 Search iterations supply the 20 first-card samples. Each
    // measured response and rendered state is awaited before the next
    // action, so only one Substitution Search request is active. ---
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      // New Search: draft the query, wait for the seeded suggestion option,
      // and submit it with a pointer click.
      await search.fill(PIZZA_QUERY);
      await expect(option).toBeVisible();
      await option.click();

      // Await the measured Search response (its resource entry records
      // `responseEnd`) and the first visible Result Card frame.
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
      // The rendered state replaced the pending surface (REQ-077).
      await expect(page.locator("main")).toHaveAttribute(
        "data-interaction-state",
        "results",
      );

      // Measure, report, and immediately check the Search and first-card
      // samples: the first breach stops the iteration loop right here, so
      // later samples are never run or hidden (P18-G6).
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

      // MORE!: activate the next page and await its measured response and
      // the rendered replacement page before the next iteration.
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

    // --- Final accounting: exactly 20 measured POSTs of each type
    // completed, all from the seeded fixture, none overlapping, none
    // failed, and none contributed by the warm-up (P18-G6, REQ-074). ---
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
      expect(post.body.quantity).toEqual(PIZZA_QUANTITY);
      expect(post.status).toBe(200);
    }
  });
});
