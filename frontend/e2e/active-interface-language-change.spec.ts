import { expect, test, type Locator, type Page } from "@playwright/test";
import type { SubstituteSearchRequest } from "../src/client/types.gen";

const PREVIEW_ORIGIN = "http://127.0.0.1:4173";

const STORAGE_KEY = "obiad.interfaceLanguage";

const UNFINISHED_QUERY = "chick";

const COPY = {
  en: {
    search: "Search",
    placeholder: "Search foods",
    listbox: "Suggestions",
    control: "Interface language",
  },
  pl: {
    search: "Szukaj",
    placeholder: "Szukaj potraw",
    listbox: "Podpowiedzi",
    control: "Język interfejsu",
  },
} as const;

const SEEDED_SUGGESTIONS = {
  en: [
    { foodObjectId: 5, name: "Chicken breast" },
    { foodObjectId: 22, name: "Fried chicken wings" },
    { foodObjectId: 17, name: "Polish chicken soup" },
    { foodObjectId: 10, name: "Milk" },
    { foodObjectId: 30, name: "Pho" },
  ],
  pl: [
    { foodObjectId: 16, name: "Gyros" },
    { foodObjectId: 15, name: "Kebab" },
    { foodObjectId: 18, name: "Masło" },
    { foodObjectId: 10, name: "Mleko" },
    { foodObjectId: 27, name: "Omlet" },
  ],
} as const;

const RESULT_COPY = {
  en: {
    heading: "Found substitutions",
    more: "MORE!",
    selectedFood: "Selected food",
    serving: "serving",
    quantity: "Quantity",
    unit: "Unit",
    servings: "servings",
    protein: "Protein",
    carbohydrates: "Carbohydrates",
    fat: "Fat",
    similarity: "Similarity",
    calories: "Calories",
    loading: "Loading nutrition values",
    updating: "Updating quantities",
    invalidQuantity: "Enter a valid quantity.",
  },
  pl: {
    heading: "Znalezione zamienniki",
    more: "WIĘCEJ!",
    selectedFood: "Wybrany produkt",
    serving: "porcja",
    quantity: "Ilość",
    unit: "Jednostka",
    servings: "porcje",
    protein: "Białko",
    carbohydrates: "Węglowodany",
    fat: "Tłuszcz",
    similarity: "Podobieństwo",
    calories: "Kalorie",
    loading: "Ładowanie wartości odżywczych",
    updating: "Aktualizowanie ilości",
    invalidQuantity: "Wpisz prawidłową ilość.",
  },
} as const;

const PIZZA_PAGE_2_IDS = [14, 4, 21] as const;

const PAGE_2_COPY = {
  en: {
    selected: "Pizza Margherita",
    cards: ["Oat milk", "Pierogi", "Beef cheeseburger"],
  },
  pl: {
    selected: "Pizza margherita",
    cards: ["Napój owsiany", "Pierogi", "Cheeseburger wołowy"],
  },
} as const;

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

function trackRequests(page: Page, ledger: string[]): void {
  page.on("request", (request) => ledger.push(request.url()));
}

function suggestionGets(ledger: readonly string[]): string[] {
  return ledger.filter((url) => url.includes("/api/v1/food-suggestions"));
}

function substitutePosts(ledger: readonly string[]): string[] {
  return ledger.filter((url) => url.includes("/api/v1/substitutes/search"));
}

async function selectionRange(search: Locator): Promise<{
  start: number;
  end: number;
}> {
  return search.evaluate((element) => {
    if (!(element instanceof HTMLInputElement)) {
      throw new TypeError("Search combobox must be an input element");
    }
    return {
      start: element.selectionStart ?? -1,
      end: element.selectionEnd ?? -1,
    };
  });
}

async function expectStored(page: Page, value: string | null): Promise<void> {
  const stored = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    STORAGE_KEY,
  );
  expect(stored).toBe(value);
}

