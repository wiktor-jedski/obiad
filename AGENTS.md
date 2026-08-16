# Repository Guidelines

## Project Structure & Module Organization

This repository is currently organized around requirements, architecture, design specs, and helper scripts. Requirements live in `docs/requirements/`, architecture decisions in `docs/architecture/`, and implementation planning in `docs/implementation/`. Utility scripts are in `scripts/`.

When application code is added, follow the documented stack: Svelte frontend code under the `frontend/` package, Go/Fiber backend code under the `backend/` package, and tests colocated with code where the language ecosystem expects them.

Task list: `docs/implementation/task-list.md`
Phase plan: `docs/implementation/plan.md`

## Build, Test, and Development Commands

Planned app commands should use `docs/architecture/tech-stack.md`: Bun for Svelte from `frontend/` (`bun install`, `bun test`, `bun run dev`) and Go tooling from `backend/` (`go test ./...`, `go run ./cmd/...`) once package manifests exist.

Installed development tooling:

- `golang-security` agent skill: use for backend security-sensitive work, especially authentication, authorization, OAuth, cookies, PII handling, and dependency review.

## Coding Style & Naming Conventions

Keep Markdown filenames descriptive and consistent with existing prefixes.

For frontend work, follow `docs/requirements/style.md`: Svelte components in `frontend/src/lib/components/`, Tailwind utilities, Inter for UI text, Roboto Mono for labels/data, and WCAG AA contrast. For backend Go, use `gofmt` and lower-case package names.

For backend, follow the official Go Doc comments guidelines.
Keep backend repository persistence SQL under the colocated `backend/internal/repository/sql/` directory and embed it from Go. Do not place SQL statement strings inline in repository Go files.
For frontend, every hand-written exported type, interface, class, function, and constant needs concise TSDoc that follows the TSDoc comment specification. Generated exports must receive their TSDoc from the source contract and generator; do not document generated output by hand.

## Testing Guidelines

- Future Go tests should use the standard `testing` package and `Test...` names in `*_test.go` files. Future Svelte tests should use Bun, `@testing-library/svelte`, and Playwright. Add tests near changed behavior, especially around search, auth, subscriptions, and data normalization.
- For each phase, during task planning, add relevant integration tests for the newly implemented code AND the code that will work with this phase's code.
- Unit tests are allowed only to check correctness during development. Remove all unit tests before committing changes.

Testing commands for the current package layout:

## Commit & Pull Request Guidelines

Keep messages concise and focused on one change. Pull requests should include a brief summary, changed docs or scripts, validation performed, and linked requirements or architecture IDs. Include screenshots for UI changes once the frontend exists.

## Security & Configuration Tips

Do not commit real secrets. Treat local service credentials, API tokens, food data provider keys as local-only configuration.

Do not commit generated artifacts or local caches.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default canonical triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

Use a single-context domain documentation layout and repository architecture files. See `docs/agents/domain.md`.
