# Obiad Implementation Plan

Implement the phases in order. Each phase adds one feature or one required technical capability.

Before a phase starts, add concrete tasks for that phase to [the task list](task-list.md). Add tasks for that phase only. Stop after each phase gate. Review the phase diff before the next phase starts.

Use the architecture in [architecture.md](../architecture/architecture.md). Use the terms in [CONTEXT.md](../../CONTEXT.md). Use real PostgreSQL and real HTTP interfaces for integration checks. Do not keep development-only unit tests.

## Phase 1 — Food Catalog schema

**Goal**

Create the minimum backend and the Food Catalog schema.

**Depends on**

No earlier phase.

**Implement**

- Create `backend/go.mod` and `backend/cmd/dbsetup`.
- Implement the schema part of ARCH-007 and ARCH-013.
- Put versioned SQL in `backend/internal/repository/sql/`.
- Store localized names in PostgreSQL JSONB.
- Require nonempty `en` and `pl` names on one Food Object row.
- Require a positive stable Food Object ID.
- Require a Physical State of `solid` or `liquid`.
- Require a finite, nonnegative Macro Profile with at least one positive value.
- Permit one optional positive Serving.
- Permit one optional flat Food Family foreign key.
- Use separate schema-owner and SELECT-only runtime credentials.
- Do not add seed rows.

**Requirements that become testable**

