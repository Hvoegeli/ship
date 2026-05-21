# ShipShape — Improvement Log & Findings Resolution (Phase 2)

> **Purpose.** A single, reproducible record of **every change we make in Phase 2** and **how each audit
> finding is resolved**. For each category the brief requires: *before measurement → root cause → fix →
> after measurement → proof of reproducibility.* This file is that deliverable **and** a running change log.
>
> **Companion docs:** findings live in [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md) (+ `S#` in
> [`SUPPLEMENTARY-FINDINGS.md`](SUPPLEMENTARY-FINDINGS.md)); the fix plan is
> [`REMEDIATION-PLAN.md`](REMEDIATION-PLAN.md); the execution checklist is
> [`PHASE2-TASKLIST.md`](PHASE2-TASKLIST.md); the exact replay path is [`RUNBOOK.md`](RUNBOOK.md).

## How to reproduce any result in this file (from a clean clone)

```bash
pnpm install
# bring the stack up (Docker Postgres `ship-postgres-1`, API :3000, web :5173)
bash scripts/audit/db-restore.sh        # restore the LOCKED snapshot: 627 docs / 328 issues / 35 sprints / 31 users
```
Then, for any category, run its harness in `before` (at the pre-Phase-2 commit) and `after` (post-fix) modes —
each writes raw output to `docs/audit/raw/catN-<phase>.txt`:

