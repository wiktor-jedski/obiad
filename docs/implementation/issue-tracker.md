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

## ISSUE-023: Adopt the meal-dialogue landing page

Type: Improvement
Status: ready-for-human
Resolution: Implemented; ready for final review.

### Decision

Use the approved variant D at `/` in development and production. Remove the
variant selector and candidates A–C. Keep the `obiad` wordmark visible after
a search is committed.

The landing dialogue shows at most two lines above Search. Meal cards are
centered. Circular meme avatars have equal sizes and light-green borders.
English and Polish use the same meal pair; `ME GUSTA` is not translated.
Food images use the existing default image when no supported image is available.

The landing dialogue requests one random ID from
`GET /api/v1/food-objects/random`, then passes that ID to Substitution Search.
PostgreSQL selects from the full catalog; no keyword list or full catalog is
sent to the browser. Repeated selections are permitted.
The selected food response includes its optional image key. The default quantity
is one serving when a serving is defined, otherwise 100 g or 100 ml.

### Comments

The user selected D after iteration on copy, avatars, localization, and spacing.
The prototype source is preserved on branch `prototype/landing-candidates`,
commit `8ca4b723b43d2eb4ac13dc1a3c054fea47a47f85`.

The wordmark links to `/`. It returns from search results to the empty landing page.

E2E coverage distinguishes the two automatic landing requests from user Search
requests by the `X-Obiad-Request-Purpose: landing-dialogue` header. Both use the
real API. Search request counts and response gates do not include the example.
Landing coverage checks the five-step sequence, localized food names, image
fallback, centered cards, fixed Search position, and return through the wordmark.

Before random-ID selection: frontend checks passed. The full E2E run passed all
126 cases, including motion and database-outage cases. The separate Search
performance check also passed.

Random-ID selection verification: frontend checks, backend checks with the
declared Go 1.26.6 toolchain, and all 126 E2E cases passed. Landing coverage checks
the random-ID request, the following substitution request, localized cards,
default quantities, and the original food image fallback.

Bubble-tail styles use Tailwind `@apply` rules in `frontend/src/app.css`.
`LandingDialogue.svelte` has no component-local stylesheet.

## ISSUE-024: Choose the results-view design

Type: Improvement
Status: ready-for-human
Resolution: Approved G implemented on `results-view-g`; frontend checks and local smoke checks passed. Full browser integration is delegated to CI.

### Original question (historical)

Which layout and macro font should the results view use after a food search?
Use the same card style for the selected food and substitutes. Put square images
on the left on desktop and above the details on mobile. Replace MORE! with a
centered loading spinner and append results when the user reaches the bottom.

### Prototype (historical)

Primary source branch: `prototype/results-candidates`.
Preserved final prototype commit: `cbba139329`. The descriptions and checks below
record prototype iterations, not the current production route or final verification.
The prototype is under `frontend/src/lib/components/results-prototype/`.
The existing `/` route uses it only in development with `?variant=A`, `B`, or `C`.
The floating bar and left/right arrow keys change the variant. Arrow keys in
editors keep their normal function. The bar shows the current search state,
result count, page, quantity, and language.

- A: two-column gallery with Lato nutrition values.
- B: selected-food sidebar and ranked list with Barlow Semi Condensed.
- C: full-width editorial cards with Source Serif 4.

Run `python scripts/start.py --catalog data/catalogs/catalog.json`, then open
`http://127.0.0.1:5173/?variant=A` and select a food from Search.
The launcher uses a disposable database. Prototype pages stay in memory.
The font samples load from Google Fonts and require network access.

### Comments

The user selected C as the base. Keep production rendering unchanged while the
revised prototype is reviewed. Retain this branch as the primary source.
The prototype is not a production implementation.

Verification: Svelte type checks passed with no errors or warnings. Browser
checks covered all three variants on desktop and mobile, including 320 px width,
square images, font loading, URL and keyboard switching, and editor arrow keys.
A delayed real API request showed the centered spinner, fetched one page, and
appended three results without removing earlier cards. A quantity change updated
the selected card and all nine loaded substitutes.

