import type { LocalizedNames, MacroProfile } from "../client/types.gen";

/** A full authored recipe and its validated nutrients per 100 g or ml. */
export interface MealRecipe {
  id: number;
  names: LocalizedNames;
  imageKey?: string;
  quantity: { value: number; unit: "g" | "ml" };
  macroProfile: MacroProfile;
  source: string;
  ingredients: { names: LocalizedNames; grams: number }[];
  steps: string[];
}

const recipes = new Map<number, { names: LocalizedNames; file: string }>();
for (const [id, names, file] of import.meta.env.OBIAD_RECIPE_INDEX ?? []) {
  recipes.set(id, { names, file });
}

/** Reports whether the released recipe matches both names on a search card. */
export function hasMealRecipe(id: number, names: LocalizedNames): boolean {
  const entry = recipes.get(id);
  if (!entry) return false;
  return entry.names.en === names.en && entry.names.pl === names.pl;
}

/** Loads only the requested recipe. Unpublished IDs need no request. */
export async function loadMealRecipe(
  id: number,
): Promise<MealRecipe | undefined> {
  const entry = recipes.get(id);
  if (!entry) return undefined;
  const response = await fetch(`/recipes/${entry.file}`);
  if (response.status === 404) return undefined;
  if (!response.ok)
    throw new Error(`Recipe request failed: ${response.status}`);
  return response.json();
}
