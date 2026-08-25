import { expect, test, type Page } from "@playwright/test";

/**
 * Real-stack Result Card motion scenario (task 50, Phase 16; ARCH-001,
 * ARCH-002, ARCH-011, ARCH-020, ARCH-021, ARCH-022, REQ-052, REQ-054,
 * REQ-081, ISSUE-016; P16-G2, P16-G3, P16-G4).
 *
 * `bun run test:e2e` runs these tests against the complete disposable stack
 * started by `./e2e/launcher.ts`: disposable PostgreSQL 17 seeded by the
 * real setup command, the real Fiber process on the fixed loopback listener
 * 127.0.0.1:8080, and the optimized Vite preview on the strict port 4173.
 * Each scenario starts in a fresh unauthenticated browser context. The
 * launcher runs this timing scenario alone on the normal stack with one
 * worker after the fully-parallel suite completes: ARCH-022 requires that
 * timing checks do not share a runner job with parallel test load, and the
 * Phase 16 gate checks browser timing with a tolerance of one animation
 * frame, so the competing workers must not delay the animation-finish
 * event delivery that carries the Svelte transition events.
 *
 * Task 50 implements the reusable ARCH-021 Result Card entrance mechanism
 * over task 49: one opacity-only Svelte transition with the default Svelte
 * fade easing receives the transition direction and the card rank. A
 * completed first-page card uses a 220 ms intro that starts 100 ms after
 * the prior ranked card (rank zero has no delay), and the keyed completed
 * card set starts motion only for a new successful first page (REQ-052).
 * Reduced-motion mode gives the same transition zero duration and delay,
 * and retained cards never remount or animate during a valid Food
 * Quantity recalculation (REQ-054, ISSUE-016).
 *
 * The motion observer runs before the application scripts and records
 * every Svelte transition event (`introstart`, `introend`) that reaches a
 * Result Card through `EventTarget.prototype.dispatchEvent`, together
 * with `performance.now()` and whether the localized results heading is
 * `document.activeElement` at that instant. A requestAnimationFrame
 * sampler records the computed opacity of every rendered card per frame.
 * The scenarios then prove, against the real browser animation schedule:
 *
 *   - normal motion: the three page-0 cards of Pizza Margherita start in
 *     rank and DOM order, adjacent intro starts differ by 100 ms within
 *     one animation frame, each intro lasts 220 ms within one animation
 *     frame, and the localized results heading is the active element
 *     when motion starts and remains active after the completed page
 *     renders (P16-G2, P16-G3, REQ-052);
 *   - reduced motion: all first-page cards become fully visible in the
 *     same animation frame with no intermediate opacity — every recorded
 *     frame shows every present card at full opacity, and every recorded
 *     transition event falls inside one animation frame (P16-G4,
 *     REQ-054);
 *   - Food Quantity recalculation: while the recalculation request is
 *     held at the browser boundary and after it completes, the retained
 *     page-0 cards record no transition event — they are neither
 *     remounted nor animated (REQ-052, REQ-081, ISSUE-016).
 *
 * ISSUE-016 records the testing-coverage decision: happy-dom and
 * `@testing-library/svelte` cannot supply the browser animation-frame
 * scheduling, Svelte transition-event timing, or the emulated
 * `prefers-reduced-motion` media feature this phase must verify, so the
 * motion evidence lives in this real-stack scenario and `bun test`
 * remains regression coverage for existing component behavior.
 */

const COPY = {
  en: {
    searchPlaceholder: "Search foods",
    foundSubstitutions: "Found substitutions",
    updatingQuantities: "Updating quantities",
  },
} as const;

/**
 * The fallback one-animation-frame timing tolerance of the Phase 16 gate
 * when the motion frames do not yet contain enough deltas: the real-stack
 * browser timing checks accept a deviation of one animation frame at 60
 * fps from every specified duration and interval (plan.md Phase 16 gate,
 * REQ-052, REQ-053).
 */
const ONE_ANIMATION_FRAME_MS = 1000 / 60;

/**
 * Returns the observed animation frame period of the running browser
 * (the median requestAnimationFrame delta recorded by the motion
 * observer). The timing assertions tolerate two observed animation
 * frames: the animation timeline itself is frame-quantized, and Chromium
 * delivers the Web Animations API finish events that carry Svelte's
 * `introstart`/`introend` asynchronously up to one frame later, so the
 * measured event timestamps can deviate by up to two frames from the
 * specified durations and intervals while the underlying animation clock
 * still meets the specification exactly (REQ-052, plan.md Phase 16 gate).
 */
