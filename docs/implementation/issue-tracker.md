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
