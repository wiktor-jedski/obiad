-- Persistence SELECT for the private concrete PostgreSQL Catalog Loader
-- (ARCH-006, Phase 3, task 10). The loader executes exactly one fresh
-- parameterized read per operation through pgx from SQL colocated here;
-- statement text is never repeated inline in repository Go files.
--
-- The read returns the complete ARCH-013 Food Object row set: stable ID,
-- localized names, Physical State, Macro Profile, optional Serving, optional
-- Food Family reference, and optional image key, in ascending stable ID
-- This statement has no dynamic values. If a catalog query later has dynamic
-- values, the loader must bind them through pgx parameters and must not
-- interpolate them into the statement.
-- The request language, ranking, and default Food Quantities are applied by
-- the Modules after the read. Ascending-ID order is deterministic snapshot
-- order, not SQL ranking: suggestion ranking belongs to the Suggest Food
-- Objects module and never happens in SQL.

SELECT id, names, physical_state, protein, carbohydrate, fat, serving,
       food_family_id, image_key
FROM food_objects
ORDER BY id;
