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
- Superseded by the project owner on 2026-08-21. Raw Levenshtein distance is no longer the primary ordering because it penalizes untyped suffixes. Assign normalized active-language names to the first applicable exact-match, full-name-prefix, substring, or fallback tier; order tiers in that sequence; then use raw code-point Levenshtein distance, the pinned active-language collator, and stable Food Object ID within each tier. Keep Polish diacritics significant and keep exactly five suggestions.
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

## ISSUE-006: Phase 5 empty-shell visual and asset decisions

Type: Product decision
Status: ready-for-agent

### Clarifications

- Superseded by the project owner on 2026-08-21. Phase 5 originally used no autofocus. The Search field now receives initial autofocus when the website opens so the visitor can type immediately. The `<input type="search">`, visually hidden localized label, localized placeholder, and no-icon decisions are unchanged.
- Resolved with the project owner on 2026-08-19. The Search field is `56px` high and `min(100%, 640px)` wide. Its box is horizontally centered and its vertical center is `45%` of `100dvh`, with no additional offset. The maximum-`1280px` primary column uses horizontal gutters of `16px` below `640px`, `24px` from `640px` through `1023px`, and `32px` from `1024px`. Playwright measures within `1` CSS px at `320×568`, `768×1024`, and `1280×720`.
- Resolved with the project owner on 2026-08-19. Typography follows the established mealswapp CSS pattern instead of bundling WOFF2: Tailwind uses `Inter, system-ui, sans-serif` for UI text and `Roboto Mono, ui-monospace, monospace` for data and labels; `@font-face` resolves system-local Inter at weights `100 900` and Roboto Mono at weights `100 700`; no runtime font request is allowed.
- Resolved with the project owner on 2026-08-19. `bun run test:e2e` owns a self-contained disposable stack: one `postgres:17-alpine` container on a random loopback port, `scripts/setup_local_database.sh` with ephemeral secrets and a temporary credential file, fixed Fiber at `127.0.0.1:8080`, and a strict-port optimized Vite preview. It requires no prestarted service, fails clearly when an application port is occupied, and cleans owned resources after success, failure, or interruption.
- Resolved with the project owner on 2026-08-19. Playwright records one full-page PNG review attachment at each required viewport, but screenshots are non-gating and are not committed pixel-comparison snapshots. Exact DOM, style, overflow, and `1` CSS px geometry assertions are the acceptance gate.
- Resolved with the project owner on 2026-08-19. The owner supplied generated or commissioned artwork for which they hold the required project-use rights; no attribution is required. The accepted `frontend/src/lib/assets/food-placeholder.png` is a `512×512`, 8-bit, true-color sRGB PNG with no alpha or localized text. Unnecessary source metadata was stripped without changing its pixel signature; the committed file SHA-256 is `741ef3e3a323cc1b47c466aba947aee59cb03790f7ffee754470fbbc64c24b95`.

### Testing coverage deviations

- Phase 5 adds no `@testing-library/svelte` component integration test. The real-stack Playwright scenario covers the exact Search semantics and copy together with the viewport geometry, styles, overflow, API inactivity, and complete deployment; a second DOM-only suite would duplicate the only observable component contract.
- Visual screenshots do not gate because the owner-selected system-local fonts can legitimately render different glyph pixels across hosts. The screenshots remain phase-review evidence; deterministic DOM, computed-style, and geometry assertions gate REQ-060.

## ISSUE-007: Phase 6 language copy, control, storage, and test-boundary decisions

Type: Product and architecture decision
Status: ready-for-agent

### Comments

