# Obiad Architecture

This document is the source of truth for the current Obiad proof-of-concept architecture. It implements the active requirements in [requirements/requirements.md](requirements/requirements.md).

## System overview

Obiad runs as three local processes: a client-only Svelte browser application, a Go/Fiber backend, and PostgreSQL. Vite serves the browser application and proxies same-origin `/api` requests to Fiber. PostgreSQL owns the runtime Food Catalog. Database setup loads application-owned dummy data for local development, CI, and integration checks. The production launcher instead loads a validated production Meal aggregate.

The browser requests Food Object suggestions and pages of Substitutes through an OpenAPI-first HTTP Interface. Two backend Modules own these operations. Go owns suggestion ranking, candidate eligibility, full-precision Nutritional Similarity calculation, deterministic rank order, and paging independently of Food Quantity. The browser owns interaction state, local quantity projection from the returned calculation basis (input calories, equal-calorie Matched Quantities, scaled macronutrients, and final display rounding), localization, accessibility behavior, and presentation.

```mermaid
flowchart LR
    Browser["Svelte browser application"] --> Vite["Vite dev or preview server"]
    Vite -->|"same-origin /api proxy"| Fiber["Fiber v3 Adapter"]
    Fiber --> Suggest["Suggest Food Objects"]
    Fiber --> Substitute["Find Substitute Page"]
    Suggest --> Loader["Private PostgreSQL Catalog Loader"]
    Substitute --> Loader
    Loader --> Catalog[("Runtime PostgreSQL catalog")]
    Setup["Database Setup command<br/>(application-owned dummy data)"] --> Catalog
    Production["Production launcher<br/>(validated Meal aggregate)"] --> Catalog
```

## ARCH-001 — Browser Application

| Attribute | Value |
| --- | --- |
| Type | Module |
| Status | Active |
| Requirements | REQ-003, REQ-029, REQ-031, REQ-039–REQ-040, REQ-060–REQ-061, REQ-073, REQ-075, REQ-079 |
| Dependencies | ARCH-002, ARCH-003, ARCH-008, ARCH-014–ARCH-016, ARCH-019–ARCH-021 |

**Responsibility:** Render the single-page substitution interface and project calculation basis values.

**Contract:** This client-only Svelte 5 Module renders one primary content column. It uses the generated TypeScript HTTP client. It owns one pure projection from the returned calculation basis and committed Food Quantity to input calories, equal-calorie Matched Quantities, scaled macronutrients, and final rounded display values. It converts an entered Serving count to the base grams or millilitres using the returned Serving base quantity, computes derived input calories as `4p + 4c + 9f`, computes candidate equal-calorie Matched Quantities, and scales candidate macronutrients to the unrounded Matched Quantity using full calculation precision before final display rounding. Final display rounding rounds input calories and Matched Quantity to whole numbers and macronutrients to 0.1 g; exact nonnegative halves round up at each target precision. It does not implement Search ranking, candidate eligibility, or paging.

## ARCH-002 — Browser Interaction Module

| Attribute | Value |
| --- | --- |
| Type | Module |
| Status | Active |
| Requirements | REQ-018–REQ-021, REQ-025–REQ-027, REQ-041, REQ-043–REQ-051, REQ-058–REQ-059, REQ-083–REQ-085 |
| Dependencies | ARCH-001, ARCH-003, ARCH-008, ARCH-010–ARCH-012, ARCH-019–ARCH-021 |

**Responsibility:** Own browser interaction transitions.

**Contract:** One discriminated Svelte state owns Search Query text, the selected Food Object, Food Quantity text, page index, focus intent, and motion phase. TanStack Query owns HTTP data, pending state, and request errors. The Module does not copy query results into a Svelte store. A separate persisted store owns the Interface Language.

The state names are `empty`, `loadingNew`, `results`, `loadingMore`, `zeroResults`, `newSearchFailure`, and `moreFailure`. Transitions, not independent booleans, determine visible controls, retained cards, focus, announcements, and motion. While results are visible, editing the quantity changes raw input text without changing current result values until committed. A valid quantity commit is synchronous and local, starts no HTTP request or pending state, and preserves candidate eligibility including `totalEligibleCount` and `hasMore`, result identity, order, page, card identity, motion, focus, Interface Language, and localized text.

## ARCH-003 — Translation Module

| Attribute | Value |
| --- | --- |
| Type | Module |
| Status | Active |
| Requirements | REQ-013, REQ-044, REQ-050–REQ-051, REQ-055–REQ-059, REQ-068, REQ-083–REQ-085 |
| Dependencies | ARCH-001, ARCH-014 |

**Responsibility:** Produce all localized interface and accessibility text.

**Contract:** Typed static English and Polish dictionaries expose message functions. The Module owns interface labels, validation text, retry text, accessible names, and the existing loading, validation, and failure announcements. It exposes no successful-result count or result-status message. Food Object names remain Food Catalog data.

