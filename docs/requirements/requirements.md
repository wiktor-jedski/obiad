# Obiad Requirements

This document is the source of truth for the active product requirements of the Obiad proof of concept.

## REQ-001 — Anonymous access

**Statement:** The POC shall make all substitution functions available to each visitor.

| Attribute | Value |
| --- | --- |
| Type | Constraint |
| Status | Active |
| Verification | Playwright: A visitor completes a search in a new browser profile with no account or authentication step. |

## REQ-002 — Seeded catalog source

**Statement:** The POC shall get all Food Objects from the seeded PostgreSQL catalog.

| Attribute | Value |
| --- | --- |
| Type | Constraint |
| Status | Active |
| Verification | Network check: All food-data requests use the local backend and the seeded database. |

## REQ-003 — Single-page interface

**Statement:** The POC shall use one primary content column for the search, selected input, and results.

| Attribute | Value |
| --- | --- |
| Type | Constraint |
| Status | Active |
| Verification | Playwright: The page has one primary content column with the three specified regions. |

## REQ-004 — Generic Food Objects

**Statement:** The seeded catalog shall contain generic foods and generic prepared dishes.

| Attribute | Value |
| --- | --- |
| Type | Constraint |
| Status | Active |
| Verification | Seed check: Each record is a generic food or a generic prepared dish. |

## REQ-005 — Stable Food Object identity

**Statement:** Each Food Object shall have one stable identity for all localized names.

| Attribute | Value |
| --- | --- |
| Type | Constraint |
| Status | Active |
| Verification | Database test: The English and Polish forms of one record have the same Food Object ID. |

## REQ-006 — Required localized names

**Statement:** The database shall accept a Food Object only when it has one English name and one Polish name.

| Attribute | Value |
| --- | --- |
| Type | Constraint |
| Status | Active |
| Verification | Database test: A complete record succeeds. A record with one missing name fails. |

## REQ-007 — Nutrition Basis

**Statement:** Each solid Food Object shall use 100 g, and each liquid Food Object shall use 100 ml, as its Nutrition Basis.

| Attribute | Value |
| --- | --- |
| Type | Constraint |
| Status | Active |
| Verification | API test: One solid fixture returns 100 g. One liquid fixture returns 100 ml. |

## REQ-008 — One optional Serving

**Statement:** The database shall permit a maximum of one standard Serving for each Food Object.

| Attribute | Value |
| --- | --- |
| Type | Constraint |
| Status | Active |
| Verification | Database test: Zero or one Serving succeeds. A second Serving fails. |

## REQ-009 — One optional Food Family

**Statement:** The database shall permit a maximum of one flat Food Family for each Food Object.

| Attribute | Value |
| --- | --- |
| Type | Constraint |
| Status | Active |
| Verification | Database test: Zero or one membership succeeds. A second or nested membership fails. |

## REQ-010 — Valid Macro Profile

**Statement:** The database shall accept a Macro Profile only when all values are present and nonnegative and at least one value is positive.

| Attribute | Value |
| --- | --- |
| Type | Constraint |
| Status | Active |
| Verification | Database test: Each invalid profile fails. Each valid profile succeeds. |

## REQ-011 — Image placeholder

**Statement:** IF a Food Object has no usable image, THEN its card shall show the bundled placeholder.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: An image-less fixture shows the placeholder and a valid card. |

## REQ-012 — Five suggestions

**Statement:** WHEN a focused search field contains a Search Query, the system shall show exactly five Food Object suggestions.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: A normal query and zzzzzz each show five suggestions. |

## REQ-013 — Interface-language search

**Statement:** The system shall compare a Search Query with Food Object names for the active interface language.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: English mode uses English names. Polish mode uses Polish names. |

## REQ-014 — Query normalization

**Statement:** Before comparison, the system shall remove spaces at the start and end, change repeated spaces to one space, and ignore letter case.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | API test: Case and space variants give the same ordered suggestions. |

## REQ-015 — Polish characters

**Statement:** The system shall keep Polish diacritics as characters that are different from their base letters.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | API test: z and ż have an edit distance of one. |

