<script lang="ts">
  import { formatFoodQuantityValue, getDictionary } from "../i18n";
  import { interfaceLanguage } from "../interfaceLanguage";
  import type { SelectedFoodObject } from "../interactionState";

  /**
   * Read-only Substitution Input region (task 28; ARCH-001, ARCH-002,
   * ARCH-003, REQ-020, REQ-022, REQ-023, REQ-024, ISSUE-008).
   *
   * From selection onward the region retains the selected localized names
   * and the returned default Food Quantity as the read-only Substitution
   * Input: a visible localized label — `Selected food` or `Wybrany produkt`
   * — and the value `localized name · quantity unit`, where Serving renders
   * as `1 serving` or `1 porcja` and `g` and `ml` stay invariant. The label
   * comes from the active dictionary (interface text translates), while the
   * value is computed from the name and Interface Language captured at
   * selection, so switching the Interface Language never re-translates this
   * captured active-content value (ISSUE-008). There is no Food Quantity
   * edit; Phase 10 owns quantity editing. The final region layout belongs
   * to task 30.
   */

  interface Props {
    /** The captured selection rendered as the read-only Substitution Input. */
    selected: SelectedFoodObject;
  }

  let { selected }: Props = $props();

  /** The active dictionary for the region's visible label. */
  const dictionary = $derived(getDictionary($interfaceLanguage));
  /**
   * The captured active-content value: the localized name at selection and
   * the returned default Food Quantity formatted with the captured
   * Interface Language (ISSUE-008).
   */
  const value = $derived(
    `${selected.names[selected.capturedLanguage]} · ${formatFoodQuantityValue(
      selected.quantity,
      selected.capturedLanguage,
    )}`,
  );
</script>

<div data-selected-input class="mt-3 flex flex-col gap-1">
  <span class="font-data text-sm font-medium text-dark-text-muted"
    >{dictionary.selectedFoodLabel()}</span
  >
  <span class="text-base text-dark-text-primary">{value}</span>
</div>