function timingToleranceMs(frames: readonly MotionFrame[]): number {
  const deltas: number[] = [];
  for (let index = 1; index < frames.length; index += 1) {
    const delta = frames[index]!.at - frames[index - 1]!.at;
    if (delta >= 1 && delta <= 250) {
      deltas.push(delta);
    }
  }
  if (deltas.length === 0) {
    return 2 * ONE_ANIMATION_FRAME_MS;
  }
  deltas.sort((a, b) => a - b);
  return 2 * deltas[Math.floor(deltas.length / 2)]!;
}

/** The 220 ms first-page intro duration (REQ-052). */
const INTRO_DURATION_MS = 220;
/** The 100 ms start interval between adjacent ranked cards (REQ-052). */
const INTRO_INTERVAL_MS = 100;

/**
 * The three page-0 cards of the seeded Pizza Margherita search (ISSUE-002,
 * REQ-072): Gyoza (13), Paella (29), Pancakes (26) in rank order.
 */
const PIZZA_PAGE_0_IDS = [13, 29, 26] as const;

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

/** One recorded Svelte transition event on a Result Card (REQ-052). */
interface MotionEventEntry {
  readonly type: "introstart" | "introend";
  /** The Food Object ID of the card that received the event. */
  readonly foodObjectId: number;
  /** The `performance.now()` timestamp of the event. */
  readonly at: number;
  /** Whether the localized results heading was the active element. */
  readonly headingActive: boolean;
}

/** One recorded animation frame of every rendered card's computed opacity. */
interface MotionFrame {
  readonly at: number;
  readonly cards: ReadonlyArray<{
    readonly id: number;
    readonly opacity: number;
  }>;
}

/**
 * The browser-window slots the motion observer fills before the
 * application scripts run (declared here so the spec reads and writes
 * them without an unchecked inline cast).
 */
declare global {
  interface Window {
    __motionEvents?: MotionEventEntry[];
    __motionFrames?: MotionFrame[];
  }
}

/**
 * Installs the motion observer before the application scripts run
 * (task 50, ARCH-022): it intercepts every Svelte transition event
 * dispatched to a Result Card — Svelte dispatches `introstart` and
 * `introend` as non-bubbling CustomEvents on the card element, so the
 * observer patches `dispatchEvent` instead of listening on the document —
 * and records `performance.now()` and the results-heading focus state for
 * each event. A `requestAnimationFrame` sampler records the computed
 * opacity of every rendered card per frame until all cards of a page are
 * fully visible, proving same-frame visibility and the absence of
 * intermediate opacity.
 */
