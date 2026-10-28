#!/usr/bin/env bash
# Restore a Student Panel backup made by backup.sh.
# DESTRUCTIVE: this overwrites the current database.
# Usage: ./restore.sh path/to/student-panel-YYYYMMDD-HHMMSS.sql.gz
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$HERE/../server/.env}"
FILE="${1:-}"

if [ -z "$FILE" ]; then
  echo "Usage: $0 path/to/backup.sql.gz" >&2
  exit 1
fi
if [ ! -f "$FILE" ]; then
  echo "No such file: $FILE" >&2
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ] && [ -f "$ENV_FILE" ]; then
  DATABASE_URL="$(grep -E '^[[:space:]]*DATABASE_URL=' "$ENV_FILE" | tail -n 1 | sed -E 's/^[[:space:]]*DATABASE_URL=//; s/^["'\'']//; s/["'\'']$//')"
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set (looked in $ENV_FILE)." >&2
  exit 1
fi

read -r -p "This overwrites the database at DATABASE_URL. Type 'yes' to continue: " ok
[ "$ok" = "yes" ] || { echo "Aborted."; exit 1; }

gunzip -c "$FILE" | psql -v ON_ERROR_STOP=1 --single-transaction "$DATABASE_URL"
echo "Restore complete."
