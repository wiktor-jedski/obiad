import { expect, test, type Page } from "@playwright/test";

/**
 * Real-stack pointer-selection and new-search transition scenario
 * (task 28; ARCH-001, ARCH-002, ARCH-003, ARCH-008, ARCH-010, ARCH-011,
 * ARCH-019, ARCH-020, ARCH-022, REQ-020, REQ-022, REQ-023, REQ-024,
 * REQ-046, REQ-064, ISSUE-005, ISSUE-008; P07-G8, P07-G9, P07-G10,
 * P07-G11, P07-G17, P07-G18, P07-G19).
 *
 * `bun run test:e2e` runs these tests against the complete disposable stack
 * started by `./e2e/launcher.ts`: disposable PostgreSQL 17 seeded by the
 * real setup command, the real Fiber process on the fixed loopback listener
 * 127.0.0.1:8080, and the optimized Vite preview on the strict port 4173.
 * The scenario starts in a fresh unauthenticated browser context and drives
 * real pointer activation: it selects the third displayed suggestion and
 * observes exactly one generated-client `POST /api/v1/substitutes/search`
 * whose body carries that option's Food Object ID, the unchanged default
 * quantity, and page index `0`; the successful page and the read-only
 * selected-input region identify the same Food Object with no second submit
 * action. Separate seeded Pizza Margherita, Chicken breast, and Milk flows
 * show the exact localized label and value, send `1 serving`, `100 g`, and
 * `100 ml`, and retain the captured result language. One controlled
 * response fetched from real Fiber and PostgreSQL stays pending at the
 * browser boundary while the new-search spinner remains `12px` below the
 * Search field; fulfillment removes the spinner and leaves the Search field
 * as `document.activeElement` (REQ-046, REQ-064).
 */

const SPINNER_OFFSET_PX = 12;
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

/**
 * The deterministic seeded suggestion lists for the queries the scenario
 * drives (verified against the real Fiber process and the freshly seeded
 * PostgreSQL catalog; seed migration `0005_seed_food_catalog.sql`).
 * `foodObjectId` is the seeded stable ID and `name` is the localized name
 * the panel renders for the active Interface Language (REQ-013).
 */