## ARCH-004 — Suggest Food Objects Module

| Attribute | Value |
| --- | --- |
| Type | Module |
| Status | Active |
| Requirements | REQ-002, REQ-005–REQ-008, REQ-012–REQ-017, REQ-022–REQ-024 |
| Dependencies | ARCH-006, ARCH-013, ARCH-017 |

**Responsibility:** Return the five ranked Food Object suggestions for one Search Query.

**Contract:** One concrete `Run` interface accepts a raw Search Query and an Interface Language. It returns exactly five distinct suggestions or one stable failure. Each suggestion contains the stable Food Object ID, English and Polish names, and a backend-derived default Food Quantity.

The default is `1 serving` when the Food Object has a Serving. Otherwise, it is `100 g` for a solid or `100 ml` for a liquid. The Module exposes no Go interface, repository port, ranking policy, or test Adapter.

## ARCH-005 — Find Substitute Page Module

| Attribute | Value |
| --- | --- |
| Type | Module |
| Status | Active |
| Requirements | REQ-002, REQ-005, REQ-007, REQ-009–REQ-010, REQ-030, REQ-032–REQ-036, REQ-041–REQ-045, REQ-072 |
| Dependencies | ARCH-006, ARCH-013, ARCH-018 |

**Responsibility:** Return one deterministic page of candidate Substitutes and calculation basis data independently of Food Quantity.

**Contract:** One concrete `Run` interface accepts a selected Food Object ID and a zero-based page index. It owns catalog access, exclusion, full-precision Nutritional Similarity, deterministic rank order, eligibility counts, and paging independently of Food Quantity. It returns the requested page index, total eligible count, `hasMore`, the selected Food Object calculation basis, and at most three candidate Substitute items.

The selected Food Object basis contains the canonical Macro Profile (`100 g` for solids or `100 ml` for liquids), base unit, and exact optional Serving base quantity. Each candidate item contains the stable Food Object ID, English and Polish names, optional image key, canonical Macro Profile, base unit, exact optional Serving base quantity where applicable, and backend-derived full-precision Nutritional Similarity and whole similarity percentage. Page `0` is valid when no eligible Substitute exists. A later page whose first rank does not exist returns `PAGE_OUT_OF_RANGE`. The Module exposes no general Search facade, repository port, policy interface, or test Adapter.

## ARCH-006 — PostgreSQL Catalog Loader

| Attribute | Value |
| --- | --- |
| Type | Module |
| Status | Active |
| Requirements | REQ-002 |
| Dependencies | ARCH-013, PostgreSQL, pgx |

**Responsibility:** Load and validate one request-local Food Catalog snapshot from PostgreSQL.

**Contract:** This private concrete Module executes embedded SQL through pgx. Its SQL is colocated under `backend/internal/repository/sql/`. It binds all dynamic SQL values through pgx parameters and never interpolates them into statement text; a statement with no dynamic values has no parameters. Each suggestion or Substitution Search performs one fresh PostgreSQL read. The Module maps rows to private Food Object values and reports storage or catalog-invariant failures.

The Module reads no `data/` submodule file, production Ingredient, Meal authoring record, or aggregate catalog. It has no exported repository interface, fake Adapter, runtime cache, SQL ranking, automatic retry, or derived-value persistence.

## ARCH-007 — Database Setup Module

| Attribute | Value |
| --- | --- |
| Type | Module |
| Status | Active |
| Requirements | REQ-070–REQ-072 |
| Dependencies | ARCH-013, PostgreSQL |

**Responsibility:** Create the deterministic application-owned dummy catalog before Fiber starts.

**Contract:** An explicit Go command applies embedded versioned migrations and deterministic dummy catalog data in transactions. It uses a schema-owner database credential. The command creates the complete POC catalog with fixed IDs and test-designed nutrition values. These rows are application-owned dummy data, not production records. The request-serving process does not execute DDL or seed operations, and database setup does not read the `data/` submodule.

## ARCH-008 — OpenAPI HTTP Interface

| Attribute | Value |
| --- | --- |
| Type | Interface |
| Status | Active |
| Requirements | REQ-001, REQ-012, REQ-036, REQ-050–REQ-051, REQ-055, REQ-058, REQ-074 |
| Dependencies | ARCH-004, ARCH-005, ARCH-019 |

**Responsibility:** Define the browser-to-backend protocol.

**Contract:** A checked-in OpenAPI document is authoritative. It generates Go transport models and the TypeScript client and types. The Fiber Adapter maps generated transport values to backend domain values and maps results back. Generated values do not enter the operation Modules.

The approved target interface provides these operations:

- `GET /api/v1/food-suggestions?query=<text>&language=<en|pl>`
- `POST /api/v1/substitutes/search`

