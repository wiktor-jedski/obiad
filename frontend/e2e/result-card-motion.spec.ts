import { expect, test, type Page } from "@playwright/test";

/**
 * Real-stack Result Card motion scenario (task 50, task 51, Phase 16;
 * ARCH-001, ARCH-002, ARCH-011, ARCH-020, ARCH-021, ARCH-022, REQ-052,
 * REQ-053, REQ-054, REQ-081, ISSUE-016; P16-G2, P16-G3, P16-G4).
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
 * Task 51 completes the keyed MORE! replacement over task 50 (REQ-053):
 * when a successful later-page response replaces the keyed card set, every
 * current card starts its 120 ms opacity outro together, and each
 * replacement card delays its 220 ms intro by the full outro duration —
 * so no replacement intro starts before the last current-card outro
 * completes — and then applies the 100 ms rank intervals in DOM rank
 * order. Reduced-motion mode sets every outro and intro duration and
 * delay to zero, so the complete replacement page appears together in one
 * animation frame with no intermediate stagger and no mixed old-and-new
 * page (REQ-054).
 *
 * The observer intercepts every Svelte transition event dispatched to a
 * Result Card — Svelte dispatches `introstart`, `introend`, `outrostart`,
 * and `outroend` as non-bubbling CustomEvents on the card element — and
 * records `performance.now()` and whether the localized results heading
 * is `document.activeElement` at that instant. At every `introend` and
 * `outroend` it also records the frame-accurate Web Animations clock of
 * the card's just-finished animation — the compositor-driven `startTime`
 * (the frame-aligned fade start) and final `currentTime` (exactly the
 * intro or outro duration) — which are immune to the asynchronous
 * delivery of the transition events themselves. A requestAnimationFrame
 * sampler records the computed opacity of every rendered card per frame.
 * The scenarios then prove, against the real browser animation schedule:
 *
 *   - normal motion: the three page-0 cards of Pizza Margherita start in
 *     rank and DOM order, adjacent intro starts differ by 100 ms within
 *     one animation frame, each intro lasts 220 ms within one animation
 *     frame (from the recorded animation-clock values), and the localized
 *     results heading is the active element when motion starts and
 *     remains active after the completed page renders (P16-G2, P16-G3,
 *     REQ-052);
 *   - keyed MORE! replacement: a real MORE! response starts all three
 *     current-card outros together, each outro lasts 120 ms within one
 *     animation frame, no replacement intro starts before the last outro
 *     ends, the replacement intros keep the 220 ms duration and 100 ms
 *     rank intervals in DOM rank order, and the stable results heading
 *     remains mounted and focused through the replacement (P16-G2,
 *     P16-G3, REQ-053);
 *   - reduced motion: all first-page cards — and, after MORE!, the
 *     complete replacement page — become fully visible in the same
 *     animation frame with no intermediate opacity, no stagger, and no
 *     mixed old-and-new page: every recorded frame shows every present
 *     card at full opacity, and every recorded transition event falls
 *     inside one animation frame (P16-G4, REQ-054);
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
 * Returns the one-animation-frame timing tolerance of the Phase 16 gate:
 * the longest requestAnimationFrame delta observed while result cards
 * were rendered. The intro animations' timeline start times snap to the
 * compositor frame grid, so the start-interval measurement carries at
 * most one frame of quantization error; that error is bounded by the
 * actual grid step, which the longest observed frame of the motion
 * window measures — the median would slightly underestimate the grid
 * period and leave a razor-thin boundary miss (plan.md Phase 16 gate,
 * REQ-052, REQ-053).
 */
