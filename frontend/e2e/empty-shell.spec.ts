import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Real-stack empty-shell scenario (task 24; ARCH-001, ARCH-020, ARCH-022,
 * REQ-060, ISSUE-006).
 *
 * `bun run test:e2e` runs this file against the complete disposable stack
 * started by `./e2e/launcher.ts`: the optimized Vite preview on the strict
 * port 4173 proxies same-origin `/api` to the real Fiber process. This
 * scenario loads the optimized shell and proves the empty-state Search
 * contract at the ISSUE-006 viewports `320×568`, `768×1024`, and `1280×720`
 * (one test per viewport, `P05-G3`):
 *
 *   - the exact label, placeholder, input semantics, and initial focus
 *     state (`<input type="search">`, visually hidden `Search` label,
 *     `Search foods` placeholder, no icon, and autofocus);
 *   - exactly one semantic primary content column and one Search control,
 *     with no excluded Phase 7 (suggestion list, selected input, result
 *     cards) region, the Phase 6 Interface Language dropdown, and no
 *     application API request;
 *   - the centered maximum-`1280px` column cap, the responsive page gutters
 *     (`16px` below `640px`, `24px` from `640px` through `1023px`, `32px`
 *     from `1024px`), the pill-shaped field, the Surface/Secondary/Text-Primary
 *     input styles, a Primary focus border without an outer highlight, and no
 *     horizontal overflow;
 *   - the Search box within `1` CSS px of the specified horizontal and
 *     `45%` of `100dvh` vertical centers;
 *   - exactly one full-page PNG review attachment per viewport (`P05-G4`),
 *     three in total, recorded as non-gating review evidence — no pixel
 *     comparison gates any assertion (ISSUE-006).
 */

const PREVIEW_ORIGIN = "http://127.0.0.1:4173";

/** ISSUE-006: the Search field height. */
const FIELD_HEIGHT_PX = 56;

/** A pill radius must be at least half the Search field height. */
const FIELD_MIN_BORDER_RADIUS_PX = FIELD_HEIGHT_PX / 2;

/** The text starts `0.5em` beyond the end of the `28px` pill radius. */
const FIELD_TEXT_INSET_PX = FIELD_HEIGHT_PX / 2 + 8;

/** ISSUE-006: the Search field maximum width (`min(100%, 640px)`). */
const FIELD_MAX_WIDTH_PX = 640;

/** ISSUE-006: the primary column maximum width. */
const COLUMN_MAX_WIDTH_PX = 1280;

/** ISSUE-006: the Search field vertical-center line, as a share of 100dvh. */
const VERTICAL_CENTER_DVH = 0.45;

/**
 * The ISSUE-006 acceptance viewports and their expected horizontal page
 * gutters (Tailwind `px-4`, `sm:px-6`, `lg:px-8`).
 */
const VIEWPORTS = [
  { name: "320x568", width: 320, height: 568, gutterPx: 16 },
  { name: "768x1024", width: 768, height: 1024, gutterPx: 24 },
  { name: "1280x720", width: 1280, height: 720, gutterPx: 32 },
] as const;

/**
 * The exact computed palette values from `docs/requirements/style.md` that
 * the Search field must resolve to, as `getComputedStyle` serializes them.
 */
const SURFACE_RGB = "rgb(22, 29, 22)"; // #161D16
const SECONDARY_RGB = "rgb(134, 239, 172)"; // #86EFAC
const TEXT_PRIMARY_RGB = "rgb(243, 244, 246)"; // #F3F4F6
const PRIMARY_RGB = "rgb(74, 222, 128)"; // #4ADE80

/** Where the review PNGs are mirrored so they survive the launcher cleanup. */
const REVIEW_COPY_DIR = "/tmp/obiad-task24-empty-shell";

/**
 * Runs the complete empty-shell assertion set for one viewport and records
 * the one full-page PNG review attachment for that viewport.
 */
