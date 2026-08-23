/**
 * ISSUE-010 Food Quantity editor syntax and commit resolution (ARCH-002,
 * REQ-025, REQ-026, REQ-027, REQ-028).
 *
 * The editable selected-food summary keeps the exact raw number text in
 * local interaction state until Enter or focus leaves the complete
 * quantity editor, and commits only a syntactically valid number. This
 * module owns the ISSUE-010-resolved grammar and the commit resolution —
 * clamping, unit reset values, and the maximum lookup — so the Browser
 * Interaction Module and the summary component share one decision:
 *
 *   - Base units (`g`, `ml`) accept only a canonical positive ASCII
 *     integer: it starts with an ASCII digit from `1` through `9` and
 *     continues with zero or more ASCII digits. Leading zeros, a leading
 *     plus sign, surrounding whitespace, exponent notation, dot decimals,
 *     comma decimals, zero, negatives, empty text, and letters are
 *     rejected.
 *   - Serving accepts that integer form or a canonical positive dot
 *     decimal: an integer part that starts with a digit from `1` through
 *     `9`, one dot, and one or more ASCII fractional digits, with a
 *     numeric value greater than zero. Trailing fractional zeros are
 *     permitted. `.5`, `1.`, and every other noncanonical form are
 *     rejected.
 *   - A syntactically valid number above the selected `maximumValue` is
 *     silently replaced by that whole maximum before commit, with no
 *     visible or assistive clamp notice.
 *   - A unit selection replaces the draft with `1` for Serving or `100`
 *     for a base unit and commits immediately.
 *
 * No browser nutrition calculation or rerounding lives here (REQ-040):
 * the module only parses and clamps the committed number, and the summary
 * renders backend-provided values.
 */
import type { AllowedQuantity } from "../client/types.gen";
import type { QuantityUnit } from "./interactionState";

/**
 * The canonical positive-integer grammar of a base-unit draft
 * (ISSUE-010, REQ-025): one ASCII digit from `1` through `9`, then zero
 * or more ASCII digits. This is the complete base-unit syntax; every
 * other form is invalid.
 */
const BASE_UNIT_PATTERN = /^[1-9][0-9]*$/;

/**
 * The canonical Serving grammar (ISSUE-010, REQ-025): the canonical
 * positive integer form, or one ASCII digit from `1` through `9`, zero or
 * more ASCII digits, one dot, and one or more ASCII fractional digits.
 * Because the integer part always starts with a digit from `1` through
 * `9`, every match has a numeric value greater than zero; trailing
 * fractional zeros are permitted.
 */
const SERVING_PATTERN = /^[1-9][0-9]*(\.[0-9]+)?$/;

/**
 * Reports whether one raw draft satisfies the ISSUE-010 syntax of the
 * given unit (REQ-025): a canonical positive ASCII integer for `g` and
 * `ml`, and that integer form or a canonical positive dot decimal for
 * `serving`. The caller keeps the exact raw draft in the interaction
 * state; this function only classifies it.
 *
 * @param text - the exact raw number text from the quantity editor
 * @param unit - the unit the draft is edited in
 * @returns whether the draft is syntactically valid for the unit
 */
export function isValidQuantitySyntax(
  text: string,
  unit: QuantityUnit,
): boolean {
  if (unit === "serving") {
    return SERVING_PATTERN.test(text);
  }
  return BASE_UNIT_PATTERN.test(text);
}

/**
 * Resolves one syntactically valid draft to its committed numeric value
 * (ISSUE-010): a value above the selected unit's `maximumValue` is
 * silently replaced by that whole maximum before commit, with no visible
 * or assistive clamp notice. The caller must validate the draft first
 * with {@link isValidQuantitySyntax}.
 *
 * @param text - the exact raw number text from the quantity editor
 * @param unit - the unit the draft is edited in
 * @param allowedQuantities - the selected suggestion's allowed units
 * @returns the resolved committed numeric value, clamped to the maximum
 */
export function resolveCommittedValue(
  text: string,
  unit: QuantityUnit,
  allowedQuantities: readonly AllowedQuantity[],
): number {
  const value = unit === "serving" ? Number(text) : Number.parseInt(text, 10);
  const maximum = maximumForUnit(unit, allowedQuantities);
  return Math.min(value, maximum);
}

/**
 * The whole maximum value of one allowed unit (ISSUE-010): `100000` for
 * the base unit and the whole-number floor of `100000` divided by the
 * stored Serving base quantity for `serving`, exactly as the suggestion
 * response advertises. The unit always belongs to the selected
 * `allowedQuantities`, so the lookup cannot miss.
 *
 * @param unit - the quantity-editor unit
 * @param allowedQuantities - the selected suggestion's allowed units
 * @returns the largest accepted value of the unit
 */
export function maximumForUnit(
  unit: QuantityUnit,
  allowedQuantities: readonly AllowedQuantity[],
): number {
  const allowed = allowedQuantities.find(
    (candidate) => candidate.unit === unit,
  );
  if (allowed === undefined) {
    throw new Error(`unit ${unit} is not advertised for the selected food`);
  }
  return allowed.maximumValue;
}

/**
 * The immediate committed value of a unit selection (ISSUE-010): `1` for
 * Serving and `100` for a base unit. Selecting another unit replaces the
 * draft with this value and commits it immediately.
 *
 * @param unit - the newly selected unit
 * @returns the reset committed value
 */
export function unitSelectionValue(unit: QuantityUnit): number {
  return unit === "serving" ? 1 : 100;
}
