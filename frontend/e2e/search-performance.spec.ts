import { expect, test, type Request } from "@playwright/test";
import { isLandingDialogueRequest } from "./request-purpose";
import type { SubstituteSearchRequest } from "../src/client/types.gen";

const ITERATIONS = 20;
const NETWORK_LIMIT_MS = 500;

test("20 searches and 20 next-page requests complete within the network budget, independently of reveal and spinner delays", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "languages", { get: () => ["en-US"] });
  });
  const samples: {
    body: SubstituteSearchRequest;
    duration: number;
    status: number;
  }[] = [];
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
    }
  }
  expect(samples).toHaveLength(ITERATIONS * 2);
  expect(maxActive).toBe(1);
  expect(active).toBe(0);
  for (const [index, sample] of samples.entries()) {
    expect(sample.body).toEqual({ foodObjectId: 1, pageIndex: index % 2 });
    expect(sample.status).toBe(200);
    expect(sample.duration, `HTTP sample ${index}`).toBeGreaterThanOrEqual(0);
    expect(sample.duration, `HTTP sample ${index}`).toBeLessThanOrEqual(
      NETWORK_LIMIT_MS,
    );
  }
});
