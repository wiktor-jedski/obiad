-- Versioned migration 0003: positive-ID Food Family and one nullable Food
-- Family foreign key on each Food Object (Phase 1, task 3; ARCH-013).
--
-- No seed rows: the deterministic catalog seed arrives in Phase 2 (ARCH-007).
--
-- Constraints (REQ-009, glossary Food Family contract):
--   * food_families.id   positive opaque integer, the one Food Family
--                        identity; zero and negative values are rejected;
--   * food_objects.food_family_id
--                        nullable foreign key to food_families(id). NULL is
--                        the "no Family" state, so a Food Object row
--                        represents zero or one flat membership directly, a
--                        second membership is not representable, and the
--                        table has no hierarchy column (no parent, level, or
--                        path) and no second membership representation (no
--                        junction table).

CREATE TABLE food_families (
    id INTEGER PRIMARY KEY CHECK (id > 0)
);

ALTER TABLE food_objects
    ADD COLUMN food_family_id INTEGER REFERENCES food_families(id);
