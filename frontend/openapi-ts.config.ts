import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "../api/openapi.yaml",
  output: "src/client",
  plugins: ["@hey-api/client-fetch", "@hey-api/typescript"],
});
