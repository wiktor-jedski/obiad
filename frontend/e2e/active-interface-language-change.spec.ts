import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Real-stack Search-side Interface Language change scenario (task 43;
 * ARCH-001, ARCH-002, ARCH-003, ARCH-010, ARCH-012, ARCH-014, ARCH-019,
 * ARCH-020, ARCH-022, REQ-013, REQ-055, REQ-056, REQ-057, REQ-059,
 * ISSUE-014; P14-G1, P14-G3, P14-G5, P14-G6).
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
});
