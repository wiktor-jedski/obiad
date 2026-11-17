import { execFileSync } from "node:child_process";
import { isLandingDialogueRequest } from "./request-purpose";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const COPY = {
  en: {
    language: "en",
    searchPlaceholder: "Search foods",
    secondQuery: "chicken",
  },
  pl: {
    language: "pl",
    searchPlaceholder: "Szukaj potraw",
    secondQuery: "kurczak",
  },
} as const;

const VIEWPORTS = [
  { name: "320x568", width: 320, height: 568 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1280x720", width: 1280, height: 720 },
] as const;

const PIZZA_FOOD_OBJECT_ID = 1;

const CHICKEN_FOOD_OBJECT_ID = 5;

const PIZZA_PAGE_0_IDS = [13, 29, 26] as const;

const PIZZA_PAGE_1_IDS = [30, 3, 35] as const;

const REVIEW_COPY_DIR = "/tmp/obiad-task53-responsive-accessible-presentation";

interface PreparedPage {
  label: string;
  newSearchPage: Page;
  moreFailurePage: Page;
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

async function renderedCardIDs(page: Page): Promise<number[]> {
  const cards = page.locator("[data-result-card]");
  return cards.evaluateAll((elements) =>
    elements.map((element) =>
      Number(element.getAttribute("data-food-object-id")),
    ),
  );
}

async function expectNoHorizontalOverflow(
  page: Page,
  surface: string,
): Promise<void> {
  const overflow = await page.evaluate(() => ({
    documentScrollWidth: document.documentElement.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    overflow.documentScrollWidth,
    `${surface}: document scrollWidth`,
  ).toBeLessThanOrEqual(overflow.documentClientWidth);
  expect(
    overflow.documentScrollWidth,
    `${surface}: document scrollWidth`,
  ).toBeLessThanOrEqual(overflow.innerWidth);
  expect(
    overflow.bodyScrollWidth,
    `${surface}: body scrollWidth`,
  ).toBeLessThanOrEqual(overflow.bodyClientWidth);
  expect(
    overflow.bodyScrollWidth,
    `${surface}: body scrollWidth`,
  ).toBeLessThanOrEqual(overflow.innerWidth);
}

async function expectCardColumns(
  page: Page,
  vp: (typeof VIEWPORTS)[number],
): Promise<void> {
  const cards = page.locator(
    "[data-selected-food-summary], [data-result-card]",
  );
  await expect(page.locator('[data-card-reveal-state="waiting"]')).toHaveCount(
    0,
  );
  await expect(
    page.locator('[data-card-reveal-state="revealing"]'),
  ).toHaveCount(0);
  const boxes = await cards.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      const image = element
        .querySelector("[data-result-card-image]")
        ?.getBoundingClientRect();
      const content = element
        .querySelector("[data-card-content]")
        ?.getBoundingClientRect();
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        radius: getComputedStyle(element).borderRadius,
        image: image && {
          x: image.x,
          y: image.y,
          width: image.width,
          height: image.height,
        },
        content: content && { x: content.x, y: content.y },
      };
    }),
  );
  expect(boxes.length).toBeGreaterThanOrEqual(4);
  for (const [index, box] of boxes.entries()) {
    expect(box.width).toBeLessThanOrEqual(920);
    expect(Math.abs(box.x - boxes[0]!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.width - boxes[0]!.width)).toBeLessThanOrEqual(1);
    expect(box.radius).toBe("28px");
    if (index > 0) expect(box.y).toBeGreaterThan(boxes[index - 1]!.y);
    expect(box.image).toBeDefined();
    expect(box.content).toBeDefined();
    if (vp.width < 640) {
      expect(
        Math.abs(box.image!.width - box.image!.height),
      ).toBeLessThanOrEqual(1);
      expect(box.content!.y).toBeGreaterThan(box.image!.y);
    } else {
      expect(box.content!.x).toBeGreaterThan(box.image!.x);
      expect(Math.abs(box.image!.width / box.width - 0.38)).toBeLessThan(0.02);
    }
  }
}

