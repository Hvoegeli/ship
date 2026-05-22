-- Rename sprint-related document types to week terminology
-- Part of Sprint → Week rename refactor

-- Rename document_type enum values
-- PostgreSQL 10+ supports ALTER TYPE ... RENAME VALUE, but there is no
-- "RENAME VALUE IF EXISTS". On a FRESH database, schema.sql already declares the
-- enum with the FINAL values (weekly_plan/weekly_retro/weekly_review), so a bare
-- RENAME of the old 'sprint_*' value raises "... is not an existing enum value"
-- and migrate.ts (which only swallows "already exists") aborts provisioning (S1).
-- Guard each rename so it runs only when the old value still exists — a no-op on
-- both already-migrated AND fresh databases, making the migration idempotent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
             WHERE t.typname = 'document_type' AND e.enumlabel = 'sprint_plan') THEN
    ALTER TYPE document_type RENAME VALUE 'sprint_plan' TO 'weekly_plan';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
             WHERE t.typname = 'document_type' AND e.enumlabel = 'sprint_retro') THEN
    ALTER TYPE document_type RENAME VALUE 'sprint_retro' TO 'weekly_retro';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
             WHERE t.typname = 'document_type' AND e.enumlabel = 'sprint_review') THEN
    ALTER TYPE document_type RENAME VALUE 'sprint_review' TO 'weekly_review';
  END IF;
END$$;

-- Note: We keep 'sprint' as a document_type because it represents the sprint document itself.
-- The terminology change is "Sprint 3" → "Week of Jan 27" in UI, but the underlying
-- document concept remains valid. The sprint document stores sprint_number and owner_id
-- for derived 7-day windows.

-- Update accountability_type values in issue properties
-- Sprint-related accountability types become week-related
UPDATE documents
SET properties = jsonb_set(properties, '{accountability_type}', '"weekly_plan"')
WHERE properties->>'accountability_type' = 'sprint_plan';

UPDATE documents
SET properties = jsonb_set(properties, '{accountability_type}', '"weekly_review"')
WHERE properties->>'accountability_type' = 'sprint_review';

UPDATE documents
SET properties = jsonb_set(properties, '{accountability_type}', '"week_start"')
WHERE properties->>'accountability_type' = 'sprint_start';

UPDATE documents
SET properties = jsonb_set(properties, '{accountability_type}', '"week_issues"')
WHERE properties->>'accountability_type' = 'sprint_issues';
