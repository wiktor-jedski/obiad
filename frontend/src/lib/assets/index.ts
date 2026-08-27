import foodPlaceholderPng from "./food-placeholder.png";

export const foodPlaceholderUrl: string = foodPlaceholderPng;

export const supportedFoodImageKeys: ReadonlyMap<string, string> = new Map();

export function resolveFoodImage(imageKey: string | undefined): string {
  return supportedFoodImageKeys.get(imageKey ?? "") ?? foodPlaceholderUrl;
}