The revised C uses 28 px card corners on desktop and mobile. Centered section
headers separate the selected food from its substitutes: `Wybrany produkt` and
`Zamienniki` in Polish, `Selected food` and `Substitutes` in English. Remove the
introductory text and per-card role labels. Keep food names and similarity values.
Put quantity, unit, and calories on one row, such as `100 g | 173 kcal`, with
Source Serif 4 at the same size and weight. Selected-food quantity stays editable.

Revision verification: Svelte type checks passed with no errors or warnings.
Browser checks covered desktop and 390 px and 320 px mobile widths. All cards had
rounded corners and single-line, 16 px, regular-weight quantity and calorie rows.
Polish section headings were centered. Serving edits updated the calorie value.

The next C revision moves similarity to the right end of the quantity and calorie
row. Show only the percentage, such as `100%`; keep the localized similarity
label for assistive technology. All row values use the same font, color, regular
weight, and larger 18 px size. The selected-food editor uses this size too.
Type checks passed. Desktop and 320 px browser checks confirmed one-line rows,
matching number styles, right-aligned percentages, and no page overflow.

After the design interview, the user approved text-like editors in variant C.
Only the selected food exposes editors for quantity, kcal, protein, carbohydrate,
and fat. A target changes the portion, not the food profile. Substitutes remain
equal-calorie matches with unchanged ranking and similarity percentages.

The prototype stores the unrounded base quantity locally and reuses the existing
nutrition projection. Display and manual-entry precision are whole g/ml, whole
kcal, up to one decimal for macros, and up to two decimals for `ea`. Omit trailing
zeros. True zero-profile nutrients and zero-calorie values are read-only; small
positive values can display as rounded zero and remain editable.

The unit control is a horizontal toggle with both labels visible: g/ml on the left
and `ea` on the right. A mint circle moves behind the selected label. Foods without
a serving definition show only their fixed unit. Switching preserves the amount.
Focusing and leaving an unchanged value also preserves the unrounded amount.
Numeric editors use a continuous text underline directly below the value. Hover
changes text and underline to sage; focus makes the value bold and mint-colored.
The numeric editors have no input boxes.

Enter or blur applies a valid edit; Escape cancels. Invalid Enter retains focus
and shows an error. Invalid blur restores the last value and shows an error below
the selected card. Accept decimal dots or commas. Reject zero, negatives, excess
precision, invalid notation, and portions above the advertised quantity limits.
Quantity entries use the current unit's limit; calorie and macro targets use the
base-unit limit. Unit switching preserves the amount, without applying a new cap.
Do not clamp targets. Editing stays available during pagination; arriving cards
use the latest committed portion.

No backend or production behavior changed. Svelte type checks passed. Disposable
browser scenarios covered all five editors, conversion, unchanged-focus precision,
Enter/blur/Escape behavior, invalid values, both languages, and editing while a
real next-page request was delayed. Desktop, 390 px, and 320 px checks confirmed
Source Serif 4 at 18 px, text-like editors, and no page overflow. The preview
catalog has no zero-profile or liquid entries; simulated API profiles verified
zero-nutrient and zero-calorie read-only behavior, and whole-ml validation.

Underline refinement: browser checks confirmed solid text underlines with a 2 px
offset and no bottom border, text and underline hover colors, and bold focus.
The 320 px layout had no page overflow.

Desktop-only C refinement: at 1024 px and wider, the details fill the card height.
Food names use 30 px text near the top. The quantity, calorie, and similarity row
uses 24 px text. Automatic space above the macro group places its divider and
values near the bottom, with the existing 28 px padding. Macro values stay 18 px.
The selected-food and substitute cards use the same desktop layout rules.

Browser verification compared selected-food and substitute geometry at 320 px,
390 px, and 768 px after font loading; these layouts were unchanged. The revised
desktop layout was also checked visually at 1440 px.

