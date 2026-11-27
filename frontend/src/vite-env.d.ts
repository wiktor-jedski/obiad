/// <reference types="vite/client" />

/** Values supplied by the frontend build. */
interface ImportMetaEnv {
  readonly VITE_DATA_COMMIT?: string;
  readonly OBIAD_RECIPE_INDEX?: readonly [
    number,
    import("./client/types.gen").LocalizedNames,
    string,
  ][];
}
