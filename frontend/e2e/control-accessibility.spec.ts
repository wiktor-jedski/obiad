import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

/**
 * Real-stack accessible-name scenario (task 47; ARCH-001, ARCH-003,
 * ARCH-010, ARCH-011, ARCH-020, ARCH-022, REQ-068; P15-G7).
 *
 * `bun run test:e2e` runs the "Control accessibility" describe against the
 * complete disposable stack started by `./e2e/launcher.ts`: disposable
 * PostgreSQL 17 seeded by the real setup command, the real Fiber process
 * on the fixed loopback listener 127.0.0.1:8080, and the optimized Vite
 * preview on the strict port 4173. The scenario drives every reachable
 * rendered interaction state — empty, open-suggestion, loading-new,
 * results, quantity-validation, and loading-more — in English and Polish,
 * and resolves each rendered interactive browser control by its exact
 * localized accessible name (REQ-068): the Search combobox and the
 * suggestion listbox with its options, the Interface Language selector,
 * the Food Quantity number and unit controls, and the MORE! control.
 *
 * For each state it proves:
 *   - every rendered interactive control resolves to exactly one element
 *     by its exact English or Polish accessible name through the role
 *     locator (`getByRole`), so each control has one intended semantic
 *     role (native control roles are retained: the native `select`
 *     comboboxes, the native button, and the text input; the combobox
 *     active-descendant pattern keeps the Search input's `aria-controls`,
 *     `aria-expanded`, and `aria-activedescendant` pointing at the
 *     listbox and the active option);
 *   - no two rendered interactive controls share one accessible name, and
 *     no rendered interactive control lacks an accessible name — proven
 *     against the ARIA accessibility snapshot so no parallel control
 *     markup or duplicate naming can hide behind per-role locators;
 *   - the exact localized option names of the open suggestion panel and
 *     the unchanged combobox `aria-controls`, active-descendant, and
 *     option-name relationships (REQ-018).
 *
 * The pending states are observed through a browser-boundary gate that
 * holds each generated-client Substitution Search POST until the scenario
 * releases it (the established spinner-stop-time pattern, P12-G1); the
 * real response still passes through `route.continue()`, so no response
 * is fabricated (ARCH-022).
 *
 * ISSUE-015 records that a successful zero-result response is unreachable
 * with the supported deterministic catalog (ISSUE-003), so the accessible
 * names of the `zeroResults` surface are covered by the component
 * scenario `src/App.result-state.test.ts` under `bun test` — the same
 * narrow ARCH-022 seam that owns the zero-result focus transition.
 *
 * The "Control accessibility failure states" describe runs serially on
 * the separate outage stack (ARCH-022): the launcher hands the fixed
 * loopback listener to a second Fiber process backed by its own
 * disposable PostgreSQL container per outage suite and passes the
 * container name through `OBIAD_E2E_OUTAGE_CONTAINER`. The scenario
 * prepares successful English and Polish pages, stops only that stack's
 * PostgreSQL container (the outage Fiber keeps reporting catalog
 * unavailability), and then reaches the `newSearchFailure` and
 * `moreFailure` transitions, resolving the controls each failure surface
 * still renders by their exact localized accessible names.
 */

const COPY = {
  en: {
    search: "Search",
    searchPlaceholder: "Search foods",
    listbox: "Suggestions",
    languageControl: "Interface language",
    quantity: "Quantity",
    unit: "Unit",
    moreButton: "MORE!",
    invalidQuantity: "Enter a valid quantity.",
    chickenQuery: "chicken",
    pizzaQuery: "pizza",
    chickenName: "Chicken breast",
  },
  pl: {
    search: "Szukaj",
    searchPlaceholder: "Szukaj potraw",
    listbox: "Podpowiedzi",
    languageControl: "Język interfejsu",
    quantity: "Ilość",
    unit: "Jednostka",
    moreButton: "WIĘCEJ!",
    invalidQuantity: "Wpisz prawidłową ilość.",
    chickenQuery: "kurczak",
    pizzaQuery: "pizza",
    chickenName: "Pierś z kurczaka",
  },
} as const;

/**
 * The deterministic seeded suggestion lists for the queries the scenario
 * drives (verified against the real Fiber process and the freshly seeded
 * PostgreSQL catalog; seed migration `0005_seed_food_catalog.sql`, the
 * same fixtures the search-suggestions scenario documents). `foodObjectId`
 * is the seeded stable ID and `name` is the localized option name the
 * panel must render for the active Interface Language (REQ-013).
 */
