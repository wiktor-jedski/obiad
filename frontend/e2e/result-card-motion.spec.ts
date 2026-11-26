import { chooseLanguage } from "./header";
import { expect, test, type Page } from "@playwright/test";

interface DecodeControl {
  pending: number;
  release(): void;
}

declare global {
  interface Window {
    __presentationDecode?: DecodeControl;
    __presentationPaint?: {
      histories: { states: string[]; reversePainted: boolean }[];
      stop(): void;
    };
  }
}

async function gateImageDecode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "languages", { get: () => ["en-US"] });
    const original = HTMLImageElement.prototype.decode;
    const gate = Promise.withResolvers<void>();
    const control = { pending: 0, release: () => gate.resolve() };
    window.__presentationDecode = control;
    HTMLImageElement.prototype.decode = async function () {
      await original.call(this);
      control.pending += 1;
      await gate.promise;
    };
  });
}

async function selectPizza(page: Page): Promise<void> {
  await page
    .getByRole("combobox", { name: "Search", exact: true })
    .fill("margherita");
  await page.locator("#food-suggestion-option-1").click();
  await expect(page.locator("[data-result-card]")).toHaveCount(3);
}

test.describe("Result Card motion", () => {
  for (const width of [639, 640, 1280]) {
    test(`${width}px: selected and substitute cards wait for decoded images, then flip on the correct axis for 800 ms`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await gateImageDecode(page);
      await page.goto("/");
      await selectPizza(page);
      const reveals = page.locator("[data-card-reveal]");
      await expect(reveals).toHaveCount(4);
      await expect
        .poll(() =>
          page.evaluate(() => window.__presentationDecode?.pending ?? 0),
        )
        .toBeGreaterThanOrEqual(4);
      await expect(
        page.locator('[data-card-reveal-state="waiting"]'),
      ).toHaveCount(4);
      await expect(
        page.locator("[data-card-reveal] .loader, [data-card-spinner]"),
      ).toHaveCount(0);
      const quantity = page.locator("[data-nutrition-editor=quantity]");
      await quantity.evaluate((element) => {
        if (element instanceof HTMLElement) element.focus();
      });
      await expect(quantity).not.toBeFocused();
      for (const flip of await page.locator("[data-card-flip]").all()) {
        const diagonal = await flip.evaluate((element) => {
          const matrix = new DOMMatrixReadOnly(
            getComputedStyle(element).transform,
          );
          return { x: matrix.m11, y: matrix.m22, z: matrix.m33 };
        });
        expect(diagonal.x).toBeCloseTo(width >= 640 ? 1 : -1);
        expect(diagonal.y).toBeCloseTo(width >= 640 ? -1 : 1);
        expect(diagonal.z).toBeCloseTo(-1);
      }
      await page.evaluate(() => window.__presentationDecode?.release());
      await expect(
        page.locator('[data-card-reveal-state="revealing"]'),
      ).toHaveCount(4);
      for (const flip of await page.locator("[data-card-flip]").all()) {
        await expect(flip).toHaveCSS("transition-duration", "0.8s");
      }
      await expect(
        page.locator('[data-card-reveal-state="shown"]'),
      ).toHaveCount(4);
      await quantity.fill("2");
      await quantity.press("Enter");
      await expect(
        page.locator('[data-card-reveal-state="shown"]'),
      ).toHaveCount(4);
      await expect(
        page.locator('[data-card-reveal-state="revealing"]'),
      ).toHaveCount(0);
      await page.locator("[data-pagination-sentinel]").scrollIntoViewIfNeeded();
      await expect(page.locator("[data-result-card]")).toHaveCount(6);
      await expect(
        page.locator('[data-card-reveal-state="revealing"]'),
      ).toHaveCount(3);
      await expect(
        page.locator('[data-card-reveal-state="shown"]'),
      ).toHaveCount(7);
    });
  }

  test("reduced motion still waits for image readiness and reveals without a transform transition", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gateImageDecode(page);
    await page.goto("/");
    await selectPizza(page);
    await expect(
      page.locator('[data-card-reveal-state="waiting"]'),
    ).toHaveCount(4);
    await page.evaluate(() => window.__presentationDecode?.release());
    await expect(page.locator('[data-card-reveal-state="shown"]')).toHaveCount(
      4,
    );
    for (const flip of await page.locator("[data-card-flip]").all()) {
      await expect(flip).toHaveCSS("transition-duration", "0s");
    }
  });

  test("a failed primary image decodes the bundled placeholder and a failed placeholder reports image unavailability", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "languages", { get: () => ["en-US"] });
    });
    let placeholder = "";
    await page.route("**/*", async (route) => {
      if (
        route.request().resourceType() === "image" &&
        !route.request().url().includes("food-placeholder")
      ) {
        await route.abort();
      } else {
        await route.continue();
      }
    });
    await page.goto("/");
    placeholder =
      (await page.locator("main").getAttribute("data-placeholder-url")) ?? "";
    expect(placeholder).not.toBe("");
    await selectPizza(page);
    await expect(page.locator('[data-card-reveal-state="shown"]')).toHaveCount(
      4,
    );
    const images = page.locator(
      "[data-selected-food-summary] [data-result-card-image], [data-result-card] [data-result-card-image]",
    );
    for (const image of await images.all()) {
      await expect(image).toHaveAttribute("alt", /\S/);
      expect(
        await image.evaluate(
          (element) =>
            element instanceof HTMLImageElement &&
            element.complete &&
            element.naturalWidth > 0,
        ),
      ).toBe(true);
      await expect(image).toHaveAttribute("src", placeholder);
    }
    await page.unroute("**/*");
    await page.route("**/*", async (route) => {
      if (route.request().resourceType() === "image") await route.abort();
      else await route.continue();
    });
    await page.reload();
    await selectPizza(page);
    await expect(page.locator('[data-card-reveal-state="shown"]')).toHaveCount(
      4,
    );
    for (const card of await page
      .locator("[data-selected-food-summary], [data-result-card]")
      .all()) {
      await expect(card).toContainText("Image unavailable");
      await expect(card.locator("img")).toBeHidden();
    }
    await chooseLanguage(page, "pl");
    for (const card of await page
      .locator("[data-selected-food-summary], [data-result-card]")
      .all()) {
      await expect(card).toContainText("Obraz niedostępny");
    }
  });

  test("cached images paint the reverse before each fresh search reveal", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "languages", { get: () => ["en-US"] });
    });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    await selectPizza(page);
    await expect(page.locator('[data-card-reveal-state="shown"]')).toHaveCount(
      4,
    );
    await page.evaluate(() => {
      const oldCards = new WeakSet(
        document.querySelectorAll("[data-card-reveal]"),
      );
      const histories: { states: string[]; reversePainted: boolean }[] = [];
      const states = new Map<Element, (typeof histories)[number]>();
      let frame = 0;
      window.__presentationPaint = {
        histories,
        stop: () => cancelAnimationFrame(frame),
      };
      const sample = () => {
        // The loading-only reverse is transient, not one of the four food cards.
        for (const article of document.querySelectorAll(
          "[data-selected-food-summary], [data-result-card]",
        )) {
          const card = article.closest("[data-card-reveal]");
          if (!card || oldCards.has(card)) continue;
          let history = states.get(card);
          if (!history) {
            const flip = card.querySelector("[data-card-flip]")!;
            const matrix = new DOMMatrixReadOnly(
              getComputedStyle(flip).transform,
            );
            history = {
              states: [],
              reversePainted:
                Math.abs(matrix.m33 + 1) < 0.001 &&
                article.closest("[inert]") !== null,
            };
            states.set(card, history);
            histories.push(history);
          }
          history.states.push(
            card.getAttribute("data-card-reveal-state") ?? "",
          );
        }
        frame = requestAnimationFrame(sample);
      };
      frame = requestAnimationFrame(sample);
    });
    try {
      await selectPizza(page);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const histories = window.__presentationPaint!.histories;
            return (
              histories.length === 4 &&
              histories.every((history) => history.states.at(-1) === "shown")
            );
          }),
        )
        .toBe(true);
      const histories = await page.evaluate(
        () => window.__presentationPaint!.histories,
      );
      for (const history of histories) {
        expect(history.states[0]).toBe("waiting");
        expect(history.reversePainted).toBe(true);
        expect(history.states).toContain("revealing");
        expect(history.states.at(-1)).toBe("shown");
      }
    } finally {
      await page.evaluate(() => window.__presentationPaint?.stop());
    }
  });
});
