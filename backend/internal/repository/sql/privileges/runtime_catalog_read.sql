-- Deployment privilege grant applied by the schema-owner connection AFTER
-- dbsetup creates the Food Catalog tables (ARCH-013, ARCH-016). It grants the
-- runtime login role SELECT-only read access: SELECT on the catalog tables
-- and default SELECT for tables the owner creates in the public schema later.
-- No INSERT, UPDATE, DELETE, DDL, or temporary-table rights are granted.
--
-- The local deployment setup script (scripts/setup_local_database.sh) and the
-- integration fixtures apply this file verbatim after substituting this
-- identifier placeholder:
--   __OBIAD_RUNTIME_USER__  the SELECT-only runtime login role
--
-- The runtime role is normalized deterministically on every run: any
-- pre-existing table or default-privilege grant (for example from a role that
-- was created privileged) is revoked before the SELECT grants are applied, so
-- the runtime role can only ever read the catalog.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "__OBIAD_RUNTIME_USER__";
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM "__OBIAD_RUNTIME_USER__";
GRANT SELECT ON TABLE food_objects, food_families TO "__OBIAD_RUNTIME_USER__";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO "__OBIAD_RUNTIME_USER__";
