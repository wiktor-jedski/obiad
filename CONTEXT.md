# Obiad

Obiad helps people find nutritionally similar food substitutions.

## Language

### Localization

**Interface Language**:
The supported language used for interface text, accessibility text, and localized Food Object names. Obiad supports English and Polish.

### Food Objects

**Food Object**:
A generic prepared dish with nutritional data. This is the application and HTTP term for a validated production Meal aggregate. Application dummy rows retain legacy nonproduction fixtures for local development, CI, and integration checks; they do not define production Food Object eligibility. A production Food Object does not identify an Ingredient, raw food, or product.

**Ingredient**:
A production-authoring record for one reusable nutritional input to a Meal. An Ingredient does not enter the application catalog, HTTP interface, or PostgreSQL runtime catalog.

**Meal**:
A production-authoring record for one recipe-derived prepared dish. A validated Meal becomes one Food Object in a production aggregate catalog.

**Food Family**:
An optional flat grouping of Food Objects that are variants of the same kind of prepared dish.
_Avoid_: Category

**Import**:
The act of loading an application catalog into a database.

**Substitute**:
A Food Object proposed in place of a Substitution Input because it is nutritionally similar and satisfies applicable Search constraints.

### Search

**Search**:
A request to identify Food Objects or retrieve Substitutes according to a Search Query.

**Search Query**:
Text entered to identify a Food Object by its localized name.
_Avoid_: Prompt

**Substitution Input**:
A Food Object and Food Quantity supplied to a Substitution Search.

**Substitution Search**:
A Search that accepts one Substitution Input and returns Food Objects as Substitutes.

### Nutrition

**Macro Profile**:
The protein, carbohydrate, and fat composition of a Food Object. Calories are derived from this profile but are not part of it.

**Nutritional Similarity**:
How closely two Macro Profiles match in their protein, carbohydrate, and fat proportions, independent of Food Quantity.

**Matched Quantity**:
The amount of a Substitute that has the same derived calorie value as the Substitution Input.

**Nutrition Basis**:
The standard quantity used to express a Food Object's nutritional values: `100 g` for solids and `100 ml` for liquids.
_Avoid_: Storage basis, normalization basis

**Physical State**:
Whether a Food Object is solid or liquid, determining whether its Nutrition Basis is `100 g` or `100 ml`.

**Food Quantity**:
An amount of a Food Object expressed in grams, millilitres, or servings.

**Serving**:
An optional positive standard Food Quantity for a Food Object. Its unit is grams for a solid and millilitres for a liquid. A Serving count converts to a base-unit Food Quantity by multiplication.
