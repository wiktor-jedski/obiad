<script lang="ts">
  import type { SubstituteItem } from "../../client/types.gen";
  import { foodPlaceholderUrl, resolveFoodImage } from "../assets";
  import {
    formatCaloriesValue,
    formatMacronutrientValue,
    getDictionary,
  } from "../i18n";
  import type { InterfaceLanguage } from "../i18n";
  import { resultCardTransition } from "../resultCardMotion";

  /**
   * Result-card component (task 29; ARCH-001, ARCH-003, ARCH-015,
   * ARCH-020, ARCH-022, REQ-011, REQ-036, REQ-037, REQ-038, REQ-039,
   * REQ-040, REQ-081, ISSUE-008; task 50, task 51, ARCH-021, REQ-052, REQ-053, REQ-054,
   * ISSUE-016).
   *
   * The component consumes one generated display-ready `SubstituteItem`
   * and the active Interface Language. It renders the approved card field
   * order — image, localized name, whole Matched Quantity, centered
   * calories, protein, carbohydrate, fat, and similarity — with no
   * browser-side nutrition calculation or rerounding: every displayed number
   * is backend-rounded and formatted only for display (ARCH-001, REQ-040).
   *
   * The card updates its Food Object name, visible `Protein`,
   * `Carbohydrates`, `Fat`, and `Similarity` labels (`Białko`,
   * `Węglowodany`, `Tłuszcz`, `Podobieństwo` in Polish), and one localized
   * decimal place when the Interface Language changes (REQ-058). Matched
   * Quantity stays whole with only `g` or `ml` (REQ-038) and similarity stays
   * a whole percentage. There is no Serving equivalent, card action, paging
   * control, or persisted display value.
   *
   * Task 50 applies the reusable ARCH-021 entrance motion to the card root:
   * the global `in:resultCardTransition|global` directive fades the card in
   * over 220 ms, starting 100 ms after the prior ranked card (rank zero has
   * no delay), when a completed first page and its parent result region
   * render together (REQ-052). Reduced-motion mode uses the instant
   * configuration, and a retained card whose key stays in the keyed result
   * set is never remounted or animated (REQ-054, ISSUE-016).
   *
   * Task 51 completes the keyed replacement with the card's stable rank-slot
   * wrapper. Its local `out:resultCardTransition` fades every current card
   * out together for 120 ms when a successful later-page response replaces
   * the keyed card. The local wrapper transition does not retain a
   * superseded parent result region during a new Search; the old cards leave
   * with that region before the new result region reveals its cards. Each
   * replacement card starts its 220 ms intro 120 ms later — after the last
   * current-card outro completes — followed by the 100 ms rank intervals
   * (REQ-053).
   *
   * The supported image-key map is empty (ISSUE-008): an absent key, one
   * of the four seeded opaque keys, and every other unmapped key resolve to
   * the existing bundled placeholder through `resolveFoodImage`
   * (ARCH-015, REQ-011). The card image carries empty alternative text
   * because the adjacent card heading names the same Food Object, and a
   * failed image source resets to the same bundled placeholder.
   *
   * While a valid quantity recalculation is pending (task 34, ISSUE-010),
   * the `pending` prop keeps the result image visible, hides the complete
   * non-image content without changing its layout, and shows one centered,
   * aria-hidden `16px` spinner in that content area (REQ-081). The card
   * never calculates or rerounds a nutrition value in either state
   * (REQ-040).
   */

  interface Props {
    /** One display-ready generated Substitute (ARCH-005, ARCH-008). */
    item: SubstituteItem;
    /** The active Interface Language used for the card's visible text. */
    language: InterfaceLanguage;
    /**
     * Whether a valid quantity recalculation is pending (task 34,
     * ISSUE-010). While set, the result image remains visible, all non-image
     * content is hidden without changing its layout, and one centered,
     * aria-hidden `16px` spinner is shown in that content area (REQ-081).
     */
    pending?: boolean;
    /**
     * The card's 0-based rank within its completed result page (task 50,
     * ARCH-021, REQ-052): rank zero has no delay, and each later ranked
     * card starts 100 ms after the prior one.
     */
    rank?: number;
    /**
     * Whether the card belongs to a completed first page (task 50,
     * ARCH-021, REQ-052): first-page cards use the plain staggered
     * 220 ms entrance; cards of later pages delay their intro by the
     * full 120 ms outro duration of the keyed MORE! replacement
     * sequence (task 51, REQ-053).
     */
    firstPage?: boolean;
  }

  let {
    item,
    language,
    pending = false,
    rank = 0,
    firstPage = false,
  }: Props = $props();

  /** The active-language dictionary for the card's visible labels. */
  const dictionary = $derived(getDictionary(language));
  /**
   * The resolved card image. The supported image-key map is empty, so an
   * absent, seeded, or unmapped key always resolves to the bundled
   * placeholder (REQ-011, ARCH-015, ISSUE-008).
   */
  const imageSrc = $derived(resolveFoodImage(item.imageKey));

  /**
   * Resets a failed image source to the same bundled placeholder (REQ-011,
   * ARCH-015). The guard prevents an error loop: the source is only
   * rewritten when it is not already the placeholder, which is always the
   * case here because the supported map is empty.
   */
  function onImageError(event: Event): void {
    const image = event.currentTarget;
    if (
      image instanceof HTMLImageElement &&
      image.getAttribute("src") !== foodPlaceholderUrl
    ) {
      image.setAttribute("src", foodPlaceholderUrl);
    }
  }
