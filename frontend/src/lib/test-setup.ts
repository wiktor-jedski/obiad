import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { plugin } from "bun";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { compile, compileModule } from "svelte/compiler";

process.env.NODE_ENV = "test";
GlobalRegistrator.register();

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