The circular unit toggle supports pointer selection, Left/Right arrows, Home, and
End. Its arrow keys do not change the prototype variant. Type checks passed.
Browser checks covered the active circle, visible unit labels, preserved calories,
English and Polish, and desktop and 320 px layouts without page overflow.
A real single-unit food had no toggle; a simulated liquid profile verified ml/ea.

Unit-placement comparison: can the control stay fixed when `1 ea` becomes `702 g`?
The active comparison bar now contains C–F. C keeps its original placement.
D reserves a fixed-width, right-aligned quantity slot. E puts the toggle before
the quantity. F puts it beside the food name and shows the current unit in the
quantity row. All four use C's cards, fonts, editors, and equal-calorie projection.
Hovering the track, either label, or the circle highlights the whole toggle.
Earlier A/B designs remain available through their direct URLs.

Svelte type checks passed with no errors or warnings. Browser checks and visual
inspection covered all four designs at 1440 px and 320 px. D/E/F had no horizontal
toggle movement after unit changes, quantity focus, or quantity edits. Checks also
covered whole-control hover, equal-calorie substitutes after a protein edit,
single-unit foods, keyboard and bar navigation, preserved state, and no row or
page overflow. The placement choice remains open. This comparison is captured on
`prototype/results-candidates`; no production or backend behavior changed.

The user chose F's unit placement beside the food name. Its control is now one
toggle button: clicking either label, the selected circle, or the pill padding
switches units. Hover changes only the label text colors, not the track, circle,
or border. Pointer activation retains focus without a visible focus indicator.
Keyboard focus has a visible outline; Space and Enter switch units without
removing focus. The button exposes serving mode through `aria-pressed`.
C–E retain their earlier controls for comparison.

Svelte type checks passed with no errors or warnings. Desktop mouse checks
(1440 px) and emulated mobile touch checks (320 px) covered six activation points,
unchanged calories, text-only hover, pointer focus without an outline, keyboard
focus with an outline, and Tab/Space/Enter. Visual checks covered desktop hover,
keyboard focus, and the settled mobile toggle. This revision remains on
`prototype/results-candidates`; production behavior is unchanged.

Numeric spacing correction: character-count sizing treated a decimal separator as
a full digit, leaving excess space before the unit. All editable numbers now use
an invisible text copy with the same font and focus weight to set their width.
The small existing gap is preserved for whole numbers and decimals. D keeps its
fixed-width, right-aligned quantity slot.

Type checks passed. Browser checks at 1440 px and 320 px confirmed equal unit gaps
for `2`, `2.5`, and `2.55`, including Polish decimal commas. All five editors were
checked while focused and after commit, plus empty drafts, Escape, D's fixed
position, and page overflow. Desktop and mobile visual checks passed.

The next comparison keeps F's layout and editors and varies the reveal:
F reveals without motion after readiness; G flips around the horizontal axis;
H opens two shutters; I slides the card upward from behind its reverse.
The active switcher contains F–I. Earlier variants remain available by URL.
The motion choice is still open; these remain throwaway prototypes.

Cards start covered and wait for their actual image element to decode. Cached
images also get a painted reverse before motion starts. A failed image uses the
decoded bundled placeholder; if that also fails, the card shows an explicit
image-unavailable state instead of the browser's broken-image display. Hidden
editors cannot receive focus. Reduced-motion mode reveals ready cards directly.
Quantity edits do not replay the animation.

Pagination fetches immediately but holds the centered spinner for at least one
second after it paints. Fast responses stay buffered until that interval ends;
slow requests keep the spinner until the response arrives. Earlier cards remain
in place. A failed request exposes retry after the same minimum interval.
New searches cancel the old presentation timer and discard stale image callbacks.

Type checks passed with no errors or warnings. Browser checks at 1440 px and
320 px covered all four variants, cached consecutive searches, separately delayed
image requests and decoding, retained editors, variant switching, and motion
without horizontal overflow. Visual checks covered card reverses and each motion.
The fast pagination check measured 1034 ms before both spinner removal and page
append. Slow responses, simulated request failure and retry, image/fallback
failure, reduced motion, and search changes during pending work also passed.
Captured on `prototype/results-candidates`; no backend or production change.