## REQ-016 — Levenshtein order

**Statement:** The system shall sort suggestions by increasing raw Levenshtein distance.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Deprecated |
| Verification | Historical API test: A known fixture has the expected raw-distance order. |

**Notes:** Deprecated because raw distance penalizes untyped suffixes and gives counter-intuitive autocomplete results. Replaced by REQ-076.

## REQ-017 — Suggestion tie order

**Statement:** Within one suggestion match tier, for equal raw Levenshtein distances, the system shall sort suggestions by active-language name and then by stable Food Object ID.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | API test: Tied fixtures have the specified order. |

## REQ-018 — First suggestion highlight

**Statement:** WHEN suggestions open, the system shall highlight the first suggestion.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: The first item is visible as the active item and active descendant. |

## REQ-019 — Suggestion keyboard control

**Statement:** The suggestion control shall use arrows to move, Enter to select, Escape to close, and Tab to move focus.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: Each key gives the specified selection, list, or focus state. |

## REQ-020 — Pointer suggestion selection

**Statement:** WHEN a user clicks or taps a suggestion, the system shall select that Food Object and start the search.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: Pointer selection of the third suggestion loads results for that Food Object. |

## REQ-021 — Empty Search Query

**Statement:** IF the normalized Search Query is empty, THEN the browser shall do nothing: keep the exact raw value and Search focus, show no validation message, change no interaction state, and start no Food Object suggestion or Substitution Search request.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: Empty, spaces-only, and mixed Unicode-whitespace-only values keep their exact raw values and focus and start zero suggestion and Substitution Search requests. |

## REQ-022 — Immediate search

**Statement:** WHEN a user selects a suggestion, the system shall start a substitution search with the default quantity.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: Selection starts one search with no second submit action. |

## REQ-023 — Serving default

**Statement:** WHERE a selected Food Object has a Serving, the default Substitution Input quantity shall be 1 Serving.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: A fixture with a Serving starts with 1 Serving. |

## REQ-024 — Nutrition Basis default

**Statement:** WHERE a selected Food Object has no Serving, the default quantity shall be its Nutrition Basis.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: Solid and liquid fixtures start with 100 g and 100 ml. |

## REQ-025 — Quantity syntax

**Statement:** The browser quantity control shall accept positive integer grams or millilitres and positive Serving counts that use a dot decimal separator.

| Attribute | Value |
| --- | --- |
| Type | Constraint |
| Status | Active |
| Verification | Playwright: Valid values succeed. Fractional base values, comma decimals, zero, negatives, empty text, and letters fail. |

## REQ-026 — Invalid quantity

**Statement:** IF an entered quantity is invalid, THEN the browser shall cancel submission, keep the value, and show a localized field message.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: Each invalid value stays visible, starts zero requests, and shows the message. |

## REQ-027 — Quantity editing

**Statement:** WHILE results are visible, the browser shall let the user edit the Substitution Input quantity without changing the current result values until the edited value is committed.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: A user changes the quantity after the first result page loads. |

## REQ-028 — Quantity recalculation

**Statement:** WHEN a valid quantity is committed, the browser shall reproject the current page values locally from the returned calculation basis, start no HTTP request, and keep eligibility, result identity, order, page, motion, focus, and Interface Language unchanged.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: After a valid commit the input and card values change proportionally and eligibility, result identity, order, page, focus, and Interface Language are unchanged, and no Substitute Search request is started. Browser calculation test: reprojected values match the full-precision projection. |

## REQ-029 — Derived calories

**Statement:** The browser shall derive calories from the returned canonical per-100 g or per-100 ml Macro Profile as 4 times protein plus 4 times carbohydrate plus 9 times fat.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Browser calculation test: A known per-100 Macro Profile and committed quantity give the expected full-precision input calories before display rounding. |

## REQ-030 — Nutritional Similarity

**Statement:** The system shall calculate Nutritional Similarity as the cosine similarity of the input and candidate Macro Profiles.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Calculation test: Known vectors give the expected values within the specified floating-point tolerance. |

