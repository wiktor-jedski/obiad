<script lang="ts">
  // Throwaway: compare unit controls C–F on /?variant=; A/B remain available by URL.
  import { untrack } from "svelte";
  import type { SubstituteSearchResponse } from "../../../client/types.gen";
  import { interactionState, type InteractionState, type EmptyInteractionState, type QuantityUnit } from "../../interactionState";
  import { interfaceLanguage } from "../../interfaceLanguage";
  import { getDictionary } from "../../i18n";
  import { projectSubstitutePage } from "../../substituteProjection";
  import PrototypeSwitcher from "../PrototypeSwitcher.svelte";
  import PrototypeFoodCard from "./PrototypeFoodCard.svelte";
  import VariantA from "./VariantA.svelte";
  import VariantB from "./VariantB.svelte";
  import VariantC from "./VariantC.svelte";
  import PrototypeNumberEditor from "./PrototypeNumberEditor.svelte";

  type EditableField = "quantity" | "calories" | "protein" | "carbohydrate" | "fat";

  let { interaction, response, locked, onmore }: {
    interaction: Exclude<InteractionState, EmptyInteractionState>;
    response: SubstituteSearchResponse | undefined;
    locked: boolean;
    onmore: () => void;
  } = $props();

  const initialVariant = new URLSearchParams(window.location.search).get("variant");
  let variant = $state(initialVariant && ["A", "B", "C", "D", "E", "F"].includes(initialVariant) ? initialVariant : "C");
  const cardVariant = $derived(variant === "A" || variant === "B" ? variant : "C");
  let pages = $state.raw<SubstituteSearchResponse[]>([]);
  let sentinel: HTMLDivElement | undefined = $state();
  let enteredBaseQuantity: number | undefined = $state();
  let chosenUnit: QuantityUnit | undefined = $state();
  let editorError = $state("");
  let lastEditedField = $state<EditableField>("quantity");
  const dictionary = $derived(getDictionary($interfaceLanguage));
  const selectedFood = $derived(pages[0]?.selectedFood);
  const latest = $derived(pages.at(-1));
  const baseQuantity = $derived(enteredBaseQuantity ?? interaction.committedValue *
    (interaction.committedUnit === "serving" ? (selectedFood?.serving ?? 1) : 1));
  const displayUnit = $derived(chosenUnit ?? interaction.committedUnit);
  const quantity = $derived(cardVariant === "C"
    ? { value: displayUnit === "serving" ? baseQuantity / (selectedFood?.serving ?? 1) : baseQuantity, unit: displayUnit }
    : { value: interaction.committedValue, unit: interaction.committedUnit });
  const maximumBaseQuantity = $derived(interaction.selected.allowedQuantities.find((allowed) =>
    allowed.unit !== "serving")!.maximumValue);
  const projection = $derived(selectedFood ? projectSubstitutePage(
    selectedFood,
    pages.flatMap((page) => page.items),
    cardVariant === "C" ? { value: baseQuantity, unit: selectedFood.baseUnit } : quantity,
  ) : undefined);
  const selectedCard = $derived(selectedFood && projection ? {
    ...selectedFood,
    quantity,
    calories: projection.inputCalories,
    macronutrients: projection.inputMacronutrients,
  } : undefined);
  const title = $derived($interfaceLanguage === "pl" ? "Inny posiłek. Tyle samo kalorii." : "Different food. Same calories.");
  const subtitle = $derived($interfaceLanguage === "pl" ? "Zamienniki według podobieństwa makroskładników" : "Substitutes ranked by macro similarity");

  // Keep raw pages so quantity edits also update all earlier cards.
  $effect(() => {
    if (response && response.selectedFood.foodObjectId === interaction.selected.foodObjectId) {
      const previous = untrack(() => pages);
      if (previous[response.pageIndex] !== response) {
        pages = [...previous.slice(0, response.pageIndex), response];
      }
    }
  });

  $effect(() => {
    if (!sentinel || !latest?.hasMore || locked || interaction.name !== "results") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onmore();
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  function commitOnExit(event: FocusEvent): void {
    if (locked) return;
    const editor = event.currentTarget as HTMLElement;
    if (!(event.relatedTarget instanceof Node) || !editor.contains(event.relatedTarget)) interactionState.commitQuantity();
  }

  function fieldLabel(field: EditableField): string {
    switch (field) {
      case "quantity": return dictionary.quantityLabel();
      case "calories": return dictionary.caloriesLabel();
      case "protein": return dictionary.proteinLabel();
      case "carbohydrate": return dictionary.carbohydratesLabel();
      case "fat": return dictionary.fatLabel();
    }
  }

  function fieldBasis(field: EditableField): number {
    if (!selectedFood) return 0;
    if (field === "quantity") return 100 / (displayUnit === "serving" ? selectedFood.serving! : 1);
    const profile = selectedFood.macroProfile;
    return field === "calories"
      ? 4 * profile.protein + 4 * profile.carbohydrate + 9 * profile.fat
      : profile[field];
  }

  function commitField(field: EditableField, value: number): string | undefined {
    const maximumValue = field === "quantity"
      ? interaction.selected.allowedQuantities.find((allowed) => allowed.unit === displayUnit)!.maximumValue
      : maximumBaseQuantity * fieldBasis(field) / 100;
    const nextBaseQuantity = field === "quantity"
      ? value * (displayUnit === "serving" ? selectedFood!.serving! : 1)
      : value * 100 / fieldBasis(field);
    if (!Number.isFinite(nextBaseQuantity) || nextBaseQuantity <= 0 || value > maximumValue) {
      const maximum = maximumValue.toLocaleString($interfaceLanguage, { maximumFractionDigits: 2 });
      return $interfaceLanguage === "pl"
        ? `Wartość przekracza limit porcji. Maksimum dla tego pola: ${maximum}.`
        : `The value exceeds the portion limit. Maximum for this field: ${maximum}.`;
    }
    enteredBaseQuantity = nextBaseQuantity;
    lastEditedField = field;
  }

  function chooseUnit(unit: QuantityUnit): void {
    chosenUnit = unit;
    editorError = "";
  }

  function onUnitKeydown(event: KeyboardEvent, unit: QuantityUnit): void {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const next = event.key === "Home" ? selectedFood!.baseUnit
      : event.key === "End" ? "serving"
      : unit === "serving" ? selectedFood!.baseUnit : "serving";
    chooseUnit(next);
    (event.currentTarget as HTMLButtonElement).parentElement
      ?.querySelector<HTMLButtonElement>(`[data-unit="${next}"]`)?.focus();
  }
</script>

<svelte:head>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@500;600&family=Lato:wght@400;700&family=Source+Serif+4:wght@400;600&display=swap" />
</svelte:head>

{#snippet quantityEditor()}
  <div class="flex flex-wrap items-center gap-2" onfocusout={commitOnExit}>
    <label class="sr-only" for="prototype-quantity">{dictionary.quantityLabel()}</label>
    <input
      id="prototype-quantity"
      type="text"
      inputmode="decimal"
      value={interaction.quantityText}
      disabled={locked || interaction.name === "moreFailure"}
      aria-invalid={interaction.quantityInvalid}
      aria-describedby={interaction.quantityInvalid ? "prototype-quantity-error" : undefined}
      oninput={(event) => interactionState.setQuantityText(event.currentTarget.value)}
      onkeydown={(event) => { if (event.key === "Enter") { event.preventDefault(); interactionState.commitQuantity(); } }}
      class="h-11 rounded border border-dark-secondary/50 bg-dark-background focus-visible:outline-2 focus-visible:outline-dark-primary {variant === 'C' ? 'w-[6ch] px-1 text-lg' : 'w-20 px-3 text-base'}"
    />
    <label class="sr-only" for="prototype-unit">{dictionary.unitLabel()}</label>
    <select
      id="prototype-unit"
      value={interaction.draftUnit}
      disabled={locked || interaction.name === "moreFailure"}
      onchange={(event) => {
        const allowed = interaction.selected.allowedQuantities.find((item) => item.unit === event.currentTarget.value);
        if (allowed) interactionState.selectUnit(allowed.unit);
      }}
      class="h-11 min-w-0 rounded border border-dark-secondary/50 bg-dark-background focus-visible:outline-2 focus-visible:outline-dark-primary {variant === 'C' ? 'px-1 text-lg' : 'px-2 text-base'}"
    >
      {#each interaction.selected.allowedQuantities as allowed (allowed.unit)}
        <option value={allowed.unit}>{allowed.unit === "serving" ? dictionary.servingsLabel() : allowed.unit}</option>
      {/each}
    </select>
    {#if interaction.quantityInvalid}
      <p id="prototype-quantity-error" role="status" class="w-full text-sm text-dark-error">{dictionary.invalidQuantityMessage()}</p>
    {/if}
  </div>
{/snippet}

{#snippet numberEditor(field: EditableField, value: number)}
  <span class={field === "quantity" && variant === "D" ? "inline-flex w-[7ch] shrink-0" : "contents"}>
    <PrototypeNumberEditor
      {field}
      label={fieldLabel(field)}
      {value}
      precision={field === "quantity" ? (displayUnit === "serving" ? 2 : 0) : field === "calories" ? 0 : 1}
      language={$interfaceLanguage}
      readonly={fieldBasis(field) === 0}
      fixedSlot={field === "quantity" && variant === "D"}
      oncommit={(next) => commitField(field, next)}
      onerror={(message) => editorError = message}
    />
  </span>
{/snippet}

{#snippet unitToggle()}
  <div
    role="radiogroup"
    aria-label={dictionary.unitLabel()}
    data-prototype-unit-toggle
    class="group/unit relative inline-flex shrink-0 items-center rounded-full border border-dark-secondary/40 bg-dark-background p-0.5 hover:border-dark-primary hover:bg-dark-primary/10 focus-within:border-dark-primary"
  >
    <span
      aria-hidden="true"
      class="pointer-events-none absolute top-0.5 left-0.5 size-8 rounded-full bg-dark-primary group-hover/unit:bg-dark-secondary motion-safe:transition-transform motion-safe:duration-200 lg:size-9 {displayUnit === 'serving' ? 'translate-x-8 lg:translate-x-9' : ''}"
    ></span>
    {#each interaction.selected.allowedQuantities.toSorted((a, b) => Number(a.unit === "serving") - Number(b.unit === "serving")) as allowed (allowed.unit)}
      <button
        type="button"
        role="radio"
        data-unit={allowed.unit}
        aria-label={allowed.unit === "serving" ? `ea (${dictionary.servingsLabel()})` : allowed.unit}
        aria-checked={displayUnit === allowed.unit}
        tabindex={displayUnit === allowed.unit ? 0 : -1}
        onclick={() => chooseUnit(allowed.unit)}
        onkeydown={(event) => onUnitKeydown(event, allowed.unit)}
        class="relative z-10 flex size-8 cursor-pointer items-center justify-center rounded-full p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dark-primary lg:size-9 {displayUnit === allowed.unit ? 'text-dark-text-on-bright' : 'text-dark-text-muted group-hover/unit:text-dark-secondary'}"
      >{allowed.unit === "serving" ? "ea" : allowed.unit}</button>
    {/each}
  </div>
{/snippet}

{#snippet wholeUnitToggle()}
  <button
    type="button"
    aria-label={dictionary.servingsLabel()}
    aria-pressed={displayUnit === "serving"}
    data-prototype-unit-toggle
    onclick={() => chooseUnit(displayUnit === "serving" ? selectedFood!.baseUnit : "serving")}
    class="group/unit relative inline-flex shrink-0 cursor-pointer items-center rounded-full border border-dark-secondary/40 bg-dark-background p-0.5 outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-dark-primary"
  >
    <span
      aria-hidden="true"
      class="pointer-events-none absolute top-0.5 left-0.5 size-8 rounded-full bg-dark-primary motion-safe:transition-transform motion-safe:duration-200 lg:size-9 {displayUnit === 'serving' ? 'translate-x-8 lg:translate-x-9' : ''}"
    ></span>
    {#each interaction.selected.allowedQuantities.toSorted((a, b) => Number(a.unit === "serving") - Number(b.unit === "serving")) as allowed (allowed.unit)}
      <span
        aria-hidden="true"
        data-unit={allowed.unit}
        class="relative z-10 flex size-8 items-center justify-center rounded-full lg:size-9 {displayUnit === allowed.unit ? 'text-dark-text-on-bright group-hover/unit:text-dark-surface' : 'text-dark-text-muted group-hover/unit:text-dark-secondary'}"
      >{allowed.unit === "serving" ? "ea" : allowed.unit}</span>
    {/each}
  </button>
{/snippet}

{#snippet portionEditor()}
  <div class="flex min-w-0 items-center gap-1">
    {#if variant === "E" && interaction.selected.allowedQuantities.length > 1}
      {@render unitToggle()}
    {/if}
    {@render numberEditor("quantity", quantity.value)}
    {#if variant === "F" || interaction.selected.allowedQuantities.length === 1}
      <span>{displayUnit === "serving" ? "ea" : displayUnit}</span>
    {:else if variant !== "E"}
      {@render unitToggle()}
    {/if}
  </div>
{/snippet}

{#snippet selected()}
  {#if selectedCard}
    <PrototypeFoodCard
      food={selectedCard}
      language={$interfaceLanguage}
      variant={cardVariant}
      editor={cardVariant === "C" ? portionEditor : quantityEditor}
      nutritionEditor={cardVariant === "C" ? numberEditor : undefined}
      titleControl={variant === "F" && interaction.selected.allowedQuantities.length > 1 ? wholeUnitToggle : undefined}
    />
    {#if cardVariant === "C" && editorError}
      <p id="prototype-edit-error" role="status" class="mt-3 text-sm text-dark-error">{editorError}</p>
    {/if}
  {/if}
{/snippet}

{#snippet results()}
  {#each projection?.items ?? [] as item, index (item.foodObjectId)}
    <PrototypeFoodCard food={{ ...item, quantity: item.matchedQuantity }} language={$interfaceLanguage} variant={cardVariant} rank={index + 1} />
  {/each}
{/snippet}

<section data-results-prototype data-variant={variant} data-layout={cardVariant} class="prototype-results mt-10 pb-36 text-dark-text-primary">
  {#if selectedCard}
    {#if variant === "A"}
      <VariantA {selected} {results} {title} {subtitle} />
    {:else if variant === "B"}
      <VariantB {selected} {results} {title} {subtitle} />
    {:else}
      <VariantC {selected} {results} selectedHeading={dictionary.selectedFoodLabel()} substitutesHeading={$interfaceLanguage === "pl" ? "Zamienniki" : "Substitutes"} />
    {/if}
  {:else}
    <p role="status" class="text-center">{interaction.selected.names[$interfaceLanguage]} · {dictionary.loadingNutritionValues()}</p>
  {/if}

  <div bind:this={sentinel} data-prototype-sentinel class="mt-8 flex min-h-16 items-center justify-center" aria-live="polite">
    {#if interaction.name === "loadingMore"}
      <span role="status" class="flex justify-center">
        <span data-prototype-spinner class="size-6 rounded-full border-2 border-dark-secondary/25 border-t-dark-primary motion-safe:animate-spin"></span>
        <span class="sr-only">{dictionary.loadingNutritionValues()}</span>
      </span>
    {:else if interaction.name === "moreFailure"}
      <button onclick={onmore} class="min-h-11 rounded border border-dark-secondary px-4 text-sm">{dictionary.retryMessage()}</button>
    {:else if interaction.name === "newSearchFailure"}
      <p>{dictionary.retryMessage()}</p>
    {:else if latest && !latest.hasMore}
      <p class="text-sm text-dark-text-muted">{latest.totalEligibleCount === 0 ? dictionary.zeroResultsMessage() : ($interfaceLanguage === "pl" ? "To wszystkie zamienniki." : "You have seen all substitutes.")}</p>
    {/if}
  </div>
</section>

<PrototypeSwitcher {variant} onchange={(value) => variant = value} state={`${interaction.name} · ${projection?.items.length ?? 0}/${latest?.totalEligibleCount ?? "—"} results · page ${latest ? latest.pageIndex + 1 : 0} · ${cardVariant === "C" ? `${baseQuantity} ${selectedFood?.baseUnit ?? ""} · ${displayUnit === "serving" ? "ea" : displayUnit} · ${lastEditedField}` : `${quantity.value} ${quantity.unit}`} · ${$interfaceLanguage}`} />

<style>
  .prototype-results { --prototype-font: "Lato", sans-serif; }
  .prototype-results[data-variant="B"] { --prototype-font: "Barlow Semi Condensed", sans-serif; }
  .prototype-results[data-layout="C"] { --prototype-font: "Source Serif 4", serif; }
  .prototype-results :global(.prototype-numbers) { font-family: var(--prototype-font); font-variant-numeric: lining-nums tabular-nums; }
  .prototype-results :global(.prototype-card) { display: grid; grid-template-columns: minmax(0, 1fr); }
  @media (min-width: 640px) {
    .prototype-results :global(.prototype-card) { grid-template-columns: 36% minmax(0, 1fr); align-items: center; }
    .prototype-results :global(.prototype-card img) { align-self: start; }
    .prototype-results[data-variant="B"] :global(.prototype-card) { grid-template-columns: 30% minmax(0, 1fr); border-radius: 6px; }
    .prototype-results[data-layout="C"] :global(.prototype-card) { grid-template-columns: 38% minmax(0, 1fr); }
    .prototype-results[data-layout="C"] :global([data-prototype-details]) { padding: 28px; }
  }
</style>