function observedFrameMs(frames: readonly MotionFrame[]): number {
  const motionWindow = frames.filter((frame) => frame.cards.length > 0);
  const deltas: number[] = [];
  for (let index = 1; index < motionWindow.length; index += 1) {
    const delta = motionWindow[index]!.at - motionWindow[index - 1]!.at;
    if (delta >= 1 && delta <= 250) {
      deltas.push(delta);
    }
  }
  if (deltas.length === 0) {
    return ONE_ANIMATION_FRAME_MS;
  }
  deltas.sort((a, b) => a - b);
  return deltas[deltas.length - 1]!;
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
/**
 * The three page-1 cards of the seeded Pizza Margherita search (ISSUE-002,
 * REQ-072): Pho (30), Lasagna (3), Pastel de nata (35) in rank order —
 * the keyed MORE! replacement page over `PIZZA_PAGE_0_IDS` (REQ-053).
 */
const PIZZA_PAGE_1_IDS = [30, 3, 35] as const;
/** The 120 ms outro duration of one current card before replacement (REQ-053). */
const OUTRO_DURATION_MS = 120;

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
  readonly type: "introstart" | "introend" | "outrostart" | "outroend";
  /** The Food Object ID of the card that received the event. */
  readonly foodObjectId: number;
  /** The `performance.now()` timestamp of the event. */
  readonly at: number;
  /** Whether the localized results heading was the active element. */
  readonly headingActive: boolean;
  /**
   * The timeline start time of the card's just-finished intro or outro
   * animation, recorded at its `introend` or `outroend` (frame-accurate
   * compositor clock; `null` for the reduced-motion instant path, which
   * creates no animation).
   */
  readonly startTime: number | null;
  /**
   * The final `currentTime` of the card's just-finished intro or outro
   * animation, recorded at its `introend` or `outroend` — the animation
   * clock reports exactly the transition duration (`null` for the
   * reduced-motion instant path).
   */
  readonly currentTime: number | null;
}

/** One recorded animation frame of every rendered card's visual state. */
interface MotionFrame {
  readonly at: number;
  readonly cards: ReadonlyArray<{
    readonly id: number;
    readonly rank: number;
    readonly opacity: number;
    readonly left: number;
    readonly top: number;
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
    /**
     * Clears the recorded opacity frames and restarts the
     * requestAnimationFrame sampler. With `keepSampling` the sampler
     * keeps recording until `__stopMotionFrames` is called instead of
     * stopping as soon as a complete page is fully visible — the
     * reduced-motion replacement completes synchronously, so the
     * automatic stop would otherwise miss it.
     */
    __restartMotionFrames?: (keepSampling: boolean) => void;
    /** Stops the continuous opacity sampler started with `keepSampling`. */
    __stopMotionFrames?: () => void;
  }
}

/**
 * Installs the motion observer before the application scripts run
 * (task 50, task 51, ARCH-022). Svelte dispatches `introstart`, `introend`,
 * `outrostart`, and `outroend` as non-bubbling CustomEvents on the
 * transition target: the card for an intro and its stable rank-slot wrapper
 * for an outro. The observer patches `dispatchEvent`, resolves either target
 * to its card, and records `performance.now()` and the results-heading focus
 * state. A `requestAnimationFrame` sampler records each rendered card's
 * effective card-and-wrapper opacity per frame until all cards of a page are
 * fully visible, proving same-frame visibility and the absence of
 * intermediate opacity.
 */
