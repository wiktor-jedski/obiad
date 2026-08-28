# Repository Guidelines

## Language

Use ASD-STE100.

## Project Structure & Module Organization

Docs:
API: `api/openapi.yaml`
Requirements: `docs/requirements/`
Architecture: `docs/architecture/`
Implementation planning: `docs/implementation/`

Code:
Frontend (Svelte): `frontend/`
Backend (Go): `backend/`
Utility scripts (Python, Bash): `scripts/`
Tests colocated with code where the language ecosystem expects them.

Planning:
Task list: `docs/implementation/task-list.md`
Phase plan: `docs/implementation/plan.md`
Open items: `docs/implementation/issue-tracker.md`

## Build, Test, and Development Commands

Treat diagnostics from backend, frontend and aggregate checks as required fixes.

### Backend commands

Run all Go commands from `backend/`.

Setup:

- `golang-security` agent skill: use for backend security-sensitive work

Backend check:

- `scripts/ci_check.py --backend`

### Frontend commands

Run all Typescript commands from `frontend/`; use Bun.
Frontend scripts are defined in `fronted/package.json`.

Setup:

- `svelte-best-practices` agent skill, use in the beginning of coding/testing frontend tasks
- `bun install --frozen-lockfile` installs locked dependencies.

Frontend check:

- `scripts/ci_check.py --frontend`

### Script commands

Setup:

- `scripts/start.py` runs the app using demo database

Doc checks:

- `scripts/validate_phase_plan.py` phase planning validation

Aggregate checks:

- `scripts/ci_check.py` runs CI check (both frontend and backend)

## Coding Style & Naming Conventions

Keep Markdown filenames descriptive and consistent with existing prefixes.
Keep comments precise and short; 1-2 lines max.
Do not document generated output by hand.

Each smell reads _what it is_ → _how to fix_; match it against the diff:

- **Mysterious Name** — a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code** — the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy** — a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps** — the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- **Primitive Obsession** — a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- **Repeated Switches** — the same `switch`/`if`-cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery** — one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- **Divergent Change** — one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality** — abstraction, parameters, or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- **Message Chains** — long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- **Middle Man** — a class or function that mostly just delegates onward. → cut it, call the real target direct.
- **Refused Bequest** — a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.

### Frontend coding

Follow `docs/requirements/style.md`: Svelte components in `frontend/src/lib/components/`, Tailwind utilities, Inter for UI text, Roboto Mono for labels/data, and WCAG AA contrast.
Every exported type, interface, class, function and constant needs concise TSDoc
Follow TSDoc comment specification.

### Backend coding

Follow the official Go Doc comments guidelines.
Keep backend repository persistence SQL under the colocated `backend/internal/repository/sql/` directory and embed it from Go. Do not place SQL statement strings inline in repository Go files.

Use following file format:

- package name
- imports
- types
- constants
- functions

## Testing Guidelines

- For each phase, during task planning, add relevant integration tests for the newly implemented code AND the code that will work with this phase's code.
- Unit tests are allowed only to check correctness during development. Remove all unit tests before committing changes.
- Tautological tests considered harmful.

## Commit & Pull Request Guidelines

Keep messages concise and focused on one change.

## Security & Configuration Tips

Do not commit real secrets. Treat local service credentials, API tokens, food data provider keys as local-only configuration.

Do not commit generated artifacts or local caches.

## Agent skills

### Issue tracker

Issues and PRDs are tracked as local Markdown entries in `docs/implementation/issue-tracker.md`; its conventions are documented in that file.

### Triage labels

Use the default canonical triage labels. See `docs/implementation/triage-labels.md`.

### Domain docs

Use a single-context domain documentation layout and repository architecture files. See `docs/implementation/domain.md`.