In the approved target contract, the `POST /api/v1/substitutes/search` request body identifies only the selected Food Object and requested page. It contains `foodObjectId` (integer) and `pageIndex` (nonnegative integer). Food Quantity is removed from the request. The body limit is 4 KiB.

A successful suggestion response contains exactly five items. Each item contains `foodObjectId`, `names.en`, `names.pl`, and `defaultQuantity`.

A successful target Substitute response contains `pageIndex`, `totalEligibleCount`, `hasMore`, the selected Food Object calculation basis (`foodObjectId`, `names.en`, `names.pl`, `canonicalMacroProfile` with finite protein, carbohydrate, and fat per `100 g` or `100 ml`, `baseUnit`, and exact optional `servingBaseQuantity`), and zero to three candidate items. Each candidate item contains `foodObjectId`, `names.en`, `names.pl`, optional `imageKey`, `canonicalMacroProfile`, `baseUnit`, exact optional `servingBaseQuantity` where applicable, and backend-derived whole `similarityPercent`.

An error response contains a stable `code` and an optional `field`. It never contains localized prose, SQL text, a stack trace, or an internal cause.

Target stable error codes:

| HTTP status | Stable codes |
| --- | --- |
| 400 | `INVALID_REQUEST` |
| 404 | `FOOD_OBJECT_NOT_FOUND` |
| 413 | `REQUEST_BODY_TOO_LARGE` |
| 422 | `INVALID_SEARCH_QUERY`, `QUERY_TOO_LONG`, `UNSUPPORTED_LANGUAGE`, `INVALID_PAGE_INDEX`, `PAGE_OUT_OF_RANGE` |
| 503 | `CATALOG_UNAVAILABLE` |
| 504 | `SEARCH_TIMEOUT` |
| 500 | `INTERNAL_ERROR` |

**Transition note:** The checked-in OpenAPI document and running application continue to use the legacy quantity-dependent contract (`quantity.value`, `quantity.unit`, backend-derived `inputMacronutrients`, `inputCalories`, `matchedQuantity`, `macronutrients`, and `calories`, with quantity 422 codes `INVALID_QUANTITY`, `QUANTITY_UNIT_MISMATCH`, `SERVING_UNAVAILABLE`, and `QUANTITY_OUT_OF_RANGE`) as a transitional contract until Phase 22 implements the target contract.

## ARCH-009 — Backend Readiness Interface

| Attribute | Value |
| --- | --- |
| Type | Interface |
| Status | Active |
| Requirements | Architecture overhead: deterministic readiness for local and CI orchestration |
| Dependencies | ARCH-006, ARCH-016, PostgreSQL |

**Responsibility:** Report whether Fiber can use PostgreSQL.

**Contract:** Unversioned `GET /health` performs a bounded PostgreSQL ping. It returns `200` with `{"status":"ready"}` only when request processing can use PostgreSQL. It returns `503` with `{"status":"unavailable"}` otherwise. It does not expose configuration, credentials, version data, or dependency details.

## ARCH-010 — Food Suggestion Collaboration

| Attribute | Value |
| --- | --- |
| Type | Collaboration |
| Status | Active |
| Requirements | REQ-012–REQ-013, REQ-018–REQ-024, REQ-077 |
| Dependencies | ARCH-001, ARCH-002, ARCH-004, ARCH-006, ARCH-008, ARCH-017 |

**Responsibility:** Resolve typed Search Queries into selectable Food Object suggestions.

**Participants:** Browser Interaction Module, generated TypeScript client, Fiber Adapter, Suggest Food Objects Module, and PostgreSQL Catalog Loader.

**Runtime behavior:** A focused nonempty Search Query starts a suggestion request. A later query change aborts the stale browser request. Only the latest response can update suggestions. Fiber can continue stale backend work until its deadline because a browser disconnect does not cancel a Fiber handler. The first returned item becomes active. Arrow keys move the active item. Escape closes the list. Tab moves focus. Enter or pointer activation selects the active Food Object.

Selection replaces the Search Query with the exact returned selected name for the active Interface Language, sends the returned default Food Quantity to the Substitution Search operation, and uses page index `0`. A Search Query that is empty after ARCH-017 normalization enables no suggestion request. Enter with that value keeps the exact raw value, Search focus, and current interaction state, shows no validation message, and starts no Substitution Search request.

## ARCH-011 — Substitution Search Collaboration

| Attribute | Value |
| --- | --- |
| Type | Collaboration |
| Status | Active |
| Requirements | REQ-020, REQ-022, REQ-028, REQ-036, REQ-041, REQ-043–REQ-048, REQ-050–REQ-051, REQ-074–REQ-075, REQ-083–REQ-085 |
| Dependencies | ARCH-001, ARCH-002, ARCH-005, ARCH-006, ARCH-008, ARCH-018–ARCH-021 |

**Responsibility:** Coordinate new searches, local quantity reprojection, and result-page replacement.

