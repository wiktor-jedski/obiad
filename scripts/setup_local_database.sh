#!/usr/bin/env bash
# Local deployment setup for the Obiad three-process stack (ARCH-016).
#
# Creates the local PostgreSQL database and the two login roles — the
# schema-owner role and the SELECT-only runtime role — BEFORE dbsetup runs,
# removes PUBLIC object-creation and temporary-table privileges, applies the
# real setup command (go run ./cmd/dbsetup) with the schema-owner credential,
# and grants the runtime role SELECT-only access to the Food Catalog tables.
# Application commands never create database users; this deployment script
# does (ISSUE-001). The script is idempotent: re-running it restores the same
# topology with the passwords from the environment.
#
# Environment contract (credentials are environment-provided and never
# committed):
#   OBIAD_ADMIN_DATABASE_URL   admin connection used to create the database,
#                              roles, and privileges
#                              (default: postgres://postgres:obiad@localhost:5432/postgres)
#   OBIAD_OWNER_PASSWORD       password of the schema-owner role (required)
#   OBIAD_RUNTIME_PASSWORD     password of the runtime role (required)
#
# The schema-owner connection runs dbsetup via OBIAD_SCHEMA_OWNER_DATABASE_URL.
# The script prints a password-free endpoint and the env contract names; the
# later Fiber process reads its connection from OBIAD_RUNTIME_DATABASE_URL.
# Passwords must be URL-safe (no : / @ % characters) because they are embedded
# in the internal connection URLs. Credentials never appear in psql argv:
# role statements are piped through stdin and the owner grants use PGPASSWORD.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRIVILEGES_DIR="$ROOT/backend/internal/repository/sql/privileges"
DB_NAME="obiad"
OWNER_ROLE="obiad_owner"
RUNTIME_ROLE="obiad_runtime"
ADMIN_URL="${OBIAD_ADMIN_DATABASE_URL:-postgres://postgres:obiad@localhost:5432/postgres}"

: "${OBIAD_OWNER_PASSWORD:?set OBIAD_OWNER_PASSWORD (the schema-owner role password)}"
: "${OBIAD_RUNTIME_PASSWORD:?set OBIAD_RUNTIME_PASSWORD (the runtime role password)}"

for bin in psql go; do
    command -v "$bin" >/dev/null 2>&1 || { echo "error: required binary '$bin' not found" >&2; exit 1; }
done

# psql_quote quotes a value as a PostgreSQL string literal.
psql_quote() {
    local s="$1"
    s="${s//\'/\'\'}"
    printf "'%s'" "$s"
}

# apply_sql runs one embedded privilege SQL file against a connection after
# substituting PLACEHOLDER=value identifier pairs, the same files the
# integration fixtures apply.
apply_sql() { # <database-url> <sql-file> <PLACEHOLDER=value>...
    local url="$1" file="$2"
    shift 2
    local sed_expr=()
    local kv name value
    for kv in "$@"; do
        name="${kv%%=*}"
        value="${kv#*=}"
        sed_expr+=(-e "s/${name}/${value}/g")
    done
    sed "${sed_expr[@]}" "$file" | psql "$url" -v ON_ERROR_STOP=1 -f -
}

if [ "$(psql "$ADMIN_URL" -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'")" != "1" ]; then
    psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${DB_NAME}" >/dev/null
    echo "created database ${DB_NAME}"
else
    echo "database ${DB_NAME} already exists"
fi

for role in "$OWNER_ROLE" "$RUNTIME_ROLE"; do
    password="$OBIAD_OWNER_PASSWORD"
    [ "$role" = "$RUNTIME_ROLE" ] && password="$OBIAD_RUNTIME_PASSWORD"
    password_sql="$(psql_quote "$password")"
    if [ "$(psql "$ADMIN_URL" -tAc "SELECT 1 FROM pg_roles WHERE rolname = '${role}'")" = "1" ]; then
        # The role statement goes through stdin so the password never appears
        # in the psql command line.
        printf 'ALTER ROLE %s LOGIN PASSWORD %s\n' "$role" "$password_sql" \
            | psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f - >/dev/null
        echo "updated role ${role} password"
    else
        printf 'CREATE ROLE %s LOGIN PASSWORD %s\n' "$role" "$password_sql" \
            | psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f - >/dev/null
        echo "created role ${role}"
    fi
done

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "ALTER DATABASE ${DB_NAME} OWNER TO ${OWNER_ROLE}" >/dev/null
echo "database ${DB_NAME} is owned by ${OWNER_ROLE}"

# Apply the schema- and database-level privilege statements to the target
# database itself: the admin connection defaults to the admin database, whose
# public schema must not be touched.
ADMIN_DB_URL="$(printf '%s' "$ADMIN_URL" | sed -E "s#(/[^/]*)\$#/${DB_NAME}#")"
apply_sql "$ADMIN_DB_URL" "$PRIVILEGES_DIR/remove_public_privileges.sql" \
    "__OBIAD_DATABASE__=${DB_NAME}" \
    "__OBIAD_OWNER_USER__=${OWNER_ROLE}" \
    "__OBIAD_RUNTIME_USER__=${RUNTIME_ROLE}"
echo "removed PUBLIC object-creation and temporary-table privileges"

HOST_PORT="$(printf '%s' "$ADMIN_URL" | sed -E 's#^postgres(ql)?://[^@]*@##; s#/[^/]*$##')"
OWNER_URL="postgres://${OWNER_ROLE}:${OBIAD_OWNER_PASSWORD}@${HOST_PORT}/${DB_NAME}"

echo "running dbsetup with the schema-owner credential"
(cd "$ROOT/backend" && OBIAD_SCHEMA_OWNER_DATABASE_URL="$OWNER_URL" go run ./cmd/dbsetup)

# The owner grants connect through PGPASSWORD with a password-free endpoint so
# the owner password never appears in the psql command line.
OWNER_ENDPOINT="postgres://${OWNER_ROLE}@${HOST_PORT}/${DB_NAME}"
PGPASSWORD="$OBIAD_OWNER_PASSWORD" apply_sql "$OWNER_ENDPOINT" "$PRIVILEGES_DIR/runtime_catalog_read.sql" \
    "__OBIAD_RUNTIME_USER__=${RUNTIME_ROLE}"
echo "granted ${RUNTIME_ROLE} SELECT-only catalog access"

echo
echo "Local database ready (credentials stay in your environment, never printed):"
echo "  endpoint: postgres://${HOST_PORT}/${DB_NAME}"
echo "  OBIAD_SCHEMA_OWNER_DATABASE_URL  schema-owner connection for dbsetup (user ${OWNER_ROLE}, password from OBIAD_OWNER_PASSWORD)"
echo "  OBIAD_RUNTIME_DATABASE_URL       SELECT-only connection for the Fiber process (user ${RUNTIME_ROLE}, password from OBIAD_RUNTIME_PASSWORD)"
