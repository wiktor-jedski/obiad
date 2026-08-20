<script lang="ts">
  import { getDictionary } from "../i18n";
  import { interfaceLanguage } from "../interfaceLanguage";

  /**
   * Borderless Interface Language dropdown.
   *
   * The native select exposes the active language code and a small visual
   * chevron while preserving native pointer and keyboard interaction. It is
   * absolutely positioned at the responsive page gutter, so it does not move
   * the Search field from its established vertical center.
   */

  /** The active Interface Language from the persisted store. */
  const active = $derived($interfaceLanguage);
  /** The active dictionary used for the dropdown's accessible name. */
  const dictionary = $derived(getDictionary(active));

  function selectLanguage(event: Event): void {
    const language = (event.currentTarget as HTMLSelectElement).value;
    if (language === "pl" || language === "en") {
      interfaceLanguage.set(language);
    }
  }
</script>

<div
  data-interface-language
  class="absolute right-4 top-4 flex h-11 items-center sm:right-6 sm:top-6 lg:right-8 lg:top-8"
>
  <select
    aria-label={dictionary.interfaceLanguage()}
    value={active}
    onchange={selectLanguage}
    class="h-11 min-w-16 cursor-pointer appearance-none border-0 bg-transparent py-0 pl-3 pr-8 font-data text-sm font-medium text-dark-text-primary outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-dark-primary"
  >
    <option value="pl">PL</option>
    <option value="en">EN</option>
  </select>
  <span
    aria-hidden="true"
    class="pointer-events-none absolute right-3 -translate-y-px font-data text-sm text-dark-text-primary"
    >⌄</span
  >
</div>
