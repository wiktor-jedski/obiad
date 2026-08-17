-- Deployment privilege setup applied by the admin connection to a target
-- database BEFORE dbsetup runs (ARCH-016, ISSUE-001). It removes PUBLIC
-- object-creation and temporary-table privileges, keeps the schema-owner
-- role's CREATE right on the public schema, and grants the owner and runtime
-- login roles the minimum connection rights.
--
-- The local deployment setup script (scripts/setup_local_database.sh) and the
-- integration fixtures apply this file verbatim after substituting these
-- identifier placeholders:
--   __OBIAD_DATABASE__      the target database name
--   __OBIAD_OWNER_USER__    the schema-owner login role
--   __OBIAD_RUNTIME_USER__  the SELECT-only runtime login role
--
-- REVOKE ALL removes CONNECT, CREATE, and TEMPORARY from PUBLIC on the
-- database; the explicit GRANT CONNECT statements re-enable only the two
-- deployment roles. REVOKE CREATE ON SCHEMA public removes object creation
-- from PUBLIC; the schema-owner role keeps CREATE through the explicit grant,
-- so dbsetup can still apply the schema. No role other than the owner may
-- create objects or temporary tables.

REVOKE ALL ON DATABASE "__OBIAD_DATABASE__" FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CREATE ON SCHEMA public TO "__OBIAD_OWNER_USER__";
GRANT CONNECT ON DATABASE "__OBIAD_DATABASE__" TO "__OBIAD_OWNER_USER__", "__OBIAD_RUNTIME_USER__";
GRANT USAGE ON SCHEMA public TO "__OBIAD_RUNTIME_USER__";
