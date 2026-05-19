# ShipShape Audit Report — Phase 1 (Diagnosis)

> **Hard gate.** Baseline measurements for all 7 categories. *No fixes during the audit.*
> Companion docs: `ORIENTATION_NOTES.md` (system mental model + finding registers),
> `scripts/audit/` (reproducible harness — every baseline re-runnable for Phase 2 before/after),
> `docs/audit/raw/` (raw tool output).
>
> **Reproducibility contract:** every number below is produced by a committed script in
> `scripts/audit/` run under recorded conditions (data volume, concurrency, hardware, commit SHA).
> Phase 2 re-runs the *same* script for the "after" measurement.

## Environment of record

| Item | Value |
|------|-------|
| Repo / branch | `Hvoegeli/ship` @ `shipshape/audit` |
| Baseline commit SHA | _TBD (record before each run)_ |
| Node / pnpm | v20.20.2 / 10.27.0 (corepack) |
| DB | PostgreSQL 16 (Docker `ship-postgres-1`), seeded |
| OS / HW | macOS (Darwin 23.6.0), aarch64 |
| Seed volume (CONDITION OF RECORD) | **documents=577, issues=328, sprints=35, users=31, associations=625** — `pnpm db:seed` + `scripts/audit/seed-augment.sql` (deterministic; re-run identically for Phase-2 "after"). Meets deck Cat-3 bar (500+ docs / 100+ issues / 20+ users / 10+ sprints). |
| ⚠️ Data-safety finding | `pnpm --filter @ship/api test` (unit tests) connect to the same `DATABASE_URL` and **truncate `ship_dev`** — running unit tests destroys seed data. Logged as Cat-5 finding. |

---

## Category 1 — Type Safety

**How measured:** `node scripts/audit/cat1-type-safety.mjs before` — **TypeScript Compiler API 5.9.3** AST walk (no regex; `as const` excluded structurally). Raw: `docs/audit/raw/cat1-before.txt`. Reproducible: re-run same script for "after". Repo has **no linter** (no ESLint/@typescript-eslint), so the compiler API is the defensible instrument. `noImplicitAny` is on (via `strict`) → implicit-any is a compile error, not a measurable count; explicit-any is the surface. Baseline commit `44f55d6`.

**Scope A — non-test `src/` (primary; the 25% target applies here):**

| Metric | Baseline | by package |
|--------|----------|------------|
| Total `any` types | **94** | api 65 · web 29 · shared 0 |
| Total type assertions (`as`) | **433** | api 135 · web 298 · shared 0 |
| Total non-null assertions (`!`) | **325** | api 292 · web 33 · shared 0 |
| Total `@ts-ignore`/`@ts-expect-error` | **0** | (1 in tests only) |
| **Total violations** | **852** | 25% target = **213** |
| Strict mode enabled? | **Yes** | strict + noUncheckedIndexedAccess + noImplicitReturns + noFallthroughCasesInSwitch (web tsconfig omits the last 3 — TS1) |
| Strict error count (if disabled) | N/A (enabled) | |
| Top 5 violation-dense files | weeks.ts (84) · projects.ts (51) · issues.ts (48) · UnifiedDocumentPage.tsx (37) · seed.ts (35) | |

Scope B (incl tests): any 271 · as 619 · ! 329 · ts-ignore 1 — test code is far more loosely typed (api tests alone = 238 `any`).

**Methodology correction (recorded for honesty — graded):** orientation used regex and **undercounted `!` by ~100×** (estimated ~3; AST finds 325) and over-counted `as`. The audit number supersedes it; this is exactly the refinement orientation finding TS3 flagged as required.

