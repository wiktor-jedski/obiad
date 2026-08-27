<script lang="ts">
  import type { SubstituteSearchResponse } from "../../client/types.gen";
  import {
    formatCaloriesValue,
    formatFoodQuantityValue,
    formatMacronutrientValue,
    getDictionary,
  } from "../i18n";
  import { interfaceLanguage } from "../interfaceLanguage";
  import {
    interactionState,
    type LoadingMoreInteractionState,
    type LoadingNewInteractionState,
    type MoreFailureInteractionState,
    type NewSearchFailureInteractionState,
    type QuantityUnit,
    type ResultsInteractionState,
    type ZeroResultsInteractionState,
  } from "../interactionState";
  import { substitutionSearchLock } from "../substitutionSearch";
  /**
   * Editable selected-food summary with localized quantity and nutrition values.
   * Draft validation, busy states, and accessible status stay in one region.
   */

  interface Props {
    /** Current non-empty interaction state. */
    interaction:
      | LoadingNewInteractionState
      | LoadingMoreInteractionState
      | ResultsInteractionState
      | ZeroResultsInteractionState
      | NewSearchFailureInteractionState
      | MoreFailureInteractionState;
    data: SubstituteSearchResponse | undefined;
    /** Whether a valid quantity recalculation is pending. */
    recalculating: boolean;
  }

  let { interaction, data, recalculating }: Props = $props();

  /** The active dictionary for the region's interface and validation text. */
  const dictionary = $derived(getDictionary($interfaceLanguage));
  /** The selected Food Object name in the active Interface Language. */
  const selectedName = $derived(interaction.selected.names[$interfaceLanguage]);
  /** Accessible selected-food value in the active language. */
  const selectedValue = $derived(
    `${selectedName} · ${formatFoodQuantityValue(
      { value: interaction.committedValue, unit: interaction.committedUnit },
      $interfaceLanguage,
    )}`,
  );
  /** Allowed quantity-editor units for the selected suggestion. */
  const allowedQuantities = $derived(interaction.selected.allowedQuantities);
  /** Whether two units are allowed; one base unit renders as static text. */
  const twoUnitsAllowed = $derived(allowedQuantities.length === 2);
  /** Allowed units ordered with the committed unit first. */
  const orderedUnits = $derived(
    twoUnitsAllowed
      ? [
          interaction.draftUnit,
          ...allowedQuantities
            .map((allowed) => allowed.unit)
            .filter((unit) => unit !== interaction.draftUnit),
        ]
      : [allowedQuantities[0].unit],
  );
  /** Whether the summary shows the initial new-Search pending interaction. */
  const initial = $derived(interaction.name === "loadingNew");
  /** Whether any quantity-dependent value is pending (initial or recalculation). */
  const busy = $derived(initial || recalculating);
  /** Whether quantity editing is blocked by loading, recalculation, or failure. */
  const locked = $derived(
    $substitutionSearchLock ||
      initial ||
      recalculating ||
      interaction.name === "moreFailure",
  );
  /**
   * Whether a locked editor is removed from the tab order.
   * Recalculation keeps its controls focusable but non-operable.
   */
  const removableLock = $derived(locked && !recalculating);
  /**
   * Whether a locked editor retains focus during recalculation.
   * Its controls remain focusable but non-operable.
   */
  const focusRetainingLock = $derived(locked && recalculating);
  const inputMacros = $derived(data?.inputMacronutrients);
  /** The response's input calories at the committed quantity, when present. */
  const inputCalories = $derived(data?.inputCalories);
  const QUANTITY_ERROR_ID = "quantity-error";
  /** Stable id for the polite editor status region. */
  const EDITOR_STATUS_ID = "quantity-editor-status";

  /**
   * One localized busy announcement per loading period.
   * The message is cleared when the period ends.
   */
  let announcement = $state("");
  let previousBusyKind: "initial" | "recalculating" | null = $state(null);
  $effect(() => {
    const kind = initial ? "initial" : recalculating ? "recalculating" : null;
    if (kind !== previousBusyKind) {
      previousBusyKind = kind;
      announcement =
        kind === "initial"
          ? dictionary.loadingNutritionValues()
          : kind === "recalculating"
            ? dictionary.updatingQuantities()
            : "";
    }
  });

  /** Returns the localized label for an allowed quantity unit. */
  function unitOptionLabel(unit: QuantityUnit): string {
    return unit === "serving" ? dictionary.servingsLabel() : unit;
  }

  /** Applies draft number text and updates validation without committing. */
  function onNumberInput(event: Event): void {
    const field = event.currentTarget;
    if (locked || !(field instanceof HTMLInputElement)) {
      return;
    }
    interactionState.setQuantityText(field.value);
  }

  /**
   * Commits a valid draft on Enter without moving focus.
   * An unchanged value starts no request.
   */
  function onNumberKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      if (locked) {
        return;
      }
      interactionState.commitQuantity();
    }
  }

  /** Applies a unit selection and commits its reset value immediately. */
  function onUnitChange(event: Event): void {
    const selector = event.currentTarget;
    if (locked || !(selector instanceof HTMLSelectElement)) {
      return;
    }
    const selected = allowedQuantities.find(
      (allowed) => allowed.unit === selector.value,
    );
    if (selected !== undefined) {
      interactionState.selectUnit(selected.unit);
    }
  }

  /**
   * Commits the draft when focus leaves the complete quantity editor.
   * Focus changes within the editor do not commit.
   */
  function onEditorFocusOut(event: FocusEvent): void {
    const editor = event.currentTarget;
    if (locked || !(editor instanceof HTMLElement)) {
      return;
    }
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !editor.contains(next)) {
      interactionState.commitQuantity();
    }
  }
</script>

