import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Real-stack Active Interface Language change scenario (task 43,
 * task 44; ARCH-001, ARCH-002, ARCH-003, ARCH-008, ARCH-010, ARCH-011,
 * ARCH-012, ARCH-014, ARCH-019, ARCH-020, ARCH-022, REQ-013, REQ-026,
 * REQ-055, REQ-056, REQ-057, REQ-058, REQ-059, ISSUE-014; P14-G1,
 * P14-G2, P14-G3, P14-G4, P14-G5, P14-G6).
 *
 * `bun run test:e2e` runs this scenario on the normal stack started by
 * `./e2e/launcher.ts`: disposable PostgreSQL 17 seeded by the real setup
 * command, the real Fiber process on the fixed loopback listener
 * 127.0.0.1:8080, and the optimized Vite preview on the strict port 4173.
 *
 * It completes the Search side of the Active Interface Language change
 * collaboration (ARCH-012, REQ-059): a real selection from the persisted
 * Interface Language control updates the one language store, closes the
 * live suggestion list, removes Search focus and any Search text
 * selection, and retains the exact unfinished Search Query. The language
 * action itself starts no HTTP request — no suggestion GET, Substitute
 * POST, retry, or other request (P14-G5, REQ-013). The next Search focus
 * starts exactly one fresh suggestion GET carrying the selected Interface
 * Language and the retained query instead of reusing inactive data
 * (P14-G5, ARCH-019), so English mode renders English names and Polish
 * mode renders Polish names for the same retained query (REQ-013).
 *
 * The scenario repeats the real language selection twice (P14-G3): once
 * with a nonempty Search selection range (the Search control's
 * click-to-select action selects the whole query) and once with the exact
 * unfinished Search Query text and no selection. Each repetition proves
 * that Search loses focus, the selection range and the live suggestion
 * list close, `aria-activedescendant` clears, and the query stays exact.
 *
 * English and Polish Search, suggestion, Interface Language control,
 * initialization, and persistence assertions pass (P14-G6, REQ-055,
 * REQ-056, REQ-057). The existing loading, validation, and failure
 * announcements stay unchanged and remain covered by the quantity-editing,
 * request-lock, and serial outage-stack scenarios of the same suite.
 *
 * Task 44 completes the current-result and retained-state side of the same
 * collaboration (ARCH-012, REQ-058, ISSUE-014). A second scenario drives a
 * real selection on displayed page 2 and proves that the page index and
 * the exact ordered result IDs stay retained while every visible Food
 * Object name, interface label, accessible name, localized value, and
 * current non-result announcement source changes in place (P14-G2,
 * REQ-055, REQ-058): the heading, the MORE! control's visible text and
 * accessible name, the selected Food Object's visible name and the
 * localized sr-only region value, the quantity and unit accessible names,
 * the plural Serving option label, the macronutrient and similarity
 * labels, the calories accessible name, the one-decimal localized numeric
 * values, and the loading and recalculation busy announcements all follow
 * the active dictionary. A request ledger proves each language action
 * starts zero suggestion GETs, Substitute POSTs, retries, or other HTTP
 * requests and changes no retained request or result identity (P14-G5).
 * The same scenario changes the language while the quantity draft is
 * invalid and again after the text becomes valid (P14-G4, REQ-026): the
 * exact raw draft and the invalid state stay retained while the localized
 * field message changes in place, and a later valid commit starts exactly
 * one request with the unchanged committed identity.
 */

const PREVIEW_ORIGIN = "http://127.0.0.1:4173";

/** The persisted Interface Language key (ARCH-014, ISSUE-007). */
const STORAGE_KEY = "obiad.interfaceLanguage";

/** The exact unfinished Search Query retained across the language changes. */
const UNFINISHED_QUERY = "chick";

/** The exact ISSUE-007 copy of the two supported dictionaries. */
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

/**
 * The deterministic seeded suggestion lists for the retained unfinished
 * query `chick` in both Interface Languages (verified against the real
 * Fiber process and the freshly seeded PostgreSQL catalog; seed migration
 * `0005_seed_food_catalog.sql`). REQ-013: English mode compares and renders
 * English names, Polish mode Polish names, for the same retained query.
 */
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

