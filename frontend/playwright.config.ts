import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the client-only Obiad browser application.
 *
 * Task 21 pins the browser project and the optimized Vite preview base URL.
 * Task 22 owns the self-cleaning real-stack launcher behind `bun run
 * test:e2e` (`./e2e/launcher.ts`), the scenario files under `./e2e`, and the
 * pinned Chromium install (ISSUE-006 lifecycle contract). The base URL is
 * the strict-port optimized Vite preview the launcher starts on
 * 127.0.0.1:4173; the launcher never starts a dev server for these tests.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
