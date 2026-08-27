import { expect, test, type Page } from "@playwright/test";

const COPY = {
  en: {
    searchPlaceholder: "Search foods",
    foundSubstitutions: "Found substitutions",
    updatingQuantities: "Updating quantities",
  },
} as const;

const ONE_ANIMATION_FRAME_MS = 1000 / 60;

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

const INTRO_DURATION_MS = 220;

const INTRO_INTERVAL_MS = 100;

const PIZZA_PAGE_0_IDS = [13, 29, 26] as const;

const PIZZA_PAGE_1_IDS = [30, 3, 35] as const;

const OUTRO_DURATION_MS = 120;

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

interface MotionEventEntry {
  readonly type: "introstart" | "introend" | "outrostart" | "outroend";

  readonly foodObjectId: number;

  readonly at: number;

  readonly headingActive: boolean;

  readonly startTime: number | null;

  readonly currentTime: number | null;
}

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

declare global {
  interface Window {
    __motionEvents?: MotionEventEntry[];
    __motionFrames?: MotionFrame[];

    __restartMotionFrames?: (keepSampling: boolean) => void;

    __stopMotionFrames?: () => void;
  }
}

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

async function motionEvents(page: Page): Promise<readonly MotionEventEntry[]> {
  return page.evaluate(() => {
    const store = window.__motionEvents;
    return store === undefined ? [] : store;
  });
}

async function motionFrames(page: Page): Promise<readonly MotionFrame[]> {
  return page.evaluate(() => {
    const store = window.__motionFrames;
    return store === undefined ? [] : store;
  });
}

function countEvents(
  entries: readonly MotionEventEntry[],
  type: MotionEventEntry["type"],
): number {
  return entries.filter((entry) => entry.type === type).length;
}

interface CardSlot {
  readonly left: number;
  readonly top: number;
}

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

    await expect(heading).toHaveText(COPY.en.foundSubstitutions);
    await expect(heading).toBeFocused();
  });

  test("a held and then completed Food Quantity recalculation neither remounts nor animates the retained page-0 cards (REQ-052, REQ-081, ISSUE-016)", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    await page.addInitScript(installMotionObserver);

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

    await expect
      .poll(async () => countEvents(await motionEvents(page), "introend"))
      .toBe(3);
    const firstPageEventCount = (await motionEvents(page)).length;
    const firstPageFrames = await motionFrames(page);
    const tolerance = observedFrameMs(firstPageFrames);
    const slots = await cardSlots(page);
    await page.evaluate(() => window.__restartMotionFrames?.(true));

    await page.locator("[data-more-button]").click();

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

    const outroStarts = events.filter((entry) => entry.type === "outrostart");
    const outroEnds = events.filter((entry) => entry.type === "outroend");
    const introStarts = events.filter((entry) => entry.type === "introstart");
    const introEnds = events.filter((entry) => entry.type === "introend");
    expect(outroStarts).toHaveLength(3);
    expect(outroEnds).toHaveLength(3);
    expect(introStarts).toHaveLength(3);
    expect(introEnds).toHaveLength(3);

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

    const lastOutroEnd = Math.max(...outroEnds.map((entry) => entry.at));
    const firstIntroStart = Math.min(...introStarts.map((entry) => entry.at));
    expect(
      lastOutroEnd - firstIntroStart,
      "no replacement intro starts before the last current-card outro ends (within one animation frame)",
    ).toBeLessThanOrEqual(tolerance);

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

    await page.evaluate(() => window.__restartMotionFrames?.(true));

    await page.locator("[data-more-button]").click();

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

    await expect(heading).toHaveText(COPY.en.foundSubstitutions);
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
  });
});
