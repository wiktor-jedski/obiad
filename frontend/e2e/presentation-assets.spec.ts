import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PREVIEW_ORIGIN = "http://127.0.0.1:4173";

const PLACEHOLDER_SHA256 =
  "741ef3e3a323cc1b47c466aba947aee59cb03790f7ffee754470fbbc64c24b95";

const PALETTE = {
  "--color-dark-background": "#0a0f0a",
  "--color-dark-surface": "#161d16",
  "--color-dark-primary": "#4ade80",
  "--color-dark-secondary": "#86efac",
  "--color-dark-accent": "#ffb86c",
  "--color-dark-error": "#f87171",
  "--color-dark-text-primary": "#f3f4f6",
  "--color-dark-text-muted": "#9ca3af",
  "--color-dark-text-on-bright": "#0a0f0a",
};

const UI_FONT_CHAIN = '"Inter", system-ui, sans-serif';
const DATA_FONT_CHAIN = '"Roboto Mono", ui-monospace, monospace';

const UI_FONT_COMPUTED = "Inter, system-ui, sans-serif";
const DATA_FONT_COMPUTED = '"Roboto Mono", ui-monospace, monospace';

const PLACEHOLDER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "lib",
  "assets",
  "food-placeholder.png",
);

interface PngChunk {
  type: string;
  data: Buffer;
}

interface ParsedPng {
  signature: Buffer;
  chunks: PngChunk[];
}

function parsePng(buffer: Buffer): ParsedPng {
  const signature = buffer.subarray(0, 8);
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
  }
  return { signature, chunks };
}

test.describe("presentation assets", () => {
  test("the computed palette and Inter/Roboto Mono chains are exact, with no runtime font request", async ({
    page,
  }) => {
    const requests: { url: string; resourceType: string }[] = [];
    page.on("request", (request) =>
      requests.push({
        url: request.url(),
        resourceType: request.resourceType(),
      }),
    );

    await page.goto("/");
    await expect(page).toHaveTitle("Obiad");

    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);

    const observed = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const body = getComputedStyle(document.body);

      const dataProbe = document.createElement("span");
      dataProbe.style.fontFamily = "var(--font-data)";
      document.body.appendChild(dataProbe);
      const dataProbeFamily = getComputedStyle(dataProbe).fontFamily;
      dataProbe.remove();

      const faces: Record<string, string>[] = [];
      for (const sheet of document.styleSheets) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of rules) {
          if (rule instanceof CSSFontFaceRule) {
            faces.push({
              family: rule.style.getPropertyValue("font-family"),
              weight: rule.style.getPropertyValue("font-weight"),
              style: rule.style.getPropertyValue("font-style"),
              src: rule.style.getPropertyValue("src"),
              display: rule.style.getPropertyValue("font-display"),
            });
          }
        }
      }

      const vars: Record<string, string> = {};
      for (const name of [
        "--font-ui",
        "--font-data",
        "--color-dark-background",
        "--color-dark-surface",
        "--color-dark-primary",
        "--color-dark-secondary",
        "--color-dark-accent",
        "--color-dark-error",
        "--color-dark-text-primary",
        "--color-dark-text-muted",
        "--color-dark-text-on-bright",
      ]) {
        vars[name] = root.getPropertyValue(name);
      }

      return { bodyFontFamily: body.fontFamily, dataProbeFamily, faces, vars };
    });

    for (const [token, hex] of Object.entries(PALETTE)) {
      expect(observed.vars[token], `token ${token}`).toBe(hex);
    }

    expect(observed.vars["--font-ui"]).toBe(UI_FONT_CHAIN);
    expect(observed.vars["--font-data"]).toBe(DATA_FONT_CHAIN);
    expect(observed.bodyFontFamily).toBe(UI_FONT_COMPUTED);
    expect(observed.dataProbeFamily).toBe(DATA_FONT_COMPUTED);

    expect(observed.faces).toEqual([
      {
        family: "Inter",
        weight: "100 900",
        style: "normal",
        src: 'local("Inter")',
        display: "swap",
      },
      {
        family: '"Roboto Mono"',
        weight: "100 700",
        style: "normal",
        src: 'local("Roboto Mono")',
        display: "swap",
      },
    ]);

    expect(requests.some((request) => request.resourceType === "font")).toBe(
      false,
    );
    for (const request of requests) {
      expect(request.url, `unexpected request ${request.url}`).not.toMatch(
        /\.(woff2?|ttf|otf|eot)(\?|#|$)/i,
      );
      expect(
        new URL(request.url).origin,
        `unexpected request origin ${request.url}`,
      ).toBe(PREVIEW_ORIGIN);
    }
  });

  test("the bundled placeholder is exposed from the Vite origin and decodes as a 512×512 PNG", async ({
    page,
  }) => {
    const requestUrls: string[] = [];
    page.on("request", (request) => requestUrls.push(request.url()));

    await page.goto("/");

    const placeholderUrl = await page
      .locator("main")
      .getAttribute("data-placeholder-url");
    if (placeholderUrl === null || placeholderUrl === "") {
      throw new Error("Application did not expose the bundled placeholder URL");
    }
    const absoluteUrl = new URL(placeholderUrl, PREVIEW_ORIGIN);
    expect(absoluteUrl.origin).toBe(PREVIEW_ORIGIN);

    const decoded = await page.evaluate(async (target: string) => {
      const response = await fetch(target);
      const contentType = response.headers.get("content-type");
      const bytes = new Uint8Array(await response.arrayBuffer());
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: "image/png" }),
      );
      return {
        status: response.status,
        contentType,
        width: bitmap.width,
        height: bitmap.height,
        signature: Array.from(bytes.subarray(0, 8)),
      };
    }, absoluteUrl.href);

    expect(decoded.status).toBe(200);
    expect(decoded.contentType).toBe("image/png");
    expect(decoded.width).toBe(512);
    expect(decoded.height).toBe(512);
    expect(decoded.signature).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    for (const url of requestUrls) {
      expect(new URL(url).origin, `unexpected request origin ${url}`).toBe(
        PREVIEW_ORIGIN,
      );
    }
  });

  test("the committed food-placeholder.png is the byte-exact 512×512 lossless sRGB ISSUE-006 artifact", () => {
    const buffer = readFileSync(PLACEHOLDER_PATH);
    expect(createHash("sha256").update(buffer).digest("hex")).toBe(
      PLACEHOLDER_SHA256,
    );

    const { signature, chunks } = parsePng(buffer);

    expect(Array.from(signature)).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    const ihdr = chunks[0];
    expect(ihdr.type).toBe("IHDR");
    expect(ihdr.data.readUInt32BE(0)).toBe(512);
    expect(ihdr.data.readUInt32BE(4)).toBe(512);
    expect(ihdr.data[8]).toBe(8);
    expect([2, 6]).toContain(ihdr.data[9]);
    expect(ihdr.data[10]).toBe(0);
    expect(ihdr.data[11]).toBe(0);
    expect(ihdr.data[12]).toBe(0);

    const types = chunks.map((chunk) => chunk.type);
    expect(types[0]).toBe("IHDR");
    expect(types[types.length - 1]).toBe("IEND");
    for (const type of types.slice(1, -1)) {
      expect(type).toBe("IDAT");
    }
    expect(types).not.toContain("tEXt");
    expect(types).not.toContain("iTXt");
    expect(types).not.toContain("zTXt");
    expect(types).not.toContain("tIME");
  });
});