const SEEDED_SUGGESTIONS = {
  en: [
    { foodObjectId: 5, name: "Chicken breast" },
    { foodObjectId: 22, name: "Fried chicken wings" },
    { foodObjectId: 17, name: "Polish chicken soup" },
    { foodObjectId: 10, name: "Milk" },
    { foodObjectId: 26, name: "Pancakes" },
  ],
  pl: [
    { foodObjectId: 5, name: "Pierś z kurczaka" },
    { foodObjectId: 22, name: "Smażone skrzydełka z kurczaka" },
    { foodObjectId: 15, name: "Kebab" },
    { foodObjectId: 36, name: "Sernik" },
    { foodObjectId: 38, name: "Gulasz" },
  ],
} as const;

/** The seeded Pizza Margherita page-1 ranking (ISSUE-002, REQ-072). */
const PIZZA_PAGE_1_IDS = [30, 3, 35] as const;
/** The seeded Pizza Margherita suggestion (ID 1, 1 serving = 350 g). */
const PIZZA_FOOD_OBJECT_ID = 1;
/** The seeded Chicken breast suggestion (ID 5, 100 g, no Serving). */
const CHICKEN_FOOD_OBJECT_ID = 5;

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

/**
 * Holds every generated-client Substitution Search POST at the browser
 * boundary until the scenario releases it (the spinner-stop-time gate
 * pattern, P12-G1). The real Fiber response still passes through
 * `route.continue()`, so the pending interaction states (`loadingNew`,
 * `loadingMore`) stay observable deterministically without fabricating a
 * response (ARCH-022).
 */
function gateSubstitutePosts(page: Page): {
  waitForPosts: (count: number) => Promise<void>;
  releasePost: (index: number) => void;
} {
  const gates: Array<{ release: () => void; promise: Promise<void> }> = [];
  let postCount = 0;
  page.route("**/api/v1/substitutes/search", async (route) => {
    postCount += 1;
    const gate = { release: () => {}, promise: Promise.resolve() };
    gate.promise = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    gates.push(gate);
    await gate.promise;
    await route.continue();
  });
  return {
    waitForPosts: async (count) => {
      await expect.poll(() => postCount).toBeGreaterThanOrEqual(count);
    },
    releasePost: (index) => {
      gates[index]?.release();
    },
  };
}

/**
 * Asserts that exactly one rendered element matches the given ARIA role
 * and exact accessible name, proving the control resolves by its localized
 * accessible name with one intended semantic role.
 */
async function expectControl(
  page: Page,
  role: "combobox" | "textbox" | "button" | "listbox" | "option" | "group",
  name: string,
): Promise<void> {
  await expect(page.getByRole(role, { name }), `${role} "${name}"`).toHaveCount(
    1,
  );
}

/** The interactive-control ARIA roles the scenario names (REQ-068). */
const CONTROL_ROLE_ALTERNATION = "combobox|textbox|button|listbox|option|group";

/**
 * Asserts against the page's ARIA accessibility snapshot that every given
 * accessible name belongs to exactly one rendered interactive control and
 * that no rendered interactive control lacks an accessible name. The
 * snapshot check catches duplicate accessible names across roles and
 * unnamed interactive elements that per-role locators could not see — the
 * "no duplicate names" and "no parallel control markup" proof (REQ-068).
 */
async function expectAccessibleTreeSanity(
  page: Page,
  names: readonly string[],
): Promise<void> {
  const snapshot = await page.ariaSnapshot();
  const lines = snapshot.split("\n");
  const roleLines = lines.filter((line) =>
    new RegExp(`^\\s*- (?:${CONTROL_ROLE_ALTERNATION}) `).test(line),
  );
  for (const name of names) {
    const matches = roleLines.filter((line) => line.includes(`"${name}"`));
    expect(
      matches.length,
      `exactly one rendered interactive control has the accessible name "${name}"`,
    ).toBe(1);
  }
  const unnamed = lines.filter((line) =>
    new RegExp(`^\\s*- (?:${CONTROL_ROLE_ALTERNATION})\\s*$`).test(line),
  );
  expect(
    unnamed,
    "every rendered interactive control has a localized accessible name",
  ).toEqual([]);
}