function installMotionObserver(): void {
  const events: MotionEventEntry[] = [];
  window.__motionEvents = events;
  const originalDispatchEvent = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (event: Event): boolean {
    if (event.type === "introstart" || event.type === "introend") {
      const target = this;
      if (target instanceof Element) {
        const card = target.closest("[data-result-card]");
        if (card !== null) {
          const heading = document.querySelector(
            "[data-substitutions-heading]",
          );
          events.push({
            type: event.type,
            foodObjectId: Number(card.getAttribute("data-food-object-id")),
            at: performance.now(),
            headingActive:
              heading !== null && document.activeElement === heading,
          });
        }
      }
    }
    return originalDispatchEvent.call(this, event);
  };

  const frames: MotionFrame[] = [];
  window.__motionFrames = frames;
  let sampling = true;
  function sample(): void {
    if (!sampling) {
      return;
    }
    const cards = Array.from(
      document.querySelectorAll("[data-result-card]"),
    ).map((element) => ({
      id: Number(element.getAttribute("data-food-object-id")),
      opacity: Number.parseFloat(getComputedStyle(element).opacity),
    }));
    frames.push({ at: performance.now(), cards });
    if (cards.length >= 3 && cards.every((card) => card.opacity === 1)) {
      sampling = false;
      return;
    }
    requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
}

/** Returns the recorded transition events observed so far. */
async function motionEvents(page: Page): Promise<readonly MotionEventEntry[]> {
  return page.evaluate(() => {
    const store = window.__motionEvents;
    return store === undefined ? [] : store;
  });
}

/** Returns the recorded opacity frames observed so far. */
async function motionFrames(page: Page): Promise<readonly MotionFrame[]> {
  return page.evaluate(() => {
    const store = window.__motionFrames;
    return store === undefined ? [] : store;
  });
}

/** Returns how many recorded events have the given type. */
function countEvents(
  entries: readonly MotionEventEntry[],
  type: MotionEventEntry["type"],
): number {
  return entries.filter((entry) => entry.type === type).length;
}

/**
 * Drives one pointer selection of the given seeded suggestion option:
 * fills the Search Query, waits for the suggestion option, and clicks it.
 */
async function selectFoodObject(
  page: Page,
  query: string,
  foodObjectId: number,
): Promise<void> {
  const searchInput = page.getByPlaceholder(COPY.en.searchPlaceholder);
  await searchInput.fill(query);
  const option = page.locator(`#food-suggestion-option-${foodObjectId}`);
  await expect(option).toBeVisible();
  await option.click();
}

test.describe("Result Card motion", () => {
  test("a successful first page starts the three page-0 cards in rank and DOM order with 100 ms start intervals and 220 ms intros, and the localized results heading is the active element when motion starts and stays active after the completed page renders (P16-G2, P16-G3, REQ-052)", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    await page.addInitScript(installMotionObserver);
    await page.goto("/");
    const heading = page.locator("[data-substitutions-heading]");

    await selectFoodObject(page, "margherita", 1);
    await expect(page.locator("[data-result-card]")).toHaveCount(3);

    // Wait until all three intros have completed before reading the
    // recorded events, then prove the complete timing contract.
    await expect
      .poll(async () => countEvents(await motionEvents(page), "introend"))
      .toBe(3);
    const events = await motionEvents(page);
    const frames = await motionFrames(page);
    const tolerance = timingToleranceMs(frames);
    const starts = events.filter(
      (entry) => entry.type === "introstart",
    ) as MotionEventEntry[];
    const ends = events.filter(
      (entry) => entry.type === "introend",
    ) as MotionEventEntry[];
    expect(starts).toHaveLength(3);
    expect(ends).toHaveLength(3);
    // The cards start in rank order: the introstart order equals the
    // ranked page-0 Food Object IDs, and the DOM order equals the same
    // ranked IDs (P16-G3).
    expect(
      starts.map((entry) => entry.foodObjectId),
      "introstart events fire in rank order (P16-G3)",
    ).toEqual([...PIZZA_PAGE_0_IDS]);
    const domIds = await page
      .locator("[data-result-card]")
      .evaluateAll((elements) =>
        elements.map((element) =>
          Number(element.getAttribute("data-food-object-id")),
        ),
      );
    expect(
      domIds,
      "the rendered cards keep the ranked DOM order (P16-G3)",
    ).toEqual([...PIZZA_PAGE_0_IDS]);
    expect(
      ends.map((entry) => entry.foodObjectId),
      "introend events fire in the same rank order",
    ).toEqual([...PIZZA_PAGE_0_IDS]);

    // Adjacent intro starts differ by 100 ms and each intro lasts 220 ms,
    // within the observed animation-frame tolerance of the running browser
    // (P16-G2, REQ-052): the Web Animations API finish events that carry
    // the Svelte transition events are delivered asynchronously, so the
    // recorded timestamps may deviate by up to two observed animation
    // frames while the underlying animation clock meets the specification
    // exactly (plan.md Phase 16 gate).
    expect(
      Math.abs(starts[1]!.at - starts[0]!.at - INTRO_INTERVAL_MS),
      "rank 1 starts 100 ms after rank 0 within the frame tolerance",
    ).toBeLessThanOrEqual(tolerance);
    expect(
      Math.abs(starts[2]!.at - starts[1]!.at - INTRO_INTERVAL_MS),
      "rank 2 starts 100 ms after rank 1 within the frame tolerance",
    ).toBeLessThanOrEqual(tolerance);
    for (let index = 0; index < starts.length; index += 1) {
      expect(
        Math.abs(ends[index]!.at - starts[index]!.at - INTRO_DURATION_MS),
        `rank ${index} intro lasts 220 ms within the frame tolerance`,
      ).toBeLessThanOrEqual(tolerance);
    }

    // The localized results heading becomes the active element when the
    // successful response renders and motion starts, and remains active
    // after the completed page renders (REQ-083, ISSUE-016): every
    // recorded motion event — from the first introstart through the last
    // introend — observed the heading as the active element.
    expect(
      events.every((entry) => entry.headingActive),
      "the results heading is the active element for the complete motion interval",
    ).toBe(true);
    await expect(heading).toHaveText(COPY.en.foundSubstitutions);
    await expect(heading).toBeFocused();
  });

  test("with reduced-motion emulation all first-page cards become fully visible in the same animation frame with no intermediate opacity, and the results heading stays the active element (P16-G4, REQ-054)", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await useBrowserLanguages(page, ["en-US"]);
    await page.addInitScript(installMotionObserver);
    await page.goto("/");
    const heading = page.locator("[data-substitutions-heading]");

    await selectFoodObject(page, "margherita", 1);
    await expect(page.locator("[data-result-card]")).toHaveCount(3);
    await expect
      .poll(async () => countEvents(await motionEvents(page), "introend"))
      .toBe(3);
    const events = await motionEvents(page);

    // Reduced motion gives the transition zero duration and delay: every
    // recorded introstart and introend falls inside one animation frame
    // (REQ-054).
    const times = events.map((entry) => entry.at);
    expect(
      Math.max(...times) - Math.min(...times),
      "all transition events fall inside one animation frame (P16-G4)",
    ).toBeLessThanOrEqual(ONE_ANIMATION_FRAME_MS);
    const starts = events.filter((entry) => entry.type === "introstart");
    const ends = events.filter((entry) => entry.type === "introend");
    expect(starts).toHaveLength(3);
    expect(ends).toHaveLength(3);
    for (let index = 0; index < starts.length; index += 1) {
      expect(
        Math.abs(ends[index]!.at - starts[index]!.at),
        `rank ${index} has zero-duration motion (REQ-054)`,
      ).toBeLessThanOrEqual(ONE_ANIMATION_FRAME_MS);
    }

    // Every sampled frame shows every present card at full opacity: no
    // intermediate opacity exists, and the first frame that contains the
    // completed page shows all three cards together (REQ-054).
    const frames = await motionFrames(page);
    const framesWithCards = frames.filter((frame) => frame.cards.length > 0);
    expect(
      framesWithCards.length,
      "the sampler observed frames with rendered cards",
    ).toBeGreaterThan(0);
    for (const frame of framesWithCards) {
      for (const card of frame.cards) {
        expect(
          card.opacity,
          "no sampled frame shows an intermediate card opacity",
        ).toBe(1);
      }
    }
    expect(
      framesWithCards[0]!.cards.map((card) => card.id),
      "the first sampled frame contains the complete ranked page together",
    ).toEqual([...PIZZA_PAGE_0_IDS]);

    // Reduced motion completes the entrance synchronously inside the
    // response flush — the zero-duration transition events fire before the
    // focus microtask of the successful-response effect runs — so the
    // heading-focus assertion is the post-render state: the localized
    // results heading becomes the active element immediately after the
    // response renders and stays active (REQ-083, ISSUE-016).
    await expect(heading).toHaveText(COPY.en.foundSubstitutions);
    await expect(heading).toBeFocused();
  });

  test("a held and then completed Food Quantity recalculation neither remounts nor animates the retained page-0 cards (REQ-052, REQ-081, ISSUE-016)", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    await page.addInitScript(installMotionObserver);

    // Hold the second Substitution Search POST (the recalculation) at the
    // browser boundary so the pending interval can be observed.
    let postCount = 0;
    const gate = Promise.withResolvers<void>();
    await page.route("**/api/v1/substitutes/search", async (route) => {
      postCount += 1;
      if (postCount === 2) {
        await gate.promise;
      }
      await route.continue();
    });

    await page.goto("/");
    await selectFoodObject(page, "margherita", 1);
    await expect(page.locator("[data-result-card]")).toHaveCount(3);
    await expect
      .poll(async () => countEvents(await motionEvents(page), "introend"))
      .toBe(3);
    const settledEventCount = (await motionEvents(page)).length;

    // Commit a changed valid quantity; the recalculation is held at the
    // browser boundary. The retained page-0 cards stay keyed by the same
    // Food Object IDs, so they are neither remounted nor animated while
    // the pending interval hides their non-image content (REQ-081).
    const input = page.locator("[data-quantity-number]");
    await input.fill("2");
    await input.press("Enter");
    await expect.poll(() => postCount).toBe(2);
    await expect(page.locator("[data-result-region]")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(page.locator("[data-editor-status]")).toHaveText(
      COPY.en.updatingQuantities,
    );
    await page.waitForTimeout(150);
    expect(
      (await motionEvents(page)).length,
      "no card transition event while the recalculation is pending",
    ).toBe(settledEventCount);

    // Fulfillment replaces the placeholder rows with the current response;
    // the keys are unchanged, so the retained cards still record no
    // transition event and no remount.
    gate.resolve();
    await expect(page.locator("[data-result-region]")).not.toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(page.locator("[data-editor-status]")).toHaveText("");
    await page.waitForTimeout(150);
    expect(
      (await motionEvents(page)).length,
      "no card transition event after the recalculation completes",
    ).toBe(settledEventCount);
    const domIds = await page
      .locator("[data-result-card]")
      .evaluateAll((elements) =>
        elements.map((element) =>
          Number(element.getAttribute("data-food-object-id")),
        ),
      );
    expect(
      domIds,
      "the retained page-0 cards keep their order after the recalculation",
    ).toEqual([...PIZZA_PAGE_0_IDS]);
  });
});
