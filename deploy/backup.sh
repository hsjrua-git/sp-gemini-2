#!/usr/bin/env bash
# Back up the Student Panel database to a timestamped, compressed dump.
# Run it by hand, or from cron/systemd on a schedule. Reads DATABASE_URL from
# server/.env. Old backups beyond $KEEP are pruned.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$HERE/../server/.env}"
BACKUP_DIR="${BACKUP_DIR:-$HERE/../backups}"
KEEP="${KEEP:-30}"

# Extract DATABASE_URL from the server .env without executing it as shell code.
if [ -z "${DATABASE_URL:-}" ] && [ -f "$ENV_FILE" ]; then
  DATABASE_URL="$(grep -E '^[[:space:]]*DATABASE_URL=' "$ENV_FILE" | tail -n 1 | sed -E 's/^[[:space:]]*DATABASE_URL=//; s/^["'\'']//; s/["'\'']$//')"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set (looked in $ENV_FILE)." >&2
  exit 1
fi

umask 077
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/student-panel-$STAMP.sql.gz"
TMP="$OUT.tmp.$$"
trap 'rm -f "$TMP"' EXIT

# --clean --if-exists makes the dump safe to restore over an existing database.
pg_dump --clean --if-exists --no-owner --no-privileges "$DATABASE_URL" \
  | gzip >"$TMP"
gzip -t "$TMP"
mv "$TMP" "$OUT"
trap - EXIT

echo "Wrote $OUT"

# Keep only the newest $KEEP dumps, ordered by modification time. Keep paths in
# a Bash array throughout: line/word-based pipelines split spaces and newlines.
dumps=("$OUT")
for file in "$BACKUP_DIR"/student-panel-*.sql.gz; do
  [ "$file" = "$OUT" ] && continue
  [ -f "$file" ] || continue
  index=${#dumps[@]}
  while ((index > 0)) && [[ "$file" -nt "${dumps[index - 1]}" ]]; do
    dumps[index]="${dumps[index - 1]}"
    index=$((index - 1))
  done
  dumps[index]="$file"
done
for ((index = KEEP; index < ${#dumps[@]}; index++)); do
  rm -f -- "${dumps[index]}"
done
