#!/usr/bin/env bash
# Restore ship_dev to the LOCKED condition-of-record snapshot.
#
# Why this exists (Decision #1b): the base `pnpm db:seed` is NOT idempotent
# (doc count drifted 577 -> 623 -> 627 across the audit) and `pnpm test`
# truncates ship_dev. To make every audit baseline reproducible under
# IDENTICAL conditions, the exact dataset is frozen in
# scripts/audit/snapshot/ship_dev.condition.dump (pg_dump -Fc).
#
# Run this:
#   - before any measurement run that must match the recorded condition
#   - after `pnpm --filter @ship/api test*` (which truncates ship_dev)
#
# Usage: bash scripts/audit/db-restore.sh
set -euo pipefail
PG=ship-postgres-1
DUMP="$(cd "$(dirname "$0")" && pwd)/snapshot/ship_dev.condition.dump"

[ -f "$DUMP" ] || { echo "ERROR: snapshot not found: $DUMP" >&2; exit 1; }

echo "Restoring ship_dev from locked snapshot ($(du -h "$DUMP" | cut -f1))..."
docker cp "$DUMP" "$PG":/tmp/ship_dev.condition.dump
# Terminate other sessions so --clean can drop objects cleanly, then restore.
docker exec "$PG" psql -U ship -d postgres -tAc \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='ship_dev' AND pid<>pg_backend_pid();" >/dev/null
docker exec "$PG" pg_restore -U ship -d ship_dev --clean --if-exists --no-owner /tmp/ship_dev.condition.dump

echo "Verifying condition of record:"
docker exec "$PG" psql -U ship -d ship_dev -tAc \
  "SELECT 'documents='||count(*) FROM documents \
   UNION ALL SELECT 'issues='||count(*) FROM documents WHERE document_type='issue' \
   UNION ALL SELECT 'sprints='||count(*) FROM documents WHERE document_type='sprint' \
   UNION ALL SELECT 'users='||count(*) FROM users \
   UNION ALL SELECT 'associations='||count(*) FROM document_associations"
echo "Expected: documents=627 issues=328 sprints=35 users=31 associations=625"
