# ShipShape Audit — RUNBOOK (reproducible path)

> **Purpose.** Any engineer can replay this audit *exactly* from a clean clone.
> Every measurement is a committed script; every decision is logged with who
> made it and why. This file is the single source of truth for *how we got
> here*; `AUDIT_REPORT.md` is *what we found*; `docs/audit/raw/` is the raw
> evidence. Keep this file updated as work proceeds (append, don't rewrite).

## 1. Environment of record

| Item | Value |
|------|-------|
| Repo / branch | fork `github.com/Hvoegeli/ship` · branch `shipshape/audit` (off `master`) |
| Node / pnpm | v20.20.2 / 10.27.0 (corepack) |
| DB | PostgreSQL 16, Docker container `ship-postgres-1`, db `ship_dev`, user `ship` |
| OS / HW | macOS (Darwin 23.6.0), aarch64 |
| Dev servers | API `:3000` (direct — never the Vite proxy for measurement), Web `:5173` |
| Login used by harnesses | `dev@ship.local` / `admin123` (csrf-token → POST /api/auth/login) |
| Condition of record (**LOCKED, Decision #1b**) | Frozen snapshot `scripts/audit/snapshot/ship_dev.condition.dump` = **627 docs / 328 issues / 35 sprints / 31 users / 625 assoc**. Restore with `bash scripts/audit/db-restore.sh` (validated round-trip). Base `pnpm db:seed` is NOT idempotent (drifted 577→623→627) so the snapshot — not the seed — is the reproducible truth. |

## 2. One-time prerequisites (tooling only — NOT application code)

Run from repo root. These are measurement instruments / test data, allowed by
the PRD ("write your own seed script", "configure tooling if absent"):

1. `pnpm install`
2. Start stack so `:3000`/`:5173`/Postgres are up (project dev flow).
3. **Restore the locked condition of record** (preferred — exact & reproducible):
   `bash scripts/audit/db-restore.sh`
   *(First-time bootstrap only, if regenerating the snapshot from scratch: `pnpm db:seed` →
   `docker exec -i ship-postgres-1 psql -U ship -d ship_dev < scripts/audit/seed-augment.sql` →
   `docker exec ship-postgres-1 pg_dump -U ship -d ship_dev -Fc -Z6 -f /tmp/d && docker cp ship-postgres-1:/tmp/d scripts/audit/snapshot/ship_dev.condition.dump`)*
4. Playwright Chromium (Cat 6/7): `npx playwright install chromium`
5. Cat 4 only — enable PG statement logging, then revert after:
   `ALTER SYSTEM SET log_statement='all';` `ALTER SYSTEM SET log_min_duration_statement=0;`
   `ALTER SYSTEM SET log_line_prefix='%m [%p] ';` `SELECT pg_reload_conf();`
6. Cat 2 only — production build with sourcemaps (CLI flag only, no committed config change):
   `cd web && VITE_API_URL= npx vite build --sourcemap`
7. Lighthouse (Cat 7) is fetched on demand via `npx lighthouse@13` (cached).

## 3. Reproduce each category

Run from repo root; `<phase>` = `before` (audit) or `after` (Phase 2). Each
writes raw to `docs/audit/raw/catN-<phase>.txt` and prints the same to stdout.

| Cat | Command | Raw output | Baseline commit |
|-----|---------|-----------|-----------------|
| 1 Type Safety | `node scripts/audit/cat1-type-safety.mjs before` | `cat1-before.txt` | `fe4b76e` |
| 2 Bundle Size | *(prereq #6 first)* `node scripts/audit/cat2-bundle.mjs before` | `cat2-before.txt` | `7f7a5e2` |
| 3 API Response | `node scripts/audit/cat3-api.mjs before` | `cat3-before.txt` | `f09871b` |
| 4 DB Queries | *(prereq #5 first)* `node scripts/audit/cat4-db.mjs before` | `cat4-before.txt` | `7a975a0` |
| 5 Test Coverage | in-report protocol (`pnpm --filter @ship/api test` ×3) — see Decision #3b | `cat5-before.txt` | `02ae6e8` |
| 6 Runtime Errors | `node scripts/audit/cat6-runtime.mjs before` (7 probes) | `cat6-before.txt` | `61aae8a` (+ #4b) |
| 7 Accessibility | `node scripts/audit/cat7-a11y.mjs before` **and** `node scripts/audit/cat7-lighthouse.mjs before` (3×/page median; commits JSON+HTML to `reports/a11y/before/`) | `cat7-before.txt`, `cat7-lighthouse-before.txt`, `reports/a11y/before/*.report.{json,html}` | `9fe25cd` / `8419aa7` |

Notes that matter for an exact replay:
- Cat 3 sleeps 62 s between endpoints (global rate limiter is 100/min prod, 1000/min dev) — full run is slow by design.
- Cat 6/7 instruments were **validated with controls** (RT1 online control; a11y unauthenticated `login` control; Probe 7 contiguous-marker fix). Do not "simplify" the controls away — they exist because earlier versions produced false results (see Decision Log).
- After Cat 4, revert PG logging (`ALTER SYSTEM RESET ...; SELECT pg_reload_conf();`) or Cat 3 latency is skewed.
- Cat 5 (`pnpm --filter @ship/api test`) **truncates `ship_dev`** — re-seed (prereq #3) afterward, or snapshot/restore (Decision #1).

## 4. Decision log

Status: ✅ decided & applied · 🔵 decided, pending work · ❓ OPEN (needs user).

| # | Decision | Who | Rationale | Status |
|---|----------|-----|-----------|--------|
| Orientation D1–DM | sprint→week naming debt promoted to a Discovery write-up | me, in notes | enum is still `sprint` (confirmed: `document_type` has no `week`) | ✅ `df9c938` |
| Methodology | build dependency-free reproducible `.mjs` harnesses (no autocannon/visualizer/Lighthouse-as-dep) since no analyzers were installed | me | PRD allows "or similar"; maximizes reproducibility | ✅ |
| "No fixing in audit" | only measurement tooling + test data + docs; zero app-code change | rule | verified `git diff master...HEAD` touches no `api/src` `web/src` `shared/src` | ✅ |
| Branch/commits | `shipshape/audit`, one discrete commit per logical step | PRD + user | commit discipline graded | ✅ |
| Unilateral call (corrected) | Cat 7 axe-substituted-for-Lighthouse without asking | me (error) | user flagged; should have asked | ✅ superseded by #2b |
| Unilateral call (corrected) | Cat 5 coverage "deferred" without asking | me (error) | user flagged; PRD says configure it | 🔵 #3b |
| Unilateral call (corrected) | Cat 6 dropped 2 PRD methods silently | me (error) | user flagged; plan hid the omission | ✅ superseded by #4b |
| #1 condition-of-record | snapshot/restore exact dataset **(b)** | user → (b) | base seed not idempotent; pinning makes the Phase-1 "reproducible" claim literally true | ✅ snapshot committed + `db-restore.sh` validated |
| #2b Cat 7 Lighthouse | run Lighthouse for real, not axe-only | user → (b) | PRD deliverable literally asks for it | ✅ `8419aa7` |
| #3b Cat 5 coverage | configure `@vitest/coverage-v8`@4.0.17 in api+web; add web `test:coverage` script | user → (b) | PRD: "if not configured, configure it" | ✅ api 40.52% lines / web 28.53% lines. Surfaced two NEW findings via #3b: (1) api tests not isolated from pre-state (8 fail on snapshot vs 0 on fresh seed); (2) web has 13/151 failing tests hidden by default `pnpm test`. |
| #4b Cat 6 probes | add stored-XSS + concurrent-edit probes | user → (b) | PRD "How to Measure" items | ✅ this commit |
| #5 timeline | Audit due **Wednesday noon**; early Fri; final Sun | user | the two brief PDFs disagreed; user resolved | ✅ recorded |
| LH-guide Q1 | Lighthouse: 3 runs/page → **median**; persist JSON+HTML to `reports/a11y/<phase>/` | user → recommended | ShipShape Lighthouse guide mandates it; we'd observed variance (main_docs 100/91/91) | ✅ applied |
| LH-guide Q2 | Keep the **same 6 pages** as Cat 6/axe (don't expand to editor-active/sprint/search) | user → recommended | apples-to-apples cross-tool comparison | ✅ |
| LH-guide Q3 | Screen-reader smoke test: A document-gap / B manual VoiceOver / C a11y-tree proxy | **user — OPEN** | explanation given; awaiting choice | ❓ awaiting user |
| Instrument validations | RT1 online-control; a11y login-control; Probe 7 contiguous-marker fix | me | a green/red result is not trusted until a control proves the instrument | ✅ documented in `AUDIT_REPORT.md` |

## 5. Chronological commit log (the path)

```
df9c938  orientation notes (Phase 0)
44f55d6  scaffold AUDIT_REPORT + harness
fe4b76e  cat1 type-safety baseline
7f7a5e2  cat2 bundle-size baseline
14d8734  seed-augment to rubric volume (condition of record)
7a975a0  cat4 DB query-efficiency baseline
f09871b  cat3 API response-time baseline
02ae6e8  cat5 test-coverage baseline
61aae8a  cat6 runtime-error baseline (5 probes)
9fe25cd  cat7 accessibility baseline (axe + keyboard)
367a05b  cross-category ranked findings; Phase-1 gate complete
1cb21e4  align findings-summary to PRD deliverable rows
f1788b4  add per-category improvement options to findings-summary
8419aa7  #2b cat7 Lighthouse scores added
<this>   #4b cat6 stored-XSS + concurrent-edit probes; RUNBOOK added
```

## 6. Open items

- ✅ **Decision #1b** — DONE: dataset pinned (`scripts/audit/snapshot/ship_dev.condition.dump`), `db-restore.sh` validated.
- ✅ **#3b** — DONE: coverage tooling configured in api + web; numbers reported in Cat 5; raw in `docs/audit/raw/cat5-before.txt`; two new findings surfaced (test isolation, hidden web failures).
- ❓ **LH-guide Q3** — screen-reader smoke test (A/B/C): **DEFERRED by user**, revisit before end of today.
- Phase-2 / final deliverables (not Phase-1 gate): Improvement Documentation, Discovery write-up polish, Demo video, AI Cost Analysis, Social post, Deployed fork.
