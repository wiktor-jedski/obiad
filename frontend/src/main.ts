import { mount } from "svelte";
import "./app.css";

import "./lib/interfaceLanguage";
import App from "./App.svelte";
import { readSearchReturn } from "./lib/searchReturn";
import { interactionState } from "./lib/interactionState";
import { restoreSubstitutionPage } from "./lib/substitutionSearch";

const restored = readSearchReturn();
if (restored) {
  interactionState.restore(restored.interaction);
  restoreSubstitutionPage(restored.pages[restored.interaction.pageIndex]);
}

mount(App, {
  target: document.getElementById("app")!,
  props: { restored },
});
