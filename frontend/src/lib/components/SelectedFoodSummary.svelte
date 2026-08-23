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
    type LoadingNewInteractionState,
    type QuantityUnit,
    type ResultsInteractionState,
    type ZeroResultsInteractionState,
  } from "../interactionState";

  /**
   * ISSUE-010 editable selected-food summary (task 34; ARCH-001, ARCH-002,
   * ARCH-003, ARCH-008, ARCH-011, ARCH-018, ARCH-019, ARCH-020, ARCH-022,
   * REQ-025, REQ-026, REQ-027, REQ-028).
   *
   * From selection onward the region renders one unbordered five-row
   * summary at every supported width: the captured localized food name;
   * the number field with a current-unit-first selector when two units are
   * allowed or static `g`/`ml` text when only one is allowed; then the
   * backend-provided protein, carbohydrate, and fat rows using the
   * existing captured-language labels and one-decimal formatting. The
   * existing `Selected food` / `Wybrany produkt` region name, the number
   * field's `Quantity` / `Ilość` name, and the unit control's `Unit` /
   * `Jednostka` name stay as visually hidden accessible text; the selector
   * options are labeled `g`, `ml`, `servings`, or `porcje`. The captured
   * `localized name · quantity unit` value stays present as accessible
   * text so the region's selection summary never re-translates with the
   * active Interface Language (ISSUE-008).
   *
   * During the initial new Search the complete summary renders with
   * disabled controls, one aria-hidden `16px` spinner in each
   * input-macronutrient value position, the region marked busy, and one
   * polite announcement of `Loading nutrition values` / `Ładowanie
   * wartości odżywczych`. After success the summary shows the committed
   * quantity editor enabled and the response's input macronutrients.
   *
   * The number control is a text input so every invalid raw value remains
   * visible. The exact raw text stays in the interaction state until Enter
   * or focus leaves the complete quantity editor (the number field plus
   * the unit selector together) commits it; moving focus inside the editor
   * never commits an old unit before a selector change. A unit selection
   * replaces the draft with `1` for Serving or `100` for a base unit and
   * commits immediately. A syntactically valid value above the selected
   * maximum is silently replaced by that whole maximum before commit with
   * no visible or assistive clamp notice; a draft that resolves to the
   * committed value clears validation but starts no request. An invalid
   * commit keeps the exact text, starts no request, sets `aria-invalid`,
   * and shows the localized `Enter a valid quantity.` / `Wpisz prawidłową
   * ilość.` message through an associated polite live element; natural
   * focus is unchanged, and the error clears as soon as the draft becomes
   * syntactically valid.
   *
   * While a valid recalculation is pending, the controls stay enabled,
   * the region stays busy, the summary macronutrient values are replaced
   * by aria-hidden `16px` spinners, and one polite `Updating quantities`
   * / `Aktualizowanie ilości` announcement fires. The summary renders only
   * the current response's backend values; Phase 12 owns request-failure
   * presentation, so a missing response keeps the value spinners visible.
   */

  interface Props {
    /** The current non-empty interaction state (ARCH-002). */
    interaction:
      | LoadingNewInteractionState
      | ResultsInteractionState
      | ZeroResultsInteractionState;
    /** The current Substitution Search response, or undefined while none exists. */
    data: SubstituteSearchResponse | undefined;
    /** Whether a valid quantity recalculation is pending (ISSUE-010). */
    recalculating: boolean;
  }

  let { interaction, data, recalculating }: Props = $props();

  /** The active dictionary for the region's interface and validation text. */
  const dictionary = $derived(getDictionary($interfaceLanguage));
  /**
   * The dictionary of the captured Interface Language for the food name
   * and macronutrient labels and values (ISSUE-008).
   */
  const capturedDictionary = $derived(
    getDictionary(interaction.selected.capturedLanguage),
  );
  /** The captured localized food name (ISSUE-008). */
  const capturedName = $derived(
    interaction.selected.names[interaction.selected.capturedLanguage],
  );
  /**
   * The captured `localized name · quantity unit` accessible value
   * (ISSUE-008): the same combined value the read-only Substitution Input
   * rendered before Phase 10, computed from the committed transport
   * quantity and the Interface Language captured at selection so it never
   * re-translates with the active Interface Language.
   */
  const capturedValue = $derived(
    `${capturedName} · ${formatFoodQuantityValue(
      { value: interaction.committedValue, unit: interaction.committedUnit },
      interaction.selected.capturedLanguage,
    )}`,
  );
  /** The selected suggestion's allowed quantity-editor units (task 33). */
  const allowedQuantities = $derived(interaction.selected.allowedQuantities);
  /** Whether two units are allowed; one base unit renders as static text. */
  const twoUnitsAllowed = $derived(allowedQuantities.length === 2);
  /**
   * The selector options in current-unit-first order (ISSUE-010): the
   * committed unit first, then the other allowed unit. The option order
   * follows the committed quantity so the selector always leads with the
   * current unit.
   */
  const orderedUnits = $derived(
    twoUnitsAllowed
      ? ([
          interaction.draftUnit,
          ...allowedQuantities
            .map((allowed) => allowed.unit)
            .filter((unit) => unit !== interaction.draftUnit),
        ] as QuantityUnit[])
      : ([allowedQuantities[0].unit] as QuantityUnit[]),
  );
  /** Whether the summary shows the initial new-Search pending interaction. */
  const initial = $derived(interaction.name === "loadingNew");
  /** Whether any quantity-dependent value is pending (initial or recalculation). */
  const busy = $derived(initial || recalculating);
  /** The response's input macronutrients at the committed quantity, when present. */
  const inputMacros = $derived(data?.inputMacronutrients);
  /** The response's input calories at the committed quantity, when present. */
  const inputCalories = $derived(data?.inputCalories);
  const QUANTITY_ERROR_ID = "quantity-error";
  /** The stable id of the polite editor status live region (ISSUE-010). */
  const EDITOR_STATUS_ID = "quantity-editor-status";

  /**
   * The polite busy announcement currently held by the editor status live
   * region. It is set exactly once per busy period — `Loading nutrition
   * values` while the initial new Search is pending and `Updating
   * quantities` while a recalculation is pending — and cleared when the
   * period ends, so a screen reader announces the status once (ISSUE-010).
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

  /**
   * The localized option label of one allowed unit (ISSUE-010): `g` and
   * `ml` stay invariant, and the Serving unit uses the plural selector
   * label `servings` / `porcje`.
   */
  function unitOptionLabel(unit: QuantityUnit): string {
    return unit === "serving" ? dictionary.servingsLabel() : unit;
  }

  /**
   * Applies draft number text from the quantity editor. The exact raw text
   * stays in the interaction state; the validation state follows the
   * ISSUE-010 syntax of the current unit, and an error clears as soon as
   * the draft becomes syntactically valid without committing it.
   */
  function onNumberInput(event: Event): void {
    interactionState.setQuantityText(
      (event.currentTarget as HTMLInputElement).value,
    );
  }

  /**
   * Commits the draft number on Enter while retaining number-field focus
   * (ISSUE-010). Enter never blurs the field; a valid commit that resolves
   * to the committed value starts no request.
   */
  function onNumberKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      interactionState.commitQuantity();
    }
  }

  /**
   * Applies a unit selection: the draft is replaced with `1` for Serving
   * or `100` for a base unit and committed immediately (ISSUE-010).
   */
  function onUnitChange(event: Event): void {
    interactionState.selectUnit(
      (event.currentTarget as HTMLSelectElement).value as QuantityUnit,
    );
  }

  /**
   * Commits the draft number when focus leaves the complete quantity
   * editor (the number field and the unit selector together). Moving focus
   * inside the editor — for example from the number field to the selector
   * — never commits an old unit before a selector change, so the
   * `relatedTarget` check commits only on a real exit (ISSUE-010).
   */
  function onEditorFocusOut(event: FocusEvent): void {
    const editor = event.currentTarget as HTMLElement;
    const next = event.relatedTarget as Node | null;
    if (next === null || !editor.contains(next)) {
      interactionState.commitQuantity();
    }
  }
