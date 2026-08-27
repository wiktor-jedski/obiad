import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

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