The user prefers G and requested a responsive flip direction. Below 640 px,
cards now rotate around the vertical (Y) axis. At 640 px and wider, they keep
the horizontal (X) axis. This breakpoint matches the card's stacked/mobile layout.
The front and reverse use the same axis; timing and image readiness are unchanged.

Type checks passed. Browser checks at 320, 639, 640, and 1440 px confirmed the
reverse orientation and motion axis, usable editors, no horizontal overflow,
and visible cards after resizing. Desktop and mobile motion were checked visually.
Reduced-motion checks at 320 and 1440 px confirmed no flip animation.
Captured on `prototype/results-candidates`; the responsive direction remains
a prototype for user evaluation.

### Approved production cutover

The user approved complete G for normal `/` in development and production.
The production branch is `results-view-g`. The prototype remains preserved on
`prototype/results-candidates` at `cbba139329`; prototype candidates, URL modes,
and switchers are removed from production source.

Selected food and substitutes share the centered 920 px vertical card list,
28 px corners, responsive image placement, centered localized headings, and
locally bundled Source Serif 4 nutrition typography. Inter headings remain.
Only selected-food values are editable. One unrounded canonical base portion
drives quantity, kcal, and all three macro editors and every accumulated page.
Reject invalid or over-limit entries; do not clamp. Unit changes preserve amount,
including amounts above a rounded Serving limit. The whole header pill switches
units; pointer and keyboard focus follow the approved F control behavior.

Append pages through IntersectionObserver. Retain older cards and allow local
edits while a page is pending or failed. Retry is explicit, never automatic.
The pagination spinner stays for at least one second after paint and until the
request settles. It is the only results spinner: reverse cards show reverse art
and localized loading text, with no in-card visual spinner.

The 800 ms G flip waits for actual image decode, including cached images.
Use the X axis at 640 px and wider and the Y axis below. Decode the bundled
placeholder on failure; if it also fails, show localized image-unavailable text.
Keep hidden fronts inert. Reduced motion reveals after readiness without movement.
Local edits do not replay the reveal. No fade remains.

A new successful search focuses the selected-food heading; zero results focus
the zero-result message. Pagination and failures do not move focus or scroll to
a heading. Search resets accumulated pages and the local portion.

ResultsView owns canonical portion, editor drafts, and accumulated raw pages.
The query observer and shared request lock remain. Obsolete global quantity
draft/clamp APIs, quantity helper, and fade Module are removed. The HTTP contract
remains `foodObjectId` and `pageIndex`; landing example requests remain separate.

Current contracts: REQ-092–REQ-102 and ARCH-023–ARCH-024. Superseded requirements
and prototype checks above remain historical evidence.

Cutover verification: `scripts/ci_check.py --frontend` passed. Component integration
checks found one request-count fixture that included the landing example; the
fixture now preserves request headers and separates that request from Search.
The affected integration file passed after the fix; all other cases had passed.

Browser smoke checks at normal `/` covered 1440 px and 320 px, decoded selected
images, bundled typography, quantity and macro edits, portion-preserving unit
switches, equal-calorie substitutes, removal of the prototype UI, and incremental
paging. The pagination spinner stayed for 1036 ms before append. Narrow-screen
macro labels fit in English and Polish. No visual spinner remains inside cards.
The user requested pushing the branch and using automated CI for the full browser
integration suite; that suite was not run locally for this cutover.

### Performance-check correction

The G cutover removed the first-card latency assertion and changed the test name
without updating the dedicated runner's `Search performance` filter. This was not
an approved removal of performance coverage.

The user reconfirmed the one-second first-card target. REQ-075 is active again.
Measure search confirmation to the first substitute card's completed reveal,
including image decode and the 800 ms flip, with normal motion after warm-up.
The performance test again matches the dedicated runner and logs each first-card,
search HTTP, and next-page HTTP sample. All 20 samples of each kind must meet their
limits: 1000 ms for first-card reveal and 500 ms for each HTTP request.

