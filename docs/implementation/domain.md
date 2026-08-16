# Domain Docs

How engineering skills should consume this repository’s domain documentation when exploring the codebase.

## Before exploring, read these

- `CONTEXT.md` at the repository root.
- Relevant architecture decisions under `docs/architecture/`.

If either location does not exist, proceed silently. Do not suggest creating domain documentation upfront; create it lazily when terminology or architectural decisions are resolved.

## File structure

This is a single-context repository:

```
/
├── CONTEXT.md
└── docs/
    └── architecture/
```

## Use the glossary’s vocabulary

When output names a domain concept—in an issue title, refactor proposal, hypothesis, or test name—use the term defined in `CONTEXT.md`. Do not drift to synonyms the glossary explicitly avoids.

If a needed concept is absent, reconsider whether the term belongs to the project. If it exposes a real vocabulary gap, note it for domain modeling.

## Flag architecture conflicts

If output contradicts an existing decision under `docs/architecture/`, surface the conflict explicitly rather than silently overriding it.
