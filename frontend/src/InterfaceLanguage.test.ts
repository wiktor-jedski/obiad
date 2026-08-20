/**
 * Interface Language control — happy-dom component integration scenario
 * (task 26; ARCH-001, ARCH-003, ARCH-012, ARCH-014, ARCH-020, ARCH-022,
 * REQ-057, ISSUE-006, ISSUE-007).
 *
 * `bun test` runs this file with the pinned `happy-dom` and
 * `@testing-library/svelte` packages. ISSUE-007 limits component
 * integration to the Interface Language store and the rendered App, Search,
 * and Interface Language components, with no generated-client or network
 * call and no backend or database. This scenario proves that the rendered
 * segmented pill exposes the localized named group, the fixed PL-then-EN
 * order, the exact copy, and the `aria-pressed` active state; that pointer
 * and keyboard activation immediately applies the corresponding typed
 * dictionary through the shared persisted store; that every selection makes
 * exactly one persistence attempt with the exact `pl` or `en` value; and
 * that a blocked persistence attempt keeps the selection active in memory
 * for the session without an error or cookie.
 *
 * happy-dom does not synthesize the browser's native keyboard activation of
 * a focused button (Enter on keydown, Space on keyup dispatches the
 * activation click), so the keyboard-activation assertions drive the same
 * event sequence a browser produces. Native keyboard activation in real
 * Chromium is observed by the real-stack scenario
 * `e2e/interface-language-selection.spec.ts` (`bun run test:e2e`), which
 * also owns reload persistence and viewport geometry (ARCH-022).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import App from "./App.svelte";
import {
  INTERFACE_LANGUAGE_STORAGE_KEY,
  interfaceLanguage,
} from "./lib/interfaceLanguage";

/** The exact ISSUE-007 copy of the two supported dictionaries. */
const COPY = {
  en: {
    label: "Search",
    placeholder: "Search foods",
    group: "Interface language",
  },
  pl: {
    label: "Szukaj",
    placeholder: "Szukaj potraw",
    group: "Język interfejsu",
  },
} as const;

/**
 * Replaces `window.localStorage.setItem` for the duration of one test and
 * returns the restore function. happy-dom's `Storage` is a Proxy whose
 * assignment trap ignores writes to prototype methods, so the replacement
 * uses `Object.defineProperty`; restoring re-defines the original bound
 * method the same way. The singleton persisted store captured
 * `window.localStorage` at module load, so replacing the same object's
 * method observes and intercepts every persistence attempt (ARCH-014).
 */
function installStorageSetItem(impl: Storage["setItem"]): () => void {
  const original = window.localStorage.setItem.bind(window.localStorage);
  Object.defineProperty(window.localStorage, "setItem", {
    value: impl,
    writable: true,
    configurable: true,
  });
  return () => {
    Object.defineProperty(window.localStorage, "setItem", {
      value: original,
      writable: true,
      configurable: true,
    });
  };
}

/**
 * Installs a recording `setItem` and returns the recorded calls plus the
 * restore function (ARCH-014: every selection attempts one exact write).
 */
function recordStorageWrites(): {
  calls: Array<[string, string]>;
  restore: () => void;
} {
  const calls: Array<[string, string]> = [];
  const restore = installStorageSetItem((key: string, value: string) => {
    calls.push([key, value]);
  });
  return { calls, restore };
}

/**
 * Installs a throwing `setItem` and returns the restore function
 * (ISSUE-007: a failed write leaves the selection active in memory).
 */
function failStorageWrites(): { restore: () => void } {
  return {
    restore: installStorageSetItem(() => {
      throw new Error("storage write denied");
    }),
  };
}

/**
 * Drives the keyboard activation sequence a browser produces for a focused
 * button: pressing Enter fires the activation click on keydown; pressing
 * Space fires it on keyup. happy-dom dispatches the events but does not
 * perform the default activation, so the click the browser would synthesize
 * is dispatched explicitly. Real native keyboard activation is verified by
 * the real-stack Playwright scenario.
 */
async function activateWithKeyboard(
  button: HTMLElement,
  key: "Enter" | " ",
): Promise<void> {
  button.focus();
  fireEvent.keyDown(button, { key });
  if (key === " ") {
    fireEvent.keyUp(button, { key });
  }
  fireEvent.click(button);
}