## REQ-031 — Matched Quantity

**Statement:** The browser shall compute each candidate equal-calorie Matched Quantity from its returned canonical per-100 g or per-100 ml Macro Profile so that it contains the same derived calories as the entered Substitution Input quantity.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Browser calculation test: Known per-100 Macro Profiles give the expected unrounded equal-calorie Matched Quantities before display rounding. |

## REQ-032 — Input exclusion

**Statement:** The system shall remove the Substitution Input Food Object from the eligible Substitutes.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | API test: The input Food Object ID is absent from all result pages. |

## REQ-033 — Food Family exclusion

**Statement:** WHERE the input has a Food Family, the system shall remove all other members of that Food Family from eligible Substitutes.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | API test: Pizza Margherita results contain zero other pizza-family IDs. |

## REQ-034 — Similarity order

**Statement:** The system shall sort eligible Substitutes by decreasing unrounded Nutritional Similarity.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | API test: Result IDs match the full-precision fixture order. |

## REQ-035 — Result tie order

**Statement:** For equal Nutritional Similarity, the system shall sort Substitutes by English name and then by stable Food Object ID.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | API test: Tied result IDs have the same order in English and Polish. |

## REQ-036 — First result page

**Statement:** WHEN three or more eligible Substitutes exist, the first result page shall show the first three Substitutes.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: A designated input shows expected ranks 1, 2, and 3. |

## REQ-037 — Card data

**Statement:** Each result card shall show an image, localized name, the browser-projected Matched Quantity, the three browser-scaled macronutrients, and the backend-derived whole-number Macro similarity percentage.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright and browser calculation test: Each card shows the returned name and backend similarity plus the browser-projected Matched Quantity and macronutrients in English and Polish. |

## REQ-038 — Base-unit Matched Quantity

**Statement:** Each card shall show the browser-rounded Matched Quantity as whole grams for solids or whole millilitres for liquids.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: Cards show the browser-rounded whole g or ml and do not show a Serving equivalent. |

## REQ-039 — Display precision

**Statement:** The browser shall apply final display rounding to full-precision projected values, rounding Matched Quantity to a whole gram or millilitre and each macronutrient to 0.1 g; the Macro similarity percentage is presented as a whole percentage point.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Browser calculation test: Boundary fixtures show whole-unit Matched Quantity and one-decimal macronutrients, use the specified precision, and round exact halves up; Macro similarity is presented as a whole percentage point. |

## REQ-040 — Calculation precision

**Statement:** The browser shall use full calculation precision for the projection before it applies final display rounding.

| Attribute | Value |
| --- | --- |
| Type | Quality (Accuracy) |
| Status | Active |
| Verification | Browser calculation test: A fixture that is sensitive to early rounding gives the full-precision projection result. |

## REQ-041 — MORE replacement

**Statement:** WHEN the user activates MORE!, the system shall replace the cards with the next three unseen Substitutes.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: Expected next-page IDs replace all current card IDs. |

## REQ-042 — Unique Substitutes

**Statement:** Each Food Object shall appear a maximum of one time in one Substitution Search.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | API test: All result IDs across all pages are unique. |

## REQ-043 — Last result page

**Statement:** WHEN the current page is the last page, the system shall show the remaining Substitutes and hide MORE!.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: Full and partial last pages show all remaining IDs and hide MORE!. |

## REQ-044 — Zero-result state

**Statement:** IF zero eligible Substitutes exist, THEN the system shall replace the result area with a localized result message.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: The zero-result state shows the message in English and Polish. |

## REQ-045 — New-search reset

**Statement:** WHEN the user selects a new Food Object, the system shall show the first result page for the new search.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: A new selection after page 2 shows expected ranks 1, 2, and 3. |

## REQ-046 — Search spinner

**Statement:** WHILE a new search request is pending, the system shall show a spinner below the search control.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Deprecated |
| Verification | Superseded by REQ-080. |

**Notes:** Deprecated by the project owner on 2026-08-23 because the pending new-search state shall not show a spinner below Search. REQ-080 replaces this requirement.

