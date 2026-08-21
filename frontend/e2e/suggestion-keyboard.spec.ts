import { expect, test, type Page } from "@playwright/test";

/**
 * Real-stack suggestion keyboard control scenario (task 31; ARCH-001,
 * ARCH-002, ARCH-010, ARCH-020, ARCH-022, REQ-018, REQ-019, REQ-020,
 * ISSUE-008; P07-G21).
 *
 * `bun run test:e2e` runs these tests against the complete disposable stack
 * started by `./e2e/launcher.ts`: disposable PostgreSQL 17 seeded by the
 * real setup command, the real Fiber process on the fixed loopback listener
 * 127.0.0.1:8080, and the optimized Vite preview on the strict port 4173.
 * The scenarios start in a fresh unauthenticated browser context and drive
 * the Search field entirely from the keyboard through the combobox/listbox
 * active-descendant pattern (REQ-019): option DOM focus never leaves the
 * Search input, exactly five options stay rendered while the list is open,
 * and no HTTP data is copied into local state — the active option index and
 * the Escape dismissal are local UI state, and TanStack Query keeps owning
 * the list.
 *
 * The first scenario observes the first option active (REQ-018), Arrow Up
 * clamped on the first option, Arrow Down moving through all five options
 * and clamped on the fifth, and each active option's stable DOM id
 * reflected by the Search input's `aria-activedescendant` with the matching
 * active styling. Enter on the third option starts exactly one
 * generated-client `POST /api/v1/substitutes/search` with that option's
 * returned default quantity and page index `0` — the identical selection
 * transition a pointer click uses (REQ-020) — and loads its page-0 result
 * with the Search field still focused (REQ-064). Typing a draft query over
 * those results keeps the committed selected input and cards visible,
 * keeps the Search field at its result-state position, and overlays five
 * suggestions above the result surface without a second POST. Escape
 * retains the Search Query text and Search focus with the list closed and
 * zero Substitution Search requests; typing a new query reopens exactly
 * five options. Tab closes the list, moves focus natively to the next
 * control, and starts zero Substitution Search requests. The existing
 * pointer scenarios in `pointer-substitution-search.spec.ts` run unchanged
 * in the same suite (P07-G21).
 */

const OPTION_COUNT = 5;
/** The keyboard-active option styling (ISSUE-008, search-suggestions.spec.ts). */
const PRIMARY_RGB = "rgb(74, 222, 128)";
const TEXT_ON_BRIGHT_RGB = "rgb(10, 15, 10)";
const TEXT_PRIMARY_RGB = "rgb(243, 244, 246)";

const COPY = {
  en: {
    search: "Search",
    listbox: "Suggestions",
    selectedFood: "Selected food",
    languageControl: "Interface language",
  },
} as const;

/**
 * The deterministic seeded suggestion list for the `chicken` query the
 * scenarios drive (verified against real Fiber and freshly seeded
 * PostgreSQL). The exact, prefix, substring, and fallback policy puts Polish
 * chicken soup third (REQ-076).
 */
const CHICKEN_SUGGESTIONS = [
  { foodObjectId: 5, name: "Chicken breast" },
  { foodObjectId: 22, name: "Fried chicken wings" },
  { foodObjectId: 17, name: "Polish chicken soup" },
  { foodObjectId: 10, name: "Milk" },
  { foodObjectId: 26, name: "Pancakes" },
] as const;

/**
 * The backend-derived default Food Quantity for Polish chicken soup: one
 * returned Serving (REQ-023, REQ-024).
 */
const CHICKEN_SOUP_DEFAULT = { value: 1, unit: "serving" } as const;

