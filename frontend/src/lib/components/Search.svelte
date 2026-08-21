<script lang="ts">
  import { getDictionary } from "../i18n";
  import { interfaceLanguage } from "../interfaceLanguage";
  import { interactionState } from "../interactionState";
  import { queryClient } from "../queryClient";
  import {
    SUGGESTIONS_LISTBOX_ID,
    SUGGESTIONS_QUERY_KEY_PREFIX,
    createSuggestionsQuery,
    suggestionOptionId,
  } from "../suggestions";
  import { isNormalizedEmptySearchQuery } from "../searchQuery";
  import SuggestionList from "./SuggestionList.svelte";
  import type { FoodSuggestion } from "../../client/types.gen";

  /**
   * Search control with the live Food Object suggestion slice, the
   * pointer-selection and new-search transition, and the keyboard
   * operation of the suggestion list (task 24, task 25, task 27,
   * task 28, task 31, task 32; ARCH-001, ARCH-002, ARCH-003, ARCH-008,
   * ARCH-010, ARCH-011, ARCH-012, ARCH-017, ARCH-019, ARCH-020, REQ-012,
   * REQ-013, REQ-018, REQ-019, REQ-020, REQ-021, REQ-022, REQ-023,
   * REQ-024, REQ-046, REQ-060, REQ-064, ISSUE-006, ISSUE-007, ISSUE-008,
   * ISSUE-009). Task 30 keeps this
   * component as the
   * stable Search region of the root composition: the input, the suggestion
   * panel, and the new-search spinner. The read-only Substitution Input,
   * the result-card region, and the zero-result message live in the root
   * application (App.svelte), which owns the result-state geometry: the
   * Search field's `96px` top edge and the `24px` region intervals.
   *
   * The control renders an `<input type="search">` with a visually hidden
   * label, the placeholder from the active Interface Language dictionary,
   * no icon, and initial autofocus so a visitor can type immediately. The
   * pill-shaped field is `56px` high and `min(100%, 640px)` wide; its text
   * starts `0.5em`
   * beyond the end radius. The field is horizontally centered; its
   * vertical placement at `45%` of `100dvh` is owned by the primary column
   * in App.svelte (ISSUE-006). Styling follows docs/requirements/style.md:
   * Surface background, 1px Secondary border, Text-Primary text, and a
   * Primary border on focus without an outer highlight.
   *
   * Task 27 adds the suggestion slice: Search Query text and focus live in
   * the discriminated interaction state (ARCH-002), and the suggestion
   * request runs through the generated TypeScript client and TanStack Query
   * only while the field is focused and contains nonempty text (ARCH-010,
   * ARCH-019). The input follows the combobox/listbox pattern with the
   * listbox `aria-controls`, `aria-expanded`, and the first option's stable
   * id as `aria-activedescendant` (REQ-018).
   *
   * Task 28 adds the pointer-selection and new-search transition: a click
   * or tap on any option selects that exact returned Food Object without
   * moving focus from Search, closes the suggestion list, replaces the
   * Search Query with the selected active-language name, retains the
   * selected localized names and returned default Food Quantity as the
   * read-only Substitution Input, and starts exactly one generated-client
   * `POST /api/v1/substitutes/search` operation with that `foodObjectId`,
   * the unchanged default quantity, and `pageIndex: 0` (REQ-020, REQ-022,
   * REQ-023, REQ-024, REQ-077). After completed results, draft typing keeps
   * committed selected input and cards visible and overlays fresh
   * suggestions; selecting one suggestion is the commit boundary that
   * replaces the prior result. The interaction-state union gains only the
   * required `loadingNew`, `results`, and `zeroResults` transitions;
   * TanStack Query continues to own response data and pending state, and
   * the new-search spinner shows `12px` below the Search field for the
   * complete pending interval (REQ-046), after which Search keeps focus
   * (REQ-064). The page-0 query itself and the `loadingNew` →
   * `results`/`zeroResults` transition effect moved to the root composition
   * with task 30, which also renders the selected-input, result-card, and
   * zero-result regions. No Food Quantity edit, MORE!, failure state,
   * motion, or active-content language-change behavior belongs here.
   *
   * Task 31 completes the Phase 7 suggestion control with keyboard
   * operation over the same TanStack Query list and the same selection
   * transition used by pointer activation (REQ-019, ARCH-010, ARCH-020):
   * the Search input owns the key handling through the combobox/listbox
   * active-descendant pattern, so option DOM focus never leaves Search.
   * Arrow Down moves the active option toward the fifth option and clamps
   * there; Arrow Up moves toward the first option and clamps there; every
   * move updates the active option's styling and the input's
   * `aria-activedescendant`. Enter selects the active option through the
   * identical `selectSuggestion` path a pointer click uses, so it starts
   * the same one default-quantity page-0 Substitution Search. Escape
   * closes the list while retaining the Search Query text and Search focus
   * and starts no Substitution Search; Tab closes the list through the
   * native blur without preventing the browser's native focus movement and
   * starts no Substitution Search. The active option index and the
   * Escape-closed dismissal are local UI state of this open-list
   * interaction — HTTP data never leaves TanStack Query, the interaction
   * state union gains no variant, and pointer behavior is unchanged.
   *
   * Task 32 (Phase 9, REQ-021, ARCH-017, ISSUE-009) adds the
   * normalized-empty browser no-op: emptiness is decided exactly by
   * whether the ARCH-017 normalization contract produces an empty Search
   * Query, so drafts consisting only of Go-compatible Unicode whitespace —
   * including `U+0085` NEXT LINE, `U+00A0` NO-BREAK SPACE, `U+2003` EM
   * SPACE, and `U+202F` NARROW NO-BREAK SPACE — are normalized-empty. The
   * exact raw value stays unchanged in the interaction state and the
   * field, the suggestion panel stays closed for such drafts, and the
   * suggestion query enables no request. Enter with no open suggestion and
   * a normalized-empty value prevents the browser action while retaining
   * the exact raw value, Search focus, and the current interaction state;
   * it shows no validation message or invalid state and starts neither a
   * suggestion request nor a Substitution Search request. Enter selection
   * of a normalized-nonempty open suggestion is unchanged, and no Food
   * Quantity validation, translation dictionary entry, backend request,
   * or interaction-state variant is added.
   */

  /**
   * The current discriminated interaction state (ARCH-002). It is named
   * `interaction`, not `state`, so the `$state` runes below are never
   * shadowed by a store-like identifier (svelte-check resolves `$state` as
   * a legacy store subscription when a variable named `state` is in scope).
   */
  const interaction = $derived($interactionState);
  /** The current Search Query text from the interaction state. */
  const query = $derived(interaction.query);
  /** Whether the Search field currently has focus. */
  const focused = $derived(interaction.focused);
  /** The active Interface Language for the placeholder and names. */
  const language = $derived($interfaceLanguage);
  /** The active dictionary for the accessible label and placeholder. */
  const dictionary = $derived(getDictionary(language));

  /**
   * Whether the current Search text is an uncommitted suggestion intent.
   * Selection closes this lane; later typing reopens it without changing a
   * committed `results` or `zeroResults` transition.
   */
  let suggestionIntent = $state(false);

  /** The TanStack Query owning the live suggestion list (ARCH-019). */
  const suggestions = createSuggestionsQuery({
    query: () => query,
    focused: () => focused,
    language: () => language,
    active: () => suggestionIntent,
  });

  /**
   * The returned five suggestions of the latest response, or undefined
   * while no response is present for the current query.
   */
  const suggestionItems = $derived(
    suggestions.data !== undefined ? suggestions.data.items : undefined,
  );

  /**
   * The zero-based index of the keyboard-active option (task 31, REQ-019).
   * The first option is active when the panel opens (REQ-018); Arrow Down
   * and Arrow Up move the index toward the fifth and first options and
   * clamp there. It is local UI state of the open list: it resets whenever
   * the visitor types or re-focuses the field, and it never holds HTTP
   * data — the option rows come straight from the TanStack Query response.
   */
  let activeIndex = $state(0);

  /**
   * Whether the visitor dismissed the open list with Escape (task 31,
   * REQ-019). While set, the panel stays closed even though the Search
   * field keeps focus and text; typing or re-focusing the field clears the
   * dismissal so live suggestions resume for the changed intent. It is
   * local UI state: no interaction-state variant and no Substitution
   * Search is involved.
   */
  let dismissed = $state(false);

  /**
   * Whether the suggestion panel is open: the Search field has an
   * uncommitted suggestion intent, is focused, and contains text that is
   * nonempty after the ARCH-017 normalization contract (task 32,
   * REQ-021); the latest response has arrived; and the visitor has not
   * dismissed the list with Escape. A completed result can remain visible
   * beneath this panel until selection commits the next search. No loading
   * or failure surface belongs here, so the panel renders exactly the five
   * returned options.
   */
  const open = $derived(
    suggestionIntent &&
      focused &&
      !isNormalizedEmptySearchQuery(query) &&
      suggestionItems !== undefined &&
      !dismissed,
  );

  /**
   * The stable id of the active option for `aria-activedescendant` (task
   * 31, REQ-019). It follows the keyboard-active index exactly like the
   * active styling: the first option when the panel opens, the Arrow-moved
   * option thereafter. It exists only for a current open list: whenever
   * the list is closed or the field loses focus, the attribute is absent,
   * so it can never point to a removed option (ARCH-020, REQ-018).
   */
  const activeOptionId = $derived(
    open && suggestionItems !== undefined
      ? suggestionOptionId(suggestionItems[activeIndex].foodObjectId)
      : undefined,
  );

  /**
   * Fresh-visible-query boundary (ARCH-019): when the Search field loses
   * focus the suggestion query becomes inactive, and because the disabled
   * observer stays mounted, `gcTime: 0` alone does not evict it. Removing
   * every inactive suggestion query on blur guarantees that a later
   * identical intent — refocusing with the same Search Query text — starts
   * a real backend request and never reuses a successful response. The
   * panel stays closed until that fresh request returns, so a reused
   * response can never be visible.
   */
  $effect(() => {
    if (!focused) {
      queryClient.removeQueries({
        queryKey: SUGGESTIONS_QUERY_KEY_PREFIX,
      });
    }
  });

  /**
   * Applies draft Search Query text to the interaction state. Changed text
   * starts a fresh suggestion intent without changing the committed result
   * transition or removing its selected input and cards.
   */
  function onInput(event: Event): void {
    dismissed = false;
    suggestionIntent = true;
    activeIndex = 0;
    interactionState.setQuery((event.currentTarget as HTMLInputElement).value);
  }

  /**
   * Keyboard operation of the open suggestion list (task 31, REQ-019,
   * ARCH-010, ARCH-020). The Search input owns the key handling through
   * the active-descendant pattern; option DOM focus stays on Search.
   *
   * - Arrow Down moves the active option toward the fifth option and
   *   clamps there; Arrow Up moves toward the first option and clamps
   *   there. Every move updates the active option's styling and the
   *   input's `aria-activedescendant`.
   * - Enter selects the active option through the identical
   *   {@link selectSuggestion} path a pointer click uses, starting the
   *   same one default-quantity page-0 Substitution Search.
   * - Enter with no open suggestion and a value that is empty after the
   *   ARCH-017 normalization contract (task 32, REQ-021, ISSUE-009) is a
   *   strict no-op: `preventDefault` stops the browser action while the
   *   exact raw value, Search focus, and the current interaction state
   *   stay unchanged, no validation message or invalid state renders, and
   *   neither a suggestion request nor a Substitution Search starts.
   * - Escape closes the list while retaining the Search Query text and
   *   Search focus and starts no Substitution Search. `preventDefault`
   *   also stops the browser's native `type="search"` Escape behavior,
   *   which would otherwise clear the field's text.
   * - Tab intentionally has no handler: the browser's native focus
   *   movement blurs the field, and the blur closes the list without any
   *   Substitution Search.
   */
  function onKeydown(event: KeyboardEvent): void {
    const key = event.key;
    if (key === "ArrowDown" || key === "ArrowUp") {
      if (!open || suggestionItems === undefined) {
        return;
      }
      event.preventDefault();
      const lastIndex = suggestionItems.length - 1;
      if (key === "ArrowDown") {
        activeIndex = Math.min(activeIndex + 1, lastIndex);
      } else {
        activeIndex = Math.max(activeIndex - 1, 0);
      }
      return;
    }
    if (key === "Enter") {
      if (open && suggestionItems !== undefined) {
        event.preventDefault();
        selectSuggestion(suggestionItems[activeIndex]);
        return;
      }
      if (isNormalizedEmptySearchQuery(query)) {
        // Phase 9 (REQ-021, ISSUE-009): Enter with no open suggestion and
        // a normalized-empty value is a strict browser no-op. Prevent the
        // browser action (for example implicit form submission) while the
        // exact raw value, Search focus, and the current interaction state
        // stay unchanged; no validation message or invalid state renders
        // and neither a suggestion request nor a Substitution Search
        // request starts. The empty check uses the ARCH-017 normalization
        // contract, including Go-compatible Unicode whitespace such as
        // `U+0085` NEXT LINE.
        event.preventDefault();
      }
      return;
    }
    if (key === "Escape") {
      if (!open) {
        return;
      }
      event.preventDefault();
      dismissed = true;
    }
  }

  /**
   * Re-focusing an empty search resumes its suggestion intent. A completed
   * search resumes only an existing draft intent, so focus alone never
   * reopens suggestions for the committed query.
   */
  function onFocus(): void {
    dismissed = false;
    if (interaction.name === "empty") {
      suggestionIntent = true;
    }
    activeIndex = 0;
    interactionState.setFocused(true);
  }

  /**
   * Pointer activation of one suggestion (task 28, REQ-020, REQ-077):
   * captures the exact returned Food Object — stable ID, both localized
   * names, returned default Food Quantity, and active Interface Language —
   * replaces the Search Query with the returned active-language name, and
   * transitions to `loadingNew`. The transition closes suggestions while
   * Search keeps focus and starts exactly one page-0 Substitution Search
   * with the unchanged default quantity. Task 31's Enter key selects through
   * this same transition, so keyboard and pointer activation are identical
   * (REQ-019, REQ-020).
   */
  function selectSuggestion(item: FoodSuggestion): void {
    suggestionIntent = false;
    interactionState.selectSuggestion({
      foodObjectId: item.foodObjectId,
      names: item.names,
      quantity: item.defaultQuantity,
      capturedLanguage: language,
    });
  }
