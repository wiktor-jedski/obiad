<script lang="ts">
  import {
    getDictionary,
    interfaceLanguages,
    isInterfaceLanguage,
  } from "../i18n";
  import { interfaceLanguage } from "../interfaceLanguage";

  /**
   * Borderless Interface Language dropdown.
   *
   * The native select exposes the active language code and a small visual
   * chevron while preserving native pointer and keyboard interaction. It is
   * absolutely positioned `16px` from the viewport top and at the responsive
   * right page gutter, so it does not move the Search field from its
   * established vertical center.
   *
   * Task 43 completes the Search-side Interface Language change
   * collaboration (ARCH-012, REQ-059): a real selection of the control
   * updates the one persisted language store and removes any Search text
   * selection. The real pointer or keyboard interaction itself moves focus
   * to the control, so the Search field's native blur already closes the
   * live suggestion list and removes Search focus from the interaction
   * state; the exact unfinished Search Query stays retained. The language
   * action itself starts no HTTP request, and the next Search focus starts
   * one fresh suggestion GET with the retained query and the selected
   * language instead of reusing inactive data.
   */

  /** The active Interface Language from the persisted store. */
  const active = $derived($interfaceLanguage);
  /** The active dictionary used for the dropdown's accessible name. */
  const dictionary = $derived(getDictionary(active));

  /**
   * Removes any Search text selection (REQ-059): the selection range
   * collapses to the end of the retained query. The Search field keeps its
   * internal selection after losing focus (the click-to-select action of
   * the Search control), so the language selection explicitly collapses it.
   */
  function clearSearchTextSelection(): void {
    const field = document.getElementById(
      "food-search",
    ) as HTMLInputElement | null;
    if (field !== null) {
      field.setSelectionRange(field.value.length, field.value.length);
    }
  }

  /**
   * Applies one real selection from the Interface Language control
   * (task 43, ARCH-012, REQ-059). The selection updates the one persisted
   * language store, closes the live suggestion list and removes Search
   * focus through the focus transfer of the real interaction, removes any
   * Search text selection, and retains the exact unfinished Search Query.
   * Because the suggestion query stays disabled once the Search field lost
   * focus, the language action itself starts no suggestion GET, Substitute
   * POST, retry, or other HTTP request (P14-G5, REQ-013); the next Search
   * focus uses the selected language and starts one fresh suggestion GET.
   * No parallel interaction state, language store, request path, or
   * automatic focus return is added.
   */
  function selectLanguage(event: Event): void {
    const language = (event.currentTarget as HTMLSelectElement).value;
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