const SEEDED_SUGGESTIONS = {
  en: {
    chicken: [
      { foodObjectId: 10, name: "Milk" },
      { foodObjectId: 26, name: "Pancakes" },
      { foodObjectId: 18, name: "Butter" },
      { foodObjectId: 36, name: "Cheesecake" },
      { foodObjectId: 30, name: "Pho" },
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

/**
 * The backend-derived default Food Quantities the suggestion response
 * carries for the seeded fixtures (verified against the real stack):
 * `1 serving` for Pizza Margherita, the `100 g` Nutrition Basis for the
 * solid Chicken breast and Butter, and the `100 ml` Nutrition Basis for the
 * liquid Milk (REQ-023, REQ-024). The scenarios additionally compare the
 * POST body against the default quantity observed in the real suggestion
 * response, proving the client sends it unchanged.
 */
const SEEDED_DEFAULTS = {
  1: { value: 1, unit: "serving" },
  5: { value: 100, unit: "g" },
  10: { value: 100, unit: "ml" },
  18: { value: 100, unit: "g" },
} as const;

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
 * and the status of its real-stack response. The scenario uses the observed
 * bodies to prove exactly one Substitution Search per selection with the
 * expected `foodObjectId`, unchanged quantity, and page `0` (REQ-022).
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
 * so the scenarios can prove the POST quantity is unchanged (REQ-023,
 * REQ-024): the request body must equal exactly the default quantity the
 * real suggestion response returned for the clicked Food Object.
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
 * ranked order with the stable option ids and the first option as the
 * active descendant (REQ-018, REQ-013). The full panel geometry and colors
 * belong to `search-suggestions.spec.ts`; here the list is a precondition
 * for pointer selection.
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

/** The read-only Substitution Input region (task 28). */
function selectedInput(page: Page) {
  return page.locator("[data-selected-input]");
}

/**
 * Asserts the read-only Substitution Input region shows the exact localized
 * label and the captured `localized name · quantity unit` value (ISSUE-008).
 */
async function expectSelectedInput(
  page: Page,
  copy: (typeof COPY)[keyof typeof COPY],
  value: string,
): Promise<void> {
  await expect(selectedInput(page)).toContainText(copy.selectedFood);
  await expect(selectedInput(page)).toContainText(value);
}

/**
 * Asserts that the Substitution Search POST body carries exactly the
 * clicked Food Object ID, the unchanged default quantity (both the seeded
 * default and the one the real suggestion response returned), and page `0`,
 * and that the real-stack response succeeded (REQ-020, REQ-022, REQ-023,
 * REQ-024, ISSUE-005).
 */
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
  // The quantity is unchanged: it equals the default the real suggestion
  // response returned for the same Food Object (REQ-023, REQ-024).
  await expect
    .poll(() => observedDefaults.get(foodObjectId))
    .toEqual(expectedQuantity);
  // The real-stack response status arrives with the response event, which
  // may follow the request event by a tick; poll instead of asserting once.
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

    // A normal Search Query opens the five seeded suggestions in the empty
    // interaction state (task 27, REQ-012).
    await search.fill("chicken");
    await expectSuggestionPanel(page, SEEDED_SUGGESTIONS.en.chicken, COPY.en);
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "empty",
    );

    // Select the third displayed option (Butter, Food Object 18) with a
    // pointer (REQ-020, P07-G8).
    const options = page
      .getByRole("listbox", { name: COPY.en.listbox })
      .getByRole("option");
    await expect(options.nth(2)).toHaveText("Butter");
    await expect(options.nth(2)).toHaveAttribute("id", optionId(18));
    await options.nth(2).click();

    // The suggestion list closes while Search keeps focus and text; the
    // interaction state moves to the loadingNew transition and then to
    // results when the page-0 response arrives (ARCH-002, ARCH-010).
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(search).toHaveValue("chicken");
    await expect(search).not.toHaveAttribute("aria-activedescendant");
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );

    // Exactly one generated-client POST with the third option's Food Object
    // ID, the unchanged 100 g default, and page 0 (REQ-022, REQ-023,
    // REQ-024, P07-G9, P07-G10).
    await expectSubstitutePost(
      posts,
      18,
      SEEDED_DEFAULTS[18],
      observedDefaults,
    );

    // The read-only Substitution Input retains the selected localized name
    // and the returned default Food Quantity (ISSUE-008, REQ-023, REQ-024).
    await expectSelectedInput(page, COPY.en, "Butter · 100 g");

    // The successful page and the selected-input region identify the same
    // Food Object: the POST body carries Food Object 18 and the region shows
    // its name, with no second submit action (REQ-020, REQ-022, P07-G11).
    await page.waitForTimeout(400);
    expect(
      posts.length,
      "no second submit action after the successful page",
    ).toBe(1);
  });

  test("a controlled response fetched from real Fiber and PostgreSQL stays pending while the new-search spinner remains 12px below Search; fulfillment removes the spinner and leaves Search focused", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const posts = trackSubstitutePosts(page);

    // Hold the first Substitution Search POST at the browser boundary so the
    // real Fiber and PostgreSQL response stays pending until the scenario
    // releases it (REQ-046, P07-G17).
    let postCount = 0;
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
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

    // The selection started exactly one pending request and the state is the
    // loadingNew transition (REQ-022, ARCH-002).
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "loadingNew",
    );
    expect(posts).toHaveLength(1);

    // The new-search spinner stays 12px below the Search field for the
    // complete pending interval (REQ-046, P07-G17). The layout distance is
    // measured with offsetTop/offsetHeight: the spinner's CSS rotation
    // animation makes `boundingBox()` report the transformed axis-aligned
    // box, which moves with the rotation phase, while the layout box — the
    // space the spinner occupies — stays exactly 12px below the field.
    const spinner = page.locator("[data-new-search-spinner]");
    await expect(spinner).toBeVisible();
    const spinnerLayout = await page.evaluate(() => {
      const input = document.getElementById("food-search") as HTMLElement;
      const spin = document.querySelector(
        "[data-new-search-spinner]",
      ) as HTMLElement;
      return {
        offset: spin.offsetTop - (input.offsetTop + input.offsetHeight),
        parent: spin.offsetParent?.tagName,
      };
    });
    expect(spinnerLayout.parent).toBe("MAIN");
    expect(
      spinnerLayout.offset,
      "the spinner layout box starts 12px below the Search field",
    ).toBe(SPINNER_OFFSET_PX);

    // The read-only Substitution Input is already visible during the pending
    // interval (task 28).
    await expectSelectedInput(page, COPY.en, "Butter · 100 g");

    // Fulfillment removes the spinner, completes the transition to results,
    // and leaves the Search field as the active element (REQ-046, REQ-064,
    // P07-G18, P07-G19).
    releaseFirst();
    await expect(spinner).toHaveCount(0);
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    await expect(search).toBeFocused();
    await expect(page.locator("[data-selected-input]")).toContainText(
      "Butter · 100 g",
    );
    expect(posts).toHaveLength(1);
    await expect.poll(() => posts[0]?.status ?? null).toBe(200);
  });

  test("the Pizza Margherita flow sends 1 serving, shows the exact localized selected label and value, and retains the captured result language", async ({
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

    // Select the seeded Pizza Margherita (Food Object 1) with a pointer.
    await page.locator(`#${optionId(1)}`).click();
    await expectSubstitutePost(posts, 1, SEEDED_DEFAULTS[1], observedDefaults);
    await expectSelectedInput(page, COPY.en, "Pizza Margherita · 1 serving");

    // The captured active-content value never re-translates with the active
    // Interface Language; only the label follows the dictionary (ISSUE-008,
    // REQ-023).
    await page
      .getByRole("combobox", { name: COPY.en.languageControl })
      .selectOption("pl");
    await expectSelectedInput(page, COPY.pl, "Pizza Margherita · 1 serving");
    await expect(selectedInput(page)).not.toContainText(
      "Pizza margherita · 1 porcja",
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

    // Select the seeded Chicken breast (Food Object 5) with a pointer.
    await page.locator(`#${optionId(5)}`).click();
    await expectSubstitutePost(posts, 5, SEEDED_DEFAULTS[5], observedDefaults);
    await expectSelectedInput(page, COPY.en, "Chicken breast · 100 g");
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    expect(posts).toHaveLength(1);
  });

  test("the Milk flow sends 100 ml in Polish and retains the captured result language", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const posts = trackSubstitutePosts(page);
    const observedDefaults = trackSuggestionDefaults(page);

    await page.goto("/");
    // Switch through the real Interface Language control (task 26).
    await page
      .getByRole("combobox", { name: COPY.en.languageControl })
      .selectOption("pl");
    const search = page.getByRole("combobox", { name: COPY.pl.search });
    await search.fill("mleko");
    await expectSuggestionPanel(page, SEEDED_SUGGESTIONS.pl.mleko, COPY.pl);

    // Select the seeded Milk (Food Object 10) with a pointer; the default is
    // the 100 ml Nutrition Basis of the liquid (REQ-024).
    await page.locator(`#${optionId(10)}`).click();
    await expectSubstitutePost(
      posts,
      10,
      SEEDED_DEFAULTS[10],
      observedDefaults,
    );
    await expectSelectedInput(page, COPY.pl, "Mleko · 100 ml");

    // The captured Polish value survives an Interface Language switch back
    // to English; only the label follows the dictionary (ISSUE-008).
    await page
      .getByRole("combobox", { name: COPY.pl.languageControl })
      .selectOption("en");
    await expectSelectedInput(page, COPY.en, "Mleko · 100 ml");
    await expect(selectedInput(page)).not.toContainText("Milk · 100 ml");
    await expect(page.locator("main")).toHaveAttribute(
      "data-interaction-state",
      "results",
    );
    expect(posts).toHaveLength(1);
    await expect.poll(() => posts[0]?.status ?? null).toBe(200);
  });
});
