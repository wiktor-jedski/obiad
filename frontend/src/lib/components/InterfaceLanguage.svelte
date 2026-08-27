<script lang="ts">
  import {
    getDictionary,
    interfaceLanguages,
    isInterfaceLanguage,
  } from "../i18n";
  import { interfaceLanguage } from "../interfaceLanguage";

  /**
   * Borderless language selector that preserves Search focus and layout.
   * Selection updates the language store and clears Search text selection.
   */

  /** The active Interface Language from the persisted store. */
  const active = $derived($interfaceLanguage);
  /** The active dictionary used for the dropdown's accessible name. */
  const dictionary = $derived(getDictionary(active));

  /** Collapse the Search selection to the end of its retained text. */
  function clearSearchTextSelection(): void {
    const field = document.getElementById("food-search");
    if (field instanceof HTMLInputElement) {
      field.setSelectionRange(field.value.length, field.value.length);
    }
  }

  /** Applies a valid language selection and clears the Search text selection. */
  function selectLanguage(event: Event): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }
    const language = target.value;
    if (!isInterfaceLanguage(language)) {
      return;
    }
    interfaceLanguage.set(language);
    clearSearchTextSelection();
  }
</script>

<div
  data-interface-language
  class="absolute right-4 top-4 flex h-11 items-center sm:right-6 lg:right-8"
>
  <select
    aria-label={dictionary.interfaceLanguage()}
    value={active}
    onchange={selectLanguage}
    class="h-11 min-w-16 cursor-pointer appearance-none border-0 bg-transparent py-0 pl-3 pr-8 font-data text-sm font-medium text-dark-text-primary outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-dark-primary"
  >
    {#each interfaceLanguages as language}
      <option value={language}>{language.toUpperCase()}</option>
    {/each}
  </select>
  <span
    aria-hidden="true"
    class="pointer-events-none absolute right-3 -translate-y-px font-data text-sm text-dark-text-primary"
    >⌄</span
  >
</div>