<div
  data-selected-input
  data-selected-food-summary
  aria-busy={busy}
  class="relative w-full max-w-md rounded-2xl border border-solid border-dark-secondary bg-dark-surface p-4"
>
  <div
    data-card-content
    class="flex flex-col gap-3"
    class:opacity-0={busy}
    class:pointer-events-none={busy}
  >
    <!-- Localized accessible summary updates with the active language. -->
    <span class="sr-only"
      >{dictionary.selectedFoodLabel()}: {selectedValue}</span
    >

    <!-- The active localized Food Object name. -->
    <div
      data-selected-name
      class="text-center text-base font-medium text-dark-text-primary"
    >
      {selectedName}
    </div>

    <!-- Text input preserves invalid drafts; the disabled editor stays in place. -->
    <div
      data-quantity-editor
      onfocusout={onEditorFocusOut}
      class="flex flex-wrap items-center justify-center gap-2"
    >
      <label for="quantity-number" class="sr-only"
        >{dictionary.quantityLabel()}</label
      >
      <input
        id="quantity-number"
        data-quantity-number
        type="text"
        inputmode="decimal"
        autocomplete="off"
        spellcheck="false"
        value={interaction.quantityText}
        aria-invalid={interaction.quantityInvalid || undefined}
        aria-describedby={interaction.quantityInvalid
          ? QUANTITY_ERROR_ID
          : undefined}
        disabled={removableLock || undefined}
        aria-disabled={focusRetainingLock ? "true" : undefined}
        readonly={focusRetainingLock || undefined}
        oninput={onNumberInput}
        onkeydown={onNumberKeydown}
        class="h-11 w-28 rounded border border-solid border-dark-secondary bg-dark-surface px-3 font-data text-sm text-dark-text-primary placeholder:text-dark-text-muted focus-visible:border-dark-primary focus-visible:outline-none"
      />
      {#if twoUnitsAllowed}
        <label for="quantity-unit" class="sr-only"
          >{dictionary.unitLabel()}</label
        >
        <select
          id="quantity-unit"
          data-quantity-unit
          value={interaction.draftUnit}
          disabled={removableLock || undefined}
          aria-disabled={focusRetainingLock ? "true" : undefined}
          tabindex={focusRetainingLock ? -1 : undefined}
          onchange={onUnitChange}
          class="h-11 rounded border border-solid border-dark-secondary bg-dark-surface px-3 font-data text-sm text-dark-text-primary focus-visible:border-dark-primary focus-visible:outline-none"
        >
          {#each orderedUnits as unit (unit)}
            <option value={unit}>{unitOptionLabel(unit)}</option>
          {/each}
        </select>
      {:else}
        <!-- Associate static units with the visually hidden localized label. -->
        <span
          data-quantity-unit-presentation
          role="group"
          aria-labelledby="quantity-static-unit-label"
          class="inline-flex items-baseline gap-1"
        >
          <span id="quantity-static-unit-label" class="sr-only"
            >{dictionary.unitLabel()}</span
          >
          <span
            data-quantity-static-unit
            class="font-data text-sm text-dark-text-primary"
            >{allowedQuantities[0].unit}</span
          >
        </span>
      {/if}
    </div>
    <!-- Use a labeled group because paragraph aria-label is not allowed. -->
    <p
      data-input-calories
      role="group"
      aria-label={dictionary.caloriesLabel()}
      class="text-center font-data text-sm text-dark-text-primary"
    >
      {#if inputCalories !== undefined}
        {formatCaloriesValue(inputCalories)}
      {/if}
    </p>

    {#if interaction.quantityInvalid}
      <!-- The polite error is associated with the number field. -->
      <p
        id={QUANTITY_ERROR_ID}
        data-quantity-error
        aria-live="polite"
        class="font-data text-sm text-dark-error"
      >
        {dictionary.invalidQuantityMessage()}
      </p>
    {/if}

    <!-- Values come from the backend; pending state uses the card spinner. -->
    <dl data-input-macronutrients class="flex flex-col gap-1 font-data text-sm">
      <div class="flex items-baseline justify-between gap-4">
        <dt class="font-medium text-dark-text-muted">
          {dictionary.proteinLabel()}
        </dt>
        <dd data-input-macro-protein class="text-right text-dark-text-primary">
          {#if inputMacros !== undefined}
            {formatMacronutrientValue(inputMacros.protein, $interfaceLanguage)}
          {/if}
        </dd>
      </div>
      <div class="flex items-baseline justify-between gap-4">
        <dt class="font-medium text-dark-text-muted">
          {dictionary.carbohydratesLabel()}
        </dt>
        <dd
          data-input-macro-carbohydrate
          class="text-right text-dark-text-primary"
        >
          {#if inputMacros !== undefined}
            {formatMacronutrientValue(
              inputMacros.carbohydrate,
              $interfaceLanguage,
            )}
          {/if}
        </dd>
      </div>
      <div class="flex items-baseline justify-between gap-4">
        <dt class="font-medium text-dark-text-muted">
          {dictionary.fatLabel()}
        </dt>
        <dd data-input-macro-fat class="text-right text-dark-text-primary">
          {#if inputMacros !== undefined}
            {formatMacronutrientValue(inputMacros.fat, $interfaceLanguage)}
          {/if}
        </dd>
      </div>
    </dl>
  </div>
  {#if busy}
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-0 flex items-center justify-center"
    >
      <span
        data-card-spinner
        aria-hidden="true"
        class="h-4 w-4 animate-spin rounded-full border-2 border-solid border-dark-secondary border-t-dark-primary"
      ></span>
    </div>
  {/if}

  <!-- Announce one localized busy status for each pending period. -->
  <span
    id={EDITOR_STATUS_ID}
    data-editor-status
    aria-live="polite"
    class="sr-only">{announcement}</span
  >
</div>
