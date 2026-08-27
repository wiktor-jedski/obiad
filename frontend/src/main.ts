import { mount } from "svelte";
import "./app.css";

import "./lib/interfaceLanguage";
import App from "./App.svelte";

mount(App, {
  target: document.getElementById("app")!,
});
