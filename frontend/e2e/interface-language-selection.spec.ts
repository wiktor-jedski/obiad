import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Real-stack Interface Language selection scenario (task 26; ARCH-001,
 * ARCH-003, ARCH-012, ARCH-014, ARCH-020, ARCH-022, REQ-057, ISSUE-006,
 * ISSUE-007).
 *
 * `bun run test:e2e` runs this file against the complete disposable stack
 * started by `./e2e/launcher.ts`: disposable PostgreSQL 17 seeded by the
 * real setup command, the real Fiber process on the fixed loopback listener
 * 127.0.0.1:8080, and the optimized Vite preview on the strict port 4173.
 *
 * The selection scenario proves that pointer selection of PL and EN applies
 * the exact localized Search and group copy plus the selected state,
 * persists the exact `pl` or `en` value under `obiad.interfaceLanguage`
 * (ARCH-014), and that a reload resolves the saved language before a
 * conflicting browser locale (REQ-057, P06-G3). It also proves the control
 * adds no application API request and no excluded result or Search-
 * interaction behavior: no suggestion surface, no result state, no Search
 * focus or text manipulation, no cookie (P06-G4).
 *
 * The viewport scenario proves at `320×568`, `768×1024`, and `1280×720`
 * (one test per viewport) that both buttons keep at least `44×44px`
 * targets, remain visible, keyboard reachable, and visibly focused, do not
 * overflow the viewport, sit at the specified responsive top-right inset
 * (`16px` below `640px`, `24px` from `640px` through `1023px`, `32px` from
 * `1024px`), use the exact inactive, active, hover, and focus colors, and
 * do not move the Search field's established geometry (task 24, ISSUE-006).
 * Native keyboard activation (Tab focus plus Enter) is exercised in real
 * Chromium here.
 */

const PREVIEW_ORIGIN = "http://127.0.0.1:4173";

/** The persisted Interface Language key (ARCH-014, ISSUE-007). */
const STORAGE_KEY = "obiad.interfaceLanguage";

/** The exact ISSUE-007 copy of the two supported dictionaries. */
const COPY = {
  en: {
    label: "Search",
    placeholder: "Search foods",
    group: "Interface language",
  },
  pl: {
    label: "Szukaj",
    placeholder: "Szukaj potraw",
    group: "Język interfejsu",
  },
} as const;

/**
 * The exact computed palette values from `docs/requirements/style.md` that
 * the Interface Language control must resolve to, as `getComputedStyle`
 * serializes them.
 */
const PRIMARY_RGB = "rgb(74, 222, 128)"; // #4ADE80
const SURFACE_RGB = "rgb(22, 29, 22)"; // #161D16
const TEXT_PRIMARY_RGB = "rgb(243, 244, 246)"; // #F3F4F6
const TEXT_ON_BRIGHT_RGB = "rgb(10, 15, 10)"; // #0A0F0A
const SECONDARY_RGB = "rgb(134, 239, 172)"; // #86EFAC

/** ISSUE-007: the minimum target size of every button. */
const MIN_TARGET_PX = 44;

/** ISSUE-006: the Search field height. */
const FIELD_HEIGHT_PX = 56;

/** ISSUE-006: the Search field maximum width (`min(100%, 640px)`). */
const FIELD_MAX_WIDTH_PX = 640;

/** ISSUE-006: the Search field vertical-center line, as a share of 100dvh. */
const VERTICAL_CENTER_DVH = 0.45;

/**
 * The ISSUE-006 acceptance viewports and their expected responsive page
 * gutters, which are also the Interface Language control's top and right
 * insets (ISSUE-007).
 */
const VIEWPORTS = [
  { name: "320x568", width: 320, height: 568, gutterPx: 16 },
  { name: "768x1024", width: 768, height: 1024, gutterPx: 24 },
  { name: "1280x720", width: 1280, height: 720, gutterPx: 32 },
] as const;

/** Where the review PNGs are mirrored so they survive the launcher cleanup. */
const REVIEW_COPY_DIR = "/tmp/obiad-task26-interface-language";

/**
 * Overrides `navigator.languages` before the application scripts run, so a
 * conflicting browser locale can be simulated deterministically.
 */
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

