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
# Environment contract (credentials are environment-provided, never committed,
# and never appear in process arguments):
#   OBIAD_ADMIN_DATABASE_URL   admin connection used to create the database,
#                              roles, and privileges. It may carry a password
#                              and connection options such as sslmode; both
#                              are preserved on every rebuilt connection. A
#                              password in the URL is stripped from argv and
#                              handed to psql through PGPASSWORD only; without
#                              one, PGPASSWORD or ~/.pgpass supplies it.
#                              (default: postgres://postgres@localhost:5432/postgres)
#   OBIAD_OWNER_PASSWORD       password of the schema-owner role (required)
#   OBIAD_RUNTIME_PASSWORD     password of the runtime role (required)
#   OBIAD_CREDENTIAL_FILE      where the owner and runtime connection URLs are
#                              written with mode 0600 through an atomic rename.
#                              A custom path must have an existing parent
#                              directory (never created or chmodded here) and
#                              must not be a symlink.
#                              (default: ${XDG_CONFIG_HOME:-$HOME/.config}/obiad/database-urls,
#                              created with mode 0700 when missing)
#
# The schema-owner connection runs dbsetup via OBIAD_SCHEMA_OWNER_DATABASE_URL.
# The later Fiber process reads its connection from OBIAD_RUNTIME_DATABASE_URL;
# both URLs are handed off through the mode-0600 credential file and are never
# printed. Every psql invocation connects with a password-free URL plus
# PGPASSWORD, role statements are piped through stdin, and URL userinfo is
# percent-encoded by Python's URL parser, so no credential ever appears in a
# process argument.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRIVILEGES_DIR="$ROOT/backend/internal/repository/sql/privileges"
DB_NAME="obiad"
OWNER_ROLE="obiad_owner"
RUNTIME_ROLE="obiad_runtime"
ADMIN_URL="${OBIAD_ADMIN_DATABASE_URL:-postgres://postgres@localhost:5432/postgres}"

: "${OBIAD_OWNER_PASSWORD:?set OBIAD_OWNER_PASSWORD (the schema-owner role password)}"
: "${OBIAD_RUNTIME_PASSWORD:?set OBIAD_RUNTIME_PASSWORD (the runtime role password)}"

for bin in psql go python3; do
    command -v "$bin" >/dev/null 2>&1 || { echo "error: required binary '$bin' not found" >&2; exit 1; }
done

# parse_admin_url splits OBIAD_ADMIN_DATABASE_URL with Python's URL parser and
# emits shell-quoted values: ADMIN_USER, ADMIN_PASSWORD (decoded, possibly
# empty), ADMIN_HOST, ADMIN_PORT, ADMIN_QUERY, ADMIN_DB, ADMIN_ENDPOINT
# (password-free, original database), ADMIN_TARGET_ENDPOINT (password-free,
# target database), OWNER_URL, OWNER_ENDPOINT, and RUNTIME_URL. Unsupported
# forms (non-postgres scheme, Unix sockets, invalid port, fragments) are
# rejected; query parameters such as sslmode are preserved on every rebuilt
# URL and userinfo is percent-encoded by the standard library. The secrets are
# passed through the environment, never as arguments.
parse_admin_url() { # <target-db>
    local pyout
    pyout="$(OBIAD_ADMIN_DATABASE_URL="$ADMIN_URL" \
        OBIAD_OWNER_PASSWORD="$OBIAD_OWNER_PASSWORD" \
        OBIAD_RUNTIME_PASSWORD="$OBIAD_RUNTIME_PASSWORD" \
        python3 - "$1" <<'PY'
import os
import sys
import urllib.parse

raw = os.environ["OBIAD_ADMIN_DATABASE_URL"]
owner_password = os.environ["OBIAD_OWNER_PASSWORD"]
runtime_password = os.environ["OBIAD_RUNTIME_PASSWORD"]
target_db = sys.argv[1]

p = urllib.parse.urlsplit(raw)
if p.scheme not in ("postgres", "postgresql"):
    sys.exit("error: OBIAD_ADMIN_DATABASE_URL must use scheme postgres:// or postgresql://")
if p.hostname is None:
    sys.exit("error: OBIAD_ADMIN_DATABASE_URL must use a TCP host:port (Unix sockets are not supported)")
if p.fragment:
    sys.exit("error: OBIAD_ADMIN_DATABASE_URL must not contain a fragment")
try:
    port = p.port or 5432
except ValueError:
    sys.exit("error: OBIAD_ADMIN_DATABASE_URL has an invalid port")


def shq(s):
    return "'" + s.replace("'", "'\\''") + "'"


def host(s):
    return "[" + s + "]" if ":" in s else s


def build(user, password, db, query):
    auth = urllib.parse.quote(user, safe="")
    if password is not None:
        auth += ":" + urllib.parse.quote(password, safe="")
    url = "postgres://%s@%s:%s/%s" % (auth, host(p.hostname), port, db)
    return url + ("?" + query if query else "")


user = urllib.parse.unquote(p.username or "")
password = p.password
if password is not None:
    password = urllib.parse.unquote(password)
db = p.path.lstrip("/")

print("ADMIN_USER=%s" % shq(user))
print("ADMIN_PASSWORD=%s" % shq(password if password is not None else ""))
print("ADMIN_HOST=%s" % shq(p.hostname))
print("ADMIN_PORT=%s" % shq(str(port)))
print("ADMIN_QUERY=%s" % shq(p.query))
print("ADMIN_DB=%s" % shq(db))
print("ADMIN_ENDPOINT=%s" % shq(build(user, None, db, p.query)))
print("ADMIN_TARGET_ENDPOINT=%s" % shq(build(user, None, target_db, p.query)))
print("OWNER_URL=%s" % shq(build("obiad_owner", owner_password, target_db, p.query)))
print("OWNER_ENDPOINT=%s" % shq(build("obiad_owner", None, target_db, p.query)))
print("RUNTIME_URL=%s" % shq(build("obiad_runtime", runtime_password, target_db, p.query)))
PY
)"
    eval "$pyout"
}