/**
 * Asserts the full named-control set of one rendered state: every expected
 * control resolves to exactly one element by role and exact localized
 * accessible name, the total role counts leave no unnamed or duplicate
 * interactive control, and the ARIA snapshot contains each name exactly
 * once.
 */
async function expectNamedControls(
  page: Page,
  controls: ReadonlyArray<
    readonly [
      "combobox" | "textbox" | "button" | "listbox" | "option" | "group",
      string,
    ]
  >,
): Promise<void> {
  for (const [role, name] of controls) {
    await expectControl(page, role, name);
  }
  await expectAccessibleTreeSanity(
    page,
    controls.map(([, name]) => name),
  );
}

/** Waits for the main element's `data-interaction-state` transition. */
async function waitForInteractionState(
  page: Page,
  name: string,
): Promise<void> {
  await expect(page.locator("main")).toHaveAttribute(
    "data-interaction-state",
    name,
  );
}

/**
 * Drives one pointer selection of the Pizza Margherita suggestion (two
 * allowed units: `serving` then `g`) and waits for the successful result
 * transition with its three first-page cards.
 */
async function selectPizzaAndWaitForResults(
  page: Page,
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  const search = page.getByRole("combobox", { name: copy.search });
  await search.fill(copy.pizzaQuery);
  const option = page.locator(`#${optionId(PIZZA_FOOD_OBJECT_ID)}`);
  await expect(option).toBeVisible();
  await option.click();
  await waitForInteractionState(page, "results");
  await expect(page.locator("[data-result-card]")).toHaveCount(3);
}

/**
 * The named-control sets of the quantity-editor states. Pizza Margherita
 * allows two units, so the editor renders the number textbox and the unit
 * combobox; every non-empty state keeps Search and the Interface Language
 * selector; the result and MORE! states add the MORE! button.
 */
const EDITOR_CONTROLS = (copy: (typeof COPY)[keyof typeof COPY]) =>
  [
    ["combobox", copy.search],
    ["combobox", copy.languageControl],
    ["textbox", copy.quantity],
    ["combobox", copy.unit],
  ] as const;

const RESULT_CONTROLS = (copy: (typeof COPY)[keyof typeof COPY]) =>
  [...EDITOR_CONTROLS(copy), ["button", copy.moreButton]] as const;

