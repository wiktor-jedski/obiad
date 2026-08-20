import { mount } from "svelte";
import "./app.css";

// Initialize the persisted Interface Language store before the first
// application render (task 25; ARCH-012, ARCH-014, REQ-056, ISSUE-007).
// The store resolves at module load: an exact valid value from the
// `obiad.interfaceLanguage` localStorage key wins, otherwise
// `navigator.languages` is inspected in order with English as the default,
// and a browser-derived initial choice is never persisted. This import
// precedes the App import so the store value is settled before any
// component renders.
import "./lib/interfaceLanguage";
import App from "./App.svelte";

mount(App, {
  target: document.getElementById("app")!,
});
