import { isLandingDialogueRequest } from "./request-purpose";
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

const COPY = {
  en: {
    search: "Search",
    searchPlaceholder: "Search foods",
    listbox: "Suggestions",
    languageControl: "Interface language",
    quantity: "Quantity",
    unit: "Unit",
    servings: "servings",
    retry: "Try again",
    invalidQuantity: "Enter a valid quantity.",
    chickenQuery: "chicken",
    pizzaQuery: "pizza",
    chickenName: "Chicken breast",
    foundSubstitutions: "Substitutes",
    pizzaName: "Pizza Margherita",
  },
  pl: {
    search: "Szukaj",
    searchPlaceholder: "Szukaj potraw",
    listbox: "Podpowiedzi",
    languageControl: "Język interfejsu",
    quantity: "Ilość",
    unit: "Jednostka",
    servings: "porcje",
    retry: "Spróbuj ponownie",
    invalidQuantity: "Wpisz prawidłową ilość.",
    chickenQuery: "kurczak",
    pizzaQuery: "pizza",
    chickenName: "Pierś z kurczaka",
    foundSubstitutions: "Zamienniki",
    wingsName: "Smażone skrzydełka z kurczaka",
  },
} as const;

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

const PIZZA_FOOD_OBJECT_ID = 1;

function optionId(foodObjectId: number): string {
  return `food-suggestion-option-${foodObjectId}`;
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

interface SubstitutePostGate {
  waitForPosts: (count: number) => Promise<void>;
  releasePost: (index: number) => void;
  count: () => number;
}

function gateSubstitutePosts(page: Page): SubstitutePostGate {
  const gates: Array<{ release: () => void; promise: Promise<void> }> = [];
  let postCount = 0;
  page.route("**/api/v1/substitutes/search", async (route) => {
    if (isLandingDialogueRequest(route.request())) {
      await route.continue();
      return;
    }
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

async function expectControl(
  page: Page,
  role: "combobox" | "textbox" | "button" | "listbox" | "option" | "group",
  name: string,
): Promise<void> {
  await expect(page.getByRole(role, { name }), `${role} "${name}"`).toHaveCount(
    1,
  );
}

const CONTROL_ROLE_ALTERNATION = "combobox|textbox|button|listbox|option|group";

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

async function waitForInteractionState(
  page: Page,
  name: string,
): Promise<void> {
  await expect(page.locator("main")).toHaveAttribute(
    "data-interaction-state",
    name,
  );
}

const PRIMARY_RGB = "rgb(74, 222, 128)";

const TEXT_ON_BRIGHT_RGB = "rgb(10, 15, 10)";

const TEXT_PRIMARY_RGB = "rgb(243, 244, 246)";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] as const;

async function expectWcagAAndAaClean(page: Page, state: string): Promise<void> {
  await page.waitForFunction(() => {
    const cards = Array.from(
      document.querySelectorAll(
        "[data-selected-food-summary], [data-result-card]",
      ),
    );
    return cards.every(
      (card) =>
        card
          .closest("[data-card-reveal]")
          ?.getAttribute("data-card-reveal-state") === "shown",
    );
  });
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

  await expect(
    page
      .locator("[data-selected-food-summary]")
      .locator("xpath=ancestor::*[@data-card-reveal]"),
  ).toHaveAttribute("data-card-reveal-state", "shown");
  await expect(
    page.locator('[data-card-reveal-state="shown"] [data-result-card]'),
  ).toHaveCount(3);
}

interface SRGB {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

function parseComputedColor(value: string): SRGB {
  const trimmed = value.trim();
  if (trimmed === "transparent") {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const rgb = trimmed.match(/^rgba?\(([^)]+)\)$/);
  if (rgb !== null) {
    return parseComputedRgb(rgb[1]);
  }
  const oklch = trimmed.match(/^oklch\(([^)]+)\)$/);
  if (oklch !== null) {
    return parseComputedOklch(oklch[1]);
  }
  const oklab = trimmed.match(/^oklab\(([^)]+)\)$/);
  if (oklab !== null) {
    return parseComputedOklab(oklab[1]);
  }
  throw new Error(`unparsed computed color: ${value}`);
}

function parseColorChannels(value: string): number[] {
  return value.split(/[ ,/]+/).map((part) => Number.parseFloat(part));
}

function parseComputedRgb(value: string): SRGB {
  const parts = parseColorChannels(value);
  return {
    r: parts[0] ?? 0,
    g: parts[1] ?? 0,
    b: parts[2] ?? 0,
    a: parts[3] ?? 1,
  };
}

function parseComputedOklch(value: string): SRGB {
  const parts = parseColorChannels(value);
  const lightness = parts[0] ?? 0;
  const chroma = parts[1] ?? 0;
  const hue = parts[2] ?? 0;
  const radians = (hue * Math.PI) / 180;
  return oklabToSrgb(
    lightness,
    chroma * Math.cos(radians),
    chroma * Math.sin(radians),
    parts[3] ?? 1,
  );
}

function parseComputedOklab(value: string): SRGB {
  const parts = parseColorChannels(value);
  return oklabToSrgb(
    parts[0] ?? 0,
    parts[1] ?? 0,
    parts[2] ?? 0,
    parts[3] ?? 1,
  );
}

function oklabToSrgb(
  lightness: number,
  a: number,
  b: number,
  alpha: number,
): SRGB {
  const l_ = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return {
    r: encodeSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: encodeSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: encodeSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: alpha,
  };
}

function encodeSrgb(value: number): number {
  const clipped = Math.min(1, Math.max(0, value));
  const encoded =
    clipped <= 0.0031308
      ? 12.92 * clipped
      : 1.055 * clipped ** (1 / 2.4) - 0.055;
  return encoded * 255;
}

function compositeOver(fg: SRGB, bg: SRGB, alpha: number): SRGB {
  return {
    r: fg.r * alpha + bg.r * (1 - alpha),
    g: fg.g * alpha + bg.g * (1 - alpha),
    b: fg.b * alpha + bg.b * (1 - alpha),
    a: 1,
  };
}

function relativeLuminance(color: SRGB): number {
  const toLinear = (channel: number): number => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * toLinear(color.r) +
    0.7152 * toLinear(color.g) +
    0.0722 * toLinear(color.b)
  );
}

function contrastRatio(a: SRGB, b: SRGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

function serializeColor(color: SRGB): string {
  return `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`;
}

type ContrastKind = "text" | "border" | "border-bottom" | "outline";

interface EffectiveColors {
  readonly foreground: string;
  readonly ownBackground: string;
  readonly backdrop: string;
  readonly opacity: string;
}

async function sampleEffectiveColorsAll(
  page: Page,
  selector: string,
  kind: ContrastKind,
  pseudo?: string,
): Promise<EffectiveColors[]> {
  return page.evaluate(
    ({ selector, kind, pseudo }) => {
      const elements = Array.from(document.querySelectorAll(selector));
      if (elements.length === 0) {
        throw new Error(`sampleEffectiveColorsAll: no element for ${selector}`);
      }
      return elements.map((element) => {
        const style = getComputedStyle(element);
        const foreground =
          pseudo !== undefined
            ? getComputedStyle(element, pseudo).color
            : kind === "text"
              ? style.color
              : kind === "border"
                ? style.borderTopColor
                : kind === "border-bottom"
                  ? style.borderBottomColor
                  : style.outlineColor;
        const ownBackground = style.backgroundColor;
        let node: Element | null = element.parentElement;
        let backdrop = "rgb(255, 255, 255)";
        while (node !== null) {
          const candidate = getComputedStyle(node).backgroundColor;
          if (candidate !== "rgba(0, 0, 0, 0)" && candidate !== "transparent") {
            backdrop = candidate;
            break;
          }
          node = node.parentElement;
        }
        return { foreground, ownBackground, backdrop, opacity: style.opacity };
      });
    },
    { selector, kind, pseudo },
  );
}

interface PresentationContrast {
  readonly contrast: number;
  readonly foreground: string;
  readonly background: string;
}

async function samplePresentations(
  page: Page,
  selector: string,
  kind: ContrastKind,
  pseudo?: string,
): Promise<PresentationContrast[]> {
  const samples = await sampleEffectiveColorsAll(page, selector, kind, pseudo);
  return samples.map(({ foreground, ownBackground, backdrop, opacity }) => {
    const behind = parseComputedColor(backdrop);
    const own = parseComputedColor(ownBackground);
    const alpha = Number.parseFloat(opacity);
    let fg = parseComputedColor(foreground);
    if (fg.a < 1) {
      fg = compositeOver(fg, own.a > 0 ? own : behind, fg.a);
    }
    let effectiveForeground: SRGB;
    let effectiveBackground: SRGB;
    if (alpha === 1) {
      effectiveForeground = fg;
      effectiveBackground =
        kind === "outline" ? behind : own.a > 0 ? own : behind;
    } else {
      effectiveForeground = compositeOver(fg, behind, alpha);
      effectiveBackground =
        kind === "outline" || own.a === 0
          ? behind
          : compositeOver(own, behind, alpha);
    }
    return {
      contrast: contrastRatio(effectiveForeground, effectiveBackground),
      foreground: serializeColor(effectiveForeground),
      background: serializeColor(effectiveBackground),
    };
  });
}

interface ContrastTarget {
  readonly selector: string;

  readonly kind: ContrastKind;

  readonly minimum: number;

  readonly where: string;

  readonly pseudo?: string;
}

async function expectContrastTargets(
  page: Page,
  targets: readonly ContrastTarget[],
): Promise<void> {
  for (const target of targets) {
    const samples = await samplePresentations(
      page,
      target.selector,
      target.kind,
      target.pseudo,
    );
    expect(
      samples.length,
      `${target.where}: at least one rendered match for ${target.selector}`,
    ).toBeGreaterThan(0);
    for (const [index, sample] of samples.entries()) {
      expect(
        sample.contrast,
        `${target.where} match ${index + 1}/${samples.length}: ${sample.foreground} on ${sample.background} reaches ${target.minimum}:1 (WCAG 2.1 AA, REQ-069)`,
      ).toBeGreaterThanOrEqual(target.minimum);
    }
  }
}

const EDITOR_NAMES = {
  en: ["Quantity", "Calories", "Protein", "Carbohydrates", "Fat"],
  pl: ["Ilość", "Kalorie", "Białko", "Węglowodany", "Tłuszcz"],
} as const;

for (const language of ["en", "pl"] as const) {
  const copy = COPY[language];
  test(`${language}: controls, keyboard navigation, validation and pending pages remain accessible`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await useBrowserLanguages(page, [language]);
    const gates = gateSubstitutePosts(page);
    await page.goto("/");
    const search = page.getByRole("combobox", {
      name: copy.search,
      exact: true,
    });
    await expect(search).toBeFocused();
    await expectNamedControls(page, [
      ["combobox", copy.search],
      ["combobox", copy.languageControl],
    ]);
    await expectWcagAAndAaClean(page, "empty");
    await expectContrastTargets(page, [
      {
        selector: "#food-search",
        kind: "text",
        pseudo: "::placeholder",
        minimum: 4.5,
        where: "Search placeholder",
      },
      {
        selector: "#food-search",
        kind: "border",
        minimum: 3,
        where: "Search focus",
      },
      {
        selector: "[data-interface-language] select",
        kind: "text",
        minimum: 4.5,
        where: "Language selector",
      },
    ]);
    await page.keyboard.type(copy.chickenQuery);
    await expectKeyboardActiveOption(
      page,
      SEEDED_SUGGESTIONS[language],
      0,
      copy,
    );
    await search.press("ArrowDown");
    await expectKeyboardActiveOption(
      page,
      SEEDED_SUGGESTIONS[language],
      1,
      copy,
    );
    await expectWcagAAndAaClean(page, "suggestions");
    await search.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(search).toHaveValue(copy.chickenQuery);
    await search.fill("margherita");
    await expect(page.locator("#food-suggestion-option-1")).toBeVisible();
    await search.press("Enter");
    await gates.waitForPosts(1);
    await expect(search).toBeFocused();
    await expectWcagAAndAaClean(page, "loadingNew");
    await search.fill(copy.chickenQuery);
    const panel = page.getByRole("listbox", { name: copy.listbox });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("option").first()).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await search.press("Enter");
    expect(gates.count()).toBe(1);
    await expectWcagAAndAaClean(page, "locked suggestions");
    await search.press("Escape");
    gates.releasePost(0);
    await waitForInteractionState(page, "results");
    await expect(
      page
        .locator("[data-selected-food-summary]")
        .locator("xpath=ancestor::*[@data-card-reveal]"),
    ).toHaveAttribute("data-card-reveal-state", "shown");
    for (const name of EDITOR_NAMES[language])
      await expect(
        page.getByRole("textbox", { name, exact: true }),
      ).toHaveCount(1);
    await expect(page.getByRole("combobox")).toHaveCount(2);
    const toggle = page.getByRole("button", {
      name: copy.servings,
      exact: true,
    });
    await focusWithTab(page, toggle);
    await expect(toggle).toHaveCSS("outline-style", "solid");
    await expectContrastTargets(page, [
      {
        selector: "[data-unit-toggle]",
        kind: "outline",
        minimum: 3,
        where: "Unit keyboard focus",
      },
    ]);
    await toggle.press("Space");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("[data-nutrition-editor=quantity]")).toHaveValue(
      "350",
    );
    await toggle.press("Enter");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    for (const field of [
      "quantity",
      "calories",
      "protein",
      "carbohydrate",
      "fat",
    ]) {
      const input = page.locator(`[data-nutrition-editor=${field}]`);
      await focusWithTab(page, input);
      await expect(input).toBeFocused();
      await expect(input).toHaveCSS("font-weight", "700");
      await expect(input).toHaveCSS("text-decoration-line", "underline");
    }
    await expectWcagAAndAaClean(page, "results");
    await expectContrastTargets(page, [
      {
        selector: "[data-result-card] h3",
        kind: "text",
        minimum: 4.5,
        where: "Food names",
      },
      {
        selector: "[data-result-card] dt",
        kind: "text",
        minimum: 4.5,
        where: "Macro labels",
      },
      {
        selector: "[data-result-card] dd",
        kind: "text",
        minimum: 4.5,
        where: "Macro values",
      },
      {
        selector: "[data-nutrition-editor]",
        kind: "text",
        minimum: 4.5,
        where: "Editable nutrition",
      },
    ]);
    const quantity = page.getByRole("textbox", {
      name: copy.quantity,
      exact: true,
    });
    await quantity.fill("abc");
    await quantity.press("Enter");
    await expect(quantity).toBeFocused();
    await expect(quantity).toHaveAttribute("aria-invalid", "true");
    await expect(quantity).toHaveAttribute(
      "aria-describedby",
      "nutrition-edit-error",
    );
    await expect(page.locator("#nutrition-edit-error")).not.toHaveText("");
    await expectWcagAAndAaClean(page, "invalid quantity");
    await quantity.press("Escape");
    await expect(quantity).toHaveValue("1");
    await page.locator("[data-pagination-sentinel]").scrollIntoViewIfNeeded();
    await gates.waitForPosts(2);
    await expect(page.locator("[data-pagination-spinner]")).toBeVisible();
    await quantity.fill("2");
    await quantity.press("Enter");
    await expect(page.locator("[data-nutrition-editor=calories]")).toHaveValue(
      "1750",
    );
    await expectWcagAAndAaClean(page, "loadingMore");
    expect(gates.count()).toBe(2);
    gates.releasePost(1);
    await expect(page.locator("[data-result-card]")).toHaveCount(6);
    await expect(page.locator("[data-pagination-spinner]")).toHaveCount(0);
  });
}

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
    } catch {}
    const { promise: sleep, resolve: wake } = Promise.withResolvers<void>();
    setTimeout(wake, 250);
    await sleep;
  }
  throw new Error(
    "the outage Fiber did not report catalog unavailability after its PostgreSQL stopped",
  );
}

