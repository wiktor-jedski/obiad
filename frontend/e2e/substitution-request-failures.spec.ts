import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import type {
  Error as ApiError,
  SubstituteSearchRequest,
  SubstituteSearchResponse,
} from "../src/client/types.gen";

const COPY = {
  en: {
    language: "en",
    searchPlaceholder: "Search foods",
    retryMessage: "Could not load substitutions. Try again.",
    chickenName: "Chicken breast",
    pizzaName: "Pizza Margherita",
    moreButton: "MORE!",
    control: "Interface language",
  },
  pl: {
    language: "pl",
    searchPlaceholder: "Szukaj potraw",
    retryMessage: "Nie udało się wczytać zamienników. Spróbuj ponownie.",
    chickenName: "Pierś z kurczaka",
    pizzaName: "Pizza margherita",
    moreButton: "WIĘCEJ!",
    control: "Język interfejsu",
  },
} as const;

const PIZZA_PAGE_1_PL_NAMES = [
  "Zupa pho",
  "Lazania",
  "Pastel de nata",
] as const;

const PIZZA_FOOD_OBJECT_ID = 1;

const CHICKEN_FOOD_OBJECT_ID = 5;

const PIZZA_PAGE_1_IDS = [30, 3, 35] as const;

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

interface SubstitutePost {
  body: SubstituteSearchRequest;
  status: number | null;
  responseBody: ApiError | SubstituteSearchResponse | undefined;
}

function trackSubstitutePosts(page: Page): SubstitutePost[] {
  const posts: SubstitutePost[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/v1/substitutes/search")
    ) {
      posts.push({
        // SAFETY: The request payload matches the generated API contract.
        body: request.postDataJSON() as SubstituteSearchRequest,
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
          .then((body) => {
            // SAFETY: The endpoint response matches one generated API shape.
            post.responseBody = body as ApiError | SubstituteSearchResponse;
          })
          .catch(() => {
            post.responseBody = undefined;
          });
      }
    }
  });
  return posts;
}

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

async function expectNewSearchFailure(
  page: Page,
  posts: SubstitutePost[],
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  const searchInput = page.getByPlaceholder(copy.searchPlaceholder);

  await expect.poll(() => posts.length).toBe(2);
  await expect.poll(() => posts[1]?.status).toBe(503);
  await expect.poll(() => posts[1]?.responseBody).toBeDefined();
  const body = posts[1]?.responseBody;
  if (body === undefined || !("code" in body)) {
    throw new Error("Expected a parsed CATALOG_UNAVAILABLE response");
  }
  expect(body.code).toBe("CATALOG_UNAVAILABLE");
  expect("field" in body).toBe(false);
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

  const state = page.locator("[data-interaction-state]");
  await expect(state).toHaveAttribute(
    "data-interaction-state",
    "newSearchFailure",
  );

  await expect(searchInput).toHaveValue(copy.chickenName);
  await expect(searchInput).toBeFocused();

  await expect(page.locator("[data-selected-name]")).toHaveText(
    copy.chickenName,
  );
  await expect(page.locator("[data-quantity-number]")).toHaveValue("100");
  await expect(page.locator("[data-quantity-static-unit]")).toHaveText("g");

  await expect(page.locator("[data-result-card]")).toHaveCount(0);
  await expect(page.locator("[data-more-button]")).toHaveCount(0);

  await expect(page.locator("[data-card-spinner]")).toHaveCount(0);

  const retryMessage = page.locator("[data-retry-message]");
  await expect(retryMessage).toBeVisible();
  await expect(retryMessage).toHaveText(copy.retryMessage);
  await expect(retryMessage).toHaveAttribute("role", "status");
  await expect(page.getByText(copy.retryMessage)).toHaveCount(1);

  await expect(page.locator("[data-quantity-number]")).toBeEnabled();
  await expect(page.locator("[data-quantity-unit]")).toHaveCount(0);

  await page.waitForTimeout(500);
  expect(posts).toHaveLength(2);
}

async function prepareSuccessfulIntermediatePage(
  page: Page,
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  await prepareSuccessfulCards(page, "margherita", PIZZA_FOOD_OBJECT_ID, copy);
  const moreButton = page.locator("[data-more-button]");
  await expect(moreButton).toBeVisible();
  await moreButton.click();
  await expect
    .poll(async () => renderedCardIDs(page))
    .toEqual([...PIZZA_PAGE_1_IDS]);
  await expect(moreButton).toBeVisible();
  await expect(moreButton).toHaveAttribute("aria-disabled", "false");
}

async function renderedCardIDs(page: Page): Promise<number[]> {
  const cards = page.locator("[data-result-card]");
  return cards.evaluateAll((elements) =>
    elements.map((element) =>
      Number(element.getAttribute("data-food-object-id")),
    ),
  );
}