**Participants:** Browser Interaction Module, generated TypeScript client, Fiber Adapter, Find Substitute Page Module, and PostgreSQL Catalog Loader.

**Runtime behavior:** New selection requests page `0`. A quantity edit remains raw local text until Enter or blur. A valid quantity commit is synchronous and local, starts no HTTP request or pending state, and reprojects values using the pure projection in ARCH-001 while preserving candidate eligibility including `totalEligibleCount` and `hasMore`, result identity, order, page, card identity, motion, focus, Interface Language, and localized text. MORE! requests the next page. New Search and MORE! operations share one global request lock and disable related actions while pending; a quantity commit does not acquire the lock. The system queues no later intent.

A new-search failure clears cards, retains the input, keeps focus in Search, and shows the localized retry state. A MORE! failure retains cards and the control, keeps focus on MORE!, and shows the localized retry state. After a successful new Search or MORE! request with one or more result cards, focus moves to the localized results heading. A successful new Search with zero result cards moves focus to the localized zero-result message. Successful result states emit no result count or result-status live-region message. Existing loading, validation, and failure announcements remain unchanged.

## ARCH-012 — Interface Language Change Collaboration

| Attribute | Value |
| --- | --- |
| Type | Collaboration |
| Status | Active |
| Requirements | REQ-055–REQ-059 |
| Dependencies | ARCH-001–ARCH-003, ARCH-008, ARCH-014 |

**Responsibility:** Change Interface Language without changing current Search identity or order.

**Participants:** Translation Module, Interface Language preference, Browser Interaction Module, and localized Food Object names from HTTP results.

**Runtime behavior:** A valid saved `en` or `pl` preference wins. Otherwise, the browser inspects `navigator.languages` in order and selects the first supported primary language. It defaults to English when none match.

A user selection updates memory and persistence. It closes suggestions, removes focus from the search field, and retains unfinished text. Current result IDs, order, and page remain unchanged. Visible names and all interface and accessibility text change locally without an HTTP request.

## ARCH-013 — Food Catalog Data

| Attribute | Value |
| --- | --- |
| Type | Data |
| Status | Active |
| Requirements | REQ-004–REQ-010, REQ-086–REQ-091 |
| Dependencies | PostgreSQL, `data/` production repository |
| ADR | [0001 — Store localized names in Food Object JSONB](0001-localized-names-jsonb.md) |

**Responsibility:** Define the Food Object catalog contracts at the application and production-data boundary.

**Ownership:** ARCH-013 owns REQ-004–REQ-010 and REQ-086–REQ-091. ARCH-006 owns REQ-002. ARCH-007 owns REQ-070–REQ-072. ARCH-006 and ARCH-007 consume this contract but keep application-owned dummy-catalog ownership.

**Application contract:** Food Object is the application and HTTP term for one generic prepared dish in a validated production Meal aggregate. The application owns `api/catalog.schema.json`; it remains available when `data/` is uninitialized. Aggregate fields use `camelCase`: a catalog requires positive integer `schemaVersion`, full 40-character `dataCommit`, `foodFamilies`, and `foodObjects`. Each Food Object requires a stable opaque positive `id`, nonempty `en` and `pl` names, `macroProfile`, and `nutritionBasis` of `g` or `ml`. It may have `serving`, `source`, and `foodFamilyId`; Serving is positive and uses the Nutrition Basis unit. Each Food Object has zero or one Food Family reference. Unknown fields, record revisions, license notices, catalog versions, and release download URLs are invalid.

**Production contract:** The separate `data/` repository owns production authoring records, acquisition, validation, calculation, and aggregate export. Authoring files use `snake_case`, one `ingredients/<id>-<english-slug>.json` file per Ingredient and one `meals/<id>-<english-slug>.json` file per Meal. `food_families.json` is one array of Food Family objects, each with a stable positive opaque `id` and localized names. Each Meal has zero or one `food_family_id` that references this file.

An Ingredient contains `id`, localized `names`, one `source` URL, and `macro_profile` with per-100 g `protein`, `available_carbohydrate`, and `fat`; carbohydrate means available carbohydrate. Its Macro Profile can be all zero when its source supports this, such as for water. Its optional `recipe_terms` contain reviewed source terms that identify that Ingredient. Each term normalizes with Unicode NFKC, case folding, and whitespace collapse; it must be nonempty after normalization, normalized terms are unique on one Ingredient, and no normalized term can identify different Ingredient IDs. The catalog loader builds its normalized term-to-ID lookup only in memory from validated Ingredient records. Its optional `density` contains a positive g/ml `value` and one `source` URL. Its optional `conversions` entries contain one sourced positive finite `quantity_g`, a nonempty `unit`, and an optional nonempty `size`; unit-and-size entries are unique exact keys. A record cannot create more than one applicable direct-gram, sourced-density-millilitre, or stored exact conversion path. A Meal contains `id`, localized `names`, ordered `composition`, ordered `steps`, `yield`, and `nutrition_basis`. Each composition entry contains one `ingredient_id` and positive retained `quantity_g`; Ingredient IDs are unique. Steps are short agent-authored text. A Meal `yield` contains a positive `value` and `method` of exactly `declared_finished_mass`, `declared_finished_volume`, or `summed_input_mass`. A Meal may have one Serving, one source URL, and one `food_family_id`. Git history records changes; records have no revision field. Qualitative salt, dry herbs, and dry spices may occur in steps but never in composition or macro calculation.

