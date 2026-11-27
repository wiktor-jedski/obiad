import type { SubstituteSearchResponse } from "../client/types.gen";
import type { InteractionState, QuantityUnit } from "./interactionState";

/** Committed results to restore if the browser discards the search document. */
export interface SearchReturn {
  interaction: Extract<
    InteractionState,
    { name: "results" | "zeroResults" | "moreFailure" }
  >;
  pages: SubstituteSearchResponse[];
  enteredBaseQuantity?: number;
  chosenUnit?: QuantityUnit;
  scrollY: number;
}

/** Read the snapshot only when the browser returns to this search entry. */
export function readSearchReturn(): SearchReturn | undefined {
  const navigation = performance.getEntriesByType("navigation")[0];
  if (
    location.pathname === "/" &&
    navigation instanceof PerformanceNavigationTiming &&
    navigation.type === "back_forward"
  ) {
    return history.state?.searchReturn;
  }
}