async function gateSubstitutePosts(page: Page): Promise<{
  release: (postNumber: 1 | 2 | 3) => void;
}> {
  const gates = [
    Promise.withResolvers<void>(),
    Promise.withResolvers<void>(),
    Promise.withResolvers<void>(),
  ];
  let postCount = 0;
  await page.route("**/api/v1/substitutes/search", async (route) => {
    if (isLandingDialogueRequest(route.request())) {
      await route.continue();
      return;
    }
    postCount += 1;
    const gate = gates.at(postCount - 1);
    if (gate !== undefined) {
      await gate.promise;
    }
    await route.continue();
  });
  return {
    release(postNumber: 1 | 2 | 3): void {
      gates[postNumber - 1].resolve();
    },
  };
}

async function selectPizzaMargherita(
  page: Page,
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  const search = page.getByPlaceholder(copy.searchPlaceholder);
  await search.fill("pizza");
  await expect(page.locator('[role="listbox"]')).toBeVisible();
  await page.locator(`#food-suggestion-option-${PIZZA_FOOD_OBJECT_ID}`).click();
  await expect(page.locator("[data-result-grid]")).toBeVisible();
  await expect(page.locator("[data-result-card]")).toHaveCount(3);
}

async function prepareSuccessfulIntermediatePage(
  page: Page,
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  await selectPizzaMargherita(page, copy);
  const sentinel = page.locator("[data-pagination-sentinel]");
  await expect(sentinel).toBeAttached();
  await sentinel.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => renderedCardIDs(page))
    .toEqual([...PIZZA_PAGE_0_IDS, ...PIZZA_PAGE_1_IDS]);
  await expect(sentinel).toBeAttached();
  await expect(page.locator("[data-pagination-spinner]")).toHaveCount(0);
}

async function prepareSecondSuggestion(
  page: Page,
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  const searchInput = page.getByPlaceholder(copy.searchPlaceholder);
  await searchInput.fill(copy.secondQuery);
  const option = page.locator(
    `#food-suggestion-option-${CHICKEN_FOOD_OBJECT_ID}`,
  );
  await expect(option).toBeVisible();
  await expect(searchInput).toBeFocused();
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

async function runPrimaryFlow(
  page: Page,
  testInfo: TestInfo,
  vp: (typeof VIEWPORTS)[number],
): Promise<void> {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.goto("/");
  await expect(page).toHaveTitle("Obiad");
  const main = page.locator("main");
  await expect(main).toHaveAttribute("data-interaction-state", "empty");

  await expectNoHorizontalOverflow(page, `${vp.name} empty`);

  const posts = await gateSubstitutePosts(page);

  const search = page.getByPlaceholder(COPY.en.searchPlaceholder);
  await search.fill("pizza");
  await expect(page.locator('[role="listbox"]')).toBeVisible();
  await expectNoHorizontalOverflow(page, `${vp.name} open-suggestion`);

  await page.locator(`#food-suggestion-option-${PIZZA_FOOD_OBJECT_ID}`).click();
  await expect(main).toHaveAttribute("data-interaction-state", "loadingNew");
  await expect(page.locator("[data-card-spinner]")).toHaveCount(0);
  await expectNoHorizontalOverflow(page, `${vp.name} pending new-Search`);
  posts.release(1);
  await expect(main).toHaveAttribute("data-interaction-state", "results");
  await expect
    .poll(async () => renderedCardIDs(page))
    .toEqual([...PIZZA_PAGE_0_IDS]);

  await expectCardColumns(page, vp);
  await expectNoHorizontalOverflow(page, `${vp.name} completed result`);

  const number = page.locator("[data-nutrition-editor=quantity]");
  await number.fill("abc");
  await number.press("Enter");
  await expect(number).toHaveAttribute("aria-invalid", "true");
  await expectNoHorizontalOverflow(page, `${vp.name} invalid-quantity`);

  await number.fill("200");
  await number.press("Enter");
  await expect(main).toHaveAttribute("data-interaction-state", "results");
  await expect(page.locator("[data-card-spinner]")).toHaveCount(0);
  await expectNoHorizontalOverflow(
    page,
    `${vp.name} local quantity projection`,
  );

  const sentinel = page.locator("[data-pagination-sentinel]");
  await sentinel.scrollIntoViewIfNeeded();
  await expect(main).toHaveAttribute("data-interaction-state", "loadingMore");
  await expect(page.locator("[data-pagination-spinner]")).toBeVisible();
  await expectNoHorizontalOverflow(page, `${vp.name} pending-pagination`);
  posts.release(2);
  await expect(main).toHaveAttribute("data-interaction-state", "results");
  await expect
    .poll(async () => renderedCardIDs(page))
    .toEqual([...PIZZA_PAGE_0_IDS, ...PIZZA_PAGE_1_IDS]);

  await page.waitForTimeout(800);
  await expectCardColumns(page, vp);
  await expectNoHorizontalOverflow(page, `${vp.name} completed later-page`);

  const screenshotName = `responsive-accessible-presentation-${vp.name}.png`;
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
    `[responsive-accessible-presentation] review attachment ${screenshotName}: ${screenshotPath} (mirrored to ${mirror})`,
  );
}

