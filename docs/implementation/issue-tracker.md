# Issue tracker: Local Markdown

Issues and specs (also called PRDs) for this repository live in this file.

## Conventions

- Keep all issues in this file.
- Give each issue a stable, sequential identifier: `ISSUE-001`, `ISSUE-002`, and so on.
- Write each issue under a second-level heading: `## ISSUE-NNN: Title`.
- Record the issue type as a `Type:` line.
- Record triage state as a `Status:` line using a role from `triage-labels.md`.
- Append discussion under a third-level `### Comments` heading within the issue.
- Never reuse or renumber an identifier.

## When a skill says “publish to the issue tracker”

Append the new issue or PRD to this file, assigning the next unused identifier.

## When a skill says “fetch the relevant ticket”

Read the section whose heading contains the referenced identifier. If the user supplies a title instead, locate the matching issue heading.

## ISSUE-001: Phase 1 credential and architecture-source decisions

Type: Architecture decision
Status: ready-for-agent

### Comments

- Resolved on 2026-08-17. Local deployment setup and integration fixtures create two database users before `dbsetup` runs.
- `dbsetup` uses the schema-owner credential. Fiber uses the separate SELECT-only credential. Application commands do not create database users.
- Local setup removes `PUBLIC` object-creation and temporary-table privileges. One real PostgreSQL integration test must prove that the Fiber credential can read but cannot write or create database objects.
- The ARCH-013 link to ADR 0001 now points to the existing sibling file.

## ISSUE-002: Phase 2 catalog and acceptance fixture designation

Type: Product decision
Status: ready-for-agent

### Comments

- Resolved with the project owner on 2026-08-18. Food Object IDs are the fixed opaque integers `1` through `38`. Application code must not infer meaning or contiguity from them.
- Food Family ID `1` contains only Pizza Margherita and Pizza Capricciosa. Every other Food Object has no Food Family.
- Known image keys are `pizza-margherita`, `chicken-breast`, `milk`, and `gyoza`; all other image keys are `NULL`. Unknown and failed image behavior uses isolated frontend integration fixtures rather than invalid production catalog data.
- Macro Profiles are plausible test-designed source values. Production nutrition is not shaped to manufacture artificial ties or rounding boundaries; later calculation phases own isolated fixtures for those cases.
- Macro Profile values below are grams per Nutrition Basis: `100 g` for solids and `100 ml` for liquids.

