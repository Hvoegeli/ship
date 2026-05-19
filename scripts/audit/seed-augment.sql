-- Cat 3/4 measurement condition: realistic data volume.
--
-- The deck requires 500+ documents and 20+ users; default `pnpm db:seed`
-- yields ~257 docs / 11 users. This is TEST DATA ONLY — it inserts rows,
-- it does NOT modify any application code. Deck explicitly permits
-- "write your own seed script" for Cat 3.
--
-- DETERMINISTIC + IDEMPOTENT: deletes prior AUDIT-tagged rows, then inserts
-- a FIXED count. Re-running (audit "before" and Phase-2 "after") yields the
-- identical volume → valid before/after comparison.
--
-- Tag conventions:  users.email LIKE 'audituser%@ship.local'
--                    documents.title LIKE 'AUDIT-%'
-- Run: docker exec -i ship-postgres-1 psql -U ship -d ship_dev < scripts/audit/seed-augment.sql

\set ON_ERROR_STOP on
BEGIN;

-- Anchors (single-workspace dev DB)
\set ws  '(SELECT id FROM workspaces ORDER BY created_at LIMIT 1)'
\set adm '(SELECT user_id FROM workspace_memberships WHERE role=''admin'' ORDER BY created_at LIMIT 1)'
\set prog '(SELECT id FROM documents WHERE document_type=''program'' ORDER BY created_at LIMIT 1)'

-- 1) Clean prior augmentation (makes the script idempotent/deterministic)
DELETE FROM document_associations
 WHERE document_id IN (SELECT id FROM documents WHERE title LIKE 'AUDIT-%');
DELETE FROM documents WHERE title LIKE 'AUDIT-%';
DELETE FROM workspace_memberships
 WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'audituser%@ship.local');
DELETE FROM users WHERE email LIKE 'audituser%@ship.local';

-- 2) +20 users  (11 default + 20 = 31  >= 20 bar)
WITH new_users AS (
  INSERT INTO users (email, name, password_hash, created_at, updated_at)
  SELECT 'audituser' || g || '@ship.local',
         'Audit User ' || g,
         (SELECT password_hash FROM users WHERE password_hash IS NOT NULL LIMIT 1),
         now(), now()
  FROM generate_series(1, 20) g
  RETURNING id
)
INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at, updated_at)
SELECT :ws, id, 'member', now(), now() FROM new_users;

-- 3) +320 documents  (257 default + 320 = 577  >= 500 bar)
--    Mix: ~70% issues (realistic properties), ~30% wiki, all in the workspace.
WITH base AS (SELECT COALESCE(MAX(ticket_number), 0) AS maxt FROM documents)
INSERT INTO documents
  (workspace_id, document_type, title, created_by, ticket_number, properties)
SELECT :ws,
       (CASE WHEN g % 10 < 7 THEN 'issue' ELSE 'wiki' END)::document_type,
       'AUDIT-' || lpad(g::text, 4, '0') || ' ' ||
         (CASE WHEN g % 10 < 7 THEN 'load-test issue' ELSE 'load-test wiki page' END),
       :adm,
       (CASE WHEN g % 10 < 7 THEN (SELECT maxt FROM base) + g ELSE NULL END),
       (CASE WHEN g % 10 < 7
             THEN jsonb_build_object(
                    'state', (ARRAY['backlog','todo','in_progress','done'])[1 + g % 4],
                    'priority', (ARRAY['low','medium','high','urgent'])[1 + g % 4],
                    'source', 'internal')
             ELSE '{}'::jsonb END)
FROM generate_series(1, 320) g;

-- 4) Associate the AUDIT issues to a program (exercises the join paths)
INSERT INTO document_associations (document_id, related_id, relationship_type)
SELECT d.id, :prog, 'program'
FROM documents d
WHERE d.title LIKE 'AUDIT-%' AND d.document_type = 'issue'
ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING;

COMMIT;

-- Report the condition of record
SELECT 'documents=' || count(*) FROM documents
UNION ALL SELECT 'issues=' || count(*) FROM documents WHERE document_type='issue'
UNION ALL SELECT 'sprints=' || count(*) FROM documents WHERE document_type='sprint'
UNION ALL SELECT 'associations=' || count(*) FROM document_associations
UNION ALL SELECT 'users=' || count(*) FROM users;
