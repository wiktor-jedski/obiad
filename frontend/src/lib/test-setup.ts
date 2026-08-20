/**
 * Component-integration test setup (task 25; ISSUE-007).
 *
 * `bun test` runs component integration with the pinned `happy-dom` and
 * `@testing-library/svelte` packages (no generated-client or network call,
 * no backend or database). This file registers the happy-dom browser
 * globals and a Bun plugin that (1) redirects the resolved `svelte` entry —
 * which Bun's test runner resolves to the server build, because Svelte
 * exposes the client build only under the `browser` condition that Bun does
 * not enable — to the client build, and (2) compiles Svelte source through
 * the locked `svelte/compiler`: `compileModule` for runes modules
 * (`.svelte.js` and `.svelte.ts`, used by `@testing-library/svelte-core`)
 * and `compile` for `.svelte` components. Bun's test runner loads test
 * modules itself and does not invoke Vite's Svelte plugin. This file is
 * wired as the `[test] preload` entry in `bunfig.toml`, so it runs before
 * every test file.
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { plugin } from "bun";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { compile, compileModule } from "svelte/compiler";

GlobalRegistrator.register();

/**
 * The `svelte` package's `exports` map offers the client build only under
 * the `browser` condition, which Bun's test runner does not enable, so a
 * bare `svelte` import resolves to the server build. The component
 * integration tests render client components, so the resolved server entry
 * is replaced with the client build at load time. Bun does not consult
 * `onResolve` for this natively resolvable bare specifier, but it does fire
 * `onLoad` for the resolved entry path.
 */
function resolveSvelteClientEntry(): string {
  let dir = import.meta.dir;
  while (
    dir !== dirname(dir) &&
    !existsSync(join(dir, "node_modules", "svelte"))
  ) {
    dir = dirname(dir);
  }
  return join(dir, "node_modules", "svelte", "src", "index-client.js");
}

const svelteClientEntry = resolveSvelteClientEntry();
const svelteServerEntryFilter = /svelte[\\/]src[\\/]index-server\.js$/;

plugin({
  name: "obiad-component-test-svelte",
  setup(build) {
    build.onLoad({ filter: svelteServerEntryFilter }, () => ({
      contents: readFileSync(svelteClientEntry, "utf8"),
      loader: "js",
    }));
    build.onLoad({ filter: /\.svelte(?:\.(?:js|ts))?$/ }, async ({ path }) => {
      const source = await Bun.file(path).text();
      const commonOptions = {
        filename: path,
        generate: "client",
        css: "injected",
        discloseVersion: false,
      } as const;
      const { js } = path.endsWith(".svelte")
        ? compile(source, commonOptions)
        : compileModule(source, commonOptions);
      return { contents: js.code, loader: "js" };
    });
  },
});
