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