- Resolved with the project owner on 2026-08-20. The typed dictionaries use exact English copy `Search`, `Search foods`, and `Interface language`, and exact Polish copy `Szukaj`, `Szukaj potraw`, and `Język interfejsu`. The control shows only the active `PL` or `EN` language code and a small downward chevron; both codes remain the fixed native dropdown options in PL-then-EN order.
- Resolved with the project owner on 2026-08-23. The Interface Language control is one borderless native dropdown in the primary column's top-right corner. It is `16px` from the viewport top at all widths. Its right inset uses the responsive gutter: `16px` below `640px`, `24px` from `640px` through `1023px`, and `32px` from `1024px`. It preserves the Search field's `45dvh` center. The transparent control has no resting or hover border, exposes the localized accessible name, retains a minimum `44px` target, and uses a two-pixel Primary focus-visible outline with two-pixel offset. Native pointer and keyboard selection update the persisted Interface Language store.
- Resolved with the project owner on 2026-08-20. Persistence uses browser `localStorage`, not cookies, under key `obiad.interfaceLanguage`, with exact values `en` and `pl`. A failed read behaves as a missing value. A failed write leaves the newly selected language active in memory for the current session without crashing or showing a new error; persistence may therefore be lost on reload. Missing, invalid, and browser-derived initial values are not written. An invalid stored value remains ignored until a user selection overwrites it.
- Resolved with the project owner on 2026-08-20. `bun test` uses pinned `happy-dom` and `@testing-library/svelte` for component integration limited to the Interface Language store and rendered App, Search, and Interface Language components; these tests make no generated-client or network call and start no backend or database. For this component-level seam, ARCH-022's real-stack rule is satisfied by the separate Playwright acceptance scenarios: `bun run test:e2e` exercises the optimized Vite application with real Fiber and PostgreSQL. No permanent unit test is added.

## ISSUE-008: Phase 7 pointer-search presentation and verification decisions

Type: Product and architecture decision
Status: ready-for-agent

### Clarifications

- Resolved with the project owner on 2026-08-20. Phase 7 owns the complete suggestion-control behavior: combobox and listbox roles, stable option IDs, initial active styling and `aria-activedescendant`, pointer activation, Arrow Up and Arrow Down, Enter, Escape, and Tab. Arrow movement clamps at the first and fifth options. Enter selects the active option. Escape closes the list while retaining Search focus and text. Tab closes the list and allows native focus movement. Phase 8 remains reserved, receives no task, behavior, test, or gate, and preserves the downstream phase numbers.
- Resolved with the project owner on 2026-08-20. Use the visible labels `Selected food`, `Protein`, `Carbohydrates`, `Fat`, and `Similarity` in English and `Wybrany produkt`, `Białko`, `Węglowodany`, `Tłuszcz`, and `Podobieństwo` in Polish. The selected value is `localized name · quantity unit`; Serving is `1 serving` or `1 porcja`, while `g` and `ml` remain invariant. Macronutrients always display one localized decimal place, for example `35.0 g` in English and `35,0 g` in Polish. Matched Quantity stays a whole number and similarity stays a whole percentage. The zero-result messages are exactly `No substitutes found` and `Nie znaleziono zamienników`. Card and placeholder images use empty alternative text because the adjacent card heading names the same Food Object.
- Resolved with the project owner on 2026-08-23. Preserve the empty-state Search geometry. From selection onward, put the Search field's top edge `64px` from the viewport top so the complete result surface, including MORE!, fits higher in the desktop viewport. The suggestion panel matches the Search field's maximum `640px` width and contains five `48px` rows. Use Surface with a Secondary border for the panel and Primary with Text-On-Bright for the active option. Put the new-search spinner `12px` below Search, then separate the selected-input and result regions by `24px`. Phase 7 stacks cards in one column and orders each card as image, localized name, Matched Quantity, protein, carbohydrate, fat, and similarity. The later responsive-presentation phase owns final one-versus-three-column behavior and contrast review.
- Superseded by the project owner on 2026-08-23. Remove the new-search spinner below Search. During a pending new search, the selected-food summary keeps its in-card value spinners, but the Search region contains only the Search control and suggestion overlay.
- Superseded by the project owner on 2026-08-21. Implement the fixed REQ-062 card layout before Phase 17: one column from `320px` through `1023px` and three equal columns from `1024px`. Phase 17 still owns complete viewport, overflow, and contrast verification after all controls exist.
- Resolved with the project owner on 2026-08-21. After completed results, typing changes only the draft Search Query: keep the committed selected input and cards visible and keep Search at its result-state position. Show fresh suggestions as an overlay in front of the result surface without displacing it. Pointer activation or Enter on an active suggestion is the commit boundary that removes the prior result and starts the next new-search transition.
- Resolved with the project owner on 2026-08-21. Once the suggestion dropdown is visible, keep the same panel mounted while each changed Search Query triggers its fresh request. Keep the last visible five rows as temporary placeholder content during the request, then replace only the rows when the latest response arrives. Do not close and recreate the panel between characters.
- Superseded by the project owner on 2026-08-21. The suggestion panel no longer starts `8px` below Search. It continuously extends the open Search control with no gap: Search retains a thin bottom border as the query/suggestion divider, loses only its bottom corner radii while open, and the panel has no top border or top corner radii. The panel's two bottom corner radii are `28px`, matching the closed Search pill radius.
- Resolved with the project owner on 2026-08-21. Suggestion labels use the same `36px` left text inset as the Search Query (`28px` radius plus `0.5em`), so all text shares one vertical alignment line.
- Resolved with the project owner on 2026-08-21. Enter, click, or tap selection replaces unfinished Search Query text with the exact returned selected name for the active Interface Language before the Substitution Search starts. Keyboard and pointer activation use the same transition.
- Resolved with the project owner on 2026-08-20. The POC has an empty supported Food Object image-key map. The seeded `pizza-margherita`, `chicken-breast`, `milk`, and `gyoza` values remain opaque catalog data but are unmapped in the browser, so they use the existing approved placeholder exactly like an absent or any other unmapped key. Add no new food artwork or external asset source. An image error resets the source to the same bundled placeholder.

