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
      posts.push({
        body,
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
  test("one completed initial Substitute POST provides the calculation basis; a Serving commit reprojects it locally with zero additional POSTs in English and Polish", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const posts = trackSubstitutePosts(page);

    await page.goto("/");
    await selectFoodSuggestion(page, "margherita", 1, COPY.en);

    await expect.poll(() => posts[0]?.response).toBeTruthy();
    await expect.poll(() => posts[0]?.status).toBe(200);
    expect(posts).toHaveLength(1);

    const firstPost = posts[0];
    if (firstPost?.response === null || firstPost?.response === undefined) {
      throw new Error("Initial Substitute Search response was not captured");
    }

    expect(firstPost.body).toEqual({
      foodObjectId: 1,
      pageIndex: 0,
    });
    expect(Object.keys(firstPost.body).sort()).toEqual([
      "foodObjectId",
      "pageIndex",
    ]);

    const response = firstPost.response;
    expect(response.pageIndex).toBe(0);
    expect(response.totalEligibleCount).toBe(36);
    expect(response.hasMore).toBe(true);
    expect(response.selectedFood).toMatchObject({
      foodObjectId: 1,
      baseUnit: "g",
      serving: 350,
    });
    expect(response.items.map((item) => item.foodObjectId)).toEqual([
      13, 29, 26,
    ]);

    const initialProjection = projectSubstitutePage(
      response.selectedFood,
      response.items,
      { value: 1, unit: "serving" },
    );
    expect(initialProjection.inputCalories).toBe(875);
    expect(
      initialProjection.items.map((item) => item.matchedQuantity.value),
    ).toEqual([438, 557, 431]);
    await expectSummaryProjection(page, initialProjection, "en");
    await expect(
      page.locator("[data-selected-food-summary]"),
    ).not.toContainText("350 g");

    const cards = page.locator("[data-result-card]");
    await expect(cards).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      await expectCardProjection(
        cards.nth(index),
        initialProjection.items[index],
        COPY.en,
        "en",
      );
    }

    const initialPostCount = posts.length;
    const numberField = page.locator("[data-quantity-number]");
    await numberField.fill("2");
    await numberField.press("Enter");

    await expect(numberField).toBeFocused();
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    expect(
      posts,
      "a local Serving commit starts no additional Substitute Search POST",
    ).toHaveLength(initialPostCount);
    await expect(page.locator("[data-card-spinner]")).toHaveCount(0);
    await expect(page.locator("[data-retry-message]")).toHaveCount(0);
    await expect(page.locator("[data-more-button]")).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );

    const servingProjection = projectSubstitutePage(
      response.selectedFood,
      response.items,
      { value: 2, unit: "serving" },
    );
    expect(servingProjection.inputCalories).toBe(1750);
    await expectSummaryProjection(page, servingProjection, "en");
    for (let index = 0; index < 3; index += 1) {
      await expectCardProjection(
        cards.nth(index),
        servingProjection.items[index],
        COPY.en,
        "en",
      );
    }

    await page
      .getByRole("combobox", { name: COPY.en.languageControl })
      .selectOption("pl");

    await expect(page.locator("[data-substitutions-heading]")).toHaveText(
      COPY.pl.foundSubstitutions,
    );
    expect(
      posts,
      "an Interface Language change and prior local Serving commit use the existing calculation basis",
    ).toHaveLength(initialPostCount);
    await expectSummaryProjection(page, servingProjection, "pl");
    for (let index = 0; index < 3; index += 1) {
      await expectCardProjection(
        cards.nth(index),
        servingProjection.items[index],
        COPY.pl,
        "pl",
      );
    }
  });

  test("one completed initial liquid Substitute POST provides the calculation basis; a millilitre commit reprojects it locally with zero additional POSTs", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["pl-PL"]);
    const posts = trackSubstitutePosts(page);

    await page.goto("/");
    await selectFoodSuggestion(page, "mleko", 10, COPY.pl);

    await expect.poll(() => posts[0]?.response).toBeTruthy();
    await expect.poll(() => posts[0]?.status).toBe(200);
    expect(posts).toHaveLength(1);

    const firstPost = posts[0];
    if (firstPost?.response === null || firstPost?.response === undefined) {
      throw new Error(
        "Initial milk Substitute Search response was not captured",
      );
    }
    expect(firstPost.body).toEqual({
      foodObjectId: 10,
      pageIndex: 0,
    });

    const response = firstPost.response;
    expect(response.selectedFood).toMatchObject({
      foodObjectId: 10,
      baseUnit: "ml",
    });
    const initialProjection = projectSubstitutePage(
      response.selectedFood,
      response.items,
      { value: 100, unit: "ml" },
    );
    await expectSummaryProjection(page, initialProjection, "pl");

    const cards = page.locator("[data-result-card]");
    await expect(cards).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      await expectCardProjection(
        cards.nth(index),
        initialProjection.items[index],
        COPY.pl,
        "pl",
      );
    }

    const initialPostCount = posts.length;
    const numberField = page.locator("[data-quantity-number]");
    await numberField.fill("250");
    await numberField.press("Enter");

    await expect(numberField).toBeFocused();
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    expect(
      posts,
      "a local millilitre commit starts no additional Substitute Search POST",
    ).toHaveLength(initialPostCount);

    const millilitreProjection = projectSubstitutePage(
      response.selectedFood,
      response.items,
      { value: 250, unit: "ml" },
    );
    await expectSummaryProjection(page, millilitreProjection, "pl");
    for (let index = 0; index < 3; index += 1) {
      await expectCardProjection(
        cards.nth(index),
        millilitreProjection.items[index],
        COPY.pl,
        "pl",
      );
    }
  });
});