</script>

<label for="food-search" class="sr-only">{dictionary.searchLabel()}</label>
<div data-search-region class="relative mx-auto w-full max-w-[640px]">
  <!-- svelte-ignore a11y_autofocus (Search is the page's primary action.) -->
  <input
    id="food-search"
    type="search"
    autofocus
    value={query}
    placeholder={dictionary.searchPlaceholder()}
    role="combobox"
    aria-expanded={open}
    aria-controls={SUGGESTIONS_LISTBOX_ID}
    aria-autocomplete="list"
    aria-activedescendant={activeOptionId}
    oninput={onInput}
    onfocus={onFocus}
    onblur={() => interactionState.setFocused(false)}
    onkeydown={onKeydown}
    class="block h-14 w-full appearance-none border border-solid border-dark-secondary bg-dark-surface pl-[calc(1.75rem+0.5em)] pr-4 text-base text-dark-text-primary placeholder:text-dark-text-muted focus-visible:border-dark-primary focus-visible:outline-none {open
      ? 'rounded-t-[28px] rounded-b-none'
      : 'rounded-full'} [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden [&::-webkit-search-results-button]:hidden [&::-webkit-search-results-decoration]:hidden"
  />
  {#if open && suggestionItems}
    <SuggestionList
      items={suggestionItems}
      {activeIndex}
      onselect={selectSuggestion}
    />
  {/if}
  {#if interaction.name === "loadingNew"}
    <div
      data-new-search-spinner
      aria-hidden="true"
      class="mx-auto mt-3 h-6 w-6 animate-spin rounded-full border-2 border-solid border-dark-secondary border-t-dark-primary"
    ></div>
  {/if}
</div>
