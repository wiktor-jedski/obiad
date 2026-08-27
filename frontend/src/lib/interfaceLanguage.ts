import { writable, type Readable } from "svelte/store";
import { isInterfaceLanguage, type InterfaceLanguage } from "./i18n";

export const INTERFACE_LANGUAGE_STORAGE_KEY = "obiad.interfaceLanguage";

export interface InterfaceLanguageEnvironment {
  storage: Pick<Storage, "getItem" | "setItem">;

  browserLanguages: readonly string[];
}

export interface InterfaceLanguageStore extends Readable<InterfaceLanguage> {
  set: (language: InterfaceLanguage) => void;
}

function readStoredLanguage(storage: Pick<Storage, "getItem">): string | null {
  try {
    return storage.getItem(INTERFACE_LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function resolveInitialLanguage(
  environment: InterfaceLanguageEnvironment,
): InterfaceLanguage {
  const stored = readStoredLanguage(environment.storage);
  if (stored !== null && isInterfaceLanguage(stored)) {
    return stored;
  }
  for (const tag of environment.browserLanguages) {
    const primary = tag.split(/[-_]/u)[0]?.toLowerCase() ?? "";
    if (isInterfaceLanguage(primary)) {
      return primary;
    }
  }
  return "en";
}

export function createInterfaceLanguageStore(
  environment: InterfaceLanguageEnvironment,
): InterfaceLanguageStore {
  const { subscribe, set } = writable<InterfaceLanguage>(
    resolveInitialLanguage(environment),
  );
  return {
    subscribe,
    set(language) {
      set(language);
      try {
        environment.storage.setItem(INTERFACE_LANGUAGE_STORAGE_KEY, language);
      } catch {}
    },
  };
}

export const interfaceLanguage: InterfaceLanguageStore =
  createInterfaceLanguageStore({
    storage: window.localStorage,
    browserLanguages: navigator.languages,
  });
