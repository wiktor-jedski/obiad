import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  SubstituteSearchRequest,
  SubstituteSearchResponse,
} from "../src/client/types.gen";
import {
  projectSubstitutePage,
  type ProjectedSubstitutePage,
} from "../src/lib/substituteProjection";

const COPY = {
  en: {
    search: "Search",
    listbox: "Suggestions",
    languageControl: "Interface language",
    protein: "Protein",
    carbohydrates: "Carbohydrates",
    fat: "Fat",
    calories: "Calories",
    similarity: "Similarity",
    foundSubstitutions: "Found substitutions",
  },
  pl: {
    search: "Szukaj",
    listbox: "Podpowiedzi",
    languageControl: "Język interfejsu",
    protein: "Białko",
    carbohydrates: "Węglowodany",
    fat: "Tłuszcz",
    calories: "Kalorie",
    similarity: "Podobieństwo",
    foundSubstitutions: "Znalezione zamienniki",
  },
} as const;

interface SubstitutePostRecord {
  readonly body: SubstituteSearchRequest;
  readonly rawBody: { [key: string]: unknown };
  status: number | null;
  response: SubstituteSearchResponse | null;
}

function trackSubstitutePosts(page: Page): SubstitutePostRecord[] {
  const posts: SubstitutePostRecord[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/v1/substitutes/search")
    ) {
      // SAFETY: The request payload matches the generated API contract.
      const body = request.postDataJSON() as SubstituteSearchRequest;
      // SAFETY: The raw payload is a plain JSON object from postDataJSON.
      const rawBody = (request.postDataJSON() ?? {}) as {
        [key: string]: unknown;
      };
      posts.push({
        body,
        rawBody,
        status: null,
        response: null,
      });
    }
  });
  page.on("response", async (response) => {
    const request = response.request();
    if (
      request.method() === "POST" &&
      request.url().includes("/api/v1/substitutes/search")
    ) {
      const post = posts.find((entry) => entry.status === null);
      if (post !== undefined) {
        post.status = response.status();
        // SAFETY: The response body matches the generated API contract.
        post.response = (await response.json()) as SubstituteSearchResponse;
      }
    }
  });
  return posts;
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

async function selectFoodSuggestion(
  page: Page,
  query: string,
  foodObjectId: number,
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  const search = page.getByRole("combobox", { name: copy.search });
  await search.fill(query);
  const panel = page.getByRole("listbox", { name: copy.listbox });
  await expect(panel).toBeVisible();
  await page.locator(`#food-suggestion-option-${foodObjectId}`).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator("main")).toHaveAttribute(
    "data-interaction-state",
    "results",
  );
}

