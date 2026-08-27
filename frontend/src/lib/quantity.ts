import type { AllowedQuantity } from "../client/types.gen";
import type { QuantityUnit } from "./interactionState";

const BASE_UNIT_PATTERN = /^[1-9][0-9]*$/;

const SERVING_PATTERN = /^[1-9][0-9]*(\.[0-9]+)?$/;

export function isValidQuantitySyntax(
  text: string,
  unit: QuantityUnit,
): boolean {
  if (unit === "serving") {
    return SERVING_PATTERN.test(text);
  }
  return BASE_UNIT_PATTERN.test(text);
}

export function resolveCommittedValue(
  text: string,
  unit: QuantityUnit,
  allowedQuantities: readonly AllowedQuantity[],
): number {
  const value = unit === "serving" ? Number(text) : Number.parseInt(text, 10);
  const maximum = maximumForUnit(unit, allowedQuantities);
  return Math.min(value, maximum);
}

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

export function unitSelectionValue(unit: QuantityUnit): number {
  return unit === "serving" ? 1 : 100;
}