async function expectSearchSideLanguageChange(
  page: Page,
  search: Locator,
  panel: Locator,
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  await expect(
    page.getByRole("combobox", { name: copy.control }),
  ).toBeFocused();
  await expect(search).not.toBeFocused();

  const range = await selectionRange(search);
  expect(
    range.start,
    "the Search selection range collapses on the language change",
  ).toBe(range.end);
  await expect(panel).toHaveCount(0);
  await expect(search).not.toHaveAttribute("aria-activedescendant");
  await expect(search).toHaveAttribute("aria-expanded", "false");

  await expect(search).toHaveValue(UNFINISHED_QUERY);
  await expect(search).toHaveAttribute("placeholder", copy.placeholder);
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
  await expect(options).toHaveCount(5);
  for (let index = 0; index < expected.length; index += 1) {
    await expect(options.nth(index)).toHaveText(expected[index].name);
  }
  await expect(options.nth(0)).toHaveAttribute(
    "id",
    `food-suggestion-option-${expected[0].foodObjectId}`,
  );
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(search).toHaveAttribute(
    "aria-activedescendant",
    `food-suggestion-option-${expected[0].foodObjectId}`,
  );
  await expect(search).toHaveAttribute("aria-expanded", "true");
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

async function renderedCardIDs(page: Page): Promise<number[]> {
  const cards = page.locator("[data-result-card]");
  return cards.evaluateAll((elements) =>
    elements.map((element) =>
      Number(element.getAttribute("data-food-object-id")),
    ),
  );
}

async function expectMacroLocale(
  page: Page,
  selector: string,
  locale: "en" | "pl",
): Promise<void> {
  const text = await page.locator(selector).first().textContent();
  expect(text ?? "").toMatch(locale === "en" ? /^\d+\.\d g$/ : /^\d+,\d g$/);
}

async function expectPage2Surface(
  page: Page,
  copy: (typeof RESULT_COPY)[keyof typeof RESULT_COPY],
  names: (typeof PAGE_2_COPY)[keyof typeof PAGE_2_COPY],
  searchCopy: (typeof COPY)[keyof typeof COPY],
  locale: "en" | "pl",
): Promise<void> {
  await expect.poll(() => renderedCardIDs(page)).toEqual([...PIZZA_PAGE_2_IDS]);
  await expect(page.locator("main")).toHaveAttribute(
    "data-interaction-state",
    "results",
  );

  await expect(page.getByRole("heading", { name: copy.heading })).toBeVisible();
  const more = page.locator("[data-more-button]");
  await expect(more).toHaveText(copy.more);
  await expect(more).toHaveAttribute("aria-label", copy.more);

  await expect(page.locator("[data-selected-name]")).toHaveText(names.selected);
  const srOnlyTexts = await page
    .locator("[data-selected-food-summary] .sr-only")
    .allTextContents();
  expect(srOnlyTexts).toContain(
    `${copy.selectedFood}: ${names.selected} · 1 ${copy.serving}`,
  );
  expect(srOnlyTexts).toContain(copy.quantity);
  expect(srOnlyTexts).toContain(copy.unit);

  await expect(page.getByRole("textbox", { name: copy.quantity })).toHaveValue(
    "1",
  );
  const unitSelect = page.locator("[data-quantity-unit]");
  await expect(unitSelect).toHaveValue("serving");
  await expect(unitSelect.locator("option")).toHaveText([copy.servings, "g"]);

  await expect(page.locator("[data-input-calories]")).toHaveAttribute(
    "aria-label",
    copy.calories,
  );
  await expect(
    page.locator("[data-result-card-calories]").first(),
  ).toHaveAttribute("aria-label", copy.calories);

  await expect(page.locator("[data-input-macronutrients] dt")).toHaveText([
    copy.protein,
    copy.carbohydrates,
    copy.fat,
  ]);
  await expect(
    page.locator("[data-result-card]").first().locator("dl dt"),
  ).toHaveText([copy.protein, copy.carbohydrates, copy.fat, copy.similarity]);

  const cardNames = await page
    .locator("[data-result-card] h3")
    .allTextContents();
  expect(cardNames).toEqual(names.cards);

  await expectMacroLocale(page, "[data-input-macro-protein]", locale);
  await expectMacroLocale(page, "[data-input-macro-carbohydrate]", locale);
  await expectMacroLocale(page, "[data-input-macro-fat]", locale);
  await expectMacroLocale(
    page,
    "[data-result-card] [data-card-content] dl dd",
    locale,
  );

  await expect(
    page.getByRole("combobox", { name: searchCopy.search }),
  ).toBeVisible();
  await expect(page.locator('input[type="search"]')).toHaveAttribute(
    "placeholder",
    searchCopy.placeholder,
  );
  await expect(page.locator('input[type="search"]')).toHaveValue(
    "Pizza Margherita",
  );
}

test.describe("Active Interface Language change", () => {
  test("a real language selection closes the live suggestion list, removes Search focus and any Search text selection, retains the exact unfinished Search Query, starts no HTTP request, and the next Search focus starts exactly one fresh suggestion GET in the selected language (P14-G3, P14-G5, REQ-013, REQ-059)", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const ledger: string[] = [];
    trackRequests(page, ledger);

    await page.goto("/");
    await expect(page).toHaveTitle("Obiad");

    const search = page.locator('input[type="search"]');
    await expect(search).toHaveAttribute("placeholder", COPY.en.placeholder);
    await expect(
      page.getByRole("combobox", { name: COPY.en.control }),
    ).toHaveValue("en");
    expect(ledger.some((url) => url.includes("/api/"))).toBe(false);
    for (const url of ledger) {
      expect(new URL(url).origin).toBe(PREVIEW_ORIGIN);
    }

    await search.fill(UNFINISHED_QUERY);
    await expectSuggestionPanel(page, SEEDED_SUGGESTIONS.en, COPY.en);

    await search.click();
    const before = await selectionRange(search);
    expect(
      before.start,
      "the Search selection range is nonempty before the language change",
    ).toBeLessThan(before.end);

    const ledgerBeforeLanguageChange = ledger.length;
    const englishControl = page.getByRole("combobox", {
      name: COPY.en.control,
    });
    await englishControl.focus();
    await englishControl.selectOption("pl");
    expect(
      ledger.slice(ledgerBeforeLanguageChange),
      "the language action starts no suggestion GET, Substitute POST, retry, or other HTTP request",
    ).toEqual([]);

    await expectSearchSideLanguageChange(
      page,
      search,
      page.getByRole("listbox"),
      COPY.pl,
    );
    await expectStored(page, "pl");

    const ledgerBeforeRefocus = ledger.length;
    await search.focus();
    await expectSuggestionPanel(page, SEEDED_SUGGESTIONS.pl, COPY.pl);
    const freshPolishGets = suggestionGets(ledger.slice(ledgerBeforeRefocus));
    expect(freshPolishGets).toHaveLength(1);
    expect(new URL(freshPolishGets[0] ?? "").searchParams.get("language")).toBe(
      "pl",
    );
    expect(new URL(freshPolishGets[0] ?? "").searchParams.get("query")).toBe(
      UNFINISHED_QUERY,
    );
    expect(substitutePosts(ledger.slice(ledgerBeforeRefocus))).toEqual([]);

    const ledgerBeforeSecondChange = ledger.length;
    const polishControl = page.getByRole("combobox", {
      name: COPY.pl.control,
    });
    await polishControl.focus();
    await polishControl.selectOption("en");
    expect(
      ledger.slice(ledgerBeforeSecondChange),
      "the repeated language action starts no HTTP request",
    ).toEqual([]);
    await expectSearchSideLanguageChange(
      page,
      search,
      page.getByRole("listbox"),
      COPY.en,
    );
    await expectStored(page, "en");

    const ledgerBeforeSecondRefocus = ledger.length;
    await search.focus();
    await expectSuggestionPanel(page, SEEDED_SUGGESTIONS.en, COPY.en);
    const freshEnglishGets = suggestionGets(
      ledger.slice(ledgerBeforeSecondRefocus),
    );
    expect(freshEnglishGets).toHaveLength(1);
    expect(
      new URL(freshEnglishGets[0] ?? "").searchParams.get("language"),
    ).toBe("en");
    expect(new URL(freshEnglishGets[0] ?? "").searchParams.get("query")).toBe(
      UNFINISHED_QUERY,
    );
    expect(substitutePosts(ledger.slice(ledgerBeforeSecondRefocus))).toEqual(
      [],
    );

    const ledgerBeforeReload = ledger.length;
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: COPY.en.control }),
    ).toHaveValue("en");
    await expect(search).toHaveAttribute("placeholder", COPY.en.placeholder);
    await expectStored(page, "en");
    expect(
      ledger.slice(ledgerBeforeReload).some((url) => url.includes("/api/")),
      "the reload performs no application API request",
    ).toBe(false);

    expect(suggestionGets(ledger)).toHaveLength(3);
    expect(substitutePosts(ledger)).toEqual([]);
  });

  test("a real language selection on displayed page 2 keeps the page index and exact ordered result IDs while every Food Object name, interface label, accessible name, localized value, and current non-result announcement source changes in place; the language action starts no HTTP request; and invalid then valid quantity text crosses the change with no request (P14-G2, P14-G4, P14-G5, REQ-026, REQ-055, REQ-058)", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const ledger: string[] = [];
    trackRequests(page, ledger);
    const posts = trackSubstitutePosts(page);

    let postCount = 0;
    const release: Record<number, () => void> = {};
    const held: Record<number, Promise<void>> = {};
    await page.route("**/api/v1/substitutes/search", async (route) => {
      postCount += 1;
      if (postCount === 4 || postCount === 5) {
        const { promise, resolve } = Promise.withResolvers<void>();
        held[postCount] = promise;
        release[postCount] = resolve;
        await promise;
      }
      await route.continue();
    });

    await page.goto("/");
    await expect(page).toHaveTitle("Obiad");

    const search = page.locator('input[type="search"]');
    await search.fill("margherita");
    const pizzaOption = page.locator("#food-suggestion-option-1");
    await expect(pizzaOption).toBeVisible();
    await pizzaOption.click();
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    const more = page.locator("[data-more-button]");
    await more.click();
    await expect.poll(() => renderedCardIDs(page)).toEqual([30, 3, 35]);
    await more.click();
    await expect
      .poll(() => renderedCardIDs(page))
      .toEqual([...PIZZA_PAGE_2_IDS]);

    expect(posts.map((post) => post.body)).toEqual([
      {
        foodObjectId: 1,
        pageIndex: 0,
      },
      {
        foodObjectId: 1,
        pageIndex: 1,
      },
      {
        foodObjectId: 1,
        pageIndex: 2,
      },
    ]);

    await expectPage2Surface(
      page,
      RESULT_COPY.en,
      PAGE_2_COPY.en,
      COPY.en,
      "en",
    );

    const ledgerBeforeLanguageChange = ledger.length;
    const englishControl = page.getByRole("combobox", {
      name: COPY.en.control,
    });
    await englishControl.focus();
    await englishControl.selectOption("pl");
    expect(
      ledger.slice(ledgerBeforeLanguageChange),
      "the language action starts no suggestion GET, Substitute POST, retry, or other HTTP request",
    ).toEqual([]);
    await expectStored(page, "pl");

    await expectPage2Surface(
      page,
      RESULT_COPY.pl,
      PAGE_2_COPY.pl,
      COPY.pl,
      "pl",
    );
    await expect(
      page.getByRole("combobox", { name: COPY.pl.control }),
    ).toBeFocused();

    const numberField = page.getByRole("textbox", {
      name: RESULT_COPY.pl.quantity,
    });
    await numberField.fill("2");
    await numberField.press("Enter");
    await expect.poll(() => posts.length).toBe(4);
    expect(posts[3]?.body).toEqual({
      foodObjectId: 1,
      pageIndex: 2,
    });
    await expect(page.locator("[data-editor-status]")).toHaveText(
      RESULT_COPY.pl.updating,
    );
    release[4]!();
    await expect(page.locator("[data-editor-status]")).toHaveText("");
    await expect
      .poll(() => renderedCardIDs(page))
      .toEqual([...PIZZA_PAGE_2_IDS]);
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );

    const plSearch = page.getByRole("combobox", { name: COPY.pl.search });
    await plSearch.fill("mleko");
    const milkOption = page.locator("#food-suggestion-option-10");
    await expect(milkOption).toBeVisible();
    await milkOption.click();
    await expect.poll(() => posts.length).toBe(5);
    expect(posts[4]?.body).toEqual({
      foodObjectId: 10,
      pageIndex: 0,
    });
    await expect(page.locator("[data-editor-status]")).toHaveText(
      RESULT_COPY.pl.loading,
    );
    release[5]!();
    await expect(page.locator("[data-editor-status]")).toHaveText("");
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );

    const milkNumber = page.getByRole("textbox", {
      name: RESULT_COPY.pl.quantity,
    });
    await milkNumber.fill("1.2.3");
    await milkNumber.press("Enter");
    await expect(milkNumber).toHaveValue("1.2.3");
    await expect(milkNumber).toHaveAttribute("aria-invalid", "true");
    const quantityError = page.locator("[data-quantity-error]");
    await expect(quantityError).toHaveText(RESULT_COPY.pl.invalidQuantity);
    await expect(quantityError).toHaveAttribute("aria-live", "polite");
    expect(posts).toHaveLength(5);

    const ledgerBeforeSecondChange = ledger.length;
    const polishControl = page.getByRole("combobox", {
      name: COPY.pl.control,
    });
    await polishControl.focus();
    await polishControl.selectOption("en");
    expect(
      ledger.slice(ledgerBeforeSecondChange),
      "the repeated language action starts no HTTP request",
    ).toEqual([]);
    await expectStored(page, "en");

    const englishNumberField = page.getByRole("textbox", {
      name: RESULT_COPY.en.quantity,
    });
    await expect(quantityError).toHaveText(RESULT_COPY.en.invalidQuantity);
    await expect(englishNumberField).toHaveValue("1.2.3");
    await expect(englishNumberField).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator('input[type="search"]')).toHaveValue("Mleko");
    expect(posts).toHaveLength(5);

    await englishNumberField.fill("150");
    await expect(englishNumberField).not.toHaveAttribute("aria-invalid");
    await expect(quantityError).toHaveCount(0);
    await englishNumberField.press("Enter");
    await expect.poll(() => posts.length).toBe(6);
    expect(posts[5]?.body).toEqual({
      foodObjectId: 10,
      pageIndex: 0,
    });
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );

    const gets = suggestionGets(ledger);
    expect(gets).toHaveLength(2);
    expect(
      new URL(gets[gets.length - 1] ?? "").searchParams.get("language"),
    ).toBe("pl");
    expect(new URL(gets[gets.length - 1] ?? "").searchParams.get("query")).toBe(
      "mleko",
    );
    expect(substitutePosts(ledger)).toHaveLength(6);
    expect(posts.map((post) => post.body)).toEqual([
      {
        foodObjectId: 1,
        pageIndex: 0,
      },
      {
        foodObjectId: 1,
        pageIndex: 1,
      },
      {
        foodObjectId: 1,
        pageIndex: 2,
      },
      {
        foodObjectId: 1,
        pageIndex: 2,
      },
      {
        foodObjectId: 10,
        pageIndex: 0,
      },
      {
        foodObjectId: 10,
        pageIndex: 0,
      },
    ]);
  });
});
