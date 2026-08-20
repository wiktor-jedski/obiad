import { expect, test } from "@playwright/test";
import type { FoodSuggestionsResponse } from "../src/client/types.gen";

/**
 * Real-stack smoke scenario (task 22; ARCH-008, ARCH-016, ARCH-022).
 *
 * `bun run test:e2e` runs these tests against the complete disposable stack
 * started by `./e2e/launcher.ts`: disposable PostgreSQL 17 seeded by the
 * real setup command, the real Fiber process on the fixed loopback listener
 * 127.0.0.1:8080, and the optimized Vite preview on the strict port 4173.
 * The launcher bundles `./browser-client-entry.ts` (the generated TypeScript
 * client) with `bun build --format iife` and passes its path through
 * `OBIAD_E2E_BROWSER_CLIENT_BUNDLE`, so the smoke test executes the
 * generated client inside Chromium. Every request the generated client
 * makes crosses the same-origin `/api` proxy and never talks to Fiber
 * directly; the tests assert that every browser request — including the
 * generated-client call — stays on the preview origin.
 */

const PREVIEW_ORIGIN = "http://127.0.0.1:4173";
const FIBER_ORIGIN = "http://127.0.0.1:8080";

/** The minimal generated-client surface the scenario drives in the browser. */
interface GeneratedClient {
  setConfig: (config: { baseUrl: string }) => void;
  get: <T>(options: {
    url: string;
    query: Record<string, unknown>;
    throwOnError: true;
    responseStyle: "data";
  }) => Promise<T>;
}

test.describe("real-stack smoke", () => {
  test("the generated client, executed in Chromium, receives the five-item seeded response through the preview /api proxy", async ({
    page,
  }) => {
    const bundlePath = process.env.OBIAD_E2E_BROWSER_CLIENT_BUNDLE;
    expect(
      bundlePath,
      "run through `bun run test:e2e` so the launcher builds the browser client bundle",
    ).toBeTruthy();

    // Capture every request the browser makes, including the generated-client call.
    const requestUrls: string[] = [];
    page.on("request", (request) => requestUrls.push(request.url()));

    await page.goto("/");
    await page.addScriptTag({ path: bundlePath as string });

    const suggestions = await page.evaluate(
      async (): Promise<FoodSuggestionsResponse> => {
        const generatedClient = (
          globalThis as { __obiadGeneratedClient?: GeneratedClient }
        ).__obiadGeneratedClient;
        if (!generatedClient) {
          throw new Error(
            "browser client bundle did not register __obiadGeneratedClient",
          );
        }
        generatedClient.setConfig({ baseUrl: window.location.origin });
        return generatedClient.get<FoodSuggestionsResponse>({
          url: "/api/v1/food-suggestions",
          query: { query: "chicken", language: "en" },
          throwOnError: true,
          responseStyle: "data",
        });
      },
    );

    // ARCH-004: exactly five distinct suggestions for any nonempty query.
    expect(suggestions.items).toHaveLength(5);
    for (const item of suggestions.items) {
      expect(item.foodObjectId).toBeGreaterThanOrEqual(1);
      expect(item.names.en.length).toBeGreaterThan(0);
      expect(item.names.pl.length).toBeGreaterThan(0);
      expect(["g", "ml", "serving"]).toContain(item.defaultQuantity.unit);
    }

    // The deterministic seeded catalog ranks these five Food Objects first
    // for the English query "chicken" (verified against the real Fiber
    // process): Milk (10), Pancakes (26), Butter (18), Cheesecake (36), and
    // Pho (30). Milk is a liquid without a Serving, so its derived default
    // quantity is 100 ml (ARCH-004).
    expect(suggestions.items.map((item) => item.foodObjectId)).toEqual([
      10, 26, 18, 36, 30,
    ]);
    expect(suggestions.items[0].defaultQuantity).toEqual({
      value: 100,
      unit: "ml",
    });

    // The generated-client request ran in the browser and crossed the
    // preview origin's `/api` proxy. Every observed browser request stays on
    // the preview origin; none reaches the Fiber listener or a third-party
    // host (ARCH-016).
    expect(
      requestUrls.some((url) => url.includes("/api/v1/food-suggestions")),
    ).toBe(true);
    for (const url of requestUrls) {
      expect(new URL(url).origin, `unexpected request origin ${url}`).toBe(
        PREVIEW_ORIGIN,
      );
    }
    expect(requestUrls.some((url) => url.startsWith(FIBER_ORIGIN))).toBe(false);
  });

  test("the empty shell makes no startup API request and only contacts its own origin", async ({
    page,
  }) => {
    const requestUrls: string[] = [];
    page.on("request", (request) => requestUrls.push(request.url()));

    await page.goto("/");
    await expect(page).toHaveTitle("Obiad");

    // The shell loads through the preview origin only, and the empty state
    // performs no startup request (task 21: no query runs at mount).
    expect(requestUrls.length).toBeGreaterThan(0);
    expect(requestUrls.some((url) => url.includes("/api/"))).toBe(false);
    for (const url of requestUrls) {
      expect(new URL(url).origin, `unexpected request origin ${url}`).toBe(
        PREVIEW_ORIGIN,
      );
    }
    expect(requestUrls.some((url) => url.startsWith(FIBER_ORIGIN))).toBe(false);
  });
});
