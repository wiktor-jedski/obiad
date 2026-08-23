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
   * panel that continuously extends the Search field and contains five
   * `48px` rows (ISSUE-008). The Search field's thin bottom border separates
   * the query from the suggestions. The panel removes its top border and
   * top corners, and its `28px` bottom corners match the Search field's
   * original pill radius, so both surfaces read as one control. Every
   * suggestion uses the Search query's `36px` left text inset. The panel is
   * absolutely positioned above the result surface: drafting a later query
   * does not move the result-state Search field or displace the committed
   * selected input and cards. The panel uses Surface with a Secondary
   * border; the keyboard-active option renders with Primary and
   * Text-On-Bright — the first option when the panel opens (REQ-018), the
   * Arrow-moved option thereafter (REQ-019) — and every option carries a
   * stable DOM `id` derived from the stable Food Object ID so the Search
   * input's `aria-activedescendant` can reference it (REQ-018).
   * Options show the active-language Food Object name (REQ-013). Task 28
   * adds pointer activation: a click or tap on any option selects that
   * exact returned Food Object through the parent's selection callback
   * (REQ-020); the option itself is not focusable, so Search keeps focus.
   * A `mousedown` default-prevention keeps focus in the Search field (the
   * combobox/listbox aria-activedescendant pattern): without it the
   * browser blurs the input on mousedown, the panel would close before the
   * click event, and the selection would never reach the parent. Keyboard
   * operation belongs to task 31: the Search input owns keyboard
   * operation through the aria-activedescendant pattern, so the option row
   * intentionally has no tabindex and no key handler — the adjacent
   * `svelte-ignore` documents the two a11y rules that do not apply to this
   * pattern (a tabindex here would break it). The parent passes the active
   * option index, which follows the Search input's Arrow Up and Arrow Down
   * moves and clamps at the first and fifth options (REQ-019): the row at
   * that index renders active with Primary and Text-On-Bright and carries
   * `aria-selected`, and the Search input's `aria-activedescendant`
   * references its stable id. The first option is active when the panel
   * opens (REQ-018). Pointer activation is unchanged: a click or tap on
   * any option selects that exact returned Food Object through the same
   * selection callback regardless of the active index (REQ-020).
   */

  interface Props {
    /** The returned five suggestions, in ranked order. */
    items: FoodSuggestion[];
    /** The zero-based index of the keyboard-active option (task 31, REQ-019). */
    activeIndex: number;
    /** Whether the substitution request lock is active (ARCH-011, ARCH-019, REQ-048). */
    locked?: boolean;
    /** Pointer activation of one option (task 28, REQ-020). */
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
