import { expect, test, type Page } from "@playwright/test";
import type { SubstituteSearchRequest } from "../src/client/types.gen";

const OPTION_COUNT = 5;

const COPY = {
  en: {
    search: "Search",
    listbox: "Suggestions",
    selectedFood: "Selected food",
    languageControl: "Interface language",
  },
  pl: {
    search: "Szukaj",
    listbox: "Podpowiedzi",
    selectedFood: "Wybrany produkt",
    languageControl: "Język interfejsu",
  },
} as const;

const SEEDED_SUGGESTIONS = {
  en: {
    chicken: [
      { foodObjectId: 5, name: "Chicken breast" },
      { foodObjectId: 22, name: "Fried chicken wings" },
      { foodObjectId: 17, name: "Polish chicken soup" },
      { foodObjectId: 10, name: "Milk" },
      { foodObjectId: 26, name: "Pancakes" },
    ],
    margherita: [
      { foodObjectId: 1, name: "Pizza Margherita" },
      { foodObjectId: 29, name: "Paella" },
      { foodObjectId: 18, name: "Butter" },
      { foodObjectId: 13, name: "Gyoza" },
      { foodObjectId: 16, name: "Gyros" },
    ],
    "chicken breast": [
      { foodObjectId: 5, name: "Chicken breast" },
      { foodObjectId: 23, name: "Turkey breast" },
      { foodObjectId: 7, name: "Beef steak" },
      { foodObjectId: 36, name: "Cheesecake" },
      { foodObjectId: 15, name: "Kebab" },
    ],
  },
  pl: {
    mleko: [
      { foodObjectId: 10, name: "Mleko" },
      { foodObjectId: 18, name: "Masło" },
      { foodObjectId: 27, name: "Omlet" },
      { foodObjectId: 38, name: "Gulasz" },
      { foodObjectId: 16, name: "Gyros" },
    ],
  },
} as const;

const SEEDED_DEFAULTS = {
  1: { value: 1, unit: "serving" },
  17: { value: 1, unit: "serving" },
  5: { value: 100, unit: "g" },
  10: { value: 100, unit: "ml" },
  18: { value: 100, unit: "g" },
} as const;

function optionId(foodObjectId: number): string {
  return `food-suggestion-option-${foodObjectId}`;
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

interface SubstitutePost {
  body: SubstituteSearchRequest;

  status: number | null;
}

function trackSubstitutePosts(page: Page): SubstitutePost[] {
  const posts: SubstitutePost[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/v1/substitutes/search")
    ) {
      posts.push({
        // SAFETY: The request payload matches the generated API contract.
        body: request.postDataJSON() as SubstituteSearchRequest,
        status: null,
      });
    }
  });
  page.on("response", (response) => {
    const request = response.request();
    if (
      request.method() === "POST" &&
      request.url().includes("/api/v1/substitutes/search")
    ) {
      const post = posts.find((entry) => entry.status === null);
      if (post !== undefined) {
        post.status = response.status();
      }
    }
  });
  return posts;
}

function trackSuggestionDefaults(
  page: Page,
): Map<number, { value: number; unit: string }> {
  const defaults = new Map<number, { value: number; unit: string }>();
  page.on("response", (response) => {
    if (response.url().includes("/api/v1/food-suggestions")) {
      void response.json().then(
        (body: {
          items: Array<{
            foodObjectId: number;
            defaultQuantity: { value: number; unit: string };
          }>;
        }) => {
          for (const item of body.items) {
            defaults.set(item.foodObjectId, item.defaultQuantity);
          }
        },
      );
    }
  });
  return defaults;
}

async function expectSuggestionPanel(
  page: Page,
  expected: readonly { foodObjectId: number; name: string }[],
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  const search = page.getByRole("combobox", { name: copy.search });
  const panel = page.getByRole("listbox", { name: copy.listbox });
  const options = panel.getByRole("option");

  await expect(panel).toBeVisible();
  await expect(options).toHaveCount(OPTION_COUNT);
  for (let index = 0; index < OPTION_COUNT; index += 1) {
    await expect(options.nth(index)).toHaveText(expected[index].name);
    await expect(options.nth(index)).toHaveAttribute(
      "id",
      optionId(expected[index].foodObjectId),
    );
  }
  await expect(search).toHaveAttribute(
    "aria-activedescendant",
    optionId(expected[0].foodObjectId),
  );
  await expect(search).toHaveAttribute("aria-expanded", "true");
}