## REQ-047 — MORE! spinner

**Statement:** WHILE a MORE! request is pending, the system shall show a spinner in the MORE! control.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Deprecated |
| Verification | Superseded by REQ-082. |

**Notes:** Deprecated by the project owner on 2026-08-23 because the pending MORE! control shall keep its label and use a gray disabled presentation. REQ-082 replaces this requirement.

## REQ-048 — Single pending request

**Statement:** WHILE a request is pending, the system shall accept one activation of the related control.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: Repeated activation starts exactly one request. |

## REQ-049 — Spinner stop time

**Statement:** The system shall remove a pending spinner within 100 ms after the request ends.

| Attribute | Value |
| --- | --- |
| Type | Quality (Performance) |
| Status | Active |
| Verification | Browser timing: Each spinner is absent within 100 ms after the real response ends. |

## REQ-050 — New-search failure

**Statement:** IF a new search fails, THEN the system shall clear cards, keep the input, and show a localized retry message.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Failure check: A database outage gives the specified cards, input, and message states. |

## REQ-051 — MORE! failure

**Statement:** IF a MORE! request fails, THEN the system shall keep the cards and control and show a localized retry message.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Failure check: A database outage on page 2 gives the specified cards, control, and message states. |

## REQ-052 — First card motion

**Statement:** WHEN first-page results load, cards shall appear in rank order with 220 ms transitions and 100 ms start intervals.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Browser timing: Card order and times are within one animation frame of the specified values. |

## REQ-053 — MORE! card motion

**Statement:** WHEN MORE! succeeds, current cards shall fade for 120 ms before replacement cards use the first-card motion.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Browser timing: The fade ends before replacement motion starts, and all specified times pass. |

## REQ-054 — Reduced motion

**Statement:** WHILE reduced motion is active, the system shall show all replacement cards immediately.

| Attribute | Value |
| --- | --- |
| Type | Quality (Accessibility) |
| Status | Active |
| Verification | Playwright: Reduced-motion emulation shows all replacement cards at the same time. |

## REQ-055 — Complete translation

**Statement:** The POC shall provide English and Polish text for all interface content and accessibility content.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: Both languages have all labels, food names, messages, accessible names, and announcements. |

## REQ-056 — Initial language

**Statement:** The browser language shall set the initial interface language before the user saves a language preference.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: pl-PL gives Polish. en-US and de-DE give English. |

## REQ-057 — Language preference

**Statement:** WHEN the user selects PL or EN, the system shall apply and save the selected language.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: The selected language stays active after reload. |

## REQ-058 — Current-result translation

**Statement:** WHEN the language changes, the system shall keep current result IDs and order and update the visible Food Object names.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: A page-2 language change updates names and keeps IDs and order. |

## REQ-059 — Search field language change

**Statement:** WHEN the language changes, the search field shall lose focus, close suggestions, keep unfinished text, and use the new language at next focus.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: Selected-text and unfinished-text cases give the specified field and suggestion states. |

## REQ-060 — Empty-state layout

**Statement:** Before the first result state, the system shall put the search control in the prominent center position.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Browser check: The empty state has the search control in the specified center position. |

## REQ-061 — Result-state layout

**Statement:** WHILE results are visible, the system shall put the search control near the top and the cards below it.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Browser check: The result state has the specified vertical order. |

## REQ-062 — Responsive card layout

**Statement:** The system shall show three card columns at 1024 px or more and one card column from 320 px through 1023 px.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Browser check: Viewports of 320, 768, and 1280 px have the specified column counts. |

## REQ-063 — Viewport fit

**Statement:** At viewport widths of 320 px or more, all page content shall fit inside the viewport width.

| Attribute | Value |
| --- | --- |
| Type | Quality (Usability) |
| Status | Active |
| Verification | Playwright: Page scrollWidth is not more than page clientWidth at each required viewport. |

## REQ-064 — Search focus

**Statement:** WHEN a new search succeeds, keyboard focus shall stay in the search field.

