import { linear } from "svelte/easing";
import type { TransitionConfig } from "svelte/transition";

export const RESULT_CARD_INTRO_DURATION_MS = 220;

export const RESULT_CARD_INTRO_INTERVAL_MS = 100;

export const RESULT_CARD_OUTRO_DURATION_MS = 120;

export interface ResultCardTransitionParams {
  readonly rank: number;

  readonly firstPage: boolean;
}

export function resultCardTransition(
  node: Element,
  params: ResultCardTransitionParams,
  options: { direction: "in" | "out" },
): TransitionConfig {
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  if (reducedMotion || node.animate === undefined) {
    return { duration: 0, delay: 0 };
  }
  if (options.direction === "out") {
    return {
      duration: RESULT_CARD_OUTRO_DURATION_MS,
      delay: 0,
      easing: linear,
      css: (t) => `opacity: ${t}`,
    };
  }
  if (!params.firstPage) {
    return {
      duration: RESULT_CARD_INTRO_DURATION_MS,
      delay:
        RESULT_CARD_OUTRO_DURATION_MS +
        params.rank * RESULT_CARD_INTRO_INTERVAL_MS,
      easing: linear,
      css: (t) => `opacity: ${t}`,
    };
  }
  return {
    duration: RESULT_CARD_INTRO_DURATION_MS,
    delay: params.rank * RESULT_CARD_INTRO_INTERVAL_MS,
    easing: linear,
    css: (t) => `opacity: ${t}`,
  };
}