async function expectMoreFailure(
  page: Page,
  posts: SubstitutePost[],
  copy: (typeof COPY)[keyof typeof COPY],
): Promise<void> {
  const moreButton = page.locator("[data-more-button]");
  const retryMessage = page.locator("[data-retry-message]");

  await moreButton.click();
  await expect.poll(() => posts.length).toBe(3);
  expect(posts[0]?.body).toEqual({
    foodObjectId: PIZZA_FOOD_OBJECT_ID,
    quantity: { value: 1, unit: "serving" },
    pageIndex: 0,
  });
  expect(posts[1]?.body).toEqual({
    foodObjectId: PIZZA_FOOD_OBJECT_ID,
    quantity: { value: 1, unit: "serving" },
    pageIndex: 1,
  });
  expect(posts[2]?.body).toEqual({
    foodObjectId: PIZZA_FOOD_OBJECT_ID,
    quantity: { value: 1, unit: "serving" },
    pageIndex: 2,
  });
  await expect.poll(() => posts[2]?.status).toBe(503);
  await expect.poll(() => posts[2]?.responseBody).toBeDefined();
  const body = posts[2]?.responseBody;
  if (body === undefined || !("code" in body)) {
    throw new Error("Expected a parsed CATALOG_UNAVAILABLE response");
  }
  expect(body.code).toBe("CATALOG_UNAVAILABLE");
  expect("field" in body).toBe(false);

  await expect(page.locator("main")).toHaveAttribute(
    "data-interaction-state",
    "moreFailure",
  );

  await expect(page.locator("[data-selected-name]")).toHaveText(copy.pizzaName);
  await expect(page.locator("[data-quantity-number]")).toHaveValue("1");
  await expect(page.locator("[data-quantity-unit]")).toHaveValue("serving");

  const page1Response = posts[1]?.responseBody;
  if (page1Response === undefined || !("pageIndex" in page1Response)) {
    throw new Error("Expected the successful page-1 response body");
  }
  expect(page1Response.pageIndex).toBe(1);
  await expect.poll(() => renderedCardIDs(page)).toEqual([...PIZZA_PAGE_1_IDS]);
  await expect(page.locator("[data-result-card]")).toHaveCount(3);
  const firstCardName = await page
    .locator("[data-result-card] h3")
    .first()
    .textContent();
  expect(firstCardName).toBe(page1Response?.items?.[0]?.names[copy.language]);

  await expect(moreButton).toBeFocused();
  await expect(moreButton).toHaveAttribute("aria-disabled", "false");

  await expect(retryMessage).toBeVisible();
  await expect(retryMessage).toHaveText(copy.retryMessage);
  await expect(retryMessage).toHaveAttribute("role", "status");
  await expect(page.getByText(copy.retryMessage)).toHaveCount(1);

  await page.waitForTimeout(500);
  expect(posts).toHaveLength(3);

  await moreButton.click();
  await expect.poll(() => posts.length).toBe(4);
  expect(posts[3]?.body).toEqual({
    foodObjectId: PIZZA_FOOD_OBJECT_ID,
    quantity: { value: 1, unit: "serving" },
    pageIndex: 2,
  });
  await expect.poll(() => posts[3]?.status).toBe(503);
  await expect(page.locator("main")).toHaveAttribute(
    "data-interaction-state",
    "moreFailure",
  );
  await expect.poll(() => renderedCardIDs(page)).toEqual([...PIZZA_PAGE_1_IDS]);
  await expect(moreButton).toBeFocused();
  await expect(moreButton).toHaveAttribute("aria-disabled", "false");
  await expect(retryMessage).toHaveText(copy.retryMessage);
  await page.waitForTimeout(500);
  expect(posts).toHaveLength(4);
}

async function expectNewSearchFailureLanguageChange(
  page: Page,
  posts: SubstitutePost[],
  ledger: string[],
): Promise<void> {
  const ledgerBeforeChange = ledger.length;
  const control = page.getByRole("combobox", { name: "Interface language" });
  await control.focus();
  await control.selectOption("pl");
  expect(
    ledger.slice(ledgerBeforeChange),
    "the language action in newSearchFailure starts no suggestion GET, Substitute POST, retry, or other HTTP request",
  ).toEqual([]);
  expect(posts).toHaveLength(2);

  const polishControl = page.getByRole("combobox", { name: COPY.pl.control });

  await expect(page.locator("main")).toHaveAttribute(
    "data-interaction-state",
    "newSearchFailure",
  );
  const retryMessage = page.locator("[data-retry-message]");
  await expect(retryMessage).toHaveText(COPY.pl.retryMessage);
  await expect(retryMessage).toHaveAttribute("role", "status");
  await expect(page.getByText(COPY.pl.retryMessage)).toHaveCount(1);

  await expect(page.locator("[data-selected-name]")).toHaveText(
    COPY.pl.chickenName,
  );
  await expect(page.locator("[data-quantity-number]")).toHaveValue("100");
  await expect(page.locator("[data-quantity-static-unit]")).toHaveText("g");

  const searchInput = page.getByPlaceholder(COPY.pl.searchPlaceholder);
  await expect(searchInput).toHaveValue(COPY.en.chickenName);
  await expect(searchInput).not.toBeFocused();
  await expect(polishControl).toBeFocused();

  await expect(page.locator("[data-result-card]")).toHaveCount(0);
  await expect(page.locator("[data-more-button]")).toHaveCount(0);
}