function installMotionObserver(): void {
  const events: MotionEventEntry[] = [];
  window.__motionEvents = events;
  const originalDispatchEvent = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (event: Event): boolean {
    if (
      event.type === "introstart" ||
      event.type === "introend" ||
      event.type === "outrostart" ||
      event.type === "outroend"
    ) {
      if (this instanceof Element) {
        const card = this.matches("[data-result-card]")
          ? this
          : this.querySelector("[data-result-card]");
        if (card !== null) {
          const heading = document.querySelector(
            "[data-substitutions-heading]",
          );
          let startTime: number | null = null;
          let currentTime: number | null = null;
          if (event.type === "introend" || event.type === "outroend") {
            // At the `introend` or `outroend` dispatch the transition
            // target's just-finished animation is still attached (Svelte
            // cancels it after dispatching): its startTime and currentTime
            // come from the compositor-driven Web Animations timeline, so
            // they are frame-accurate and immune to asynchronous event
            // delivery. Intro events target the card; outro events target
            // its stable rank-slot motion wrapper.
            const finished = this.getAnimations().filter(
              (animation) => animation.playState === "finished",
            );
            const main = finished[0];
            if (main !== undefined) {
              const observedStartTime = Number(main.startTime);
              const observedCurrentTime = Number(main.currentTime);
              if (
                Number.isFinite(observedStartTime) &&
                Number.isFinite(observedCurrentTime)
              ) {
                startTime = observedStartTime;
                currentTime = observedCurrentTime;
              }
            }
          }
          events.push({
            type: event.type,
            foodObjectId: Number(card.getAttribute("data-food-object-id")),
            at: performance.now(),
            headingActive:
              heading !== null && document.activeElement === heading,
            startTime,
            currentTime,
          });
        }
      }
    }
    return originalDispatchEvent.call(this, event);
  };

  const frames: MotionFrame[] = [];
  window.__motionFrames = frames;
  let sampling = true;
  let continuous = false;
  function sample(): void {
    if (!sampling) {
      return;
    }
    const cards = Array.from(
      document.querySelectorAll("[data-result-card]"),
    ).map((element) => {
      const bounds = element.getBoundingClientRect();
      const motionWrapper = element.closest("[data-result-card-motion]");
      const wrapperOpacity =
        motionWrapper === null
          ? 1
          : Number.parseFloat(getComputedStyle(motionWrapper).opacity);
      return {
        id: Number(element.getAttribute("data-food-object-id")),
        rank: Number(element.getAttribute("data-result-card-rank")),
        opacity:
          Number.parseFloat(getComputedStyle(element).opacity) * wrapperOpacity,
        left: bounds.left + window.scrollX,
        top: bounds.top + window.scrollY,
      };
    });
    frames.push({ at: performance.now(), cards });
    if (
      !continuous &&
      cards.length >= 3 &&
      cards.every((card) => card.opacity === 1)
    ) {
      sampling = false;
      return;
    }
    requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
  window.__restartMotionFrames = (keepSampling: boolean) => {
    frames.length = 0;
    continuous = keepSampling;
    if (!sampling) {
      sampling = true;
      requestAnimationFrame(sample);
    }
  };
  window.__stopMotionFrames = () => {
    sampling = false;
  };
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

/** One settled rank slot used to detect viewport movement during replacement. */
interface CardSlot {
  readonly left: number;
  readonly top: number;
}

/** Returns the document slots occupied by the settled ranked cards. */
async function cardSlots(page: Page): Promise<readonly CardSlot[]> {
  return page.locator("[data-result-card]").evaluateAll((elements) =>
    elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left + window.scrollX,
        top: bounds.top + window.scrollY,
      };
    }),
  );
}

/**
 * Proves that every rendered card remains in its settled rank slot while
 * opacity changes. Empty frames are valid between the outgoing and incoming
 * card sets.
 */
