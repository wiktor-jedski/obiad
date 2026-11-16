<script lang="ts">
  // Throwaway: three results designs on /?variant=A|B|C; retain the real search API.
  import { untrack } from "svelte";
  import type { SubstituteSearchResponse } from "../../../client/types.gen";
  import { interactionState, type InteractionState, type EmptyInteractionState } from "../../interactionState";
  import { interfaceLanguage } from "../../interfaceLanguage";
  import { getDictionary } from "../../i18n";
  import { projectSubstitutePage } from "../../substituteProjection";
  import PrototypeSwitcher from "../PrototypeSwitcher.svelte";
  import PrototypeFoodCard from "./PrototypeFoodCard.svelte";
  import VariantA from "./VariantA.svelte";
  import VariantB from "./VariantB.svelte";
  import VariantC from "./VariantC.svelte";

  let { interaction, response, locked, onmore }: {
    interaction: Exclude<InteractionState, EmptyInteractionState>;
    response: SubstituteSearchResponse | undefined;
    locked: boolean;
    onmore: () => void;
  } = $props();

  const initialVariant = new URLSearchParams(window.location.search).get("variant");
  let variant = $state(initialVariant === "B" || initialVariant === "C" ? initialVariant : "A");
  let pages = $state.raw<SubstituteSearchResponse[]>([]);
  let sentinel: HTMLDivElement | undefined = $state();
  const dictionary = $derived(getDictionary($interfaceLanguage));
  const selectedFood = $derived(pages[0]?.selectedFood);
  const latest = $derived(pages.at(-1));
  const quantity = $derived({ value: interaction.committedValue, unit: interaction.committedUnit });
  const projection = $derived(selectedFood ? projectSubstitutePage(selectedFood, pages.flatMap((page) => page.items), quantity) : undefined);
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
      class="h-11 rounded border border-dark-secondary/50 bg-dark-background text-base focus-visible:outline-2 focus-visible:outline-dark-primary {variant === 'C' ? 'w-[7ch] px-1' : 'w-20 px-3'}"
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
      class="h-11 min-w-0 rounded border border-dark-secondary/50 bg-dark-background text-base focus-visible:outline-2 focus-visible:outline-dark-primary {variant === 'C' ? 'px-1' : 'px-2'}"
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

{#snippet selected()}
  {#if selectedCard}
    <PrototypeFoodCard food={selectedCard} language={$interfaceLanguage} {variant} editor={quantityEditor} />
  {/if}
{/snippet}

{#snippet results()}
  {#each projection?.items ?? [] as item, index (item.foodObjectId)}
    <PrototypeFoodCard food={{ ...item, quantity: item.matchedQuantity }} language={$interfaceLanguage} {variant} rank={index + 1} />
  {/each}
{/snippet}

<section data-results-prototype data-variant={variant} class="prototype-results mt-10 pb-36 text-dark-text-primary">
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

<PrototypeSwitcher {variant} onchange={(value) => variant = value} state={`${interaction.name} · ${projection?.items.length ?? 0}/${latest?.totalEligibleCount ?? "—"} results · page ${latest ? latest.pageIndex + 1 : 0} · ${quantity.value} ${quantity.unit} · ${$interfaceLanguage}`} />

<style>
  .prototype-results { --prototype-font: "Lato", sans-serif; }
  .prototype-results[data-variant="B"] { --prototype-font: "Barlow Semi Condensed", sans-serif; }
  .prototype-results[data-variant="C"] { --prototype-font: "Source Serif 4", serif; }
  .prototype-results :global(.prototype-numbers) { font-family: var(--prototype-font); font-variant-numeric: lining-nums tabular-nums; }
  .prototype-results :global(.prototype-card) { display: grid; grid-template-columns: minmax(0, 1fr); }
  @media (min-width: 640px) {
    .prototype-results :global(.prototype-card) { grid-template-columns: 36% minmax(0, 1fr); align-items: center; }
    .prototype-results :global(.prototype-card img) { align-self: start; }
    .prototype-results[data-variant="B"] :global(.prototype-card) { grid-template-columns: 30% minmax(0, 1fr); border-radius: 6px; }
    .prototype-results[data-variant="C"] :global(.prototype-card) { grid-template-columns: 38% minmax(0, 1fr); }
    .prototype-results[data-variant="C"] :global([data-prototype-details]) { padding: 28px; }
  }
</style>