### Testing coverage deviations

- Resolved with the architecture owner on 2026-08-20. `App.result-state.test.ts` may drive a successful empty result through the production browser state and rendered components in happy-dom, without a repository fake, to verify both zero-result messages and zero cards. `ResultCard.test.ts` may render absent and unmapped image keys and dispatch an image error to verify the bundled-placeholder fallback. These are permanent component integration tests, not unit tests.
- Every reachable suggestion, pointer and keyboard selection, pending request, default quantity, and three-card result flow remains covered in Playwright through the generated client, real Fiber, and freshly seeded PostgreSQL. The component-only exceptions above are the narrow ARCH-022 seam for states that ISSUE-003 or the placeholder-only asset policy makes unreachable in the supported real stack.

## ISSUE-009: Phase 9 empty Search Query validation decisions

Type: Product decision
Status: ready-for-agent

### Clarifications

- Resolved with the product owner on 2026-08-21. A normalized-empty Search Query is a strict browser no-op. The browser shows no localized message or invalid state and adds no Translation Module message.
- Resolved with the product owner on 2026-08-21. The empty check matches the ARCH-017 backend normalization contract and Go-compatible Unicode whitespace semantics, including `U+0085` NEXT LINE. The exact raw value stays visible and unchanged.
- Resolved with the product owner on 2026-08-21. Enter with no open suggestion and a normalized-empty value retains Search focus and the current interaction state and starts neither a suggestion request nor a Substitution Search request. The suggestion query is disabled while the draft is normalized-empty.

### Testing coverage deviations

- Resolved with the product owner on 2026-08-21. Phase 9 uses one real-stack Playwright scenario in one English browser context for empty, ASCII-spaces-only, and mixed Unicode-whitespace-only values. The no-op renders no localized text, so repeating the same matrix in Polish adds no language boundary evidence. No happy-dom component integration test is added because it would duplicate the browser-observable Enter, raw-value, focus, state, and request-silence contract. The existing `bun test` suite still runs for regression coverage.

## ISSUE-010: Phase 10 Food Quantity control decisions

