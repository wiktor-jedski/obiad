import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Real-stack presentation-assets scenario (task 23; ARCH-001, ARCH-015,
 * ARCH-020, ARCH-022; ISSUE-006 presentation contract).
 *
 * `bun run test:e2e` runs this file against the complete disposable stack
 * started by `./e2e/launcher.ts`: the optimized Vite preview on the strict
 * port 4173 proxies same-origin `/api` to the real Fiber process. This
 * scenario loads the optimized shell and proves the presentation contract
 * without rendering a card:
 *
 *   - the exact ISSUE-006 computed palette tokens
 *     (`--color-dark-*` from `docs/requirements/style.md`) plus the
 *     `Inter, system-ui, sans-serif` and `Roboto Mono, ui-monospace,
 *     monospace` fallback chains, applied to the body and resolvable
 *     through the tokens;
 *   - the two system-local `@font-face` rules (Inter `100 900`, Roboto
 *     Mono `100 700`) with no bundled font;
 *   - that the browser makes no runtime font request and no third-party
 *     asset request (every request stays on the preview origin);
 *   - that the placeholder exposed to later cards is served from the Vite
 *     origin and decodes as a `512×512` PNG in the browser; and
 *   - that the committed `food-placeholder.png` is byte-exact with the
 *     ISSUE-006 pin: `512×512`, 8-bit true-color sRGB with optional alpha,
 *     no localized-text chunks, and no unnecessary metadata chunks.
 */

const PREVIEW_ORIGIN = 'http://127.0.0.1:4173';

/** ISSUE-006: the accepted committed placeholder's pinned SHA-256. */
const PLACEHOLDER_SHA256 = '741ef3e3a323cc1b47c466aba947aee59cb03790f7ffee754470fbbc64c24b95';

/** The exact palette from `docs/requirements/style.md`, token -> hex. */
const PALETTE: Record<string, string> = {
  '--color-dark-background': '#0a0f0a',
  '--color-dark-surface': '#161d16',
  '--color-dark-primary': '#4ade80',
  '--color-dark-secondary': '#86efac',
  '--color-dark-accent': '#ffb86c',
  '--color-dark-error': '#f87171',
  '--color-dark-text-primary': '#f3f4f6',
  '--color-dark-text-muted': '#9ca3af',
  '--color-dark-text-on-bright': '#0a0f0a',
};

/** ISSUE-006 font chains as authored in `@theme` (raw custom-property values). */
const UI_FONT_CHAIN = '"Inter", system-ui, sans-serif';
const DATA_FONT_CHAIN = '"Roboto Mono", ui-monospace, monospace';

/** The same chains as serialized by `getComputedStyle`. */
const UI_FONT_COMPUTED = 'Inter, system-ui, sans-serif';
const DATA_FONT_COMPUTED = '"Roboto Mono", ui-monospace, monospace';

/** The committed placeholder file (also emitted into the optimized build). */
const PLACEHOLDER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'lib',
  'assets',
  'food-placeholder.png',
);

/** One parsed PNG chunk. */
interface PngChunk {
  type: string;
  data: Buffer;
}

/** Walks a PNG byte stream into its signature and chunks. */
function parsePng(buffer: Buffer): { signature: Buffer; chunks: PngChunk[] } {
  const signature = buffer.subarray(0, 8);
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
  }
  return { signature, chunks };
}

