import { expect, test, type Page } from "@playwright/test";

/**
 * Real-stack ISSUE-010 quantity-editing scenario (task 34; ARCH-001,
 * ARCH-002, ARCH-003, ARCH-008, ARCH-011, ARCH-018, ARCH-019, ARCH-020,
 * ARCH-022, REQ-025, REQ-026, REQ-027, REQ-028; P10-G2 through P10-G8).
 *
 * `bun run test:e2e` runs these tests against the complete disposable stack
 * started by `./e2e/launcher.ts`: disposable PostgreSQL 17 seeded by the
 * real setup command, the real Fiber process on the fixed loopback listener
 * 127.0.0.1:8080, and the optimized Vite preview on the strict port 4173.
 * The scenario drives the production editable selected-food summary over
 * task 33's generated contract and observes:
 *
 *   - the complete disabled initial summary with one centered card spinner
 *     and the localized `Loading nutrition values` status for seeded
 *     solid-Serving, liquid-Serving, solid-base-only, and liquid-base-only
 *     inputs, then the enabled editor after the first result page loads
 *     (P10-G2, REQ-027, REQ-081);
 *   - the default-first and current-first two-unit selector orders, the
 *     plural `servings` / `porcje` Serving labels, and the static single
 *     base units of base-only inputs (P10-G2);
 *   - the ISSUE-010 grammar: positive base-unit integers and dot-decimal
 *     Serving counts are accepted (P10-G3, REQ-025) and fractional base
 *     values, comma decimals, zero, negatives, empty text, letters, and
 *     every other rejected form are refused with the exact raw text, the
 *     exact English or Polish polite message, natural focus, and zero
 *     requests until the draft becomes valid (P10-G4, P10-G5, REQ-026);
 *   - the `1` and `100` unit-reset commits, silent whole-maximum clamping
 *     with no clamp notice, and no request when the clamped or directly
 *     entered numeric value equals the committed value (P10-G3);
 *   - one delayed recalculation per changed commit — one request with the
 *     selected Food Object ID, selected unit, committed or clamped number,
 *     and unchanged current page — with one localized busy status, exactly
 *     one centered spinner per card, hidden non-image card content, visible
 *     result images, and unchanged card dimensions (P10-G7, REQ-028,
 *     REQ-081); and
 *   - the response page index and ordered Food Object IDs equal the first
 *     page, and rendered card-name order matches those IDs (P10-G8).
 *
 * The seeded fixtures and their deterministic first pages (verified
 * against the real Fiber process and the freshly seeded PostgreSQL
 * catalog; seed migration `0005_seed_food_catalog.sql`): Pizza Margherita
 * (Food Object 1, solid with a 350 g Serving) ranks `[13, 29, 26]` and
 * allows `serving` (whole-number floor of 100000 / 350 = 285) then `g`
 * (`100000`); Pho (30, liquid with a 400 ml Serving) allows `serving`
 * (`250`) then `ml` (`100000`); Chicken breast (5, solid without a
 * Serving) allows only `g` (`100000`); Milk (10, liquid without a
 * Serving) allows only `ml` (`100000`). No nutrition value is calculated
 * or rerounded in the browser (REQ-040): the rendered summary and cards
 * display the exact backend-provided values.
 */

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

/** One observed generated-client Substitution Search POST. */
interface SubstitutePost {
  /** The parsed JSON request body (closed request object, ISSUE-005). */
  body: Record<string, unknown>;
  /** The real-stack response status, once it arrives. */
  status: number | null;
  /** The real-stack response body, once it arrives. */
  response: Record<string, unknown> | null;
}

/**
 * Records every generated-client `POST /api/v1/substitutes/search` request
 * with its body and, once the real-stack response arrives, its status and
 * parsed body. The scenarios use the observed bodies to prove exactly one
 * request per changed valid commit with the selected Food Object ID, the
 * selected unit, the committed or clamped number, and page `0` (REQ-028),
 * and the response bodies for the proportional-value and page/order
 * assertions (P10-G7, P10-G8).
 */
function trackSubstitutePosts(page: Page): SubstitutePost[] {
  const posts: SubstitutePost[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/v1/substitutes/search")
    ) {
      posts.push({
        body: request.postDataJSON() as Record<string, unknown>,
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
        post.response = (await response.json()) as Record<string, unknown>;
      }
    }
  });
  return posts;
}

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

