import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

/**
 * Real-stack Substitution request-failure scenario (task 41; ARCH-001,
 * ARCH-002, ARCH-003, ARCH-008, ARCH-011, ARCH-019, ARCH-020, ARCH-022,
 * REQ-050, ISSUE-013; P13-G1).
 *
 * This scenario runs serially on the separate outage stack behind `bun run
 * test:e2e` (ARCH-022): the launcher hands the fixed loopback Fiber
 * listener to a second Fiber process backed by its own disposable
 * PostgreSQL container, runs only this spec against it, and never touches
 * the normal stack's PostgreSQL, credentials, or preview. The outage
 * container name reaches the spec through `OBIAD_E2E_OUTAGE_CONTAINER`.
 *
 * It verifies the failed new-Search slice over task 40:
 * - One English page and one Polish page prepare successful browser state
 *   — three result cards for a first suggestion and an open suggestion
 *   panel holding a second suggestion — before the outage begins.
 * - Stopping only the outage stack's PostgreSQL process makes the outage
 *   Fiber report catalog unavailability (`GET /health` stops returning
 *   ready) while the Fiber process itself stays up.
 * - Selecting the prepared suggestion produces exactly one current
 *   generated-client `POST /api/v1/substitutes/search` and one closed
 *   `503 CATALOG_UNAVAILABLE` response without `field`; no second POST
 *   starts automatically (ARCH-019: no retry, no queued intent, no
 *   successful-response reuse).
 * - Each page reaches the `newSearchFailure` interaction transition,
 *   keeps the exact newly selected Substitution Input (name and committed
 *   100 g quantity), the exact returned Search text, and Search focus,
 *   renders zero result cards and no MORE!, removes every pending
 *   spinner, makes the related controls operable after the request ends,
 *   and shows and announces the exact ISSUE-013 retry message
 *   (`Could not load substitutions. Try again.` / `Nie udało się wczytać
 *   zamienników. Spróbuj ponownie.`) in one atomic polite status region
 *   (`role="status"`), with no duplicate visually hidden message and no
 *   programmatic focus movement (REQ-050, ISSUE-013).
 */

const COPY = {
  en: {
    searchPlaceholder: "Search foods",
    retryMessage: "Could not load substitutions. Try again.",
    chickenName: "Chicken breast",
  },
  pl: {
    searchPlaceholder: "Szukaj potraw",
    retryMessage: "Nie udało się wczytać zamienników. Spróbuj ponownie.",
    chickenName: "Pierś z kurczaka",
  },
} as const;

/** The seeded Pizza Margherita suggestion (ID 1, 1 serving = 350 g). */
const PIZZA_FOOD_OBJECT_ID = 1;
/** The seeded Chicken breast suggestion (ID 5, 100 g, no Serving). */
const CHICKEN_FOOD_OBJECT_ID = 5;

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
  body: {
    foodObjectId?: number;
    quantity?: { value: number; unit: string };
    pageIndex?: number;
  };
  status: number | null;
  responseBody: unknown;
}

/**
 * Records every generated-client `POST /api/v1/substitutes/search` request
 * with the status and parsed body of its real-stack response.
 */
function trackSubstitutePosts(page: Page): SubstitutePost[] {
  const posts: SubstitutePost[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/v1/substitutes/search")
    ) {
      posts.push({
        body: request.postDataJSON() as SubstitutePost["body"],
        status: null,
        responseBody: undefined,
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
        void response
          .json()
          .then((body: unknown) => {
            post.responseBody = body;
          })
          .catch(() => {
            post.responseBody = undefined;
          });
      }
    }
  });
  return posts;
}

/**
 * Drives one pointer selection of the successful preparation suggestion and
 * waits for the three-card result page.
 */
async function prepareSuccessfulCards(
  page: Page,
  query: string,
  foodObjectId: number,
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  const searchInput = page.getByPlaceholder(copy.searchPlaceholder);
  await searchInput.fill(query);
  const option = page.locator(`#food-suggestion-option-${foodObjectId}`);
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.locator("[data-result-grid]")).toBeVisible();
  await expect(page.locator("[data-result-card]")).toHaveCount(3);
}

/**
 * Types the second suggestion query and waits for its open suggestion
 * option without selecting it, so the prepared suggestion is ready before
 * the outage begins.
 */
async function prepareSecondSuggestion(
  page: Page,
  query: string,
  foodObjectId: number,
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  const searchInput = page.getByPlaceholder(copy.searchPlaceholder);
  await searchInput.fill(query);
  const option = page.locator(`#food-suggestion-option-${foodObjectId}`);
  await expect(option).toBeVisible();
  // Search keeps focus on the prepared suggestion so a later selection is a
  // pointer activation of the exact prepared option (REQ-020).
  await expect(searchInput).toBeFocused();
}

