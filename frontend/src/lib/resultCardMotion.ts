/**
 * Reusable Result Card motion transition (task 50; ARCH-021, ARCH-022,
 * REQ-052, REQ-054, ISSUE-016).
 *
 * One opacity-only Svelte transition implements the ARCH-021 Card Motion
 * Mechanism for keyed result pages. The transition function receives the
 * Svelte-provided transition direction and the card rank, and it applies
 * the default Svelte fade easing (linear) to the card opacity.
 *
 * Normal motion (REQ-052): a completed first-page card (`firstPage: true`)
 * uses a 220 ms intro that starts 100 ms after the prior ranked card;
 * rank zero has no delay. The outro branch — a 120 ms opacity fade with no
 * delay — is the reusable half of the mechanism that Phase 16 applies to
 * keyed MORE! replacement (task 51, REQ-053); task 50 mounts the card set
 * with `in:` only, so the outro branch is not exercised until then.
 *
 * Reduced-motion mode (REQ-054) removes every duration and delay: the
 * transition completes synchronously with zero duration and zero delay,
 * so all cards become fully visible in the same animation frame with no
 * intermediate opacity. The same instant configuration applies to a
 * non-first-page card in task 50 (`firstPage: false`): MORE!-page cards
 * keep their established motionless replacement until task 51 completes
 * the keyed replacement sequence.
 *
 * The transition also falls back to the instant configuration when the
 * runtime does not provide the Web Animations API (`Element.animate`),
 * which Svelte's transition engine requires. Real browsers provide it;
 * the fallback keeps the accessible instant behavior in environments
 * that cannot animate, so component integration tests observe no
 * intermediate opacity and no animation dependency.
 */
import { linear } from "svelte/easing";
import type { TransitionConfig } from "svelte/transition";

/** The intro duration of one completed first-page card (REQ-052). */
export const RESULT_CARD_INTRO_DURATION_MS = 220;
/** The start interval between adjacent ranked cards (REQ-052). */
export const RESULT_CARD_INTRO_INTERVAL_MS = 100;
/** The outro duration of one current card before replacement (REQ-053). */
export const RESULT_CARD_OUTRO_DURATION_MS = 120;

/**
 * The parameters of one Result Card transition (task 50, ARCH-021).
 * The transition receives the Svelte-provided `direction` option in
 * addition to these parameters.
 */
export interface ResultCardTransitionParams {
  /** The card's 0-based rank within its completed result page; rank zero has no delay. */
  readonly rank: number;
  /**
   * Whether the card belongs to a completed first page (page 0). Only
   * first-page cards use the staggered 220 ms entrance in task 50.
   */
  readonly firstPage: boolean;
}

/**
 * One opacity-only Result Card transition with the default Svelte fade
 * easing (task 50, ARCH-021, REQ-052, REQ-054).
 *
 * @param node - the card element the transition animates
 * @param params - the card rank and first-page membership
 * @param options - the transition direction Svelte provides (`in` or `out`)
 * @returns the transition configuration
 */
export function resultCardTransition(
  node: Element,
  params: ResultCardTransitionParams,
  options: { direction: "in" | "out" },
): TransitionConfig {
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  if (reducedMotion || typeof node.animate !== "function") {
    // Reduced motion (REQ-054) and non-animating runtimes remove every
    // duration and delay: the element becomes fully visible immediately,
    // in the same animation frame as the other cards, with no
    // intermediate opacity. The absence of `css` and `tick` means Svelte
    // applies no style at all and completes the transition synchronously.
    return { duration: 0, delay: 0 };
  }
  if (options.direction === "out") {
    // The reusable outro half of the mechanism (task 51, REQ-053): one
    // 120 ms opacity fade with no delay.
    return {
      duration: RESULT_CARD_OUTRO_DURATION_MS,
      delay: 0,
      easing: linear,
      css: (t) => `opacity: ${t}`,
    };
  }
  if (!params.firstPage) {
    // Task 50 defines motion for completed first pages only; a MORE!-page
    // card keeps its established motionless appearance until task 51
    // completes the keyed replacement sequence.
    return { duration: 0, delay: 0 };
  }
  return {
    duration: RESULT_CARD_INTRO_DURATION_MS,
    delay: params.rank * RESULT_CARD_INTRO_INTERVAL_MS,
    easing: linear,
    css: (t) => `opacity: ${t}`,
  };
}
