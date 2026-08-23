<script lang="ts">
  import type { SubstituteItem } from "../../client/types.gen";
  import { foodPlaceholderUrl, resolveFoodImage } from "../assets";
  import {
    formatCaloriesValue,
    formatMacronutrientValue,
    getDictionary,
  } from "../i18n";
  import type { InterfaceLanguage } from "../i18n";

  /**
   * Result-card component (task 29; ARCH-001, ARCH-003, ARCH-015,
   * ARCH-020, ARCH-022, REQ-011, REQ-036, REQ-037, REQ-038, REQ-039,
   * REQ-040, ISSUE-008).
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
   * control, animation, or persisted display value.
   *
   * The supported image-key map is empty (ISSUE-008): an absent key, one
   * of the four seeded opaque keys, and every other unmapped key resolve to
   * the existing bundled placeholder through `resolveFoodImage`
   * (ARCH-015, REQ-011). The card image carries empty alternative text
   * because the adjacent card heading names the same Food Object, and a
   * failed image source resets to the same bundled placeholder.
   *
   * While a valid quantity recalculation is pending (task 34, ISSUE-010)
   * the `pending` prop replaces every quantity-dependent value — Matched
   * Quantity, protein, carbohydrate, and fat — with one aria-hidden `16px`
   * spinner, while the name, image, labels, and quantity-independent
   * similarity stay visible. The card never calculates or rerounds a
   * nutrition value in either state (REQ-040).
   */

  interface Props {
    /** One display-ready generated Substitute (ARCH-005, ARCH-008). */
    item: SubstituteItem;
    /** The active Interface Language used for the card's visible text. */
    language: InterfaceLanguage;
    /**
     * Whether a valid quantity recalculation is pending (task 34,
     * ISSUE-010): while set, every quantity-dependent card value —
     * Matched Quantity, protein, carbohydrate, and fat — is replaced by an
     * aria-hidden `16px` spinner, while the name, image, labels, and
     * quantity-independent similarity stay visible.
     */
    pending?: boolean;
  }

  let { item, language, pending = false }: Props = $props();

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
    const image = event.currentTarget as HTMLImageElement;
    if (image.getAttribute("src") !== foodPlaceholderUrl) {
      image.setAttribute("src", foodPlaceholderUrl);
    }
  }
</script>

<article
  data-result-card
  data-food-object-id={item.foodObjectId}
  class="overflow-hidden rounded-2xl border border-solid border-dark-secondary bg-dark-surface"
>
  <img
    data-result-card-image
    src={imageSrc}
    alt=""
    onerror={onImageError}
    class="h-44 w-full object-cover"
  />
  <div class="flex flex-col gap-2 p-4">
    <h3 class="text-center text-base font-medium text-dark-text-primary">
      {item.names[language]}
    </h3>
    <p
      data-result-card-matched-quantity
      class="text-center font-data text-sm text-dark-text-primary"
    >
      {#if pending}
        <span
          data-value-spinner
          aria-hidden="true"
          class="inline-block h-4 w-4 align-middle animate-spin rounded-full border-2 border-solid border-dark-secondary border-t-dark-primary"
        ></span>
      {:else}
        {`${item.matchedQuantity.value} ${item.matchedQuantity.unit}`}
      {/if}
    </p>
    <p
      data-result-card-calories
      aria-label={dictionary.caloriesLabel()}
      class="text-center font-data text-sm text-dark-text-primary"
    >
      {#if pending}
        <span
          data-value-spinner
          aria-hidden="true"
          class="inline-block h-4 w-4 align-middle animate-spin rounded-full border-2 border-solid border-dark-secondary border-t-dark-primary"
        ></span>
      {:else}
        {formatCaloriesValue(item.calories)}
      {/if}
    </p>
    <dl class="flex flex-col gap-1 font-data text-sm">
      <div class="flex items-baseline justify-between gap-4">
        <dt class="font-medium text-dark-text-muted">
          {dictionary.proteinLabel()}
        </dt>
        <dd class="text-right text-dark-text-primary">
          {#if pending}
            <span
              data-value-spinner
              aria-hidden="true"
              class="inline-block h-4 w-4 align-middle animate-spin rounded-full border-2 border-solid border-dark-secondary border-t-dark-primary"
            ></span>
          {:else}
            {formatMacronutrientValue(item.macronutrients.protein, language)}
          {/if}
        </dd>
      </div>
      <div class="flex items-baseline justify-between gap-4">
        <dt class="font-medium text-dark-text-muted">
          {dictionary.carbohydratesLabel()}
        </dt>
        <dd class="text-right text-dark-text-primary">
          {#if pending}
            <span
              data-value-spinner
              aria-hidden="true"
              class="inline-block h-4 w-4 align-middle animate-spin rounded-full border-2 border-solid border-dark-secondary border-t-dark-primary"
            ></span>
          {:else}
            {formatMacronutrientValue(
              item.macronutrients.carbohydrate,
              language,
            )}
          {/if}
        </dd>
      </div>
      <div class="flex items-baseline justify-between gap-4">
        <dt class="font-medium text-dark-text-muted">
          {dictionary.fatLabel()}
        </dt>
        <dd class="text-right text-dark-text-primary">
          {#if pending}
            <span
              data-value-spinner
              aria-hidden="true"
              class="inline-block h-4 w-4 align-middle animate-spin rounded-full border-2 border-solid border-dark-secondary border-t-dark-primary"
            ></span>
          {:else}
            {formatMacronutrientValue(item.macronutrients.fat, language)}
          {/if}
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
</article>