/**
 * The exact ISSUE-007 copy of every current result-surface interface and
 * accessibility string (task 44; REQ-055, REQ-058). Together with the
 * Search-side `COPY` above, the two blocks cover every current English and
 * Polish interface string of the rendered application (P14-G6).
 */
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

/**
 * The seeded Pizza Margherita page-2 ranking (ISSUE-002, REQ-072): the
 * displayed page whose index and exact ordered result IDs must stay
 * retained through the task-44 language change (P14-G2, REQ-058).
 */
const PIZZA_PAGE_2_IDS = [14, 4, 21] as const;

/** The seeded page-2 localized Food Object names (seed migration 0005). */
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

/** Records every browser request into the ledger. */
function trackRequests(page: Page, ledger: string[]): void {
  page.on("request", (request) => ledger.push(request.url()));
}

/** The recorded `GET /api/v1/food-suggestions` request URLs. */
function suggestionGets(ledger: readonly string[]): string[] {
  return ledger.filter((url) => url.includes("/api/v1/food-suggestions"));
}

/** The recorded `POST /api/v1/substitutes/search` request URLs. */
function substitutePosts(ledger: readonly string[]): string[] {
  return ledger.filter((url) => url.includes("/api/v1/substitutes/search"));
}

/** The current selection range of the Search field. */
async function selectionRange(search: Locator): Promise<{
  start: number;
  end: number;
}> {
  return search.evaluate((element) => {
    const input = element as HTMLInputElement;
    return {
      start: input.selectionStart ?? -1,
      end: input.selectionEnd ?? -1,
    };
  });
}

/** Asserts the current persisted value under the Interface Language key. */
async function expectStored(page: Page, value: string | null): Promise<void> {
  const stored = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    STORAGE_KEY,
  );
  expect(stored).toBe(value);
}

/**
 * Asserts the complete P14-G3 surface after one real language selection:
 * Search loses focus, the Search selection range collapses, the live
 * suggestion list closes, `aria-activedescendant` clears, the exact
 * unfinished Search Query text stays retained, and the active dictionary
 * already applies to the field placeholder (REQ-059).
 */
async function expectSearchSideLanguageChange(
  page: Page,
  search: Locator,
  panel: Locator,
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  // Search loses focus to the Interface Language control.
  await expect(
    page.getByRole("combobox", { name: copy.control }),
  ).toBeFocused();
  await expect(search).not.toBeFocused();

  // The selection range and the live suggestion list close; the combobox
  // contract returns to the closed state (REQ-059, ARCH-020).
  const range = await selectionRange(search);
  expect(
    range.start,
    "the Search selection range collapses on the language change",
  ).toBe(range.end);
  await expect(panel).toHaveCount(0);
  await expect(search).not.toHaveAttribute("aria-activedescendant");
  await expect(search).toHaveAttribute("aria-expanded", "false");

  // The exact unfinished Search Query stays retained, and the active
  // dictionary already applies to the field (REQ-059).
  await expect(search).toHaveValue(UNFINISHED_QUERY);
  await expect(search).toHaveAttribute("placeholder", copy.placeholder);
}

/**
 * Asserts that the live suggestion panel renders exactly the deterministic
 * seeded options in the selected Interface Language (REQ-013, REQ-055) with
 * the first option as the active descendant.
 */
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

/** One observed generated-client Substitution Search POST (task 44). */
interface SubstitutePost {
  body: {
    foodObjectId?: number;
    quantity?: { value: number; unit: string };
    pageIndex?: number;
  };
  status: number | null;
}

/**
 * Records every generated-client `POST /api/v1/substitutes/search` request
 * with the parsed body and the status of its real-stack response. The
 * scenario uses the observed bodies to prove that a language action starts
 * no request and changes no retained request or result identity (P14-G5).
 */
