<script lang="ts">
  import { onMount } from "svelte";
  import { flip } from "svelte/animate";
  import { fly } from "svelte/transition";
  import { fetchSuggestions } from "../suggestions";
  import { searchSubstitutes } from "../substitutionSearch";
  import {
    projectSubstitutePage,
    type ProjectedMacronutrients,
  } from "../substituteProjection";
  import RageFaceAvatar from "./RageFaceAvatar.svelte";
  import { foodPlaceholderUrl, resolveFoodImage } from "../assets";
  import type { FoodQuantity, LocalizedNames } from "../../client/types.gen";
  import { interfaceLanguage } from "../interfaceLanguage";
  import {
    formatFoodQuantityValue,
    formatMacronutrientValue,
    getDictionary,
  } from "../i18n";

  const messages = {
    en: {
      conversation: "Meal swap conversation",
      loading: "Finding a meal and its swap…",
      empty: "No swap found for this example. Search for a meal below.",
      error: "The live example is unavailable. You can still search below.",
      complaint: (name: string) => `${name} AGAIN!? I ate that all week long!`,
      suggestion: (name: string) => `Try this: ${name}.`,
      protein: "P",
      carbohydrate: "C",
      fat: "F",
    },
    pl: {
      conversation: "Rozmowa o zamianie posiłku",
      loading: "Szukamy posiłku i zamiennika…",
      empty: "Brak zamiennika dla tego przykładu. Wyszukaj posiłek poniżej.",
      error:
        "Przykład jest niedostępny. Nadal możesz wyszukać posiłek poniżej.",
      complaint: (name: string) => `ZNOWU ${name}!? Ile można jeść to samo?!`,
      suggestion: (name: string) => `Spróbuj tego: ${name}.`,
      protein: "B",
      carbohydrate: "W",
      fat: "T",
    },
  };
  const language = $derived($interfaceLanguage);
  const copy = $derived(messages[language]);
  const dictionary = $derived(getDictionary(language));

  /** Display values for one meal in the landing conversation. */
  interface MealCard {
    names: LocalizedNames;
    quantity: FoodQuantity;
    calories: number;
    macros: ProjectedMacronutrients;
    imageKey?: string;
  }
  type DialogueLine = { id: number; side: "left" | "right" } & (
    | { kind: "bubble"; text: LocalizedNames; face: "rage" | "boss" | "gusta" }
    | { kind: "card"; meal: MealCard }
  );

  let lines = $state.raw<DialogueLine[]>([]);
  let typedCount = $state(0);
  let complete = $state(false);
  let status = $state<"loading" | "empty" | "error" | undefined>("loading");
  let reducedMotion = $state(false);
  const visible = $derived(lines.slice(-2));
  const currentLine = $derived(lines.at(-1));
  const currentText = $derived(
    currentLine?.kind === "bubble" ? currentLine.text[language] : "",
  );
  const typed = $derived(
    complete ? currentText : currentText.slice(0, typedCount),
  );

  function onImageError(event: Event): void {
    const image = event.currentTarget;
    if (
      image instanceof HTMLImageElement &&
      image.getAttribute("src") !== foodPlaceholderUrl
    ) {
      image.setAttribute("src", foodPlaceholderUrl);
    }
  }

  function playDialogue(): () => void {
    const controller = new AbortController();
    const headers = { "X-Obiad-Request-Purpose": "landing-dialogue" };
    let timer: ReturnType<typeof setTimeout>;
    let cancelWait: (() => void) | undefined;
    reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const pause = (ms: number) =>
      new Promise<void>((resolve) => {
        cancelWait = resolve;
        timer = setTimeout(resolve, ms);
      });

    async function run(): Promise<void> {
      try {
        const queries = ["chicken", "pasta", "rice", "beef", "curry", "potato"];
        const suggestions = await fetchSuggestions({
          query: queries[Math.floor(Math.random() * queries.length)],
          language: "en",
          signal: controller.signal,
          headers,
        });
        const selected =
          suggestions.items[
            Math.floor(Math.random() * suggestions.items.length)
          ];
        const response = await searchSubstitutes({
          foodObjectId: selected.foodObjectId,
          pageIndex: 0,
          signal: controller.signal,
          headers,
        });
        if (controller.signal.aborted) return;
        const projected = projectSubstitutePage(
          response.selectedFood,
          response.items,
          selected.defaultQuantity,
        );
        const alternative = projected.items[0];
        if (!alternative) {
          status = "empty";
          return;
        }
        const original: MealCard = {
          names: selected.names,
          quantity: selected.defaultQuantity,
          calories: projected.inputCalories,
          macros: projected.inputMacronutrients,
        };
        const swap: MealCard = {
          names: alternative.names,
          quantity: alternative.matchedQuantity,
          calories: alternative.calories,
          macros: alternative.macronutrients,
          imageKey: alternative.imageKey,
        };
        const script: DialogueLine[] = [
          {
            id: 0,
            side: "left",
            kind: "bubble",
            face: "rage",
            text: {
              en: messages.en.complaint(original.names.en),
              pl: messages.pl.complaint(original.names.pl),
            },
          },
          { id: 1, side: "left", kind: "card", meal: original },
          {
            id: 2,
            side: "right",
            kind: "bubble",
            face: "boss",
            text: {
              en: messages.en.suggestion(swap.names.en),
              pl: messages.pl.suggestion(swap.names.pl),
            },
          },
          { id: 3, side: "right", kind: "card", meal: swap },
          {
            id: 4,
            side: "left",
            kind: "bubble",
            face: "gusta",
            text: { en: "ME GUSTA", pl: "ME GUSTA" },
          },
        ];
        status = undefined;
        for (const line of script) {
          if (controller.signal.aborted) return;
          typedCount = 0;
          lines = [...lines, line];
          if (line.kind === "bubble") {
            if (reducedMotion)
              typedCount = Math.max(line.text.en.length, line.text.pl.length);
            else
              while (
                typedCount < Math.max(line.text.en.length, line.text.pl.length)
              ) {
                if (controller.signal.aborted) return;
                typedCount++;
                await pause(28);
              }
            await pause(line.id === 4 ? 0 : 350);
          } else await pause(1800);
        }
        if (!controller.signal.aborted) complete = true;
      } catch {
        if (!controller.signal.aborted) status = "error";
      }
    }
    void run();
    return () => {
      controller.abort();
      clearTimeout(timer);
      cancelWait?.();
    };
  }

  // The sequence belongs to this component; unmount aborts requests and timers.
  onMount(playDialogue);
