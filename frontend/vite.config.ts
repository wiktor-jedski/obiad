import "./tools/prepare-meal-images.ts";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const fiberTarget = "http://127.0.0.1:8080";
const recipeAssets = process.env.OBIAD_RECIPE_ASSETS;
const publicDir = recipeAssets ? resolve(recipeAssets, "public") : "public";

export default defineConfig({
  publicDir,
  define: {
    "import.meta.env.OBIAD_RECIPE_INDEX": recipeAssets
      ? readFileSync(resolve(recipeAssets, "index.json"), "utf8")
      : "[]",
  },
  plugins: [svelte(), tailwindcss()],
  server: {
    fs: {
      allow: [
        fileURLToPath(new URL(".", import.meta.url)),
        fileURLToPath(new URL("../data/images", import.meta.url)),
        resolve(publicDir),
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