test.describe("Control accessibility", () => {
  for (const [seedKey, lang, copy] of [
    ["en", "en-US", COPY.en],
    ["pl", "pl-PL", COPY.pl],
  ] as const) {
    test(`[${lang}] the empty state renders exactly the localized Search combobox and Interface Language selector, each with one name and role (P15-G7, REQ-068)`, async ({
      page,
    }) => {
      await useBrowserLanguages(page, [lang]);
      await page.goto("/");
      await waitForInteractionState(page, "empty");

      // The two empty-state interactive controls resolve by their exact
      // localized accessible names with their native/declared roles.
      await expectNamedControls(page, [
        ["combobox", copy.search],
        ["combobox", copy.languageControl],
      ]);

      // No other interactive control exists in the empty state, so no
      // parallel control markup can carry a second name.
      await expect(page.getByRole("combobox")).toHaveCount(2);
      await expect(page.getByRole("textbox")).toHaveCount(0);
      await expect(page.getByRole("button")).toHaveCount(0);
      await expect(page.getByRole("listbox")).toHaveCount(0);
    });

    test(`[${lang}] the open suggestion panel retains the combobox active-descendant pattern and the exact localized option names with no duplicate control names (REQ-018, REQ-068)`, async ({
      page,
    }) => {
      await useBrowserLanguages(page, [lang]);
      await page.goto("/");
      const search = page.getByRole("combobox", { name: copy.search });
      await search.fill(copy.chickenQuery);
      const panel = page.getByRole("listbox", { name: copy.listbox });
      await expect(panel).toBeVisible();
      const options = panel.getByRole("option");
      await expect(options).toHaveCount(5);

      // The unchanged combobox active-descendant pattern (ARCH-020,
      // REQ-018): the Search input owns the listbox through
      // `aria-controls`, expands it, and points `aria-activedescendant` at
      // the first option's stable id; the listbox and the option carry
      // those ids and the active option renders `aria-selected`.
      await expect(search).toHaveAttribute(
        "aria-controls",
        "food-suggestions-listbox",
      );
      await expect(search).toHaveAttribute("aria-expanded", "true");
      await expect(panel).toHaveAttribute("id", "food-suggestions-listbox");
      const firstId = optionId(SEEDED_SUGGESTIONS[seedKey][0].foodObjectId);
      await expect(search).toHaveAttribute("aria-activedescendant", firstId);
      await expect(options.first()).toHaveAttribute("id", firstId);
      await expect(options.first()).toHaveAttribute("aria-selected", "true");

      // Every option resolves by its exact localized name (REQ-013) and
      // the whole rendered surface carries one name per control.
      for (const suggestion of SEEDED_SUGGESTIONS[seedKey]) {
        await expect(
          page.getByRole("option", { name: suggestion.name }),
          `option "${suggestion.name}"`,
        ).toHaveCount(1);
      }
      await expectNamedControls(page, [
        ["combobox", copy.search],
        ["listbox", copy.listbox],
        ["combobox", copy.languageControl],
        ...SEEDED_SUGGESTIONS[seedKey].map(
          (suggestion) => ["option", suggestion.name] as const,
        ),
      ]);
    });

    test(`[${lang}] the pending new Search renders the named Quantity number and Unit controls until the response replaces the surface (REQ-068)`, async ({
      page,
    }) => {
      await useBrowserLanguages(page, [lang]);
      const gates = gateSubstitutePosts(page);
      await page.goto("/");
      const search = page.getByRole("combobox", { name: copy.search });
      await search.fill(copy.pizzaQuery);
      const option = page.locator(`#${optionId(PIZZA_FOOD_OBJECT_ID)}`);
      await expect(option).toBeVisible();
      await option.click();

      // The first Substitution Search POST is held at the browser
      // boundary, so the loadingNew transition stays observable: the
      // read-only quantity editor resolves by its exact localized names.
      await gates.waitForPosts(1);
      await waitForInteractionState(page, "loadingNew");
      await expectNamedControls(page, EDITOR_CONTROLS(copy));
      await expect(page.getByRole("button")).toHaveCount(0);

      // Releasing the real response completes the transition.
      gates.releasePost(0);
      await waitForInteractionState(page, "results");
    });

    test(`[${lang}] a successful result page resolves Search, Interface Language, Quantity, Unit, and MORE! by their exact localized names with one role each (REQ-068)`, async ({
      page,
    }) => {
      await useBrowserLanguages(page, [lang]);
      await page.goto("/");
      await selectPizzaAndWaitForResults(page, copy);

      // Every control of the result surface resolves by its exact localized
      // accessible name, and the total role counts prove one intended
      // semantic role per control (three comboboxes: Search, Interface
      // Language, and the native Unit selector; one textbox; one button).
      await expectNamedControls(page, RESULT_CONTROLS(copy));
      await expect(page.getByRole("combobox")).toHaveCount(3);
      await expect(page.getByRole("textbox")).toHaveCount(1);
      await expect(page.getByRole("button")).toHaveCount(1);
    });

    test(`[${lang}] quantity validation keeps every control named and associates the localized error message without starting a request (REQ-026, REQ-068)`, async ({
      page,
    }) => {
      await useBrowserLanguages(page, [lang]);
      await page.goto("/");
      await selectPizzaAndWaitForResults(page, copy);

      // An invalid draft keeps the exact text and natural focus, raises
      // aria-invalid, and shows the localized polite message; every
      // control of the result surface still resolves by name.
      const number = page.getByRole("textbox", { name: copy.quantity });
      await number.fill("abc");
      await number.press("Enter");
      await expect(number).toHaveAttribute("aria-invalid", "true");
      await expect(page.locator("[data-quantity-error]")).toHaveText(
        copy.invalidQuantity,
      );
      await expect(number).toBeFocused();
      await expectNamedControls(page, RESULT_CONTROLS(copy));
    });

    test(`[${lang}] the pending MORE! page keeps the named non-operable MORE! button and every other named control (REQ-082, REQ-068)`, async ({
      page,
    }) => {
      await useBrowserLanguages(page, [lang]);
      const gates = gateSubstitutePosts(page);
      await page.goto("/");
      const search = page.getByRole("combobox", { name: copy.search });
      await search.fill(copy.pizzaQuery);
      const option = page.locator(`#${optionId(PIZZA_FOOD_OBJECT_ID)}`);
      await expect(option).toBeVisible();
      await option.click();
      await gates.waitForPosts(1);
      gates.releasePost(0);
      await waitForInteractionState(page, "results");

      // The second POST (the next page) is held, so the loadingMore
      // transition stays observable: the MORE! control keeps its localized
      // label and aria-disabled while every control stays named.
      const moreButton = page.getByRole("button", { name: copy.moreButton });
      await moreButton.click();
      await gates.waitForPosts(2);
      await waitForInteractionState(page, "loadingMore");
      await expect(moreButton).toHaveAttribute("aria-disabled", "true");
      await expectNamedControls(page, RESULT_CONTROLS(copy));

      gates.releasePost(1);
      await waitForInteractionState(page, "results");
    });
  }
});

