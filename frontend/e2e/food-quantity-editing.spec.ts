import { expect, test, type Page } from "@playwright/test";
import type {
  SubstituteSearchRequest,
  SubstituteSearchResponse,
} from "../src/client/types.gen";
import { projectSubstitutePage } from "../src/lib/substituteProjection";

const COPY = {
  en: {
    search: "Search",
    listbox: "Suggestions",
    quantity: "Quantity",
    unit: "Unit",
    servings: "servings",
    protein: "Protein",
    invalidQuantity: "Enter a valid quantity.",
    loadingNutritionValues: "Loading nutrition values",
    updatingQuantities: "Updating quantities",
  },
  pl: {
    search: "Szukaj",
    listbox: "Podpowiedzi",
    quantity: "Ilość",
    unit: "Jednostka",
    servings: "porcje",
    protein: "Białko",
    invalidQuantity: "Wpisz prawidłową ilość.",
    loadingNutritionValues: "Ładowanie wartości odżywczych",
    updatingQuantities: "Aktualizowanie ilości",
  },
} as const;

interface SubstitutePost {
  body: SubstituteSearchRequest;

  status: number | null;

  response: SubstituteSearchResponse | null;
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

async function selectFoodObject(
  page: Page,
  query: string,
  foodObjectId: number,
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  const search = page.getByRole("combobox", { name: copy.search });
  await search.fill(query);
  const panel = page.getByRole("listbox", { name: copy.listbox });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("option")).toHaveCount(5);
  await page.locator(`#food-suggestion-option-${foodObjectId}`).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator("main")).toHaveAttribute(
    "data-interaction-state",
    "results",
  );
}

async function selectFoodObjectPending(
  page: Page,
  query: string,
  foodObjectId: number,
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  const search = page.getByRole("combobox", { name: copy.search });
  await search.fill(query);
  const panel = page.getByRole("listbox", { name: copy.listbox });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("option")).toHaveCount(5);
  await page.locator(`#food-suggestion-option-${foodObjectId}`).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator("main")).toHaveAttribute(
    "data-interaction-state",
    "loadingNew",
  );
}

function summary(page: Page) {
  return page.locator("[data-selected-food-summary]");
}
function numberInput(page: Page) {
  return page.locator("[data-quantity-number]");
}
function unitSelect(page: Page) {
  return page.locator("[data-quantity-unit]");
}
function staticUnit(page: Page) {
  return page.locator("[data-quantity-static-unit]");
}
function editorStatus(page: Page) {
  return page.locator("[data-editor-status]");
}
function quantityError(page: Page) {
  return page.locator("[data-quantity-error]");
}

async function commitWithEnter(
  input: import("@playwright/test").Locator,
): Promise<void> {
  await input.press("Enter");
}

async function commitWithBlur(page: Page): Promise<void> {
  await page.locator("[data-input-macronutrients]").click();
}

