-- Versioned migration 0001: Food Object identity, constrained localized-name
-- JSONB, and Physical State (Phase 1, task 1; ARCH-013).
--
-- No seed rows: the deterministic catalog seed arrives in Phase 2 (ARCH-007).
--
-- Constraints (ADR 0001, REQ-005, REQ-006, glossary):
--   * id            positive opaque integer, the one stable identity shared by
--                   every localized name of the Food Object;
--   * names         JSONB object with nonempty string values for keys "en" and
--                   "pl"; wrong-type, missing, empty, or whitespace-only values
--                   are rejected; additional language keys are permitted;
--   * physical_state exactly "solid" or "liquid"; any other value is rejected.

CREATE TABLE food_objects (
    id             INTEGER PRIMARY KEY CHECK (id > 0),
    names          JSONB NOT NULL CHECK (
                       jsonb_typeof(names) = 'object'
                       AND names -> 'en' IS NOT NULL
                       AND jsonb_typeof(names -> 'en') = 'string'
                       AND btrim(names ->> 'en') <> ''
                       AND names -> 'pl' IS NOT NULL
                       AND jsonb_typeof(names -> 'pl') = 'string'
                       AND btrim(names ->> 'pl') <> ''
                   ),
    physical_state TEXT NOT NULL CHECK (physical_state IN ('solid', 'liquid'))
);
