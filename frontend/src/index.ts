import { client } from "./client/client.gen";

import type { Error } from "./client/types.gen";
import type { FoodSuggestionsResponse } from "./client/types.gen";
import type { SubstituteSearchRequest } from "./client/types.gen";
import type { SubstituteSearchResponse } from "./client/types.gen";
import type { SubstituteItem } from "./client/types.gen";
import type { SelectedFood } from "./client/types.gen";
import type { MacroProfile } from "./client/types.gen";

export type {
  Error,
  FoodSuggestionsResponse,
  SubstituteSearchRequest,
  SubstituteSearchResponse,
  SubstituteItem,
  SelectedFood,
  MacroProfile,
};

export { client };