/**
 * Drives one pointer selection: fills the Search Query, waits for the five
 * seeded suggestions, clicks the option with the given stable Food Object
 * ID, and waits for the successful result transition.
 */
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

/**
 * Drives one pointer selection while the first Substitution Search POST is
 * held at the browser boundary: fills the Search Query, clicks the option
 * with the given stable Food Object ID, and waits for the `loadingNew`
 * transition so the pending summary can be observed (P10-G2).
 */
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

/** The summary region and its quantity editor controls (task 34). */
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

/**
 * Commits the current draft with Enter while the number field keeps focus
 * (ISSUE-010).
 */
async function commitWithEnter(
  input: import("@playwright/test").Locator,
): Promise<void> {
  await input.press("Enter");
}

/**
 * Commits the current draft by moving focus outside the complete quantity
 * editor — clicking a summary row outside the editor, so the browser moves
 * focus to the body and the editor's `focusout` handler commits (ISSUE-010).
 */
async function commitWithBlur(page: Page): Promise<void> {
  await page.locator("[data-input-macronutrients]").click();
}

/** The exact one-decimal display formatting oracle (REQ-039, ISSUE-008). */
function formatMacronutrient(value: number, locale: "en" | "pl"): string {
  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)} g`;
}

/**
 * Asserts that a recalculation value is the expected proportion of the
 * original value within the backend display-rounding tolerance (REQ-028,
 * ARCH-018): the whole Matched Quantity is rounded once per response
 * (tolerance `1`), and every macronutrient is rounded to `0.1 g` once per
 * response (tolerance `0.1`), so a doubled input produces each value
 * within one rounding step of exactly twice the original.
 */
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

    // Hold the first Substitution Search POST at the browser boundary so
    // the real Fiber and PostgreSQL response stays pending while the
    // initial disabled summary is observed (P10-G2, REQ-027).
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

    // The seeded solid-Serving input: Pizza Margherita (Food Object 1,
    // 350 g Serving, default 1 serving), held in the pending transition.
    await selectFoodObjectPending(page, "margherita", 1, COPY.en);

    // The complete disabled initial summary keeps its layout but hides its
    // card content behind one centered aria-hidden spinner and retains the
    // polite `Loading nutrition values` status (P10-G2, REQ-081).
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
    const spinnerSize = await selectedSpinner.evaluate((element) => ({
      width: (element as HTMLElement).offsetWidth,
      height: (element as HTMLElement).offsetHeight,
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    expect(spinnerSize).toEqual({ width: 16, height: 16, ariaHidden: "true" });
    await expect(summary(page)).toHaveAttribute("aria-busy", "true");
    await expect(editorStatus(page)).toHaveText(COPY.en.loadingNutritionValues);

    // Fulfillment loads the first result page and enables the editor; the
    // two-unit selector shows the default unit first with the plural
    // Serving label and the number field keeps the one-serving default
    // (P10-G2, REQ-027).
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

    // The seeded liquid-Serving input: Pho (Food Object 30, 400 ml
    // Serving, default 1 serving) also shows the two-unit default-first
    // selector with the plural Serving label.
    await selectFoodObject(page, "pho", 30, COPY.en);
    await expect(summary(page)).toContainText("Pho");
    await expect(numberInput(page)).toHaveValue("1");
    await expect(unitSelect(page)).toHaveValue("serving");
    await expect(unitSelect(page).locator("option")).toHaveText([
      COPY.en.servings,
      "ml",
    ]);

    // The seeded solid-base-only input: Chicken breast (Food Object 5)
    // shows only the static `g` base unit, carrying the visually hidden
    // `Unit` accessible label so a screen reader never hears an unlabeled
    // adjacent unit text (P10-G2, ISSUE-010).
    await selectFoodObject(page, "chicken breast", 5, COPY.en);
    await expect(summary(page)).toContainText("Chicken breast");
    await expect(numberInput(page)).toHaveValue("100");
    await expect(unitSelect(page)).toHaveCount(0);
    await expect(staticUnit(page)).toHaveText("g");
    await expect(page.getByRole("group", { name: COPY.en.unit })).toContainText(
      "g",
    );

    // The seeded liquid-base-only input: Milk (Food Object 10) shows only
    // the static `ml` base unit with the same visually hidden `Unit`
    // accessible label.
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

    // The first page-0 response carries the one-serving values: the
    // backend-derived input macronutrients and the ranked cards
    // [13, 29, 26] with their matched quantities, macronutrients, and
    // similarity (P10-G8).
    await expect.poll(() => posts[0]?.response).toBeTruthy();
    const first = posts[0]?.response as {
      pageIndex: number;
      inputMacronutrients: {
        protein: number;
        carbohydrate: number;
        fat: number;
      };
      inputCalories: number;
      items: Array<{
        foodObjectId: number;
        names: { en: string };
        matchedQuantity: { value: number; unit: string };
        macronutrients: { protein: number; carbohydrate: number; fat: number };
        calories: number;
        similarityPercent: number;
      }>;
    };
    expect(first.pageIndex).toBe(0);
    expect(first.items.map((item) => item.foodObjectId)).toEqual([13, 29, 26]);

    // The rendered one-serving summary shows the backend-provided input
    // macronutrients with one localized decimal place (P10-G2).
    await expect(page.locator("[data-input-macro-protein]")).toHaveText(
      formatMacronutrient(first.inputMacronutrients.protein, "en"),
    );
    await expect(page.locator("[data-input-macro-carbohydrate]")).toHaveText(
      formatMacronutrient(first.inputMacronutrients.carbohydrate, "en"),
    );
    await expect(page.locator("[data-input-macro-fat]")).toHaveText(
      formatMacronutrient(first.inputMacronutrients.fat, "en"),
    );
    await expect(page.locator("[data-input-calories]")).toHaveText(
      `${first.inputCalories} kcal`,
    );
    // Edit the enabled quantity after the first result page loads
    // (REQ-027): two Servings commit through Enter and start exactly one
    // fresh request with the same Food Object ID, the selected unit, the
    // committed number, and the unchanged page 0 (P10-G7).
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
      quantity: { value: 2, unit: "serving" },
      pageIndex: 0,
    });

    // The second response and the rendered summary and cards scale
    // proportionally: every Matched Quantity and macronutrient doubles,
    // while the similarity and the ranked Food Object IDs and order stay
    // unchanged, and the response page index is still 0 (P10-G7, P10-G8,
    // REQ-028, ARCH-018).
    await expect.poll(() => posts[1]?.response).toBeTruthy();
    const second = posts[1]?.response as typeof first;
    expect(second.pageIndex).toBe(0);
    expect(second.items.map((item) => item.foodObjectId)).toEqual([13, 29, 26]);
    for (let index = 0; index < first.items.length; index += 1) {
      expectProportional(
        second.items[index].matchedQuantity.value,
        first.items[index].matchedQuantity.value,
        2,
        1,
        `rank ${index + 1} Matched Quantity`,
      );
      expectProportional(
        second.items[index].macronutrients.protein,
        first.items[index].macronutrients.protein,
        2,
        0.1,
        `rank ${index + 1} protein`,
      );
      expectProportional(
        second.items[index].macronutrients.carbohydrate,
        first.items[index].macronutrients.carbohydrate,
        2,
        0.1,
        `rank ${index + 1} carbohydrate`,
      );
      expectProportional(
        second.items[index].macronutrients.fat,
        first.items[index].macronutrients.fat,
        2,
        0.1,
        `rank ${index + 1} fat`,
      );
      expect(second.items[index].similarityPercent).toBe(
        first.items[index].similarityPercent,
      );
    }
    expectProportional(
      second.inputMacronutrients.protein,
      first.inputMacronutrients.protein,
      2,
      0.1,
      "input protein",
    );
    expectProportional(
      second.inputMacronutrients.carbohydrate,
      first.inputMacronutrients.carbohydrate,
      2,
      0.1,
      "input carbohydrate",
    );
    expectProportional(
      second.inputMacronutrients.fat,
      first.inputMacronutrients.fat,
      2,
      0.1,
      "input fat",
    );
    expectProportional(
      second.inputCalories,
      first.inputCalories,
      2,
      1,
      "input calories",
    );
    await expect(page.locator("[data-input-calories]")).toHaveText(
      `${second.inputCalories} kcal`,
    );

    // The rendered summary shows only the current response's backend
    // values (P10-G7), and the rendered card-name order matches the
    // response Food Object ID order (P10-G8).
    await expect(page.locator("[data-input-macro-protein]")).toHaveText(
      formatMacronutrient(second.inputMacronutrients.protein, "en"),
    );
    await expect(page.locator("[data-input-macro-carbohydrate]")).toHaveText(
      formatMacronutrient(second.inputMacronutrients.carbohydrate, "en"),
    );
    await expect(page.locator("[data-input-macro-fat]")).toHaveText(
      formatMacronutrient(second.inputMacronutrients.fat, "en"),
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

    // Selecting the base unit replaces the draft with 100 g and commits
    // immediately: one request with 100 g, and the selector reorders to
    // current-first (P10-G2, P10-G3).
    const input = numberInput(page);
    const select = unitSelect(page);
    await select.selectOption("g");
    await expect(input).toHaveValue("100");
    await expect(select).toHaveValue("g");
    await expect(select.locator("option")).toHaveText(["g", COPY.en.servings]);
    expect(posts).toHaveLength(2);
    expect(posts[1]?.body).toEqual({
      foodObjectId: 1,
      quantity: { value: 100, unit: "g" },
      pageIndex: 0,
    });

    // Selecting the Serving unit again replaces the draft with 1 and
    // commits immediately; the selector returns to serving-first.
    await select.selectOption("serving");
    await expect(input).toHaveValue("1");
    await expect(select).toHaveValue("serving");
    await expect(select.locator("option")).toHaveText([COPY.en.servings, "g"]);
    expect(posts).toHaveLength(3);
    expect(posts[2]?.body).toEqual({
      foodObjectId: 1,
      quantity: { value: 1, unit: "serving" },
      pageIndex: 0,
    });

    // A syntactically valid value above the advertised maximum (285
    // Servings) is silently replaced by that whole maximum before commit:
    // one request with 285, no error message, and no clamp notice
    // (P10-G3, ISSUE-010).
    await input.fill("300");
    await commitWithEnter(input);
    await expect(input).toHaveValue("285");
    await expect(quantityError(page)).toHaveCount(0);
    expect(posts).toHaveLength(4);
    expect(posts[3]?.body).toEqual({
      foodObjectId: 1,
      quantity: { value: 285, unit: "serving" },
      pageIndex: 0,
    });

    // A clamp back to the committed maximum and a directly entered equal
    // value start no request, including Enter followed by blur (P10-G3).
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

    // The ISSUE-010-rejected Serving forms: leading zeros, `.5`, `1.`,
    // comma decimals, zero, negatives, empty text, letters, surrounding
    // whitespace, a leading plus, and exponent notation (P10-G4, REQ-025).
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
      // The exact raw text stays visible, the field keeps focus, the
      // invalid state is announced through aria-invalid, and the exact
      // English polite message is associated (P10-G5, REQ-026).
      await expect(
        input,
        `the raw draft ${JSON.stringify(rejected)} stays visible`,
      ).toHaveValue(rejected);
      await expect(input).toBeFocused();
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await expect(quantityError(page)).toHaveText(COPY.en.invalidQuantity);
      // No request starts for any invalid value (P10-G6, REQ-026).
      expect(
        posts.length,
        `the invalid draft ${JSON.stringify(rejected)} starts no request`,
      ).toBe(postsAfterSelection);
    }

    // The error clears as soon as the draft becomes syntactically valid,
    // without committing it; a draft equal to the committed value starts
    // no request (P10-G5, ISSUE-010).
    await input.fill("1");
    await expect(input).not.toHaveAttribute("aria-invalid");
    await expect(quantityError(page)).toHaveCount(0);
    await commitWithEnter(input);
    expect(posts).toHaveLength(postsAfterSelection);

    // The fractional base form is rejected for a base-unit draft: select
    // the gram unit, then enter a dot decimal (P10-G4, REQ-025).
    await unitSelect(page).selectOption("g");
    await input.fill("1.5");
    await commitWithEnter(input);
    await expect(input).toHaveValue("1.5");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(quantityError(page)).toHaveText(COPY.en.invalidQuantity);
    expect(posts).toHaveLength(postsAfterSelection + 1);

    // A valid dot-decimal Serving count is accepted (P10-G3, REQ-025):
    // select the Serving unit, type two-and-a-half Servings, and commit.
    await unitSelect(page).selectOption("serving");
    await input.fill("2.5");
    await commitWithEnter(input);
    await expect(input).not.toHaveAttribute("aria-invalid");
    await expect(quantityError(page)).toHaveCount(0);
    expect(posts).toHaveLength(postsAfterSelection + 3);
    expect(posts[posts.length - 1]?.body).toEqual({
      foodObjectId: 1,
      quantity: { value: 2.5, unit: "serving" },
      pageIndex: 0,
    });

    // The Polish flow shows the exact Polish polite message and the plural
    // `porcje` selector label (P10-G5, P10-G2): switch the Interface
    // Language, select Milk in Polish, enter an invalid draft, and observe
    // the localized message.
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

    // The Polish two-unit selector shows the plural `porcje` Serving label
    // (P10-G2, ISSUE-010): select Pizza Margherita in Polish and observe
    // the option labels.
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

    // Hold the second Substitution Search POST (the recalculation) at the
    // browser boundary so the pending state can be observed (P10-G7).
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
    const settledSelectedCardSize = await selectedCard.evaluate((element) => ({
      width: (element as HTMLElement).offsetWidth,
      height: (element as HTMLElement).offsetHeight,
    }));
    const settledCardSizes = await cards.evaluateAll((elements) =>
      elements.map((element) => ({
        width: (element as HTMLElement).offsetWidth,
        height: (element as HTMLElement).offsetHeight,
      })),
    );

    // Commit a changed quantity; the recalculation is held at the browser
    // boundary. During the pending interval the combined region stays busy
    // with one `Updating quantities` status. Each selected-food and result
    // card hides its complete non-image content behind one centered,
    // aria-hidden 16px spinner while preserving its settled dimensions and
    // keeping result images visible (P10-G7, REQ-081, ISSUE-010).
    const input = numberInput(page);
    await input.fill("2");
    await commitWithEnter(input);
    await expect(input).toBeEnabled();
    await expect(unitSelect(page)).toBeEnabled();

    const selectedSpinner = selectedCard.locator("[data-card-spinner]");
    await expect(selectedSpinner).toHaveCount(1);
    const resultSpinners = cards.locator("[data-card-spinner]");
    await expect(resultSpinners).toHaveCount(3);
    await expect(page.locator("[data-value-spinner]")).toHaveCount(0);
    const spinnerSize = await selectedSpinner.evaluate((element) => ({
      width: (element as HTMLElement).offsetWidth,
      height: (element as HTMLElement).offsetHeight,
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    expect(spinnerSize).toEqual({ width: 16, height: 16, ariaHidden: "true" });
    const pendingCardSizes = await cards.evaluateAll((elements) =>
      elements.map((element) => ({
        width: (element as HTMLElement).offsetWidth,
        height: (element as HTMLElement).offsetHeight,
      })),
    );
    const pendingSelectedCardSize = await selectedCard.evaluate((element) => ({
      width: (element as HTMLElement).offsetWidth,
      height: (element as HTMLElement).offsetHeight,
    }));
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

    // Every card hides its non-image content while result images stay
    // visible during recalculation (P10-G7, REQ-081).
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

    // Fulfillment removes the card spinners, restores card content, renders
    // only the current response's backend values, and clears the busy
    // status (P10-G7, REQ-028, REQ-081).
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
    const second = posts[1]?.response as {
      inputMacronutrients: {
        protein: number;
        carbohydrate: number;
        fat: number;
      };
      inputCalories: number;
    };
    await expect(page.locator("[data-input-macro-protein]")).toHaveText(
      formatMacronutrient(second.inputMacronutrients.protein, "en"),
    );
    await expect(page.locator("[data-input-macro-carbohydrate]")).toHaveText(
      formatMacronutrient(second.inputMacronutrients.carbohydrate, "en"),
    );
    await expect(page.locator("[data-input-macro-fat]")).toHaveText(
      formatMacronutrient(second.inputMacronutrients.fat, "en"),
    );
    await expect(page.locator("[data-input-calories]")).toHaveText(
      `${second.inputCalories} kcal`,
    );
    await expect(
      page.locator("[data-selected-input-region]"),
    ).not.toHaveAttribute("aria-busy", "true");
    await expect(editorStatus(page)).toHaveText("");
    expect(posts).toHaveLength(2);
    await expect.poll(() => posts[1]?.status ?? null).toBe(200);
  });
});
