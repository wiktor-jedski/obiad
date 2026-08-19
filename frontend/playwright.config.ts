import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the client-only Obiad browser application.
 *
 * Task 21 pins the browser project and the optimized Vite preview base URL.
 * The self-cleaning real-stack launcher behind `bun run test:e2e`, its
 * scenario files under `./e2e`, and the pinned Chromium install are owned by
 * task 22 (ISSUE-006 lifecycle contract), so no `test:e2e` script exists yet.
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
