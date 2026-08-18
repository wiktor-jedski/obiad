-- Persistence SELECT for the private concrete PostgreSQL Catalog Loader
-- (ARCH-006, Phase 3, task 10). The loader executes exactly one fresh
-- parameterized read per operation through pgx from SQL colocated here;
-- statement text is never repeated inline in repository Go files.
--
-- The read returns the complete ARCH-013 Food Object row set: stable ID,
-- localized names, Physical State, Macro Profile, optional Serving, optional
-- Food Family reference, and optional image key, in ascending stable ID
-- order. All values are bound through pgx's parameterized query protocol;
-- no value is interpolated into this statement. Ascending-ID order is
-- deterministic snapshot order, not SQL ranking: suggestion ranking belongs
-- to the Suggest Food Objects module and never happens in SQL.
--
-- The statement carries no WHERE clause because the loader reads the whole
-- request-local snapshot in one operation (ARCH-006); the request language,
-- ranking, and default Food Quantities are applied by the Modules after the
-- read.

SELECT id, names, physical_state, protein, carbohydrate, fat, serving,
       food_family_id, image_key
FROM food_objects
ORDER BY id;