**Attribution contract:** Open Food Facts and USDA credit appears only in the production Data Sources footer with the ODbL, the full production-data commit ID, and the free catalog download. It is not stored in the aggregate catalog.

**Flow:** Application-owned dummy catalog data provides local startup, CI, and integration data without `data/`; legacy dummy fixtures do not define production catalog eligibility. ARCH-007 creates this deterministic PostgreSQL state. A production launcher validates and exports `data/` to a temporary aggregate, validates it against the application-owned schema, loads it transactionally, and removes the temporary aggregate. ARCH-006 reads only the loaded PostgreSQL rows. HTTP returns Food Objects, never Ingredients. Candidate similarities, rank order, and pages are derived by the backend; input calories, Matched Quantities, and scaled macronutrients are projected by the browser from canonical Macro Profiles and are never stored.

## ARCH-014 — Interface Language Preference

| Attribute | Value |
| --- | --- |
| Type | Data |
| Status | Active |
| Requirements | REQ-056–REQ-057 |
| Dependencies | Browser `localStorage` |

**Responsibility:** Persist the selected Interface Language in the browser.

**Owner:** ARCH-003.

**Semantic contract:** The stored value is `en` or `pl`. Other values are invalid and are ignored.

**Flow:** A valid stored value initializes the Interface Language. User selection updates the active value and `localStorage`. Missing or invalid data invokes the browser-language resolution in ARCH-012.

## ARCH-015 — Static Presentation Assets

| Attribute | Value |
| --- | --- |
| Type | Data |
| Status | Active |
| Requirements | REQ-011, REQ-055, REQ-069, REQ-073 |
| Dependencies | Vite frontend bundle |

**Responsibility:** Supply deterministic images and placeholder content without a runtime third party, and define the browser typography fallback contract.

**Owner:** ARCH-001.

**Structure contract:** Bundled Food Object images use opaque image keys. One owner-supplied `512×512` lossless sRGB PNG handles an absent or unusable image. Tailwind declares `Inter, system-ui, sans-serif` for UI text and `Roboto Mono, ui-monospace, monospace` for data and labels. Matching the established mealswapp pattern, `@font-face` resolves system-local Inter across weights `100 900` and Roboto Mono across weights `100 700`; no font file is bundled.

**Flow:** A Substitute response carries an optional image key. The browser resolves a known key to its bundled image. An absent, unknown, or failed image resolves to the placeholder. The browser uses an installed Inter or Roboto Mono family when available, otherwise its declared system fallback, and sends no runtime font request.

## ARCH-016 — Local Three-Process Deployment

| Attribute | Value |
| --- | --- |
| Type | Deployment |
| Status | Active |
| Requirements | REQ-001–REQ-002, REQ-073–REQ-075 |
| Dependencies | ARCH-001, ARCH-007–ARCH-009, ARCH-013, ARCH-015 |

**Responsibility:** Place the POC processes and connect them with the minimum local network surface.

**Placement:** Vite, Fiber v3, and PostgreSQL run as three separate local processes. Chromium connects to Vite. Vite proxies same-origin `/api` requests to Fiber. Fiber connects to PostgreSQL through pgx.

**Runtime constraints:** Bun installs frontend dependencies and runs scripts and tests. Vite owns the development server, production bundle, preview server, and `/api` proxy. Development uses Vite dev. Acceptance, visual, browser-integration, and performance checks use the optimized Vite build through Vite preview.

Fiber listens on loopback only. The POC adds no CORS mechanism, TLS, authentication, cookies, rate limiter, or third-party runtime system. The pgx pool has zero minimum and four maximum connections. Local deployment setup and integration fixtures create separate schema-owner and runtime database users before `dbsetup` runs. They remove `PUBLIC` object-creation and temporary-table privileges. The setup command uses the owner credential. Fiber uses the SELECT-only credential. Credentials are environment-provided and are not committed.

## ARCH-017 — Suggestion Ranking Mechanism

| Attribute | Value |
| --- | --- |
| Type | Mechanism |
| Status | Active |
| Requirements | REQ-012–REQ-015, REQ-017, REQ-076 |
| Dependencies | ARCH-004, ARCH-013 |

**Responsibility:** Produce deterministic suggestion order from a Search Query.