/** The stable option DOM id of one suggestion (suggestions.ts). */
function optionId(foodObjectId: number): string {
  return `food-suggestion-option-${foodObjectId}`;
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

/** One observed generated-client Substitution Search POST. */
interface SubstitutePost {
  /** The parsed JSON request body (closed request object, ISSUE-005). */
  body: Record<string, unknown>;
  /** The HTTP status of the real-stack response, once it arrives. */
  status: number | null;
}

/**
 * Records every generated-client `POST /api/v1/substitutes/search` request
 * and the status of its real-stack response. The scenarios use the observed
 * bodies to prove zero Substitution Searches for Escape and Tab, and
 * exactly one for the Enter selection (REQ-019, REQ-022).
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

/**
 * Records the `defaultQuantity` each Food Object suggestion response carries
 * so the Enter scenario can prove the POST quantity is unchanged (REQ-023,
 * REQ-024): the request body must equal exactly the default quantity the
 * real suggestion response returned for the selected Food Object.
 */
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

/**
 * Asserts that the panel renders exactly the expected seeded suggestions in
 * ranked order with the stable option ids (REQ-013, REQ-002). The full
 * panel geometry and resting colors belong to `search-suggestions.spec.ts`;
 * here the list is a precondition for keyboard operation.
 */
async function expectOpenPanel(page: Page): Promise<void> {
  const search = page.getByRole("combobox", { name: COPY.en.search });
  const panel = page.getByRole("listbox", { name: COPY.en.listbox });
  const options = panel.getByRole("option");

  await expect(panel).toBeVisible();
  await expect(options).toHaveCount(OPTION_COUNT);
  for (let index = 0; index < OPTION_COUNT; index += 1) {
    await expect(options.nth(index)).toHaveText(
      CHICKEN_SUGGESTIONS[index].name,
    );
    await expect(options.nth(index)).toHaveAttribute(
      "id",
      optionId(CHICKEN_SUGGESTIONS[index].foodObjectId),
    );
  }
  await expect(search).toHaveAttribute("aria-expanded", "true");
}

/**
 * Asserts that the option at `index` is the keyboard-active option: it
 * carries `aria-selected`, renders with Primary and Text-On-Bright, every
 * other option renders resting, and the Search input's
 * `aria-activedescendant` references exactly its stable id (REQ-018,
 * REQ-019, ARCH-020).
 */
async function expectActiveOption(page: Page, index: number): Promise<void> {
  const search = page.getByRole("combobox", { name: COPY.en.search });
  const options = page
    .getByRole("listbox", { name: COPY.en.listbox })
    .getByRole("option");

  for (let optionIndex = 0; optionIndex < OPTION_COUNT; optionIndex += 1) {
    await expect(options.nth(optionIndex)).toHaveAttribute(
      "aria-selected",
      String(optionIndex === index),
    );
    if (optionIndex === index) {
      await expect(options.nth(optionIndex)).toHaveCSS(
        "background-color",
        PRIMARY_RGB,
      );
      await expect(options.nth(optionIndex)).toHaveCSS(
        "color",
        TEXT_ON_BRIGHT_RGB,
      );
    } else {
      await expect(options.nth(optionIndex)).toHaveCSS(
        "color",
        TEXT_PRIMARY_RGB,
      );
    }
  }
  await expect(search).toHaveAttribute(
    "aria-activedescendant",
    optionId(CHICKEN_SUGGESTIONS[index].foodObjectId),
  );
}

/** The read-only Substitution Input region (task 28). */
function selectedInput(page: Page) {
  return page.locator("[data-selected-input]");
}

test.describe("suggestion keyboard control", () => {
  test("keyboard selection loads results, then draft typing keeps those results and overlays fresh suggestions without moving Search or starting another POST", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const posts = trackSubstitutePosts(page);
    const observedDefaults = trackSuggestionDefaults(page);

    await page.goto("/");
    const search = page.getByRole("combobox", { name: COPY.en.search });

    // A normal Search Query opens the five seeded suggestions with the
    // first option active (REQ-018).
    await search.fill("chicken");
    await expectOpenPanel(page);
    await expectActiveOption(page, 0);
    await expect(search).toBeFocused();

    // Arrow Up is clamped on the first option: the active descendant and
    // the active styling stay on the first option (REQ-019).
    await search.press("ArrowUp");
    await expectActiveOption(page, 0);

    // Arrow Down moves through all five options; each move updates the
    // active styling and the stable id in aria-activedescendant.
    await search.press("ArrowDown");
    await expectActiveOption(page, 1);
    await search.press("ArrowDown");
    await expectActiveOption(page, 2);
    await search.press("ArrowDown");
    await expectActiveOption(page, 3);
    await search.press("ArrowDown");
    await expectActiveOption(page, 4);

    // Arrow Down is clamped on the fifth option (REQ-019).
    await search.press("ArrowDown");
    await expectActiveOption(page, 4);
    await expect(page.getByRole("listbox")).toHaveCount(1);

    // Move back to the third option (Polish chicken soup, Food Object 17).
    await search.press("ArrowUp");
    await expectActiveOption(page, 3);
    await search.press("ArrowUp");
    await expectActiveOption(page, 2);

    // Enter selects the active option through the same selection transition
    // a pointer click uses: exactly one generated-client POST with the third
    // option's Food Object ID, unchanged one-serving default, and page 0.
    // The page-0 result loads with Search still focused (REQ-019, REQ-020,
    // REQ-022, REQ-023, REQ-024, REQ-064).
    await search.press("Enter");

    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(search).toHaveValue("Polish chicken soup");
    await expect(search).not.toHaveAttribute("aria-activedescendant");
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );

    expect(posts, "exactly one Substitution Search POST").toHaveLength(1);
    expect(posts[0].body).toEqual({
      foodObjectId: 17,
      quantity: CHICKEN_SOUP_DEFAULT,
      pageIndex: 0,
    });
    // The quantity equals the default returned for the same Food Object.
    await expect
      .poll(() => observedDefaults.get(17))
      .toEqual(CHICKEN_SOUP_DEFAULT);
    await expect.poll(() => posts[0]?.status ?? null).toBe(200);

    // The page-0 result loaded: the read-only Substitution Input retains
    // the selected localized name and default quantity, the result region
    // renders the result cards, and Search keeps focus (REQ-064).
    await expect(selectedInput(page)).toContainText(COPY.en.selectedFood);
    await expect(selectedInput(page)).toContainText(
      "Polish chicken soup · 1 serving",
    );
    await expect(page.locator("[data-result-card]").first()).toBeVisible();
    await expect(search).toBeFocused();

    // Drafting a later query does not discard or move the committed result.
    // The fresh panel continuously extends Search and overlays the
    // selected-input/result surface; no second POST occurs until a
    // suggestion is selected.
    const committedSearchBox = await search.boundingBox();
    await search.fill("olive");
    const draftPanel = page.getByRole("listbox", {
      name: COPY.en.listbox,
    });
    await expect(draftPanel).toBeVisible();
    await expect(draftPanel.getByRole("option")).toHaveCount(OPTION_COUNT);
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    await expect(selectedInput(page)).toContainText(
      "Polish chicken soup · 1 serving",
    );
    await expect(page.locator("[data-result-card]").first()).toBeVisible();

    const draftSearchBox = await search.boundingBox();
    const panelBox = await draftPanel.boundingBox();
    const selectedBox = await selectedInput(page).boundingBox();
    expect(draftSearchBox?.y).toBe(committedSearchBox?.y);
    expect(
      Math.abs(
        (panelBox?.y ?? 0) -
          ((draftSearchBox?.y ?? 0) + (draftSearchBox?.height ?? 0)),
      ),
    ).toBeLessThanOrEqual(1);
    expect((panelBox?.y ?? 0) + (panelBox?.height ?? 0)).toBeGreaterThan(
      selectedBox?.y ?? Number.POSITIVE_INFINITY,
    );
    await expect(draftPanel).toHaveCSS("z-index", "20");
    expect(
      posts,
      "no second submit action after the successful page",
    ).toHaveLength(1);
  });

  test("Escape closes the list while retaining the Search Query text and Search focus, starts zero Substitution Searches, and typing reopens exactly five options", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const posts = trackSubstitutePosts(page);

    await page.goto("/");
    const search = page.getByRole("combobox", { name: COPY.en.search });

    await search.fill("chicken");
    await expectOpenPanel(page);
    await expectActiveOption(page, 0);

    // Escape closes the list while retaining the Search Query text and
    // Search focus, and starts no Substitution Search (REQ-019, ISSUE-008).
    await search.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(search).toHaveValue("chicken");
    await expect(search).toBeFocused();
    await expect(search).not.toHaveAttribute("aria-activedescendant");
    await expect(search).toHaveAttribute("aria-expanded", "false");
    expect(posts, "Escape must not start a Substitution Search").toHaveLength(
      0,
    );

    // A changed Search Query is a new intent: exactly five options open
    // again (REQ-012).
    await search.fill("pizza");
    await expect(page.getByRole("listbox")).toBeVisible();
    await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(
      OPTION_COUNT,
    );
    expect(posts).toHaveLength(0);
  });

  test("Tab closes the list, moves focus natively to the next control, and starts zero Substitution Searches", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const posts = trackSubstitutePosts(page);

    await page.goto("/");
    const search = page.getByRole("combobox", { name: COPY.en.search });

    await search.fill("chicken");
    await expectOpenPanel(page);
    await expectActiveOption(page, 0);

    // Tab has no handler: the browser's native focus movement blurs the
    // field, the list closes, and no Substitution Search starts. The next
    // focusable control in the primary column is the Interface Language
    // dropdown (REQ-019, ARCH-020).
    await search.press("Tab");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(search).not.toHaveAttribute("aria-activedescendant");
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await expect(
      page.getByRole("combobox", { name: COPY.en.languageControl }),
    ).toBeFocused();
    expect(posts, "Tab must not start a Substitution Search").toHaveLength(0);
  });
});
