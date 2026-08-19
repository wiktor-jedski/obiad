import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

/**
 * Vite configuration for the client-only Obiad browser application (task 21).
 *
 * Svelte 5 compiles every `.svelte` component under `src` through the
 * official Vite plugin and Tailwind CSS 4 is wired through its Vite plugin.
 * The same-origin `/api`
 * proxy to the loopback Fiber listener is deliberately not configured here;
 * task 22 owns the development and preview proxy (ARCH-016).
 */
export default defineConfig({
  plugins: [svelte(), tailwindcss()],
});