**Behavior:** Validate UTF-8. Normalize the Search Query and compared name to NFC. Trim and collapse Unicode whitespace to ASCII spaces. Apply Unicode lowercase mapping. Reject a normalized Search Query over 128 Unicode code points. Compute raw Levenshtein distance over Unicode code points.

Assign each name to its first applicable exact-match, full-name-prefix, substring, or fallback tier. Sort in that tier order. Within each tier, sort by increasing raw distance, pinned Go collation for the active Interface Language, and stable Food Object ID. Apply no match threshold. A valid runtime catalog with at least five Food Objects therefore returns five suggestions for any nonempty accepted Search Query.

**Quality constraints:** Polish diacritics remain distinct from their base letters. Canonically equivalent Unicode text compares equally. Each candidate receives one tier and one distance calculation. The implementation uses bounded Levenshtein working memory and does not allocate a full distance matrix.

## ARCH-018 — Nutrition and Paging Mechanism

| Attribute | Value |
| --- | --- |
| Type | Mechanism |
| Status | Active |
| Requirements | REQ-007, REQ-009–REQ-010, REQ-030, REQ-032–REQ-035, REQ-041–REQ-043, REQ-072 |
| Dependencies | ARCH-005, ARCH-013 |

**Responsibility:** Own catalog access, candidate exclusion, full-precision Nutritional Similarity, deterministic rank order, eligibility counts, and paging independently of Food Quantity.

**Behavior:** The backend request identifies only the selected Food Object ID and requested zero-based page index. Food Quantity does not enter backend request identity, eligibility, ranking, or paging.

Retrieve the canonical per-100 g or per-100 ml Macro Profile `(p, c, f)` for the selected Food Object and candidate Food Objects. Compute full-precision Nutritional Similarity as the cosine similarity of the canonical Macro Profiles. Exclude the selected Food Object and every other member of its Food Family from eligible Substitutes. Sort eligible candidates by decreasing unrounded Nutritional Similarity, pinned English-name collation, and stable Food Object ID.

Count all eligible Substitutes, then slice pages of three. A page contains unique IDs. Page `0` is valid when no eligible Substitute exists. A nonzero page whose first rank does not exist returns `PAGE_OUT_OF_RANGE`.

For the requested page, supply the calculation basis for the selected Food Object (canonical Macro Profile, base unit, exact optional Serving base quantity) and each candidate item (canonical Macro Profile, base unit, exact optional Serving base quantity where applicable, and backend-derived whole similarity percentage). Food Quantity conversion, derived calories, Matched Quantities, and scaled macronutrients are browser projection responsibilities and do not run on the backend.

**Quality constraints:** Use `float64` for all similarity calculations and ranking. Do not round similarity before deterministic sorting; round similarity to a whole percentage point with exact halves rounded up only for display presentation. Food Quantity and Interface Language changes do not change eligible IDs, order, or page for an unchanged catalog.

## ARCH-019 — Request Control and Failure Mechanism

| Attribute | Value |
| --- | --- |
| Type | Mechanism |
| Status | Active |
| Requirements | REQ-048–REQ-051, REQ-074–REQ-075, REQ-080, REQ-082 |
| Dependencies | ARCH-002, ARCH-008, ARCH-010–ARCH-011, ARCH-016 |

**Responsibility:** Bound request concurrency, duration, retry behavior, and visible failure transitions.

**Behavior:** Suggestion requests use an independent latest-query lane. The browser aborts a stale request, and a stale response cannot update state. The 450 ms backend context bounds stale Fiber and pgx work that disconnect cancellation does not stop. Substitution Search and MORE! use one global lock; related actions are disabled while pending. A valid quantity commit is synchronous and local, starts no HTTP request or pending state, does not acquire the lock, and preserves candidate eligibility including `totalEligibleCount` and `hasMore`, result identity, order, page, card identity, motion, focus, Interface Language, and localized text. The system queues nothing.

TanStack Query performs no automatic retry. A later identical intent does not reuse a successful response. Each intent starts a real backend request. Fiber derives a 450 ms Go context and passes it through the operation Module to pgx. The frontend aborts at 500 ms. A timeout uses the stable `SEARCH_TIMEOUT` code and the localized retry state. A spinner is absent within 100 ms after request end.

Structured backend logs contain request ID, method, route template, status, duration, stable error code, and internal cause when applicable. They exclude Search Query text, quantities, request bodies, SQL parameters, database credentials, and stack details from HTTP responses.

**Quality constraints:** At most one substitution request and one current suggestion request can affect browser state. Aborted suggestion work can overlap in Fiber, but the 450 ms deadline and four-connection pgx limit bound it. No retry or stale response can extend or mask a visible failure.

## ARCH-020 — Responsive Accessible Presentation Mechanism

