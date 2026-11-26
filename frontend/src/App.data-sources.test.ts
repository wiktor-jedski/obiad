import { afterEach, expect, test } from "bun:test";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/svelte";
import App from "./App.svelte";
import { interfaceLanguage } from "./lib/interfaceLanguage";

const commit = "abcdef0123456789abcdef0123456789abcdef01";
const originalCommit = process.env.VITE_DATA_COMMIT;

afterEach(() => {
  cleanup();
  interfaceLanguage.set("en");
  if (originalCommit === undefined) delete process.env.VITE_DATA_COMMIT;
  else process.env.VITE_DATA_COMMIT = originalCommit;
});

test("the dummy app has no production data attribution", () => {
  delete process.env.VITE_DATA_COMMIT;
  render(App);
  expect(screen.queryByRole("contentinfo")).toBeNull();
});

test.each([
  {
    language: "en",
    heading: "Data Sources",
    credit: "Open Food Facts contributors",
    version: "Data version:",
  },
  {
    language: "pl",
    heading: "Źródła danych",
    credit: "Współtwórcy Open Food Facts",
    version: "Wersja danych:",
  },
])("the selector shows release sources in $language", async (copy) => {
  process.env.VITE_DATA_COMMIT = commit;
  interfaceLanguage.set("en");
  render(App);

  await fireEvent.change(
    screen.getByRole("combobox", { name: "Interface language" }),
    { target: { value: copy.language } },
  );
  const footer = within(
    screen.getByRole("contentinfo", { name: copy.heading }),
  );
  const link = (name: string) => footer.getByRole("link", { name });
  expect(link(copy.credit).getAttribute("href")).toBe(
    "https://world.openfoodfacts.org/data",
  );
  expect(link("Open Database License (ODbL)").getAttribute("href")).toBe(
    "https://opendatacommons.org/licenses/odbl/1-0/",
  );
  expect(link("USDA FoodData Central").getAttribute("href")).toBe(
    "https://fdc.nal.usda.gov/",
  );
  expect(footer.getByText(copy.version)).toBeTruthy();
  expect(link(commit).getAttribute("href")).toBe("/release.json");
  expect(
    footer.getAllByRole("link").map((item) => item.getAttribute("href")),
  ).not.toContain("/catalog.json");
});
