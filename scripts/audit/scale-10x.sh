#!/usr/bin/env bash
#
# Cat-3 "at scale" dataset builder — reproducible 10x load-test fixture.
#
# WHY THIS EXISTS
#   At the locked snapshot (627 docs) the list queries run in <1ms, so the
#   payload-slim fix (drop `content` from /api/issues, `properties` from
#   /api/documents) only moves P95 by ~10-17% on /api/issues — the win is real
#   but masked by the tiny dataset. The audit's central thesis is that these
#   unbounded list endpoints "degrade ~linearly with scale". This script builds
#   the ~10x dataset on which that degradation — and the fix's benefit — is
#   visible well above run-to-run noise. The before/after Cat-3 measurement is
#   then run on THIS dataset (identical conditions for both halves).
#
# WHAT IT DOES (deterministic given a fresh snapshot)
#   1. Restores the locked snapshot (627 docs / 328 issues — condition of record).
#   2. Clones every non-deleted `issue` and `wiki` document 13x with fresh UUIDs.
#      - Only issue+wiki are cloned: those are the two endpoints under test.
#      - `person` docs are deliberately NOT cloned — duplicating them would create
#        duplicate `user_id` values and multiply the /api/issues assignee JOIN
#        (row explosion), corrupting the measurement.
#      - parent_id and ticket_number are nulled on clones (avoids deep trees and
#        any uniqueness assumptions; neither affects list-query cost).
#      - content + properties ARE copied verbatim, so per-row serialization cost
#        is realistic.
#
# RESULT  ~6,360 documents / ~4,592 issues (≈10x docs, ≈14x issues).
# RESET   `bash scripts/audit/db-restore.sh` returns to the 627-doc snapshot.
#
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
PG=ship-postgres-1

echo "Building 10x scale dataset (restore snapshot, then clone issue+wiki 13x)..."
bash "$DIR/db-restore.sh" >/dev/null

docker exec "$PG" psql -U ship -d ship_dev -v ON_ERROR_STOP=1 -q -c "
INSERT INTO documents (id, workspace_id, document_type, title, parent_id, position,
                       ticket_number, properties, content, created_at, updated_at,
                       created_by, visibility)
SELECT gen_random_uuid(), workspace_id, document_type,
       title || ' (scale ' || g || ')', NULL, position,
       NULL, properties, content, created_at, updated_at, created_by, visibility
FROM documents, generate_series(1, 13) AS g
WHERE document_type IN ('issue', 'wiki')
  AND deleted_at IS NULL AND archived_at IS NULL;
"

echo -n "Scaled condition: "
docker exec "$PG" psql -U ship -d ship_dev -tAc \
  "SELECT 'documents='||count(*)||' issues='||count(*) FILTER (WHERE document_type='issue')||' wikis='||count(*) FILTER (WHERE document_type='wiki') FROM documents WHERE deleted_at IS NULL AND archived_at IS NULL;"