Type: Product and architecture decision
Status: ready-for-agent

### Clarifications

- Resolved with the project owner on 2026-08-21. Extend each suggestion with `allowedQuantities`, an ordered list of one or two closed `{unit, maximumValue}` objects. The default unit is first. A Food Object without a Serving exposes only its physical base unit with maximum `100000`. A Food Object with a Serving exposes `serving` with the whole-number floor of `100000` divided by its stored Serving base quantity, then its `g` or `ml` base unit with maximum `100000`. Do not expose Physical State or the stored Serving quantity. Extend every successful Substitute response with backend-calculated `inputMacronutrients` for the committed input quantity, using the same `0.1 g` half-up projection as result cards.
- Resolved with the project owner on 2026-08-21. The selected-food summary is unbordered and uses the same five visible rows on mobile and desktop: localized food name; numeric text field plus unit control; protein; carbohydrate; and fat. The existing `Selected food` or `Wybrany produkt` region name becomes visually hidden. The number field's visually hidden name is `Quantity` or `Ilość`; the selector's is `Unit` or `Jednostka`. Use `g` and `ml` unchanged and plural selector labels `servings` and `porcje`. Two allowed units use a native selector with the committed unit first. One allowed base unit renders as static text.
- Resolved with the project owner on 2026-08-21. During the initial new Search, render the full selected summary with disabled quantity controls and one aria-hidden `16px` spinner in each input-macronutrient value position. Mark the region busy and politely announce `Loading nutrition values` or `Ładowanie wartości odżywczych`. After success, show the backend-provided input macronutrients with the existing captured-language labels and one localized decimal place.
- Superseded by the project owner on 2026-08-23. During the initial new Search and valid quantity recalculation, preserve every card's dimensions, hide all non-image card content, and show exactly one centered aria-hidden `16px` spinner per visible selected-food or result card. Keep result images visible and retain the localized busy announcement.
- Resolved with the project owner on 2026-08-21. The number control is a text input so every invalid raw value remains visible. Base units accept only canonical positive ASCII integers without leading zeros. Serving accepts that integer form or a canonical positive dot decimal with digits on both sides and permits trailing fractional zeros. Reject surrounding whitespace, a leading plus sign, leading zeros, exponent notation, `.5`, `1.`, comma decimals, zero, negatives, empty text, and letters.
- Resolved with the project owner on 2026-08-21. Enter or focus leaving the complete quantity editor commits number text. Moving focus between its controls does not commit an old unit. Selecting another unit replaces the draft with `1` Serving or `100 g` or `100 ml` and commits immediately. A syntactically valid value above the advertised maximum is silently replaced with that whole maximum before commit and produces no visible or assistive clamp notice. Commit and request only when the resolved numeric value or unit differs from the committed quantity; Enter followed by blur and a clamp back to the committed maximum start no duplicate request.
- Resolved with the project owner on 2026-08-21. Invalid commit keeps exact raw text, starts no request, and shows `Enter a valid quantity.` or `Wpisz prawidłową ilość.` through `aria-invalid`, an associated message, and one polite live announcement. The message and invalid state clear as soon as the draft becomes syntactically valid, without committing it. Enter retains number-field focus. Blur never steals focus back. A valid selector commit leaves focus on the selector.
- Resolved with the project owner on 2026-08-21. During quantity recalculation, leave the quantity controls enabled. Keep names, images, labels, and quantity-independent similarity visible. Replace every selected-input macronutrient and every result-card Matched Quantity, protein, carbohydrate, and fat value with an aria-hidden `16px` spinner. Mark the combined region busy and politely announce `Updating quantities` or `Aktualizowanie ilości` once. Render only the current request's response. Phase 12 still owns the complete global request lock and disabled-control behavior.

### Testing coverage deviations

