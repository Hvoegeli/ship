# Audit Harness — reproducible baselines

Every measurable category has one script here. Each script:
1. Records environment of record (commit SHA, seed counts, date) to docs/audit/raw/
2. Produces the baseline numbers for AUDIT_REPORT.md
3. Is re-run UNCHANGED in Phase 2 for the "after" measurement (identical conditions)

| Script | Category | Status |
|--------|----------|--------|
| cat1-type-safety.sh | 1 Type Safety | pending |
| cat2-bundle.sh | 2 Bundle Size | pending |
| cat3-api.sh | 3 API Response Time | pending |
| cat4-db.sh | 4 DB Query Efficiency | pending |
| cat5-tests.sh | 5 Test Coverage | pending |
| cat6-runtime.md | 6 Runtime Errors (manual protocol) | pending |
| cat7-a11y.sh | 7 Accessibility | pending |

Run convention: `scripts/audit/catN-*.sh` writes raw output to `docs/audit/raw/catN-<phase>.txt`
where <phase> = `before` (audit) or `after` (post-implementation).