# psql_quote quotes a value as a PostgreSQL string literal. The role statement
# sets standard_conforming_strings = on on the same session first, so doubling
# single quotes is the only escaping required and backslashes stay literal.
psql_quote() {
    local s="$1"
    s="${s//\'/\'\'}"
    printf "'%s'" "$s"
}

# apply_sql runs one embedded privilege SQL file against a connection after
# substituting PLACEHOLDER=value identifier pairs, the same files the
# integration fixtures apply. url must be password-free; the caller supplies
# the password through PGPASSWORD so no credential appears in the psql command
# line.
apply_sql() { # <password-free-url> <sql-file> <PLACEHOLDER=value>...
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

parse_admin_url "$DB_NAME"
ADMIN_PGPASSWORD="${ADMIN_PASSWORD:-${PGPASSWORD:-}}"

# Credential handoff contract, validated before any database mutation:
#   * the default path is a dedicated private directory the script creates
#     only when it is missing (mode 0700); it never chmods an existing one;
#   * a custom OBIAD_CREDENTIAL_FILE path must have an existing parent
#     directory, which the script never creates or chmods;
#   * neither the parent directory nor the destination file may be a symlink
#     (credentials must never be published through one), and an existing
#     destination must be a regular file.
CRED_FILE="${OBIAD_CREDENTIAL_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/obiad/database-urls}"
CRED_DIR="$(dirname "$CRED_FILE")"
if [ -n "${OBIAD_CREDENTIAL_FILE+x}" ]; then
    if [ ! -d "$CRED_DIR" ]; then
        echo "error: OBIAD_CREDENTIAL_FILE directory ${CRED_DIR} does not exist (create it first)" >&2
        exit 1
    fi
elif [ ! -d "$CRED_DIR" ]; then
    mkdir -m 700 -p "$CRED_DIR"
fi
if [ -L "$CRED_DIR" ] || [ -L "$CRED_FILE" ]; then
    echo "error: credential path ${CRED_FILE} must not be a symlink" >&2
    exit 1
fi
if [ -e "$CRED_FILE" ] && [ ! -f "$CRED_FILE" ]; then
    echo "error: credential destination ${CRED_FILE} is not a regular file" >&2
    exit 1
fi

if [ "$(PGPASSWORD="$ADMIN_PGPASSWORD" psql "$ADMIN_ENDPOINT" -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'")" != "1" ]; then
    PGPASSWORD="$ADMIN_PGPASSWORD" psql "$ADMIN_ENDPOINT" -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${DB_NAME}" >/dev/null
    echo "created database ${DB_NAME}"
else
    echo "database ${DB_NAME} already exists"
fi

for role in "$OWNER_ROLE" "$RUNTIME_ROLE"; do
    password="$OBIAD_OWNER_PASSWORD"
    [ "$role" = "$RUNTIME_ROLE" ] && password="$OBIAD_RUNTIME_PASSWORD"
    password_sql="$(psql_quote "$password")"
    if [ "$(PGPASSWORD="$ADMIN_PGPASSWORD" psql "$ADMIN_ENDPOINT" -tAc "SELECT 1 FROM pg_roles WHERE rolname = '${role}'")" = "1" ]; then
        # The role statement goes through stdin so the password never appears
        # in the psql command line; standard_conforming_strings is pinned on
        # the same session so the quoted literal is unambiguous.
        printf 'SET standard_conforming_strings = on;\nALTER ROLE %s LOGIN PASSWORD %s;\n' "$role" "$password_sql" \
            | PGPASSWORD="$ADMIN_PGPASSWORD" psql "$ADMIN_ENDPOINT" -v ON_ERROR_STOP=1 -f - >/dev/null
        echo "updated role ${role} password"
    else
        printf 'SET standard_conforming_strings = on;\nCREATE ROLE %s LOGIN PASSWORD %s;\n' "$role" "$password_sql" \
            | PGPASSWORD="$ADMIN_PGPASSWORD" psql "$ADMIN_ENDPOINT" -v ON_ERROR_STOP=1 -f - >/dev/null
        echo "created role ${role}"
    fi
done

PGPASSWORD="$ADMIN_PGPASSWORD" psql "$ADMIN_ENDPOINT" -v ON_ERROR_STOP=1 -c "ALTER DATABASE ${DB_NAME} OWNER TO ${OWNER_ROLE}" >/dev/null
echo "database ${DB_NAME} is owned by ${OWNER_ROLE}"

# Apply the schema- and database-level privilege statements to the target
# database itself: the admin connection defaults to the admin database, whose
# public schema must not be touched.
PGPASSWORD="$ADMIN_PGPASSWORD" apply_sql "$ADMIN_TARGET_ENDPOINT" "$PRIVILEGES_DIR/remove_public_privileges.sql" \
    "__OBIAD_DATABASE__=${DB_NAME}" \
    "__OBIAD_OWNER_USER__=${OWNER_ROLE}" \
    "__OBIAD_RUNTIME_USER__=${RUNTIME_ROLE}"
echo "removed PUBLIC object-creation and temporary-table privileges"

echo "running dbsetup with the schema-owner credential"
(cd "$ROOT/backend" && OBIAD_SCHEMA_OWNER_DATABASE_URL="$OWNER_URL" go run ./cmd/dbsetup)

PGPASSWORD="$OBIAD_OWNER_PASSWORD" apply_sql "$OWNER_ENDPOINT" "$PRIVILEGES_DIR/runtime_catalog_read.sql" \
    "__OBIAD_RUNTIME_USER__=${RUNTIME_ROLE}"
echo "granted ${RUNTIME_ROLE} SELECT-only catalog access"

# Safe handoff: both connection URLs are written to a mode-0600 file outside
# the repository and are never printed. The path contract was validated before
# any database mutation; the publish step writes a securely created temp file
# in the destination directory (mode 0600), fsyncs it, and atomically renames
# it over the destination, removing the temp file on any failure. Values are
# shell-escaped with printf %q, so sourcing the file yields the exact URLs for
# every accepted URL character, including apostrophes in query strings. Load
# them with
#   set -a; source "$CRED_FILE"; set +a
publish_credentials() {
    local tmp
    tmp="$(mktemp "$CRED_DIR/obiad-urls.XXXXXX")" || {
        echo "error: cannot create a credential temp file in ${CRED_DIR}" >&2
        exit 1
    }
    if printf "OBIAD_SCHEMA_OWNER_DATABASE_URL=%q\nOBIAD_RUNTIME_DATABASE_URL=%q\n" "$OWNER_URL" "$RUNTIME_URL" > "$tmp"; then
        chmod 600 "$tmp"
        python3 -c 'import os,sys; fd=os.open(sys.argv[1], os.O_RDONLY); os.fsync(fd); os.close(fd)' "$tmp" 2>/dev/null || true
        if mv -f "$tmp" "$CRED_FILE"; then
            return 0
        fi
    fi
    rm -f "$tmp"
    echo "error: failed to publish credentials to ${CRED_FILE}" >&2
    exit 1
}
publish_credentials

echo
echo "Local database ready:"
echo "  endpoint: postgres://${ADMIN_HOST}:${ADMIN_PORT}/${DB_NAME}"
echo "  credentials (mode 0600, never printed): ${CRED_FILE}"
echo "  load them with: set -a; source ${CRED_FILE}; set +a"
echo "  OBIAD_SCHEMA_OWNER_DATABASE_URL  schema-owner connection for dbsetup (user ${OWNER_ROLE})"
echo "  OBIAD_RUNTIME_DATABASE_URL       SELECT-only connection for the Fiber process (user ${RUNTIME_ROLE})"