- Resolved with the project owner on 2026-08-21. Add no happy-dom component integration test for Phase 10. Real-PostgreSQL backend integration tests cover `allowedQuantities` and `inputMacronutrients`, and real-stack Playwright scenario `food-quantity-editing.spec.ts` covers the production control, state, generated client, Fiber Adapter, initial and recalculation spinners, validation, localization, focus, request counts, maximum clamping, and result updates. A fetch-stub component scenario would duplicate observable behavior and give weaker ARCH-022 evidence. The existing `bun test` component integration suite still runs for regression coverage.

## ISSUE-011: Phase 11 MORE! paging test boundary

Type: Architecture decision
Status: ready-for-agent

### Clarifications

- Resolved with the project owner on 2026-08-23. Use the visible and accessible paging label `MORE!` in English and `WIĘCEJ!` in Polish.
- Superseded by the project owner on 2026-08-23. During a pending MORE! request, keep the localized `MORE!` or `WIĘCEJ!` label visible, retain focus, expose `aria-disabled=true`, prevent additional activation, and use a gray background with gray text. Render no spinner in the control.

### Testing coverage deviations

- Resolved with the project owner on 2026-08-23. Phase 11 adds no happy-dom or `@testing-library/svelte` component integration scenario. Extended real-PostgreSQL Module and HTTP integration tests cover page bounds, complete deterministic ranking fixtures, exclusions, uniqueness, projections, and stable errors. The real-stack Playwright scenario `more-result-paging.spec.ts` covers the production state transitions, generated client, Fiber Adapter, retained pending cards, in-control spinner, replacement pages, full and partial last pages, complete-search uniqueness, new-search reset, and focus. A fetch-stub component scenario would duplicate these observable contracts and give weaker ARCH-022 evidence. The existing `bun test` component integration suite still runs for regression coverage.
- Superseded by the project owner on 2026-08-23. The real-stack Playwright scenario now verifies the pending control's retained localized label, gray colors, `aria-disabled` state, blocked repeated activation, retained cards, replacement pages, full and partial last pages, complete-search uniqueness, new-search reset, and focus.

## ISSUE-012: Phase 12 request-lock test boundary

Type: Architecture decision
Status: ready-for-agent

### Testing coverage deviations

- Resolved with the project owner on 2026-08-23. Phase 12 adds no happy-dom or `@testing-library/svelte` component integration scenario. The required evidence spans the shared TanStack Query lock, generated client, real Fiber and PostgreSQL response, attempts through every related control, and the browser interval from `PerformanceResourceTiming.responseEnd` to spinner removal. Real-stack Playwright scenarios `substitution-request-lock.spec.ts` and `spinner-stop-time.spec.ts` provide that evidence. A fetch-stub component scenario cannot prove the real-response timing and would duplicate the same control transitions. The existing `bun test` suite remains regression coverage.

## ISSUE-013: Phase 13 substitution failure presentation decisions

Type: Product and architecture decision
Status: ready-for-agent

### Clarifications

- Resolved with the project owner on 2026-08-24. Both failure states use one shared visible retry message. The exact English text is `Could not load substitutions. Try again.` The exact Polish text is `Nie udało się wczytać zamienników. Spróbuj ponownie.`
- Resolved with the project owner on 2026-08-24. Put the retry message at the stable top of the result area, below the selected Substitution Input and above any result heading or cards.
- Resolved with the project owner on 2026-08-24. The exact visible retry message is the only failure announcement. Render it in one atomic polite status region so it is announced one time without interrupting current screen-reader speech. Do not add a duplicate visually hidden message.
- Resolved with the project owner on 2026-08-24. Do not move focus programmatically after a failure. A new-Search failure keeps focus in Search. A MORE! failure keeps focus on the retained MORE! control.
- Resolved with the project owner on 2026-08-24. Add no Retry button. A user retries a new Search through the existing suggestion control. After a MORE! failure, restore the displayed page index and make the retained MORE! control operable. Its next activation requests the same failed next page and does not skip a page.

### Testing coverage deviations