| ID | English | Polish | State | Serving | Family | Image key | Protein | Carbohydrate | Fat |
| ---: | --- | --- | --- | ---: | ---: | --- | ---: | ---: | ---: |
| 1 | Pizza Margherita | Pizza margherita | `solid` | 350 g | 1 | `pizza-margherita` | 10 | 30 | 10 |
| 2 | Pizza Capricciosa | Pizza capricciosa | `solid` | 350 g | 1 | — | 11 | 28 | 11 |
| 3 | Lasagna | Lazania | `solid` | 350 g | — | — | 9 | 18 | 8 |
| 4 | Pierogi | Pierogi | `solid` | 250 g | — | — | 6 | 32 | 5 |
| 5 | Chicken breast | Pierś z kurczaka | `solid` | — | — | `chicken-breast` | 31 | 0 | 3.6 |
| 6 | Pork chop | Kotlet wieprzowy | `solid` | — | — | — | 27 | 0 | 14 |
| 7 | Beef steak | Stek wołowy | `solid` | — | — | — | 26 | 0 | 15 |
| 8 | Mixed berries | Owoce jagodowe | `solid` | — | — | — | 1 | 12 | 0.5 |
| 9 | Apple juice | Sok jabłkowy | `liquid` | — | — | — | 0.1 | 11 | 0.1 |
| 10 | Milk | Mleko | `liquid` | — | — | `milk` | 3.4 | 4.8 | 2 |
| 11 | Skyr yogurt | Jogurt skyr | `solid` | 150 g | — | — | 11 | 4 | 0.2 |
| 12 | Greek yogurt | Jogurt grecki | `solid` | 170 g | — | — | 9 | 4 | 5 |
| 13 | Gyoza | Pierożki gyoza | `solid` | 200 g | — | `gyoza` | 8 | 24 | 8 |
| 14 | Oat milk | Napój owsiany | `liquid` | — | — | — | 1 | 7 | 1.5 |
| 15 | Kebab | Kebab | `solid` | 350 g | — | — | 15 | 18 | 12 |
| 16 | Gyros | Gyros | `solid` | 300 g | — | — | 18 | 10 | 14 |
| 17 | Polish chicken soup | Rosół | `liquid` | 300 ml | — | — | 2 | 1 | 1 |
| 18 | Butter | Masło | `solid` | — | — | — | 0.5 | 0.5 | 82 |
| 19 | Olive oil | Oliwa z oliwek | `liquid` | — | — | — | 0 | 0 | 91.3 |
| 20 | Protein shake | Shake białkowy | `liquid` | 300 ml | — | — | 8 | 4 | 1 |
| 21 | Beef cheeseburger | Cheeseburger wołowy | `solid` | 220 g | — | — | 13 | 24 | 13 |
| 22 | Fried chicken wings | Smażone skrzydełka z kurczaka | `solid` | 180 g | — | — | 22 | 8 | 20 |
| 23 | Turkey breast | Pierś z indyka | `solid` | — | — | — | 29 | 0 | 2 |
| 24 | Pickled cucumbers | Ogórki kiszone | `solid` | — | — | — | 0.5 | 2 | 0.2 |
| 25 | Tomatoes | Pomidory | `solid` | — | — | — | 0.9 | 3.9 | 0.2 |
| 26 | Pancakes | Naleśniki | `solid` | 150 g | — | — | 6 | 28 | 7 |
| 27 | Omelette | Omlet | `solid` | 180 g | — | — | 11 | 1 | 12 |
| 28 | Oatmeal | Owsianka | `solid` | 250 g | — | — | 2.5 | 12 | 1.5 |
| 29 | Paella | Paella | `solid` | 350 g | — | — | 8 | 20 | 5 |
| 30 | Pho | Zupa pho | `liquid` | 400 ml | — | — | 3 | 8 | 1.5 |
| 31 | Beetroot borscht | Barszcz czerwony | `liquid` | 300 ml | — | — | 1 | 7 | 0.5 |
| 32 | Coleslaw | Surówka coleslaw | `solid` | 100 g | — | — | 1 | 10 | 8 |
| 33 | Mondongo | Zupa mondongo | `liquid` | 350 ml | — | — | 7 | 8 | 4 |
| 34 | Bandeja paisa | Bandeja paisa | `solid` | 500 g | — | — | 12 | 20 | 15 |
| 35 | Pastel de nata | Pastel de nata | `solid` | 60 g | — | — | 5 | 35 | 14 |
| 36 | Cheesecake | Sernik | `solid` | 120 g | — | — | 7 | 25 | 18 |
| 37 | Orange juice | Sok pomarańczowy | `liquid` | — | — | — | 0.7 | 10 | 0.2 |
| 38 | Goulash | Gulasz | `solid` | 350 g | — | — | 15 | 6 | 10 |

- Designated acceptance inputs are Pizza Margherita at one Serving (`350 g`), Chicken breast at `100 g`, and Milk at `100 ml`. Their eligible-candidate counts are `36`, `37`, and `37`.
- Derived rankings, result IDs, Nutritional Similarities, Matched Quantities, numeric tolerances, and projection cases are implementation-test data owned by the later behavior phases, not this product decision.

## ISSUE-003: Phase 2 zero-result catalog compatibility

Type: Architecture decision
Status: wontfix

### Comments