| Attribute | Value |
| --- | --- |
| Type | Mechanism |
| Status | Active |
| Requirements | REQ-003, REQ-011, REQ-018–REQ-021, REQ-036–REQ-038, REQ-044, REQ-055, REQ-060–REQ-063, REQ-068–REQ-069, REQ-073, REQ-078, REQ-080, REQ-082–REQ-085 |
| Dependencies | ARCH-001–ARCH-003, ARCH-015 |

**Responsibility:** Present every browser state with the required layout, data, keyboard behavior, focus, and accessibility semantics.

**Behavior:** Tailwind renders one primary content column. The empty state centers the search control. The result state places it near the top and cards below it. The layout uses one card column from 320 px through 1023 px and three columns from 1024 px. Content does not overflow the viewport.

The suggestion control uses the combobox/listbox pattern, active descendant, required key handling, pointer selection, and visible focus. Invalid quantity text remains visible. Enter or blur commits quantity input. The selected Substitution Input and each result card show browser-projected whole derived calories in kcal with the localized `Calories` or `Kalorie` label. Cards show the bundled image or placeholder, localized name, browser-projected whole Matched Quantity in whole grams or millilitres, scaled macronutrients to 0.1 g, and backend-derived whole similarity percentage. A valid local quantity commit is synchronous and local, starts no HTTP request or pending state, and preserves candidate eligibility including `totalEligibleCount` and `hasMore`, result identity, order, page, card identity, motion, focus, Interface Language, and localized text. While a MORE! request is pending, its focused control keeps the localized label and uses a gray, `aria-disabled` non-operable presentation.

After a successful new Search or MORE! request with one or more result cards, focus moves to the localized results heading. A successful new Search with zero result cards moves focus to the localized zero-result message. A normalized-empty Enter action retains the exact raw Search Query and Search focus and renders no validation state. Successful result states emit no result count or result-status live-region message. Existing loading, validation, and failure live announcements remain unchanged.

**Quality constraints:** All text and interactive states meet WCAG 2.1 AA contrast. Each control has a localized accessible name and visible focus indication. The required behavior works in latest stable Chromium at 320 px, 768 px, and 1280 px.

## ARCH-021 — Card Motion Mechanism

| Attribute | Value |
| --- | --- |
| Type | Mechanism |
| Status | Active |
| Requirements | REQ-052–REQ-054 |
| Dependencies | ARCH-002, ARCH-020 |

**Responsibility:** Animate result-card appearance and replacement.

**Behavior:** One reusable Svelte transition implementation uses keyed result pages. First-page cards use 220 ms transitions in rank order with 100 ms start intervals. MORE! completes a 120 ms outro before replacement cards start the same entrance sequence.

**Quality constraints:** Reduced-motion mode removes all transition durations and delays. All replacement cards appear together.

## ARCH-022 — Architecture Verification Mechanism

| Attribute | Value |
| --- | --- |
| Type | Mechanism |
| Status | Active |
| Requirements | REQ-070–REQ-075; Architecture overhead: verify all architecture seams |
| Dependencies | ARCH-004–ARCH-011, ARCH-013, ARCH-016–ARCH-021 |

**Responsibility:** Verify the architecture through its real interfaces and Adapters.

**Behavior:** Backend integration tests create a disposable database in real PostgreSQL. They run the real setup command and exercise the real Catalog Loader, operation Modules, and Fiber Adapter. They drop the database after the run. CI provides PostgreSQL as a process.

Every frontend integration test uses the generated client, real Fiber backend, and real PostgreSQL. Normal tests share one seeded stack. Browser calculation tests verify the pure projection formulas, Serving base conversion, full precision, and display rounding boundaries. Database-outage tests use a separate Fiber process and disposable PostgreSQL database and run serially. Playwright verifies primary flows, accessibility, motion, responsive widths, focus, failure states, and visual states against the complete deployment.

A dedicated serial GitHub Actions job starts the optimized real stack, warms it up, and gates all required 20-request and 20-search timing samples. OpenAPI generation and compilation of generated Go and TypeScript values verify transport consistency.

**Quality constraints:** Tests observe behavior through architecture interfaces. No repository fake is introduced. Unit tests used during development are removed before commit. Timing checks do not share a runner job with parallel test load.

## Requirement coverage