function formatMacronutrient(value: number, locale: "en" | "pl"): string {
  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)} g`;
}

function expectProportional(
  actual: number,
  original: number,
  factor: number,
  tolerance: number,
  what: string,
): void {
  expect(
    Math.abs(actual - factor * original),
    `${what} must be ${factor}x the first response within the display rounding tolerance`,
  ).toBeLessThanOrEqual(tolerance);
}

test.describe("food quantity editing", () => {
  test("the four seeded input kinds render one centered spinner over the hidden disabled initial summary with the localized loading status, then the default-first selector order, plural serving labels, and static single base units", async ({
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

    await selectFoodObjectPending(page, "margherita", 1, COPY.en);

    const input = numberInput(page);
    const select = unitSelect(page);
    const selectedContent = summary(page).locator("[data-card-content]");
    const selectedSpinner = summary(page).locator("[data-card-spinner]");
    await expect(selectedContent).toHaveCSS("opacity", "0");
    await expect(input).toBeDisabled();
    await expect(input).toHaveValue("1");
    await expect(select).toBeDisabled();
    await expect(selectedSpinner).toHaveCount(1);
    await expect(page.locator("[data-value-spinner]")).toHaveCount(0);
    const spinnerSize = await selectedSpinner.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        width: Number.parseFloat(style.width),
        height: Number.parseFloat(style.height),
        ariaHidden: element.getAttribute("aria-hidden"),
      };
    });
    expect(spinnerSize).toEqual({ width: 16, height: 16, ariaHidden: "true" });
    await expect(summary(page)).toHaveAttribute("aria-busy", "true");
    await expect(editorStatus(page)).toHaveText(COPY.en.loadingNutritionValues);

    releaseFirst();
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    await expect(selectedContent).toHaveCSS("opacity", "1");
    await expect(selectedSpinner).toHaveCount(0);
    await expect(input).toBeEnabled();
    await expect(select).toBeEnabled();
    await expect(input).toHaveValue("1");
    await expect(select).toHaveValue("serving");
    await expect(select.locator("option")).toHaveText([COPY.en.servings, "g"]);
    await expect(summary(page)).not.toHaveAttribute("aria-busy", "true");
    await expect(editorStatus(page)).toHaveText("");
    expect(posts).toHaveLength(1);

    await selectFoodObject(page, "pho", 30, COPY.en);
    await expect(summary(page)).toContainText("Pho");
    await expect(numberInput(page)).toHaveValue("1");
    await expect(unitSelect(page)).toHaveValue("serving");
    await expect(unitSelect(page).locator("option")).toHaveText([
      COPY.en.servings,
      "ml",
    ]);

    await selectFoodObject(page, "chicken breast", 5, COPY.en);
    await expect(summary(page)).toContainText("Chicken breast");
    await expect(numberInput(page)).toHaveValue("100");
    await expect(unitSelect(page)).toHaveCount(0);
    await expect(staticUnit(page)).toHaveText("g");
    await expect(page.getByRole("group", { name: COPY.en.unit })).toContainText(
      "g",
    );

    await selectFoodObject(page, "milk", 10, COPY.en);
    await expect(summary(page)).toContainText("Milk");
    await expect(numberInput(page)).toHaveValue("100");
    await expect(unitSelect(page)).toHaveCount(0);
    await expect(staticUnit(page)).toHaveText("ml");
    await expect(page.getByRole("group", { name: COPY.en.unit })).toContainText(
      "ml",
    );
  });

  test("a changed valid commit sends exactly one request with the selected Food Object ID, the selected unit, the committed number, and page 0; the response and rendered summary and cards show proportional values with unchanged IDs, order, similarity, and page", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const posts = trackSubstitutePosts(page);

    await page.goto("/");
    await selectFoodObject(page, "margherita", 1, COPY.en);

    await expect.poll(() => posts[0]?.response).toBeTruthy();
    const first = posts[0]?.response;
    if (first === null || first === undefined) {
      throw new Error("Initial substitute-search response was not captured");
    }
    expect(first.pageIndex).toBe(0);
    expect(first.items.map((item) => item.foodObjectId)).toEqual([13, 29, 26]);

    const firstProjection = projectSubstitutePage(
      first.selectedFood,
      first.items,
      { value: 1, unit: "serving" },
    );

    await expect(page.locator("[data-input-macro-protein]")).toHaveText(
      formatMacronutrient(firstProjection.inputMacronutrients.protein, "en"),
    );
    await expect(page.locator("[data-input-macro-carbohydrate]")).toHaveText(
      formatMacronutrient(
        firstProjection.inputMacronutrients.carbohydrate,
        "en",
      ),
    );
    await expect(page.locator("[data-input-macro-fat]")).toHaveText(
      formatMacronutrient(firstProjection.inputMacronutrients.fat, "en"),
    );
    await expect(page.locator("[data-input-calories]")).toHaveText(
      `${firstProjection.inputCalories} kcal`,
    );

    const input = numberInput(page);
    await input.fill("2");
    await commitWithEnter(input);
    await expect(input).toBeFocused();
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    expect(posts).toHaveLength(2);
    expect(posts[1]?.body).toEqual({
      foodObjectId: 1,
      pageIndex: 0,
    });

    await expect.poll(() => posts[1]?.response).toBeTruthy();
    const second = posts[1]?.response;
    if (second === null || second === undefined) {
      throw new Error(
        "Recalculated substitute-search response was not captured",
      );
    }
    expect(second.pageIndex).toBe(0);
    expect(second.items.map((item) => item.foodObjectId)).toEqual([13, 29, 26]);
    const secondProjection = projectSubstitutePage(
      second.selectedFood,
      second.items,
      { value: 2, unit: "serving" },
    );
    for (let index = 0; index < first.items.length; index += 1) {
      expectProportional(
        secondProjection.items[index].matchedQuantity.value,
        firstProjection.items[index].matchedQuantity.value,
        2,
        1,
        `rank ${index + 1} Matched Quantity`,
      );
      expectProportional(
        secondProjection.items[index].macronutrients.protein,
        firstProjection.items[index].macronutrients.protein,
        2,
        0.1,
        `rank ${index + 1} protein`,
      );
      expectProportional(
        secondProjection.items[index].macronutrients.carbohydrate,
        firstProjection.items[index].macronutrients.carbohydrate,
        2,
        0.1,
        `rank ${index + 1} carbohydrate`,
      );
      expectProportional(
        secondProjection.items[index].macronutrients.fat,
        firstProjection.items[index].macronutrients.fat,
        2,
        0.1,
        `rank ${index + 1} fat`,
      );
      expect(secondProjection.items[index].similarityPercent).toBe(
        firstProjection.items[index].similarityPercent,
      );
    }
    expectProportional(
      secondProjection.inputMacronutrients.protein,
      firstProjection.inputMacronutrients.protein,
      2,
      0.1,
      "input protein",
    );
    expectProportional(
      secondProjection.inputMacronutrients.carbohydrate,
      firstProjection.inputMacronutrients.carbohydrate,
      2,
      0.1,
      "input carbohydrate",
    );
    expectProportional(
      secondProjection.inputMacronutrients.fat,
      firstProjection.inputMacronutrients.fat,
      2,
      0.1,
      "input fat",
    );
    expectProportional(
      secondProjection.inputCalories,
      firstProjection.inputCalories,
      2,
      1,
      "input calories",
    );
    await expect(page.locator("[data-input-calories]")).toHaveText(
      `${secondProjection.inputCalories} kcal`,
    );

    await expect(page.locator("[data-input-macro-protein]")).toHaveText(
      formatMacronutrient(secondProjection.inputMacronutrients.protein, "en"),
    );
    await expect(page.locator("[data-input-macro-carbohydrate]")).toHaveText(
      formatMacronutrient(
        secondProjection.inputMacronutrients.carbohydrate,
        "en",
      ),
    );
    await expect(page.locator("[data-input-macro-fat]")).toHaveText(
      formatMacronutrient(secondProjection.inputMacronutrients.fat, "en"),
    );
    const cardNames = await page
      .locator("[data-result-card] h3")
      .allTextContents();
    expect(cardNames).toEqual(second.items.map((item) => item.names.en));
    await expect.poll(() => posts[1]?.status ?? null).toBe(200);
  });

  test("a unit selection replaces the draft with 1 or 100 and commits immediately; the selector reorders current-first; an over-limit value is silently clamped to the whole maximum, and no request starts when the resolved value equals the committed value", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const posts = trackSubstitutePosts(page);

    await page.goto("/");
    await selectFoodObject(page, "margherita", 1, COPY.en);

    const input = numberInput(page);
    const select = unitSelect(page);
    await select.selectOption("g");
    await expect(input).toHaveValue("100");
    await expect(select).toHaveValue("g");
    await expect(select.locator("option")).toHaveText(["g", COPY.en.servings]);
    expect(posts).toHaveLength(2);
    expect(posts[1]?.body).toEqual({
      foodObjectId: 1,
      pageIndex: 0,
    });

    await select.selectOption("serving");
    await expect(input).toHaveValue("1");
    await expect(select).toHaveValue("serving");
    await expect(select.locator("option")).toHaveText([COPY.en.servings, "g"]);
    expect(posts).toHaveLength(3);
    expect(posts[2]?.body).toEqual({
      foodObjectId: 1,
      pageIndex: 0,
    });

    await input.fill("300");
    await commitWithEnter(input);
    await expect(input).toHaveValue("285");
    await expect(quantityError(page)).toHaveCount(0);
    expect(posts).toHaveLength(4);
    expect(posts[3]?.body).toEqual({
      foodObjectId: 1,
      pageIndex: 0,
    });

    await input.fill("400");
    await commitWithEnter(input);
    await commitWithBlur(page);
    expect(
      posts,
      "a clamp to the committed maximum starts no request",
    ).toHaveLength(4);
    await input.fill("285");
    await commitWithEnter(input);
    expect(
      posts,
      "a directly entered value equal to the committed value starts no request",
    ).toHaveLength(4);
    await expect(input).toHaveValue("285");
    await expect(quantityError(page)).toHaveCount(0);
  });

  test("invalid drafts keep the exact raw text and natural focus, show the exact English or Polish polite message through aria-invalid, start no request, and clear when the draft becomes syntactically valid", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const posts = trackSubstitutePosts(page);

    await page.goto("/");
    await selectFoodObject(page, "margherita", 1, COPY.en);
    const input = numberInput(page);
    const postsAfterSelection = posts.length;

    const rejectedServingForms = [
      "0",
      "01",
      "0.5",
      ".5",
      "1.",
      "2,5",
      "-1",
      "1e3",
      "+1",
      " 1",
      "1 ",
      "",
      "abc",
      "1.2.3",
    ];

    for (const rejected of rejectedServingForms) {
      await input.fill(rejected);
      await commitWithEnter(input);

      await expect(
        input,
        `the raw draft ${JSON.stringify(rejected)} stays visible`,
      ).toHaveValue(rejected);
      await expect(input).toBeFocused();
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await expect(quantityError(page)).toHaveText(COPY.en.invalidQuantity);

      expect(
        posts.length,
        `the invalid draft ${JSON.stringify(rejected)} starts no request`,
      ).toBe(postsAfterSelection);
    }

    await input.fill("1");
    await expect(input).not.toHaveAttribute("aria-invalid");
    await expect(quantityError(page)).toHaveCount(0);
    await commitWithEnter(input);
    expect(posts).toHaveLength(postsAfterSelection);

    await unitSelect(page).selectOption("g");
    await input.fill("1.5");
    await commitWithEnter(input);
    await expect(input).toHaveValue("1.5");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(quantityError(page)).toHaveText(COPY.en.invalidQuantity);
    expect(posts).toHaveLength(postsAfterSelection + 1);

    await unitSelect(page).selectOption("serving");
    await input.fill("2.5");
    await commitWithEnter(input);
    await expect(input).not.toHaveAttribute("aria-invalid");
    await expect(quantityError(page)).toHaveCount(0);
    expect(posts).toHaveLength(postsAfterSelection + 3);
    expect(posts[posts.length - 1]?.body).toEqual({
      foodObjectId: 1,
      pageIndex: 0,
    });

    await page
      .getByRole("combobox", { name: "Interface language" })
      .selectOption("pl");
    const plSearch = page.getByRole("combobox", { name: COPY.pl.search });
    await plSearch.fill("mleko");
    const panel = page.getByRole("listbox", { name: COPY.pl.listbox });
    await expect(panel).toBeVisible();
    await page.locator("#food-suggestion-option-10").click();
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    await expect(staticUnit(page)).toHaveText("ml");
    await expect(page.getByRole("group", { name: COPY.pl.unit })).toContainText(
      "ml",
    );
    const plInput = numberInput(page);
    await plInput.fill("2,5");
    await commitWithEnter(plInput);
    await expect(plInput).toHaveValue("2,5");
    await expect(plInput).toHaveAttribute("aria-invalid", "true");
    await expect(quantityError(page)).toHaveText(COPY.pl.invalidQuantity);
    await expect(plInput).toBeFocused();
    await plInput.fill("100");
    await expect(quantityError(page)).toHaveCount(0);
    await commitWithEnter(plInput);
    expect(
      posts,
      "the unchanged Polish 100 ml draft starts no request",
    ).toHaveLength(postsAfterSelection + 4);

    await plSearch.fill("pizza margherita");
    await expect(panel).toBeVisible();
    await page.locator("#food-suggestion-option-1").click();
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    await expect(unitSelect(page)).toHaveValue("serving");
    await expect(unitSelect(page).locator("option")).toHaveText([
      COPY.pl.servings,
      "g",
    ]);
    expect(posts).toHaveLength(postsAfterSelection + 5);
  });

  test("a delayed valid recalculation keeps settled card sizes, exposes one localized busy status, hides each card's non-image content, and shows one centered aria-hidden 16px spinner per card while result images stay visible", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const posts = trackSubstitutePosts(page);

    let postCount = 0;
    const { promise: secondGate, resolve: releaseSecond } =
      Promise.withResolvers<void>();
    await page.route("**/api/v1/substitutes/search", async (route) => {
      postCount += 1;
      if (postCount === 2) {
        await secondGate;
      }
      await route.continue();
    });

    await page.goto("/");
    await selectFoodObject(page, "margherita", 1, COPY.en);
    await expect.poll(() => posts[0]?.response).toBeTruthy();
    const cards = page.locator("[data-result-card]");
    const selectedCard = summary(page);
    const settledSelectedCardSize = await selectedCard.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    });
    const settledCardSizes = await cards.evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      }),
    );

    const input = numberInput(page);
    await input.fill("2");
    await commitWithEnter(input);
    await expect(input).toBeDisabled();
    await expect(unitSelect(page)).toBeDisabled();

    const selectedSpinner = selectedCard.locator("[data-card-spinner]");
    await expect(selectedSpinner).toHaveCount(1);
    const resultSpinners = cards.locator("[data-card-spinner]");
    await expect(resultSpinners).toHaveCount(3);
    await expect(page.locator("[data-value-spinner]")).toHaveCount(0);
    const spinnerSize = await selectedSpinner.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        width: Number.parseFloat(style.width),
        height: Number.parseFloat(style.height),
        ariaHidden: element.getAttribute("aria-hidden"),
      };
    });
    expect(spinnerSize).toEqual({ width: 16, height: 16, ariaHidden: "true" });
    const pendingCardSizes = await cards.evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      }),
    );
    const pendingSelectedCardSize = await selectedCard.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    });
    expect(
      pendingSelectedCardSize,
      "the single spinner does not resize the settled selected-food card",
    ).toEqual(settledSelectedCardSize);
    expect(
      pendingCardSizes,
      "single spinners do not resize settled result cards",
    ).toEqual(settledCardSizes);
    await expect(page.locator("[data-selected-input-region]")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(page.locator("[data-result-region]")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(editorStatus(page)).toHaveText(COPY.en.updatingQuantities);

    const selectedContent = selectedCard.locator("[data-card-content]");
    await expect(selectedContent).toHaveCSS("opacity", "0");
    await expect(cards).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      await expect(cards.nth(index).locator("[data-card-content]")).toHaveCSS(
        "opacity",
        "0",
      );
      await expect(
        cards.nth(index).locator("[data-result-card-image]"),
      ).toBeVisible();
    }

    releaseSecond();
    await expect(selectedSpinner).toHaveCount(0);
    await expect(resultSpinners).toHaveCount(0);
    await expect(selectedContent).toHaveCSS("opacity", "1");
    for (let index = 0; index < 3; index += 1) {
      await expect(cards.nth(index).locator("[data-card-content]")).toHaveCSS(
        "opacity",
        "1",
      );
    }
    await expect.poll(() => posts[1]?.response).toBeTruthy();
    const second = posts[1]?.response;
    if (second === null || second === undefined) {
      throw new Error(
        "Recalculated substitute-search response was not captured",
      );
    }
    const secondProjection = projectSubstitutePage(
      second.selectedFood,
      second.items,
      { value: 2, unit: "serving" },
    );
    await expect(page.locator("[data-input-macro-protein]")).toHaveText(
      formatMacronutrient(secondProjection.inputMacronutrients.protein, "en"),
    );
    await expect(page.locator("[data-input-macro-carbohydrate]")).toHaveText(
      formatMacronutrient(
        secondProjection.inputMacronutrients.carbohydrate,
        "en",
      ),
    );
    await expect(page.locator("[data-input-macro-fat]")).toHaveText(
      formatMacronutrient(secondProjection.inputMacronutrients.fat, "en"),
    );
    await expect(page.locator("[data-input-calories]")).toHaveText(
      `${secondProjection.inputCalories} kcal`,
    );
    await expect(
      page.locator("[data-selected-input-region]"),
    ).not.toHaveAttribute("aria-busy", "true");
    await expect(editorStatus(page)).toHaveText("");
    expect(posts).toHaveLength(2);
    await expect.poll(() => posts[1]?.status ?? null).toBe(200);
  });
});