- Resolved on 2026-08-18. Zero eligible Substitutes are unreachable in the supported POC deployment because the deterministic catalog satisfies REQ-071 and the runtime credential cannot change catalog data.
- REQ-044 remains active as defensive frontend behavior for a successful empty response. The project will not add a separate PostgreSQL fixture, a production eligibility rule, or a catalog-coverage exception for this unreachable acceptance scenario.

## ISSUE-004: Phase 3 transport and runtime contract decisions

Type: Architecture decision
Status: ready-for-agent

### Comments

- Resolved on 2026-08-18. Generate Go transport models and the TypeScript HTTP client and types. Do not generate a Go HTTP client because the supported application has no Go API consumer. For `P03-G1`, “both clients” means the generated Go transport boundary and the generated TypeScript client; the gate does not require an unused Go HTTP client.

- Resolved on 2026-08-18. Pin `github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen` at `v2.8.0` as a Go tool dependency and configure it to generate Go transport models only. Pin `@hey-api/openapi-ts` at `0.99.0` in `frontend/package.json`, lock its dependency graph in `bun.lock`, and configure its Fetch client plus TypeScript type generation. Commit the OpenAPI document, generator configurations, direct version pins, and lockfile; do not commit generated Go or TypeScript source. `go generate ./...` and `bun run generate:api` must each produce byte-identical output on an immediate second run, after which `go test ./...` and `bun run typecheck` compile the generated boundaries.
- Resolved on 2026-08-18. Pin `golang.org/x/text` at `v0.41.0`. Compare the normalized lowercase active-language name with `collate.New(language.English)` for English and `collate.New(language.Polish)` for Polish, using no collation options. Sort first by raw code-point Levenshtein distance, then by the selected collator, and finally by stable Food Object ID. Polish diacritics remain significant; do not use loose, accent-insensitive, numeric, or custom collation.
- Resolved on 2026-08-18. `GET /api/v1/food-suggestions` requires exactly one `query` and one `language` parameter. A `200` response is `{"items":[...]}` with exactly five items and no unknown fields; each item has a positive 32-bit integer `foodObjectId`, required nonempty `names.en` and `names.pl`, and `defaultQuantity` with numeric `value` plus unit `serving`, `g`, or `ml`. The backend emits only `1 serving`, `100 g`, or `100 ml`. `backend/cmd/server` has no listen-address configuration and binds to `127.0.0.1:8080`; test composition may use `127.0.0.1:0`. Error JSON has required stable `code`, optional `field`, and no unknown fields; this operation permits only `query` or `language` as `field`. A missing or duplicate parameter returns `400 INVALID_REQUEST` with that field; malformed query encoding returns `400 INVALID_REQUEST` without a field; a normalized-empty or invalid-UTF-8 Search Query returns `422 INVALID_SEARCH_QUERY` with `query`; an overlong Search Query returns `422 QUERY_TOO_LONG` with `query`; any language other than exact `en` or `pl`, including invalid UTF-8, returns `422 UNSUPPORTED_LANGUAGE` with `language`; storage failure returns `503 CATALOG_UNAVAILABLE`; deadline expiry returns `504 SEARCH_TIMEOUT`; catalog-invariant and unexpected failures return `500 INTERNAL_ERROR`. Server failures omit `field` and expose no internal cause.

