import { expect, test } from "@playwright/test";
import type {
  FoodSuggestionsResponse,
  GetFoodSuggestionsErrors,
  GetFoodSuggestionsResponses,
} from "../src/client/types.gen";

const PREVIEW_ORIGIN = "http://127.0.0.1:4173";
const FIBER_ORIGIN = "http://127.0.0.1:8080";

test.describe("real-stack smoke", () => {
  test("the generated client, executed in Chromium, receives the five-item seeded response through the preview /api proxy", async ({
    page,
  }) => {
    const bundlePath = process.env.OBIAD_E2E_BROWSER_CLIENT_BUNDLE;
    if (bundlePath === undefined || bundlePath === "") {
      throw new Error(
        "run through `bun run test:e2e` so the launcher builds the browser client bundle",
      );
    }

    const requestUrls: string[] = [];
    page.on("request", (request) => requestUrls.push(request.url()));

    await page.goto("/");
    await page.addScriptTag({ path: bundlePath });

    const suggestions = await page.evaluate(
      async (): Promise<FoodSuggestionsResponse> => {
        const generatedClient = globalThis.__obiadGeneratedClient;
        if (!generatedClient) {
          throw new Error(
            "browser client bundle did not register __obiadGeneratedClient",
          );
        }
        generatedClient.setConfig({ baseUrl: window.location.origin });
        return generatedClient.get<
          GetFoodSuggestionsResponses,
          GetFoodSuggestionsErrors,
          true,
          "data"
        >({
          url: "/api/v1/food-suggestions",
          query: { query: "chicken", language: "en" },
          throwOnError: true,
          responseStyle: "data",
        });
      },
    );

    expect(suggestions.items).toHaveLength(5);
    for (const item of suggestions.items) {
      expect(item.foodObjectId).toBeGreaterThanOrEqual(1);
      expect(item.names.en.length).toBeGreaterThan(0);
      expect(item.names.pl.length).toBeGreaterThan(0);
      expect(["g", "ml", "serving"]).toContain(item.defaultQuantity.unit);
    }

    expect(suggestions.items.map((item) => item.foodObjectId)).toEqual([
      5, 22, 17, 10, 26,
    ]);
    expect(suggestions.items[0].defaultQuantity).toEqual({
      value: 100,
      unit: "g",
    });

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
