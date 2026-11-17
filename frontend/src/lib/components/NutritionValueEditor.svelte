<script lang="ts">
  import type { InterfaceLanguage } from "../i18n";
  import type { NutritionEditError, NutritionField } from "../nutritionEditing";

  let {
    field,
    label,
    value,
    precision,
    language,
    readonly = false,
    oncommit,
    onerror,
  }: {
    field: NutritionField;
    label: string;
    value: number;
    precision: number;
    language: InterfaceLanguage;
    readonly?: boolean;
    oncommit: (value: number) => NutritionEditError | undefined;
    onerror: (error: NutritionEditError | undefined) => void;
  } = $props();

  const formatted = $derived(
    value.toLocaleString(language, {
      useGrouping: false,
      maximumFractionDigits: precision,
    }),
  );
  let draft: string | undefined = $state();
  let invalid = $state(false);
  let edited = false;

  function commit(): boolean {
    if (draft === undefined || !edited) return true;
    const text = draft.trim().replace(",", ".");
    const number = Number(text);
    let error: NutritionEditError | undefined;
    if (
      !/^\d+(?:\.\d+)?$/.test(text) ||
      !Number.isFinite(number) ||
      number <= 0
    ) {
      error = { field, reason: "positive" };
    } else if ((text.split(".")[1]?.length ?? 0) > precision) {
      error = { field, reason: "precision", places: precision };
    } else {
      error = oncommit(number);
    }
    invalid = error !== undefined;
    onerror(error);
    return !invalid;
  }
</script>

{#if readonly}
  <span data-nutrition-readonly={field} aria-label={`${label}: ${formatted}`}>
    {formatted}
  </span>
{:else}
  <span
    class="group/editor relative inline-grid min-h-11 min-w-0 max-w-full items-center"
  >
    <!-- Match punctuation width and the bold focus font without measuring in JS. -->
    <span
      aria-hidden="true"
      class="invisible overflow-hidden whitespace-pre pr-[0.25ch] group-focus-within/editor:font-bold"
      >{(draft ?? formatted) || "0"}</span
    >
    <input
      data-nutrition-editor={field}
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? "nutrition-edit-error" : undefined}
      type="text"
      inputmode={precision === 0 ? "numeric" : "decimal"}
      autocomplete="off"
      spellcheck="false"
      value={draft ?? formatted}
      onfocus={(event) => {
        edited = false;
        draft = formatted;
        invalid = false;
        event.currentTarget.select();
      }}
      oninput={(event) => {
        draft = event.currentTarget.value;
        edited = true;
      }}
      onblur={() => {
        commit();
        draft = undefined;
        invalid = false;
      }}
      onkeydown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          draft = undefined;
          invalid = false;
          onerror(undefined);
          event.currentTarget.blur();
        } else if (event.key === "Enter") {
          event.preventDefault();
          if (commit()) {
            draft = undefined;
            event.currentTarget.blur();
          }
        }
      }}
      class="absolute inset-0 size-full min-w-0 appearance-none rounded-none border-0 bg-transparent p-0 text-inherit underline decoration-solid decoration-dark-text-muted underline-offset-2 hover:text-dark-secondary hover:decoration-dark-secondary focus:font-bold focus:text-dark-primary focus:decoration-dark-primary focus:outline-none aria-invalid:decoration-dark-error"
    />
  </span>
{/if}