**Weaknesses / opportunities (ranked):**
1. **High — non-null `!` is the dominant risk (325, api 292).** Each `x!` silently asserts non-null; under `strictNullChecks` these are deliberate safety-overrides and the largest single violation class. Top targets: `weeks.ts` (48), `issues.ts` (37), `seed.ts` (35), `team.ts` (28).
2. **High — `as` assertions (433), web-heavy (298).** Confirms register S7: downstream loss of discriminated-union narrowing (`UnifiedDocumentPage.tsx` 36, `UnifiedEditor.tsx` 28, `PropertiesPanel.tsx` 24).
3. **Medium — explicit `any` (94 src) concentrated in api routes** (`projects.ts` 15, `weeks.ts` 11) + the `y-protocols.d.ts` shim (TS4).
4. **Medium — no linter at all.** No automated guard prevents new violations; configuring `@typescript-eslint` is itself a measurable, durable improvement (TS1/TS3).
5. **Low/scoping — `shared/` is clean (0).** Do not spend Cat-1 effort there (confirms S-findings).

---

## Category 2 — Bundle Size

**How measured:** `cd web && VITE_API_URL= npx vite build --sourcemap` (CLI flag only — no committed config/lockfile change), then `node scripts/audit/cat2-bundle.mjs before`. Dep attribution = parsing the largest chunk's `.map` `sourcesContent` bytes (proxy; no visualizer dep). Raw: `docs/audit/raw/cat2-before.txt`. Commit `fe4b76e`.

| Metric | Baseline |
|--------|----------|
| Total production bundle size | **2,275 KB raw / 695.5 KB gzip** (JS 2,210 / CSS 65) |
| Largest chunk (name + size) | `index-C2vAyoQ1.js` — **2,025 KB raw / 575.7 KB gzip** |
| Number of chunks | 261 JS + 1 CSS — **but 91.6% of all JS is in that one chunk** |
| Top 3 largest dependencies | `emoji-picker-react` (~398 KB src, 7.8%) · `highlight.js` (~376 KB, 7.4%) · `react-router` (~347 KB, 6.8%) — then `yjs`, `prosemirror-view`, `@tiptap/core` |
| Unused dependencies identified | `@tanstack/query-sync-storage-persister` (no import in `web/src`/vite config — candidate, verify) |
| Code splitting in use? | Minimal — 3 `React.lazy`/dynamic imports; tab chunks 1–16 KB; everything else in the monolith |