- No Playwright or browser-integration test is planned because the phase explicitly excludes Svelte, Vite, the `/api` proxy, and suggestion interaction. The generated TypeScript client is compile-checked only; backend API tests collect evidence for REQ-002, REQ-012, REQ-013, REQ-023, and REQ-024 without marking them complete.
- No permanent unit test is planned for normalization or Levenshtein internals. [ARCH-022](../architecture/architecture.md#arch-022--architecture-verification-mechanism) requires committed tests to exercise the real Catalog Loader, operation Module, and Fiber Adapter with disposable PostgreSQL and requires development-only unit tests to be removed.

## ISSUE-005: Phase 4 Substitute API contract and verification decisions

Type: Architecture decision
Status: ready-for-agent

### Comments

- Resolved with the project owner on 2026-08-19. The POST accepts only `application/json` and uses strict canonical JSON. Every request and response object is closed. Runtime decoding rejects empty or malformed JSON, trailing JSON, unknown keys, and duplicate keys at every nesting level; OpenAPI uses `additionalProperties: false` wherever it can express the same rule.
- The request has required positive `int32` `foodObjectId`, required `quantity` with `double` `value` and unit `g`, `ml`, or `serving`, and required nonnegative `int32` `pageIndex`. The generated shape does not attempt conditional base-unit integrality or Physical State compatibility; the Module enforces those semantic rules.
- A successful response has nonnegative `int32` `pageIndex` and `totalEligibleCount`, Boolean `hasMore`, and zero to three items with unique Food Object IDs. Each item has positive `int32` `foodObjectId`, both localized names, optional nonempty `imageKey` omitted when absent and never `null`, `matchedQuantity` with whole nonnegative `int64` `value` and unit `g` or `ml`, `macronutrients` with nonnegative `double` `protein`, `carbohydrate`, and `fat`, and `int32` `similarityPercent` from 0 through 100.
- The allowed `Error.field` values are `foodObjectId`, `quantity`, `quantity.value`, `quantity.unit`, and `pageIndex`. Empty, malformed, or trailing JSON, an unknown key, and a missing or non-JSON Content-Type return `400 INVALID_REQUEST` without `field`. A missing, duplicate, `null`, or wrong-typed known field returns `400 INVALID_REQUEST` with that field path. A nonpositive Food Object ID returns `400 INVALID_REQUEST` with `foodObjectId`; an absent positive ID returns `404 FOOD_OBJECT_NOT_FOUND` with `foodObjectId`.
- A nonpositive or nonintegral direct base quantity returns `422 INVALID_QUANTITY` with `quantity.value`; an unsupported unit returns `422 INVALID_QUANTITY` with `quantity.unit`; a Physical State mismatch returns `422 QUANTITY_UNIT_MISMATCH` with `quantity.unit`; an unavailable Serving returns `422 SERVING_UNAVAILABLE` with `quantity.unit`; and a converted quantity over `100,000 g` or `100,000 ml` returns `422 QUANTITY_OUT_OF_RANGE` with `quantity.value`. A negative page returns `422 INVALID_PAGE_INDEX` with `pageIndex`.
- Every `pageIndex > 0` returns `422 PAGE_OUT_OF_RANGE` with `pageIndex` until Phase 11 deliberately adds valid later-page behavior. A body over 4 KiB returns `413 REQUEST_BODY_TOO_LARGE` without `field`. `CATALOG_UNAVAILABLE`, `SEARCH_TIMEOUT`, and `INTERNAL_ERROR` never carry `field`.
- Permanent cosine comparisons use absolute tolerance `abs(got - want) <= 1e-12`. This is a test comparison only; production ranking uses the full unrounded `float64` values and no tolerance-based tie.
- Calculation verification uses one hybrid real-PostgreSQL integration test. It exercises the concrete `Run` interface for behavior, then passes Macro Profiles loaded through the real private Catalog Loader directly to the private production calorie, cosine, and Matched Quantity helpers for full-precision assertions. It adds no exported interface, fake Adapter, or test hook.

### Testing coverage deviations

- No Playwright check is planned here. The frontend remains the generated-client compile package; the plan validates REQ-025 at HTTP and defers its browser quantity-control evidence to Phase 10.
- A successful zero-item runtime response is not exercised. ISSUE-003 records that zero eligible Substitutes are unreachable with the supported deterministic catalog and forbids a separate PostgreSQL fixture, production eligibility rule, or catalog-coverage exception. `P04-G4` therefore covers the generated zero-to-three schema and all reachable page-0 runtime outcomes, but omits the otherwise requested zero-result execution.
