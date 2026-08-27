<script lang="ts">
  import { getDictionary } from "../i18n";
  import { interfaceLanguage } from "../interfaceLanguage";
  import { SUGGESTIONS_LISTBOX_ID, suggestionOptionId } from "../suggestions";
  import type { FoodSuggestion } from "../../client/types.gen";

  /**
   * Listbox for ranked suggestions with stable ids and active-option styling.
   * Pointer activation preserves Search focus through the parent callback.
   */

  interface Props {
    /** The returned five suggestions, in ranked order. */
    items: FoodSuggestion[];
    /** Zero-based index of the keyboard-active option. */
    activeIndex: number;
    /** Whether substitution requests are locked. */
    locked?: boolean;
    /** Handles pointer activation of one option. */
    onselect: (item: FoodSuggestion) => void;
  }

  let { items, activeIndex, locked = false, onselect }: Props = $props();
  /** The active Interface Language for the localized option names. */
  const language = $derived($interfaceLanguage);
  /** The active dictionary for the panel's accessible name. */
  const dictionary = $derived(getDictionary(language));
</script>

<div
  id={SUGGESTIONS_LISTBOX_ID}
  role="listbox"
  aria-label={dictionary.suggestionsListLabel()}
  class="absolute top-full left-0 z-20 w-full overflow-hidden rounded-b-[28px] border border-t-0 border-solid border-dark-secondary bg-dark-surface"
>
  {#each items as item, index (item.foodObjectId)}
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      id={suggestionOptionId(item.foodObjectId)}
      role="option"
      aria-selected={index === activeIndex}
      aria-disabled={locked ? "true" : undefined}
      onmousedown={(event) => event.preventDefault()}
      onclick={() => {
        if (!locked) {
          onselect(item);
        }
      }}
      class="flex h-12 items-center pl-[calc(1.75rem+0.5em)] pr-4 text-base {locked
        ? 'cursor-not-allowed opacity-60'
        : ''} {index === activeIndex
        ? 'bg-dark-primary text-dark-text-on-bright'
        : 'text-dark-text-primary'}"
    >
      {item.names[language]}
    </div>
  {/each}
</div>