| Cat | Harness (before/after) | Notes |
|-----|------------------------|-------|
| 1 | `node scripts/audit/cat1-type-safety.mjs <phase>` | TS Compiler API count |
| 2 | `node scripts/audit/cat2-bundle.mjs <phase>` | prereq: `cd web && VITE_API_URL= npx vite build --sourcemap` |
| 3 | `node scripts/audit/cat3-api.mjs <phase>` | API :3000 direct; 62 s rate-limit gaps |
| 4 | `node scripts/audit/cat4-db.mjs <phase>` | prereq: PG `log_statement='all'` (see below); revert after |
| 5 | `pnpm db:seed` → `pnpm --filter @ship/api test` | fresh seed (api tests aren't isolated from pre-state); restore snapshot after |
| 6 | `node scripts/audit/cat6-runtime.mjs <phase>` | malformed-input matrix + probes |
| 7 | `node scripts/audit/cat7-a11y.mjs <phase>` + `cat7-lighthouse.mjs` + `cat7-sr-tree.mjs` | |
| 8 | `node scripts/audit/cat8-security.mjs <phase>` *(to be built)* | active security probe |

**Enable/revert PG query logging (Cat 4)** — each `ALTER SYSTEM` must be its own statement (it cannot run inside a transaction):
```bash
docker exec ship-postgres-1 psql -U ship -d ship_dev -X \
  -c "ALTER SYSTEM SET log_statement='all'" \
  -c "ALTER SYSTEM SET log_min_duration_statement=0" \
  -c "ALTER SYSTEM SET log_line_prefix='%m [%p] '" -c "SELECT pg_reload_conf()"
# ... run cat4-db.mjs ... then:
docker exec ship-postgres-1 psql -U ship -d ship_dev -X \
  -c "ALTER SYSTEM RESET log_statement" -c "ALTER SYSTEM RESET log_min_duration_statement" \
  -c "ALTER SYSTEM RESET log_line_prefix" -c "SELECT pg_reload_conf()"
```

---

## Findings → Resolution (master status table)

Status: ✅ resolved (with before/after proof) · 🔵 in progress · ⚪ planned · ⚫ scoping note (intentionally not fixed).

| Finding | Cat | Severity | Target | Status | Proof |
|---------|-----|----------|--------|--------|-------|
| Grader F1 — severity rubric not in audit body | docs | — | rubric visible without cross-ref | ✅ `853d3a2` | AUDIT_REPORT § Ranked Findings |
| Grader F2 — EXPLAIN plans not inline | 4/docs | — | plan trees in report | ✅ `853d3a2` | AUDIT_REPORT § Cat 4 |
| **H2** — per-request `last_activity` write (auth query tax) | 4 | High | −20% queries on ≥1 flow | ✅ this commit | `cat4-db.mjs` (4→3 etc., below); −20–25% on all 5 flows |
| H1 — two unbounded list endpoints, P95 grows w/ load | 3 | High | −20% P95 on ≥2 endpoints | ⚪ planned | `cat3-api.mjs` |
| H3 — 91.6% of JS in one entry chunk | 2 | High | −20% initial bundle | ⚪ planned | `cat2-bundle.mjs` |
| H4 — auto-modal occludes authed pages (escapable) | 7 | High | 0 Critical/Serious top-3 | ⚪ planned | `cat7-*.mjs` |
| H5 — 852 type escape hatches, no linter | 1 | High | −25% violations | ⚪ planned | `cat1-type-safety.mjs` |
| H6 — `/e2e-test-runner` skill missing | 5 | High | implement runner | ⚪ planned | `test-results/summary.json` |
| H7 — README 508/WCAG AA overclaim | 7 | High | substantiate/retract | ⚪ planned | `cat7-lighthouse.mjs` |
| H8 — unvalidated input → 500 / HTML stack traces | 6 | High | input validation + JSON envelope | ⚪ planned | `cat6-runtime.mjs` |
| M1 — rate limiter 100/min prod | 3 | Med | (availability note) | ⚪ planned | `cat3-api.mjs` |
| M2 — no pagination anywhere | 3/4 | Med | pagination | ⚪ planned (with H1) | `cat3`/`cat4` |
| M3 — no Content-Type enforcement (junk-doc 201) | 6 | Med | reject wrong type | ⚪ planned | `cat6-runtime.mjs` |
| M4 — 15 contrast AA failures on `/my-week` | 7 | Med | clear 4.5:1 | ⚪ planned | `cat7-a11y.mjs` |
| M5 — `aria-required-children` + `listitem` | 7 | Med | fix ARIA | ⚪ planned | `cat7-a11y.mjs` |
| M6 — `pnpm test` runs only api | 5 | Med | surface web tests | ⚪ planned | `cat5` |
| M7 — unit tests truncate `ship_dev` | 5 | Med | isolated test DB | ⚪ planned | observed |
| M8 — server persist swallows failures (RT1 residual) | 6 | Med | surface failure | ⚪ planned (with S4) | `cat6-runtime.mjs` |
| **(new) test-isolation: leaked `mockResolvedValueOnce`** | 5 | Med | mocks reset between tests | ✅ this commit | `pnpm --filter @ship/api test` → 451/451 |
| S1 — migration 033 fails on fresh DB | 4/build | High | guard RENAMEs | ⚪ planned (supplemental) | drop DB + `migrate.js` |
| S2 — soft-delete leak (backlinks/dashboard/weeks) | 4/6 | High | shared active filter | ⚪ planned (supplemental) | trash issue, reload |
| S3 — hot JSONB filters unindexed | 4 | High | expression indexes | ⚪ planned (supplemental; strengthens Cat 4 speed) | `EXPLAIN ANALYZE` |
| S4 — SIGTERM drops in-flight saves | 6 | High | shutdown flush | ⚪ planned (supplemental; = Cat 6 data-loss) | `kill -TERM` mid-edit |
| S5 — client failures masquerade as success | 6 | Med | toast pipeline | ⚪ planned | static |
| S6 — WS broadcast O(all), no backpressure/heartbeat | 3/scale | Med | (scaling) | ⚪ planned | static |
| S7 — no route code-split; poll; no virtualization | 2 | Med | route lazy (with H3) | ⚪ planned | `cat2-bundle.mjs` |
| S8 — `deleted_at` absent from shared `Document` type | 1 | Med | add to type | ⚪ planned (with Cat 1) | `type-check` |
| S9 — `lint` script is a no-op | 1/5 | Med | real eslint gate | ⚪ planned (with Cat 1) | `pnpm lint` |
| S10 — E2E flake surface (628 hard-waits, FIXME) | 5 | Med | state-based waits | ⚪ planned | re-run ×3 |
| S11 — dead dependency confirmed | 2 | Low | remove | ⚪ planned | `cat2-bundle.mjs` |
| S12 — persisted cache not identity-scoped | sec/8 | High | buster + clear on logout | ⚪ planned (Cat 8 fix candidate) | `cat8-security.mjs` |
| S13 — no CI pipeline | ops | Med | GitHub Actions gate | ⚪ planned (supplemental) | — |
| S14 — non-hermetic/root prod Docker | ops/sec | Med | multi-stage, USER, HEALTHCHECK | ⚪ planned (supplemental) | build |
| S15 — committed deploy bundles (no secrets) | hygiene | Med | `git rm` + ignore | ⚪ planned (supplemental) | `git ls-files` |
| L1–L6 — positives / scoping notes | 1–7 | Low | *not fixed by design* | ⚫ scoping | AUDIT_REPORT § Low |
| **Cat 8 — security probe + baseline + ≥2 fixes** | 8 | — | build tool; fix ≥2 vulns | ⚪ planned (NEW category) | `cat8-security.mjs` |

---

## Change log (chronological — newest at bottom)

### 2026-05-21 · `853d3a2` — Grader feedback F1 + F2 *(docs only)* ✅
- **F1 (severity rubric):** added a High/Med/Low criteria block to `AUDIT_REPORT.md` § Ranked Findings so the ranking yardstick is visible without opening the orientation notes (whose scale is setup-specific). **Files:** `AUDIT_REPORT.md`. **Proof:** visible in the report body.
- **F2 (EXPLAIN ANALYZE inline):** replaced the Cat 4 prose plan summary with the **actual plan trees** for the two slowest list queries, captured live against the snapshot. The issues plan confirms **S3** (Seq Scan on `documents` + unindexed JSONB `->>'assignee_id'` hash join). **Files:** `AUDIT_REPORT.md`. **Reproduce:** see the `EXPLAIN ANALYZE` block in the report; SQL = the real `documents.ts` / `issues.ts` list queries.

### 2026-05-21 · (this commit) — Cat 4: throttle the per-request `last_activity` write ✅
- **Finding (H2):** every authenticated request ran `UPDATE sessions SET last_activity = $1` — 2 of every 4–5 queries per flow were auth overhead.
- **Root cause:** `api/src/middleware/auth.ts` wrote `last_activity` **unconditionally** on every request (the line right below it *already* throttled the cookie refresh to 60 s, but the DB write was not throttled).
- **Fix:** move the `UPDATE` behind the same 60 s "touch-coalescing" gate as the cookie refresh — write at most once per 60 s of activity. The 15-minute idle timeout is unaffected (60 s resolution is negligible vs a 15-min window; worst case the session expires ≤60 s early, which is safe). **Files:** `api/src/middleware/auth.ts`.
- **Before → After** (query count per flow, `cat4-db.mjs`, snapshot-pinned):

  | Flow | Before | After | Δ |
  |------|--------|-------|---|
  | main_page | 4 | 3 | −25% |
  | view_document | 4 | 3 | −25% |
  | list_issues | 5 | 4 | −20% |
  | sprint_board | 5 | 4 | −20% |
  | search | 5 | 4 | −20% |

  Target ("−20% on ≥1 flow") **met on all 5**. Raw: `docs/audit/raw/cat4-before.txt` (before) / `cat4-after.txt` (after). `UPDATE sessions` no longer appears in any flow's query set.
- **Tests:** exposed a latent **test-isolation defect** (see next entry), now fixed in the same commit; full api suite is green (451/451) on a fresh seed.
- **Reproduce:** restore snapshot → enable PG logging (above) → `node scripts/audit/cat4-db.mjs after` → compare to `cat4-before.txt` → revert PG logging.

### 2026-05-21 · (this commit) — Cat 5 finding surfaced by Cat 4: leaked mock state between tests ✅
- **What:** `api/src/__tests__/auth.test.ts` used `vi.clearAllMocks()` in `beforeEach`, but `clearAllMocks` does **not** flush the `mockResolvedValueOnce` queue. The "attaches session info" test queues **3** `pool.query` responses; after the Cat-4 fix the middleware makes only **2** calls (the `UPDATE` is skipped at `inactivityMs≈0`), leaving 1 queued response that **leaks into a later test** and corrupts it (e.g. the API-token test reads the wrong queued row → `userId` undefined). This is a real test-quality bug (relates to **M7 / Cat 5**) that the optimization merely *revealed*.
- **Fix:** switched `beforeEach` to `vi.resetAllMocks()`, which flushes the once-queue between tests so a leftover queued response can't bleed forward. No test relies on a persistent default implementation, so the reset is safe.
- **Verify:** `pnpm db:seed` → `pnpm --filter @ship/api test` → **451/451 passed** (28 files), then `bash scripts/audit/db-restore.sh` to return to the condition of record. Done.
- **Status:** ✅ resolved.