</script>

<div
  data-selected-input
  data-selected-food-summary
  aria-busy={busy}
  class="flex w-full max-w-md flex-col gap-3 rounded-2xl border border-solid border-dark-secondary bg-dark-surface p-4"
>
  <!--
    Visually hidden region label and captured selection summary (ISSUE-008,
    ISSUE-010): the `Selected food` / `Wybrany produkt` region name and the
    captured `localized name · quantity unit` value stay accessible text,
    so the selection summary never re-translates with the active Interface
    Language.
  -->
  <span class="sr-only">{dictionary.selectedFoodLabel()}: {capturedValue}</span>

  <!-- Row 1: the captured localized food name (ISSUE-010). -->
  <div data-selected-name class="text-base font-medium text-dark-text-primary">
    {capturedName}
  </div>

  <!--
    Row 2: the quantity editor. A text input keeps every invalid raw value
    visible (REQ-025, REQ-026); the unit control is a native selector with
    the committed unit first when two units are allowed, or static `g`/`ml`
    text when only one is allowed (ISSUE-010). During the initial new
    Search the complete editor is disabled.
  -->
  <div
    data-quantity-editor
    onfocusout={onEditorFocusOut}
    class="flex flex-wrap items-center gap-2"
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
      disabled={initial}
      oninput={onNumberInput}
      onkeydown={onNumberKeydown}
      class="h-11 w-28 rounded border border-solid border-dark-secondary bg-dark-surface px-3 font-data text-sm text-dark-text-primary placeholder:text-dark-text-muted focus-visible:border-dark-primary focus-visible:outline-none disabled:opacity-60"
    />
    {#if twoUnitsAllowed}
      <label for="quantity-unit" class="sr-only">{dictionary.unitLabel()}</label
      >
      <select
        id="quantity-unit"
        data-quantity-unit
        value={interaction.draftUnit}
        disabled={initial}
        onchange={onUnitChange}
        class="h-11 rounded border border-solid border-dark-secondary bg-dark-surface px-3 font-data text-sm text-dark-text-primary focus-visible:border-dark-primary focus-visible:outline-none disabled:opacity-60"
      >
        {#each orderedUnits as unit (unit)}
          <option value={unit}>{unitOptionLabel(unit)}</option>
        {/each}
      </select>
    {:else}
      <!--
        One-unit static presentation (ISSUE-010): the visible `g` or `ml`
        value keeps the visually hidden localized `Unit` / `Jednostka`
        label associated through `aria-labelledby`, mirroring the label
        the two-unit selector receives, so a screen reader never hears an
        unlabeled adjacent unit text.
      -->
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

  {#if interaction.quantityInvalid}
    <!--
      The associated polite live quantity error (REQ-026, ISSUE-010): the
      exact localized message is visible, announced politely, referenced by
      the number field's `aria-describedby`, and removed as soon as the
      draft becomes syntactically valid. Natural focus never moves.
    -->
    <p
      id={QUANTITY_ERROR_ID}
      data-quantity-error
      aria-live="polite"
      class="font-data text-sm text-dark-error"
    >
      {dictionary.invalidQuantityMessage()}
    </p>
  {/if}

  <!--
    Rows 3-5: the backend-provided input macronutrients at the committed
    quantity (task 33, ISSUE-010), using the captured-language labels and
    one-decimal formatting. While a value is pending — the initial new
    Search or a recalculation — each value position shows one aria-hidden
    `16px` spinner instead; the browser never calculates or rerounds
    nutrition (REQ-040).
  -->
  <dl data-input-macronutrients class="flex flex-col gap-1 font-data text-sm">
    <div class="flex items-baseline justify-between gap-4">
      <dt class="font-medium text-dark-text-muted">
        {capturedDictionary.proteinLabel()}
      </dt>
      <dd data-input-macro-protein class="text-right text-dark-text-primary">
        {#if busy || inputMacros === undefined}
          <span
            data-value-spinner
            aria-hidden="true"
            class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-dark-secondary border-t-dark-primary"
          ></span>
        {:else}
          {formatMacronutrientValue(
            inputMacros.protein,
            interaction.selected.capturedLanguage,
          )}
        {/if}
      </dd>
    </div>
    <div class="flex items-baseline justify-between gap-4">
      <dt class="font-medium text-dark-text-muted">
        {capturedDictionary.carbohydratesLabel()}
      </dt>
      <dd
        data-input-macro-carbohydrate
        class="text-right text-dark-text-primary"
      >
        {#if busy || inputMacros === undefined}
          <span
            data-value-spinner
            aria-hidden="true"
            class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-dark-secondary border-t-dark-primary"
          ></span>
        {:else}
          {formatMacronutrientValue(
            inputMacros.carbohydrate,
            interaction.selected.capturedLanguage,
          )}
        {/if}
      </dd>
    </div>
    <div class="flex items-baseline justify-between gap-4">
      <dt class="font-medium text-dark-text-muted">
        {capturedDictionary.fatLabel()}
      </dt>
      <dd data-input-macro-fat class="text-right text-dark-text-primary">
        {#if busy || inputMacros === undefined}
          <span
            data-value-spinner
            aria-hidden="true"
            class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-dark-secondary border-t-dark-primary"
          ></span>
        {:else}
          {formatMacronutrientValue(
            inputMacros.fat,
            interaction.selected.capturedLanguage,
          )}
        {/if}
      </dd>
    </div>
    <div class="flex items-baseline justify-between gap-4">
      <dt class="font-medium text-dark-text-muted">
        {capturedDictionary.caloriesLabel()}
      </dt>
      <dd data-input-calories class="text-right text-dark-text-primary">
        {#if busy || inputCalories === undefined}
          <span
            data-value-spinner
            aria-hidden="true"
            class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-dark-secondary border-t-dark-primary"
          ></span>
        {:else}
          {formatCaloriesValue(inputCalories)}
        {/if}
      </dd>
    </div>
  </dl>

  <!--
    The polite busy status live region (ISSUE-010): it carries exactly one
    localized announcement per pending period — `Loading nutrition values`
    for the initial new Search and `Updating quantities` for a
    recalculation — so a screen reader announces the status once.
  -->
  <span
    id={EDITOR_STATUS_ID}
    data-editor-status
    aria-live="polite"
    class="sr-only">{announcement}</span
  >
</div>
