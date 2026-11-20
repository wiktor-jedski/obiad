SELECT EXISTS (SELECT FROM food_objects) AND EXISTS (SELECT FROM food_families)
    AND EXISTS (SELECT FROM future_catalog_table)
    AND (SELECT count(*) = 2 FROM pg_roles WHERE rolname IN ($1, $2)
         AND rolcanlogin AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls))
    AND NOT EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname IN ($1, $2))
    AND (SELECT pg_get_userbyid(datdba) = $1 FROM pg_database WHERE datname = current_database())
    AND NOT EXISTS (SELECT FROM pg_database d, aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) acl
                    WHERE d.datname = current_database() AND acl.grantee = 0)
    AND NOT has_database_privilege(current_database(), 'CREATE,TEMP')
    AND NOT has_schema_privilege('public', 'CREATE')
    AND NOT has_table_privilege('future_catalog_table', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
