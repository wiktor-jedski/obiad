import { defineConfig } from "@hey-api/openapi-ts";

/**
 * Generates the TypeScript HTTP client (Fetch) and types from the
 * authoritative OpenAPI document at api/openapi.yaml (ARCH-008, ISSUE-004).
 *
 * Run with `bun run generate:api`. The generated client lives in
 * `src/client/` and is not committed; `bun run typecheck` compiles it.
 */
export default defineConfig({
  input: "../api/openapi.yaml",
  output: "src/client",
  plugins: ["@hey-api/client-fetch", "@hey-api/typescript"],
});
