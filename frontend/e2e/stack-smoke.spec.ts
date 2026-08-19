import { expect, test } from '@playwright/test';
import { client } from '../src/client/client.gen';
import type { FoodSuggestionsResponse } from '../src/client/types.gen';

/**
 * Real-stack smoke scenario (task 22; ARCH-008, ARCH-016, ARCH-022).
 *
 * `bun run test:e2e` runs these tests against the complete disposable stack
 * started by `./e2e/launcher.ts`: disposable PostgreSQL 17 seeded by the
 * real setup command, the real Fiber process on the fixed loopback listener
 * 127.0.0.1:8080, and the optimized Vite preview on the strict port 4173.
 * The generated TypeScript client is configured with the preview origin, so
 * every request it makes crosses the same-origin `/api` proxy and never
 * talks to Fiber directly. The browser test asserts that the page only ever
 * contacts its own origin (no direct browser-to-Fiber or third-party
 * runtime request).
 */

const PREVIEW_ORIGIN = 'http://127.0.0.1:4173';
const FIBER_ORIGIN = 'http://127.0.0.1:8080';

test.describe('real-stack smoke', () => {
  test('the generated client receives the five-item seeded response through the preview /api proxy', async () => {
    client.setConfig({ baseUrl: PREVIEW_ORIGIN });
    const suggestions = await client.get<FoodSuggestionsResponse>({
      url: '/api/v1/food-suggestions',
      query: { query: 'chicken', language: 'en' },
      throwOnError: true,
      responseStyle: 'data',
    });

    // ARCH-004: exactly five distinct suggestions for any nonempty query.
    expect(suggestions.items).toHaveLength(5);
    for (const item of suggestions.items) {
      expect(item.foodObjectId).toBeGreaterThanOrEqual(1);
      expect(item.names.en.length).toBeGreaterThan(0);
      expect(item.names.pl.length).toBeGreaterThan(0);
      expect(['g', 'ml', 'serving']).toContain(item.defaultQuantity.unit);
    }

    // The deterministic seeded catalog ranks these five Food Objects first
    // for the English query "chicken" (verified against the real Fiber
    // process): Milk (10), Pancakes (26), Butter (18), Cheesecake (36), and
    // Pho (30). Milk is a liquid without a Serving, so its derived default
    // quantity is 100 ml (ARCH-004).
    expect(suggestions.items.map((item) => item.foodObjectId)).toEqual([10, 26, 18, 36, 30]);
    expect(suggestions.items[0].defaultQuantity).toEqual({ value: 100, unit: 'ml' });
  });

  test('the browser makes no direct Fiber or third-party runtime request', async ({ page }) => {
    const requestOrigins = new Set<string>();
    page.on('request', (request) => requestOrigins.add(new URL(request.url()).origin));

    await page.goto('/');
    await expect(page).toHaveTitle('Obiad');

    // The shell loads through the preview origin only; no request may reach
    // the Fiber listener directly or any third-party host.
    expect(requestOrigins.size).toBeGreaterThan(0);
    expect(requestOrigins.has(FIBER_ORIGIN)).toBe(false);
    for (const origin of requestOrigins) {
      expect(origin, `unexpected request origin ${origin}`).toBe(PREVIEW_ORIGIN);
    }
  });
});
