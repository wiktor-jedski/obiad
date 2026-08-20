<script lang="ts">
  import { getDictionary } from "../i18n";
  import { interfaceLanguage } from "../interfaceLanguage";
  import { SUGGESTIONS_LISTBOX_ID, suggestionOptionId } from "../suggestions";
  import type { FoodSuggestion } from "../../client/types.gen";

  /**
   * Suggestion listbox panel (task 27, task 28; ARCH-002, ARCH-010,
   * ARCH-020, REQ-012, REQ-013, REQ-018, REQ-020).
   *
   * Renders exactly the returned five localized options as a `listbox`
   * panel that matches the Search field's maximum `640px` width, starts
   * `8px` below it, and contains five `48px` rows (ISSUE-008). The panel
   * uses Surface with a Secondary border; the first option renders active
   * with Primary and Text-On-Bright, and every option carries a stable DOM
   * `id` derived from the stable Food Object ID so the Search input's
   * `aria-activedescendant` can reference the active option (REQ-018).
   * Options show the active-language Food Object name (REQ-013). Task 28
   * adds pointer activation: a click or tap on any option selects that
   * exact returned Food Object through the parent's selection callback
   * (REQ-020); the option itself is not focusable, so Search keeps focus.
   * A `mousedown` default-prevention keeps focus in the Search field (the
   * combobox/listbox aria-activedescendant pattern): without it the
   * browser blurs the input on mousedown, the panel would close before the
   * click event, and the selection would never reach the parent. Keyboard
   * operation belongs to task 31: the Search input owns keyboard operation
   * through the aria-activedescendant pattern, so the option row
   * intentionally has no tabindex and no key handler — the adjacent
   * `svelte-ignore` documents the two a11y rules that do not apply to this
   * pattern (a tabindex here would break it).
   */

  interface Props {
    /** The returned five suggestions, in ranked order. */
    items: FoodSuggestion[];
    /** Pointer activation of one option (task 28, REQ-020). */
    onselect: (item: FoodSuggestion) => void;
  }

  let { items, onselect }: Props = $props();

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
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      id={suggestionOptionId(item.foodObjectId)}
      role="option"
      aria-selected={item.foodObjectId === items[0].foodObjectId}
      onmousedown={(event) => event.preventDefault()}
      onclick={() => onselect(item)}
      class="flex h-12 items-center px-4 text-base {item.foodObjectId ===
      items[0].foodObjectId
        ? 'bg-dark-primary text-dark-text-on-bright'
        : 'text-dark-text-primary'}"
    >
      {item.names[language]}
    </div>
  {/each}
</div>
