<script lang="ts">
  import {
    getDictionary,
    interfaceLanguages,
    type InterfaceLanguage,
  } from "../i18n";
  import { interfaceLanguage } from "../interfaceLanguage";
  import HeaderDropdown from "./HeaderDropdown.svelte";

  const active = $derived($interfaceLanguage);
  const dictionary = $derived(getDictionary(active));

  function selectLanguage(
    language: InterfaceLanguage,
    close: () => void,
  ): void {
    interfaceLanguage.set(language);
    const field = document.getElementById("food-search");
    if (field instanceof HTMLInputElement) {
      field.setSelectionRange(field.value.length, field.value.length);
    }
    close();
  }
</script>

<div
  data-interface-language
  class="absolute right-4 top-4 z-20 sm:right-6 lg:right-8"
>
  <HeaderDropdown
    align="right"
    label={dictionary.interfaceLanguage()}
    describedBy="current-interface-language"
  >
    {#snippet trigger()}
      <span
        id="current-interface-language"
        class="font-data text-sm font-medium">{active.toUpperCase()}</span
      >
    {/snippet}
    {#snippet children(close)}
      <div role="group" aria-label={dictionary.interfaceLanguage()}>
        {#each interfaceLanguages as language (language)}
          <button
            type="button"
            class="header-menu-item justify-between"
            lang={language}
            aria-pressed={active === language}
            onclick={() => selectLanguage(language, close)}
          >
            {language === "en" ? "English" : "Polski"}
            {#if active === language}<span aria-hidden="true">✓</span>{/if}
          </button>
        {/each}
      </div>
    {/snippet}
  </HeaderDropdown>
</div>
