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
Resolution: Prototype ready; design choice pending.

### Question

Which layout and macro font should the results view use after a food search?
Use the same card style for the selected food and substitutes. Put square images
on the left on desktop and above the details on mobile. Replace MORE! with a
centered loading spinner and append results when the user reaches the bottom.

### Prototype

Primary source branch: `prototype/results-candidates`.
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

No variant is approved. Keep production rendering unchanged. After selection,
implement the approved design in production and retain this branch as the source.
The prototype is not a production implementation.

Verification: Svelte type checks passed with no errors or warnings. Browser
checks covered all three variants on desktop and mobile, including 320 px width,
square images, font loading, URL and keyboard switching, and editor arrow keys.
A delayed real API request showed the centered spinner, fetched one page, and
appended three results without removing earlier cards. A quantity change updated
the selected card and all nine loaded substitutes.
