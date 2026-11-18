#!/bin/sh
set -eu

python3 /opt/obiad/validate_release.py /opt/obiad/release
: "${OBIAD_OWNER_PASSWORD:?set OBIAD_OWNER_PASSWORD}"
: "${OBIAD_RUNTIME_PASSWORD:?set OBIAD_RUNTIME_PASSWORD}"

dbbootstrap roles
export OBIAD_SCHEMA_OWNER_DATABASE_URL='host=postgres port=5432 user=obiad_owner dbname=obiad sslmode=disable'
PGPASSWORD="$OBIAD_OWNER_PASSWORD" dbsetup
PGPASSWORD="$OBIAD_OWNER_PASSWORD" catalogload /opt/obiad/release/catalog.json
dbbootstrap grants
