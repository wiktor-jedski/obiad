<script lang="ts">
  import { getDictionary } from "../i18n";
  import { interfaceLanguage } from "../interfaceLanguage";

  /**
   * Empty-state Search control (task 24, task 25; ARCH-001, ARCH-003,
   * ARCH-012, ARCH-020, REQ-060, ISSUE-006, ISSUE-007).
   *
   * Renders the only empty-state control: an `<input type="search">` with a
   * visually hidden label and the placeholder from the active Interface
   * Language dictionary, with no icon and no autofocus. The pill-shaped
   * field is `56px` high and `min(100%, 640px)` wide; its text starts
   * `0.5em` beyond the end radius. The field is horizontally centered; its
   * vertical placement at `45%` of `100dvh` is owned by the primary column
   * in App.svelte (ISSUE-006). Styling follows docs/requirements/style.md:
   * Surface background, 1px Secondary border, Text-Primary text, and a
   * Primary border on focus without an outer highlight. The control makes
   * no application API request.
   */

  /** The active dictionary for the persisted Interface Language. */
  const dictionary = $derived(getDictionary($interfaceLanguage));
</script>

<label for="food-search" class="sr-only">{dictionary.searchLabel()}</label>
<input
  id="food-search"
  type="search"
  placeholder={dictionary.searchPlaceholder()}
  class="mx-auto block h-14 w-full max-w-[640px] appearance-none rounded-full border border-solid border-dark-secondary bg-dark-surface pl-[calc(1.75rem+0.5em)] pr-4 text-base text-dark-text-primary placeholder:text-dark-text-muted focus-visible:border-dark-primary focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden [&::-webkit-search-results-button]:hidden [&::-webkit-search-results-decoration]:hidden"
/>
