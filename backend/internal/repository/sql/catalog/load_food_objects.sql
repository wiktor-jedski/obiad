-- Persistence SELECT for the private concrete PostgreSQL Catalog Loader
-- (ARCH-006, Phase 3, task 10). The loader executes exactly one fresh
-- parameterized read per operation through pgx from SQL colocated here;
-- statement text is never repeated inline in repository Go files.
--
-- The read returns the complete ARCH-013 Food Object row set: stable ID,
-- localized names, Physical State, Macro Profile, optional Serving, optional
-- Food Family reference, and optional image key, in ascending stable ID
-- order. Values are bound through pgx's parameterized query protocol; the
-- positional placeholder $1 carries the positive-ID lower bound (1) that the
-- ARCH-013 identity invariant requires, and no value is interpolated into
-- this statement. Because every valid Food Object ID is positive, the bound
-- preserves the whole request-local snapshot (ARCH-006); the request
-- language, ranking, and default Food Quantities are applied by the Modules
-- after the read. Ascending-ID order is deterministic snapshot order, not
-- SQL ranking: suggestion ranking belongs to the Suggest Food Objects module
-- and never happens in SQL.

SELECT id, names, physical_state, protein, carbohydrate, fat, serving,
       food_family_id, image_key
FROM food_objects
WHERE id >= $1
ORDER BY id;
