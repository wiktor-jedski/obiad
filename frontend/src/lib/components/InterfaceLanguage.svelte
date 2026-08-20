<script lang="ts">
  import { getDictionary } from "../i18n";
  import { interfaceLanguage } from "../interfaceLanguage";

  /**
   * Interface Language control (task 26; ARCH-001, ARCH-003, ARCH-012,
   * ARCH-014, ARCH-020, REQ-057, ISSUE-006, ISSUE-007).
   *
   * One segmented pill in the primary column's top-right corner, inset from
   * the top and right by the existing responsive page gutter (`16px` below
   * `640px`, `24px` from `640px` through `1023px`, `32px` from `1024px`).
   * The pill is absolutely positioned, so it never changes the Search
   * field's established `45%` of `100dvh` center (task 24, ISSUE-006).
   *
   * A localized named group (`role="group"` with the active dictionary's
   * `Interface language` / `Język interfejsu` accessible name) contains two
   * real `type="button"` controls in fixed PL-then-EN order, each with
   * `aria-pressed`, native keyboard activation, and a minimum `44×44px`
   * target. The active button uses Primary with Text-On-Bright; an inactive
   * button uses Surface, Text-Primary, and a Secondary border, promoting
   * the border to Primary on hover; focus-visible uses a two-pixel Primary
   * outline with a two-pixel offset (docs/requirements/style.md, ISSUE-007).
   *
   * Both buttons bind directly to the persisted Interface Language store:
   * every pointer or keyboard selection immediately applies the
   * corresponding typed dictionary (ARCH-003) and attempts to save the
   * exact `pl` or `en` value to the `obiad.interfaceLanguage` localStorage
   * key (ARCH-014). A blocked save retains the selection in memory for the
   * session without an error or cookie (ISSUE-007). The control makes no
   * application API request and adds no current-result translation,
   * suggestions, result state, or explicit Search focus, text-retention,
   * or suggestion-closing collaboration (ARCH-012).
   */

  /** The active Interface Language from the persisted store (ARCH-014). */
  const active = $derived($interfaceLanguage);
  /** The active dictionary for the active Interface Language (ARCH-003). */
  const dictionary = $derived(getDictionary(active));
</script>

<div
  role="group"
  aria-label={dictionary.interfaceLanguage()}
  class="absolute right-4 top-4 flex items-center gap-1 sm:right-6 sm:top-6 lg:right-8 lg:top-8"
>
  <button
    type="button"
    aria-pressed={active === "pl"}
    onclick={() => interfaceLanguage.set("pl")}
    class="h-11 min-w-11 rounded-full border border-solid px-4 font-data text-sm font-medium transition-colors duration-200 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-dark-primary {active ===
    'pl'
      ? 'border-dark-primary bg-dark-primary text-dark-text-on-bright'
      : 'border-dark-secondary bg-dark-surface text-dark-text-primary hover:border-dark-primary'}"
  >
    PL
  </button>
  <button
    type="button"
    aria-pressed={active === "en"}
    onclick={() => interfaceLanguage.set("en")}
    class="h-11 min-w-11 rounded-full border border-solid px-4 font-data text-sm font-medium transition-colors duration-200 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-dark-primary {active ===
    'en'
      ? 'border-dark-primary bg-dark-primary text-dark-text-on-bright'
      : 'border-dark-secondary bg-dark-surface text-dark-text-primary hover:border-dark-primary'}"
  >
    EN
  </button>
</div>
