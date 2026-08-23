-- Versioned migration 0002: finite nonnegative Macro Profile and one optional
-- positive finite Serving base quantity (Phase 1, task 2; ARCH-013).
--
-- No seed rows: the deterministic catalog seed arrives in Phase 2 (ARCH-007).
--
-- Constraints (REQ-008, REQ-010, glossary):
--   * protein, carbohydrate, fat
--         NOT NULL DOUBLE PRECISION; each value is finite and nonnegative, and
--         at least one of the three is positive (the "not all zero" Macro
--         Profile rule). PostgreSQL orders NaN above Infinity, so the strict
--         upper bound 'Infinity' rejects both NaN and +Infinity, while the
--         lower bound rejects -Infinity and negative values;
--   * serving       nullable DOUBLE PRECISION; when present, strictly positive
--         and finite. NULL is the "no Serving" state, so a Food Object row
--         represents zero or one Serving directly and a second Serving is not
--         representable (the one-optional-Serving rule).
--
-- Application-side invariant (ARCH-013, ISSUE-010): the Catalog Loader
-- additionally rejects a stored Serving whose whole-number allowed maximum
-- (the floor of 100000 divided by the stored Serving base quantity) is zero
-- or outside the generated int32 display range, so every validated row can
-- expose a positive int32-representable allowed quantity maximum.

ALTER TABLE food_objects
    ADD COLUMN protein DOUBLE PRECISION NOT NULL
        CHECK (protein >= 0 AND protein < 'Infinity'::float8),
    ADD COLUMN carbohydrate DOUBLE PRECISION NOT NULL
        CHECK (carbohydrate >= 0 AND carbohydrate < 'Infinity'::float8),
    ADD COLUMN fat DOUBLE PRECISION NOT NULL
        CHECK (fat >= 0 AND fat < 'Infinity'::float8),
    ADD COLUMN serving DOUBLE PRECISION
        CHECK (serving IS NULL OR (serving > 0 AND serving < 'Infinity'::float8));

ALTER TABLE food_objects
    ADD CONSTRAINT food_objects_macro_profile_not_all_zero
        CHECK (protein > 0 OR carbohydrate > 0 OR fat > 0);