| Attribute | Value |
| --- | --- |
| Type | Quality (Accessibility) |
| Status | Deprecated |
| Verification | Playwright: The search field is the active element after cards appear. |

**Notes:** Deprecated on 2026-08-24. REQ-083 replaces this focus behavior.

## REQ-065 — MORE! focus

**Statement:** WHEN MORE! succeeds and another page exists, keyboard focus shall stay on MORE!.

| Attribute | Value |
| --- | --- |
| Type | Quality (Accessibility) |
| Status | Deprecated |
| Verification | Playwright: MORE! is the active element on an intermediate page. |

**Notes:** Deprecated on 2026-08-24. REQ-083 replaces this focus behavior.

## REQ-066 — Last-page focus

**Statement:** WHEN the last result page loads, keyboard focus shall move to the results heading.

| Attribute | Value |
| --- | --- |
| Type | Quality (Accessibility) |
| Status | Deprecated |
| Verification | Playwright: The results heading is the active element on the last page. |

**Notes:** Deprecated on 2026-08-24. REQ-083 replaces this focus behavior.

## REQ-067 — Result announcement

**Statement:** WHEN a result state loads, the system shall send its localized result count or status to a screen-reader status region.

| Attribute | Value |
| --- | --- |
| Type | Quality (Accessibility) |
| Status | Deprecated |
| Verification | Accessibility check: The status region gets the correct text for result and zero-result states. |

**Notes:** Deprecated on 2026-08-24. REQ-083, REQ-084, and REQ-085 replace this result-state notification behavior.

## REQ-068 — Accessible controls

**Statement:** Each interactive control shall have a localized accessible name, a visible focus indication, and the specified keyboard operation.

| Attribute | Value |
| --- | --- |
| Type | Quality (Accessibility) |
| Status | Active |
| Verification | Accessibility scan and keyboard check: Each control passes all three conditions. |

## REQ-069 — Color contrast

**Statement:** All text and interactive states shall comply with the WCAG 2.1 AA contrast limits.

| Attribute | Value |
| --- | --- |
| Type | Quality (Accessibility) |
| Status | Active |
| Verification | Contrast scan and visual check: Default, hover, focus, disabled, error, and loading states pass. |

## REQ-070 — Deterministic database setup

**Statement:** Database migrations and seed SQL shall make the complete POC catalog in a new PostgreSQL database.

| Attribute | Value |
| --- | --- |
| Type | Constraint |
| Status | Active |
| Verification | Integration test: A new database gets the expected stable IDs and data with no manual data step. |

## REQ-071 — Catalog coverage

**Statement:** The seed shall contain at least 30 Food Objects and at least nine eligible Substitutes for each designated acceptance input.

| Attribute | Value |
| --- | --- |
| Type | Constraint |
| Status | Active |
| Verification | Database test: Record counts and eligible-candidate counts meet both limits. |

## REQ-072 — Test-designed nutrition

**Statement:** Seeded Macro Profiles shall produce the documented similarities, result order, and Matched Quantities.

| Attribute | Value |
| --- | --- |
| Type | Constraint |
| Status | Active |
| Verification | Integration test: Each designated scenario gives its documented scores, IDs, and quantities. |

## REQ-073 — POC compatibility

**Statement:** The POC shall run locally in the latest stable Chromium at viewport widths of 320 px, 768 px, and 1280 px.

| Attribute | Value |
| --- | --- |
| Type | Quality (Compatibility) |
| Status | Active |
| Verification | Smoke check: The primary flow succeeds at all three viewport widths. |

## REQ-074 — Request response time

**Statement:** After warm-up, each search and MORE! request shall end in 500 ms or less with one active request.

| Attribute | Value |
| --- | --- |
| Type | Quality (Performance) |
| Status | Active |
| Verification | Performance check: Each of 20 consecutive requests of each type meets the limit. |

## REQ-075 — First-card response time

**Statement:** The first result card shall become visible in 1 second or less after submission, excluding application and database startup.

| Attribute | Value |
| --- | --- |
| Type | Quality (Performance) |
| Status | Active |
| Verification | Browser performance check: Each of 20 searches meets the limit. |

