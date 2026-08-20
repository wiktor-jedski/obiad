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
