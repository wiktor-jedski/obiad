import { expect, test, type Page } from "@playwright/test";

/**
 * Real-stack normalized-empty Search Query no-op scenario (task 32;
 * ARCH-001, ARCH-002, ARCH-010, ARCH-017, ARCH-020, ARCH-022, REQ-021,
 * ISSUE-009; P09-G2, P09-G3).
 *
 * `bun run test:e2e` runs these tests against the complete disposable stack
 * started by `./e2e/launcher.ts`: disposable PostgreSQL 17 seeded by the
 * real setup command, the real Fiber process on the fixed loopback listener
 * 127.0.0.1:8080, and the optimized Vite preview on the strict port 4173.
 * The scenario starts in one fresh unauthenticated English Chromium context
 * and presses Enter in the Search field with the exact raw values empty,
 * ASCII-spaces-only, and mixed Unicode whitespace — `U+0085` NEXT LINE,
 * `U+00A0` NO-BREAK SPACE, `U+2003` EM SPACE, and `U+202F` NARROW NO-BREAK
 * SPACE. Every case must retain the exact field value, Search focus, and
 * the `empty` interaction state; render no validation message or invalid
 * state; and observe zero suggestion GETs and zero Substitution Search
 * POSTs (REQ-021, P09-G3). The first normalized-nonempty value then starts
 * exactly one live suggestion request, and drafting a normalized-empty
 * value over that open list closes it without another request, proving the
 * suggestion query is disabled for every normalized-empty draft
 * (ARCH-010, ISSUE-009). No editable Food Quantity control or validation
 * appears anywhere in the scenario, and no interaction-state variant is
 * involved.
 *
 * The existing `suggestion-keyboard.spec.ts` Enter-selection path runs
 * unchanged in the same suite: Enter with a normalized-nonempty open
 * suggestion still selects the active option (REQ-019, REQ-020).
 */

const COPY = {
  en: {
    search: "Search",
    listbox: "Suggestions",
  },
} as const;

/** The exact empty raw Search Query. */
const EMPTY = "";
/** The ASCII-spaces-only raw Search Query. */
const ASCII_SPACES = "   ";
/**
 * The mixed Unicode-whitespace-only raw Search Query: `U+0085` NEXT LINE,
 * `U+00A0` NO-BREAK SPACE, `U+2003` EM SPACE, and `U+202F` NARROW NO-BREAK
 * SPACE — every character is whitespace under Go's `unicode.IsSpace`, so
 * the ARCH-017 normalization contract produces an empty Search Query
 * (ISSUE-009).
 */
const MIXED_UNICODE_WHITESPACE = "\u0085\u00A0\u2003\u202F";

/** A stable label for one raw value in failure messages. */
function labelOf(raw: string): string {
  if (raw === EMPTY) {
    return "empty";
  }
  if (raw === ASCII_SPACES) {
    return "ASCII-spaces-only";
  }
  return "mixed Unicode whitespace";
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

test.describe("normalized-empty Search Query no-op", () => {
  test("Enter with empty, ASCII-spaces-only, and mixed-Unicode-whitespace-only values keeps the exact raw value, Search focus, and the empty state with no request, and the first normalized-nonempty value starts one live suggestion request", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);

    // Observe every suggestion GET and Substitution Search POST the
    // browser starts. The no-op contract requires zero of each for every
    // normalized-empty case (REQ-021, P09-G3).
    const suggestionGets: string[] = [];
    const substitutePosts: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("/api/v1/food-suggestions")) {
        suggestionGets.push(url);
      }
      if (
        request.method() === "POST" &&
        url.includes("/api/v1/substitutes/search")
      ) {
        substitutePosts.push(url);
      }
    });

    await page.goto("/");
    const search = page.getByRole("combobox", { name: COPY.en.search });

    // One fresh unauthenticated English Chromium context with no startup
    // request (P09-G2): the page renders the empty-state Search control and
    // nothing has been fetched yet.
    expect(suggestionGets).toHaveLength(0);
    expect(substitutePosts).toHaveLength(0);

    // P09-G3, REQ-021: every normalized-empty raw value is a strict
    // browser no-op on Enter. The exact raw value stays in the field,
    // Search keeps focus, the interaction state stays `empty`, no
    // validation message or invalid state renders, and zero suggestion
    // GETs and zero Substitution Search POSTs start.
    for (const raw of [EMPTY, ASCII_SPACES, MIXED_UNICODE_WHITESPACE]) {
      await search.fill(raw);
      await search.press("Enter");

      await expect(
        search,
        `${labelOf(raw)} keeps the exact raw value`,
      ).toHaveValue(raw);
      await expect(search, `${labelOf(raw)} keeps Search focus`).toBeFocused();
      await expect(page.locator("main")).toHaveAttribute(
        "data-interaction-state",
        "empty",
      );
      await expect(
        search,
        `${labelOf(raw)} renders no invalid state`,
      ).not.toHaveAttribute("aria-invalid");
      await expect(
        page.getByRole("alert"),
        `${labelOf(raw)} renders no validation message`,
      ).toHaveCount(0);
      await expect(search).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("listbox")).toHaveCount(0);
      expect(
        suggestionGets,
        `${labelOf(raw)} starts no suggestion request`,
      ).toHaveLength(0);
      expect(
        substitutePosts,
        `${labelOf(raw)} starts no Substitution Search`,
      ).toHaveLength(0);
    }

    // The first normalized-nonempty value starts one live suggestion
    // request through the generated client and the real stack: the panel
    // opens with exactly five seeded options and exactly one observed GET
    // carries the raw value unchanged (REQ-012, ARCH-010).
    await search.fill("chicken");
    const panel = page.getByRole("listbox", { name: COPY.en.listbox });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("option")).toHaveCount(5);
    expect(suggestionGets, "one live suggestion request").toHaveLength(1);
    expect(
      new URL(suggestionGets[0]).searchParams.get("query"),
      "the suggestion request carries the exact raw value",
    ).toBe("chicken");
    expect(
      substitutePosts,
      "typing starts no Substitution Search",
    ).toHaveLength(0);

    // Drafting a normalized-empty value over the open list disables the
    // suggestion query for that draft (ARCH-010, ISSUE-009): the panel
    // closes, no second request starts, and the exact raw value, Search
    // focus, and the empty interaction state stay unchanged.
    await search.fill(MIXED_UNICODE_WHITESPACE);
    await expect(panel).toHaveCount(0);
    await expect(search).toHaveValue(MIXED_UNICODE_WHITESPACE);
    await expect(search).toBeFocused();
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "empty",
    );
    expect(
      suggestionGets,
      "a normalized-empty draft starts no suggestion request",
    ).toHaveLength(1);
    expect(substitutePosts).toHaveLength(0);

    // No editable Food Quantity control or validation appears anywhere in
    // the Phase 9 surface: the Search field is the only input on the page,
    // and the interaction state union gained no variant.
    await expect(page.locator("input")).toHaveCount(1);
  });
});