| Requirement | Architecture coverage |
| --- | --- |
| REQ-001 | ARCH-008, ARCH-016 |
| REQ-002 | ARCH-006 |
| REQ-003 | ARCH-001, ARCH-020 |
| REQ-004 | ARCH-013 |
| REQ-005 | ARCH-013 |
| REQ-006 | ARCH-013 |
| REQ-007 | ARCH-013 |
| REQ-008 | ARCH-013 |
| REQ-009 | ARCH-013 |
| REQ-010 | ARCH-013 |
| REQ-011 | ARCH-015, ARCH-020 |
| REQ-012 | ARCH-004, ARCH-008, ARCH-010, ARCH-017 |
| REQ-013 | ARCH-003, ARCH-004, ARCH-010, ARCH-017 |
| REQ-014 | ARCH-004, ARCH-017 |
| REQ-015 | ARCH-004, ARCH-017 |
| REQ-016 | ARCH-004, ARCH-017 |
| REQ-017 | ARCH-004, ARCH-017 |
| REQ-018 | ARCH-002, ARCH-010, ARCH-020 |
| REQ-019 | ARCH-002, ARCH-010, ARCH-020 |
| REQ-020 | ARCH-002, ARCH-010, ARCH-011, ARCH-020 |
| REQ-021 | ARCH-002, ARCH-010, ARCH-020 |
| REQ-022 | ARCH-004, ARCH-010, ARCH-011 |
| REQ-023 | ARCH-004, ARCH-010 |
| REQ-024 | ARCH-004, ARCH-010 |
| REQ-025 | ARCH-002 |
| REQ-026 | ARCH-002 |
| REQ-027 | ARCH-002 |
| REQ-028 | ARCH-011 |
| REQ-029 | ARCH-001 |
| REQ-030 | ARCH-005, ARCH-018 |
| REQ-031 | ARCH-001 |
| REQ-032 | ARCH-005, ARCH-018 |
| REQ-033 | ARCH-005, ARCH-018 |
| REQ-034 | ARCH-005, ARCH-018 |
| REQ-035 | ARCH-005, ARCH-018 |
| REQ-036 | ARCH-005, ARCH-008, ARCH-011, ARCH-020 |
| REQ-037 | ARCH-020 |
| REQ-038 | ARCH-020 |
| REQ-039 | ARCH-001 |
| REQ-040 | ARCH-001 |
| REQ-041 | ARCH-002, ARCH-005, ARCH-011, ARCH-018 |
| REQ-042 | ARCH-005, ARCH-018 |
| REQ-043 | ARCH-002, ARCH-005, ARCH-011, ARCH-018 |
| REQ-044 | ARCH-002, ARCH-003, ARCH-005, ARCH-011, ARCH-020 |
| REQ-045 | ARCH-002, ARCH-005, ARCH-011 |
| REQ-046 (Deprecated) | Superseded by REQ-080 |
| REQ-047 (Deprecated) | Superseded by REQ-082 |
| REQ-048 | ARCH-002, ARCH-011, ARCH-019 |
| REQ-049 | ARCH-002, ARCH-019 |
| REQ-050 | ARCH-002, ARCH-003, ARCH-008, ARCH-011, ARCH-019 |
| REQ-051 | ARCH-002, ARCH-003, ARCH-008, ARCH-011, ARCH-019 |
| REQ-052 | ARCH-021 |
| REQ-053 | ARCH-021 |
| REQ-054 | ARCH-021 |
| REQ-055 | ARCH-003, ARCH-008, ARCH-012, ARCH-015, ARCH-020 |
| REQ-056 | ARCH-003, ARCH-012, ARCH-014 |
| REQ-057 | ARCH-003, ARCH-012, ARCH-014 |
| REQ-058 | ARCH-002, ARCH-003, ARCH-008, ARCH-012 |
| REQ-059 | ARCH-002, ARCH-003, ARCH-012 |
| REQ-060 | ARCH-001, ARCH-020 |
| REQ-061 | ARCH-001, ARCH-020 |
| REQ-062 | ARCH-020 |
| REQ-063 | ARCH-020 |
| REQ-068 | ARCH-003, ARCH-020 |
| REQ-069 | ARCH-015, ARCH-020 |
| REQ-070 | ARCH-007 |
| REQ-071 | ARCH-007 |
| REQ-072 | ARCH-007 |
| REQ-073 | ARCH-001, ARCH-015, ARCH-016, ARCH-020, ARCH-022 |
| REQ-074 | ARCH-008, ARCH-011, ARCH-016, ARCH-019, ARCH-022 |
| REQ-075 | ARCH-001, ARCH-011, ARCH-016, ARCH-019, ARCH-022 |
| REQ-076 | ARCH-004, ARCH-017 |
| REQ-077 | ARCH-002, ARCH-003, ARCH-010 |
| REQ-078 | ARCH-020 |
| REQ-079 | ARCH-001 |
| REQ-080 | ARCH-002, ARCH-011, ARCH-019 |
| REQ-081 | Deprecated; no architecture coverage |
| REQ-082 | ARCH-002, ARCH-019, ARCH-020 |
| REQ-083 | ARCH-002, ARCH-003, ARCH-011, ARCH-020 |
| REQ-084 | ARCH-002, ARCH-003, ARCH-011, ARCH-020 |
| REQ-085 | ARCH-002, ARCH-003, ARCH-011, ARCH-020 |
| REQ-086 | ARCH-013 |
| REQ-087 | ARCH-013 |
| REQ-088 | ARCH-013 |
| REQ-089 | ARCH-013 |
| REQ-090 | ARCH-013 |
| REQ-091 | ARCH-013 |