function selectedInput(page: Page) {
  return page.locator("[data-selected-input]");
}

async function expectSelectedInput(
  page: Page,
  copy: (typeof COPY)[keyof typeof COPY],
  value: string,
): Promise<void> {
  await expect(selectedInput(page)).toContainText(copy.selectedFood);
  await expect(selectedInput(page)).toContainText(value);
}

async function expectSubstitutePost(
  posts: SubstitutePost[],
  foodObjectId: number,
  expectedQuantity: { value: number; unit: string },
  observedDefaults: Map<number, { value: number; unit: string }>,
): Promise<void> {
  expect(posts, "exactly one Substitution Search POST").toHaveLength(1);
  const post = posts[0];
  expect(post.body).toEqual({
    foodObjectId,
    quantity: expectedQuantity,
    pageIndex: 0,
  });

  await expect
    .poll(() => observedDefaults.get(foodObjectId))
    .toEqual(expectedQuantity);

  await expect.poll(() => posts[0]?.status ?? null).toBe(200);
}

test.describe("pointer substitution search", () => {
  test("pointer selection of the third option sends exactly one page-0 Substitution Search with the unchanged default quantity, and the successful page and selected-input region identify the same Food Object", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const posts = trackSubstitutePosts(page);
    const observedDefaults = trackSuggestionDefaults(page);

    await page.goto("/");
    const search = page.getByRole("combobox", { name: COPY.en.search });

    await search.fill("chicken");
    await expectSuggestionPanel(page, SEEDED_SUGGESTIONS.en.chicken, COPY.en);
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "empty",
    );

    const options = page
      .getByRole("listbox", { name: COPY.en.listbox })
      .getByRole("option");
    await expect(options.nth(2)).toHaveText("Polish chicken soup");
    await expect(options.nth(2)).toHaveAttribute("id", optionId(17));
    await options.nth(2).click();

    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(search).toHaveValue("Polish chicken soup");
    await expect(search).not.toHaveAttribute("aria-activedescendant");
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );

    await expectSubstitutePost(
      posts,
      17,
      SEEDED_DEFAULTS[17],
      observedDefaults,
    );

    await expectSelectedInput(page, COPY.en, "Polish chicken soup · 1 serving");

    await page.waitForTimeout(400);
    expect(
      posts.length,
      "no second submit action after the successful page",
    ).toBe(1);
  });

  test("a controlled response fetched from real Fiber and PostgreSQL stays pending without a spinner below Search; fulfillment moves focus to the localized results heading", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const posts = trackSubstitutePosts(page);

    let postCount = 0;
    const { promise: firstGate, resolve: releaseFirst } =
      Promise.withResolvers<void>();
    await page.route("**/api/v1/substitutes/search", async (route) => {
      postCount += 1;
      if (postCount === 1) {
        await firstGate;
      }
      await route.continue();
    });

    await page.goto("/");
    const search = page.getByRole("combobox", { name: COPY.en.search });

    await search.fill("chicken");
    await expectSuggestionPanel(page, SEEDED_SUGGESTIONS.en.chicken, COPY.en);
    await page
      .getByRole("listbox", { name: COPY.en.listbox })
      .getByRole("option")
      .nth(2)
      .click();

    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "loadingNew",
    );
    expect(posts).toHaveLength(1);

    await expect(page.locator("[data-new-search-spinner]")).toHaveCount(0);

    await expectSelectedInput(page, COPY.en, "Polish chicken soup · 1 serving");

    releaseFirst();
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    await expect(page.locator("[data-substitutions-heading]")).toBeFocused();
    await expect(page.locator("[data-selected-input]")).toContainText(
      "Polish chicken soup · 1 serving",
    );
    expect(posts).toHaveLength(1);
    await expect.poll(() => posts[0]?.status ?? null).toBe(200);
  });

  test("a network reconnect while results are visible does not start a second Substitution Search", async ({
    page,
    context,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const posts = trackSubstitutePosts(page);

    await page.goto("/");
    const search = page.getByRole("combobox", { name: COPY.en.search });
    await search.fill("chicken");
    await expectSuggestionPanel(page, SEEDED_SUGGESTIONS.en.chicken, COPY.en);
    await page
      .getByRole("listbox", { name: COPY.en.listbox })
      .getByRole("option")
      .nth(2)
      .click();
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    await expect.poll(() => posts[0]?.status ?? null).toBe(200);
    expect(posts).toHaveLength(1);

    await context.setOffline(true);
    await page.waitForTimeout(300);
    await context.setOffline(false);
    await page.waitForTimeout(600);
    expect(
      posts.length,
      "a reconnect must not start a second Substitution Search",
    ).toBe(1);
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );

    await expect(page.locator("[data-substitutions-heading]")).toBeFocused();
  });

  test("the Pizza Margherita flow sends 1 serving and updates its visible selected value when the language changes", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const posts = trackSubstitutePosts(page);
    const observedDefaults = trackSuggestionDefaults(page);

    await page.goto("/");
    const search = page.getByRole("combobox", { name: COPY.en.search });
    await search.fill("margherita");
    await expectSuggestionPanel(
      page,
      SEEDED_SUGGESTIONS.en.margherita,
      COPY.en,
    );

    await page.locator(`#${optionId(1)}`).click();
    await expectSubstitutePost(posts, 1, SEEDED_DEFAULTS[1], observedDefaults);
    await expectSelectedInput(page, COPY.en, "Pizza Margherita · 1 serving");

    await page
      .getByRole("combobox", { name: COPY.en.languageControl })
      .selectOption("pl");
    await expectSelectedInput(page, COPY.pl, "Pizza margherita · 1 porcja");
    await expect(selectedInput(page)).not.toContainText(
      "Pizza Margherita · 1 serving",
    );
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    expect(posts).toHaveLength(1);
  });

  test("the Chicken breast flow sends 100 g and shows the exact localized selected label and value", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const posts = trackSubstitutePosts(page);
    const observedDefaults = trackSuggestionDefaults(page);

    await page.goto("/");
    const search = page.getByRole("combobox", { name: COPY.en.search });
    await search.fill("chicken breast");
    await expectSuggestionPanel(
      page,
      SEEDED_SUGGESTIONS.en["chicken breast"],
      COPY.en,
    );

    await page.locator(`#${optionId(5)}`).click();
    await expectSubstitutePost(posts, 5, SEEDED_DEFAULTS[5], observedDefaults);
    await expectSelectedInput(page, COPY.en, "Chicken breast · 100 g");
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    expect(posts).toHaveLength(1);
  });

  test("the Milk flow sends 100 ml in Polish and updates its visible selected value in English", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const posts = trackSubstitutePosts(page);
    const observedDefaults = trackSuggestionDefaults(page);

    await page.goto("/");

    await page
      .getByRole("combobox", { name: COPY.en.languageControl })
      .selectOption("pl");
    const search = page.getByRole("combobox", { name: COPY.pl.search });
    await search.fill("mleko");
    await expectSuggestionPanel(page, SEEDED_SUGGESTIONS.pl.mleko, COPY.pl);

    await page.locator(`#${optionId(10)}`).click();
    await expectSubstitutePost(
      posts,
      10,
      SEEDED_DEFAULTS[10],
      observedDefaults,
    );
    await expectSelectedInput(page, COPY.pl, "Mleko · 100 ml");
    await expect(search).toHaveValue("Mleko");

    await page
      .getByRole("combobox", { name: COPY.pl.languageControl })
      .selectOption("en");
    await expectSelectedInput(page, COPY.en, "Milk · 100 ml");
    await expect(selectedInput(page)).not.toContainText("Mleko · 100 ml");
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    expect(posts).toHaveLength(1);
    await expect.poll(() => posts[0]?.status ?? null).toBe(200);
  });
});
