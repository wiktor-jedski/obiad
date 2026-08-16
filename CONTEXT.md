# Obiad

Obiad helps people find nutritionally similar food substitutions.

## Language

### Food Objects

**Food Object**:
Any searchable nutritional object.

**Import**:
The act of bringing food data into database.

**Substitute**:
A Food Object proposed in place of Substitution Input because it is nutritionally similar and satisfies applicable Search constraints.

### Search

**Search**:
A request to retrieve Substitutes according to a query.

**Substitution Input**:
A Food Object supplied to a Substitution Search. When first selected, it uses one known Serving when available; otherwise it uses the Food Object's Nutrition Basis. The quantity may be edited post search.

**Substitution Search**:
A Search that accepts Substitution Input and returns Food Objects as Substitutes. Input Food Objects are excluded from results.

### Nutrition

**Macro Profile**:
The protein, carbohydrate, and fat composition of a Food Object. Nutritional similarity compares Macro Profiles; calories are derived data and are not part of the comparison profile.

**Nutritional Similarity**:
How closely two Food Objects match in the proportions of protein, carbohydrates, and fat, independent of serving quantity. Culinary Role affects the ordering of suitable Substitutes, not Nutritional Similarity itself. The selected Matched Quantity target does not affect Nutritional Similarity.

**Matched Quantity**:
The amount of a Substitute needed to match a selected nutritional target of the Substitution Inputs. The user selects calories, protein, carbohydrates, or fat; calories are the default. A Food Object is excluded when no finite Matched Quantity exists for the selected target.

**Nutrition Basis**:
The standard quantity used to express a Food Object's nutritional values: `100 g` for solids and `100 ml` for liquids.
_Avoid_: Storage basis, normalization basis

**Physical State**:
Whether a Food Object is solid or liquid, determining whether its Nutrition Basis is `100 g` or `100 ml`.

**Food Quantity**:
An amount of a Food Object expressed in a supported unit.

**Serving**:
An optional amount saved for a Food Object expressed in a supported unit that corresponds to Food Object's standard amount.
