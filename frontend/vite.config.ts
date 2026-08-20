import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

/**
 * Vite configuration for the client-only Obiad browser application.
 *
 * Svelte 5 compiles every `.svelte` component under `src` through the
 * official Vite plugin and Tailwind CSS 4 is wired through its Vite plugin.
 * Both the development server and the preview server proxy same-origin
 * `/api` requests to the fixed loopback Fiber listener at `127.0.0.1:8080`
 * (task 22; ARCH-008, ARCH-016): the browser application always talks to its
 * own origin and never directly to Fiber, and the POC adds no CORS mechanism
 * (ARCH-016). The e2e launcher (`bun run test:e2e`) starts the real Fiber
 * process on this fixed listener before the preview starts.
 */

/** The fixed loopback Fiber listener that serves the `/api` routes (ARCH-016). */
const fiberTarget = "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  server: {
    proxy: {
      "/api": fiberTarget,
    },
  },
  preview: {
    proxy: {
      "/api": fiberTarget,
    },
  },
});