</script>

<article
  data-result-card
  data-food-object-id={item.foodObjectId}
  data-result-card-rank={rank}
  in:resultCardTransition|global={{ rank, firstPage }}
  class="relative overflow-hidden rounded-2xl border border-solid border-dark-secondary bg-dark-surface"
>
  <img
    data-result-card-image
    src={imageSrc}
    alt=""
    onerror={onImageError}
    class="h-44 w-full object-cover"
  />
  <div
    data-card-content
    class="flex flex-col gap-2 p-4"
    class:opacity-0={pending}
  >
    <h3 class="text-center text-base font-medium text-dark-text-primary">
      {item.names[language]}
    </h3>
    <p
      data-result-card-matched-quantity
      class="text-center font-data text-sm text-dark-text-primary"
    >
      {`${item.matchedQuantity.value} ${item.matchedQuantity.unit}`}
    </p>
    <!--
    The card calories row (task 35, REQ-078) carries the localized
    `Calories` / `Kalorie` accessible name through `aria-label`. The
    explicit `group` role keeps that association without the implicit
    paragraph role, whose `aria-label` is prohibited (axe
    aria-prohibited-attr, task 48, ISSUE-015); the visible centered value
    and layout are unchanged.
  -->
    <p
      data-result-card-calories
      role="group"
      aria-label={dictionary.caloriesLabel()}
      class="text-center font-data text-sm text-dark-text-primary"
    >
      {formatCaloriesValue(item.calories)}
    </p>
    <dl class="flex flex-col gap-1 font-data text-sm">
      <div class="flex items-baseline justify-between gap-4">
        <dt class="font-medium text-dark-text-muted">
          {dictionary.proteinLabel()}
        </dt>
        <dd class="text-right text-dark-text-primary">
          {formatMacronutrientValue(item.macronutrients.protein, language)}
        </dd>
      </div>
      <div class="flex items-baseline justify-between gap-4">
        <dt class="font-medium text-dark-text-muted">
          {dictionary.carbohydratesLabel()}
        </dt>
        <dd class="text-right text-dark-text-primary">
          {formatMacronutrientValue(item.macronutrients.carbohydrate, language)}
        </dd>
      </div>
      <div class="flex items-baseline justify-between gap-4">
        <dt class="font-medium text-dark-text-muted">
          {dictionary.fatLabel()}
        </dt>
        <dd class="text-right text-dark-text-primary">
          {formatMacronutrientValue(item.macronutrients.fat, language)}
        </dd>
      </div>
      <div class="flex items-baseline justify-between gap-4">
        <dt class="font-medium text-dark-text-muted">
          {dictionary.similarityLabel()}
        </dt>
        <dd class="text-right text-dark-text-primary">
          {item.similarityPercent}%
        </dd>
      </div>
    </dl>
  </div>
  {#if pending}
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-x-0 bottom-0 top-44 flex items-center justify-center"
    >
      <span
        data-card-spinner
        aria-hidden="true"
        class="h-4 w-4 animate-spin rounded-full border-2 border-solid border-dark-secondary border-t-dark-primary"
      ></span>
    </div>
  {/if}
</article>
