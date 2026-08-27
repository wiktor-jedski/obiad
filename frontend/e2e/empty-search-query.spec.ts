import { expect, test, type Page } from "@playwright/test";

const COPY = {
  en: {
    search: "Search",
    listbox: "Suggestions",
  },
} as const;

const EMPTY = "";

const ASCII_SPACES = "   ";

const MIXED_UNICODE_WHITESPACE = "\u0085\u00A0\u2003\u202F";

function labelOf(raw: string): string {
  if (raw === EMPTY) {
    return "empty";
  }
  if (raw === ASCII_SPACES) {
    return "ASCII-spaces-only";
  }
  return "mixed Unicode whitespace";
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

test.describe("normalized-empty Search Query no-op", () => {
  test("Enter with empty, ASCII-spaces-only, and mixed-Unicode-whitespace-only values keeps the exact raw value, Search focus, and the empty state with no request, and the first normalized-nonempty value starts one live suggestion request", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);

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

    expect(suggestionGets).toHaveLength(0);
    expect(substitutePosts).toHaveLength(0);

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

    await expect(page.locator("input")).toHaveCount(1);
  });
});