test.describe('presentation assets', () => {
  test('the computed palette and Inter/Roboto Mono chains are exact, with no runtime font request', async ({
    page,
  }) => {
    const requests: { url: string; resourceType: string }[] = [];
    page.on('request', (request) => requests.push({ url: request.url(), resourceType: request.resourceType() }));

    await page.goto('/');
    await expect(page).toHaveTitle('Obiad');

    // Let any post-load font or asset request surface before asserting
    // request silence.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);

    const observed = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const body = getComputedStyle(document.body);

      // Resolve the data chain through its token, mirroring how a future
      // `font-data` utility would apply it.
      const dataProbe = document.createElement('span');
      dataProbe.style.fontFamily = 'var(--font-data)';
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
              family: rule.style.getPropertyValue('font-family'),
              weight: rule.style.getPropertyValue('font-weight'),
              style: rule.style.getPropertyValue('font-style'),
              src: rule.style.getPropertyValue('src'),
              display: rule.style.getPropertyValue('font-display'),
            });
          }
        }
      }

      const vars: Record<string, string> = {};
      for (const name of [
        '--font-ui',
        '--font-data',
        '--color-dark-background',
        '--color-dark-surface',
        '--color-dark-primary',
        '--color-dark-secondary',
        '--color-dark-accent',
        '--color-dark-error',
        '--color-dark-text-primary',
        '--color-dark-text-muted',
        '--color-dark-text-on-bright',
      ]) {
        vars[name] = root.getPropertyValue(name);
      }

      return { bodyFontFamily: body.fontFamily, dataProbeFamily, faces, vars };
    });

    // Exact computed palette (docs/requirements/style.md, ISSUE-006).
    for (const [token, hex] of Object.entries(PALETTE)) {
      expect(observed.vars[token], `token ${token}`).toBe(hex);
    }

    // Exact fallback chains, both as authored tokens and as computed styles.
    expect(observed.vars['--font-ui']).toBe(UI_FONT_CHAIN);
    expect(observed.vars['--font-data']).toBe(DATA_FONT_CHAIN);
    expect(observed.bodyFontFamily).toBe(UI_FONT_COMPUTED);
    expect(observed.dataProbeFamily).toBe(DATA_FONT_COMPUTED);

    // Exactly the two system-local @font-face rules (ISSUE-006, ARCH-015).
    expect(observed.faces).toEqual([
      {
        family: 'Inter',
        weight: '100 900',
        style: 'normal',
        src: 'local("Inter")',
        display: 'swap',
      },
      {
        family: '"Roboto Mono"',
        weight: '100 700',
        style: 'normal',
        src: 'local("Roboto Mono")',
        display: 'swap',
      },
    ]);

    // No runtime font request and no third-party asset request: every
    // request stays on the preview origin and none carries a font resource
    // type or font file extension (ARCH-015, ISSUE-006).
    expect(requests.some((request) => request.resourceType === 'font')).toBe(false);
    for (const request of requests) {
      expect(request.url, `unexpected request ${request.url}`).not.toMatch(/\.(woff2?|ttf|otf|eot)(\?|#|$)/i);
      expect(new URL(request.url).origin, `unexpected request origin ${request.url}`).toBe(PREVIEW_ORIGIN);
    }
  });

  test('the bundled placeholder is exposed from the Vite origin and decodes as a 512×512 PNG', async ({ page }) => {
    const requestUrls: string[] = [];
    page.on('request', (request) => requestUrls.push(request.url()));

    await page.goto('/');

    // Task 23 exposes the resolved bundled placeholder URL on the root
    // element; later cards consume the same URL through `src/lib/assets`.
    const placeholderUrl = await page.locator('main').getAttribute('data-placeholder-url');
    expect(placeholderUrl).toBeTruthy();
    const absoluteUrl = new URL(placeholderUrl as string, PREVIEW_ORIGIN);
    expect(absoluteUrl.origin).toBe(PREVIEW_ORIGIN);

    const decoded = await page.evaluate(async (target: string) => {
      const response = await fetch(target);
      const contentType = response.headers.get('content-type');
      const bytes = new Uint8Array(await response.arrayBuffer());
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      return {
        status: response.status,
        contentType,
        width: bitmap.width,
        height: bitmap.height,
        signature: Array.from(bytes.subarray(0, 8)),
      };
    }, absoluteUrl.href);

    expect(decoded.status).toBe(200);
    expect(decoded.contentType).toBe('image/png');
    expect(decoded.width).toBe(512);
    expect(decoded.height).toBe(512);
    expect(decoded.signature).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    // The placeholder fetch crossed no external runtime asset source.
    for (const url of requestUrls) {
      expect(new URL(url).origin, `unexpected request origin ${url}`).toBe(PREVIEW_ORIGIN);
    }
  });

  test('the committed food-placeholder.png is the byte-exact 512×512 lossless sRGB ISSUE-006 artifact', () => {
    const buffer = readFileSync(PLACEHOLDER_PATH);
    expect(createHash('sha256').update(buffer).digest('hex')).toBe(PLACEHOLDER_SHA256);

    const { signature, chunks } = parsePng(buffer);

    // PNG magic signature.
    expect(Array.from(signature)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    // IHDR: 512×512, 8-bit, true color with optional alpha (color types 2
    // and 6), default compression, filter, and no interlace.
    const ihdr = chunks[0];
    expect(ihdr.type).toBe('IHDR');
    expect(ihdr.data.readUInt32BE(0)).toBe(512);
    expect(ihdr.data.readUInt32BE(4)).toBe(512);
    expect(ihdr.data[8]).toBe(8);
    expect([2, 6]).toContain(ihdr.data[9]);
    expect(ihdr.data[10]).toBe(0);
    expect(ihdr.data[11]).toBe(0);
    expect(ihdr.data[12]).toBe(0);

    // No localized text (tEXt/iTXt/zTXt) and no unnecessary metadata
    // chunks: the whole file is IHDR + IDAT + IEND only.
    const types = chunks.map((chunk) => chunk.type);
    expect(types[0]).toBe('IHDR');
    expect(types[types.length - 1]).toBe('IEND');
    for (const type of types.slice(1, -1)) {
      expect(type).toBe('IDAT');
    }
    expect(types).not.toContain('tEXt');
    expect(types).not.toContain('iTXt');
    expect(types).not.toContain('zTXt');
    expect(types).not.toContain('tIME');
  });
});
