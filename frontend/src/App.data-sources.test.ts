import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/svelte";
import type { Window as HappyWindow } from "happy-dom";
import App from "./App.svelte";
import { interfaceLanguage } from "./lib/interfaceLanguage";

const commit = "abcdef0123456789abcdef0123456789abcdef01";
const originalCommit = process.env.VITE_DATA_COMMIT;
// The Bun preload registers Happy DOM on the global object.
declare const happyDOM: HappyWindow["happyDOM"];
const originalUrl = window.location.href;

beforeEach(() => {
  interfaceLanguage.set("en");
});

afterEach(() => {
  cleanup();
  happyDOM.setURL(originalUrl);
  if (originalCommit === undefined) delete process.env.VITE_DATA_COMMIT;
  else process.env.VITE_DATA_COMMIT = originalCommit;
});

function linkHref(name: string, container = document.body): string | null {
  return within(container).getByRole("link", { name }).getAttribute("href");
}

async function expectNavigation(
  search: string,
  sources: string,
): Promise<void> {
  const menu = screen.getByLabelText("obiad — menu", {
    selector: "details > summary",
  });
  await fireEvent.click(menu);
  expect(linkHref(search)).toBe("/");
  expect(linkHref(sources)).toBe("/sources");
  await fireEvent.click(menu);
}

test("Search offers both disclosures but no source list, footer or release link", async () => {
  process.env.VITE_DATA_COMMIT = commit;
  const { container } = render(App);
  expect(container.querySelectorAll("details > summary")).toHaveLength(2);
  await expectNavigation("Search", "Sources");
  expect(
    screen.getByLabelText("Interface language", { selector: "summary" }),
  ).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Foods" })).toBeNull();
  expect(container.querySelector("footer")).toBeNull();
  expect(container.querySelector('a[href="/release.json"]')).toBeNull();
});

const locales = [
  {
    search: "Search",
    sources: "Sources",
    foods: "Foods",
    recipes: "Recipes",
    version: "Data version:",
  },
  {
    search: "Szukaj",
    sources: "Źródła",
    foods: "Składniki",
    recipes: "Przepisy",
    version: "Wersja danych:",
  },
] as const;

for (const copy of locales) {
  test.each([undefined, commit])(
    `direct /sources shows ${copy.foods} and ${copy.recipes} with commit %s`,
    async (dataCommit) => {
      if (dataCommit === undefined) delete process.env.VITE_DATA_COMMIT;
      else process.env.VITE_DATA_COMMIT = dataCommit;
      happyDOM.setURL("http://localhost/sources");
      const fetch = spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("unexpected source request"),
      );
      try {
        const { container } = render(App);
        expect(container.querySelectorAll("details > summary")).toHaveLength(2);
        if (copy.sources === "Źródła") {
          await fireEvent.click(
            screen.getByLabelText("Interface language", {
              selector: "[data-interface-language] summary",
            }),
          );
          await fireEvent.click(screen.getByRole("button", { name: "Polski" }));
        }
        await expectNavigation(copy.search, copy.sources);
        expect(
          screen.getByRole("heading", { name: copy.sources, level: 1 }),
        ).toBeTruthy();
        for (const name of [copy.foods, copy.recipes]) {
          expect(screen.getByRole("heading", { name, level: 2 })).toBeTruthy();
        }
        const lists = screen.getAllByRole("list");
        expect(lists).toHaveLength(2);
        const [foods, recipes] = lists;
        expect(linkHref("USDA FoodData Central", foods)).toBe(
          "https://fdc.nal.usda.gov/",
        );
        expect(linkHref("TheMealDB", recipes)).toBe(
          "https://www.themealdb.com/",
        );
        expect(
          screen.queryByRole("combobox", { name: copy.search }),
        ).toBeNull();
        expect(container.querySelector("footer")).toBeNull();
        if (dataCommit === undefined) {
          expect(container.querySelector('a[href="/release.json"]')).toBeNull();
        } else {
          expect(screen.getByText(copy.version)).toBeTruthy();
          expect(linkHref(commit)).toBe("/release.json");
        }
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        fetch.mockRestore();
      }
    },
  );
}