## REQ-076 — Autocomplete match order

**Statement:** The system shall assign each normalized active-language Food Object name to its first applicable exact-match, full-name-prefix, substring, or fallback tier; sort those tiers in that order; and sort suggestions within each tier by increasing raw Levenshtein distance.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | API integration test: exact, full-name-prefix, substring, and fallback fixtures appear in tier order; within-tier distance and tie fixtures use the specified deterministic order; Polish query `ows` ranks `Owsianka` first. |

## REQ-077 — Selected suggestion in Search

**Statement:** WHEN the user selects a suggestion with Enter, click, or tap, the system shall replace the Search Query text with that suggestion's name in the active Interface Language before it starts the Substitution Search.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: Keyboard and pointer selection replace unfinished Search Query text with the exact returned English or Polish selected name before one Substitution Search starts. |

## REQ-078 — Displayed calories

**Statement:** The browser shall show whole derived calories in kcal for the Substitution Input and every result card.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: The input and each card show the browser-projected whole calories with the localized `Calories` or `Kalorie` label and `kcal`. Browser calculation test: the projected values match the full-precision result after final rounding. |

## REQ-079 — Compact result presentation

**Statement:** WHILE results are visible at a 1920 × 1080 desktop viewport, the system shall show the centered selected-food card, a centered `Found substitutions` or `Znalezione zamienniki` heading, and all first-page cards without vertical scrolling.

| Attribute | Value |
| --- | --- |
| Type | Quality (Usability) |
| Status | Active |
| Verification | Playwright: At 1920 × 1080, after a three-card result search, `scrollHeight` is not more than `clientHeight`; the selected-food card and substitutions heading are centered. |

## REQ-080 — No Search loading spinner

**Statement:** WHILE a new search request is pending, the system shall not show a spinner below the Search control.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: During a controlled pending new-search request, no spinner is present below Search. |

## REQ-081 — Single card loading spinner

**Statement:** WHILE a Substitute Search request is pending, each visible selected-food card and result card shall show exactly one centered spinner in place of its non-image content; a valid local quantity commit starts no request and never leaves card values pending.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: During a controlled pending Substitute Search request each pending card has one centered spinner, its non-image content is hidden, result images remain visible, and card dimensions do not change; a valid quantity commit shows no card spinner. |

## REQ-082 — Pending MORE! control

**Statement:** WHILE a MORE! request is pending, the system shall keep the localized MORE! label visible and present the control as gray and non-operable.

| Attribute | Value |
| --- | --- |
| Type | Behavior |
| Status | Active |
| Verification | Playwright: During a controlled pending MORE! request, the focused control keeps its localized label, has `aria-disabled=true`, uses the specified gray colors, and repeated activation starts no additional request. |

## REQ-083 — Successful result-page focus

**Statement:** WHEN a new Search or MORE! request succeeds and renders one or more result cards, the system shall move keyboard focus to the localized results heading after it renders the result page.

| Attribute | Value |
| --- | --- |
| Type | Quality (Accessibility) |
| Status | Active |
| Verification | Playwright: After a new Search, an intermediate MORE! page, and the last page, the localized results heading is the active element in English and Polish. |

## REQ-084 — Zero-result focus

**Statement:** WHEN a new Search succeeds and renders zero result cards, the system shall move keyboard focus to the localized zero-result message after it renders the zero-result state.

| Attribute | Value |
| --- | --- |
| Type | Quality (Accessibility) |
| Status | Active |
| Verification | Component integration: A successful zero-item response renders zero cards and makes the localized zero-result message the active element in English and Polish. |

## REQ-085 — No successful-result live announcement

**Statement:** WHEN a successful result state loads, the system shall not send a result count or result-status message through a live region.

| Attribute | Value |
| --- | --- |
| Type | Constraint |
| Status | Active |
| Verification | Accessibility check: Successful nonzero and zero-result transitions produce no result count or result-status live-region update while focus moves to the required result target. |

**Notes:** Existing loading, validation, and failure announcements remain unchanged.