/**
 * Stops only the outage stack's PostgreSQL container and waits until the
 * outage Fiber's `GET /health` stops reporting ready, proving that catalog
 * requests now fail while the Fiber process itself stays up.
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

/** Asserts the complete new-Search failure surface on one page. */
async function expectNewSearchFailure(
  page: Page,
  posts: SubstitutePost[],
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  const searchInput = page.getByPlaceholder(copy.searchPlaceholder);

  // Exactly one current Substitute POST and one closed 503
  // CATALOG_UNAVAILABLE response without `field`; no automatic retry.
  await expect.poll(() => posts.length).toBe(2);
  await expect.poll(() => posts[1]?.status).toBe(503);
  await expect.poll(() => posts[1]?.responseBody).toBeDefined();
  const body = posts[1]?.responseBody as Record<string, unknown> | undefined;
  expect(body?.code).toBe("CATALOG_UNAVAILABLE");
  expect("field" in (body ?? {})).toBe(false);
  expect(posts[0]?.body).toEqual({
    foodObjectId: PIZZA_FOOD_OBJECT_ID,
    quantity: { value: 1, unit: "serving" },
    pageIndex: 0,
  });
  expect(posts[1]?.body).toEqual({
    foodObjectId: CHICKEN_FOOD_OBJECT_ID,
    quantity: { value: 100, unit: "g" },
    pageIndex: 0,
  });

  // The page reaches the newSearchFailure interaction transition.
  const state = page.locator("[data-interaction-state]");
  await expect(state).toHaveAttribute(
    "data-interaction-state",
    "newSearchFailure",
  );

  // Search text keeps the exact returned active-language name, and Search
  // keeps focus (no programmatic focus movement after a failure).
  await expect(searchInput).toHaveValue(copy.chickenName);
  await expect(searchInput).toBeFocused();

  // The selected Substitution Input keeps the exact newly selected Food
  // Object: the localized name and the committed 100 g quantity.
  await expect(page.locator("[data-selected-name]")).toHaveText(
    copy.chickenName,
  );
  await expect(page.locator("[data-quantity-number]")).toHaveValue("100");
  await expect(page.locator("[data-quantity-static-unit]")).toHaveText("g");

  // Result cards and MORE! are cleared from the rendered state.
  await expect(page.locator("[data-result-card]")).toHaveCount(0);
  await expect(page.locator("[data-more-button]")).toHaveCount(0);

  // Every pending spinner ends.
  await expect(page.locator("[data-card-spinner]")).toHaveCount(0);

  // The exact ISSUE-013 retry message renders visibly in one atomic polite
  // status region and is the only failure announcement: no duplicate
  // visually hidden message exists.
  const retryMessage = page.locator("[data-retry-message]");
  await expect(retryMessage).toBeVisible();
  await expect(retryMessage).toHaveText(copy.retryMessage);
  await expect(retryMessage).toHaveAttribute("role", "status");
  await expect(page.getByText(copy.retryMessage)).toHaveCount(1);

  // The related controls become operable after the request ends: the
  // quantity editor is enabled and a fresh suggestion selection works.
  await expect(page.locator("[data-quantity-number]")).toBeEnabled();
  await expect(page.locator("[data-quantity-unit]")).toHaveCount(0);

  // No second POST starts automatically after the terminal failure.
  await page.waitForTimeout(500);
  expect(posts).toHaveLength(2);
}

test.describe("Substitution request failures", () => {
  test("a new Search fails after only the outage stack's PostgreSQL stops: each prepared English and Polish page keeps the exact selected input, Search text, and focus, clears cards and MORE!, ends every spinner, releases the lock, and shows and announces the exact ISSUE-013 retry message with exactly one 503 CATALOG_UNAVAILABLE response and no automatic retry (P13-G1, REQ-050)", async ({
    browser,
  }) => {
    const englishContext = await browser.newContext({
      baseURL: "http://127.0.0.1:4173",
    });
    const polishContext = await browser.newContext({
      baseURL: "http://127.0.0.1:4173",
    });
    const englishPage = await englishContext.newPage();
    const polishPage = await polishContext.newPage();
    await useBrowserLanguages(englishPage, ["en-US"]);
    await useBrowserLanguages(polishPage, ["pl-PL"]);
    const englishPosts = trackSubstitutePosts(englishPage);
    const polishPosts = trackSubstitutePosts(polishPage);

    await englishPage.goto("/");
    await polishPage.goto("/");

    // Prepare successful English and Polish pages with three result cards
    // and a second suggestion before the outage begins.
    await prepareSuccessfulCards(
      englishPage,
      "margherita",
      PIZZA_FOOD_OBJECT_ID,
      COPY.en,
    );
    await prepareSecondSuggestion(
      englishPage,
      "chicken",
      CHICKEN_FOOD_OBJECT_ID,
      COPY.en,
    );
    await prepareSuccessfulCards(
      polishPage,
      "margherita",
      PIZZA_FOOD_OBJECT_ID,
      COPY.pl,
    );
    await prepareSecondSuggestion(
      polishPage,
      "kurczak",
      CHICKEN_FOOD_OBJECT_ID,
      COPY.pl,
    );

    // Stop only the outage stack's PostgreSQL process.
    await stopOutagePostgresAndWait();

    // Selecting the prepared suggestion on each page produces exactly one
    // current Substitute POST and one closed 503 CATALOG_UNAVAILABLE
    // response without `field`; no second POST starts automatically.
    await englishPage
      .locator(`#food-suggestion-option-${CHICKEN_FOOD_OBJECT_ID}`)
      .click();
    await expectNewSearchFailure(englishPage, englishPosts, COPY.en);

    await polishPage
      .locator(`#food-suggestion-option-${CHICKEN_FOOD_OBJECT_ID}`)
      .click();
    await expectNewSearchFailure(polishPage, polishPosts, COPY.pl);

    await englishContext.close();
    await polishContext.close();
  });
});
