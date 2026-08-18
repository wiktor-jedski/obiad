# Repository Guidelines

## Project Structure & Module Organization

This repository is currently organized around requirements, architecture, design specs, and helper scripts. Requirements live in `docs/requirements/`, architecture decisions in `docs/architecture/`, and implementation planning in `docs/implementation/`. Utility scripts are in `scripts/`.

When application code is added, follow the documented stack: Svelte frontend code under the `frontend/` package, Go/Fiber backend code under the `backend/` package, and tests colocated with code where the language ecosystem expects them.

Task list: `docs/implementation/task-list.md`
Phase plan: `docs/implementation/plan.md`
Open items: `docs/implementation/issue-tracker.md`

## Build, Test, and Development Commands

Backend commands run from `backend/`: `go test ./...` runs the complete Go suite, and `go run ./cmd/dbsetup` applies embedded migrations using `OBIAD_SCHEMA_OWNER_DATABASE_URL`. The `frontend/` package does not exist yet; once added, use Bun (`bun install`, `bun test`, `bun run dev`) per `docs/architecture/tech-stack.md`.

Installed development tooling:

- `golang-security` agent skill: use for backend security-sensitive work, especially authentication, authorization, OAuth, cookies, PII handling, and dependency review.

## Coding Style & Naming Conventions

Keep Markdown filenames descriptive and consistent with existing prefixes.

For frontend work, follow `docs/requirements/style.md`: Svelte components in `frontend/src/lib/components/`, Tailwind utilities, Inter for UI text, Roboto Mono for labels/data, and WCAG AA contrast. For backend Go, use `gofmt` and lower-case package names.

For backend, follow the official Go Doc comments guidelines.
Keep backend repository persistence SQL under the colocated `backend/internal/repository/sql/` directory and embed it from Go. Do not place SQL statement strings inline in repository Go files.
For frontend, every hand-written exported type, interface, class, function, and constant needs concise TSDoc that follows the TSDoc comment specification. Generated exports must receive their TSDoc from the source contract and generator; do not document generated output by hand.

## Testing Guidelines

- Go tests use the standard `testing` package and `Test...` names in `*_test.go` files. PostgreSQL integration tests are colocated in `backend/internal/dbsetup/dbsetup_integration_test.go`. Future Svelte tests should use Bun, `@testing-library/svelte`, and Playwright. Add tests near changed behavior, especially around search, auth, subscriptions, and data normalization.
- For each phase, during task planning, add relevant integration tests for the newly implemented code AND the code that will work with this phase's code.
- Unit tests are allowed only to check correctness during development. Remove all unit tests before committing changes.

Current test commands:

- Complete CI check: run `python3 scripts/ci_check.py` from the repository root. It validates phase planning, starts an isolated disposable PostgreSQL container, runs the complete backend test suite, and removes the container.
- PostgreSQL for integration tests: in a separate terminal, run `docker run --rm --name obiad-test-postgres -e POSTGRES_PASSWORD=obiad_test -p 127.0.0.1:5432:5432 postgres:17-alpine` and wait until it reports that it is ready to accept connections.
- Backend suite: run `OBIAD_TEST_ADMIN_DATABASE_URL='postgres://postgres:obiad_test@localhost:5432/postgres?sslmode=disable' go test ./...` from `backend/`.
- PostgreSQL integration suite with individual pass/skip output: run `OBIAD_TEST_ADMIN_DATABASE_URL='postgres://postgres:obiad_test@localhost:5432/postgres?sslmode=disable' go test -v ./internal/dbsetup` from `backend/`.
- Phase-planning validation: run `python3 scripts/validate_phase_plan.py` from the repository root.

The PostgreSQL integration suite requires an admin connection that can create and drop disposable databases and roles. The Docker command provides a loopback-only disposable test server; stop it with `Ctrl-C`, and `--rm` removes the container. To use another server, set `OBIAD_TEST_ADMIN_DATABASE_URL`; alternatively, configure `PGHOST`, `PGPORT`, `PGUSER`, and `PGDATABASE`, with the password supplied by `PGPASSWORD` or `~/.pgpass`. The tests skip when they cannot establish the admin connection, so use the verbose command to confirm they ran rather than skipped.

## Commit & Pull Request Guidelines

Keep messages concise and focused on one change. Pull requests should include a brief summary, changed docs or scripts, validation performed, and linked requirements or architecture IDs. Include screenshots for UI changes once the frontend exists.

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
