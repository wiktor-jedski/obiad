import foodPlaceholderPng from "./food-placeholder.png";
import { mealImages } from "./generated-meal-images";

/** Bundled image for meals without a usable image. */
export const foodPlaceholderUrl: string = foodPlaceholderPng;

/** Maps catalog image keys to bundled meal images. */
export const supportedFoodImageKeys: ReadonlyMap<string, string> = mealImages;

/** Returns the matching meal image or the bundled placeholder. */
export function resolveFoodImage(imageKey: string | undefined): string {
  return supportedFoodImageKeys.get(imageKey ?? "") ?? foodPlaceholderUrl;
}