async function assertEmptyShell(
  page: Page,
  testInfo: TestInfo,
  vp: (typeof VIEWPORTS)[number],
): Promise<void> {
  // Every request the browser makes must stay on the preview origin, and
  // none may be an application API request (task 24: no startup request).
  const requestUrls: string[] = [];
  page.on("request", (request) => requestUrls.push(request.url()));

  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.goto("/");
  await expect(page).toHaveTitle("Obiad");

  // --- Semantics: exactly one primary column and one Search control. ---
  const main = page.locator("main");
  await expect(main).toHaveCount(1);

  const input = page.locator("input");
  await expect(input).toHaveCount(1);
  await expect(input).toHaveAttribute("type", "search");

  // No excluded Phase 7 region: no suggestion list, selected input, result
  // card, or result-state control. The Phase 6 native language dropdown is
  // the only additional form control.
  await expect(page.locator("button")).toHaveCount(0);
  const languageSelect = page.getByRole("combobox", {
    name: "Interface language",
  });
  await expect(languageSelect).toHaveCount(1);
  await expect(languageSelect.locator("option")).toHaveCount(2);
  await expect(page.locator("a")).toHaveCount(0);
  await expect(page.locator('img, svg, [role="img"]')).toHaveCount(0);
  await expect(page.locator('[role="listbox"]')).toHaveCount(0);
  await expect(page.locator("ul, ol")).toHaveCount(0);
  await expect(main).toContainText("Search");

  // --- Exact label, placeholder, semantics, and initial focus state. ---
  const label = page.locator("label");
  await expect(label).toHaveCount(1);
  await expect(label).toHaveText("Search");
  const inputId = (await input.getAttribute("id")) as string;
  expect(inputId.length).toBeGreaterThan(0);
  await expect(label).toHaveAttribute("for", inputId);
  await expect(input).toHaveAttribute("placeholder", "Search foods");
  await expect(input).toHaveAccessibleName("Search");

  // The label is visually hidden (Tailwind `sr-only`).
  const labelStyle = await label.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      position: style.position,
      width: style.width,
      height: style.height,
    };
  });
  expect(labelStyle.position).toBe("absolute");
  expect(parseFloat(labelStyle.width)).toBeLessThanOrEqual(1);
  expect(parseFloat(labelStyle.height)).toBeLessThanOrEqual(1);

  // Search is the initial focus so the visitor can type immediately.
  expect(
    await input.evaluate((element) => element.hasAttribute("autofocus")),
  ).toBe(true);
  await expect(input).toBeFocused();

  // No icon: no background image, no nested image markup, and the native
  // search appearance is removed.
  expect(
    await input.evaluate(
      (element) => getComputedStyle(element).backgroundImage,
    ),
  ).toBe("none");
  expect(
    await input.evaluate((element) => getComputedStyle(element).appearance),
  ).toBe("none");

  // --- Column cap and responsive gutters. ---
  const column = await main.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      x: rect.x,
      width: rect.width,
      maxWidth: style.maxWidth,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
    };
  });
  expect(column.maxWidth).toBe(`${COLUMN_MAX_WIDTH_PX}px`);
  expect(
    Math.abs(column.width - Math.min(vp.width, COLUMN_MAX_WIDTH_PX)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(column.x + column.width / 2 - vp.width / 2),
  ).toBeLessThanOrEqual(1);
  expect(column.paddingLeft).toBe(`${vp.gutterPx}px`);
  expect(column.paddingRight).toBe(`${vp.gutterPx}px`);

  // --- Input styles: pill shape, text inset, Surface background,
  // 1px Secondary border, Text-Primary. ---
  const inputStyle = await input.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderRadius: style.borderTopLeftRadius,
      paddingLeft: style.paddingLeft,
      borderWidth: style.borderTopWidth,
      borderStyle: style.borderTopStyle,
      borderColor: style.borderTopColor,
      color: style.color,
    };
  });
  expect(inputStyle.backgroundColor).toBe(SURFACE_RGB);
  expect(parseFloat(inputStyle.borderRadius)).toBeGreaterThanOrEqual(
    FIELD_MIN_BORDER_RADIUS_PX,
  );
  expect(inputStyle.paddingLeft).toBe(`${FIELD_TEXT_INSET_PX}px`);
  expect(inputStyle.borderWidth).toBe("1px");
  expect(inputStyle.borderStyle).toBe("solid");
  expect(inputStyle.borderColor).toBe(SECONDARY_RGB);
  expect(inputStyle.color).toBe(TEXT_PRIMARY_RGB);

  // --- Geometry: 56px high, min(100%, 640px) wide, horizontal and 45% of
  // 100dvh vertical centers, all within 1 CSS px. ---
  const box = await input.boundingBox();
  expect(box, "the Search field must have a layout box").not.toBeNull();
  const expectedWidth = Math.min(
    vp.width - 2 * vp.gutterPx,
    FIELD_MAX_WIDTH_PX,
  );
  expect(Math.abs(box!.width - expectedWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(box!.height - FIELD_HEIGHT_PX)).toBeLessThanOrEqual(1);
  expect(Math.abs(box!.x + box!.width / 2 - vp.width / 2)).toBeLessThanOrEqual(
    1,
  );
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
    Math.abs(box!.y + box!.height / 2 - expectedVerticalCenter),
  ).toBeLessThanOrEqual(1);

  // --- No horizontal overflow at this viewport. ---
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

  // --- No application API request; every request stays on the preview
  // origin (ARCH-016). ---
  expect(requestUrls.some((url) => url.includes("/api/"))).toBe(false);
  for (const url of requestUrls) {
    expect(new URL(url).origin, `unexpected request origin ${url}`).toBe(
      PREVIEW_ORIGIN,
    );
  }

  // --- Primary focus border without an outer highlight. ---
  await page.keyboard.press("Tab");
  await expect(input).toBeFocused();
  const focusStyle = await input.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderColor: style.borderTopColor,
      outlineStyle: style.outlineStyle,
    };
  });
  expect(focusStyle.borderColor).toBe(PRIMARY_RGB);
  expect(focusStyle.outlineStyle).toBe("none");

  // --- Review evidence: exactly one full-page PNG attachment per viewport
  // (P05-G4). Screenshots are non-gating; the assertions above are the
  // acceptance gate (ISSUE-006). ---
  const screenshotName = `empty-shell-${vp.name}.png`;
  const screenshotPath = testInfo.outputPath(screenshotName);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach(screenshotName, {
    path: screenshotPath,
    contentType: "image/png",
  });

  // Mirror the PNG outside the launcher-managed test-results so the exact
  // review attachments survive the launcher's cleanup for inspection.
  const mirror = `${REVIEW_COPY_DIR}/${screenshotName}`;
  if (!existsSync(dirname(mirror))) {
    mkdirSync(dirname(mirror), { recursive: true });
  }
  cpSync(screenshotPath, mirror);
  console.log(
    `[empty-shell] review attachment ${screenshotName}: ${screenshotPath} (mirrored to ${mirror})`,
  );
}

test.describe("empty shell", () => {
  for (const vp of VIEWPORTS) {
    test(`the empty-state Search control at ${vp.name}`, async ({
      page,
    }, testInfo) => {
      await assertEmptyShell(page, testInfo, vp);
    });
  }
});
