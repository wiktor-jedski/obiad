WITH target AS (
    SELECT oid, datdba FROM pg_database WHERE datname = $1
), runtime AS (
    SELECT oid FROM pg_roles WHERE rolname = $2
)
SELECT EXISTS (SELECT FROM target), EXISTS (
    SELECT FROM target, runtime
    WHERE target.datdba = runtime.oid OR EXISTS (
        SELECT FROM pg_shdepend d
        WHERE d.dbid = target.oid AND d.refclassid = 'pg_authid'::regclass
          AND d.refobjid = runtime.oid AND d.deptype = 'o'
    )
);
