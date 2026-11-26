SELECT md5(string_agg(r::text, ',' ORDER BY oid) || has_table_privilege($2::name, 'food_objects', 'INSERT')::text)
FROM pg_authid r WHERE rolname IN ($1, $2);