test.describe("Control accessibility failure states", () => {
  test("after the outage, English and Polish search and page failures retain accessible retry controls", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:4173",
    });
    const surfaces: { page: Page; language: "en" | "pl"; paging: boolean }[] =
      [];
    try {
      for (const language of ["en", "pl"] as const) {
        for (const paging of [false, true]) {
          const page = await context.newPage();
          await useBrowserLanguages(page, [language]);
          await page.goto("/");
          const copy = COPY[language];
          if (paging) await selectPizzaAndWaitForResults(page, copy);
          else {
            await page
              .getByRole("combobox", { name: copy.search, exact: true })
              .fill(copy.chickenQuery);
            await expect(
              page.locator("#food-suggestion-option-5"),
            ).toBeVisible();
          }
          surfaces.push({ page, language, paging });
        }
      }
      await stopOutagePostgresAndWait();
      for (const { page, language, paging } of surfaces) {
        const copy = COPY[language];
        if (paging)
          await page
            .locator("[data-pagination-sentinel]")
            .scrollIntoViewIfNeeded();
        else await page.locator("#food-suggestion-option-5").click();
        await waitForInteractionState(
          page,
          paging ? "moreFailure" : "newSearchFailure",
        );
        const retry = page.getByRole("button", {
          name: copy.retry,
          exact: true,
        });
        await expect(retry).toBeEnabled();
        await expect(page.locator("[data-result-card]")).toHaveCount(
          paging ? 3 : 0,
        );
        await expectWcagAAndAaClean(page, `${language} failure`);
        await expectContrastTargets(page, [
          {
            selector: "[data-retry-message]",
            kind: "text",
            minimum: 4.5,
            where: "Retry message",
          },
        ]);
        await focusWithTab(page, retry);
        await expect(retry).toBeFocused();
        if (paging)
          await expect(
            page.locator("[data-nutrition-editor=quantity]"),
          ).toBeEnabled();
      }
    } finally {
      await context.close();
    }
  });
});
