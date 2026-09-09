-- Create the external-catalog schema without catalog rows (ARCH-013).
-- Databases with the old migration history must be reset before setup.
CREATE TABLE food_families (
    id INTEGER PRIMARY KEY CHECK (id > 0),
    names JSONB NOT NULL CHECK (
        jsonb_typeof(names) = 'object'
        AND names ? 'en' AND names ? 'pl'
        AND jsonb_typeof(names -> 'en') = 'string'
        AND jsonb_typeof(names -> 'pl') = 'string'
        AND length(btrim(names ->> 'en')) > 0
        AND length(btrim(names ->> 'pl')) > 0
        AND NOT jsonb_path_exists(names, '$.* ? (@.type() != "string" || @ == "")')
    )
);

CREATE TABLE food_objects (
    id INTEGER PRIMARY KEY CHECK (id > 0),
    names JSONB NOT NULL CHECK (
        jsonb_typeof(names) = 'object'
        AND names -> 'en' IS NOT NULL
        AND jsonb_typeof(names -> 'en') = 'string'
        AND btrim(names ->> 'en') <> ''
        AND names -> 'pl' IS NOT NULL
        AND jsonb_typeof(names -> 'pl') = 'string'
        AND btrim(names ->> 'pl') <> ''
    ),
    nutrition_basis TEXT NOT NULL CHECK (nutrition_basis IN ('g', 'ml')),
    protein DOUBLE PRECISION NOT NULL
        CHECK (protein >= 0 AND protein < 'Infinity'::float8),
    carbohydrate DOUBLE PRECISION NOT NULL
        CHECK (carbohydrate >= 0 AND carbohydrate < 'Infinity'::float8),
    fat DOUBLE PRECISION NOT NULL
        CHECK (fat >= 0 AND fat < 'Infinity'::float8),
    serving DOUBLE PRECISION
        CHECK (serving IS NULL OR (serving > 0 AND serving < 'Infinity'::float8)),
    food_family_id INTEGER REFERENCES food_families(id),
    image_key TEXT CHECK (image_key IS NULL OR btrim(image_key) <> ''),
    serving_unit TEXT GENERATED ALWAYS AS
        (CASE WHEN serving IS NOT NULL THEN nutrition_basis END) STORED,
    source TEXT CHECK (
        source IS NULL OR (
            source ~ '^[A-Za-z][A-Za-z0-9+.-]*:([A-Za-z0-9._~!$&''()*+,;=:@/?#-]|%[0-9A-Fa-f]{2}|\[[0-9A-Fa-f:.]+\])+$'
            AND source !~ '#.*#'
            AND (source !~* '^https?:' OR (
                -- An explicit port is 1-65535, with optional leading zeros; an empty port is absent.
                source ~* '^https?://([A-Za-z0-9._~!$&''()*+,;=:%-]+@)?([A-Za-z0-9._~!$&''()*+,;=%-]+|\[[0-9A-Fa-f.]*:[0-9A-Fa-f:.]*\])(:(0*([1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5]))?)?([/?#]|$)'
                -- Use PostgreSQL's IP parser; allowed characters alone do not validate IPv6.
                AND COALESCE(pg_input_is_valid(
                    substring(source FROM '(?i)^https?://(?:[A-Za-z0-9._~!$&''()*+,;=:%-]+@)?\[([0-9A-Fa-f:.]+)\]'),
                    'inet'
                ), true)
            ))
        )
    ),
    CONSTRAINT food_objects_macro_profile_not_all_zero
        CHECK (protein > 0 OR carbohydrate > 0 OR fat > 0)
);
