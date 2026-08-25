import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

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
 *
 * Task 49 completes one keyboard-only interaction path across every control
 * (P15-G2, P15-G7, REQ-018, REQ-019, REQ-026, REQ-068): the "Control
 * keyboard-only flow" describe drives the complete Tab, Shift+Tab, Arrow
 * key, Enter, Space, and Escape journey in English and Polish with no
 * pointer input — the autofocused Search combobox, the active-descendant
 * suggestion list (first-option highlighting, Arrow movement with
 * clamping, Escape cancellation, Enter selection), the Interface Language
 * selector, the Food Quantity number and unit controls (invalid draft
 * rejection, valid commit, unit change), the MORE! button (Space
 * activation and paging), and the required successful focus targets (the
 * localized results heading after every successful page). The existing
 * localized loading, quantity-validation, new-Search failure, and MORE!
 * failure announcements and their established focus states stay unchanged
 * and are re-proven by `food-quantity-editing.spec.ts` and
 * `substitution-request-failures.spec.ts` (P15-G6, REQ-050, REQ-051);
 * ISSUE-015 keeps the successful zero-result message focus a component
 * seam, so `src/App.result-state.test.ts` drives the zero-result focus
 * target through the same keyboard Enter selection path.
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
    foundSubstitutions: "Found substitutions",
    pizzaName: "Pizza Margherita",
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
    foundSubstitutions: "Znalezione zamienniki",
    wingsName: "Smażone skrzydełka z kurczaka",
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

/** The seeded Pizza Margherita page-0 ranking (ISSUE-002, REQ-072). */
const PIZZA_PAGE_0_IDS = [13, 29, 26] as const;

/** The seeded Pizza Margherita page-1 ranking (ISSUE-002, REQ-072). */
const PIZZA_PAGE_1_IDS = [30, 3, 35] as const;
/** The seeded Pizza Margherita suggestion (ID 1, 1 serving = 350 g). */
const PIZZA_FOOD_OBJECT_ID = 1;

/** The seeded Chicken breast suggestion (ID 5, 100 g, no Serving). */
const CHICKEN_FOOD_OBJECT_ID = 5;

/**
 * The deterministic seeded suggestion lists the keyboard-only flow drives
 * (task 49): the English `pizza` query and the Polish `kurczak` query
 * (the same fixtures the search-suggestions and control-accessibility
 * scenarios document). The flow selects Pizza Margherita (ID 1, two
 * allowed units: `serving` then `g`) in English and Smażone skrzydełka z
 * kurczaka (ID 22, two allowed units) in Polish, so the Food Quantity
 * editor renders the operable Unit selector in both languages.
 */