async function expectMoreFailureLanguageChange(
  page: Page,
  posts: SubstitutePost[],
  ledger: string[],
): Promise<void> {
  const ledgerBeforeChange = ledger.length;
  const control = page.getByRole("combobox", { name: "Interface language" });
  await control.focus();
  await control.selectOption("pl");
  expect(
    ledger.slice(ledgerBeforeChange),
    "the language action in moreFailure starts no suggestion GET, Substitute POST, retry, or other HTTP request",
  ).toEqual([]);
  expect(posts).toHaveLength(4);

  const polishControl = page.getByRole("combobox", { name: COPY.pl.control });

  await expect(page.locator("main")).toHaveAttribute(
    "data-interaction-state",
    "moreFailure",
  );
  await expect.poll(() => renderedCardIDs(page)).toEqual([...PIZZA_PAGE_1_IDS]);
  const cardNames = await page
    .locator("[data-result-card] h3")
    .allTextContents();
  expect(cardNames).toEqual([...PIZZA_PAGE_1_PL_NAMES]);

  const retryMessage = page.locator("[data-retry-message]");
  await expect(retryMessage).toHaveText(COPY.pl.retryMessage);
  await expect(retryMessage).toHaveAttribute("role", "status");
  await expect(page.getByText(COPY.pl.retryMessage)).toHaveCount(1);

  await expect(page.locator("[data-selected-name]")).toHaveText(
    COPY.pl.pizzaName,
  );
  await expect(page.locator("[data-quantity-number]")).toHaveValue("1");
  await expect(page.locator("[data-quantity-unit]")).toHaveValue("serving");
  const moreButton = page.locator("[data-more-button]");
  await expect(moreButton).toHaveText(COPY.pl.moreButton);
  await expect(moreButton).toHaveAttribute("aria-label", COPY.pl.moreButton);
  await expect(moreButton).toHaveAttribute("aria-disabled", "false");
  await expect(polishControl).toBeFocused();
}

test.describe("Substitution request failures", () => {
  test("a new Search and a MORE! request fail after only the outage stack's PostgreSQL stops: each prepared English and Polish page keeps its retained state, control state, and focus, ends every pending spinner, releases the lock, and shows and announces the exact ISSUE-013 retry message with exactly one closed 503 CATALOG_UNAVAILABLE response per activation and no automatic retry (P13-G1, P13-G2, REQ-050, REQ-051)", async ({
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

    const englishLedger: string[] = [];
    englishPage.on("request", (request) => englishLedger.push(request.url()));

    const englishMorePage = await englishContext.newPage();
    const polishMorePage = await polishContext.newPage();
    await useBrowserLanguages(englishMorePage, ["en-US"]);
    await useBrowserLanguages(polishMorePage, ["pl-PL"]);
    const englishMorePosts = trackSubstitutePosts(englishMorePage);
    const polishMorePosts = trackSubstitutePosts(polishMorePage);
    const englishMoreLedger: string[] = [];
    englishMorePage.on("request", (request) =>
      englishMoreLedger.push(request.url()),
    );

    await englishPage.goto("/");
    await polishPage.goto("/");
    await englishMorePage.goto("/");
    await polishMorePage.goto("/");

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

    await prepareSuccessfulIntermediatePage(englishMorePage, COPY.en);
    await prepareSuccessfulIntermediatePage(polishMorePage, COPY.pl);

    await stopOutagePostgresAndWait();

    await englishPage
      .locator(`#food-suggestion-option-${CHICKEN_FOOD_OBJECT_ID}`)
      .click();
    await expectNewSearchFailure(englishPage, englishPosts, COPY.en);

    await expectNewSearchFailureLanguageChange(
      englishPage,
      englishPosts,
      englishLedger,
    );

    await polishPage
      .locator(`#food-suggestion-option-${CHICKEN_FOOD_OBJECT_ID}`)
      .click();
    await expectNewSearchFailure(polishPage, polishPosts, COPY.pl);

    await expectMoreFailure(englishMorePage, englishMorePosts, COPY.en);

    await expectMoreFailureLanguageChange(
      englishMorePage,
      englishMorePosts,
      englishMoreLedger,
    );

    await expectMoreFailure(polishMorePage, polishMorePosts, COPY.pl);

    await englishContext.close();
    await polishContext.close();
  });
});