The first restored performance run completed all 20 searches and 20 next-page
requests. Four first-card samples exceeded the target (1090.5–1183.4 ms); all HTTP
samples were below 49 ms. Readiness and maximum-frame-gap logs were added to
separate image preparation from rendering delays. Neither limit nor the approved
800 ms flip was changed.

The instrumented `bun run test:performance` run passed: all 20 first-card samples
were 858.3–882.4 ms, and all 40 HTTP samples were at most 16.5 ms. Card readiness
was 55.1–76.2 ms; maximum frame gaps were at most 32.4 ms. Frontend validation
also passed after corrections to the test's motion configuration and state type.
The earlier overruns did not occur in this run; their cause remains unconfirmed.
No production timing was changed, and the strict gate retains those failures as
failures rather than retrying them or averaging samples.

### CI E2E correction

CI run 44088814703 failed in the browser and performance jobs. The user authorized
local E2E diagnosis when authenticated GitHub logs were unavailable.

The local run found missing motion and accessibility-outage suite names, checks
against unrevealed card fronts, loading-heading assumptions, geometry sampled
during the flip, and font-subset downloads counted as application requests.
Action request ledgers now distinguish browser font loads from application work;
the checks still reject unexpected search requests and automatic retries.

The numeric editor also had a production defect: focus on the next field cleared
the previous field's blur-validation message. Focus no longer clears that error.
The E2E cases cover retained messages across untouched fields.

Playwright now emits GitHub annotations in CI in addition to the console report.
The separate local performance run passed all 20 first-card samples at
851.2–893.3 ms and all 40 HTTP samples at no more than 15.2 ms. This does not
explain the remote performance failure; no budget or animation was changed.

Final verification: `scripts/ci_check.py --frontend` passed with no type errors
or warnings. `CI=1 bun run test:e2e` passed all 80 cases: 71 normal-flow cases,
6 motion cases, and one case in each of the three isolated outage suites.
The outage-layout case retains all six language/viewport combinations; its
120-second orchestration budget includes twelve page setups, required motion
and spinner intervals, and infrastructure waits. Individual response and
performance limits are unchanged.

The next GitHub log archive showed one remaining E2E failure:
`suggestion-keyboard.spec.ts` measured the selected card during its flip.
The suggestion panel ended at 361 px, while the moving card started at
363.45 px. The overlay check now waits for all four cards to finish their
reveal before it measures layout. It also checks that opening suggestions
does not move or resize the selected card. Existing overlap limits remain.
The same CI archive showed that motion, outage, and performance checks passed;
all 20 first-card performance samples were 843.2–896.4 ms against the unchanged
1000 ms limit.

Verification: frontend checks passed with no type errors or warnings.
The affected keyboard-overlay scenario passed against a production build and
the dummy database with `CI=1`, including the unchanged overlap assertion.

## ISSUE-025: Choose where to show data sources

Type: Improvement
Status: ready-for-human
Resolution: Variant F approved for the production interface.

People must be able to find the source information without loading every result. Compare the placements on the landing page and in search results, on both desktop and mobile.

### Decision

Adopt F from `prototype/source-placement` at `67f5d477ef`. A wordmark menu keeps Sources reachable from the landing page or any results page without scrolling through results. A dedicated URL leaves room for separate food and recipe lists and lets people link to them directly. This supersedes the direct wordmark-to-home link in ISSUE-023: choose Search in the wordmark menu to return to `/`.

Use the matching language disclosure on both pages. Ship neither the prototype switcher nor a sources footer. The lists are available without release data; only a production release adds its full data commit linked to `/release.json`. Do not publish the aggregate catalog.

### Comments (prototype history)

Prototype: branch `prototype/source-placement`, commit `58e2ebb49e`. From `frontend/`, run `bun run prototype:sources`. Open `/?variant=A` and use the arrow buttons to compare A–E. The preview uses the demo catalog.

Variant F (`ea36ebe2e0` on the same branch): open `/?variant=F`. The wordmark opens a menu instead of linking home. Search links to `/`. Sources links to `/sources`, which describes the food and recipe sources in English and Polish.
