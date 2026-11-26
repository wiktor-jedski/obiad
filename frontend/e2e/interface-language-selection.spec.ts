import { chooseLanguage, expectLanguage, languageSummary } from "./header";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { isLandingDialogueRequest } from "./request-purpose";

const PREVIEW_ORIGIN = "http://127.0.0.1:4173";
const STORAGE_KEY = "obiad.interfaceLanguage";
const PRIMARY_RGB = "rgb(74, 222, 128)";
const TEXT_PRIMARY_RGB = "rgb(243, 244, 246)";
const TRANSPARENT_RGBA = "rgba(0, 0, 0, 0)";
const MIN_TARGET_PX = 44;
const FIELD_HEIGHT_PX = 56;
const FIELD_MAX_WIDTH_PX = 640;
const VERTICAL_CENTER_DVH = 0.45;
const CONTROL_TOP_PX = 16;
const REVIEW_COPY_DIR = "/tmp/obiad-interface-language-dropdown";

const COPY = {
  en: {
    placeholder: "Search foods",
  },
  pl: {
    placeholder: "Szukaj potraw",
  },
} as const;

const VIEWPORTS = [
  { name: "mobile-320x568", width: 320, height: 568, gutterPx: 16 },
  { name: "tablet-768x1024", width: 768, height: 1024, gutterPx: 24 },
  { name: "desktop-1280x720", width: 1280, height: 720, gutterPx: 32 },
] as const;

async function useBrowserLanguages(
  page: Page,
  languages: string[],
): Promise<void> {
  await page.addInitScript((values) => {
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      get: () => values,
    });
  }, languages);
}

async function expectStored(page: Page, value: string): Promise<void> {
  expect(
    await page.evaluate(([key]) => window.localStorage.getItem(key), [
      STORAGE_KEY,
    ] as const),
  ).toBe(value);
}

test.describe("Interface Language selection", () => {
  test("selecting PL and EN applies, persists, and survives conflicting browser locales", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["pl-PL"]);
    const requestUrls: string[] = [];
    const userRequestUrls: string[] = [];
    page.on("request", (request) => {
      requestUrls.push(request.url());
      if (!isLandingDialogueRequest(request))
        userRequestUrls.push(request.url());
    });

    await page.goto("/");
    const searchInput = page.locator('input[type="search"]');
    await expectLanguage(page, "pl");
    await expect(searchInput).toHaveAttribute(
      "placeholder",
      COPY.pl.placeholder,
    );

    await chooseLanguage(page, "en");
    await expect(searchInput).toHaveAttribute(
      "placeholder",
      COPY.en.placeholder,
    );
    await expectStored(page, "en");

    await page.reload();
    await expectLanguage(page, "en");
    await expectStored(page, "en");

    await chooseLanguage(page, "pl");
    await expect(searchInput).toHaveAttribute(
      "placeholder",
      COPY.pl.placeholder,
    );
    await expectStored(page, "pl");

    await useBrowserLanguages(page, ["en-US"]);
    await page.reload();
    await expectLanguage(page, "pl");
    await expectStored(page, "pl");

    expect(userRequestUrls.some((url) => url.includes("/api/"))).toBe(false);
    for (const url of requestUrls) {
      expect(new URL(url).origin).toBe(PREVIEW_ORIGIN);
    }
    expect(await page.evaluate(() => document.cookie)).toBe("");
  });

  test("changing language retains unfinished Search text and returns focus to the summary", async ({
    page,
  }) => {
    await useBrowserLanguages(page, ["en-US"]);
    const requestUrls: string[] = [];
    const userRequestUrls: string[] = [];
    page.on("request", (request) => {
      requestUrls.push(request.url());
      if (!isLandingDialogueRequest(request))
        userRequestUrls.push(request.url());
    });

    await page.goto("/");
    const searchInput = page.locator('input[type="search"]');
    const summary = languageSummary(page);

    await searchInput.fill("abc");
    await expect(page.getByRole("listbox")).toBeVisible();
    const requestsAfterTyping = userRequestUrls.length;

    await summary.focus();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(searchInput).not.toHaveAttribute("aria-activedescendant");
    await chooseLanguage(page, "pl");

    await expect(searchInput).toHaveValue("abc");
    await expect(summary).toBeFocused();
    await expect(
      page.locator("button:visible, [role='listbox'], ul:visible, ol:visible"),
    ).toHaveCount(0);
    expect(
      userRequestUrls
        .slice(requestsAfterTyping)
        .some((url) => url.includes("/api/")),
    ).toBe(false);
    for (const url of requestUrls) {
      expect(new URL(url).origin).toBe(PREVIEW_ORIGIN);
    }
  });
});

test.describe("Interface Language dropdown geometry and styles", () => {
  for (const viewport of VIEWPORTS) {
    test(`the borderless dropdown at ${viewport.name}`, async ({
      page,
    }, testInfo) => {
      await assertControlAtViewport(page, testInfo, viewport);
    });
  }
});

