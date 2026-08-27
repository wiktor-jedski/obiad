import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const PREVIEW_ORIGIN = "http://127.0.0.1:4173";

const FIELD_HEIGHT_PX = 56;

const FIELD_MIN_BORDER_RADIUS_PX = FIELD_HEIGHT_PX / 2;

const FIELD_TEXT_INSET_PX = FIELD_HEIGHT_PX / 2 + 8;

const FIELD_MAX_WIDTH_PX = 640;

const COLUMN_MAX_WIDTH_PX = 1280;

const VERTICAL_CENTER_DVH = 0.45;

const VIEWPORTS = [
  { name: "320x568", width: 320, height: 568, gutterPx: 16 },
  { name: "768x1024", width: 768, height: 1024, gutterPx: 24 },
  { name: "1280x720", width: 1280, height: 720, gutterPx: 32 },
] as const;

const SURFACE_RGB = "rgb(22, 29, 22)";
const TEXT_PRIMARY_RGB = "rgb(243, 244, 246)";
const PRIMARY_RGB = "rgb(74, 222, 128)";

const REVIEW_COPY_DIR = "/tmp/obiad-task24-empty-shell";

async function assertEmptyShell(
  page: Page,
  testInfo: TestInfo,
  vp: (typeof VIEWPORTS)[number],
): Promise<void> {
  const requestUrls: string[] = [];
  page.on("request", (request) => requestUrls.push(request.url()));

  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.goto("/");
  await expect(page).toHaveTitle("Obiad");

  const main = page.locator("main");
  await expect(main).toHaveCount(1);

  const input = page.locator("input");
  await expect(input).toHaveCount(1);
  await expect(input).toHaveAttribute("type", "search");

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

  const label = page.locator("label");
  await expect(label).toHaveCount(1);
  await expect(label).toHaveText("Search");
  const inputId = await input.getAttribute("id");
  if (inputId === null || inputId === "") {
    throw new Error("Search input must have a nonempty id");
  }
  await expect(label).toHaveAttribute("for", inputId);
  await expect(input).toHaveAttribute("placeholder", "Search foods");
  await expect(input).toHaveAccessibleName("Search");

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

  expect(
    await input.evaluate((element) => element.hasAttribute("autofocus")),
  ).toBe(true);
  await expect(input).toBeFocused();

  expect(
    await input.evaluate(
      (element) => getComputedStyle(element).backgroundImage,
    ),
  ).toBe("none");
  expect(
    await input.evaluate((element) => getComputedStyle(element).appearance),
  ).toBe("none");

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
  expect(inputStyle.borderColor).toBe(PRIMARY_RGB);
  expect(inputStyle.color).toBe(TEXT_PRIMARY_RGB);

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

  expect(requestUrls.some((url) => url.includes("/api/"))).toBe(false);
  for (const url of requestUrls) {
    expect(new URL(url).origin, `unexpected request origin ${url}`).toBe(
      PREVIEW_ORIGIN,
    );
  }

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

  const screenshotName = `empty-shell-${vp.name}.png`;
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

  test("clicking Search selects its existing text", async ({ page }) => {
    await page.goto("/");
    const search = page.getByRole("combobox", { name: "Search" });
    await search.fill("chicken breast");
    await search.click();

    await expect
      .poll(() =>
        search.evaluate((field) => {
          if (!(field instanceof HTMLInputElement)) {
            throw new TypeError("Search combobox must be an input element");
          }
          return {
            start: field.selectionStart,
            end: field.selectionEnd,
          };
        }),
      )
      .toEqual({ start: 0, end: "chicken breast".length });
  });
});