</script>

<section
  aria-label={copy.conversation}
  class="absolute inset-x-0 bottom-full pb-8 text-dark-text-primary"
  data-dialogue-step={lines.at(-1)?.id ?? "loading"}
  data-dialogue-complete={complete}
>
  <div
    class="dialogue-stage relative flex flex-col justify-end gap-3 sm:h-[260px]"
  >
    {#if status}<p
        role="status"
        class="my-auto text-center text-sm text-dark-text-muted"
      >
        {copy[status]}
      </p>{/if}
    {#each visible as line (line.id)}
      <div
        data-dialogue-line={line.id}
        animate:flip={{ duration: reducedMotion ? 0 : 320 }}
        in:fly={{
          y: reducedMotion ? 0 : 18,
          duration: reducedMotion ? 0 : 320,
        }}
        class="flex items-center gap-3 sm:min-h-[118px] {line.side === 'right'
          ? 'flex-row-reverse'
          : ''}"
      >
        {#if line.kind === "bubble"}
          <div
            class="h-14 w-14 shrink-0 text-dark-text-primary sm:h-20 sm:w-20"
          >
            <RageFaceAvatar expression={line.face} />
          </div>
          <div
            class="bubble relative max-w-[480px] rounded-2xl border bg-dark-surface px-4 py-3 {line.side ===
            'right'
              ? 'bubble-right border-dark-primary/60'
              : 'bubble-left border-dark-secondary/30'}"
          >
            <p
              aria-hidden="true"
              class="text-sm leading-6 font-medium sm:text-lg sm:leading-7 {line.face ===
              'gusta'
                ? 'font-bold tracking-[0.08em]'
                : ''}"
            >
              {line.id === currentLine?.id ? typed : line.text[language]}<span
                class={[
                  "ml-0.5 inline-block h-[1em] w-[2px] translate-y-0.5 bg-dark-primary motion-reduce:hidden",
                  {
                    invisible:
                      line.id !== currentLine?.id ||
                      typed === line.text[language],
                  },
                ]}
              ></span>
            </p>
            <p class="sr-only" aria-live="polite">
              {line.id !== currentLine?.id || typed === line.text[language]
                ? line.text[language]
                : ""}
            </p>
          </div>
        {:else}
          <article
            data-dialogue-meal
            class="mx-auto flex w-[calc(100%-4.25rem)] max-w-[480px] items-center gap-3 rounded-xl border bg-dark-surface px-3 py-3 sm:w-[calc(100%-5.75rem)] {line.side ===
            'right'
              ? 'border-dark-primary/50'
              : 'border-dark-secondary/20'}"
          >
            <img
              src={resolveFoodImage(line.meal.imageKey)}
              alt=""
              onerror={onImageError}
              class="h-14 w-14 shrink-0 rounded-lg object-cover sm:h-[72px] sm:w-[72px]"
            />
            <div class="min-w-0 flex-1">
              <h2 class="text-sm leading-5 font-semibold sm:text-base">
                {line.meal.names[language]}
              </h2>
              <p class="mt-1 font-data text-[11px] text-dark-text-muted">
                {formatFoodQuantityValue(line.meal.quantity, language)} · {line
                  .meal.calories} kcal
              </p>
              <dl
                class="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-data text-[11px] text-dark-secondary"
              >
                <div class="flex gap-1">
                  <dt>
                    <abbr title={dictionary.proteinLabel()} class="no-underline"
                      >{copy.protein}</abbr
                    >
                  </dt>
                  <dd>
                    {formatMacronutrientValue(
                      line.meal.macros.protein,
                      language,
                    )}
                  </dd>
                </div>
                <div class="flex gap-1">
                  <dt>
                    <abbr
                      title={dictionary.carbohydratesLabel()}
                      class="no-underline">{copy.carbohydrate}</abbr
                    >
                  </dt>
                  <dd>
                    {formatMacronutrientValue(
                      line.meal.macros.carbohydrate,
                      language,
                    )}
                  </dd>
                </div>
                <div class="flex gap-1">
                  <dt>
                    <abbr title={dictionary.fatLabel()} class="no-underline"
                      >{copy.fat}</abbr
                    >
                  </dt>
                  <dd>
                    {formatMacronutrientValue(line.meal.macros.fat, language)}
                  </dd>
                </div>
              </dl>
            </div>
          </article>
        {/if}
      </div>
    {/each}
  </div>
</section>

<style>
  .bubble::before {
    content: "";
    position: absolute;
    top: 50%;
    width: 10px;
    height: 10px;
    background: var(--color-dark-surface);
    border: inherit;
    transform: translateY(-50%) rotate(45deg);
  }
  .bubble-left::before {
    left: -6px;
    border-top: 0;
    border-right: 0;
  }
  .bubble-right::before {
    right: -6px;
    border-bottom: 0;
    border-left: 0;
  }
</style>
