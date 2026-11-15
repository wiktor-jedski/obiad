import { existsSync, writeFileSync } from "node:fs";

const generatedMap = new URL(
  "../src/lib/assets/generated-meal-images.ts",
  import.meta.url,
);

if (!existsSync(generatedMap)) {
  writeFileSync(
    generatedMap,
    "/** Maps catalog image keys to bundled meal images. */\n" +
      "export const mealImages: ReadonlyMap<string, string> = new Map();\n",
    { flag: "wx" },
  );
}
