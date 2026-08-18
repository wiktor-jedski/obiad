-- Versioned migration 0005: the deterministic Food Catalog seed (Phase 2,
-- task 6; ARCH-007, ARCH-013, ARCH-016).
--
-- This migration inserts the owner-approved catalog from ISSUE-002: exactly
-- 38 generic Food Objects with the fixed opaque IDs 1 through 38, the
-- approved localized names, Physical States, Servings, Food Family
-- membership, and image keys, and plausible test-designed source nutrition
-- (REQ-004, REQ-070, REQ-071, REQ-072). Application code must not infer
-- meaning or contiguity from the fixed IDs (ISSUE-002).
--
-- Transaction safety: the migration runner (internal/dbsetup) executes every
-- versioned migration body in one transaction together with its
-- schema_migrations bookkeeping row (applyOne). The two INSERT statements
-- below therefore commit or roll back as one unit: a failure anywhere
-- inserts no Food Family row, no Food Object row, and no version record, so
-- the catalog can never be partially seeded and a re-run of dbsetup retries
-- the complete seed. A repeated dbsetup run applies zero migrations (the
-- version is already recorded), which keeps the seed idempotent.
--
-- Data contract (ISSUE-002, ARCH-013):
--   * food_families holds one row: Food Family ID 1 contains only Pizza
--     Margherita (1) and Pizza Capricciosa (2); every other Food Object has
--     no Food Family (NULL food_family_id);
--   * macro values are grams per Nutrition Basis (100 g for solids, 100 ml
--     for liquids) and are stored as source values only; derived calories,
--     Nutritional Similarities, Matched Quantities, page data, and rounded
--     display values are never stored in production tables (ARCH-013);
--   * image keys are opaque frontend keys; the known keys are
--     'pizza-margherita', 'chicken-breast', 'milk', and 'gyoza', and every
--     other Food Object has a NULL image key (NULL is the single absent-image
--     state, REQ-011, ARCH-015);
--   * serving stores the base-quantity number only; its unit is grams for a
--     solid and millilitres for a liquid (glossary Serving contract).

INSERT INTO food_families (id) VALUES (1);

INSERT INTO food_objects
    (id, names, physical_state, protein, carbohydrate, fat, serving, food_family_id, image_key)
