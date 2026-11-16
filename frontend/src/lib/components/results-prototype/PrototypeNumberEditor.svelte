<script lang="ts">
  import type { InterfaceLanguage } from "../../i18n";

  let { field, label, value, precision, language, readonly = false, oncommit, onerror }: {
    field: string;
    label: string;
    value: number;
    precision: number;
    language: InterfaceLanguage;
    readonly?: boolean;
    oncommit: (value: number) => string | undefined;
    onerror: (message: string) => void;
  } = $props();

  const formatted = $derived(value.toLocaleString(language, {
    useGrouping: false,
    maximumFractionDigits: precision,
  }));
  let draft: string | undefined = $state();
  let invalid = $state(false);
  let originalText = "";

  function commit(): boolean {
    if (draft === undefined || draft === originalText) return true;
    const text = draft.trim().replace(",", ".");
    const number = Number(text);
    let message: string | undefined;
    if (!/^\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(number) || number <= 0) {
      message = language === "pl" ? "Wpisz liczbę większą od zera, bez jednostki." : "Enter a number greater than zero, without a unit.";
    } else if ((text.split(".")[1]?.length ?? 0) > precision) {
      message = language === "pl"
        ? `Dozwolona liczba miejsc po przecinku: ${precision}.`
        : `Allowed decimal places: ${precision}.`;
    } else {
      message = oncommit(number);
    }
    invalid = message !== undefined;
    onerror(message ? `${label}: ${message}` : "");
    return !invalid;
  }
</script>

{#if readonly}
  <span data-prototype-readonly={field}>{formatted}</span>
{:else}
  <input
    data-prototype-editor={field}
    aria-label={label}
    aria-invalid={invalid || undefined}
    aria-describedby={invalid ? "prototype-edit-error" : undefined}
    type="text"
    inputmode={precision === 0 ? "numeric" : "decimal"}
    autocomplete="off"
    spellcheck="false"
    value={draft ?? formatted}
    style:width={`${Math.max(1, (draft ?? formatted).length) + 0.25}ch`}
    onfocus={(event) => {
      originalText = formatted;
      draft = formatted;
      invalid = false;
      onerror("");
      event.currentTarget.select();
    }}
    oninput={(event) => { draft = event.currentTarget.value; }}
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
        onerror("");
        event.currentTarget.blur();
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (commit()) {
          draft = undefined;
          event.currentTarget.blur();
        }
      }
    }}
    class="min-h-11 min-w-0 max-w-full appearance-none rounded-none border-0 bg-transparent p-0 text-inherit underline decoration-solid decoration-dark-text-muted underline-offset-2 hover:text-dark-secondary hover:decoration-dark-secondary focus:font-bold focus:text-dark-primary focus:decoration-dark-primary focus:outline-none aria-invalid:decoration-dark-error"
  />
{/if}
