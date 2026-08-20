/**
 * Bundled presentation assets for Obiad Food Object cards (ARCH-015).
 *
 * Ownership: the project owner supplied the generated or commissioned
 * artwork in `food-placeholder.png` and holds the required project-use
 * rights; no attribution is required (ISSUE-006). The committed file is a
 * `512×512`, 8-bit, true-color sRGB PNG without alpha or localized text;
 * unnecessary source metadata was stripped without changing its pixel
 * signature, and its pinned SHA-256 is
 * `741ef3e3a323cc1b47c466aba947aee59cb03790f7ffee754470fbbc64c24b95`.
 */

/**
 * The bundled `512×512` placeholder shown when a Food Object has no usable
 * image (REQ-011, ARCH-015). Vite resolves this import to the hashed URL of
 * the emitted asset; the value is always a same-origin URL relative to the
 * application origin.
 */
import foodPlaceholderPng from "./food-placeholder.png";

export const foodPlaceholderUrl: string = foodPlaceholderPng;

/**
 * The supported Food Object image-key map (task 29; ARCH-015, REQ-011,
 * ISSUE-008). The POC map is deliberately empty: the four seeded opaque keys
 * (`pizza-margherita`, `chicken-breast`, `milk`, and `gyoza`) remain
 * unmapped catalog data, so an absent key, any seeded key, and every other
 * unmapped key all resolve to the existing bundled placeholder. No new food
 * artwork or external asset source is added (ISSUE-008).
 */
export const supportedFoodImageKeys: ReadonlyMap<string, string> = new Map();

/**
 * Resolves one opaque Food Object image key to its bundled image URL
 * (ARCH-015 flow). The browser resolves a known key to its bundled image;
 * an absent, unknown, or failed image resolves to the placeholder. With the
 * empty supported map, every key resolves to the placeholder.
 *
 * @param imageKey - the optional opaque image key from the Substitute item
 * @returns the same-origin bundled image URL for the card
 */
export function resolveFoodImage(imageKey: string | undefined): string {
  return supportedFoodImageKeys.get(imageKey ?? "") ?? foodPlaceholderUrl;
}
