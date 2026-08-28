import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/svelte";
import { tick } from "svelte";
import App from "./App.svelte";
import type { SubstituteSearchResponse } from "./client/types.gen";
import {
  interactionState,
  type SelectedFoodObject,
} from "./lib/interactionState";
import { interfaceLanguage } from "./lib/interfaceLanguage";
import { queryClient } from "./lib/queryClient";

class HappyDomRequest {
  readonly url: string;
  readonly method: string;

  constructor(url: string | URL, init?: RequestInit) {
    this.url = String(url);
    this.method = init?.method ?? "GET";
  }
}

async function settle(): Promise<void> {
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 25));
}

function elementText(selector: string): string | null {
  return document.querySelector(selector)?.textContent ?? null;
}

describe("component integration: quantity reprojection (P22-G4, REQ-029, REQ-031, REQ-039, REQ-040)", () => {
  const originalFetch = globalThis.fetch;
  const OriginalRequest = globalThis.Request;

  beforeEach(() => {
    queryClient.clear();
    interactionState.reset();
    interfaceLanguage.set("en");
    Object.defineProperty(globalThis, "Request", {
      configurable: true,
      writable: true,
      value: HappyDomRequest,
    });
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    globalThis.Request = OriginalRequest;
  });

  function mockSubstituteResponse(response: SubstituteSearchResponse): void {
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const url =
          input instanceof globalThis.Request ? input.url : input.toString();
        if (url.includes("/api/v1/substitutes/search")) {
          return new Response(JSON.stringify(response), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
      { preconnect: originalFetch.preconnect },
    );
  }

  test("solid base-unit fixture proves full-precision selected macronutrients and calories, equal-calorie Matched Quantities, candidate macronutrients and calories, and whole g output", async () => {
    const selected: SelectedFoodObject = {
      foodObjectId: 5,
      names: { en: "Chicken breast", pl: "Pierś z kurczaka" },
      quantity: { value: 100, unit: "g" },
      allowedQuantities: [{ unit: "g", maximumValue: 100000 }],
      capturedLanguage: "en",
    };

    const response: SubstituteSearchResponse = {
      pageIndex: 0,
      totalEligibleCount: 1,
      hasMore: false,
      selectedFood: {
        foodObjectId: 5,
        names: { en: "Chicken breast", pl: "Pierś z kurczaka" },
        macroProfile: { protein: 31, carbohydrate: 0, fat: 3.6 },
        baseUnit: "g",
      },
      items: [
        {
          foodObjectId: 23,
          names: { en: "Tofu", pl: "Tofu" },
          macroProfile: { protein: 25, carbohydrate: 0, fat: 2 },
          baseUnit: "g",
          similarityPercent: 95,
        },
      ],
    };

    mockSubstituteResponse(response);
    interactionState.selectSuggestion(selected);
    render(App);
    await settle();

    // Input: 31g protein, 0g carb, 3.6g fat per 100g -> 4*31 + 0 + 9*3.6 = 156.4 kcal -> 156 kcal
    expect(elementText("[data-input-macro-protein]")).toBe("31.0 g");
    expect(elementText("[data-input-macro-carbohydrate]")).toBe("0.0 g");
    expect(elementText("[data-input-macro-fat]")).toBe("3.6 g");
    expect(elementText("[data-input-calories]")).toBe("156 kcal");

    // Candidate (Tofu): 25g protein, 0g carb, 2g fat per 100g -> 118 kcal/100g
    // Unrounded Matched Quantity: (156.4 * 100) / 118 = 132.542... g -> 133 g
    // Candidate Protein: 25 * 132.542... / 100 = 33.135... g -> 33.1 g
    // Candidate Fat: 2 * 132.542... / 100 = 2.650... g -> 2.7 g
    // Candidate Calories: 156.4 kcal -> 156 kcal
    expect(elementText("[data-result-card-matched-quantity]")).toBe("133 g");
    expect(elementText("[data-result-card-calories]")).toBe("156 kcal");

    const ddValues = Array.from(
      document.querySelectorAll("[data-result-card] dd"),
    ).map((element) => element.textContent);
    expect(ddValues).toEqual(["33.1 g", "0.0 g", "2.7 g", "95%"]);
  });

  test("liquid base-unit fixture proves whole ml output for liquid candidates", async () => {
    const selected: SelectedFoodObject = {
      foodObjectId: 10,
      names: { en: "Milk", pl: "Mleko" },
      quantity: { value: 250, unit: "ml" },
      allowedQuantities: [{ unit: "ml", maximumValue: 100000 }],
      capturedLanguage: "en",
    };

    const response: SubstituteSearchResponse = {
      pageIndex: 0,
      totalEligibleCount: 1,
      hasMore: false,
      selectedFood: {
        foodObjectId: 10,
        names: { en: "Milk", pl: "Mleko" },
        macroProfile: { protein: 3.4, carbohydrate: 4.8, fat: 3.2 },
        baseUnit: "ml",
      },
      items: [
        {
          foodObjectId: 33,
          names: { en: "Soy drink", pl: "Napój sojowy" },
          macroProfile: { protein: 4, carbohydrate: 2, fat: 1 },
          baseUnit: "ml",
          similarityPercent: 88,
        },
      ],
    };

    mockSubstituteResponse(response);
    interactionState.selectSuggestion(selected);
    render(App);
    await settle();

    // Input: 250 ml of (3.4g P, 4.8g C, 3.2g F / 100 ml)
    // Protein: 3.4 * 2.5 = 8.5 g, Carb: 4.8 * 2.5 = 12.0 g, Fat: 3.2 * 2.5 = 8.0 g
    // Calories: 4*8.5 + 4*12 + 9*8 = 34 + 48 + 72 = 154 kcal
    expect(elementText("[data-input-macro-protein]")).toBe("8.5 g");
    expect(elementText("[data-input-macro-carbohydrate]")).toBe("12.0 g");
    expect(elementText("[data-input-macro-fat]")).toBe("8.0 g");
    expect(elementText("[data-input-calories]")).toBe("154 kcal");

    // Candidate: 4g P, 2g C, 1g F per 100 ml -> 33 kcal / 100 ml
    // Matched Quantity: (154 * 100) / 33 = 466.666... ml -> 467 ml
    expect(elementText("[data-result-card-matched-quantity]")).toBe("467 ml");
    expect(elementText("[data-result-card-calories]")).toBe("154 kcal");

    const ddValues = Array.from(
      document.querySelectorAll("[data-result-card] dd"),
    ).map((element) => element.textContent);
    expect(ddValues).toEqual(["18.7 g", "9.3 g", "4.7 g", "88%"]);
  });

  test("Serving calculation-basis fixture proves Serving count conversion with exact Serving base quantity and full-precision scaling", async () => {
    const selected: SelectedFoodObject = {
      foodObjectId: 1,
      names: { en: "Pizza Margherita", pl: "Pizza Margherita" },
      quantity: { value: 1, unit: "serving" },
      allowedQuantities: [
        { unit: "serving", maximumValue: 285 },
        { unit: "g", maximumValue: 100000 },
      ],
      capturedLanguage: "en",
    };

    const response: SubstituteSearchResponse = {
      pageIndex: 0,
      totalEligibleCount: 1,
      hasMore: false,
      selectedFood: {
        foodObjectId: 1,
        names: { en: "Pizza Margherita", pl: "Pizza Margherita" },
        macroProfile: { protein: 10, carbohydrate: 30, fat: 10 },
        baseUnit: "g",
        serving: 350,
      },
      items: [
        {
          foodObjectId: 13,
          names: { en: "Gyoza", pl: "Pierożki gyoza" },
          macroProfile: { protein: 8, carbohydrate: 24, fat: 8 },
          baseUnit: "g",
          similarityPercent: 99,
        },
      ],
    };

    mockSubstituteResponse(response);
    interactionState.selectSuggestion(selected);
    render(App);
    await settle();

    // 1 serving = 350 g: scale factor = 3.5
    // Input macros: 10*3.5 = 35.0g P, 30*3.5 = 105.0g C, 10*3.5 = 35.0g F
    // Input calories: 4*35 + 4*105 + 9*35 = 140 + 420 + 315 = 875 kcal
    expect(elementText("[data-input-macro-protein]")).toBe("35.0 g");
    expect(elementText("[data-input-macro-carbohydrate]")).toBe("105.0 g");
    expect(elementText("[data-input-macro-fat]")).toBe("35.0 g");
    expect(elementText("[data-input-calories]")).toBe("875 kcal");

    // Candidate: 8g P, 24g C, 8g F per 100 g -> 200 kcal/100 g
    // Matched Quantity: (875 * 100) / 200 = 437.5 g -> 438 g
    expect(elementText("[data-result-card-matched-quantity]")).toBe("438 g");
    expect(elementText("[data-result-card-calories]")).toBe("875 kcal");

    const ddValues = Array.from(
      document.querySelectorAll("[data-result-card] dd"),
    ).map((element) => element.textContent);
    expect(ddValues).toEqual(["35.0 g", "105.0 g", "35.0 g", "99%"]);
  });

  test("whole-calorie boundary rounds exact half up (100.5 kcal -> 101 kcal)", async () => {
    const selected: SelectedFoodObject = {
      foodObjectId: 101,
      names: { en: "Test Food", pl: "Test Food" },
      quantity: { value: 100, unit: "g" },
      allowedQuantities: [{ unit: "g", maximumValue: 100000 }],
      capturedLanguage: "en",
    };

    // 4*12.625 + 4*12.5 + 0 = 50.5 + 50 = 100.5 kcal
    const response: SubstituteSearchResponse = {
      pageIndex: 0,
      totalEligibleCount: 1,
      hasMore: false,
      selectedFood: {
        foodObjectId: 101,
        names: { en: "Test Food", pl: "Test Food" },
        macroProfile: {
          protein: 12.625,
          carbohydrate: 12.5,
          fat: 0,
        },
        baseUnit: "g",
      },
      items: [
        {
          foodObjectId: 201,
          names: { en: "Candidate", pl: "Candidate" },
          macroProfile: { protein: 25, carbohydrate: 0, fat: 0 },
          baseUnit: "g",
          similarityPercent: 90,
        },
      ],
    };

    mockSubstituteResponse(response);
    interactionState.selectSuggestion(selected);
    render(App);
    await settle();

    expect(elementText("[data-input-calories]")).toBe("101 kcal");
  });

  test("whole-calorie boundary rounds below half down (100.4 kcal -> 100 kcal)", async () => {
    const selected: SelectedFoodObject = {
      foodObjectId: 102,
      names: { en: "Test Food", pl: "Test Food" },
      quantity: { value: 100, unit: "g" },
      allowedQuantities: [{ unit: "g", maximumValue: 100000 }],
      capturedLanguage: "en",
    };

    // 4*12.5 + 4*12.5 + 9*(0.4/9) = 50 + 50 + 0.4 = 100.4 kcal
    const response: SubstituteSearchResponse = {
      pageIndex: 0,
      totalEligibleCount: 1,
      hasMore: false,
      selectedFood: {
        foodObjectId: 102,
        names: { en: "Test Food", pl: "Test Food" },
        macroProfile: {
          protein: 12.5,
          carbohydrate: 12.5,
          fat: 0.04444444444444444,
        },
        baseUnit: "g",
      },
      items: [
        {
          foodObjectId: 202,
          names: { en: "Candidate", pl: "Candidate" },
          macroProfile: { protein: 25, carbohydrate: 0, fat: 0 },
          baseUnit: "g",
          similarityPercent: 90,
        },
      ],
    };

    mockSubstituteResponse(response);
    interactionState.selectSuggestion(selected);
    render(App);
    await settle();

    expect(elementText("[data-input-calories]")).toBe("100 kcal");
  });

  test("whole-quantity boundary rounds exact half up (150.5 g -> 151 g)", async () => {
    const selected: SelectedFoodObject = {
      foodObjectId: 103,
      names: { en: "Test Food", pl: "Test Food" },
      quantity: { value: 100, unit: "g" },
      allowedQuantities: [{ unit: "g", maximumValue: 100000 }],
      capturedLanguage: "en",
    };

    // Input: 150.5 kcal. Candidate: 100 kcal / 100 g -> Matched Quantity = 150.5 g -> 151 g
    const response: SubstituteSearchResponse = {
      pageIndex: 0,
      totalEligibleCount: 1,
      hasMore: false,
      selectedFood: {
        foodObjectId: 103,
        names: { en: "Test Food", pl: "Test Food" },
        macroProfile: { protein: 20, carbohydrate: 10, fat: 3.388888888888889 },
        baseUnit: "g",
      },
      items: [
        {
          foodObjectId: 203,
          names: { en: "Candidate", pl: "Candidate" },
          macroProfile: { protein: 25, carbohydrate: 0, fat: 0 },
          baseUnit: "g",
          similarityPercent: 90,
        },
      ],
    };

    mockSubstituteResponse(response);
    interactionState.selectSuggestion(selected);
    render(App);
    await settle();

    expect(elementText("[data-result-card-matched-quantity]")).toBe("151 g");
  });

  test("whole-quantity boundary rounds below half down (150.4 g -> 150 g)", async () => {
    const selected: SelectedFoodObject = {
      foodObjectId: 104,
      names: { en: "Test Food", pl: "Test Food" },
      quantity: { value: 100, unit: "g" },
      allowedQuantities: [{ unit: "g", maximumValue: 100000 }],
      capturedLanguage: "en",
    };

    // Input: 150.4 kcal. Candidate: 100 kcal / 100 g -> Matched Quantity = 150.4 g -> 150 g
    const response: SubstituteSearchResponse = {
      pageIndex: 0,
      totalEligibleCount: 1,
      hasMore: false,
      selectedFood: {
        foodObjectId: 104,
        names: { en: "Test Food", pl: "Test Food" },
        macroProfile: {
          protein: 20,
          carbohydrate: 10,
          fat: 3.3777777777777778,
        },
        baseUnit: "g",
      },
      items: [
        {
          foodObjectId: 204,
          names: { en: "Candidate", pl: "Candidate" },
          macroProfile: { protein: 25, carbohydrate: 0, fat: 0 },
          baseUnit: "g",
          similarityPercent: 90,
        },
      ],
    };

    mockSubstituteResponse(response);
    interactionState.selectSuggestion(selected);
    render(App);
    await settle();

    expect(elementText("[data-result-card-matched-quantity]")).toBe("150 g");
  });

  test("0.1 g macronutrient boundary rounds exact .05 g up (12.05 g -> 12.1 g)", async () => {
    const selected: SelectedFoodObject = {
      foodObjectId: 105,
      names: { en: "Test Food", pl: "Test Food" },
      quantity: { value: 100, unit: "g" },
      allowedQuantities: [{ unit: "g", maximumValue: 100000 }],
      capturedLanguage: "en",
    };

    // Candidate with 12.05 g protein out of 100 kcal / 100 g: rounds up to 12.1 g
    const response: SubstituteSearchResponse = {
      pageIndex: 0,
      totalEligibleCount: 1,
      hasMore: false,
      selectedFood: {
        foodObjectId: 105,
        names: { en: "Test Food", pl: "Test Food" },
        macroProfile: { protein: 25, carbohydrate: 0, fat: 0 },
        baseUnit: "g",
      },
      items: [
        {
          foodObjectId: 205,
          names: { en: "Candidate", pl: "Candidate" },
          macroProfile: { protein: 12.05, carbohydrate: 12.95, fat: 0 },
          baseUnit: "g",
          similarityPercent: 90,
        },
      ],
    };

    mockSubstituteResponse(response);
    interactionState.selectSuggestion(selected);
    render(App);
    await settle();

    const ddValues = Array.from(
      document.querySelectorAll("[data-result-card] dd"),
    ).map((element) => element.textContent);
    expect(ddValues[0]).toBe("12.1 g");
  });

  test("0.1 g macronutrient boundary rounds below .05 g down (12.04 g -> 12.0 g)", async () => {
    const selected: SelectedFoodObject = {
      foodObjectId: 106,
      names: { en: "Test Food", pl: "Test Food" },
      quantity: { value: 100, unit: "g" },
      allowedQuantities: [{ unit: "g", maximumValue: 100000 }],
      capturedLanguage: "en",
    };

    // Candidate with 12.04 g protein out of 100 kcal / 100 g: rounds down to 12.0 g
    const response: SubstituteSearchResponse = {
      pageIndex: 0,
      totalEligibleCount: 1,
      hasMore: false,
      selectedFood: {
        foodObjectId: 106,
        names: { en: "Test Food", pl: "Test Food" },
        macroProfile: { protein: 25, carbohydrate: 0, fat: 0 },
        baseUnit: "g",
      },
      items: [
        {
          foodObjectId: 206,
          names: { en: "Candidate", pl: "Candidate" },
          macroProfile: { protein: 12.04, carbohydrate: 12.96, fat: 0 },
          baseUnit: "g",
          similarityPercent: 90,
        },
      ],
    };

    mockSubstituteResponse(response);
    interactionState.selectSuggestion(selected);
    render(App);
    await settle();

    const ddValues = Array.from(
      document.querySelectorAll("[data-result-card] dd"),
    ).map((element) => element.textContent);
    expect(ddValues[0]).toBe("12.0 g");
  });

  test("a fixture that fails under early rounding confirms full calculation precision", async () => {
    // Selected: Chicken breast (150 g serving, 31g P, 0g C, 3.6g F per 100g)
    // 1 serving -> 150g -> 46.5g P, 0g C, 5.4g F -> 234.6 kcal
    // Candidate (Protein shake): 8g P, 4g C, 1g F per 100 ml -> 57 kcal / 100 ml
    // Full-precision Matched Quantity: (234.6 * 100) / 57 = 411.5789... ml (display rounds to 412 ml)
    // Full-precision candidate protein: 8 * 411.5789... / 100 = 32.926... g -> rounds to 32.9 g
    // Early rounded Matched Quantity (412 ml): 8 * 412 / 100 = 32.96 g -> rounds to 33.0 g (FAILS if rounded early)
    const selected: SelectedFoodObject = {
      foodObjectId: 5,
      names: { en: "Chicken breast", pl: "Pierś z kurczaka" },
      quantity: { value: 1, unit: "serving" },
      allowedQuantities: [
        { unit: "serving", maximumValue: 666 },
        { unit: "g", maximumValue: 100000 },
      ],
      capturedLanguage: "en",
    };

    const response: SubstituteSearchResponse = {
      pageIndex: 0,
      totalEligibleCount: 1,
      hasMore: false,
      selectedFood: {
        foodObjectId: 5,
        names: { en: "Chicken breast", pl: "Pierś z kurczaka" },
        macroProfile: { protein: 31, carbohydrate: 0, fat: 3.6 },
        baseUnit: "g",
        serving: 150,
      },
      items: [
        {
          foodObjectId: 20,
          names: { en: "Protein shake", pl: "Shake białkowy" },
          macroProfile: { protein: 8, carbohydrate: 4, fat: 1 },
          baseUnit: "ml",
          similarityPercent: 85,
        },
      ],
    };

    mockSubstituteResponse(response);
    interactionState.selectSuggestion(selected);
    render(App);
    await settle();

    expect(elementText("[data-input-calories]")).toBe("235 kcal");
    expect(elementText("[data-result-card-matched-quantity]")).toBe("412 ml");
    expect(elementText("[data-result-card-calories]")).toBe("235 kcal");

    const ddValues = Array.from(
      document.querySelectorAll("[data-result-card] dd"),
    ).map((element) => element.textContent);
    // Under full precision, protein is 32.9 g, not 33.0 g!
    expect(ddValues[0]).toBe("32.9 g");
    expect(ddValues[1]).toBe("16.5 g");
    expect(ddValues[2]).toBe("4.1 g");
    expect(ddValues[3]).toBe("85%");
  });

  test("equal-calorie exact-half boundary fixture proves candidate card calories match input calories under half-up display rounding", async () => {
    // Selected: 25.125g protein, 0g carb, 0g fat per 100g -> 4 * 25.125 = 100.5 kcal -> 101 kcal
    // Candidate: 0g protein, 0g carb, 12.5g fat per 100g -> 112.5 kcal / 100g
    // Unrounded matched quantity: (100.5 * 100) / 112.5 = 89.333333... g
    // Candidate calories must match the exact equal-calorie input basis (100.5 kcal -> 101 kcal)
    const selected: SelectedFoodObject = {
      foodObjectId: 107,
      names: { en: "Selected Half-Boundary", pl: "Wybrany Produkt" },
      quantity: { value: 100, unit: "g" },
      allowedQuantities: [{ unit: "g", maximumValue: 100000 }],
      capturedLanguage: "en",
    };

    const response: SubstituteSearchResponse = {
      pageIndex: 0,
      totalEligibleCount: 1,
      hasMore: false,
      selectedFood: {
        foodObjectId: 107,
        names: { en: "Selected Half-Boundary", pl: "Wybrany Produkt" },
        macroProfile: { protein: 25.125, carbohydrate: 0, fat: 0 },
        baseUnit: "g",
      },
      items: [
        {
          foodObjectId: 207,
          names: { en: "Candidate Half-Boundary", pl: "Zamiennik" },
          macroProfile: { protein: 0, carbohydrate: 0, fat: 12.5 },
          baseUnit: "g",
          similarityPercent: 90,
        },
      ],
    };

    mockSubstituteResponse(response);
    interactionState.selectSuggestion(selected);
    render(App);
    await settle();

    expect(elementText("[data-input-calories]")).toBe("101 kcal");
    expect(elementText("[data-result-card-calories]")).toBe("101 kcal");
    expect(elementText("[data-result-card-matched-quantity]")).toBe("89 g");

    const ddValues = Array.from(
      document.querySelectorAll("[data-result-card] dd"),
    ).map((element) => element.textContent);
    expect(ddValues[0]).toBe("0.0 g");
    expect(ddValues[1]).toBe("0.0 g");
    expect(ddValues[2]).toBe("11.2 g");
    expect(ddValues[3]).toBe("90%");
  });

  test("varied-ratio exact 150.5 g matched quantity half-up boundary rounds to 151 g", async () => {
    // Selected: 2.8595g protein, 0g carb, 0g fat per 100g -> 11.438 kcal
    // Candidate: 0.1g protein, 0g carb, 0.8g fat per 100g -> 7.6 kcal/100g
    // Mathematical matched quantity: (11.438 * 100) / 7.6 = 150.5 g -> 151 g
    const selected: SelectedFoodObject = {
      foodObjectId: 108,
      names: { en: "Selected 150.5g Basis", pl: "Wybrany Produkt" },
      quantity: { value: 100, unit: "g" },
      allowedQuantities: [{ unit: "g", maximumValue: 100000 }],
      capturedLanguage: "en",
    };

    const response: SubstituteSearchResponse = {
      pageIndex: 0,
      totalEligibleCount: 1,
      hasMore: false,
      selectedFood: {
        foodObjectId: 108,
        names: { en: "Selected 150.5g Basis", pl: "Wybrany Produkt" },
        macroProfile: { protein: 2.8595, carbohydrate: 0, fat: 0 },
        baseUnit: "g",
      },
      items: [
        {
          foodObjectId: 208,
          names: { en: "Candidate 150.5g", pl: "Zamiennik" },
          macroProfile: { protein: 0.1, carbohydrate: 0, fat: 0.8 },
          baseUnit: "g",
          similarityPercent: 90,
        },
      ],
    };

    mockSubstituteResponse(response);
    interactionState.selectSuggestion(selected);
    render(App);
    await settle();

    expect(elementText("[data-input-calories]")).toBe("11 kcal");
    expect(elementText("[data-result-card-calories]")).toBe("11 kcal");
    expect(elementText("[data-result-card-matched-quantity]")).toBe("151 g");
  });

  test("varied-ratio exact 12.05 g candidate macro half-up boundary rounds to 12.1 g", async () => {
    // Selected: 60.25g protein per 100g -> 241 kcal
    // Candidate: 10g protein, 40g carb per 100g -> 200 kcal/100g
    // Mathematical matched quantity: 241 * 100 / 200 = 120.5 g -> 121 g
    // Candidate protein: 10 * 120.5 / 100 = 12.05 g -> 12.1 g
    const selected: SelectedFoodObject = {
      foodObjectId: 109,
      names: { en: "Selected 12.05g Basis", pl: "Wybrany Produkt" },
      quantity: { value: 100, unit: "g" },
      allowedQuantities: [{ unit: "g", maximumValue: 100000 }],
      capturedLanguage: "en",
    };

    const response: SubstituteSearchResponse = {
      pageIndex: 0,
      totalEligibleCount: 1,
      hasMore: false,
      selectedFood: {
        foodObjectId: 109,
        names: { en: "Selected 12.05g Basis", pl: "Wybrany Produkt" },
        macroProfile: { protein: 60.25, carbohydrate: 0, fat: 0 },
        baseUnit: "g",
      },
      items: [
        {
          foodObjectId: 209,
          names: { en: "Candidate 12.05g", pl: "Zamiennik" },
          macroProfile: { protein: 10, carbohydrate: 40, fat: 0 },
          baseUnit: "g",
          similarityPercent: 90,
        },
      ],
    };

    mockSubstituteResponse(response);
    interactionState.selectSuggestion(selected);
    render(App);
    await settle();

    expect(elementText("[data-result-card-matched-quantity]")).toBe("121 g");
    const ddValues = Array.from(
      document.querySelectorAll("[data-result-card] dd"),
    ).map((element) => element.textContent);
    expect(ddValues[0]).toBe("12.1 g");
  });

  test("genuine below-half matched quantity (selected P=37.62499999999997, candidate P=25) renders 150 g not 151 g", async () => {
    // Selected: 37.62499999999997g protein per 100g -> 150.49999999999988 kcal
    // Candidate: 25g protein per 100g -> 100 kcal/100g
    // Mathematical matched quantity: 150.49999999999988 g (< 150.5 g) -> MUST render 150 g
    const selected: SelectedFoodObject = {
      foodObjectId: 110,
      names: { en: "Selected 37.62499999999997g", pl: "Wybrany Produkt" },
      quantity: { value: 100, unit: "g" },
      allowedQuantities: [{ unit: "g", maximumValue: 100000 }],
      capturedLanguage: "en",
    };

    const response: SubstituteSearchResponse = {
      pageIndex: 0,
      totalEligibleCount: 1,
      hasMore: false,
      selectedFood: {
        foodObjectId: 110,
        names: { en: "Selected 37.62499999999997g", pl: "Wybrany Produkt" },
        macroProfile: { protein: 37.62499999999997, carbohydrate: 0, fat: 0 },
        baseUnit: "g",
      },
      items: [
        {
          foodObjectId: 210,
          names: { en: "Candidate 25g", pl: "Zamiennik" },
          macroProfile: { protein: 25, carbohydrate: 0, fat: 0 },
          baseUnit: "g",
          similarityPercent: 90,
        },
      ],
    };

    mockSubstituteResponse(response);
    interactionState.selectSuggestion(selected);
    render(App);
    await settle();

    expect(elementText("[data-result-card-matched-quantity]")).toBe("150 g");
  });

  test("genuine below-half candidate macro (12.049999999999995 g) renders 12.0 g", async () => {
    // Selected: 25g protein per 100g -> 100 kcal
    // Candidate: 12.049999999999995g protein, 12.950000000000005g carb -> 100 kcal/100g
    // Matched quantity: 100 g
    // Candidate protein: 12.049999999999995 g (< 12.05 g) -> MUST render 12.0 g
    const selected: SelectedFoodObject = {
      foodObjectId: 111,
      names: { en: "Selected 100 kcal", pl: "Wybrany Produkt" },
      quantity: { value: 100, unit: "g" },
      allowedQuantities: [{ unit: "g", maximumValue: 100000 }],
      capturedLanguage: "en",
    };

    const response: SubstituteSearchResponse = {
      pageIndex: 0,
      totalEligibleCount: 1,
      hasMore: false,
      selectedFood: {
        foodObjectId: 111,
        names: { en: "Selected 100 kcal", pl: "Wybrany Produkt" },
        macroProfile: { protein: 25, carbohydrate: 0, fat: 0 },
        baseUnit: "g",
      },
      items: [
        {
          foodObjectId: 211,
          names: { en: "Candidate 12.049999999999995g", pl: "Zamiennik" },
          macroProfile: {
            protein: 12.049999999999995,
            carbohydrate: 12.950000000000005,
            fat: 0,
          },
          baseUnit: "g",
          similarityPercent: 90,
        },
      ],
    };

    mockSubstituteResponse(response);
    interactionState.selectSuggestion(selected);
    render(App);
    await settle();

    const ddValues = Array.from(
      document.querySelectorAll("[data-result-card] dd"),
    ).map((element) => element.textContent);
    expect(ddValues[0]).toBe("12.0 g");
  });
});