test.describe("Responsive accessible presentation", () => {
  for (const vp of VIEWPORTS) {
    test(`the primary flow fits at ${vp.name} with one shared card column and no page-level horizontal overflow across every surface (P17-G2, P17-G3, P17-G4, REQ-062, REQ-063, REQ-073)`, async ({
      page,
    }, testInfo) => {
      await useBrowserLanguages(page, ["en-US"]);
      await runPrimaryFlow(page, testInfo, vp);
    });
  }
});

test.describe("Responsive presentation failure surfaces", () => {
  test("after the outage, each retained new-Search and pagination failure surface fits at 320x568, 768x1024, and 1280x720 without page-level horizontal overflow in English and Polish (P17-G4, REQ-063)", async ({
    browser,
  }) => {
    const prepared: PreparedPage[] = [];

    for (const vp of VIEWPORTS) {
      for (const copy of [COPY.en, COPY.pl] as const) {
        const context = await browser.newContext({
          baseURL: "http://127.0.0.1:4173",
          viewport: { width: vp.width, height: vp.height },
        });
        const newSearchPage = await context.newPage();
        await useBrowserLanguages(newSearchPage, [copy.language]);
        await newSearchPage.goto("/");
        await prepareSuccessfulIntermediatePage(newSearchPage, copy);
        await prepareSecondSuggestion(newSearchPage, copy);
        const moreFailurePage = await context.newPage();
        await useBrowserLanguages(moreFailurePage, [copy.language]);
        await moreFailurePage.goto("/");
        await prepareSuccessfulIntermediatePage(moreFailurePage, copy);
        prepared.push({
          label: `${vp.name} ${copy.language}`,
          newSearchPage,
          moreFailurePage,
        });
      }
    }

    await stopOutagePostgresAndWait();

    for (const entry of prepared) {
      await entry.newSearchPage
        .locator(`#food-suggestion-option-${CHICKEN_FOOD_OBJECT_ID}`)
        .click();
      await expect(entry.newSearchPage.locator("main")).toHaveAttribute(
        "data-interaction-state",
        "newSearchFailure",
      );
      await expect(
        entry.newSearchPage.locator("[data-retry-message]"),
      ).toBeVisible();
      await expectNoHorizontalOverflow(
        entry.newSearchPage,
        `${entry.label} newSearchFailure`,
      );

      await entry.moreFailurePage
        .locator("[data-pagination-sentinel]")
        .scrollIntoViewIfNeeded();
      await expect(entry.moreFailurePage.locator("main")).toHaveAttribute(
        "data-interaction-state",
        "moreFailure",
      );
      await expect(
        entry.moreFailurePage.locator("[data-retry-message]"),
      ).toBeVisible();
      await expect(
        entry.moreFailurePage.locator("[data-result-card]"),
      ).toHaveCount(6);
      await expectNoHorizontalOverflow(
        entry.moreFailurePage,
        `${entry.label} moreFailure`,
      );
    }

    for (const entry of prepared) {
      await entry.newSearchPage.context().close();
    }
  });
});