- No new happy-dom or `@testing-library/svelte` component integration scenario is planned. Such a scenario must synthesize a TanStack Query error or replace the generated-client network boundary, and it cannot prove the real stable backend error, separate Fiber and PostgreSQL outage, request count, or no-retry contract. Serial real-stack Playwright scenario `substitution-request-failures.spec.ts` supplies this evidence for both retained states and both Interface Languages. The existing `bun test` suite remains regression coverage.

## ISSUE-014: Phase 14 result-update accessibility decision

Type: Product and architecture decision
Status: ready-for-agent

### Clarifications

- Resolved with the project owner on 2026-08-24. A successful page with one or more result cards sends no result count or result-status live announcement. Phase 15 moves programmatic focus to the localized results heading after every successful new Search, intermediate MORE! page, and last page.
- Resolved with the project owner on 2026-08-24. A successful zero-result new Search sends no result-status live announcement. Phase 15 moves programmatic focus to the localized zero-result message.
- Resolved with the project owner on 2026-08-24. Keep the existing loading, quantity-validation, and request-failure live announcements unchanged. Remove only the planned successful-result announcement and its `Intl.PluralRules` contract.
- Resolved with the project owner on 2026-08-24. REQ-064 through REQ-067 are deprecated. REQ-083 through REQ-085 record the replacement focus and no-success-announcement behavior.

### Testing coverage deviations

- The supported deterministic catalog cannot produce zero eligible Substitutes, as recorded in ISSUE-003. For `P14-G4`, extend `App.result-state.test.ts` to change language in the production `zeroResults` state and assert zero cards, retained state, exact English and Polish visible and accessibility text, and no additional fetch. Do not add a database fixture, a production eligibility rule, or a catalog exception. All reachable page, validation, and failure transitions remain real-stack Playwright coverage.

## ISSUE-015: Phase 15 accessibility verification boundary

Type: Architecture decision
Status: ready-for-agent

### Clarifications

- Resolved with the project owner on 2026-08-25. Use `@axe-core/playwright` with the WCAG 2.1 Level A and AA rule tags. Fail the test for each definite violation. Report incomplete checks for manual review without failing the automated test. Do not enforce the optional axe best-practice rules.

### Testing coverage deviations

- The supported deterministic catalog cannot produce zero eligible Substitutes, as recorded in ISSUE-003. Task 46 therefore uses `App.result-state.test.ts` to drive a successful zero-item response through the production query and `zeroResults` interaction transition and to verify localized focus and successful-result live-region silence in English and Polish. Do not add a database fixture, production eligibility exception, or real-stack Playwright zero-result scenario. All reachable nonzero new-Search and MORE! focus transitions remain real-stack Playwright coverage.

## ISSUE-016: Phase 16 card-motion implementation boundary

Type: Product and architecture decision
Status: ready-for-agent

### Clarifications

- Resolved with the project owner on 2026-08-25. Use one opacity-only card transition with the default Svelte fade easing. Only Result Cards participate. The selected-food summary, result heading, and MORE! control stay outside the keyed transition set.
- Resolved with the project owner on 2026-08-25. Start all current-card outros together and complete each outro after 120 ms. Start no replacement-card intro until every current-card outro completes. In reduced-motion mode, replace the complete card set in one animation frame with no mixed old-and-new page.
- Resolved with the project owner on 2026-08-25. Do not animate retained Result Cards after a successful Food Quantity recalculation. Apply entrance motion to new-Search results and keyed replacement motion to successful MORE! results.
- Resolved with the project owner on 2026-08-25. Move focus to the stable result heading when the successful response renders and card motion starts. Do not delay focus until the last intro finishes.

### Testing coverage deviations

- Resolved with the project owner on 2026-08-25. Add no happy-dom or `@testing-library/svelte` scenario for Phase 16. Those environments do not supply the browser animation-frame scheduling, Svelte transition-event timing, or emulated `prefers-reduced-motion` media feature that the phase must verify. Real-stack Playwright scenario `result-card-motion.spec.ts` supplies the required normal-motion and reduced-motion evidence. `bun test` remains regression coverage for existing component behavior.

