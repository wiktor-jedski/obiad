import { client } from "./client/client.gen";

import type { Error } from "./client/types.gen";
import type { FoodSuggestionsResponse } from "./client/types.gen";
import type { SubstituteSearchRequest } from "./client/types.gen";
import type { SubstituteSearchResponse } from "./client/types.gen";
import type { SubstituteItem } from "./client/types.gen";
import type { SubstitutionQuantity } from "./client/types.gen";
import type { MatchedQuantity } from "./client/types.gen";
import type { Macronutrients } from "./client/types.gen";

export type {
  Error,
  FoodSuggestionsResponse,
  SubstituteSearchRequest,
  SubstituteSearchResponse,
  SubstituteItem,
  SubstitutionQuantity,
  MatchedQuantity,
  Macronutrients,
};

export { client };
