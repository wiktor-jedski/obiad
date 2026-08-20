<script lang="ts">
  import { getDictionary } from "../i18n";
  import { interfaceLanguage } from "../interfaceLanguage";
  import { SUGGESTIONS_LISTBOX_ID, suggestionOptionId } from "../suggestions";
  import type { FoodSuggestion } from "../../client/types.gen";

  /**
   * Suggestion listbox panel (task 27; ARCH-002, ARCH-010, ARCH-020,
   * REQ-012, REQ-013, REQ-018).
   *
   * Renders exactly the returned five localized options as a `listbox`
   * panel that matches the Search field's maximum `640px` width, starts
   * `8px` below it, and contains five `48px` rows (ISSUE-008). The panel
   * uses Surface with a Secondary border; the first option renders active
   * with Primary and Text-On-Bright, and every option carries a stable DOM
   * `id` derived from the stable Food Object ID so the Search input's
   * `aria-activedescendant` can reference the active option (REQ-018).
   * Options show the active-language Food Object name (REQ-013); no
   * selection, pointer, or keyboard transition belongs to this task (task
   * 28, task 31).
   */

  interface Props {
    /** The returned five suggestions, in ranked order. */
    items: FoodSuggestion[];
  }

  let { items }: Props = $props();

  /** The active Interface Language for the localized option names. */
  const language = $derived($interfaceLanguage);
  /** The active dictionary for the panel's accessible name. */
  const dictionary = $derived(getDictionary(language));
</script>

<div
  id={SUGGESTIONS_LISTBOX_ID}
  role="listbox"
  aria-label={dictionary.suggestionsListLabel()}
  class="mt-2 w-full overflow-hidden rounded-2xl border border-solid border-dark-secondary bg-dark-surface"
>
  {#each items as item (item.foodObjectId)}
    <div
      id={suggestionOptionId(item.foodObjectId)}
      role="option"
      aria-selected={item.foodObjectId === items[0].foodObjectId}
      class="flex h-12 items-center px-4 text-base {item.foodObjectId ===
      items[0].foodObjectId
        ? 'bg-dark-primary text-dark-text-on-bright'
        : 'text-dark-text-primary'}"
    >
      {item.names[language]}
    </div>
  {/each}
</div>
