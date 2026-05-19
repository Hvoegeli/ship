# Audit Harness — reproducible baselines

Every measurable category has one script here. Each script:
1. Records environment of record (commit SHA, seed counts, date) to docs/audit/raw/
2. Produces the baseline numbers for AUDIT_REPORT.md
3. Is re-run UNCHANGED in Phase 2 for the "after" measurement (identical conditions)

| Script | Category | Status |
|--------|----------|--------|
| cat1-type-safety.mjs | 1 Type Safety | done (before) |
| cat2-bundle.mjs | 2 Bundle Size | done (before) |
| cat3-api.mjs | 3 API Response Time | done (before) |
| cat4-db.mjs | 4 DB Query Efficiency | done (before) |
| cat5-tests (in-report protocol) | 5 Test Coverage | done (before) |
| cat6-runtime.mjs | 6 Runtime Errors (Playwright browser harness) | done (before) |
| cat7-a11y.mjs | 7 Accessibility (axe + keyboard, validated control) | done (before) |
| cat7-lighthouse.mjs | 7 Accessibility (Lighthouse score/page, authed) | done (before) |

Run convention: `node scripts/audit/catN-*.mjs <phase>` writes raw output to
`docs/audit/raw/catN-<phase>.txt` where <phase> = `before` (audit) or `after`
(post-implementation). Scripts are re-run UNCHANGED in Phase 2.

Cat 6 one-time repro prerequisite (tooling only, not app code, analogous to
Cat 2 `vite build` / Cat 4 `ALTER SYSTEM`): `npx playwright install chromium`.
