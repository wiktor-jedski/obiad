#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

case "${1:-}" in
    backup)
        : "${2:?usage: scripts/database.sh backup PATH}"
        umask 077
        temporary="$(mktemp "${2}.XXXXXX")"
        trap 'rm -f "$temporary"' EXIT
        docker compose exec -T postgres pg_dump -U postgres -d obiad \
            --format=custom --no-owner --no-acl > "$temporary"
        mv -n "$temporary" "$2"
        if [ -f "$temporary" ]; then
            echo "backup destination already exists: $2" >&2
            exit 1
        fi
        echo "Backup saved: $2"
        ;;
    restore)
        : "${2:?usage: scripts/database.sh restore PATH}"
        test -s "$2"
        docker compose exec -T postgres pg_restore --list < "$2" > /dev/null
        docker compose stop frontend backend
        docker compose exec -T postgres pg_restore -U postgres -d obiad \
            --role=obiad_owner --clean --if-exists --no-owner --no-acl \
            --single-transaction --exit-on-error < "$2"
        docker compose run --rm --no-deps --entrypoint dbbootstrap setup grants
        docker compose restart --no-deps backend frontend
        ;;
    *)
        echo "usage: scripts/database.sh backup|restore PATH" >&2
        exit 2
        ;;
esac