describe("the Interface Language control", () => {
  beforeEach(() => {
    // Make the shared store deterministic regardless of the happy-dom
    // defaults: English active and persisted before each rendered test.
    interfaceLanguage.set("en");
  });

  afterEach(() => {
    cleanup();
  });

  test("renders the localized named group with fixed PL-then-EN order and exact copy", async () => {
    render(App);

    // English: the named group and the exact English copy (ISSUE-007).
    const group = screen.getByRole("group", {
      name: COPY.en.group,
    });
    expect(group).toBeTruthy();
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toBe("PL");
    expect(buttons[1].textContent).toBe("EN");
    for (const button of buttons) {
      expect(button.getAttribute("type")).toBe("button");
    }

    // Polish: the same group renames and the buttons keep PL-then-EN order
    // with the language-code labels in both Interface Languages (ISSUE-007).
    interfaceLanguage.set("pl");
    await tick();
    expect(screen.getByRole("group", { name: COPY.pl.group })).toBeTruthy();
    expect(screen.queryByRole("group", { name: COPY.en.group })).toBeNull();
    const polishButtons = screen.getAllByRole("button");
    expect(polishButtons).toHaveLength(2);
    expect(polishButtons[0].textContent).toBe("PL");
    expect(polishButtons[1].textContent).toBe("EN");
  });

  test("exposes the aria-pressed active state from the shared store", async () => {
    render(App);
    const [pl, en] = screen.getAllByRole("button");
    expect(pl.getAttribute("aria-pressed")).toBe("false");
    expect(en.getAttribute("aria-pressed")).toBe("true");

    interfaceLanguage.set("pl");
    await tick();
    expect(pl.getAttribute("aria-pressed")).toBe("true");
    expect(en.getAttribute("aria-pressed")).toBe("false");
  });

  test("pointer activation immediately applies the shared dictionary and persists exactly once per selection", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("unexpected network call in component integration");
    }) as unknown as typeof fetch;
    const recorder = recordStorageWrites();
    try {
      render(App);
      expect(screen.getByPlaceholderText(COPY.en.placeholder)).toBeTruthy();

      const [pl, en] = screen.getAllByRole("button");
      await fireEvent.click(pl);

      // The shared dictionary switched immediately: the Search field and
      // the group name are Polish (ARCH-003), and exactly one persistence
      // attempt stored the exact `pl` value (ARCH-014).
      expect(screen.getByPlaceholderText(COPY.pl.placeholder)).toBeTruthy();
      expect(screen.getByRole("group", { name: COPY.pl.group })).toBeTruthy();
      expect(recorder.calls).toEqual([[INTERFACE_LANGUAGE_STORAGE_KEY, "pl"]]);

      await fireEvent.click(en);
      expect(screen.getByPlaceholderText(COPY.en.placeholder)).toBeTruthy();
      expect(screen.getByRole("group", { name: COPY.en.group })).toBeTruthy();
      expect(recorder.calls).toEqual([
        [INTERFACE_LANGUAGE_STORAGE_KEY, "pl"],
        [INTERFACE_LANGUAGE_STORAGE_KEY, "en"],
      ]);

      // No cookie and no network call during rendering or selection
      // (ISSUE-007: persistence uses localStorage, not cookies).
      expect(document.cookie).toBe("");
    } finally {
      recorder.restore();
      globalThis.fetch = originalFetch;
    }
  });

  test("keyboard activation applies the same selection as a pointer", async () => {
    const recorder = recordStorageWrites();
    try {
      render(App);
      const [pl] = screen.getAllByRole("button");

      await activateWithKeyboard(pl, "Enter");
      expect(screen.getByPlaceholderText(COPY.pl.placeholder)).toBeTruthy();
      expect(screen.getByRole("group", { name: COPY.pl.group })).toBeTruthy();
      expect(recorder.calls).toEqual([[INTERFACE_LANGUAGE_STORAGE_KEY, "pl"]]);

      const [, en] = screen.getAllByRole("button");
      await activateWithKeyboard(en, " ");
      expect(screen.getByPlaceholderText(COPY.en.placeholder)).toBeTruthy();
      expect(screen.getByRole("group", { name: COPY.en.group })).toBeTruthy();
      expect(recorder.calls).toEqual([
        [INTERFACE_LANGUAGE_STORAGE_KEY, "pl"],
        [INTERFACE_LANGUAGE_STORAGE_KEY, "en"],
      ]);
    } finally {
      recorder.restore();
    }
  });

  test("a blocked persistence attempt keeps the selection active in memory without an error or cookie", async () => {
    const failing = failStorageWrites();
    try {
      render(App);
      const [pl] = screen.getAllByRole("button");

      // The store swallows the write failure: no error surfaces, the
      // selection stays active for the session, and nothing is persisted.
      await expect(fireEvent.click(pl)).resolves.toBeTruthy();
      expect(screen.getByPlaceholderText(COPY.pl.placeholder)).toBeTruthy();
      expect(screen.getByRole("group", { name: COPY.pl.group })).toBeTruthy();
      expect(window.localStorage.getItem(INTERFACE_LANGUAGE_STORAGE_KEY)).toBe(
        "en",
      );
      expect(document.cookie).toBe("");

      // The in-memory selection keeps driving the rendered dictionary.
      interfaceLanguage.set("en");
      await tick();
      expect(screen.getByPlaceholderText(COPY.en.placeholder)).toBeTruthy();
    } finally {
      failing.restore();
    }
  });
});