function expectCardsToStayInPlace(
  frames: readonly MotionFrame[],
  slots: readonly CardSlot[],
  scenario: string,
): void {
  const framesWithCards = frames.filter((frame) => frame.cards.length > 0);
  expect(
    framesWithCards.length,
    `${scenario}: the sampler observed rendered replacement cards`,
  ).toBeGreaterThan(0);
  expect(
    framesWithCards.some((frame) =>
      frame.cards.some((card) => card.opacity < 1),
    ),
    `${scenario}: the sampler observed the opacity reveal`,
  ).toBe(true);
  for (const frame of framesWithCards) {
    for (const card of frame.cards) {
      const slot = slots[card.rank]!;
      expect(
        Math.abs(card.left - slot.left),
        `${scenario}: rank ${card.rank} does not shift horizontally`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(card.top - slot.top),
        `${scenario}: rank ${card.rank} does not shift vertically`,
      ).toBeLessThanOrEqual(1);
    }
  }
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
    const tolerance = observedFrameMs(frames);
    const starts = events.filter((entry) => entry.type === "introstart");
    const ends = events.filter((entry) => entry.type === "introend");
    expect(starts).toHaveLength(3);
    expect(ends).toHaveLength(3);
    expect(
      ends.every(
        (entry) => entry.startTime !== null && entry.currentTime !== null,
      ),
      "every introend recorded the frame-accurate intro animation clock",
    ).toBe(true);
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
    // each within ONE observed animation frame (P16-G2, REQ-052, plan.md
    // Phase 16 gate). The proof uses the frame-accurate Web Animations
    // clock recorded at the introend events — each intro animation's
    // `startTime` (the compositor-frame-aligned fade start) and final
    // `currentTime` (exactly the intro duration) — because those values
    // come from the compositor-driven animation timeline and are immune
    // to the asynchronous delivery of the transition events themselves.
    expect(
      Math.abs(ends[1]!.startTime! - ends[0]!.startTime! - INTRO_INTERVAL_MS),
      "rank 1 starts 100 ms after rank 0 within one animation frame",
    ).toBeLessThanOrEqual(tolerance);
    expect(
      Math.abs(ends[2]!.startTime! - ends[1]!.startTime! - INTRO_INTERVAL_MS),
      "rank 2 starts 100 ms after rank 1 within one animation frame",
    ).toBeLessThanOrEqual(tolerance);
    for (let index = 0; index < ends.length; index += 1) {
      expect(
        Math.abs(ends[index]!.currentTime! - INTRO_DURATION_MS),
        `rank ${index} intro lasts 220 ms within one animation frame`,
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
  test("a new keyboard search removes the settled cards and reveals the replacement cards in the same viewport slots without layout movement", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    await page.addInitScript(installMotionObserver);
    await page.goto("/");

    await selectFoodObject(page, "margherita", 1);
    await expect(page.locator("[data-result-card]")).toHaveCount(3);
    await expect
      .poll(async () => countEvents(await motionEvents(page), "introend"))
      .toBe(3);
    const slots = await cardSlots(page);
    await page.evaluate(() => window.__restartMotionFrames?.(true));

    const searchInput = page.getByPlaceholder(COPY.en.searchPlaceholder);
    await searchInput.fill("chicken");
    await expect(page.locator("#food-suggestion-option-5")).toBeVisible();
    await searchInput.press("Enter");
    await expect
      .poll(async () => countEvents(await motionEvents(page), "introend"))
      .toBe(6);
    await page.evaluate(() => window.__stopMotionFrames?.());

    expectCardsToStayInPlace(
      await motionFrames(page),
      slots,
      "new keyboard search",
    );
  });

  test("a successful MORE! response starts every current-card outro together for 120 ms, delays every replacement intro until the last outro ends, keeps the 220 ms intro with 100 ms rank intervals and DOM rank order, and keeps the stable results heading mounted and focused through the replacement (P16-G2, P16-G3, REQ-053)", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    await page.addInitScript(installMotionObserver);
    await page.goto("/");
    const heading = page.locator("[data-substitutions-heading]");

    await selectFoodObject(page, "margherita", 1);
    await expect(page.locator("[data-result-card]")).toHaveCount(3);
    // Wait until all three first-page intros have completed, then capture
    // the event boundary that separates the entrance motion from the
    // keyed replacement motion and the frame-grid tolerance from the
    // first-page motion window.
    await expect
      .poll(async () => countEvents(await motionEvents(page), "introend"))
      .toBe(3);
    const firstPageEventCount = (await motionEvents(page)).length;
    const firstPageFrames = await motionFrames(page);
    const tolerance = observedFrameMs(firstPageFrames);
    const slots = await cardSlots(page);
    await page.evaluate(() => window.__restartMotionFrames?.(true));

    // Drive one real MORE! request: the successful page-1 response
    // replaces the keyed card set, so the replacement motion follows.
    await page.locator("[data-more-button]").click();
    // Wait until all three replacement intros have completed (three
    // first-page plus three replacement introend events in total).
    await expect
      .poll(async () => countEvents(await motionEvents(page), "introend"))
      .toBe(6);
    await page.evaluate(() => window.__stopMotionFrames?.());
    expectCardsToStayInPlace(
      await motionFrames(page),
      slots,
      "MORE! replacement",
    );
    const events = (await motionEvents(page)).slice(firstPageEventCount);

    // The replacement window contains exactly the three outro and three
    // intro pairs of the keyed replacement sequence (REQ-053).
    const outroStarts = events.filter((entry) => entry.type === "outrostart");
    const outroEnds = events.filter((entry) => entry.type === "outroend");
    const introStarts = events.filter((entry) => entry.type === "introstart");
    const introEnds = events.filter((entry) => entry.type === "introend");
    expect(outroStarts).toHaveLength(3);
    expect(outroEnds).toHaveLength(3);
    expect(introStarts).toHaveLength(3);
    expect(introEnds).toHaveLength(3);

    // The current page-0 cards are the ones that outro, in the ranked DOM
    // order, and all three start together within one animation frame
    // (REQ-053, P16-G3).
    expect(
      outroStarts.map((entry) => entry.foodObjectId),
      "every current card starts its outro together (P16-G3)",
    ).toEqual([...PIZZA_PAGE_0_IDS]);
    const outroStartTimes = outroStarts.map((entry) => entry.at);
    expect(
      Math.max(...outroStartTimes) - Math.min(...outroStartTimes),
      "all current-card outros start within one animation frame",
    ).toBeLessThanOrEqual(tolerance);
    expect(
      outroEnds.map((entry) => entry.foodObjectId),
      "outroend events fire in the same ranked order",
    ).toEqual([...PIZZA_PAGE_0_IDS]);

    // Each outro lasts 120 ms within one animation frame, proven by the
    // frame-accurate animation clock recorded at every outroend: the
    // just-finished outro animation reports exactly the outro duration.
    for (let index = 0; index < outroEnds.length; index += 1) {
      expect(
        outroEnds[index]!.startTime !== null &&
          outroEnds[index]!.currentTime !== null,
        `current card rank ${index} outroend recorded the outro animation clock`,
      ).toBe(true);
      expect(
        Math.abs(outroEnds[index]!.currentTime! - OUTRO_DURATION_MS),
        `current card rank ${index} outro lasts 120 ms within one animation frame`,
      ).toBeLessThanOrEqual(tolerance);
    }

    // The replacement intros keep the reusable entrance sequence: 220 ms
    // durations, 100 ms rank intervals, and the ranked DOM order of
    // page 1 (REQ-053, P16-G2, P16-G3).
    expect(
      introStarts.map((entry) => entry.foodObjectId),
      "replacement intros start in rank order (P16-G3)",
    ).toEqual([...PIZZA_PAGE_1_IDS]);
    expect(
      introEnds.map((entry) => entry.foodObjectId),
      "replacement introend events fire in the same rank order",
    ).toEqual([...PIZZA_PAGE_1_IDS]);
    expect(
      introEnds.every(
        (entry) => entry.startTime !== null && entry.currentTime !== null,
      ),
      "every replacement introend recorded the frame-accurate intro animation clock",
    ).toBe(true);
    expect(
      Math.abs(
        introEnds[1]!.startTime! - introEnds[0]!.startTime! - INTRO_INTERVAL_MS,
      ),
      "replacement rank 1 starts 100 ms after rank 0 within one animation frame",
    ).toBeLessThanOrEqual(tolerance);
    expect(
      Math.abs(
        introEnds[2]!.startTime! - introEnds[1]!.startTime! - INTRO_INTERVAL_MS,
      ),
      "replacement rank 2 starts 100 ms after rank 1 within one animation frame",
    ).toBeLessThanOrEqual(tolerance);
    for (let index = 0; index < introEnds.length; index += 1) {
      expect(
        Math.abs(introEnds[index]!.currentTime! - INTRO_DURATION_MS),
        `replacement rank ${index} intro lasts 220 ms within one animation frame`,
      ).toBeLessThanOrEqual(tolerance);
    }

    // No replacement intro starts before the last current-card outro
    // ends: the first replacement introstart fires no earlier than the
    // last outroend, within one animation frame (REQ-053, plan.md Phase
    // 16 gate).
    const lastOutroEnd = Math.max(...outroEnds.map((entry) => entry.at));
    const firstIntroStart = Math.min(...introStarts.map((entry) => entry.at));
    expect(
      lastOutroEnd - firstIntroStart,
      "no replacement intro starts before the last current-card outro ends (within one animation frame)",
    ).toBeLessThanOrEqual(tolerance);

    // The replacement page renders in the ranked DOM order (P16-G3).
    const domIds = await page
      .locator("[data-result-card]")
      .evaluateAll((elements) =>
        elements.map((element) =>
          Number(element.getAttribute("data-food-object-id")),
        ),
      );
    expect(
      domIds,
      "the replacement cards keep the ranked DOM order (P16-G3)",
    ).toEqual([...PIZZA_PAGE_1_IDS]);

    // The stable results heading stays mounted, becomes the active
    // element when the replacement motion starts, and stays focused
    // through the replacement: every recorded replacement event observed
    // the heading as the active element (REQ-083, ISSUE-016).
    expect(
      events.every((entry) => entry.headingActive),
      "the results heading is the active element for the complete replacement motion interval",
    ).toBe(true);
    await expect(heading).toHaveText(COPY.en.foundSubstitutions);
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
  });

  test("with reduced-motion emulation a successful MORE! replacement shows the complete replacement page in the same animation frame with no intermediate stagger and no mixed old-and-new page, and the results heading stays mounted and focused (P16-G4, REQ-054)", async ({
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
    const firstPageEventCount = (await motionEvents(page)).length;

    // Restart the opacity sampler in continuous mode: the reduced-motion
    // replacement completes synchronously inside the response flush, so
    // the sampler must keep recording across the replacement window
    // instead of stopping at the settled first page.
    await page.evaluate(() => window.__restartMotionFrames?.(true));

    await page.locator("[data-more-button]").click();

    // The reduced-motion replacement is synchronous: wait for the three
    // current-card outros and the three replacement intros (six introend
    // events in total), then stop the sampler.
    await expect
      .poll(async () => countEvents(await motionEvents(page), "outrostart"))
      .toBe(3);
    await expect
      .poll(async () => countEvents(await motionEvents(page), "introend"))
      .toBe(6);
    await page.evaluate(() => window.__stopMotionFrames?.());

    const events = (await motionEvents(page)).slice(firstPageEventCount);
    expect(events).toHaveLength(12);
    const outroStarts = events.filter((entry) => entry.type === "outrostart");
    const outroEnds = events.filter((entry) => entry.type === "outroend");
    const introStarts = events.filter((entry) => entry.type === "introstart");
    const introEnds = events.filter((entry) => entry.type === "introend");
    expect(outroStarts).toHaveLength(3);
    expect(outroEnds).toHaveLength(3);
    expect(introStarts).toHaveLength(3);
    expect(introEnds).toHaveLength(3);

    // Every replacement transition event falls inside one animation
    // frame: zero-duration, zero-delay outro and intro (REQ-054, P16-G4).
    const times = events.map((entry) => entry.at);
    expect(
      Math.max(...times) - Math.min(...times),
      "all replacement transition events fall inside one animation frame (P16-G4)",
    ).toBeLessThanOrEqual(ONE_ANIMATION_FRAME_MS);
    expect(
      outroStarts.map((entry) => entry.foodObjectId),
      "the current page-0 cards are the ones that outro",
    ).toEqual([...PIZZA_PAGE_0_IDS]);
    expect(
      introStarts.map((entry) => entry.foodObjectId),
      "the page-1 cards are the ones that intro",
    ).toEqual([...PIZZA_PAGE_1_IDS]);
    for (let index = 0; index < 3; index += 1) {
      expect(
        Math.abs(outroEnds[index]!.at - outroStarts[index]!.at),
        `current card rank ${index} has zero-duration outro (REQ-054)`,
      ).toBeLessThanOrEqual(ONE_ANIMATION_FRAME_MS);
      expect(
        Math.abs(introEnds[index]!.at - introStarts[index]!.at),
        `replacement card rank ${index} has zero-duration intro (REQ-054)`,
      ).toBeLessThanOrEqual(ONE_ANIMATION_FRAME_MS);
    }

    // No sampled frame mixes the old and new page and no sampled frame
    // shows an intermediate opacity: after the replacement starts, every
    // recorded frame contains exactly the complete page-1 card set at
    // full opacity (REQ-054, P16-G4).
    const frames = await motionFrames(page);
    const replacementStart = Math.min(...times);
    const replacementFrames = frames.filter(
      (frame) => frame.cards.length > 0 && frame.at >= replacementStart,
    );
    expect(
      replacementFrames.length,
      "the sampler observed the replacement window",
    ).toBeGreaterThan(0);
    for (const frame of replacementFrames) {
      expect(
        frame.cards.map((card) => card.id),
        "no frame mixes the old and new page (REQ-054)",
      ).toEqual([...PIZZA_PAGE_1_IDS]);
      for (const card of frame.cards) {
        expect(
          card.opacity,
          "no sampled frame shows an intermediate card opacity (REQ-054)",
        ).toBe(1);
      }
    }

    // The stable results heading remains mounted and becomes the active
    // element after the synchronous replacement renders (REQ-083,
    // ISSUE-016). The zero-duration transition events fire before the
    // focus microtask of the successful-response effect, so the
    // assertion is the post-render state, as in the first-page
    // reduced-motion case.
    await expect(heading).toHaveText(COPY.en.foundSubstitutions);
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
  });
});
