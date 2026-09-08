-- Remove the historical catalog before the first external load.
DELETE FROM food_objects;
DELETE FROM food_families;

ALTER TABLE food_objects
    DROP CONSTRAINT food_objects_physical_state_check;
ALTER TABLE food_objects RENAME COLUMN physical_state TO nutrition_basis;
ALTER TABLE food_objects
    ADD CONSTRAINT food_objects_nutrition_basis_check
        CHECK (nutrition_basis IN ('g', 'ml')),
    ADD COLUMN serving_unit TEXT GENERATED ALWAYS AS
        (CASE WHEN serving IS NOT NULL THEN nutrition_basis END) STORED,
    ADD COLUMN source TEXT CHECK (
        source IS NULL OR (
            source ~ '^[A-Za-z][A-Za-z0-9+.-]*:([A-Za-z0-9._~!$&''()*+,;=:@/?#-]|%[0-9A-Fa-f]{2}|\[[0-9A-Fa-f:.]+\])+$'
            AND source !~ '#.*#'
            AND (source !~* '^https?:' OR source ~* '^https?://([A-Za-z0-9._~!$&''()*+,;=:%-]+@)?([A-Za-z0-9._~!$&''()*+,;=%-]+|\[[0-9A-Fa-f:.]+\])(:[0-9]*)?([/?#]|$)')
        )
    );

ALTER TABLE food_families
    ADD COLUMN names JSONB NOT NULL CHECK (
        jsonb_typeof(names) = 'object'
        AND names ? 'en' AND names ? 'pl'
        AND jsonb_typeof(names -> 'en') = 'string'
        AND jsonb_typeof(names -> 'pl') = 'string'
        AND length(btrim(names ->> 'en')) > 0
        AND length(btrim(names ->> 'pl')) > 0
        AND NOT jsonb_path_exists(names, '$.* ? (@.type() != "string" || @ == "")')
    );
