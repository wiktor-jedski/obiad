import { expect, test, type Request } from "@playwright/test";
import { isLandingDialogueRequest } from "./request-purpose";
import type { SubstituteSearchRequest } from "../src/client/types.gen";

const ITERATIONS = 20;
const NETWORK_LIMIT_MS = 500;
const FIRST_CARD_LIMIT_MS = 1000;

interface FirstCardMeasurement {
  firstCardMs: number | null;
  readyMs: number | null;
  maxFrameGapMs: number;
}

declare global {
  interface Window {
    __searchPerformance?: FirstCardMeasurement;
  }
}

test("Search performance: 20 searches and next-page requests meet the HTTP budget, and each first card is fully revealed within one second", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "languages", { get: () => ["en-US"] });
    document.addEventListener(
      "click",
      (event) => {
        if (
          !(event.target instanceof Element) ||
          !event.target.closest("#food-suggestion-option-1")
        ) {
          return;
        }
        const startedAt = performance.now();
        const previousCard = document.querySelector(
          '[data-result-card-rank="0"]',
        );
        const measurement: FirstCardMeasurement = {
          firstCardMs: null,
          readyMs: null,
          maxFrameGapMs: 0,
        };
        window.__searchPerformance = measurement;
        let previousFrameAt = startedAt;
        const sample = () => {
          const now = performance.now();
          measurement.maxFrameGapMs = Math.max(
            measurement.maxFrameGapMs,
            now - previousFrameAt,
          );
          previousFrameAt = now;
          const card = document.querySelector('[data-result-card-rank="0"]');
          const reveal = card?.closest("[data-card-reveal]");
          const state = reveal?.getAttribute("data-card-reveal-state");
          if (
            card !== null &&
            card !== previousCard &&
            (state === "revealing" || state === "shown") &&
            measurement.readyMs === null
          ) {
            measurement.readyMs = now - startedAt;
          }
          if (
            card !== null &&
            card !== previousCard &&
            state === "shown" &&
            card.getBoundingClientRect().width > 0 &&
            card.getBoundingClientRect().height > 0
          ) {
            measurement.firstCardMs = now - startedAt;
          } else if (now - startedAt < 5000) {
            requestAnimationFrame(sample);
          }
        };
        requestAnimationFrame(sample);
      },
      true,
    );
  });
  const samples: {
    body: SubstituteSearchRequest;
    duration: number;
    status: number;
  }[] = [];
  const firstCardSamples: number[] = [];
  let active = 0;
  let maxActive = 0;
  const isSearch = (request: Request) =>
    request.method() === "POST" &&
    request.url().includes("/api/v1/substitutes/search") &&
    !isLandingDialogueRequest(request);
  page.on("request", (request) => {
    if (!isSearch(request)) return;
    active += 1;
    maxActive = Math.max(maxActive, active);
  });
  page.on("requestfinished", async (request) => {
    if (!isSearch(request)) return;
    active -= 1;
    const response = await request.response();
    samples.push({
      // SAFETY: The real endpoint uses the generated request schema.
      body: request.postDataJSON() as SubstituteSearchRequest,
      duration: request.timing().responseEnd,
      status: response?.status() ?? 0,
    });
  });
  await page.goto("/");
  const search = page.getByRole("combobox", { name: "Search", exact: true });
  // Warm both API paths before measuring. No UI interval is part of the HTTP budget.
  for (let iteration = -1; iteration < ITERATIONS; iteration += 1) {
    await search.fill("margherita");
    await page.locator("#food-suggestion-option-1").click();
    await expect
      .poll(
        () => page.evaluate(() => window.__searchPerformance?.firstCardMs),
        {
          timeout: 6000,
        },
      )
      .toEqual(expect.any(Number));
    const measurement = await page.evaluate(() => window.__searchPerformance!);
    const firstCardMs = measurement.firstCardMs!;
    await expect(page.locator("[data-result-card]")).toHaveCount(3);
    await expect(page.locator('[data-card-reveal-state="shown"]')).toHaveCount(
      4,
    );
    await page.locator("[data-pagination-sentinel]").scrollIntoViewIfNeeded();
    await expect(page.locator("[data-result-card]")).toHaveCount(6);
    await expect
      .poll(() => samples.length)
      .toBe(iteration < 0 ? 2 : (iteration + 1) * 2);
    if (iteration < 0) {
      samples.length = 0;
      maxActive = 0;
    } else {
      firstCardSamples.push(firstCardMs);
      console.log(
        `[performance] First card sample ${iteration}: ${firstCardMs.toFixed(1)} ms (limit ${FIRST_CARD_LIMIT_MS} ms)`,
      );
      console.log(
        `[performance] First card sample ${iteration} details: ready ${measurement.readyMs?.toFixed(1)} ms, maximum frame gap ${measurement.maxFrameGapMs.toFixed(1)} ms`,
      );
      for (const [index, sample] of samples.slice(iteration * 2).entries()) {
        console.log(
          `[performance] ${index === 0 ? "Search" : "Next page"} sample ${iteration}: ${sample.duration.toFixed(1)} ms (limit ${NETWORK_LIMIT_MS} ms)`,
        );
      }
    }
  }
  expect(samples).toHaveLength(ITERATIONS * 2);
  expect(maxActive).toBe(1);
  expect(active).toBe(0);
  expect(firstCardSamples).toHaveLength(ITERATIONS);
  for (const [index, duration] of firstCardSamples.entries()) {
    expect(duration, `First card sample ${index}`).toBeGreaterThanOrEqual(0);
    expect(duration, `First card sample ${index}`).toBeLessThanOrEqual(
      FIRST_CARD_LIMIT_MS,
    );
  }
  for (const [index, sample] of samples.entries()) {
    expect(sample.body).toEqual({ foodObjectId: 1, pageIndex: index % 2 });
    expect(sample.status).toBe(200);
    expect(sample.duration, `HTTP sample ${index}`).toBeGreaterThanOrEqual(0);
    expect(sample.duration, `HTTP sample ${index}`).toBeLessThanOrEqual(
      NETWORK_LIMIT_MS,
    );
  }
});
