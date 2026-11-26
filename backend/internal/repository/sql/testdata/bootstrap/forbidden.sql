INSERT INTO food_families DEFAULT VALUES;
UPDATE food_objects SET fat = 0;
DELETE FROM food_objects;
TRUNCATE food_families CASCADE;
ALTER TABLE food_objects ADD COLUMN forbidden integer;
CREATE TABLE forbidden (id integer);
CREATE TEMPORARY TABLE forbidden (id integer);
CREATE SCHEMA forbidden;
