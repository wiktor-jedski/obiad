import { cpSync, existsSync, mkdirSync } from "node:fs";
import type { SubstituteSearchRequest } from "../src/client/types.gen";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

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

const PIZZA_PAGE_0_IDS = [13, 29, 26] as const;

const PIZZA_PAGE_1_IDS = [30, 3, 35] as const;

const PIZZA_FOOD_OBJECT_ID = 1;

const CHICKEN_FOOD_OBJECT_ID = 5;

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

function trackSubstitutePosts(page: Page): SubstituteSearchRequest[] {
  const posts: SubstituteSearchRequest[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/v1/substitutes/search")
    ) {
      // SAFETY: The request payload matches the generated API contract.
      posts.push(request.postDataJSON() as SubstituteSearchRequest);
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

const SECONDARY_RGB = "rgb(134, 239, 172)";

const TEXT_ON_BRIGHT_RGB = "rgb(10, 15, 10)";

const TEXT_PRIMARY_RGB = "rgb(243, 244, 246)";

const DISABLED_MORE_BACKGROUND_COLOR = "oklch(0.446 0.03 256.802)";

const DISABLED_MORE_TEXT_COLOR = "oklch(0.872 0.01 258.338)";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] as const;

async function expectWcagAAndAaClean(page: Page, state: string): Promise<void> {
  await page.waitForFunction(() => {
    const cards = Array.from(document.querySelectorAll("[data-result-card]"));
    return cards.every(
      (card) =>
        getComputedStyle(card).opacity === "1" &&
        card.getAnimations().length === 0,
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

interface ControlPresentation {
  readonly borderTopColor: string;
  readonly backgroundColor: string;
  readonly color: string;
  readonly outlineStyle: string;
  readonly outlineWidth: string;
  readonly outlineColor: string;
  readonly outlineOffset: string;
}

interface RegionGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface SurfaceSnapshot {
  readonly controls: Readonly<Record<string, ControlPresentation>>;
  readonly regions: Readonly<Record<string, RegionGeometry>>;
}

const CONTROL_SELECTORS = {
  search: "#food-search",
  language: "[data-interface-language] select",
  quantityNumber: "[data-quantity-number]",
  quantityUnit: "[data-quantity-unit]",
  moreButton: "[data-more-button]",
} as const;

const REGION_SELECTORS = [
  "[data-search-region]",
  "[data-selected-input]",
  "[data-result-region]",
  "[data-interface-language]",
] as const;

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

type FocusIndicatorKind = "border" | "outline";

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

    await expect(element).toHaveCSS("outline-color", PRIMARY_RGB);
    await expect(element).toHaveCSS("outline-offset", "2px");
  }
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

  await expect
    .poll(async () =>
      page
        .locator("[data-result-card]")
        .evaluateAll((elements) =>
          elements.every(
            (element) => getComputedStyle(element).opacity === "1",
          ),
        ),
    )
    .toBe(true);
}

const EDITOR_CONTROLS = (copy: (typeof COPY)[keyof typeof COPY]) =>
  [
    ["combobox", copy.search],
    ["combobox", copy.languageControl],
    ["textbox", copy.quantity],
    ["combobox", copy.unit],
  ] as const;

const RESULT_CONTROLS = (copy: (typeof COPY)[keyof typeof COPY]) =>
  [...EDITOR_CONTROLS(copy), ["button", copy.moreButton]] as const;

const REVIEW_COPY_DIR = "/tmp/obiad-task53-control-accessibility";

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

async function expectSettledCards(page: Page, _where: string): Promise<void> {
  await expect
    .poll(async () =>
      page
        .locator("[data-result-card]")
        .evaluateAll((elements) =>
          elements.every(
            (element) =>
              getComputedStyle(element).opacity === "1" &&
              element.getAnimations().length === 0,
          ),
        ),
    )
    .toBe(true);
}

async function attachReviewSurface(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const screenshotName = `control-accessibility-${name}.png`;
  const screenshotPath = testInfo.outputPath(screenshotName);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach(screenshotName, {
    path: screenshotPath,
    contentType: "image/png",
  });
  const mirror = `${REVIEW_COPY_DIR}/${screenshotName}`;
  if (!existsSync(dirname(mirror))) {
    mkdirSync(dirname(mirror), { recursive: true });
  }
  cpSync(screenshotPath, mirror);
  console.log(
    `[control-accessibility] review attachment ${screenshotName}: ${screenshotPath} (mirrored to ${mirror})`,
  );
}

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

      await expectNamedControls(page, [
        ["combobox", copy.search],
        ["combobox", copy.languageControl],
      ]);

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

      await gates.waitForPosts(1);
      await waitForInteractionState(page, "loadingNew");
      await expectNamedControls(page, EDITOR_CONTROLS(copy));
      await expect(page.getByRole("button")).toHaveCount(0);

      gates.releasePost(0);
      await waitForInteractionState(page, "results");
    });

    test(`[${lang}] a successful result page resolves Search, Interface Language, Quantity, Unit, and MORE! by their exact localized names with one role each (REQ-068)`, async ({
      page,
    }) => {
      await useBrowserLanguages(page, [lang]);
      await page.goto("/");
      await selectPizzaAndWaitForResults(page, copy);

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
  for (const [, lang, copy] of [
    ["en", "en-US", COPY.en],
    ["pl", "pl-PL", COPY.pl],
  ] as const) {
    test(`[${lang}] the empty state shows a visible keyboard focus indicator on Search and the Interface Language selector with no layout or non-focus color change (REQ-068, P15-G2, P15-G7)`, async ({
      page,
    }) => {
      await useBrowserLanguages(page, [lang]);
      await page.goto("/");
      await waitForInteractionState(page, "empty");

      const search = page.getByRole("combobox", { name: copy.search });
      await expect(search).toBeFocused();
      await expectVisibleFocusIndicator(page, "search", "border");
      const baseline = await captureSurface(page);

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

      const firstOption = panel.getByRole("option").first();
      await expect(firstOption).toHaveCSS("background-color", PRIMARY_RGB);
      await expect(firstOption).toHaveCSS("color", TEXT_ON_BRIGHT_RGB);

      const baseline = await captureSurface(page);

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

      const baseline = await captureSurface(page);

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

        await page.waitForTimeout(250);
        const after = await captureSurface(page);
        expectFocusMove(before, after, toControl, fromControl);
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
  for (const [, lang, copy] of [
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

      await expect(numberInput).toBeDisabled();
      await expect(numberInput).toHaveAttribute("disabled", "");
      await expect(numberInput).not.toHaveAttribute("aria-disabled", "true");
      await expect(unitSelect).toBeDisabled();
      await expect(unitSelect).toHaveAttribute("disabled", "");
      await expect(unitSelect).not.toHaveAttribute("aria-disabled", "true");

      await expect(search).toBeFocused();

      await numberInput.dispatchEvent("click");
      await numberInput.dispatchEvent("keydown", { key: "Enter" });
      await unitSelect.dispatchEvent("change");
      await page.locator("[data-quantity-editor]").dispatchEvent("focusout");
      await numberInput.press("Enter");
      await page.waitForTimeout(300);
      expect(gates.count()).toBe(1);
      await expect(search).toBeFocused();

      await unitSelect.click({ force: true });
      await page.waitForTimeout(300);
      expect(gates.count()).toBe(1);

      await search.focus();
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("combobox", { name: copy.languageControl }),
      ).toBeFocused();

      gates.releasePost(0);
      await waitForInteractionState(page, "results");
    });

    test(`[${lang}] a valid local quantity commit keeps the Quantity editor operable and starts no request (REQ-048, REQ-068)`, async ({
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

      const numberInput = page.locator("[data-quantity-number]");
      const unitSelect = page.locator("[data-quantity-unit]");
      const moreButton = page.locator("[data-more-button]");
      await numberInput.fill("2");
      await numberInput.press("Enter");

      await expect(numberInput).toBeFocused();
      await expect(numberInput).toBeEnabled();
      await expect(numberInput).not.toHaveAttribute("aria-disabled");
      await expect(numberInput).not.toHaveAttribute("readonly");
      await expect(unitSelect).toBeEnabled();
      await expect(unitSelect).not.toHaveAttribute("aria-disabled");
      await expect(unitSelect).not.toHaveAttribute("tabindex", "-1");
      await expect(moreButton).toHaveAttribute("aria-disabled", "false");
      await page.waitForTimeout(300);
      expect(gates.count()).toBe(1);
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
  for (const [, lang, copy] of [
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

    test(`[${lang}] the hovered MORE! control state reports no definite WCAG 2.1 Level A or AA axe violation (P17-G5, REQ-069)`, async ({
      page,
    }) => {
      await useBrowserLanguages(page, [lang]);
      await page.goto("/");
      await selectPizzaAndWaitForResults(page, copy);

      const moreButton = page.locator("[data-more-button]");
      await moreButton.hover();
      await page.waitForTimeout(250);
      await expectWcagAAndAaClean(page, `results-hover (${lang})`);
    });

    test(`[${lang}] the locked suggestion panel state reports no definite WCAG 2.1 Level A or AA axe violation (P17-G5, REQ-069)`, async ({
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

      await search.fill(copy.chickenQuery);
      await expect(
        page.getByRole("listbox", { name: copy.listbox }),
      ).toBeVisible();
      await expectWcagAAndAaClean(page, `locked-suggestion (${lang})`);
      gates.releasePost(0);
    });
  }
});

test.describe("Control presentation contrast audit", () => {
  for (const [seedKey, lang, copy] of [
    ["en", "en-US", COPY.en],
    ["pl", "pl-PL", COPY.pl],
  ] as const) {
    test(`[${lang}] the default empty and open-suggestion presentations meet the WCAG 2.1 AA text and interface-graphics limits with review attachments (P17-G5, REQ-069)`, async ({
      page,
    }, testInfo) => {
      await useBrowserLanguages(page, [lang]);
      await page.goto("/");
      await waitForInteractionState(page, "empty");

      await expectContrastTargets(page, [
        {
          selector: "#food-search",
          kind: "text",
          pseudo: "::placeholder",
          minimum: 4.5,
          where: "Search placeholder text",
        },
        {
          selector: "#food-search",
          kind: "border",
          minimum: 3,
          where: "Search keyboard-focus border",
        },
        {
          selector: "[data-interface-language] select",
          kind: "text",
          minimum: 4.5,
          where: "Interface Language selector text",
        },
        {
          selector: "[data-interface-language] span",
          kind: "text",
          minimum: 4.5,
          where: "Interface Language chevron",
        },
      ]);
      await attachReviewSurface(page, testInfo, `${seedKey}-empty`);

      const languageControl = page.getByRole("combobox", {
        name: copy.languageControl,
      });
      await focusWithTab(page, languageControl);
      await expect(languageControl).toBeFocused();
      await expectContrastTargets(page, [
        {
          selector: "#food-search",
          kind: "border",
          minimum: 3,
          where: "Search resting border",
        },
        {
          selector: "[data-interface-language] select",
          kind: "outline",
          minimum: 3,
          where: "Interface Language focus outline",
        },
      ]);

      const search = page.getByRole("combobox", { name: copy.search });
      await search.fill(copy.chickenQuery);
      await expect(
        page.getByRole("listbox", { name: copy.listbox }),
      ).toBeVisible();
      await expectContrastTargets(page, [
        {
          selector: "#food-search",
          kind: "text",
          minimum: 4.5,
          where: "typed Search Query text",
        },
        {
          selector: `#${optionId(SEEDED_SUGGESTIONS[seedKey][0].foodObjectId)}`,
          kind: "text",
          minimum: 4.5,
          where: "active suggestion option text",
        },
        {
          selector: `#${optionId(SEEDED_SUGGESTIONS[seedKey][1].foodObjectId)}`,
          kind: "text",
          minimum: 4.5,
          where: "resting suggestion option text",
        },
        {
          selector: "[role='listbox']",
          kind: "border",
          minimum: 3,
          where: "suggestion panel border",
        },
      ]);
      await attachReviewSurface(page, testInfo, `${seedKey}-open-suggestion`);
    });

    test(`[${lang}] the pending new-Search and locked-suggestion presentations meet the WCAG 2.1 AA limits with review attachments (P17-G5, REQ-069)`, async ({
      page,
    }, testInfo) => {
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

      await expectContrastTargets(page, [
        {
          selector: "#food-search",
          kind: "text",
          pseudo: "::placeholder",
          minimum: 4.5,
          where: "Search placeholder during loading",
        },
        {
          selector: "[data-selected-input]",
          kind: "border",
          minimum: 3,
          where: "selected-input region border",
        },
      ]);
      await attachReviewSurface(page, testInfo, `${seedKey}-loading-new`);

      await search.fill(copy.chickenQuery);
      await expect(
        page.getByRole("listbox", { name: copy.listbox }),
      ).toBeVisible();
      const lockedActive = page.locator(
        `#${optionId(SEEDED_SUGGESTIONS[seedKey][0].foodObjectId)}`,
      );
      const lockedResting = page.locator(
        `#${optionId(SEEDED_SUGGESTIONS[seedKey][1].foodObjectId)}`,
      );
      await expect(lockedActive).toHaveAttribute("aria-disabled", "true");
      await expect(lockedActive).toHaveCSS("opacity", "0.6");
      await expect(lockedResting).toHaveAttribute("aria-disabled", "true");
      await expect(lockedResting).toHaveCSS("opacity", "0.6");
      await expectContrastTargets(page, [
        {
          selector: `#${optionId(SEEDED_SUGGESTIONS[seedKey][0].foodObjectId)}`,
          kind: "text",
          minimum: 4.5,
          where: "locked active suggestion option text",
        },
        {
          selector: `#${optionId(SEEDED_SUGGESTIONS[seedKey][1].foodObjectId)}`,
          kind: "text",
          minimum: 4.5,
          where: "locked resting suggestion option text",
        },
      ]);
      await attachReviewSurface(page, testInfo, `${seedKey}-locked-suggestion`);

      gates.releasePost(0);
      await waitForInteractionState(page, "results");
      const number = page.locator("[data-quantity-number]");
      await number.fill("200");
      await number.press("Enter");
      expect(gates.count()).toBe(1);
      await expect(page.locator("[data-card-spinner]")).toHaveCount(0);
      await attachReviewSurface(page, testInfo, `${seedKey}-local-quantity`);
    });

    test(`[${lang}] the result, hover, keyboard-focus, validation-error, and pending-MORE! presentations meet the WCAG 2.1 AA limits with review attachments (P17-G5, REQ-069)`, async ({
      page,
    }, testInfo) => {
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
      await expect(page.locator("[data-result-card]")).toHaveCount(3);
      await expect
        .poll(async () =>
          page
            .locator("[data-result-card]")
            .evaluateAll((elements) =>
              elements.every(
                (element) => getComputedStyle(element).opacity === "1",
              ),
            ),
        )
        .toBe(true);

      await expectContrastTargets(page, [
        {
          selector: "[data-result-card] h3",
          kind: "text",
          minimum: 4.5,
          where: "result card name",
        },
        {
          selector: "[data-result-card-matched-quantity]",
          kind: "text",
          minimum: 4.5,
          where: "matched quantity",
        },
        {
          selector: "[data-result-card-calories]",
          kind: "text",
          minimum: 4.5,
          where: "card calories",
        },
        {
          selector: "[data-result-card] dt",
          kind: "text",
          minimum: 4.5,
          where: "card macronutrient label",
        },
        {
          selector: "[data-result-card] dd",
          kind: "text",
          minimum: 4.5,
          where: "card macronutrient value",
        },
        {
          selector: "[data-result-card]",
          kind: "border",
          minimum: 3,
          where: "result card border",
        },
        {
          selector: "[data-substitutions-heading]",
          kind: "text",
          minimum: 4.5,
          where: "results heading",
        },
        {
          selector: "[data-more-button]",
          kind: "text",
          minimum: 4.5,
          where: "MORE! label on Primary",
        },
      ]);
      await attachReviewSurface(page, testInfo, `${seedKey}-results`);

      const number = page.locator("[data-quantity-number]");
      await focusWithTab(page, number);
      await expect(number).toBeFocused();
      await expectContrastTargets(page, [
        {
          selector: "[data-quantity-number]",
          kind: "border",
          minimum: 3,
          where: "Quantity number focus border",
        },
      ]);
      const moreButton = page.locator("[data-more-button]");
      await focusWithTab(page, moreButton);
      await expect(moreButton).toBeFocused();

      await page.waitForTimeout(250);
      await expectContrastTargets(page, [
        {
          selector: "[data-more-button]",
          kind: "outline",
          minimum: 3,
          where: "MORE! keyboard-focus outline",
        },
      ]);
      await attachReviewSurface(page, testInfo, `${seedKey}-keyboard-focus`);

      await moreButton.hover();
      await page.waitForTimeout(250);
      await expectContrastTargets(page, [
        {
          selector: "[data-more-button]",
          kind: "text",
          minimum: 4.5,
          where: "MORE! label on hover",
        },
      ]);
      await attachReviewSurface(page, testInfo, `${seedKey}-hover`);

      await number.fill("abc");
      await number.press("Enter");
      await expect(page.locator("[data-quantity-error]")).toHaveText(
        copy.invalidQuantity,
      );
      await expectContrastTargets(page, [
        {
          selector: "[data-quantity-error]",
          kind: "text",
          minimum: 4.5,
          where: "quantity validation error",
        },
      ]);
      await attachReviewSurface(page, testInfo, `${seedKey}-validation-error`);

      await number.fill("350");
      await number.press("Enter");
      expect(gates.count()).toBe(1);
      await expect(page.locator("[data-card-spinner]")).toHaveCount(0);
      await moreButton.click();
      await gates.waitForPosts(2);
      await waitForInteractionState(page, "loadingMore");
      await expect(moreButton).toHaveAttribute("aria-disabled", "true");

      await page.waitForTimeout(250);
      await expectContrastTargets(page, [
        {
          selector: "[data-quantity-number]",
          kind: "text",
          minimum: 4.5,
          where: "native-disabled Quantity number text",
        },
        {
          selector: "[data-quantity-unit]",
          kind: "text",
          minimum: 4.5,
          where: "native-disabled Unit selector text",
        },
        {
          selector: "[data-input-macronutrients] dt",
          kind: "text",
          minimum: 4.5,
          where: "input macronutrient label",
        },
        {
          selector: "[data-more-button]",
          kind: "text",
          minimum: 4.5,
          where: "aria-disabled MORE! gray label",
        },
        {
          selector: "[data-more-button]",
          kind: "border",
          minimum: 3,
          where: "aria-disabled MORE! gray background",
        },
      ]);
      await attachReviewSurface(page, testInfo, `${seedKey}-loading-more`);
      gates.releasePost(1);
    });
  }
});

test.describe("Control accessibility failure states", () => {
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

    await expectSettledCards(page, "prepared intermediate page");
    await expect(moreButton).toBeVisible();
    await expect(moreButton).toHaveAttribute("aria-disabled", "false");
  }

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

  test("after the outage, the new-Search and MORE! failure surfaces resolve every rendered control by its exact English or Polish accessible name with one role and no duplicates (REQ-050, REQ-051, REQ-068)", async ({
    browser,
  }, testInfo) => {
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

    await prepareSecondSuggestion(englishNewPage, COPY.en);
    await prepareSecondSuggestion(polishNewPage, COPY.pl);
    await prepareSuccessfulIntermediatePage(englishMorePage, COPY.en);
    await prepareSuccessfulIntermediatePage(polishMorePage, COPY.pl);

    await stopOutagePostgresAndWait();

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

    await expectWcagAAndAaClean(englishNewPage, "newSearchFailure (en)");

    await expectContrastTargets(englishNewPage, [
      {
        selector: "[data-retry-message]",
        kind: "text",
        minimum: 4.5,
        where: "new-Search failure retry message (en)",
      },
      {
        selector: "[data-selected-name]",
        kind: "text",
        minimum: 4.5,
        where: "retained selected name (en)",
      },
      {
        selector: "[data-quantity-static-unit]",
        kind: "text",
        minimum: 4.5,
        where: "static unit presentation (en)",
      },
      {
        selector: "#food-search",
        kind: "border",
        minimum: 3,
        where: "focused Search border (en)",
      },
    ]);
    await attachReviewSurface(
      englishNewPage,
      testInfo,
      "en-new-search-failure",
    );

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

    await expectWcagAAndAaClean(polishNewPage, "newSearchFailure (pl)");

    await expectContrastTargets(polishNewPage, [
      {
        selector: "[data-retry-message]",
        kind: "text",
        minimum: 4.5,
        where: "new-Search failure retry message (pl)",
      },
      {
        selector: "[data-selected-name]",
        kind: "text",
        minimum: 4.5,
        where: "retained selected name (pl)",
      },
      {
        selector: "[data-quantity-static-unit]",
        kind: "text",
        minimum: 4.5,
        where: "static unit presentation (pl)",
      },
      {
        selector: "#food-search",
        kind: "border",
        minimum: 3,
        where: "focused Search border (pl)",
      },
    ]);
    await attachReviewSurface(polishNewPage, testInfo, "pl-new-search-failure");

    await englishMorePage
      .getByRole("button", { name: COPY.en.moreButton })
      .click();
    await waitForInteractionState(englishMorePage, "moreFailure");
    await expectNamedControls(englishMorePage, RESULT_CONTROLS(COPY.en));
    await expect(
      englishMorePage.getByRole("button", { name: COPY.en.moreButton }),
    ).toHaveAttribute("aria-disabled", "false");
    await expect(englishMorePage.locator("[data-result-card]")).toHaveCount(3);

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

    await expectSettledCards(englishMorePage, "moreFailure (en)");
    await expectWcagAAndAaClean(englishMorePage, "moreFailure (en)");

    await expectContrastTargets(englishMorePage, [
      {
        selector: "[data-retry-message]",
        kind: "text",
        minimum: 4.5,
        where: "MORE! failure retry message (en)",
      },
      {
        selector: "[data-result-card] h3",
        kind: "text",
        minimum: 4.5,
        where: "retained card name (en)",
      },
      {
        selector: "[data-more-button]",
        kind: "text",
        minimum: 4.5,
        where: "retained operable MORE! label (en)",
      },
    ]);
    await attachReviewSurface(englishMorePage, testInfo, "en-more-failure");

    await polishMorePage
      .getByRole("button", { name: COPY.pl.moreButton })
      .click();
    await waitForInteractionState(polishMorePage, "moreFailure");
    await expectNamedControls(polishMorePage, RESULT_CONTROLS(COPY.pl));
    await expect(
      polishMorePage.getByRole("button", { name: COPY.pl.moreButton }),
    ).toHaveAttribute("aria-disabled", "false");
    await expect(polishMorePage.locator("[data-result-card]")).toHaveCount(3);

    await expectSettledCards(polishMorePage, "moreFailure (pl)");
    await expectWcagAAndAaClean(polishMorePage, "moreFailure (pl)");

    await expectContrastTargets(polishMorePage, [
      {
        selector: "[data-retry-message]",
        kind: "text",
        minimum: 4.5,
        where: "MORE! failure retry message (pl)",
      },
      {
        selector: "[data-result-card] h3",
        kind: "text",
        minimum: 4.5,
        where: "retained card name (pl)",
      },
      {
        selector: "[data-more-button]",
        kind: "text",
        minimum: 4.5,
        where: "retained operable MORE! label (pl)",
      },
    ]);
    await attachReviewSurface(polishMorePage, testInfo, "pl-more-failure");
  });
});
test.describe("Control keyboard-only flow", () => {
  async function driveKeyboardSuggestionPhase(
    page: Page,
    seedKey: "en" | "pl",
    copy: (typeof COPY)[keyof typeof COPY],
    selectIndex: number,
  ): Promise<SubstituteSearchRequest[]> {
    const posts = trackSubstitutePosts(page);

    await page.goto("/");
    const fixtures = KEYBOARD_SUGGESTIONS[seedKey];
    const search = page.getByRole("combobox", { name: copy.search });
    const panel = page.getByRole("listbox", { name: copy.listbox });

    await expect(search).toBeFocused();
    await waitForInteractionState(page, "empty");

    await page.keyboard.type(fixtures.query);
    await expect(panel).toBeVisible();
    await expectKeyboardActiveOption(page, fixtures.list, 0, copy);

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

    await search.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(search).toHaveValue(fixtures.query);
    await expect(search).toBeFocused();
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await expect(search).not.toHaveAttribute("aria-activedescendant");
    expect(posts).toHaveLength(0);

    await search.press("Backspace");
    await page.keyboard.type(fixtures.query.at(-1) ?? "");
    await expect(panel).toBeVisible();
    await expectKeyboardActiveOption(page, fixtures.list, 0, copy);

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

    const posts = await driveKeyboardSuggestionPhase(page, "en", COPY.en, 0);
    const search = page.getByRole("combobox", { name: COPY.en.search });
    const heading = page.locator("[data-substitutions-heading]");

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
      pageIndex: 0,
    });

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

    await page.keyboard.press("Control+A");
    await page.keyboard.type("2");
    await page.keyboard.press("Enter");

    await expect.poll(() => posts.length).toBe(2);
    expect(posts[1]).toEqual({
      foodObjectId: PIZZA_FOOD_OBJECT_ID,
      pageIndex: 0,
    });

    await waitForInteractionState(page, "results");
    await expect(numberInput).toBeFocused();

    const unitSelect = page.locator("[data-quantity-unit]");
    await focusWithTab(page, unitSelect);
    await expect(unitSelect).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => posts.length).toBe(3);
    expect(posts[2]).toEqual({
      foodObjectId: PIZZA_FOOD_OBJECT_ID,
      pageIndex: 0,
    });

    await waitForInteractionState(page, "results");
    await expect(numberInput).toHaveValue("100");
    await expect(unitSelect).toHaveValue("g");

    await expect(unitSelect).toBeFocused();

    const moreButton = page.locator("[data-more-button]");
    await focusWithTab(page, moreButton);
    await expect(moreButton).toBeFocused();
    await page.keyboard.press("Space");
    await expect.poll(() => posts.length).toBe(4);
    expect(posts[3]).toEqual({
      foodObjectId: PIZZA_FOOD_OBJECT_ID,
      pageIndex: 1,
    });
    await waitForInteractionState(page, "results");
    await expect
      .poll(() => renderedCardIDs(page))
      .toEqual([...PIZZA_PAGE_1_IDS]);
    await expect(heading).toBeFocused();

    const languageControl = page.getByRole("combobox", {
      name: COPY.en.languageControl,
    });
    await focusWithTab(page, languageControl);
    await expect(languageControl).toBeFocused();
    await page.keyboard.press("ArrowUp");

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

    await page.keyboard.press("Shift+Tab");
    await expect(
      page.getByRole("button", { name: COPY.pl.moreButton }),
    ).toBeFocused();
  });

  test("[pl-PL] one keyboard-only path reaches and operates every control — Search and the suggestion list, Interface Language, Quantity number and unit, and MORE! — and the results heading is the focus target after each successful page, without pointer input (REQ-018, REQ-019, REQ-026, REQ-068, REQ-083, P15-G2, P15-G7)", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["pl-PL"]);

    const posts = await driveKeyboardSuggestionPhase(page, "pl", COPY.pl, 1);
    const search = page.getByRole("combobox", { name: COPY.pl.search });
    const heading = page.locator("[data-substitutions-heading]");

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
      pageIndex: 0,
    });

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

    await page.keyboard.press("Control+A");
    await page.keyboard.type("2");
    await page.keyboard.press("Enter");

    await expect.poll(() => posts.length).toBe(2);
    expect(posts[1]).toEqual({
      foodObjectId: 22,
      pageIndex: 0,
    });

    await waitForInteractionState(page, "results");
    await expect(numberInput).toBeFocused();

    const unitSelect = page.locator("[data-quantity-unit]");
    await focusWithTab(page, unitSelect);
    await expect(unitSelect).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => posts.length).toBe(3);
    expect(posts[2]).toEqual({
      foodObjectId: 22,
      pageIndex: 0,
    });

    await waitForInteractionState(page, "results");
    await expect(numberInput).toHaveValue("100");
    await expect(unitSelect).toHaveValue("g");

    await expect(unitSelect).toBeFocused();

    const moreButton = page.locator("[data-more-button]");
    await focusWithTab(page, moreButton);
    await expect(moreButton).toBeFocused();
    await page.keyboard.press("Space");
    await expect.poll(() => posts.length).toBe(4);
    expect(posts[3]).toEqual({
      foodObjectId: 22,
      pageIndex: 1,
    });
    await waitForInteractionState(page, "results");
    await expect(page.locator("[data-result-card]")).toHaveCount(3);
    await expect(heading).toBeFocused();

    const languageControl = page.getByRole("combobox", {
      name: COPY.pl.languageControl,
    });
    await focusWithTab(page, languageControl);
    await expect(languageControl).toBeFocused();
    await page.keyboard.press("ArrowDown");

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

    await page.keyboard.press("Shift+Tab");
    await expect(
      page.getByRole("button", { name: COPY.en.moreButton }),
    ).toBeFocused();
  });
});