function formatMacronutrient(value: number, locale: "en" | "pl"): string {
  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)} g`;
}

async function expectSummaryProjection(
  page: Page,
  projection: ProjectedSubstitutePage,
  locale: "en" | "pl",
): Promise<void> {
  await expect(page.locator("[data-input-calories]")).toHaveText(
    `${projection.inputCalories} kcal`,
  );
  await expect(page.locator("[data-input-macro-protein]")).toHaveText(
    formatMacronutrient(projection.inputMacronutrients.protein, locale),
  );
  await expect(page.locator("[data-input-macro-carbohydrate]")).toHaveText(
    formatMacronutrient(projection.inputMacronutrients.carbohydrate, locale),
  );
  await expect(page.locator("[data-input-macro-fat]")).toHaveText(
    formatMacronutrient(projection.inputMacronutrients.fat, locale),
  );
}

async function expectCardProjection(
  card: Locator,
  item: ProjectedSubstitutePage["items"][number],
  copy: (typeof COPY)[keyof typeof COPY],
  locale: "en" | "pl",
): Promise<void> {
  await expect(card.locator("[data-result-card-matched-quantity]")).toHaveText(
    `${item.matchedQuantity.value} ${item.matchedQuantity.unit}`,
  );
  await expect(card.locator("[data-result-card-calories]")).toHaveText(
    `${item.calories} kcal`,
  );
  await expect(card).toContainText(copy.protein);
  await expect(card).toContainText(
    formatMacronutrient(item.macronutrients.protein, locale),
  );
  await expect(card).toContainText(copy.carbohydrates);
  await expect(card).toContainText(
    formatMacronutrient(item.macronutrients.carbohydrate, locale),
  );
  await expect(card).toContainText(copy.fat);
  await expect(card).toContainText(
    formatMacronutrient(item.macronutrients.fat, locale),
  );
  await expect(card).toContainText(copy.similarity);
  await expect(card).toContainText(`${item.similarityPercent}%`);
}

test.describe("quantity-independent Substitute API and local projection (P22-G3, P22-G5, REQ-037, REQ-038, REQ-078)", () => {
  test("committing two different valid quantities sends identical request bodies without quantity, returns identical calculation bases and rankings, and projects different calories, matched quantities, and macros in English and Polish", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const posts = trackSubstitutePosts(page);

    await page.goto("/");
    await selectFoodSuggestion(page, "margherita", 1, COPY.en);

    // Initial commit: 1 serving of Pizza Margherita (350 g)
    await expect.poll(() => posts[0]?.response).toBeTruthy();
    expect(posts).toHaveLength(1);

    const firstPost = posts[0];
    if (firstPost?.response === null || firstPost?.response === undefined) {
      throw new Error("First substitute search response was not captured");
    }

    // 1. Verify generated-client POST body contains only foodObjectId and pageIndex, no quantity
    expect(firstPost.body).toEqual({
      foodObjectId: 1,
      pageIndex: 0,
    });
    expect(firstPost.rawBody).not.toHaveProperty("quantity");
    expect(Object.keys(firstPost.rawBody).sort()).toEqual([
      "foodObjectId",
      "pageIndex",
    ]);

    const firstResp = firstPost.response;
    expect(firstResp.pageIndex).toBe(0);
    expect(firstResp.totalEligibleCount).toBeGreaterThan(0);
    expect(firstResp.selectedFood.foodObjectId).toBe(1);
    expect(firstResp.selectedFood.serving).toBe(350);
    expect(firstResp.items.map((i) => i.foodObjectId)).toEqual([13, 29, 26]);

    // 2. Verify initial browser projected display in English
    const firstProj = projectSubstitutePage(
      firstResp.selectedFood,
      firstResp.items,
      { value: 1, unit: "serving" },
    );
    await expectSummaryProjection(page, firstProj, "en");

    const cards = page.locator("[data-result-card]");
    await expect(cards).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      await expectCardProjection(
        cards.nth(index),
        firstProj.items[index],
        COPY.en,
        "en",
      );
    }

    // 3. Edit quantity to 2 servings and commit with Enter
    const numberField = page.locator("[data-quantity-number]");
    await numberField.fill("2");
    await numberField.press("Enter");

    await expect.poll(() => posts[1]?.response).toBeTruthy();
    expect(posts).toHaveLength(2);

    const secondPost = posts[1];
    if (secondPost?.response === null || secondPost?.response === undefined) {
      throw new Error("Second substitute search response was not captured");
    }

    // 4. Verify second POST body is identical to the first (same foodObjectId, same pageIndex, no quantity)
    expect(secondPost.body).toEqual({
      foodObjectId: 1,
      pageIndex: 0,
    });
    expect(secondPost.rawBody).not.toHaveProperty("quantity");
    expect(secondPost.body).toEqual(firstPost.body);

    const secondResp = secondPost.response;

    // 5. Verify backend responses are identical in selectedFood basis, candidate calculation bases, IDs, similarity, rank order, count, and page
    expect(secondResp.pageIndex).toBe(firstResp.pageIndex);
    expect(secondResp.totalEligibleCount).toBe(firstResp.totalEligibleCount);
    expect(secondResp.hasMore).toBe(firstResp.hasMore);
    expect(secondResp.selectedFood).toEqual(firstResp.selectedFood);
    expect(secondResp.items).toEqual(firstResp.items);

    // 6. Verify browser projected display updated for 2 servings (different calories, matched quantities, and scaled macronutrients)
    const secondProj = projectSubstitutePage(
      secondResp.selectedFood,
      secondResp.items,
      { value: 2, unit: "serving" },
    );
    expect(secondProj.inputCalories).toBe(firstProj.inputCalories * 2);
    expect(secondProj.inputMacronutrients.protein).toBe(
      firstProj.inputMacronutrients.protein * 2,
    );
    expect(secondProj.inputMacronutrients.carbohydrate).toBe(
      firstProj.inputMacronutrients.carbohydrate * 2,
    );
    expect(secondProj.inputMacronutrients.fat).toBe(
      firstProj.inputMacronutrients.fat * 2,
    );

    await expectSummaryProjection(page, secondProj, "en");

    for (let index = 0; index < 3; index += 1) {
      await expectCardProjection(
        cards.nth(index),
        secondProj.items[index],
        COPY.en,
        "en",
      );
    }

    // 7. Change interface language to Polish and verify localized projected values
    await page
      .getByRole("combobox", { name: COPY.en.languageControl })
      .selectOption("pl");

    await expect(page.locator("[data-substitutions-heading]")).toHaveText(
      COPY.pl.foundSubstitutions,
    );
    await expectSummaryProjection(page, secondProj, "pl");
    for (let index = 0; index < 3; index += 1) {
      await expectCardProjection(
        cards.nth(index),
        secondProj.items[index],
        COPY.pl,
        "pl",
      );
    }
  });

  test("liquid food object selection with two different millilitre quantities verifies identical quantity-free requests and projected ml values in Polish", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["pl-PL"]);
    const posts = trackSubstitutePosts(page);

    await page.goto("/");
    await selectFoodSuggestion(page, "mleko", 10, COPY.pl);

    await expect.poll(() => posts[0]?.response).toBeTruthy();
    expect(posts).toHaveLength(1);

    const firstPost = posts[0];
    if (firstPost?.response === null || firstPost?.response === undefined) {
      throw new Error("First milk search response was not captured");
    }
    expect(firstPost.body).toEqual({
      foodObjectId: 10,
      pageIndex: 0,
    });
    expect(firstPost.rawBody).not.toHaveProperty("quantity");

    const firstResp = firstPost.response;
    expect(firstResp.selectedFood.baseUnit).toBe("ml");

    // Initial commit: 100 ml
    const firstProj = projectSubstitutePage(
      firstResp.selectedFood,
      firstResp.items,
      { value: 100, unit: "ml" },
    );
    await expectSummaryProjection(page, firstProj, "pl");

    const cards = page.locator("[data-result-card]");
    await expect(cards).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      await expectCardProjection(
        cards.nth(index),
        firstProj.items[index],
        COPY.pl,
        "pl",
      );
    }

    // Change to 250 ml
    const numberField = page.locator("[data-quantity-number]");
    await numberField.fill("250");
    await numberField.press("Enter");

    await expect.poll(() => posts[1]?.response).toBeTruthy();
    expect(posts).toHaveLength(2);

    const secondPost = posts[1];
    if (secondPost?.response === null || secondPost?.response === undefined) {
      throw new Error("Second milk search response was not captured");
    }

    expect(secondPost.body).toEqual({
      foodObjectId: 10,
      pageIndex: 0,
    });
    expect(secondPost.rawBody).not.toHaveProperty("quantity");
    expect(secondPost.response?.selectedFood).toEqual(firstResp.selectedFood);
    expect(secondPost.response?.items).toEqual(firstResp.items);

    const secondProj = projectSubstitutePage(
      secondPost.response!.selectedFood,
      secondPost.response!.items,
      { value: 250, unit: "ml" },
    );
    await expectSummaryProjection(page, secondProj, "pl");
    for (let index = 0; index < 3; index += 1) {
      await expectCardProjection(
        cards.nth(index),
        secondProj.items[index],
        COPY.pl,
        "pl",
      );
    }
  });
});