VALUES
    (1,  '{"en": "Pizza Margherita",   "pl": "Pizza margherita"}'::jsonb,   'solid',  10,   30,   10,   350,   1,    'pizza-margherita'),
    (2,  '{"en": "Pizza Capricciosa",  "pl": "Pizza capricciosa"}'::jsonb,  'solid',  11,   28,   11,   350,   1,    NULL),
    (3,  '{"en": "Lasagna",            "pl": "Lazania"}'::jsonb,            'solid',  9,    18,   8,    350,   NULL, NULL),
    (4,  '{"en": "Pierogi",            "pl": "Pierogi"}'::jsonb,            'solid',  6,    32,   5,    250,   NULL, NULL),
    (5,  '{"en": "Chicken breast",     "pl": "Pierś z kurczaka"}'::jsonb,   'solid',  31,   0,    3.6,  NULL,  NULL, 'chicken-breast'),
    (6,  '{"en": "Pork chop",          "pl": "Kotlet wieprzowy"}'::jsonb,   'solid',  27,   0,    14,   NULL,  NULL, NULL),
    (7,  '{"en": "Beef steak",         "pl": "Stek wołowy"}'::jsonb,        'solid',  26,   0,    15,   NULL,  NULL, NULL),
    (8,  '{"en": "Mixed berries",      "pl": "Owoce jagodowe"}'::jsonb,     'solid',  1,    12,   0.5,  NULL,  NULL, NULL),
    (9,  '{"en": "Apple juice",        "pl": "Sok jabłkowy"}'::jsonb,       'liquid', 0.1,  11,   0.1,  NULL,  NULL, NULL),
    (10, '{"en": "Milk",               "pl": "Mleko"}'::jsonb,              'liquid', 3.4,  4.8,  2,    NULL,  NULL, 'milk'),
    (11, '{"en": "Skyr yogurt",        "pl": "Jogurt skyr"}'::jsonb,        'solid',  11,   4,    0.2,  150,   NULL, NULL),
    (12, '{"en": "Greek yogurt",       "pl": "Jogurt grecki"}'::jsonb,      'solid',  9,    4,    5,    170,   NULL, NULL),
    (13, '{"en": "Gyoza",              "pl": "Pierożki gyoza"}'::jsonb,     'solid',  8,    24,   8,    200,   NULL, 'gyoza'),
    (14, '{"en": "Oat milk",           "pl": "Napój owsiany"}'::jsonb,      'liquid', 1,    7,    1.5,  NULL,  NULL, NULL),
    (15, '{"en": "Kebab",              "pl": "Kebab"}'::jsonb,              'solid',  15,   18,   12,   350,   NULL, NULL),
    (16, '{"en": "Gyros",              "pl": "Gyros"}'::jsonb,              'solid',  18,   10,   14,   300,   NULL, NULL),
    (17, '{"en": "Polish chicken soup","pl": "Rosół"}'::jsonb,              'liquid', 2,    1,    1,    300,   NULL, NULL),
    (18, '{"en": "Butter",             "pl": "Masło"}'::jsonb,              'solid',  0.5,  0.5,  82,   NULL,  NULL, NULL),
    (19, '{"en": "Olive oil",          "pl": "Oliwa z oliwek"}'::jsonb,     'liquid', 0,    0,    91.3, NULL,  NULL, NULL),
    (20, '{"en": "Protein shake",      "pl": "Shake białkowy"}'::jsonb,     'liquid', 8,    4,    1,    300,   NULL, NULL),
    (21, '{"en": "Beef cheeseburger",  "pl": "Cheeseburger wołowy"}'::jsonb,'solid',  13,   24,   13,   220,   NULL, NULL),
    (22, '{"en": "Fried chicken wings","pl": "Smażone skrzydełka z kurczaka"}'::jsonb, 'solid', 22, 8, 20, 180, NULL, NULL),
    (23, '{"en": "Turkey breast",      "pl": "Pierś z indyka"}'::jsonb,      'solid',  29,   0,    2,    NULL,  NULL, NULL),
    (24, '{"en": "Pickled cucumbers",  "pl": "Ogórki kiszone"}'::jsonb,     'solid',  0.5,  2,    0.2,  NULL,  NULL, NULL),
    (25, '{"en": "Tomatoes",           "pl": "Pomidory"}'::jsonb,           'solid',  0.9,  3.9,  0.2,  NULL,  NULL, NULL),
    (26, '{"en": "Pancakes",           "pl": "Naleśniki"}'::jsonb,          'solid',  6,    28,   7,    150,   NULL, NULL),
    (27, '{"en": "Omelette",           "pl": "Omlet"}'::jsonb,              'solid',  11,   1,    12,   180,   NULL, NULL),
    (28, '{"en": "Oatmeal",            "pl": "Owsianka"}'::jsonb,           'solid',  2.5,  12,   1.5,  250,   NULL, NULL),
    (29, '{"en": "Paella",             "pl": "Paella"}'::jsonb,             'solid',  8,    20,   5,    350,   NULL, NULL),
    (30, '{"en": "Pho",                "pl": "Zupa pho"}'::jsonb,           'liquid', 3,    8,    1.5,  400,   NULL, NULL),
    (31, '{"en": "Beetroot borscht",   "pl": "Barszcz czerwony"}'::jsonb,   'liquid', 1,    7,    0.5,  300,   NULL, NULL),
    (32, '{"en": "Coleslaw",           "pl": "Surówka coleslaw"}'::jsonb,   'solid',  1,    10,   8,    100,   NULL, NULL),
    (33, '{"en": "Mondongo",           "pl": "Zupa mondongo"}'::jsonb,      'liquid', 7,    8,    4,    350,   NULL, NULL),
    (34, '{"en": "Bandeja paisa",      "pl": "Bandeja paisa"}'::jsonb,      'solid',  12,   20,   15,   500,   NULL, NULL),
    (35, '{"en": "Pastel de nata",     "pl": "Pastel de nata"}'::jsonb,     'solid',  5,    35,   14,   60,    NULL, NULL),
    (36, '{"en": "Cheesecake",         "pl": "Sernik"}'::jsonb,             'solid',  7,    25,   18,   120,   NULL, NULL),
    (37, '{"en": "Orange juice",       "pl": "Sok pomarańczowy"}'::jsonb,   'liquid', 0.7,  10,   0.2,  NULL,  NULL, NULL),
    (38, '{"en": "Goulash",            "pl": "Gulasz"}'::jsonb,             'solid',  15,   6,    10,   350,   NULL, NULL);