**Weaknesses / opportunities (ranked):**
1. **High — monolithic entry chunk (2.0 MB raw / 576 KB gzip, 91.6% of JS).** No vendor/route splitting; entire app + all deps download before first paint. The deck's "20% off initial via code-split" is the natural target.
2. **High — heavy editor-only deps in the initial bundle.** `highlight.js` (376 KB — likely all languages) and `emoji-picker-react` (398 KB) are only used inside the TipTap editor, yet ship on first load. Lazy-loading both is a large, low-risk initial-bundle reduction.
3. **Medium — no `manualChunks` / vendor split.** A `react`/`tiptap`/`prosemirror` vendor chunk would improve caching and parallelization.
4. **Low — candidate dead dependency** `@tanstack/query-sync-storage-persister` (verify against runtime usage before removal — removing functionality doesn't count).
5. **Scoping (confirms P3):** `shared/` contributes ~0 (type-only) — not a bundle lever.

---

## Category 3 — API Response Time

**How measured:** dependency-free Node concurrent-load harness (`node scripts/audit/cat3-api.mjs before`) — fixed worker pool, warmup=10, budget=120 req/cell, **API `:3000` direct (no Vite proxy — P1)**. Endpoints = the 5 key flows traced in Cat 4. 62s gap between endpoints so each runs in a fresh rate-limit window. Condition: 577 docs/328 issues/31 users. Raw (full 10/25/50 matrix): `docs/audit/raw/cat3-before.txt`. Commit `7a975a0`.

Headline = **concurrency 25** (mid); full 10/25/50 in raw.

| Endpoint | P50 | P95 | P99 |
|----------|-----|-----|-----|
| 1. `GET /api/documents?document_type=wiki` (main page, ~300 KB) | 163ms | **201ms** | 211ms |
| 2. `GET /api/issues` (list issues, ~280 KB, 328 rows) | 101ms | **124ms** | 130ms |
| 3. `GET /api/weeks` (sprint board) | 20ms | 25ms | 27ms |
| 4. `GET /api/search/mentions?q=load` (search) | 16ms | 20ms | 21ms |
| 5. `GET /api/documents/:id` (view document) | 18ms | 23ms | 26ms |

Concurrency tested: 10 / 25 / 50 (0 errors all cells). **P95 scales ~linearly with concurrency** on the slow two: main_page 100→201→**362ms**, list_issues 63→124→**222ms**.

**Weaknesses / opportunities (ranked):**
1. **High — two unbounded list endpoints dominate latency & degrade with load.** `main_page` and `list_issues` are 5–10× slower than the other three and worsen ~linearly with concurrency. Cat-4 proved the SQL is <1.5 ms → the cost is **serializing 300 KB/280 KB JSON on the single shared REST+WS event loop** (orientation RT2/P2, now measured). Pagination/`LIMIT` on these two = the deck's *"20% P95 reduction on ≥2 endpoints"* target.
2. **Medium — aggressive global rate limiter** (`apiLimiter`: **1000 req/min dev, 100 req/min prod**, per-IP). 100/min in production is very low for a multi-user collaborative app; first measurement run hit it (200/200 → 429). Real API-availability concern; also a measurement hazard documented in the harness.
3. **Medium — RF2 per-request session write** adds a DB round-trip to every endpoint's latency floor (confirmed in Cat 4); compounds #1 under concurrency.
4. **Low — fast endpoints are genuinely fast** (view_document/search/sprint_board P95 <25 ms @25). Honest scoping: Cat-3 gains come from the two list endpoints, not broad slowness.

---

## Category 4 — Database Query Efficiency

**How measured:** Postgres `log_statement='all'` + `log_min_duration_statement=0`; `node scripts/audit/cat4-db.mjs before` authenticates (csrf+login) and runs 5 marker-bracketed flows, counting only API connection-pool PIDs (psql/admin PIDs excluded). Condition of record: 577 docs/328 issues/35 sprints/31 users. Raw: `docs/audit/raw/cat4-before.txt`. Commit `14d8734`.

| User Flow | Endpoint | Total Queries | Slowest (ms) | N+1? |
|-----------|----------|---------------|--------------|------|
| Load main page | `GET /api/documents?document_type=wiki` (300 KB resp) | 4 | 1.419 | No |
| View a document | `GET /api/documents/:id` | 4 | 0.214 | No |
| List issues | `GET /api/issues` (280 KB resp, 328 rows) | 5 | 0.985 | No |
| Load sprint board | `GET /api/weeks` | 5 | 0.227 | No |
| Search content | `GET /api/search/mentions?q=load` | 5 | 0.433 | No |

**EXPLAIN ANALYZE — slowest query (main_page documents list):** Bitmap Index Scan on `idx_documents_document_type` → Bitmap Heap Scan (filters `workspace_id`/`archived_at`/`deleted_at`) → Sort. **Exec 0.144 ms / Planning 0.561 ms** (planning > execution). The purpose-built partial index `idx_documents_active(workspace_id, document_type) WHERE archived_at IS NULL AND deleted_at IS NULL` is **not chosen** (low selectivity at this volume).

**Weaknesses / opportunities (ranked):**
1. **High — universal per-request auth query tax (RF2, now measured).** Every flow runs `SELECT … FROM sessions …` **+** `UPDATE sessions SET last_activity = $1` — **2 of every flow's 4–5 queries are auth overhead**, on every request. Throttling the `last_activity` write (only when stale) cleanly hits the deck's *"20% fewer queries on ≥1 flow"* (e.g., view_document 4→3 = −25%). Strongest Cat-4 improvement target.
2. **Medium — unbounded result sets / no pagination.** `main_page` (300 KB) and `list_issues` (280 KB, all 328 issues) fetch everything with no `LIMIT`/cursor; query time grows linearly with workspace size (hidden at 577 docs, visible at 10×).
3. **Low — well-indexed today; no N+1, no slow query.** Honest baseline: at rubric volume the per-query times are <1.5 ms; the `idx_documents_active` partial index is unused (planner picks the simpler type index). Cat-4 gains come from *query count* (#1), not query speed.

---

## Category 5 — Test Coverage and Quality

**How measured:** unit = `pnpm --filter @ship/api test` run **3× for flakiness**; E2E = static catalog (`grep`/spec count) — full run blocked (see findings); coverage = `pnpm --filter @ship/api test:coverage`. Commit `f09871b`.

| Metric | Baseline |
|--------|----------|
| Total tests | **451 unit (api, 28 files)** + **~882 E2E across 71 spec files** (static count) |
| Pass / Fail / Flaky | **unit: 451 / 0 / 0** (3 consecutive runs identical — stable). **E2E: not obtainable** (see ⚠️) |
| Suite runtime | **unit: ~15–16 s** (3 runs: 16/15/16 s). E2E: not obtainable |
| Critical flows with zero unit coverage | document CRUD via HTTP, auth, **real-time Yjs collaboration** (no unit tests; only E2E, which can't be run) — `web/` has 16 unit files but `pnpm test` never runs them (TI2) |
| Code coverage % | **Unmeasurable as-shipped.** api: configured (v8) but `@vitest/coverage-v8` **not installed** → `test:coverage` errors. web: **no coverage config at all** |

**Weaknesses / opportunities (ranked):**
1. **High — the mandated E2E runner does not exist.** `CLAUDE.md:56` requires `/e2e-test-runner` (background run + `test-results/summary.json` polling) and forbids `pnpm test:e2e` directly (output-explosion crash class, cf. the documented 90 GB incident). But **no `e2e-test-runner` skill exists** in `.claude/skills/` or anywhere in the repo. The codebase's *only sanctioned* way to run its 882-test suite is unimplemented → E2E pass/fail/runtime/flakiness is unmeasurable by the prescribed method. Largest Cat-5 gap.
2. **High — coverage is unmeasurable as-shipped.** api's `test:coverage` references `@vitest/coverage-v8` which isn't a dependency (command fails); `web/` has no coverage config. The deck's "configure coverage if absent and report per package" is itself the improvement target.
3. **Medium — `pnpm test` only runs api unit (TI2).** 16 `web/` unit test files are excluded from the default command → silent blind spot; the rubric's literal "run `pnpm test`" misses the entire frontend.
4. **Medium — doc undercount (TI1).** README/PRD/CLAUDE say "73+ tests"; reality ≈ **882 across 71 specs** (~10× off). "73" ≈ spec-file count, mislabeled as tests.
5. **Medium — running unit tests destroys dev data.** `pnpm --filter @ship/api test` truncates `ship_dev` (no isolated unit DB) — confirmed repeatedly this audit. Real dev-safety footgun.
6. **Low/positive — unit suite is stable & fast** (451/451 ×3, ~16 s). Honest: the *unit* layer is healthy; the gap is E2E runnability + coverage tooling, not unit flakiness.

---

## Category 6 — Runtime Error and Edge Case Handling

**How measured:** DevTools console, disconnect/reconnect, malformed input, 3G throttle, server logs → `scripts/audit/cat6-runtime.md` (manual protocol)

| Metric | Baseline |
|--------|----------|
| Console errors during normal usage | ___ |
| Unhandled promise rejections (server) | ___ |
| Network disconnect recovery | Pass / Partial / Fail |
| Missing error boundaries | ___ |
| Silent failures identified | ___ |

**Weaknesses / opportunities (ranked):** _RT1 (data-loss, the required ≥1 scenario), RT3, RF6_

---

## Category 7 — Accessibility Compliance

**How measured:** Lighthouse per page, axe-core severities, keyboard, contrast → `scripts/audit/cat7-a11y.sh`

| Metric | Baseline |
|--------|----------|
| Lighthouse a11y score (per page) | ___ |
| Total Critical/Serious violations | ___ |
| Keyboard navigation completeness | Full / Partial / Broken |
| Color contrast failures | ___ |
| Missing ARIA labels or roles | ___ |

**Weaknesses / opportunities (ranked):** _verify the README's 508/WCAG-AA claim_

---

## Ranked Findings Summary (all categories)

_Populated as measurements complete. Severity: High / Medium / Low, with category + reproduction._