- [REQ-005](../requirements/requirements.md#req-005--stable-food-object-identity)
- [REQ-006](../requirements/requirements.md#req-006--required-localized-names)
- [REQ-008](../requirements/requirements.md#req-008--one-optional-serving)
- [REQ-009](../requirements/requirements.md#req-009--one-optional-food-family)
- [REQ-010](../requirements/requirements.md#req-010--valid-macro-profile)

**Phase gate**

Run `go run ./cmd/dbsetup` from `backend/` against an empty disposable database. Run `go test ./...`. Prove that each valid row succeeds. Prove that each specified invalid row fails. Prove that English and Polish names use one Food Object ID.

**Review stop**

Read the Phase 1 diff. Record REQ-005, REQ-006, and REQ-008 through REQ-010 as verified before Phase 2 tasks are generated.

## Phase 2 — Deterministic Food Catalog seed

**Goal**

Create the complete deterministic Food Catalog. Do not add runtime behavior.

**Depends on**

Phase 1.

**Implement**

- Add transaction-safe seed SQL to ARCH-007.
- Use fixed Food Object IDs.
- Add at least 30 generic Food Objects.
- Add at least nine eligible Substitutes for each designated acceptance input.
- Add plausible production records needed by later acceptance paths without shaping Macro Profiles around artificial test boundaries.
- Keep artificial numeric boundary, tie, and failure data in isolated integration fixtures outside the production seed.
- Defer expected result IDs, similarities, Matched Quantities, ranking, and paging fixtures until the corresponding production behavior exists in Phase 4.
- Do not put expected derived values in production tables.

**Requirements that become testable**

- [REQ-004](../requirements/requirements.md#req-004--generic-food-objects)
- [REQ-070](../requirements/requirements.md#req-070--deterministic-database-setup)
- [REQ-071](../requirements/requirements.md#req-071--catalog-coverage)

REQ-072 needs the calculation code from Phase 4.

**Phase gate**

Apply the setup command to a new database two times. Run `go test ./...` from `backend/`. Both runs must produce the same rows and IDs. Check record counts, acceptance inputs, generic names, and fixed IDs through PostgreSQL integration checks.

**Review stop**

Read the Phase 2 diff. Record REQ-004, REQ-070, and REQ-071 as verified before Phase 3 tasks are generated.

## Phase 3 — Food Object suggestion API

**Goal**

Return five deterministic Food Object suggestions from PostgreSQL.

**Depends on**

Phase 2.

**Implement**

- Add the authoritative OpenAPI document.
- Add generation commands for Go transport models and the TypeScript client.
- Create `backend/cmd/server` for Fiber.
- Implement ARCH-004, ARCH-006, ARCH-008, ARCH-009, and ARCH-017 for suggestions.
- Apply the Fiber and PostgreSQL constraints from ARCH-016.
- Add `GET /api/v1/food-suggestions?query=<text>&language=<en|pl>`.
- Add `GET /health` with the specified ready and unavailable responses.
- Validate UTF-8.
- Normalize the Search Query and names to NFC.
- Trim Unicode whitespace and change repeated whitespace to one ASCII space.
- Apply Unicode lowercase mapping.
- Reject a normalized Search Query longer than 128 Unicode code points.
- Calculate raw Levenshtein distance with bounded working memory.
- Sort by exact-match, full-name-prefix, substring, and fallback tier; within each tier sort by distance, active-language collation, and stable Food Object ID.
- Return both localized names and the default Food Quantity.
- Use the stable errors and deadlines from ARCH-008 and ARCH-019.
- Keep Fiber on loopback.
- Keep runtime PostgreSQL access SELECT-only.
- Create a minimal `frontend/` Bun package only to compile the generated TypeScript client.
- Do not add Svelte, Vite, the `/api` proxy, or suggestion interaction.

**Requirements that become testable**

- [REQ-007](../requirements/requirements.md#req-007--nutrition-basis)
- [REQ-014](../requirements/requirements.md#req-014--query-normalization)
- [REQ-015](../requirements/requirements.md#req-015--polish-characters)
- [REQ-017](../requirements/requirements.md#req-017--suggestion-tie-order)
- [REQ-076](../requirements/requirements.md#req-076--autocomplete-match-order)

Collect backend evidence for REQ-002, REQ-012, REQ-013, REQ-023, and REQ-024. Do not mark REQ-002, REQ-012, REQ-013, REQ-023, or REQ-024 as complete.

**Phase gate**

Generate and compile both clients. Run `go test ./...` from `backend/`. Call `/health`. For one solid fixture, verify a default of 100 g. For one liquid fixture, verify a default of 100 ml. Verify that case and space variants give the same ordered suggestions. Verify that `z` and `ż` have an edit distance of one. Verify exact, prefix, substring, and fallback tier order, within-tier distance order, and both tie orders. Check empty, overlong, decomposed Unicode, and invalid input. Verify the specified stable errors.

**Review stop**

Read the Phase 3 diff. Record REQ-007, REQ-014, REQ-015, REQ-017, and REQ-076 as verified before Phase 4 tasks are generated.

## Phase 4 — First Substitute page API

**Goal**

Return page 0 with display-ready Substitute values.

**Depends on**

Phase 3.

**Implement**

- Add `POST /api/v1/substitutes/search` to the OpenAPI document.
- Use the exact request and response fields from ARCH-008.
- Implement ARCH-005.
- Implement the calculation, eligibility, order, projection, and page-0 parts of ARCH-018.
- Validate Food Quantity syntax and unit compatibility.
- Derive calories from the Macro Profile.
- Calculate Nutritional Similarity with cosine similarity.
- Calculate the Matched Quantity at equal derived calories.
- Exclude the Substitution Input.
- Exclude other members of the Substitution Input's Food Family.
- Sort by full-precision Nutritional Similarity, English name, and stable Food Object ID.
- Return zero to three unique items.
- Round only during response projection: Matched Quantity to a whole base unit, scaled macronutrients to 0.1 g, and Macro similarity to a whole percentage.
- Enforce the 4 KiB request body limit.
- Return the specified stable errors.
- Return `PAGE_OUT_OF_RANGE` for an invalid nonzero page.
- Do not add valid later-page behavior.

**Requirements that become testable**

- [REQ-029](../requirements/requirements.md#req-029--derived-calories)
- [REQ-030](../requirements/requirements.md#req-030--nutritional-similarity)
- [REQ-031](../requirements/requirements.md#req-031--matched-quantity)
- [REQ-035](../requirements/requirements.md#req-035--result-tie-order)
- [REQ-039](../requirements/requirements.md#req-039--display-precision)
- [REQ-040](../requirements/requirements.md#req-040--calculation-precision)

Validate REQ-025 at the HTTP interface. The Playwright check for REQ-025 becomes available in Phase 10.
Collect page-0 evidence for REQ-032 through REQ-034 and REQ-072. Complete full-page checks for REQ-032 through REQ-034 and REQ-072 in Phase 11.

**Phase gate**

Regenerate and compile both clients. Run `go test ./...` from `backend/`. Use the designated fixtures to verify calories, cosine tolerance, exclusions, order, and ties. Verify full precision, whole-unit quantity rounding, one-decimal macronutrient rounding, whole-percentage similarity rounding, exact-half behavior at each target precision, zero results, three results, quantity units, and each applicable stable error.

**Review stop**

Read the Phase 4 diff. Record the listed requirements as verified before Phase 5 tasks are generated.

## Phase 5 — Empty browser shell

**Goal**

Show one empty-state page with the Search control in the prominent center position.

**Depends on**

Phase 3. Phase 5 does not depend on the Phase 4 implementation details.

**Implement**

- Extend the `frontend/` package with Svelte 5, Vite, Tailwind, TanStack Query, and Playwright.
- Add the `test:e2e` Bun script.
- Make the script use the optimized Vite preview, Fiber, and PostgreSQL stack.
- Configure the same-origin `/api` proxy.
- Use the colors, fonts, input style, and maximum width from `docs/requirements/style.md`.
- Use system-local Inter and Roboto Mono with system font fallbacks.
- Bundle the image placeholder.
- Render one primary content column.
- Render only the empty-state Search control.
- Do not add language selection, suggestions, or result cards.

**Requirements that become testable**

- [REQ-060](../requirements/requirements.md#req-060--empty-state-layout)

**Phase gate**

Run the real stack. Run `bun run test:e2e` from `frontend/`. Verify the centered Search control at 320, 768, and 1280 px. Record the first baseline screenshots for the three widths.

**Review stop**

Read the Phase 5 diff. Record REQ-060 as verified before Phase 6 tasks are generated.

## Phase 6 — Interface Language preference

**Goal**

Select the initial Interface Language and persist a user selection.

**Depends on**

Phase 5.

**Implement**

- Implement ARCH-003 for the text present in Phase 6.
- Implement the initial-selection part of ARCH-012.
- Implement ARCH-014.
- Add typed English and Polish dictionaries.
- Use a valid saved value before the browser language.
- Inspect `navigator.languages` in order when no valid value is saved.
- Use English when no supported language matches.
- Add PL and EN controls.
- Save each user selection to `localStorage`.
- Do not add translation of current results.
- Do not add Search field language-change behavior.

**Requirements that become testable**

- [REQ-056](../requirements/requirements.md#req-056--initial-language)
- [REQ-057](../requirements/requirements.md#req-057--language-preference)

**Phase gate**

Run `bun test` and `bun run test:e2e` from `frontend/`. Check `pl-PL`, `en-US`, and `de-DE`. Check missing, invalid, and valid saved values. Check user selection and reload persistence.

**Review stop**

Read the Phase 6 diff. Record REQ-056 and REQ-057 as verified before Phase 7 tasks are generated.

## Phase 7 — Pointer Substitution Search

**Goal**

Let an anonymous visitor operate suggestions with a pointer or keyboard and see the first result state.

**Depends on**

Phases 4 and 6.

**Implement**

- Implement the minimum required behavior from ARCH-001, ARCH-002, ARCH-010, ARCH-011, ARCH-015, ARCH-019, and ARCH-020.
- Use the generated TypeScript client.
- Use TanStack Query for HTTP data.
- Do not copy HTTP data into a Svelte store.
- Request suggestions when a focused Search field has a nonempty Search Query.
- Show exactly five suggestions.
- Highlight the first suggestion.
- Use combobox and listbox active-descendant semantics with stable option IDs.
- Move the active option with Arrow Up and Arrow Down, clamping at the first and fifth options.
- Select the active option with Enter.
- Close the suggestions with Escape while retaining Search focus and text.
- Close the suggestions with Tab and allow native focus movement.
- Abort stale suggestion requests.
- Prevent stale responses from changing the list.
- Select a suggestion with a pointer.
- Replace the Search Query text with the selected suggestion's active-language name before starting the search.
- Send page 0 with the returned default Food Quantity.
- Do not show a spinner below the Search control while a new search is pending.
- Show the selected Substitution Input.
- Show zero or three result cards.
- Use the result-state layout.
- Show the placeholder for an absent, unknown, or failed image.
- Keep focus in the Search field after success.
- Do not add Food Quantity edits, MORE!, request failures, motion, or active-content language changes.

**Requirements that become testable**

- [REQ-001](../requirements/requirements.md#req-001--anonymous-access)
- [REQ-002](../requirements/requirements.md#req-002--seeded-catalog-source)
- [REQ-003](../requirements/requirements.md#req-003--single-page-interface)
- [REQ-011](../requirements/requirements.md#req-011--image-placeholder)
- [REQ-012](../requirements/requirements.md#req-012--five-suggestions)
- [REQ-013](../requirements/requirements.md#req-013--interface-language-search)
- [REQ-018](../requirements/requirements.md#req-018--first-suggestion-highlight)
- [REQ-019](../requirements/requirements.md#req-019--suggestion-keyboard-control)
- [REQ-020](../requirements/requirements.md#req-020--pointer-suggestion-selection)
- [REQ-022](../requirements/requirements.md#req-022--immediate-search)
- [REQ-023](../requirements/requirements.md#req-023--serving-default)
- [REQ-024](../requirements/requirements.md#req-024--nutrition-basis-default)
- [REQ-036](../requirements/requirements.md#req-036--first-result-page)
- [REQ-037](../requirements/requirements.md#req-037--card-data)
- [REQ-038](../requirements/requirements.md#req-038--base-unit-matched-quantity)
- [REQ-044](../requirements/requirements.md#req-044--zero-result-state)
- [REQ-080](../requirements/requirements.md#req-080--no-search-loading-spinner)
- [REQ-061](../requirements/requirements.md#req-061--result-state-layout)
- [REQ-064](../requirements/requirements.md#req-064--search-focus)
- [REQ-077](../requirements/requirements.md#req-077--selected-suggestion-in-search)

Recheck REQ-039 and REQ-040 on rendered cards.

**Phase gate**

Run `bun test` and `bun run test:e2e` from `frontend/`. Use a new browser profile with no authentication. Verify one primary column with the Search, selected-input, and result regions. Verify that the Search is above the cards in the result state. Verify that a normal Search Query and `zzzzzz` each show five suggestions. Verify English and Polish name matching. Verify that the first suggestion is active and is the active descendant. Select the third suggestion with a pointer. Verify that the loaded results use the selected Food Object. Verify one Substitution Search request with no second submit action. Use designated fixtures to verify 1 Serving, 100 g, and 100 ml defaults. Verify expected ranks 1 through 3. Verify each card field in English and Polish. Verify g and ml card units with no Serving equivalent. Verify that an image-less fixture has a placeholder and a valid card. Verify both localized zero-result messages. Keep a real request pending. Verify that the spinner stays below the Search control until the request ends. Verify Search field focus after success. Verify that each food-data request uses `/api` and the seeded PostgreSQL catalog. Verify that Arrow Up and Arrow Down clamp at both list boundaries, Enter selects the active suggestion, Escape closes the list while retaining Search focus and text, and Tab closes the list while allowing native focus movement.

**Review stop**

Read the Phase 7 diff. Record the listed requirements as verified before Phase 9 tasks are generated; Phase 8 is reserved.

## Phase 8 — Reserved after keyboard merge

**Goal**

Preserve phase numbering after suggestion keyboard control moved into Phase 7.

**Depends on**

Phase 7.

**Implement**

- Add no behavior, task, or test.
- Phase 7 owns the complete combobox, listbox, active-descendant, pointer, Arrow Up, Arrow Down, Enter, Escape, and Tab behavior.

**Phase gate**

No separate gate. The Phase 7 gate verifies the merged keyboard behavior.

**Review stop**

Do not generate Phase 8 tasks. After the Phase 7 review, proceed directly to Phase 9.

## Phase 9 — Empty Search Query validation

**Goal**

Treat a normalized empty Search Query as a browser no-op.

**Depends on**

Phases 6 and 7.

**Implement**

- Use the ARCH-017 normalization contract to decide whether the Search Query is empty.
- Keep the exact raw value in the Search field.
- Keep focus in the Search field and change no interaction state.
- Start no suggestion request and no Substitution Search request.
- Show no validation message.
- Do not add Food Quantity validation.

**Requirements that become testable**

- [REQ-021](../requirements/requirements.md#req-021--empty-search-query)

**Phase gate**

Run `bun run test:e2e` from `frontend/`. In one fresh unauthenticated English browser profile, press Enter with empty, spaces-only, and mixed-Unicode-whitespace-only values. Verify that the exact raw value and Search focus remain, no validation state appears, and zero suggestion and Substitution Search requests start.

**Review stop**

Read the Phase 9 diff. Record REQ-021 as verified before Phase 10 tasks are generated.

## Phase 10 — Food Quantity editing

**Goal**

Edit and commit the selected Substitution Input Food Quantity.

**Depends on**

Phase 7.

**Implement**

- Keep raw Food Quantity text in local state until Enter or blur.
- Accept positive integer grams.
- Accept positive integer millilitres.
- Accept positive Serving counts with a dot decimal separator.
- Keep invalid text visible.
- Show a localized message for invalid text.
- Start no request for invalid text.
- Request the current page after a valid commit.
- Update result values after a valid commit.
- Keep result IDs, order, and page.
- While values are pending, preserve each card's size and result image, hide its non-image content, and show one centered spinner per card.

**Requirements that become testable**

- [REQ-025](../requirements/requirements.md#req-025--quantity-syntax)
- [REQ-026](../requirements/requirements.md#req-026--invalid-quantity)
- [REQ-027](../requirements/requirements.md#req-027--quantity-editing)
- [REQ-028](../requirements/requirements.md#req-028--quantity-recalculation)
- [REQ-081](../requirements/requirements.md#req-081--single-card-loading-spinner)

**Phase gate**

Run `bun test` and `bun run test:e2e` from `frontend/`. Change the Food Quantity after the first result page loads. Check valid base-unit integers and dot-decimal Serving counts. Reject fractional base values, comma decimals, zero, negatives, empty text, and letters. Verify that invalid text, focus, and localized messages remain visible. Verify zero requests for invalid values. Verify that valid changes produce proportional values. Verify that result IDs, order, and page do not change. While values are pending, verify exactly one centered spinner per card, hidden non-image content, visible result images, and unchanged card dimensions.

**Review stop**

Read the Phase 10 diff. Record REQ-025 through REQ-028 as verified before Phase 11 tasks are generated.

## Phase 11 — MORE! result paging

**Goal**

Replace current cards with the next three unseen Substitutes.

**Depends on**

Phases 7 and 10.

**Implement**

- Complete valid later-page behavior in ARCH-018.
- Add the MORE! control.
- Keep the localized MORE! label and show the control as gray and non-operable while its request is pending.
- Replace current cards with the requested page.
- Hide MORE! on the last page.
- Reset a new Substitution Search to page 0.
- Keep focus on MORE! after an intermediate page succeeds.
- Move focus to the results heading on the last page.
- Keep Food Object IDs unique across pages.
- Do not add card motion.
- Do not add request failure states.

**Requirements that become testable**

- [REQ-032](../requirements/requirements.md#req-032--input-exclusion)
- [REQ-033](../requirements/requirements.md#req-033--food-family-exclusion)
- [REQ-034](../requirements/requirements.md#req-034--similarity-order)
- [REQ-041](../requirements/requirements.md#req-041--more-replacement)
- [REQ-042](../requirements/requirements.md#req-042--unique-substitutes)
- [REQ-043](../requirements/requirements.md#req-043--last-result-page)
- [REQ-045](../requirements/requirements.md#req-045--new-search-reset)
- [REQ-082](../requirements/requirements.md#req-082--pending-more-control)
- [REQ-065](../requirements/requirements.md#req-065--more-focus)
- [REQ-066](../requirements/requirements.md#req-066--last-page-focus)
- [REQ-072](../requirements/requirements.md#req-072--test-designed-nutrition)


**Phase gate**

Run `go test ./...` from `backend/`. Verify the full-precision ID order and all documented scores and quantities. Verify that all pages exclude the Substitution Input and the Substitution Input's Food Family. Run `bun run test:e2e` from `frontend/`. Keep a real MORE! request pending and verify that the focused control retains its localized label, becomes gray and `aria-disabled`, and accepts no additional activation until the request ends. Check full and partial last pages. Verify replacement instead of append. Verify that all result IDs across all pages are unique. Verify intermediate-page MORE! focus, last-page results-heading focus, and a new Food Object selected from page 2 resetting to page 0.

**Review stop**

Read the Phase 11 diff. Record the listed requirements as verified before Phase 12 tasks are generated.

## Phase 12 — Substitution request lock

**Goal**

Permit one active Substitution Search intent and stop each spinner on time.

**Depends on**

Phase 11.

**Implement**

- Complete the global request lock in ARCH-019.
- Disable related controls during a new Search request.
- Disable related controls during Food Quantity recalculation.
- Disable related controls during a MORE! request.
- Queue no later intent.
- Keep suggestion requests in the independent latest-query lane.
- Remove each spinner within 100 ms after the real request ends.

**Requirements that become testable**

- [REQ-048](../requirements/requirements.md#req-048--single-pending-request)
- [REQ-049](../requirements/requirements.md#req-049--spinner-stop-time)

**Phase gate**

Run `bun run test:e2e` from `frontend/` with delayed real responses. Activate each related control more than one time. Verify one request, no queued request, the disabled state, and spinner removal within 100 ms.

**Review stop**

Read the Phase 12 diff. Record REQ-048 and REQ-049 as verified before Phase 13 tasks are generated.

## Phase 13 — Substitution request failures

**Goal**

Show the correct retained state after a failed new Search or MORE! request.

**Depends on**

Phase 12.

**Implement**

- Add the `newSearchFailure` transition.
- Add the `moreFailure` transition.
- Use stable backend errors.
- Show localized retry messages.
- Do not add automatic retry.
- Clear cards after a new-Search failure.
- Keep the Substitution Input after a new-Search failure.
- Keep cards and MORE! after a MORE! failure.

**Requirements that become testable**

- [REQ-050](../requirements/requirements.md#req-050--new-search-failure)
- [REQ-051](../requirements/requirements.md#req-051--more-failure)

**Phase gate**

Run `bun run test:e2e` from `frontend/` with the separate serial outage stack from ARCH-022. Verify both failure states, retained content, control state, messages in both languages, one request, and no retry.

**Review stop**

Read the Phase 13 diff. Record REQ-050 and REQ-051 as verified before Phase 14 tasks are generated.

## Phase 14 — Active Interface Language change

**Goal**

Translate all current content without a new HTTP request.

**Depends on**

Phases 9 and 13.

**Implement**

- Complete ARCH-003 and ARCH-012.
- Add all interface text to both typed dictionaries.
- Add all validation and retry text to both dictionaries.
- Add all accessible names and announcements to both dictionaries.
- Keep current result IDs, order, and page after a language change.
- Update visible Food Object names locally.
- Remove focus from the Search field.
- Close suggestions.
- Keep unfinished Search Query text.
- Use the new Interface Language on the next focus.
- Start no HTTP request for the language change.

**Requirements that become testable**

- [REQ-055](../requirements/requirements.md#req-055--complete-translation)
- [REQ-058](../requirements/requirements.md#req-058--current-result-translation)
- [REQ-059](../requirements/requirements.md#req-059--search-field-language-change)

Recheck REQ-013, REQ-026, REQ-044, REQ-050, REQ-051, REQ-056, and REQ-057 in both languages.

**Phase gate**

Run `bun test` and `bun run test:e2e` from `frontend/`. Change the Interface Language on page 2. Repeat the change with selected Search text and unfinished Search text. Check each validation state, each failure state, and zero results. Verify no HTTP request. Verify all visible and accessibility text in both languages.

**Review stop**

Read the Phase 14 diff. Record REQ-055, REQ-058, and REQ-059 as verified before Phase 15 tasks are generated.

## Phase 15 — Result announcements and control access

**Goal**

Make each completed interaction state operable and understandable with assistive technology.

**Depends on**

Phase 14.

**Implement**

- Add the localized status region for result counts.
- Add status text for zero results and failures.
- Give each interactive control a localized accessible name.
- Give each interactive control a visible focus indication.
- Use the semantic disabled state where the control is disabled.
- Support the specified keyboard operation for each control.
- Do not change layout or color except to make focus visible.

**Requirements that become testable**

- [REQ-067](../requirements/requirements.md#req-067--result-announcement)
- [REQ-068](../requirements/requirements.md#req-068--accessible-controls)

Recheck REQ-018, REQ-019, REQ-064, REQ-065, and REQ-066.

**Phase gate**

Run `bun run test:e2e` from `frontend/`. Run the accessibility scan and the keyboard-only flow. Check focus and the status region for each result state. Run each check in English and Polish.

**Review stop**

Read the Phase 15 diff. Record REQ-067 and REQ-068 as verified before Phase 16 tasks are generated.

## Phase 16 — Result card motion

**Goal**

Add the specified result-card entrance and replacement motion.

**Depends on**

Phases 11 and 15.

**Implement**

- Implement ARCH-021 with one reusable keyed Svelte transition.
- Use 220 ms card transitions.
- Use 100 ms start intervals in rank order.
- Complete a 120 ms MORE! outro before replacement cards enter.
- Remove all durations and delays in reduced-motion mode.
- Show all replacement cards together in reduced-motion mode.

**Requirements that become testable**

- [REQ-052](../requirements/requirements.md#req-052--first-card-motion)
- [REQ-053](../requirements/requirements.md#req-053--more-card-motion)
- [REQ-054](../requirements/requirements.md#req-054--reduced-motion)

**Phase gate**

Run `bun run test:e2e` from `frontend/`. Check browser timing with a tolerance of one animation frame. Verify rank order and the outro-before-entrance sequence. Verify simultaneous replacement in reduced-motion mode.

**Review stop**

Read the Phase 16 diff. Record REQ-052 through REQ-054 as verified before Phase 17 tasks are generated.

## Phase 17 — Responsive accessible presentation

**Goal**

Complete viewport behavior and color contrast after all controls exist.

**Depends on**

Phase 16.

**Implement**

- Complete ARCH-020.
- Use one card column from 320 through 1023 px.
- Use three card columns at 1024 px or more.
- Prevent horizontal overflow.
- Check default, hover, focus, disabled, error, and loading colors against WCAG 2.1 AA.
- Keep each passing style token from `docs/requirements/style.md`.
- Change only a token or state that fails contrast.

**Requirements that become testable**

- [REQ-062](../requirements/requirements.md#req-062--responsive-card-layout)
- [REQ-063](../requirements/requirements.md#req-063--viewport-fit)
- [REQ-069](../requirements/requirements.md#req-069--color-contrast)
- [REQ-073](../requirements/requirements.md#req-073--poc-compatibility)

**Phase gate**

Run `bun run test:e2e` from `frontend/`. Run the full primary flow in the latest stable Chromium at 320, 768, and 1280 px. Verify card column counts. Verify that `scrollWidth` is not more than `clientWidth`. Run a contrast scan and a visual check for each control state. Capture final screenshots at all three widths.

**Review stop**

Read the Phase 17 diff. Record the listed requirements as verified before Phase 18 tasks are generated.

## Phase 18 — Search performance

**Goal**

Verify the final real stack against the response-time limits.

**Depends on**

Phase 17.

**Implement**

- Add the `test:performance` Bun script.
- Add the serial GitHub Actions performance job from ARCH-022.
- Use the optimized Vite preview, Fiber, and PostgreSQL.
- Warm the stack before samples start.
- Use one active request.
- Do not add a cache.
- Do not add a retry.
- Do not relax a threshold.

**Requirements that become testable**

- [REQ-074](../requirements/requirements.md#req-074--request-response-time)
- [REQ-075](../requirements/requirements.md#req-075--first-card-response-time)

**Phase gate**

Run `bun run test:performance` from `frontend/`. Require 20 consecutive Search samples at 500 ms or less. Require 20 consecutive MORE! samples at 500 ms or less. Require 20 first-card samples at 1 second or less. Report each sample. Fail after one limit breach.

**Review stop**

Read the Phase 18 diff. Record REQ-074 and REQ-075 as verified before Phase 19 tasks are generated.

## Phase 19 — Compact calorie result presentation

**Goal**

Show calories and a compact, centered selected-food card with substitutions visible without desktop scrolling.

**Depends on**

Phases 10 and 17.

**Implement**

- Extend the OpenAPI Substitute response with backend-derived whole display calories for the input and each Substitute.
- Keep the calorie calculation in Go from full-precision Macro Profiles; do not calculate or round calories in the browser.
- Render a centered, compact selected-food card with the existing quantity editor and a calories row.
- Render a localized calories row on every result card.
- Render the centered localized `Found substitutions` or `Znalezione zamienniki` heading above result cards.
- Keep the 1920 × 1080 first-result view free from vertical scroll.

**Requirements that become testable**

- [REQ-078](../requirements/requirements.md#req-078--displayed-calories)
- [REQ-079](../requirements/requirements.md#req-079--compact-result-presentation)

**Phase gate**

Run `go test ./...` from `backend/`. Regenerate and compile both API clients. Run `bun run typecheck`, `bun run format:check`, and `bun run test:e2e` from `frontend/`. At 1920 × 1080, execute a three-card result search and verify the input card, centered heading, and all cards are visible without vertical scroll. Verify the input and every card show the API calorie values with `Calories` or `Kalorie` and `kcal`.

**Review stop**

Read the Phase 19 diff. Record REQ-078 and REQ-079 as verified. The implementation plan is complete.
