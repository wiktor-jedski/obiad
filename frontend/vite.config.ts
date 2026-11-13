import "./tools/prepare-meal-images.ts";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const fiberTarget = "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  server: {
    fs: {
      allow: [
        fileURLToPath(new URL(".", import.meta.url)),
        fileURLToPath(new URL("../data/images", import.meta.url)),
      ],
    },
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