## ISSUE-017: Phase 17 responsive and contrast verification boundary

Type: Architecture decision
Status: ready-for-agent

### Testing coverage deviations

- Resolved with the project owner on 2026-08-25. Phase 17 adds no happy-dom or `@testing-library/svelte` component integration scenario. Those environments cannot verify Chromium breakpoints, document and body overflow geometry, hover and focus computed colors, WCAG contrast scans, or full-page screenshots. Real-stack Playwright scenarios `responsive-accessible-presentation.spec.ts` and `control-accessibility.spec.ts` supply this evidence at the three required viewport widths and across the normal and failure states. `bun test` remains regression coverage for existing component behavior.

## ISSUE-018: Phase 18 performance measurement boundary

Type: Product and architecture decision
Status: ready-for-agent

### Clarifications

- Resolved with the project owner on 2026-08-26. Use Pizza Margherita with its default `1 serving` as the stable seeded fixture. Run 20 measured iterations. Each iteration starts one new Search, measures its first Result Card, and then activates MORE!, so the same 20 Search iterations supply the 20 first-card samples.
- Resolved with the project owner on 2026-08-26. Before sampling, run one complete, unmeasured new Search and MORE! flow. This flow warms the browser, optimized Vite preview, Fiber process, PostgreSQL connection, and query paths.
- Resolved with the project owner on 2026-08-26. Measure each Search and MORE! request from `PerformanceResourceTiming.startTime` through `responseEnd`.
- Resolved with the project owner on 2026-08-26. Measure first-card time from the browser event that submits the selected suggestion through the first animation frame in which the first ranked Result Card has a nonempty layout box and computed opacity greater than zero.
- Resolved with the project owner on 2026-08-26. Await each measured response and rendered state before the next action so only one Substitution Search request is active.

### Testing coverage deviations

- Add no Go integration test or Svelte component test for this phase. Those tests cannot measure the optimized browser, Fiber, and PostgreSQL stack or the first painted Result Card. The isolated real-stack Playwright performance scenario supplies the required evidence. Existing backend, component, and end-to-end suites remain regression coverage, but they do not run in the performance job because their load would invalidate the timing samples.

## ISSUE-019: Phase 21 quantity reprojection planning boundary

Type: Architecture decision
Status: ready-for-agent

### Clarifications

- Resolved with the project owner on 2026-08-28. Phase 21 records the approved target architecture contract and adds an explicit transition note. The checked-in OpenAPI and running application remain on the old quantity-dependent contract until Phase 22 implements the target contract.
- Resolved with the project owner on 2026-08-28. Give each revised requirement exactly one primary architecture owner. ARCH-002 owns REQ-025 through REQ-027; ARCH-011 owns REQ-028; ARCH-001 owns REQ-029, REQ-031, REQ-039, and REQ-040; and ARCH-020 owns REQ-037, REQ-038, REQ-078, and REQ-081. Record supporting components in contracts and dependencies, not as additional owners in the requirement-coverage table.

### Testing coverage deviations

- Resolved with the project owner on 2026-08-28. Phase 21 adds no automated behavior test, static contract checker, or full CI run because it changes only requirements and architecture. Run `python3 scripts/validate_phase_plan.py` and prove through the Phase 21 diff that OpenAPI, backend, and frontend files did not change. Phases 22 and 23 own the backend, projection, and browser interaction tests for the revised requirements. Do not record those requirements as verified in Phase 21.

## ISSUE-020: Phase 22 selected calculation-basis response member

Type: Architecture decision
Status: ready-for-agent

### Clarifications

- Resolved with the project owner on 2026-08-28. Name the required closed `POST /api/v1/substitutes/search` response member that contains the selected Food Object calculation basis `selectedFood`. Keep the basis fields nested under this member.
