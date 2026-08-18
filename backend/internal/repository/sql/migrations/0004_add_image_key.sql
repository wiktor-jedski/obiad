-- Versioned migration 0004: one optional opaque frontend image key per Food
-- Object (Phase 2, task 5; ARCH-013, ARCH-015).
--
-- No seed rows: the deterministic catalog seed arrives in Phase 2 (ARCH-007);
-- this migration only widens the schema.
--
-- Constraints (REQ-011, ARCH-013, ARCH-015):
--   * image_key   nullable TEXT. NULL is the single "no usable image" state,
--                 so the frontend card shows the bundled placeholder
--                 (REQ-011). When present, the value is an opaque frontend
--                 key: the backend never interprets, normalizes, truncates,
--                 or trims it, and the frontend resolves a known key to its
--                 bundled image and an unknown, absent, or failed key to the
--                 placeholder (ARCH-015). An empty or spaces-only key
--                 (btrim semantics, matching the localized-name constraint)
--                 is rejected, so NULL is the one "absent image"
--                 representation.
--
-- Derived values (calories, Nutritional Similarities, Matched Quantities,
-- page data, rounded display values) are computed at request time and are
-- never stored in production tables; this migration adds no derived column
-- and no derived-value table.

ALTER TABLE food_objects
    ADD COLUMN image_key TEXT
        CHECK (image_key IS NULL OR btrim(image_key) <> '');