function trackSubstitutePosts(page: Page): SubstitutePost[] {
  const posts: SubstitutePost[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/v1/substitutes/search")
    ) {
      posts.push({
        body: request.postDataJSON() as SubstitutePost["body"],
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

/** Returns the Food Object IDs of all currently rendered result cards. */
async function renderedCardIDs(page: Page): Promise<number[]> {
  const cards = page.locator("[data-result-card]");
  return cards.evaluateAll((elements) =>
    elements.map((element) =>
      Number(element.getAttribute("data-food-object-id")),
    ),
  );
}

/**
 * Asserts that one macronutrient value renders with exactly one decimal
 * place in the active locale: a dot separator in English and a comma in
 * Polish (task 44, REQ-058, REQ-039).
 */
async function expectMacroLocale(
  page: Page,
  selector: string,
  locale: "en" | "pl",
): Promise<void> {
  const text = await page.locator(selector).first().textContent();
  expect(text ?? "").toMatch(locale === "en" ? /^\d+\.\d g$/ : /^\d+,\d g$/);
}

/**
 * Asserts the complete task-44 current-result surface of the displayed
 * page-2 state (P14-G2, REQ-055, REQ-058): the exact ordered result IDs,
 * the localized heading, the MORE! control's visible text and accessible
 * name, the selected Food Object's visible name and the localized sr-only
 * region value, the quantity and unit accessible names, the plural Serving
 * option label, every macronutrient and similarity label, the calories
 * accessible name, the one-decimal localized numeric values, and the
 * active-dictionary Search placeholder and accessible name.
 */
async function expectPage2Surface(
  page: Page,
  copy: (typeof RESULT_COPY)[keyof typeof RESULT_COPY],
  names: (typeof PAGE_2_COPY)[keyof typeof PAGE_2_COPY],
  searchCopy: (typeof COPY)[keyof typeof COPY],
  locale: "en" | "pl",
): Promise<void> {
  // The exact ordered result IDs of displayed page 2 stay retained
  // (REQ-058, P14-G2).
  await expect.poll(() => renderedCardIDs(page)).toEqual([...PIZZA_PAGE_2_IDS]);
  await expect(page.locator("main")).toHaveAttribute(
    "data-interaction-state",
    "results",
  );

  // The localized heading and the MORE! control's visible text and
  // accessible name.
  await expect(page.getByRole("heading", { name: copy.heading })).toBeVisible();
  const more = page.locator("[data-more-button]");
  await expect(more).toHaveText(copy.more);
  await expect(more).toHaveAttribute("aria-label", copy.more);

  // The selected Food Object's visible name and the localized sr-only
  // region value (`Selected food` / `Wybrany produkt` with the localized
  // Serving unit).
  await expect(page.locator("[data-selected-name]")).toHaveText(names.selected);
  const srOnlyTexts = await page
    .locator("[data-selected-food-summary] .sr-only")
    .allTextContents();
  expect(srOnlyTexts).toContain(
    `${copy.selectedFood}: ${names.selected} · 1 ${copy.serving}`,
  );
  expect(srOnlyTexts).toContain(copy.quantity);
  expect(srOnlyTexts).toContain(copy.unit);

  // The quantity number field's accessible name and value, and the unit
  // selector's localized plural Serving option label.
  await expect(page.getByRole("textbox", { name: copy.quantity })).toHaveValue(
    "1",
  );
  const unitSelect = page.locator("[data-quantity-unit]");
  await expect(unitSelect).toHaveValue("serving");
  await expect(unitSelect.locator("option")).toHaveText([copy.servings, "g"]);

  // The calories accessible name on the input summary and on every card.
  await expect(page.locator("[data-input-calories]")).toHaveAttribute(
    "aria-label",
    copy.calories,
  );
  await expect(
    page.locator("[data-result-card-calories]").first(),
  ).toHaveAttribute("aria-label", copy.calories);

  // The visible macronutrient and similarity labels of the summary and of
  // the first ranked card.
  await expect(page.locator("[data-input-macronutrients] dt")).toHaveText([
    copy.protein,
    copy.carbohydrates,
    copy.fat,
  ]);
  await expect(
    page.locator("[data-result-card]").first().locator("dl dt"),
  ).toHaveText([copy.protein, copy.carbohydrates, copy.fat, copy.similarity]);

  // The card names in exact rank order.
  const cardNames = await page
    .locator("[data-result-card] h3")
    .allTextContents();
  expect(cardNames).toEqual(names.cards);

  // The localized one-decimal numeric values of the summary and cards.
  await expectMacroLocale(page, "[data-input-macro-protein]", locale);
  await expectMacroLocale(page, "[data-input-macro-carbohydrate]", locale);
  await expectMacroLocale(page, "[data-input-macro-fat]", locale);
  await expectMacroLocale(
    page,
    "[data-result-card] [data-card-content] dl dd",
    locale,
  );

  // The Search field follows the active dictionary for its accessible name
  // and placeholder while retaining the exact selected-name text.
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

    // P14-G6, REQ-056: a fresh en-US context initializes in English. The
    // Search label and placeholder, the Interface Language control, and the
    // startup no-request contract hold (REQ-055, REQ-056, P06-G3). The
    // Search field locator is language-invariant because its accessible
    // name follows the active dictionary.
    const search = page.locator('input[type="search"]');
    await expect(search).toHaveAttribute("placeholder", COPY.en.placeholder);
    await expect(
      page.getByRole("combobox", { name: COPY.en.control }),
    ).toHaveValue("en");
    expect(ledger.some((url) => url.includes("/api/"))).toBe(false);
    for (const url of ledger) {
      expect(new URL(url).origin).toBe(PREVIEW_ORIGIN);
    }

    // A focused nonempty Search Query opens the live English suggestion
    // list with the exact seeded English names (REQ-012, REQ-013).
    await search.fill(UNFINISHED_QUERY);
    await expectSuggestionPanel(page, SEEDED_SUGGESTIONS.en, COPY.en);

    // Case A — a real language selection with a nonempty Search selection
    // range: clicking the field selects its whole query text (the Search
    // control's click-to-select action), so the selection range is nonempty
    // when the language changes (P14-G3, REQ-059).
    await search.click();
    const before = await selectionRange(search);
    expect(
      before.start,
      "the Search selection range is nonempty before the language change",
    ).toBeLessThan(before.end);

    // The language action itself starts no HTTP request (P14-G5): the
    // ledger stays byte-for-byte unchanged across the real selection. The
    // control is focused first — like a real pointer or keyboard
    // interaction — which moves focus away from the Search field before
    // the selection commits.
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

    // P14-G3, REQ-059: Search loses focus, the selection range and the
    // suggestion list close, aria-activedescendant clears, and the query
    // stays exact. The one language store updated and persisted (REQ-057).
    await expectSearchSideLanguageChange(
      page,
      search,
      page.getByRole("listbox"),
      COPY.pl,
    );
    await expectStored(page, "pl");

    // The next Search focus starts exactly one fresh suggestion GET with
    // the selected Interface Language and the retained query (P14-G5,
    // REQ-013, ARCH-019): no inactive data is reused.
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

    // Case B — repeat the real language selection with the exact unfinished
    // Search Query text (the panel is open and Search focused, with no
    // selection in the field). The same P14-G3 surface holds (P14-G3,
    // REQ-059), and the action again starts no HTTP request (P14-G5).
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

    // The next Search focus again starts exactly one fresh English
    // suggestion GET with the retained query (P14-G5, REQ-013).
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

    // P14-G6, REQ-057: the persisted selection stays active after reload
    // with the English dictionary and no startup application request.
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

    // The complete ledger proves the request contract: exactly one fresh
    // suggestion GET per Search focus intent — none for the language
    // actions, the reload, or the selection — and zero Substitute POSTs.
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

    // Hold the recalculation POST (4th) and the new-selection POST (5th)
    // at the browser boundary so the localized busy announcements can be
    // observed after the language change (P14-G2, P14-G6, REQ-058).
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

    // Drive a real English search to displayed page 2 of Pizza Margherita
    // (REQ-041, REQ-072): ranks 7 through 9 on pageIndex 2.
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

    // Exactly the three committed page requests so far, with the unchanged
    // Substitution Input identity (REQ-041).
    expect(posts.map((post) => post.body)).toEqual([
      {
        foodObjectId: 1,
        quantity: { value: 1, unit: "serving" },
        pageIndex: 0,
      },
      {
        foodObjectId: 1,
        quantity: { value: 1, unit: "serving" },
        pageIndex: 1,
      },
      {
        foodObjectId: 1,
        quantity: { value: 1, unit: "serving" },
        pageIndex: 2,
      },
    ]);

    // The complete English page-2 surface (P14-G2, REQ-055, REQ-058).
    await expectPage2Surface(
      page,
      RESULT_COPY.en,
      PAGE_2_COPY.en,
      COPY.en,
      "en",
    );

    // A real language selection on displayed page 2 (P14-G2, REQ-058). The
    // language action itself starts no HTTP request (P14-G5): the ledger
    // stays byte-for-byte unchanged across the real selection, exactly like
    // the Search-side repetition of the same collaboration.
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

    // The page index and the exact ordered result IDs stay retained while
    // every Food Object name, interface label, accessible name, localized
    // value, and non-result announcement source changes in place to the
    // active dictionary (P14-G2, REQ-055, REQ-058). The retained Search
    // text stays exactly the selected English name (REQ-059).
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

    // The page index and request identity are retained: a valid quantity
    // recalculation after the change requests the same displayed page 2
    // with the unchanged Food Object ID (P14-G2, P14-G5, REQ-028). The
    // held request exposes the localized recalculation announcement, whose
    // source now follows the Polish dictionary (P14-G6, REQ-055).
    const numberField = page.getByRole("textbox", {
      name: RESULT_COPY.pl.quantity,
    });
    await numberField.fill("2");
    await numberField.press("Enter");
    await expect.poll(() => posts.length).toBe(4);
    expect(posts[3]?.body).toEqual({
      foodObjectId: 1,
      quantity: { value: 2, unit: "serving" },
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

    // The current non-result announcement source changed in place: the
    // initial new Search in the selected language announces the localized
    // loading status (P14-G2, P14-G6, REQ-055). Selecting Milk (ID 10)
    // commits page 0 with the new identity.
    const plSearch = page.getByRole("combobox", { name: COPY.pl.search });
    await plSearch.fill("mleko");
    const milkOption = page.locator("#food-suggestion-option-10");
    await expect(milkOption).toBeVisible();
    await milkOption.click();
    await expect.poll(() => posts.length).toBe(5);
    expect(posts[4]?.body).toEqual({
      foodObjectId: 10,
      quantity: { value: 100, unit: "ml" },
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

    // P14-G4, REQ-026: an invalid quantity draft crosses a language change.
    // The exact raw text and the invalid state stay retained while the
    // localized field message changes in place; the language action starts
    // no request.
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

    // The validation message changes in place to the active language while
    // the exact raw draft, the invalid state, and the retained identity
    // stay unchanged (P14-G4, REQ-026). The number field's accessible name
    // follows the active dictionary, so it is re-located under the English
    // name.
    const englishNumberField = page.getByRole("textbox", {
      name: RESULT_COPY.en.quantity,
    });
    await expect(quantityError).toHaveText(RESULT_COPY.en.invalidQuantity);
    await expect(englishNumberField).toHaveValue("1.2.3");
    await expect(englishNumberField).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator('input[type="search"]')).toHaveValue("Mleko");
    expect(posts).toHaveLength(5);

    // After the text becomes valid the error clears and one valid commit
    // starts exactly one request with the unchanged committed identity
    // (P14-G4, REQ-026, REQ-028).
    await englishNumberField.fill("150");
    await expect(englishNumberField).not.toHaveAttribute("aria-invalid");
    await expect(quantityError).toHaveCount(0);
    await englishNumberField.press("Enter");
    await expect.poll(() => posts.length).toBe(6);
    expect(posts[5]?.body).toEqual({
      foodObjectId: 10,
      quantity: { value: 150, unit: "ml" },
      pageIndex: 0,
    });
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );

    // P14-G5: the complete ledger proves that each language action started
    // zero suggestion GETs, Substitute POSTs, retries, or other HTTP
    // requests, and that the retained request and result identity never
    // changed: exactly two suggestion GETs (the initial English query and
    // the Polish new search) and exactly six Substitution POSTs with the
    // unchanged committed identities above.
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
        quantity: { value: 1, unit: "serving" },
        pageIndex: 0,
      },
      {
        foodObjectId: 1,
        quantity: { value: 1, unit: "serving" },
        pageIndex: 1,
      },
      {
        foodObjectId: 1,
        quantity: { value: 1, unit: "serving" },
        pageIndex: 2,
      },
      {
        foodObjectId: 1,
        quantity: { value: 2, unit: "serving" },
        pageIndex: 2,
      },
      {
        foodObjectId: 10,
        quantity: { value: 100, unit: "ml" },
        pageIndex: 0,
      },
      {
        foodObjectId: 10,
        quantity: { value: 150, unit: "ml" },
        pageIndex: 0,
      },
    ]);
  });
});
