# Obiad Implementation Task List

Add tasks for one phase before work on that phase starts. Keep completed tasks from earlier phases. Use the phase goal, scope, requirements, and gate from [the implementation plan](plan.md). Do not add tasks for a later phase.

Use one action in each task. Split a task if the task changes different architecture Modules.

## [Phase 1 — Food Catalog schema](plan.md#phase-1--food-catalog-schema)

- [ ] Create `backend/go.mod` and `backend/cmd/dbsetup` with the minimum setup command.
- [ ] Add versioned schema SQL under `backend/internal/repository/sql/`.
- [ ] Add real PostgreSQL integration checks for REQ-005, REQ-006, and REQ-008 through REQ-010.
- [ ] Apply the schema to an empty disposable PostgreSQL database.
- [ ] Run `go test ./...` from `backend/`.
- [ ] Review the Phase 1 diff and record REQ-005, REQ-006, and REQ-008 through REQ-010 as verified.