const KEYBOARD_SUGGESTIONS = {
  en: {
    query: "pizza",
    list: [
      { foodObjectId: 1, name: "Pizza Margherita" },
      { foodObjectId: 2, name: "Pizza Capricciosa" },
      { foodObjectId: 13, name: "Gyoza" },
      { foodObjectId: 10, name: "Milk" },
      { foodObjectId: 29, name: "Paella" },
    ],
  },
  pl: {
    query: "kurczak",
    list: [
      { foodObjectId: 5, name: "Pierś z kurczaka" },
      { foodObjectId: 22, name: "Smażone skrzydełka z kurczaka" },
      { foodObjectId: 15, name: "Kebab" },
      { foodObjectId: 36, name: "Sernik" },
      { foodObjectId: 38, name: "Gulasz" },
    ],
  },
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

/**
 * Records every generated-client `POST /api/v1/substitutes/search` request
 * body without gating or fabricating a response, so the keyboard-only flow
 * proves each key operation starts exactly one request with the exact
 * committed input and page index (REQ-019, REQ-026, REQ-027, REQ-041).
 */
function trackSubstitutePosts(page: Page): Array<Record<string, unknown>> {
  const posts: Array<Record<string, unknown>> = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/v1/substitutes/search")
    ) {
      posts.push(request.postDataJSON() as Record<string, unknown>);
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
 * Asserts the keyboard-active option of the open suggestion panel (task
 * 49, REQ-018, REQ-019): the option at `activeIndex` renders the Primary
 * active styling and `aria-selected="true"`, every other option renders
 * the resting text color and `aria-selected="false"`, and the Search
 * input's `aria-activedescendant` references exactly the active option's
 * stable id while `aria-expanded` stays true. The auto-retrying
 * assertions wait out the per-keystroke suggestion refetches, so the
 * helper proves the final response's panel.
 */
async function expectKeyboardActiveOption(
  page: Page,
  expected: readonly { foodObjectId: number; name: string }[],
  activeIndex: number,
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  const search = page.getByRole("combobox", { name: copy.search });
  const panel = page.getByRole("listbox", { name: copy.listbox });
  const options = panel.getByRole("option");
  await expect(options).toHaveCount(5);
  await expect(search).toHaveAttribute("aria-expanded", "true");
  for (let index = 0; index < expected.length; index += 1) {
    await expect(options.nth(index)).toHaveText(expected[index].name);
    await expect(options.nth(index)).toHaveAttribute(
      "aria-selected",
      String(index === activeIndex),
    );
  }
  await expect(options.nth(activeIndex)).toHaveCSS(
    "background-color",
    PRIMARY_RGB,
  );
  await expect(options.nth(activeIndex)).toHaveCSS("color", TEXT_ON_BRIGHT_RGB);
  for (let index = 0; index < expected.length; index += 1) {
    if (index !== activeIndex) {
      await expect(options.nth(index)).toHaveCSS("color", TEXT_PRIMARY_RGB);
    }
  }
  await expect(search).toHaveAttribute(
    "aria-activedescendant",
    optionId(expected[activeIndex].foodObjectId),
  );
}
/**
 * Holds every generated-client Substitution Search POST at the browser
 * boundary until the scenario releases it (the spinner-stop-time gate
 * pattern, P12-G1). The real Fiber response still passes through
 * `route.continue()`, so the pending interaction states (`loadingNew`,
 * `loadingMore`) stay observable deterministically without fabricating a
 * response (ARCH-022). The returned `count` reads how many posts the gate
 * has observed so a scenario can prove a blocked activation starts no
 * second request (REQ-048).
 */
function gateSubstitutePosts(page: Page): {
  waitForPosts: (count: number) => Promise<void>;
  releasePost: (index: number) => void;
  count: () => number;
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
    count: () => postCount,
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
/** The Primary focus treatment color (style.md inputs contract). */
const PRIMARY_RGB = "rgb(74, 222, 128)"; // #4ADE80
/** The resting Secondary border color of the Search-style inputs. */
const SECONDARY_RGB = "rgb(134, 239, 172)"; // #86EFAC
/** The Text-On-Bright color on the Primary active option (ISSUE-008). */
const TEXT_ON_BRIGHT_RGB = "rgb(10, 15, 10)"; // #0A0F0A
/** The resting Text-Primary color of the non-active options (ISSUE-008). */
const TEXT_PRIMARY_RGB = "rgb(243, 244, 246)"; // #F3F4F6
/** Gray background of a pending non-operable MORE! control (REQ-082). */
const DISABLED_MORE_BACKGROUND_COLOR = "oklch(0.446 0.03 256.802)";
/** Gray text of a pending non-operable MORE! control (REQ-082). */
const DISABLED_MORE_TEXT_COLOR = "oklch(0.872 0.01 258.338)";
/** The WCAG 2.1 Level A and AA axe rule tags (ISSUE-015). */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] as const;

/**
 * Runs the pinned axe-core engine through `@axe-core/playwright` with only
 * the WCAG 2.1 Level A and AA rule tags (task 48, ISSUE-015): definite
 * violations fail the test; incomplete checks are recorded on the console
 * for manual review without failing, and the optional axe best-practice
 * rules are never enforced (P15-G2).
 */
async function expectWcagAAndAaClean(page: Page, state: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags([...AXE_TAGS])
    .analyze();
  if (results.incomplete.length > 0) {
    console.log(`[axe] ${state}: incomplete checks for manual review:`);
    for (const result of results.incomplete) {
      console.log(
        `[axe]   ${result.id}: ${result.help} (${result.nodes.length} node(s))`,
      );
    }
  }
  expect(
    results.violations,
    `${state}: no definite WCAG 2.1 Level A or AA violation`,
  ).toEqual([]);
}

/** The focus- and color-relevant presentation of one rendered control. */
interface ControlPresentation {
  readonly borderTopColor: string;
  readonly backgroundColor: string;
  readonly color: string;
  readonly outlineStyle: string;
  readonly outlineWidth: string;
  readonly outlineColor: string;
  readonly outlineOffset: string;
}

/** The viewport geometry of one rendered page region. */
interface RegionGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One complete captured surface: every rendered control and page region. */
interface SurfaceSnapshot {
  readonly controls: Readonly<Record<string, ControlPresentation>>;
  readonly regions: Readonly<Record<string, RegionGeometry>>;
}

/**
 * The stable selectors of every interactive control task 47 names
 * (REQ-068). `quantityUnit` renders only when the selected Food Object
 * allows two units; `moreButton` renders only after a successful result
 * page with a later page.
 */
const CONTROL_SELECTORS = {
  search: "#food-search",
  language: "[data-interface-language] select",
  quantityNumber: "[data-quantity-number]",
  quantityUnit: "[data-quantity-unit]",
  moreButton: "[data-more-button]",
} as const;

/** The stable page regions whose geometry must not change on focus. */
const REGION_SELECTORS = [
  "[data-search-region]",
  "[data-selected-input]",
  "[data-result-region]",
  "[data-interface-language]",
] as const;

/**
 * Captures the current presentation of every rendered control and the
 * geometry of every page region, so a test can prove that focusing a
 * control changes exactly its own focus indicator and nothing else
 * (REQ-068, P15-G2: no non-focus layout or color change).
 */
async function captureSurface(page: Page): Promise<SurfaceSnapshot> {
  return page.evaluate(
    ({ controlSelectors, regionSelectors }) => {
      const controls: Record<string, ControlPresentation> = {};
      for (const [name, selector] of Object.entries(controlSelectors)) {
        const element = document.querySelector(selector);
        if (element === null) {
          continue;
        }
        const style = getComputedStyle(element);
        controls[name] = {
          borderTopColor: style.borderTopColor,
          backgroundColor: style.backgroundColor,
          color: style.color,
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
          outlineColor: style.outlineColor,
          outlineOffset: style.outlineOffset,
        };
      }
      const regions: Record<string, RegionGeometry> = {};
      for (const selector of regionSelectors) {
        const element = document.querySelector(selector);
        if (element === null) {
          continue;
        }
        // Document-relative geometry: the browser's native
        // scroll-into-view on keyboard focus changes viewport-relative
        // coordinates without changing the layout itself.
        const rect = element.getBoundingClientRect();
        regions[selector] = {
          x: rect.x + window.scrollX,
          y: rect.y + window.scrollY,
          width: rect.width,
          height: rect.height,
        };
      }
      return { controls, regions };
    },
    { controlSelectors: CONTROL_SELECTORS, regionSelectors: REGION_SELECTORS },
  );
}

/** Proves that one keyboard focus move from `fromControl` to `toControl`
 * changed exactly the two involved presentations: the previously focused
 * control loses its focus indicator, the newly focused control shows its
 * focus indicator, every other control keeps its exact colors and
 * outline, and every page region keeps its geometry — the "no non-focus
 * layout or color change" proof (REQ-068, P15-G2). When `fromControl` is
 * omitted the move starts from a state with no interactive control
 * focused (for example the programmatically focused results heading), so
 * only `toControl` changes.
 */
function expectFocusMove(
  before: SurfaceSnapshot,
  after: SurfaceSnapshot,
  toControl: keyof typeof CONTROL_SELECTORS,
  fromControl?: keyof typeof CONTROL_SELECTORS,
): void {
  if (fromControl !== undefined) {
    expect(
      after.controls[fromControl],
      `${fromControl} loses its focus indicator`,
    ).not.toEqual(before.controls[fromControl]);
  }
  for (const [name, presentation] of Object.entries(after.controls)) {
    if (name === fromControl || name === toControl) {
      continue;
    }
    expect(
      presentation,
      `${name} keeps its exact presentation during the ${fromControl ?? "no-control"} → ${toControl} focus move`,
    ).toEqual(before.controls[name]);
  }
  expect(
    after.controls[toControl],
    `${toControl} changes its presentation (the focus indicator)`,
  ).not.toEqual(before.controls[toControl]);
  expect(
    after.regions,
    "page regions keep their geometry during the focus move",
  ).toEqual(before.regions);
}

/**
 * Moves keyboard focus to the given control by pressing Tab until the
 * browser places focus on it. A bounded loop is deterministic despite the
 * native autofocus quirk that skips the autofocused Search field on the
 * first Tab and routes the wrap through the document body.
 */
async function focusWithTab(
  page: Page,
  target: ReturnType<Page["locator"]>,
): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const reached = await target.evaluate(
      (element) => element === document.activeElement,
    );
    if (reached) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error("focusWithTab: target did not receive focus within 12 Tabs");
}

/** The visible keyboard focus indicator kind of one control (style.md). */
type FocusIndicatorKind = "border" | "outline";

/**
 * Asserts that the given control currently renders its visible keyboard
 * focus indicator (REQ-068): the Primary border without an outer
 * highlight for the Search-style inputs (style.md "Inputs"), or the
 * two-pixel Primary outline for the selector and MORE! controls.
 */
async function expectVisibleFocusIndicator(
  page: Page,
  controlKey: keyof typeof CONTROL_SELECTORS,
  kind: FocusIndicatorKind,
): Promise<void> {
  const element = page.locator(CONTROL_SELECTORS[controlKey]);
  if (kind === "border") {
    await expect(
      element,
      `${controlKey} shows the Primary focus border`,
    ).toHaveCSS("border-top-color", PRIMARY_RGB);
    await expect(
      element,
      `${controlKey} has no outer focus highlight`,
    ).toHaveCSS("outline-style", "none");
  } else {
    await expect(
      element,
      `${controlKey} shows the solid focus outline`,
    ).toHaveCSS("outline-style", "solid");
    await expect(element).toHaveCSS("outline-width", "2px");
    // The retrying assertion also waits out the MORE! control's 200ms
    // `transition-colors` (Tailwind v4 includes `outline-color`).
    await expect(element).toHaveCSS("outline-color", PRIMARY_RGB);
    await expect(element).toHaveCSS("outline-offset", "2px");
  }
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

test.describe("Control focus indication", () => {
  for (const [seedKey, lang, copy] of [
    ["en", "en-US", COPY.en],
    ["pl", "pl-PL", COPY.pl],
  ] as const) {
    test(`[${lang}] the empty state shows a visible keyboard focus indicator on Search and the Interface Language selector with no layout or non-focus color change (REQ-068, P15-G2, P15-G7)`, async ({
      page,
    }) => {
      await useBrowserLanguages(page, [lang]);
      await page.goto("/");
      await waitForInteractionState(page, "empty");

      // Search carries the autofocus and renders its visible Primary
      // border indicator without an outer highlight (style.md inputs).
      const search = page.getByRole("combobox", { name: copy.search });
      await expect(search).toBeFocused();
      await expectVisibleFocusIndicator(page, "search", "border");
      const baseline = await captureSurface(page);

      // Keyboard Tab moves focus to the Interface Language selector,
      // whose two-pixel Primary outline is its visible indicator; Search
      // loses its indicator and every page region keeps its geometry
      // (REQ-068, P15-G2: no non-focus layout or color change).
      const languageControl = page.getByRole("combobox", {
        name: copy.languageControl,
      });
      await focusWithTab(page, languageControl);
      await expect(languageControl).toBeFocused();
      expect(
        await languageControl.evaluate((element) =>
          element.matches(":focus-visible"),
        ),
      ).toBe(true);
      await expectVisibleFocusIndicator(page, "language", "outline");
      const languageFocused = await captureSurface(page);
      expectFocusMove(baseline, languageFocused, "language", "search");

      // Tab wraps back to Search (through the document body), restoring
      // its visible keyboard focus border; the selector reverts.
      await focusWithTab(page, search);
      await expect(search).toBeFocused();
      expect(
        await search.evaluate((element) => element.matches(":focus-visible")),
      ).toBe(true);
      await expectVisibleFocusIndicator(page, "search", "border");
      const searchFocused = await captureSurface(page);
      expectFocusMove(languageFocused, searchFocused, "search", "language");
    });

    test(`[${lang}] the open suggestion panel keeps Search's visible focus border and the active option's visible active styling (REQ-018, REQ-068)`, async ({
      page,
    }) => {
      await useBrowserLanguages(page, [lang]);
      await page.goto("/");
      const search = page.getByRole("combobox", { name: copy.search });
      await search.fill(copy.chickenQuery);
      const panel = page.getByRole("listbox", { name: copy.listbox });
      await expect(panel).toBeVisible();
      await expect(search).toBeFocused();
      expect(
        await search.evaluate((element) => element.matches(":focus-visible")),
      ).toBe(true);
      await expectVisibleFocusIndicator(page, "search", "border");

      // The keyboard-active option renders its visible active styling
      // (Primary with Text-On-Bright, REQ-018/REQ-019) as the
      // active-descendant indication of the combobox pattern.
      const firstOption = panel.getByRole("option").first();
      await expect(firstOption).toHaveCSS("background-color", PRIMARY_RGB);
      await expect(firstOption).toHaveCSS("color", TEXT_ON_BRIGHT_RGB);

      const baseline = await captureSurface(page);

      // Tab closes the panel through the native blur, moves focus to the
      // Interface Language selector, reverts Search, and changes no page
      // geometry.
      await page.keyboard.press("Tab");
      const languageControl = page.getByRole("combobox", {
        name: copy.languageControl,
      });
      await expect(languageControl).toBeFocused();
      await expectVisibleFocusIndicator(page, "language", "outline");
      await expect(search).toHaveCSS("border-top-color", SECONDARY_RGB);
      const after = await captureSurface(page);
      expect(after.regions).toEqual(baseline.regions);
      expect(after.controls.language).not.toEqual(baseline.controls.language);
      await expect(panel).toHaveCount(0);
    });

    test(`[${lang}] every operable result-state control — Quantity number, Unit, MORE!, and the Interface Language selector — shows its visible keyboard focus indicator with no layout or non-focus color change (REQ-068, P15-G2, P15-G7)`, async ({
      page,
    }) => {
      await useBrowserLanguages(page, [lang]);
      await page.goto("/");
      await selectPizzaAndWaitForResults(page, copy);

      // The successful page moved focus to the localized results heading
      // (REQ-083), so the baseline has no interactive control focused.
      const baseline = await captureSurface(page);

      // Each keyboard Tab stop renders the control's visible focus
      // indicator while every other control keeps its exact colors and
      // every page region its geometry (REQ-068, P15-G2). The native
      // autofocus quirk skips Search on the first Tab and routes the
      // wrap through the document body, so focusWithTab presses Tab
      // until the browser places focus on the intended stop.
      const stops = [
        ["search", undefined],
        ["quantityNumber", "search"],
        ["quantityUnit", "quantityNumber"],
        ["moreButton", "quantityUnit"],
        ["language", "moreButton"],
        ["search", "language"],
      ] as const;
      let before = baseline;
      for (const [toControl, fromControl] of stops) {
        await focusWithTab(page, page.locator(CONTROL_SELECTORS[toControl]));
        const element = page.locator(CONTROL_SELECTORS[toControl]);
        await expect(element).toBeFocused();
        expect(
          await element.evaluate((node) => node.matches(":focus-visible")),
          `${toControl} matches :focus-visible after keyboard focus`,
        ).toBe(true);
        await expectVisibleFocusIndicator(
          page,
          toControl,
          toControl === "search" ||
            toControl === "quantityNumber" ||
            toControl === "quantityUnit"
            ? "border"
            : "outline",
        );
        // The MORE! control's 200ms color transition (Tailwind
        // `transition-colors`) settles before the surface capture so the
        // proof compares transition-stable presentations.
        await page.waitForTimeout(250);
        const after = await captureSurface(page);
        expectFocusMove(
          before,
          after,
          toControl,
          fromControl as keyof typeof CONTROL_SELECTORS | undefined,
        );
        before = after;
      }
    });

    test(`[${lang}] quantity validation keeps the focused Quantity number's visible focus indicator and changes no region geometry (REQ-026, REQ-068)`, async ({
      page,
    }) => {
      await useBrowserLanguages(page, [lang]);
      await page.goto("/");
      await selectPizzaAndWaitForResults(page, copy);

      const baseline = await captureSurface(page);
      const number = page.getByRole("textbox", { name: copy.quantity });
      await number.fill("abc");
      await number.press("Enter");
      await expect(number).toBeFocused();
      expect(
        await number.evaluate((element) => element.matches(":focus-visible")),
      ).toBe(true);
      await expectVisibleFocusIndicator(page, "quantityNumber", "border");
      await expect(page.locator("[data-quantity-error]")).toHaveText(
        copy.invalidQuantity,
      );

      // The invalid commit keeps the focused number field's visible
      // indicator and changes no other control's presentation. The polite
      // error message legitimately extends the selected-input region
      // (REQ-026), so the comparison covers every control plus the
      // Search and language regions, whose geometry is stable.
      const after = await captureSurface(page);
      for (const name of [
        "search",
        "quantityUnit",
        "moreButton",
        "language",
      ] as const) {
        expect(after.controls[name]).toEqual(baseline.controls[name]);
      }
      expect(after.regions["[data-search-region]"]).toEqual(
        baseline.regions["[data-search-region]"],
      );
      expect(after.regions["[data-interface-language]"]).toEqual(
        baseline.regions["[data-interface-language]"],
      );
      expect(after.controls.quantityNumber).not.toEqual(
        baseline.controls.quantityNumber,
      );
    });
  }
});

test.describe("Control disabled presentation", () => {
  for (const [seedKey, lang, copy] of [
    ["en", "en-US", COPY.en],
    ["pl", "pl-PL", COPY.pl],
  ] as const) {
    test(`[${lang}] the pending new Search natively disables the Quantity editor (removed from the tab order) while Search keeps focus and repeated activation starts no request (REQ-048, REQ-068)`, async ({
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
      await waitForInteractionState(page, "loadingNew");

      const numberInput = page.locator("[data-quantity-number]");
      const unitSelect = page.locator("[data-quantity-unit]");

      // The editor can be removed from the tab order in this transition
      // (Search is the initiating focus-retaining control), so the
      // controls expose the native disabled state and no aria-disabled.
      await expect(numberInput).toBeDisabled();
      await expect(numberInput).toHaveAttribute("disabled", "");
      await expect(numberInput).not.toHaveAttribute("aria-disabled", "true");
      await expect(unitSelect).toBeDisabled();
      await expect(unitSelect).toHaveAttribute("disabled", "");
      await expect(unitSelect).not.toHaveAttribute("aria-disabled", "true");

      // Search keeps the established focus (REQ-020, REQ-022).
      await expect(search).toBeFocused();

      // Guarded dispatched and keyboard activation starts no second
      // request and keeps Search focused (REQ-048).
      await numberInput.dispatchEvent("click");
      await numberInput.dispatchEvent("keydown", { key: "Enter" });
      await unitSelect.dispatchEvent("change");
      await page.locator("[data-quantity-editor]").dispatchEvent("focusout");
      await numberInput.press("Enter");
      await page.waitForTimeout(300);
      expect(gates.count()).toBe(1);
      await expect(search).toBeFocused();

      // A pointer click on the native-disabled editor is discarded: the
      // disabled control is non-operable, so the click starts no second
      // request (the browser's native focus loss to the document body is
      // the disabled control refusing focus).
      await unitSelect.click({ force: true });
      await page.waitForTimeout(300);
      expect(gates.count()).toBe(1);

      // The disabled editor leaves the tab order: Tab from Search reaches
      // the Interface Language selector, never the editor.
      await search.focus();
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("combobox", { name: copy.languageControl }),
      ).toBeFocused();

      gates.releasePost(0);
      await waitForInteractionState(page, "results");
    });

    test(`[${lang}] a pending valid recalculation keeps the initiating Quantity editor focusable but non-operable with aria-disabled, and repeated activation starts no request (REQ-048, REQ-068)`, async ({
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

      // A valid recalculation commit keeps number-field focus — the
      // established focus-retaining path — so the editor stays focusable
      // and non-operable with aria-disabled plus the native
      // readonly/tabindex guards instead of the native disabled state
      // (REQ-048, REQ-068).
      const numberInput = page.locator("[data-quantity-number]");
      const unitSelect = page.locator("[data-quantity-unit]");
      await numberInput.fill("2");
      await numberInput.press("Enter");
      await gates.waitForPosts(2);
      await expect(numberInput).toBeFocused();
      await expect(numberInput).toHaveAttribute("aria-disabled", "true");
      await expect(numberInput).not.toHaveAttribute("disabled");
      await expect(numberInput).toHaveAttribute("readonly", "");
      await expect(unitSelect).toHaveAttribute("aria-disabled", "true");
      await expect(unitSelect).toHaveAttribute("tabindex", "-1");
      await expect(unitSelect).not.toHaveAttribute("disabled");
      const moreButton = page.locator("[data-more-button]");
      await expect(moreButton).toHaveAttribute("aria-disabled", "true");

      // Guarded pointer, keyboard, blur, and dispatched activation start
      // no second request and keep the initiating focus (REQ-048).
      await numberInput.press("Enter");
      await numberInput.dispatchEvent("keydown", { key: "Enter" });
      await unitSelect.dispatchEvent("change");
      await page.locator("[data-quantity-editor]").dispatchEvent("focusout");
      await moreButton.dispatchEvent("click");
      await page.waitForTimeout(300);
      expect(gates.count()).toBe(2);
      await expect(numberInput).toBeFocused();

      gates.releasePost(1);
      await waitForInteractionState(page, "results");
      await expect(numberInput).toBeEnabled();
      await expect(unitSelect).toBeEnabled();
      await expect(moreButton).toHaveAttribute("aria-disabled", "false");
    });

    test(`[${lang}] the pending MORE! page keeps the initiating MORE! control focused and aria-disabled with its gray presentation while the Quantity editor is natively disabled (REQ-082, REQ-068)`, async ({
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

      const moreButton = page.locator("[data-more-button]");
      await moreButton.click();
      await gates.waitForPosts(2);
      await waitForInteractionState(page, "loadingMore");

      // MORE! is the focus-retaining non-operable control: it keeps its
      // localized label, its gray non-operable colors, and aria-disabled
      // (REQ-082), while the Quantity editor leaves the tab order with
      // the native disabled state (REQ-068).
      await expect(moreButton).toBeFocused();
      await expect(moreButton).toHaveAttribute("aria-disabled", "true");
      await expect(moreButton).toHaveCSS(
        "background-color",
        DISABLED_MORE_BACKGROUND_COLOR,
      );
      await expect(moreButton).toHaveCSS("color", DISABLED_MORE_TEXT_COLOR);
      const numberInput = page.locator("[data-quantity-number]");
      const unitSelect = page.locator("[data-quantity-unit]");
      await expect(numberInput).toBeDisabled();
      await expect(numberInput).toHaveAttribute("disabled", "");
      await expect(numberInput).not.toHaveAttribute("aria-disabled", "true");
      await expect(unitSelect).toBeDisabled();
      await expect(unitSelect).toHaveAttribute("disabled", "");
      await expect(unitSelect).not.toHaveAttribute("aria-disabled", "true");

      // Guarded pointer, keyboard, blur, and dispatched activation start
      // no second request and keep MORE! focused (REQ-048, REQ-082).
      await moreButton.click({ force: true });
      await moreButton.press("Enter");
      await moreButton.dispatchEvent("click");
      await numberInput.dispatchEvent("keydown", { key: "Enter" });
      await unitSelect.dispatchEvent("change");
      await page.waitForTimeout(300);
      expect(gates.count()).toBe(2);
      await expect(moreButton).toBeFocused();

      gates.releasePost(1);
      await waitForInteractionState(page, "results");
      await expect(moreButton).toHaveAttribute("aria-disabled", "false");
      await expect(numberInput).toBeEnabled();
      await expect(unitSelect).toBeEnabled();
    });
  }
});

test.describe("WCAG 2.1 accessibility scan", () => {
  for (const [seedKey, lang, copy] of [
    ["en", "en-US", COPY.en],
    ["pl", "pl-PL", COPY.pl],
  ] as const) {
    test(`[${lang}] the empty state reports no definite WCAG 2.1 Level A or AA axe violation (ISSUE-015, P15-G2, P15-G7)`, async ({
      page,
    }) => {
      await useBrowserLanguages(page, [lang]);
      await page.goto("/");
      await waitForInteractionState(page, "empty");
      await expectWcagAAndAaClean(page, `empty (${lang})`);
    });

    test(`[${lang}] the open suggestion panel state reports no definite WCAG 2.1 Level A or AA axe violation (ISSUE-015, P15-G2, P15-G7)`, async ({
      page,
    }) => {
      await useBrowserLanguages(page, [lang]);
      await page.goto("/");
      const search = page.getByRole("combobox", { name: copy.search });
      await search.fill(copy.chickenQuery);
      await expect(
        page.getByRole("listbox", { name: copy.listbox }),
      ).toBeVisible();
      await expectWcagAAndAaClean(page, `suggestions-open (${lang})`);
    });

    test(`[${lang}] the pending new-Search state reports no definite WCAG 2.1 Level A or AA axe violation (ISSUE-015, P15-G2, P15-G7)`, async ({
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
      await waitForInteractionState(page, "loadingNew");
      await expectWcagAAndAaClean(page, `loadingNew (${lang})`);
      gates.releasePost(0);
    });

    test(`[${lang}] the result state reports no definite WCAG 2.1 Level A or AA axe violation (ISSUE-015, P15-G2, P15-G7)`, async ({
      page,
    }) => {
      await useBrowserLanguages(page, [lang]);
      await page.goto("/");
      await selectPizzaAndWaitForResults(page, copy);
      await expectWcagAAndAaClean(page, `results (${lang})`);
    });

    test(`[${lang}] the quantity-validation state reports no definite WCAG 2.1 Level A or AA axe violation (ISSUE-015, P15-G2, P15-G7)`, async ({
      page,
    }) => {
      await useBrowserLanguages(page, [lang]);
      await page.goto("/");
      await selectPizzaAndWaitForResults(page, copy);
      const number = page.getByRole("textbox", { name: copy.quantity });
      await number.fill("abc");
      await number.press("Enter");
      await expect(page.locator("[data-quantity-error]")).toHaveText(
        copy.invalidQuantity,
      );
      await expectWcagAAndAaClean(page, `quantity-validation (${lang})`);
    });

    test(`[${lang}] the pending MORE! state reports no definite WCAG 2.1 Level A or AA axe violation (ISSUE-015, P15-G2, P15-G7)`, async ({
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
      const moreButton = page.locator("[data-more-button]");
      await moreButton.click();
      await gates.waitForPosts(2);
      await waitForInteractionState(page, "loadingMore");
      await expectWcagAAndAaClean(page, `loadingMore (${lang})`);
      gates.releasePost(1);
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
    // The retained quantity editor stays operable in newSearchFailure —
    // the retry path is a fresh suggestion selection or a valid quantity
    // commit (REQ-050) — and the failure surface has no definite WCAG
    // 2.1 Level A or AA axe violation (ISSUE-015, P15-G2).
    await expect(
      englishNewPage.locator("[data-quantity-number]"),
    ).toBeEnabled();
    await expectWcagAAndAaClean(englishNewPage, "newSearchFailure (en)");

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
    await expectWcagAAndAaClean(polishNewPage, "newSearchFailure (pl)");

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
    // The quantity editor stays non-operable in moreFailure with the
    // native disabled state — the retry path is the retained MORE!
    // control or a fresh suggestion selection (REQ-051, REQ-068) — and
    // the failure surface has no definite WCAG 2.1 Level A or AA axe
    // violation (ISSUE-015, P15-G2).
    await expect(
      englishMorePage.locator("[data-quantity-number]"),
    ).toBeDisabled();
    await expect(
      englishMorePage.locator("[data-quantity-number]"),
    ).toHaveAttribute("disabled", "");
    await expect(
      englishMorePage.locator("[data-quantity-unit]"),
    ).toBeDisabled();
    await expect(
      englishMorePage.locator("[data-quantity-unit]"),
    ).toHaveAttribute("disabled", "");
    await expectWcagAAndAaClean(englishMorePage, "moreFailure (en)");

    await polishMorePage
      .getByRole("button", { name: COPY.pl.moreButton })
      .click();
    await waitForInteractionState(polishMorePage, "moreFailure");
    await expectNamedControls(polishMorePage, RESULT_CONTROLS(COPY.pl));
    await expect(
      polishMorePage.getByRole("button", { name: COPY.pl.moreButton }),
    ).toHaveAttribute("aria-disabled", "false");
    await expect(polishMorePage.locator("[data-result-card]")).toHaveCount(3);
    await expectWcagAAndAaClean(polishMorePage, "moreFailure (pl)");
  });
});
test.describe("Control keyboard-only flow", () => {
  /**
   * Drives the keyboard-only suggestion phase of one language (task 49,
   * REQ-018, REQ-019): the autofocused Search combobox, the typed query,
   * the open active-descendant panel with the first option highlighted,
   * Arrow Down and Arrow Up movement with clamping at both ends, Escape
   * cancellation (panel closed, exact query and Search focus retained, no
   * Substitution Search), a fresh keyboard reopening, and the Enter
   * selection of the option at `selectIndex`. Every step uses keyboard
   * input only — no `fill`, `click`, `selectOption`, or pointer gesture —
   * and returns the Substitution Search request bodies observed so far so
   * the caller can prove each later key operation starts exactly one
   * request with the exact committed input.
   */
  async function driveKeyboardSuggestionPhase(
    page: Page,
    seedKey: "en" | "pl",
    copy: (typeof COPY)[keyof typeof COPY],
    selectIndex: number,
  ): Promise<Array<Record<string, unknown>>> {
    const posts = trackSubstitutePosts(page);
    // Load the application; the Search field carries the autofocus, so it
    // is focused with no pointer input.
    await page.goto("/");
    const fixtures = KEYBOARD_SUGGESTIONS[seedKey];
    const search = page.getByRole("combobox", { name: copy.search });
    const panel = page.getByRole("listbox", { name: copy.listbox });

    // The Search field carries the autofocus: it is focused with no
    // pointer input.
    await expect(search).toBeFocused();
    await waitForInteractionState(page, "empty");

    // Typing the query opens the panel with the first option highlighted
    // (REQ-018): the first option is the active descendant.
    await page.keyboard.type(fixtures.query);
    await expect(panel).toBeVisible();
    await expectKeyboardActiveOption(page, fixtures.list, 0, copy);

    // Arrow Down moves the active option toward the fifth option and
    // clamps there; Arrow Up moves toward the first option and clamps
    // there. Every move updates the active styling and the Search input's
    // `aria-activedescendant` (REQ-019).
    await search.press("ArrowDown");
    await expectKeyboardActiveOption(page, fixtures.list, 1, copy);
    await search.press("ArrowDown");
    await expectKeyboardActiveOption(page, fixtures.list, 2, copy);
    await search.press("ArrowUp");
    await expectKeyboardActiveOption(page, fixtures.list, 1, copy);
    await search.press("ArrowUp");
    await search.press("ArrowUp");
    await expectKeyboardActiveOption(page, fixtures.list, 0, copy);
    await search.press("ArrowDown");
    await search.press("ArrowDown");
    await search.press("ArrowDown");
    await search.press("ArrowDown");
    await search.press("ArrowDown");
    await expectKeyboardActiveOption(page, fixtures.list, 4, copy);
    await search.press("ArrowDown");
    await expectKeyboardActiveOption(page, fixtures.list, 4, copy);
    for (let index = 4; index > selectIndex; index -= 1) {
      await search.press("ArrowUp");
    }
    await expectKeyboardActiveOption(page, fixtures.list, selectIndex, copy);

    // Escape cancels the list: the panel closes, the exact Search Query
    // text and Search focus are retained, and no Substitution Search
    // starts (REQ-019).
    await search.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(search).toHaveValue(fixtures.query);
    await expect(search).toBeFocused();
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await expect(search).not.toHaveAttribute("aria-activedescendant");
    expect(posts).toHaveLength(0);

    // Typing reopens the panel without pointer input; the first option is
    // active again (REQ-018).
    await search.press("Backspace");
    await page.keyboard.type(fixtures.query.at(-1) ?? "");
    await expect(panel).toBeVisible();
    await expectKeyboardActiveOption(page, fixtures.list, 0, copy);

    // Move to the intended option and select it with Enter (REQ-019).
    for (let index = 0; index < selectIndex; index += 1) {
      await search.press("ArrowDown");
    }
    await expectKeyboardActiveOption(page, fixtures.list, selectIndex, copy);
    await search.press("Enter");
    return posts;
  }

  test("[en-US] one keyboard-only path reaches and operates every control — Search and the suggestion list, Interface Language, Quantity number and unit, and MORE! — and the results heading is the focus target after each successful page, without pointer input (REQ-018, REQ-019, REQ-026, REQ-068, REQ-083, P15-G2, P15-G7)", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    // Pizza Margherita (ID 1) allows two units, so the Quantity editor
    // renders the operable Unit selector.
    const posts = await driveKeyboardSuggestionPhase(page, "en", COPY.en, 0);
    const search = page.getByRole("combobox", { name: COPY.en.search });
    const heading = page.locator("[data-substitutions-heading]");

    // Enter selected Pizza Margherita through the same transition a
    // pointer click uses: exactly one page-0 POST with the backend default
    // one-serving quantity, the three seeded first-page cards, and the
    // localized results heading as the active element (REQ-083).
    await expect(
      page.getByRole("listbox", { name: COPY.en.listbox }),
    ).toHaveCount(0);
    await expect(search).toHaveValue(COPY.en.pizzaName);
    await waitForInteractionState(page, "results");
    await expect(page.locator("[data-result-card]")).toHaveCount(3);
    await expect
      .poll(() => renderedCardIDs(page))
      .toEqual([...PIZZA_PAGE_0_IDS]);
    await expect(heading).toHaveText(COPY.en.foundSubstitutions);
    await expect(heading).toBeFocused();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual({
      foodObjectId: PIZZA_FOOD_OBJECT_ID,
      quantity: { value: 1, unit: "serving" },
      pageIndex: 0,
    });

    // Quantity rejection (REQ-026): Tab from the heading to Search, then
    // to the Quantity number field; type an invalid draft and commit with
    // Enter. The exact text stays, the localized message renders, the
    // field keeps focus, and no request starts.
    const numberInput = page.locator("[data-quantity-number]");
    await focusWithTab(page, numberInput);
    await expect(numberInput).toBeFocused();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("abc");
    await page.keyboard.press("Enter");
    await expect(numberInput).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("[data-quantity-error]")).toHaveText(
      COPY.en.invalidQuantity,
    );
    await expect(numberInput).toBeFocused();
    expect(posts).toHaveLength(1);

    // Valid quantity commit: replace the draft with `2` and commit with
    // Enter; exactly one recalculation POST with the changed Serving
    // count, then the results heading as the focus target again.
    await page.keyboard.press("Control+A");
    await page.keyboard.type("2");
    await page.keyboard.press("Enter");

    await expect.poll(() => posts.length).toBe(2);
    expect(posts[1]).toEqual({
      foodObjectId: PIZZA_FOOD_OBJECT_ID,
      quantity: { value: 2, unit: "serving" },
      pageIndex: 0,
    });
    // A valid recalculation keeps the initiating number-field focus
    // (REQ-048); the results heading is not a focus target here.
    await waitForInteractionState(page, "results");
    await expect(numberInput).toBeFocused();

    // Unit change: Tab to the Unit selector and press ArrowDown; the draft
    // becomes `100` and the `g` unit commits immediately (ISSUE-010).
    const unitSelect = page.locator("[data-quantity-unit]");
    await focusWithTab(page, unitSelect);
    await expect(unitSelect).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => posts.length).toBe(3);
    expect(posts[2]).toEqual({
      foodObjectId: PIZZA_FOOD_OBJECT_ID,
      quantity: { value: 100, unit: "g" },
      pageIndex: 0,
    });

    await waitForInteractionState(page, "results");
    await expect(numberInput).toHaveValue("100");
    await expect(unitSelect).toHaveValue("g");
    // The initiating unit selector keeps focus through the recalculation
    // (REQ-048).
    await expect(unitSelect).toBeFocused();

    // MORE! paging: Tab to the MORE! button and activate it with Space;
    // exactly one next-page POST and the page-1 cards replace page 0 with
    // the heading as the focus target (REQ-041, REQ-083).
    const moreButton = page.locator("[data-more-button]");
    await focusWithTab(page, moreButton);
    await expect(moreButton).toBeFocused();
    await page.keyboard.press("Space");
    await expect.poll(() => posts.length).toBe(4);
    expect(posts[3]).toEqual({
      foodObjectId: PIZZA_FOOD_OBJECT_ID,
      quantity: { value: 100, unit: "g" },
      pageIndex: 1,
    });
    await waitForInteractionState(page, "results");
    await expect
      .poll(() => renderedCardIDs(page))
      .toEqual([...PIZZA_PAGE_1_IDS]);
    await expect(heading).toBeFocused();

    // Interface Language selection: Tab to the selector and press
    // ArrowUp; the native select moves EN → PL (the PL option precedes
    // the EN option) and every visible and accessibility string switches
    // in place without a request. The exact Search Query text (the
    // retained selected name) is not translated (REQ-059).
    const languageControl = page.getByRole("combobox", {
      name: COPY.en.languageControl,
    });
    await focusWithTab(page, languageControl);
    await expect(languageControl).toBeFocused();
    await page.keyboard.press("ArrowUp");
    // The native select re-renders its accessible name in the new
    // language, so the value and focus assertions use the stable control
    // selector (the same node keeps focus; task 44).
    const languageSelect = page.locator("[data-interface-language] select");
    await expect(languageSelect).toHaveValue("pl");
    await expect(languageSelect).toBeFocused();
    await expect(heading).toHaveText(COPY.pl.foundSubstitutions);
    await expect(page.locator("#food-search")).toHaveValue(COPY.en.pizzaName);
    await expect(
      page.getByRole("combobox", { name: COPY.pl.search }),
    ).toHaveAttribute("placeholder", COPY.pl.searchPlaceholder);
    await expect(
      page.getByRole("button", { name: COPY.pl.moreButton }),
    ).toBeVisible();
    expect(posts).toHaveLength(4);

    // Shift+Tab returns focus to the retained MORE! control, whose
    // localized label now reads in Polish.
    await page.keyboard.press("Shift+Tab");
    await expect(
      page.getByRole("button", { name: COPY.pl.moreButton }),
    ).toBeFocused();
  });

  test("[pl-PL] one keyboard-only path reaches and operates every control — Search and the suggestion list, Interface Language, Quantity number and unit, and MORE! — and the results heading is the focus target after each successful page, without pointer input (REQ-018, REQ-019, REQ-026, REQ-068, REQ-083, P15-G2, P15-G7)", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["pl-PL"]);
    // The second suggestion (Smażone skrzydełka z kurczaka, ID 22) allows
    // two units, so the Quantity editor renders the operable Unit
    // selector in Polish too.
    const posts = await driveKeyboardSuggestionPhase(page, "pl", COPY.pl, 1);
    const search = page.getByRole("combobox", { name: COPY.pl.search });
    const heading = page.locator("[data-substitutions-heading]");

    // Enter selected the second option: exactly one page-0 POST with the
    // default one-serving quantity and the localized results heading as
    // the active element (REQ-083).
    await expect(
      page.getByRole("listbox", { name: COPY.pl.listbox }),
    ).toHaveCount(0);
    await expect(search).toHaveValue(COPY.pl.wingsName);
    await waitForInteractionState(page, "results");
    await expect(page.locator("[data-result-card]")).toHaveCount(3);
    await expect(heading).toHaveText(COPY.pl.foundSubstitutions);
    await expect(heading).toBeFocused();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual({
      foodObjectId: 22,
      quantity: { value: 1, unit: "serving" },
      pageIndex: 0,
    });

    // Quantity rejection (Polish, REQ-026).
    const numberInput = page.locator("[data-quantity-number]");
    await focusWithTab(page, numberInput);
    await expect(numberInput).toBeFocused();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("abc");
    await page.keyboard.press("Enter");
    await expect(numberInput).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("[data-quantity-error]")).toHaveText(
      COPY.pl.invalidQuantity,
    );
    await expect(numberInput).toBeFocused();
    expect(posts).toHaveLength(1);

    // Valid quantity commit (Polish): `2` servings.
    await page.keyboard.press("Control+A");
    await page.keyboard.type("2");
    await page.keyboard.press("Enter");

    await expect.poll(() => posts.length).toBe(2);
    expect(posts[1]).toEqual({
      foodObjectId: 22,
      quantity: { value: 2, unit: "serving" },
      pageIndex: 0,
    });
    // A valid recalculation keeps the initiating number-field focus
    // (REQ-048); the results heading is not a focus target here.
    await waitForInteractionState(page, "results");
    await expect(numberInput).toBeFocused();

    // Unit change (Polish): ArrowDown on the Unit selector commits 100 g.
    const unitSelect = page.locator("[data-quantity-unit]");
    await focusWithTab(page, unitSelect);
    await expect(unitSelect).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => posts.length).toBe(3);
    expect(posts[2]).toEqual({
      foodObjectId: 22,
      quantity: { value: 100, unit: "g" },
      pageIndex: 0,
    });

    await waitForInteractionState(page, "results");
    await expect(numberInput).toHaveValue("100");
    await expect(unitSelect).toHaveValue("g");
    // The initiating unit selector keeps focus through the recalculation
    // (REQ-048).
    await expect(unitSelect).toBeFocused();

    // MORE! paging (Polish): Space activates the button; one next-page
    // POST with the unchanged 100 g input.
    const moreButton = page.locator("[data-more-button]");
    await focusWithTab(page, moreButton);
    await expect(moreButton).toBeFocused();
    await page.keyboard.press("Space");
    await expect.poll(() => posts.length).toBe(4);
    expect(posts[3]).toEqual({
      foodObjectId: 22,
      quantity: { value: 100, unit: "g" },
      pageIndex: 1,
    });
    await waitForInteractionState(page, "results");
    await expect(page.locator("[data-result-card]")).toHaveCount(3);
    await expect(heading).toBeFocused();

    // Interface Language selection (Polish → English): ArrowDown on the
    // focused selector switches the active language in place without a
    // request; the retained Search Query text is not translated
    // (REQ-059).
    const languageControl = page.getByRole("combobox", {
      name: COPY.pl.languageControl,
    });
    await focusWithTab(page, languageControl);
    await expect(languageControl).toBeFocused();
    await page.keyboard.press("ArrowDown");
    // The native select re-renders its accessible name in the new
    // language, so the value and focus assertions use the stable control
    // selector (the same node keeps focus; task 44).
    const languageSelect = page.locator("[data-interface-language] select");
    await expect(languageSelect).toHaveValue("en");
    await expect(languageSelect).toBeFocused();
    await expect(heading).toHaveText(COPY.en.foundSubstitutions);
    await expect(page.locator("#food-search")).toHaveValue(COPY.pl.wingsName);
    await expect(
      page.getByRole("combobox", { name: COPY.en.search }),
    ).toHaveAttribute("placeholder", COPY.en.searchPlaceholder);
    await expect(
      page.getByRole("button", { name: COPY.en.moreButton }),
    ).toBeVisible();
    expect(posts).toHaveLength(4);

    // Shift+Tab returns focus to the retained MORE! control, now labeled
    // in English.
    await page.keyboard.press("Shift+Tab");
    await expect(
      page.getByRole("button", { name: COPY.en.moreButton }),
    ).toBeFocused();
  });
});