async function assertControlAtViewport(
  page: Page,
  testInfo: TestInfo,
  viewport: (typeof VIEWPORTS)[number],
): Promise<void> {
  await useBrowserLanguages(page, ["en-US"]);
  const requestUrls: string[] = [];
  const userRequestUrls: string[] = [];
  page.on("request", (request) => {
    requestUrls.push(request.url());
    if (!isLandingDialogueRequest(request)) userRequestUrls.push(request.url());
  });

  await page.setViewportSize({
    width: viewport.width,
    height: viewport.height,
  });
  await page.goto("/");

  const wrapper = page.locator("[data-interface-language]");
  const summary = languageSummary(page);
  const searchInput = page.locator('input[type="search"]');

  await expect(wrapper).toBeVisible();
  await expect(summary).toBeVisible();
  await expectLanguage(page, "en");
  await expect(page.locator("button:visible")).toHaveCount(0);

  const wrapperBox = await wrapper.boundingBox();
  if (wrapperBox === null) {
    throw new Error(`${viewport.name}: language wrapper has no bounding box`);
  }
  expect(Math.abs(wrapperBox.y - CONTROL_TOP_PX)).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      viewport.width - (wrapperBox.x + wrapperBox.width) - viewport.gutterPx,
    ),
  ).toBeLessThanOrEqual(1);

  const summaryBox = await summary.boundingBox();
  if (summaryBox === null) {
    throw new Error(`${viewport.name}: language summary has no bounding box`);
  }
  expect(summaryBox.width).toBeGreaterThanOrEqual(MIN_TARGET_PX);
  expect(summaryBox.height).toBeGreaterThanOrEqual(MIN_TARGET_PX);
  await expect(summary).toHaveCSS("border-top-width", "0px");
  await expect(summary).toHaveCSS("border-right-width", "0px");
  await expect(summary).toHaveCSS("border-bottom-width", "0px");
  await expect(summary).toHaveCSS("border-left-width", "0px");
  await expect(summary).toHaveCSS("background-color", TRANSPARENT_RGBA);
  await expect(summary).toHaveCSS("color", TEXT_PRIMARY_RGB);

  await expect(searchInput).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(summary).toBeFocused();
  expect(
    await summary.evaluate((element) => element.matches(":focus-visible")),
  ).toBe(true);
  await expect(summary).toHaveCSS("outline-style", "solid");
  await expect(summary).toHaveCSS("outline-width", "2px");
  await expect(summary).toHaveCSS("outline-color", PRIMARY_RGB);
  await expect(summary).toHaveCSS("outline-offset", "2px");

  await page.keyboard.press("Enter");
  const choices = wrapper.getByRole("button");
  const polish = wrapper.getByRole("button", { name: "Polski", exact: true });
  await expect(choices).toHaveCount(2);
  await expect(polish).toHaveAttribute("aria-pressed", "false");
  await expect(
    wrapper.getByRole("button", { name: "English", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Tab");
  await expect(choices.first()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(choices.last()).toBeFocused();
  if (!(await polish.evaluate((button) => button === document.activeElement))) {
    await page.keyboard.press("Shift+Tab");
  }
  await expect(polish).toBeFocused();
  await page.keyboard.press("Enter");
  await expectLanguage(page, "pl");
  await expect(summary).toBeFocused();
  await expect(choices).toHaveCount(0);
  await expectStored(page, "pl");

  const searchBox = await searchInput.boundingBox();
  if (searchBox === null) {
    throw new Error(`${viewport.name}: Search input has no bounding box`);
  }
  const expectedWidth = Math.min(
    viewport.width - 2 * viewport.gutterPx,
    FIELD_MAX_WIDTH_PX,
  );
  expect(Math.abs(searchBox.width - expectedWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(searchBox.height - FIELD_HEIGHT_PX)).toBeLessThanOrEqual(1);
  expect(
    Math.abs(searchBox.x + searchBox.width / 2 - viewport.width / 2),
  ).toBeLessThanOrEqual(1);
  const dvhHeight = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.height = "100dvh";
    document.body.appendChild(probe);
    const height = probe.getBoundingClientRect().height;
    probe.remove();
    return height;
  });
  expect(
    Math.abs(
      searchBox.y -
        Math.max(340, VERTICAL_CENTER_DVH * dvhHeight - FIELD_HEIGHT_PX / 2),
    ),
  ).toBeLessThanOrEqual(1);

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
  expect(wrapperBox.x).toBeGreaterThanOrEqual(0);
  expect(wrapperBox.x + wrapperBox.width).toBeLessThanOrEqual(viewport.width);

  expect(userRequestUrls.some((url) => url.includes("/api/"))).toBe(false);
  for (const url of requestUrls) {
    expect(new URL(url).origin).toBe(PREVIEW_ORIGIN);
  }

  const screenshotName = `interface-language-dropdown-${viewport.name}.png`;
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
}