test.describe("Control accessibility failure states", () => {
  /**
   * Prepares one successful Pizza Margherita page-0 result (three cards)
   * and one successful intermediate MORE! page (page 1, MORE! still
   * present) so the failure transitions can be driven after the outage.
   */
  async function prepareSuccessfulIntermediatePage(
    page: Page,
    copy: (typeof COPY)[keyof typeof COPY],
  ): Promise<void> {
    const search = page.getByRole("combobox", { name: copy.search });
    await search.fill(copy.pizzaQuery);
    const option = page.locator(`#${optionId(PIZZA_FOOD_OBJECT_ID)}`);
    await expect(option).toBeVisible();
    await option.click();
    await waitForInteractionState(page, "results");
    await expect(page.locator("[data-result-card]")).toHaveCount(3);
    const moreButton = page.getByRole("button", { name: copy.moreButton });
    await moreButton.click();
    await expect
      .poll(async () =>
        page
          .locator("[data-result-card]")
          .evaluateAll((elements) =>
            elements.map((element) =>
              Number(element.getAttribute("data-food-object-id")),
            ),
          ),
      )
      .toEqual([...PIZZA_PAGE_1_IDS]);
    await expect(moreButton).toBeVisible();
    await expect(moreButton).toHaveAttribute("aria-disabled", "false");
  }

  /**
   * Prepares the second suggestion on a new-search page so a pointer
   * selection after the outage reaches `newSearchFailure` (REQ-050).
   */
  async function prepareSecondSuggestion(
    page: Page,
    copy: (typeof COPY)[keyof typeof COPY],
  ): Promise<void> {
    const search = page.getByRole("combobox", { name: copy.search });
    await search.fill(copy.chickenQuery);
    const option = page.locator(`#${optionId(CHICKEN_FOOD_OBJECT_ID)}`);
    await expect(option).toBeVisible();
    await expect(search).toBeFocused();
  }

  /**
   * Stops only the outage stack's PostgreSQL container and waits until the
   * outage Fiber's `GET /health` stops reporting ready, proving that
   * catalog requests now fail while the Fiber process itself stays up.
   */
  async function stopOutagePostgresAndWait(): Promise<void> {
    const containerName = process.env.OBIAD_E2E_OUTAGE_CONTAINER;
    if (containerName === undefined || containerName === "") {
      throw new Error(
        "OBIAD_E2E_OUTAGE_CONTAINER is not set; run through the e2e launcher outage suite",
      );
    }
    execFileSync("docker", ["stop", containerName], {
      timeout: 30_000,
      stdio: "pipe",
    });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch("http://127.0.0.1:8080/health", {
          signal: AbortSignal.timeout(2_000),
        });
        if (response.status === 503) {
          return;
        }
      } catch {
        // Transient probe failure; keep polling until the deadline.
      }
      const { promise: sleep, resolve: wake } = Promise.withResolvers<void>();
      setTimeout(wake, 250);
      await sleep;
    }
    throw new Error(
      "the outage Fiber did not report catalog unavailability after its PostgreSQL stopped",
    );
  }

  test("after the outage, the new-Search and MORE! failure surfaces resolve every rendered control by its exact English or Polish accessible name with one role and no duplicates (REQ-050, REQ-051, REQ-068)", async ({
    browser,
  }) => {
    const englishContext = await browser.newContext({
      baseURL: "http://127.0.0.1:4173",
    });
    const polishContext = await browser.newContext({
      baseURL: "http://127.0.0.1:4173",
    });
    const englishNewPage = await englishContext.newPage();
    const polishNewPage = await polishContext.newPage();
    await useBrowserLanguages(englishNewPage, ["en-US"]);
    await useBrowserLanguages(polishNewPage, ["pl-PL"]);
    const englishMorePage = await englishContext.newPage();
    const polishMorePage = await polishContext.newPage();
    await useBrowserLanguages(englishMorePage, ["en-US"]);
    await useBrowserLanguages(polishMorePage, ["pl-PL"]);

    await englishNewPage.goto("/");
    await polishNewPage.goto("/");
    await englishMorePage.goto("/");
    await polishMorePage.goto("/");

    // Prepare the successful surfaces before the outage: the second
    // suggestion on each new-search page and a successful intermediate
    // result page on each MORE! page.
    await prepareSecondSuggestion(englishNewPage, COPY.en);
    await prepareSecondSuggestion(polishNewPage, COPY.pl);
    await prepareSuccessfulIntermediatePage(englishMorePage, COPY.en);
    await prepareSuccessfulIntermediatePage(polishMorePage, COPY.pl);

    // Stop only the outage stack's PostgreSQL: every catalog request now
    // fails while the outage Fiber stays up.
    await stopOutagePostgresAndWait();

    // newSearchFailure (REQ-050): selecting the prepared suggestion fails,
    // and the retained failure surface resolves every rendered control by
    // its exact localized accessible name. Chicken breast allows only the
    // `g` base unit, so the unit control renders as the named static
    // group; no MORE! button or result card exists.
    await englishNewPage
      .locator(`#${optionId(CHICKEN_FOOD_OBJECT_ID)}`)
      .click();
    await waitForInteractionState(englishNewPage, "newSearchFailure");
    const englishSearch = englishNewPage.getByRole("combobox", {
      name: COPY.en.search,
    });
    await expect(englishSearch).toHaveValue(COPY.en.chickenName);
    await expect(englishSearch).toBeFocused();
    await expectNamedControls(englishNewPage, [
      ["combobox", COPY.en.search],
      ["combobox", COPY.en.languageControl],
      ["textbox", COPY.en.quantity],
      ["group", COPY.en.unit],
    ]);
    await expect(englishNewPage.getByRole("button")).toHaveCount(0);
    await expect(englishNewPage.locator("[data-result-card]")).toHaveCount(0);

    await polishNewPage.locator(`#${optionId(CHICKEN_FOOD_OBJECT_ID)}`).click();
    await waitForInteractionState(polishNewPage, "newSearchFailure");
    const polishSearch = polishNewPage.getByRole("combobox", {
      name: COPY.pl.search,
    });
    await expect(polishSearch).toHaveValue(COPY.pl.chickenName);
    await expect(polishSearch).toBeFocused();
    await expectNamedControls(polishNewPage, [
      ["combobox", COPY.pl.search],
      ["combobox", COPY.pl.languageControl],
      ["textbox", COPY.pl.quantity],
      ["group", COPY.pl.unit],
    ]);
    await expect(polishNewPage.getByRole("button")).toHaveCount(0);

    // moreFailure (REQ-051): activating the retained MORE! control fails,
    // and the retained failure surface resolves every rendered control by
    // its exact localized accessible name. Pizza Margherita allows two
    // units, so the editor renders the named Unit combobox, and the
    // retained MORE! button keeps its localized name and stays operable.
    await englishMorePage
      .getByRole("button", { name: COPY.en.moreButton })
      .click();
    await waitForInteractionState(englishMorePage, "moreFailure");
    await expectNamedControls(englishMorePage, RESULT_CONTROLS(COPY.en));
    await expect(
      englishMorePage.getByRole("button", { name: COPY.en.moreButton }),
    ).toHaveAttribute("aria-disabled", "false");
    await expect(englishMorePage.locator("[data-result-card]")).toHaveCount(3);

    await polishMorePage
      .getByRole("button", { name: COPY.pl.moreButton })
      .click();
    await waitForInteractionState(polishMorePage, "moreFailure");
    await expectNamedControls(polishMorePage, RESULT_CONTROLS(COPY.pl));
    await expect(
      polishMorePage.getByRole("button", { name: COPY.pl.moreButton }),
    ).toHaveAttribute("aria-disabled", "false");
    await expect(polishMorePage.locator("[data-result-card]")).toHaveCount(3);
  });
});