/** Seeds the persisted preference before the application scripts run. */
async function useStoredLanguage(page: Page, value: string): Promise<void> {
  await page.addInitScript(
    ([key, stored]) => {
      window.localStorage.setItem(key, stored);
    },
    [STORAGE_KEY, value] as const,
  );
}

/** Asserts the current persisted value under the Interface Language key. */
async function expectStored(page: Page, value: string | null): Promise<void> {
  const stored = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    STORAGE_KEY,
  );
  expect(stored).toBe(value);
}

test.describe("Interface Language selection", () => {
  test("selecting PL and EN applies the exact copy and selected state, persists the exact value, and a reload resolves the saved language before a conflicting browser locale", async ({
    page,
  }) => {
    // A browser locale that conflicts with the EN selection: the saved
    // value must win on reload (ARCH-012, REQ-057).
    await useBrowserLanguages(page, ["pl-PL"]);
    const requestUrls: string[] = [];
    page.on("request", (request) => requestUrls.push(request.url()));

    await page.goto("/");
    await expect(page).toHaveTitle("Obiad");
    const searchInput = page.locator('input[type="search"]');
    const group = page.getByRole("group");

    // Browser-derived initial state: Polish (ARCH-012, REQ-056).
    await expect(group).toHaveAttribute("aria-label", COPY.pl.group);
    await expect(searchInput).toHaveAttribute(
      "placeholder",
      COPY.pl.placeholder,
    );

    // Select EN with a pointer: exact English Search and group copy,
    // selected state flips, and the exact value is saved (REQ-057).
    await page.locator("button", { hasText: "EN" }).click();
    await expect(group).toHaveAttribute("aria-label", COPY.en.group);
    await expect(searchInput).toHaveAttribute(
      "placeholder",
      COPY.en.placeholder,
    );
    await expect(page.locator("button", { hasText: "PL" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(page.locator("button", { hasText: "EN" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expectStored(page, "en");

    // Reload with the conflicting pl-PL browser locale: the saved `en`
    // value resolves before the browser language (REQ-057, P06-G3).
    await page.reload();
    await expect(group).toHaveAttribute("aria-label", COPY.en.group);
    await expect(searchInput).toHaveAttribute(
      "placeholder",
      COPY.en.placeholder,
    );
    await expect(page.locator("button", { hasText: "EN" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expectStored(page, "en");

    // Select PL: exact Polish copy and the exact saved value.
    await page.locator("button", { hasText: "PL" }).click();
    await expect(group).toHaveAttribute("aria-label", COPY.pl.group);
    await expect(searchInput).toHaveAttribute(
      "placeholder",
      COPY.pl.placeholder,
    );
    await expect(page.locator("button", { hasText: "PL" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator("button", { hasText: "EN" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expectStored(page, "pl");

    // Switch the browser to the other conflicting locale (en-US) and reload
    // again: the saved `pl` value still wins (ARCH-012, REQ-057).
    await useBrowserLanguages(page, ["en-US"]);
    await page.reload();
    await expect(group).toHaveAttribute("aria-label", COPY.pl.group);
    await expect(searchInput).toHaveAttribute(
      "placeholder",
      COPY.pl.placeholder,
    );
    await expect(page.locator("button", { hasText: "PL" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expectStored(page, "pl");

    // The selection scenario performs no application API request and no
    // cookie write; every request stays on the preview origin (P06-G4).
    expect(requestUrls.some((url) => url.includes("/api/"))).toBe(false);
    for (const url of requestUrls) {
      expect(new URL(url).origin, `unexpected request origin ${url}`).toBe(
        PREVIEW_ORIGIN,
      );
    }
    expect(await page.evaluate(() => document.cookie)).toBe("");
  });

  test("the control adds no Search-interaction behavior: typing is retained and Search focus is not grabbed or forced", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const requestUrls: string[] = [];
    page.on("request", (request) => requestUrls.push(request.url()));

    await page.goto("/");
    const searchInput = page.locator('input[type="search"]');

    // Type unfinished text into the Search field, then select PL: the text
    // is retained untouched and focus stays on the button — the control
    // performs no explicit Search focus, text-retention, or suggestion-
    // closing collaboration (ARCH-012, task 26).
    await searchInput.fill("abc");
    await page.locator("button", { hasText: "PL" }).click();
    await expect(searchInput).toHaveValue("abc");
    await expect(page.locator("button", { hasText: "PL" })).toBeFocused();

    // No suggestion surface exists and no application API request fired
    // (no current-result translation, suggestions, or result state).
    await expect(
      page.locator('[role="combobox"], [role="listbox"], [role="option"]'),
    ).toHaveCount(0);
    await expect(page.locator('img, svg, [role="img"]')).toHaveCount(0);
    expect(requestUrls.some((url) => url.includes("/api/"))).toBe(false);
  });
});

test.describe("Interface Language control geometry and styles", () => {
  for (const vp of VIEWPORTS) {
    test(`the segmented pill at ${vp.name}`, async ({ page }, testInfo) => {
      await assertControlAtViewport(page, testInfo, vp);
    });
  }
});

/**
 * Runs the complete viewport assertion set for one viewport: the exact
 * top-right inset, the `44×44px` targets, visibility, colors, hover and
 * focus states, keyboard reachability, native keyboard activation, Search
 * geometry preservation, the absence of overflow and excluded surfaces,
 * the no-API-request contract, and one full-page PNG review attachment.
 */
async function assertControlAtViewport(
  page: Page,
  testInfo: TestInfo,
  vp: (typeof VIEWPORTS)[number],
): Promise<void> {
  // Deterministic English state for the style assertions, conflicting with
  // nothing: browser-derived initialization never persists (ISSUE-007).
  await useBrowserLanguages(page, ["en-US"]);
  const requestUrls: string[] = [];
  page.on("request", (request) => requestUrls.push(request.url()));

  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.goto("/");
  await expect(page).toHaveTitle("Obiad");

  const group = page.getByRole("group");
  const plButton = page.locator("button", { hasText: "PL" });
  const enButton = page.locator("button", { hasText: "EN" });
  const searchInput = page.locator('input[type="search"]');

  // The localized named group with the two buttons in fixed PL-then-EN
  // order; both controls remain visible (task 26, ISSUE-007).
  await expect(group).toHaveAttribute("aria-label", COPY.en.group);
  await expect(page.locator("button")).toHaveCount(2);
  await expect(plButton).toBeVisible();
  await expect(enButton).toBeVisible();

  // --- Responsive top-right inset: the gutter is both the top and the
  // right inset of the pill, within 1 CSS px (ISSUE-007). ---
  const groupBox = (await group.boundingBox()) as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  expect(Math.abs(groupBox.y - vp.gutterPx)).toBeLessThanOrEqual(1);
  expect(
    Math.abs(vp.width - (groupBox.x + groupBox.width) - vp.gutterPx),
  ).toBeLessThanOrEqual(1);

  // --- Minimum 44×44px targets. ---
  for (const button of [plButton, enButton]) {
    const box = (await button.boundingBox()) as {
      width: number;
      height: number;
    };
    expect(box.width).toBeGreaterThanOrEqual(MIN_TARGET_PX);
    expect(box.height).toBeGreaterThanOrEqual(MIN_TARGET_PX);
  }

  // --- Exact colors (docs/requirements/style.md, ISSUE-007): EN active
  // (Primary with Text-On-Bright), PL inactive (Surface, Text-Primary,
  // Secondary border). ---
  await expect(enButton).toHaveCSS("background-color", PRIMARY_RGB);
  await expect(enButton).toHaveCSS("color", TEXT_ON_BRIGHT_RGB);
  await expect(plButton).toHaveCSS("background-color", SURFACE_RGB);
  await expect(plButton).toHaveCSS("color", TEXT_PRIMARY_RGB);
  await expect(plButton).toHaveCSS("border-top-color", SECONDARY_RGB);

  // --- Hover promotes the inactive border to Primary; leaving restores
  // the Secondary border (ISSUE-007). The assertions auto-retry, covering
  // the 200ms property transition. ---
  await plButton.hover();
  await expect(plButton).toHaveCSS("border-top-color", PRIMARY_RGB);
  await page.mouse.move(0, 0);
  await expect(plButton).toHaveCSS("border-top-color", SECONDARY_RGB);

  // --- Keyboard reachability and visible focus: Tab walks body → Search →
  // PL → EN; the focused button matches :focus-visible with a two-pixel
  // Primary outline at a two-pixel offset (ISSUE-007, style.md). ---
  await page.keyboard.press("Tab");
  await expect(searchInput).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(plButton).toBeFocused();
  expect(
    await plButton.evaluate((element) => element.matches(":focus-visible")),
  ).toBe(true);
  await expect(plButton).toHaveCSS("outline-style", "solid");
  await expect(plButton).toHaveCSS("outline-width", "2px");
  await expect(plButton).toHaveCSS("outline-color", PRIMARY_RGB);
  await expect(plButton).toHaveCSS("outline-offset", "2px");

  // Native keyboard activation in real Chromium: Enter selects PL and
  // persists the exact value (REQ-057).
  await page.keyboard.press("Enter");
  await expect(group).toHaveAttribute("aria-label", COPY.pl.group);
  await expectStored(page, "pl");

  await page.keyboard.press("Tab");
  await expect(enButton).toBeFocused();
  expect(
    await enButton.evaluate((element) => element.matches(":focus-visible")),
  ).toBe(true);
  await expect(enButton).toHaveCSS("outline-width", "2px");
  await expect(enButton).toHaveCSS("outline-color", PRIMARY_RGB);
  await page.keyboard.press("Enter");
  await expect(group).toHaveAttribute("aria-label", COPY.en.group);
  await expectStored(page, "en");

  // --- The Search field's established geometry is unchanged: 56px high,
  // min(100%, 640px) wide, horizontal and 45% of 100dvh vertical centers,
  // all within 1 CSS px (task 24, ISSUE-006). ---
  const box = (await searchInput.boundingBox()) as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  const expectedWidth = Math.min(
    vp.width - 2 * vp.gutterPx,
    FIELD_MAX_WIDTH_PX,
  );
  expect(Math.abs(box.width - expectedWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.height - FIELD_HEIGHT_PX)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.x + box.width / 2 - vp.width / 2)).toBeLessThanOrEqual(1);
  const dvhHeight = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.height = "100dvh";
    document.body.appendChild(probe);
    const height = probe.getBoundingClientRect().height;
    probe.remove();
    return height;
  });
  const expectedVerticalCenter = VERTICAL_CENTER_DVH * dvhHeight;
  expect(
    Math.abs(box.y + box.height / 2 - expectedVerticalCenter),
  ).toBeLessThanOrEqual(1);

  // --- No horizontal overflow; the pill stays inside the viewport. ---
  const overflow = await page.evaluate(() => ({
    documentScrollWidth: document.documentElement.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflow.documentScrollWidth).toBeLessThanOrEqual(
    overflow.documentClientWidth,
  );
  expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
  expect(groupBox.x).toBeGreaterThanOrEqual(0);
  expect(groupBox.x + groupBox.width).toBeLessThanOrEqual(vp.width);
  expect(groupBox.y).toBeGreaterThanOrEqual(0);
  expect(groupBox.y + groupBox.height).toBeLessThanOrEqual(vp.height);

  // --- No excluded surface and no application API request: no suggestion
  // list, result state, selected input, or other excluded control, and no
  // application API request (P06-G4). ---
  await expect(
    page.locator('[role="combobox"], [role="listbox"], [role="option"]'),
  ).toHaveCount(0);
  await expect(page.locator("select, ul, ol, a")).toHaveCount(0);
  expect(requestUrls.some((url) => url.includes("/api/"))).toBe(false);
  for (const url of requestUrls) {
    expect(new URL(url).origin, `unexpected request origin ${url}`).toBe(
      PREVIEW_ORIGIN,
    );
  }

  // --- Review evidence: exactly one full-page PNG attachment per viewport
  // (ISSUE-006). Screenshots are non-gating; the assertions above are the
  // acceptance gate. ---
  const screenshotName = `interface-language-${vp.name}.png`;
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
    `[interface-language] review attachment ${screenshotName}: ${screenshotPath} (mirrored to ${mirror})`,
  );
}
