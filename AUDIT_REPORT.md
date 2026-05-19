# ShipShape Audit Report — Phase 1 (Diagnosis)

> **Hard gate.** Baseline measurements for all 7 categories. *No fixes during the audit.*
> Companion docs: `ORIENTATION_NOTES.md` (system mental model + finding registers),
> `docs/audit/RUNBOOK.md` (**reproducible path + decision log — replay this audit from a clean clone**),
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
| Seed volume (CONDITION OF RECORD — **snapshot-pinned**) | **documents=627, issues=328, sprints=35, users=31, associations=625.** The exact dataset is frozen as a committed `pg_dump` at `scripts/audit/snapshot/ship_dev.condition.dump`; restore with `bash scripts/audit/db-restore.sh` (verified to round-trip). This is the *exact, reproducible* condition for every volume-sensitive baseline and for Phase-2 before/after. Meets deck Cat-3 bar (500+ docs / 100+ issues / 20+ users / 10+ sprints). |
| Why pinned (Decision #1b) | The base `pnpm db:seed` is **not idempotent** — doc count drifted 577 → 623 → 627 across the audit, and `pnpm test` truncates `ship_dev`. Documenting a drifting number would make the "reproducible under recorded conditions" claim untrue. The snapshot makes it literally true: anyone can `db-restore.sh` and re-run the harness to reproduce these numbers. Volume-sensitive baselines (Cat 3, Cat 4) are measured against this snapshot; Cat 1/2 are DB-independent (static AST / build artifact); Cat 6/7 measure page structure & error handling and are volume-independent. |
| ⚠️ Data-safety finding | `pnpm --filter @ship/api test` connects to the same `DATABASE_URL` and **truncates `ship_dev`** — running unit/coverage tests destroys the dataset. Mitigated by `db-restore.sh` (restore after any test run). Logged as Cat-5 finding. |

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

**How measured:** reproducible browser harness `scripts/audit/cat6-runtime.mjs` (headless Chromium via Playwright; one-time repro prereq `npx playwright install chromium` — tooling, not app code). **7 probes:** (1) console/page/network errors across 6 key pages, (2) malformed input to the API, (3) RT1 collab durability with a validated instrument + **online control** + API-verified persistence, (4) slow-3G load, (5) Postgres error-log scan, (6) **HTML/script-injection (stored-XSS)**, (7) **two clients editing the same field simultaneously**. Raw → `docs/audit/raw/cat6-before.txt`. Dev build, condition of record (577+ docs / 328 issues / 31 users). Probes 6–7 added per user decision #4b (closing the PRD "How to Measure" items earlier scoped out).

| Metric | Baseline |
|--------|----------|
| Console errors during normal usage | **0** across all 6 pages (login, docs, view-document, issues, my-week, team-dir): 0 `console.error`, 0 uncaught `pageerror`, 0 failed requests, 0 ≥500 responses |
| Unhandled promise rejections (server) | Not directly observable — **API stdout is not centrally captured** (observability gap). Proxy: **1** Postgres `ERROR` in run window (the bad-UUID 500 below); 0 browser-visible 5xx during normal nav |
| Network disconnect recovery | **Pass** (refines orientation RT1). Online control PERSISTED (instrument valid); transient disconnect with tab open → edits PERSISTED; Yjs **IndexedDB offline store present** (`ship-wiki-<id>`, `ship-meta`, `ship-query-cache`) → survives tab close too |
| Missing error boundaries | None triggered in normal use (0 pageerrors). Error-boundary coverage under fault injection not exercised this pass |
| Silent failures identified | **`wrong_content_type` → 201**: a `text/plain` body silently creates a default wiki document (no Content-Type guard). Plus orientation RT1/RT3 residual: server-side 2s-debounced Yjs persist swallows failures |

**Malformed-input matrix (Probe 2):**

| Input | Result | Verdict |
|-------|--------|---------|
| Bad JSON body | **400 + HTML stack-trace page** (`<pre>SyntaxError…`) | ⚠️ leaks stack, non-JSON contract |
| Missing CSRF token | **403 + HTML `ForbiddenError` stack page** | ⚠️ same info leak / inconsistent shape |
| Oversized title (100k chars) | **400 clean JSON Zod error** (`too_big`, max 255) | ✅ correct validation |
| Wrong Content-Type (`text/plain`) | **201 Created** — document created from unparsed body | ⚠️ silent junk-doc creation |
| Bad UUID in path (`/documents/not-a-uuid`) | **500 `Internal server error`** + raw Postgres `invalid input syntax for type uuid` | ⚠️ unvalidated param → DB error as 500 |
| HTML/script-injection in title+body (Probe 6) | **Stored RAW** (no server sanitization) but **not executed** — React/TipTap escapes on render | ⚠️ defense-in-depth gap (latent stored-XSS for any non-escaping consumer) |

**Concurrent-edit test (Probe 7):** two independent Yjs clients/contexts editing the same document field simultaneously (`Promise.all` over both clients' contiguous markers) → **PASS, stable across 3 runs** (both markers API-verified present, 0 console errors). *Instrument-validation note (recorded for honesty):* the first implementation interleaved the two markers character-by-character so the contiguous strings were undetectable and it reported a false `FAIL`; fixing **only** the typing pattern flipped it to PASS — proving the failure was the instrument, not data loss (same discipline as the RT1 control). Caveat: both clients use the same account but separate Yjs connections — a valid CRDT data-integrity test, not an identity/permission test.

**Weaknesses / opportunities (ranked):**
1. **High — unvalidated path params surface raw DB errors as HTTP 500.** `/api/documents/not-a-uuid` → Postgres `invalid input syntax for type uuid` → generic 500 (cross-validated by Probe 5: exactly 1 PG `ERROR` in the window). Should be a 400/404 with input validation before the query; also a minor info-disclosure (leaks the column type). Maps to **RF6**.
2. **High — error responses leak stack traces as HTML.** Bad JSON and missing-CSRF return Express's default HTML error page with a `SyntaxError`/`ForbiddenError` stack instead of the JSON envelope used elsewhere (the Zod 400 *is* clean JSON). Inconsistent error contract + information disclosure across the whole API surface.
3. **Medium — no Content-Type enforcement → silent document creation.** A `text/plain` body still returns **201** and persists a default wiki doc (unparsed body → silent defaults). Junk/blank-document and data-integrity risk; a silent failure by definition.
4. **Medium (positive correction) — RT1 empirically downgraded.** Orientation hypothesized collab data-loss from code reading (2s debounce, failure-silent persist). The browser test **does not reproduce client-side loss**: a validated instrument (force-click + `keyboard.type`, API-verified) shows the online control PERSISTED, a transient disconnect with the tab open PERSISTED, and a per-doc **Yjs IndexedDB store exists** (survives tab close). Residual risk is narrowed to the **server-side** path only — a swallowed DB-write failure on the debounced persist (client believes it synced). Honest refinement, not a manufactured data-loss claim.
5. **Medium — slow-3G first load ≈ 4.9 s** for the main page (`wall_load ≈ 4.88 s`, TTFB ≈ 2–3 ms locally ⇒ ~all of it is bundle transfer). Directly corroborates Cat 2 (575 kB gzip in one chunk); on real 3G this is materially worse.
6. **Low / positive — clean under normal use.** Zero console/page/network errors and zero 5xx across the 6 core pages; no error boundary triggered. The runtime baseline is healthy; the gaps are at the API edge (input/error contract) and observability.
7. **Cross-cutting — no centralized API error logging (observability).** API process stdout isn't captured; only Postgres logs + HTTP status are externally observable, so the "silent failure" class (e.g., RT1 server persist) is hard to detect in production. Pre-req improvement for any reliability work.
8. **Medium — stored-XSS defense-in-depth gap (Probe 6).** HTML/script payloads in a document title+body are persisted **raw** (no server-side sanitization). Not executed today because React/TipTap escapes on render, so it is *not* an active vulnerability — but any consumer that renders document fields without escaping (exports, emails, a future non-React surface, the API itself) would be exposed. Sanitize on write or document the render-escaping as a hard invariant.
9. **Low / positive — concurrent collaborative editing is safe (Probe 7).** Two simultaneous Yjs clients editing the same field both survive (CRDT merge), 0 console errors, reproducible ×3. Confirms the real-time core is sound; combined with #4 this scopes the *only* genuine collab risk to the server-side swallowed-persist path.

---

## Category 7 — Accessibility Compliance

**How measured:** TWO reproducible harnesses, same 6 pages, same condition. (1) `node scripts/audit/cat7-lighthouse.mjs before` — **Lighthouse 13** accessibility category, headless (clean profile, no extensions), Lighthouse's own throttling only, authenticated via session cookie (`login` run unauthenticated). Per the ShipShape Lighthouse guide: **3 runs/page, median reported** (scores fluctuate); full **JSON+HTML reports committed as evidence** to `reports/a11y/before/<page>.report.{json,html}`. (2) `node scripts/audit/cat7-a11y.mjs before` — headless Chromium + `@axe-core/playwright` (repo devDependency): axe WCAG 2.1 **A+AA** + isolated `color-contrast` + bounded keyboard-reachability (60-Tab budget, unique per-element identity) + landmark/lang/heading basics. **Instrument validated** like Cat-6 RT1: `login` scanned in a clean *unauthenticated* context as the control (axe 0 violations, **4/4** keyboard) → authenticated numbers are real, not artifacts. Raw: `docs/audit/raw/cat7-before.txt` + `docs/audit/raw/cat7-lighthouse-before.txt`. Commits `61aae8a` / `9fe25cd` / `8419aa7` (+ 3×-median follow-up). **Caveat (critical for reading this category):** Lighthouse & axe are *automated* audits (~30–40% of WCAG); they do **not** meaningfully test keyboard focus traversal. So a high Lighthouse score and the "keyboard broken" finding are **not contradictory** — the keyboard defect is precisely the class automated scoring misses ("a 100 is not a victory"). All numbers are a **lower bound**.

| Metric | Baseline |
|--------|----------|
| **Lighthouse accessibility score (per page)** | **median of 3 runs:** login **98** · main_docs **91** · view_document **91** · issues **100** · my_week **96** · team_dir **100**. **Lowest = 91 (main_docs & view_document, stable across the median).** The 3-run median resolved earlier single-run noise (main_docs runs were 100/91/91). Failed audits mirror axe exactly: `aria-required-children`, `listitem`, `color-contrast`, `landmark-one-main` (login). Full per-page Lighthouse JSON+HTML in `reports/a11y/before/`. |
| axe a11y per page (violations / passes) | login **0 / 23** (clean control) · main_docs **2 / 22** · view_document **2 / 22** · issues **0 / 21** · my_week **1 / 20** · team_dir **0 / 20** |
| Total Critical/Serious violations | **Critical = 2, Serious = 17** node instances (Critical+Serious = **19**); **3 distinct rules**: `aria-required-children` (critical), `listitem` (serious), `color-contrast` (serious) |
| Keyboard navigation completeness | **Broken on the authenticated app.** Control login = **4/4** reachable; every authenticated page reaches only **3 distinct** focusable elements in 60 Tabs despite **369 / 48 / 1017 / 26 / 24** interactive elements (no single-element trap — focus cycles among ~3) |
| Color contrast failures | **15** failing nodes, all on `/my-week` (low-opacity muted text, e.g. `.text-muted/50` on `.bg-accent/20`) — WCAG 1.4.3 AA |
| Missing ARIA labels or roles | `aria-required-children` (critical) on main_docs & view_document (a role's required child structure is malformed) + `listitem` (serious, list markup not in a `<ul>/<ol>`). Login page lacks `main`/`nav` landmarks; app pages have both. `lang=en`, unique `<title>`, single `<h1>` on all pages ✅ |

**Verdict on the README's "Section 508 / WCAG 2.1 AA compliant" claim — CONTRADICTED.** Lighthouse scores are high (91–100) — the app's *automated-detectable* hygiene is good — but two independent tools (Lighthouse + axe) both flag a **critical** `aria-required-children`, `listitem` structure, and **15** color-contrast (WCAG 1.4.3 AA) failures; and the keyboard probe shows traversal reaching only ~3 of hundreds of interactive elements on every authenticated page (WCAG **2.1.1 Keyboard** / **2.4.3 Focus Order**, core 508 — the class automated scoring cannot see). A blanket "508 / WCAG 2.1 AA compliant" claim requires *zero* AA failures and full keyboard operability; neither holds. So: **not supported**, despite the reassuring Lighthouse numbers — which is exactly why the PRD asks for keyboard + contrast + screen-reader testing beyond the score.

**Weaknesses / opportunities (ranked):**
1. **High — keyboard navigation is broken on the authenticated app.** Validated harness: 60 Tabs reach only **3 distinct** focusable elements on every authenticated page (vs **4/4** on the clean login control with only 4 elements), despite 369–1017 interactive elements present. WCAG 2.1.1 / 2.4.3 — core Section 508. The single largest a11y gap; recommend a manual confirmation pass, but the control rules out an instrument artifact.
2. **High — the README's 508 / WCAG 2.1 AA compliance claim is false as shipped.** Documentation overclaim with compliance risk for a `.treasury.gov` deployment; the audit's job was to test it, and the evidence contradicts it (see verdict). *Phase-2 paths both now viable & measurable:* "+10 Lighthouse on the lowest page" (view_document **91** → ≥**100** is only +9 — so target the next-lowest or treat the +10 as fix-all on top-3) **or** "fix all Critical/Serious on the 3 most important pages" (cleaner given the low headroom — `cat7-a11y.mjs` + `cat7-lighthouse.mjs` prove it before/after).
3. **Medium — `color-contrast` AA failures (15 nodes, `/my-week`).** Low-opacity muted text utility classes; concentrated and fixable (WCAG 1.4.3).
4. **Medium — `aria-required-children` (critical) + `listitem` (serious) on main_docs & view_document.** ARIA/structure bugs: a composite role is missing required children and list items sit outside a list container — affects screen-reader traversal.
5. **Low — login page missing `main`/`nav` landmarks** (region navigation), though it is otherwise the cleanest page.
6. **Positive / scoping — baseline hygiene is solid.** `lang=en`, unique titles, single `<h1>`, app-page `main`+`nav` landmarks, 20–23 axe passes/page. The gap is keyboard + contrast + a few ARIA structure defects, not pervasive — a tractable, well-localized remediation target.

---

## Ranked Findings Summary (all categories)

Severity-ranked synthesis across all 7 categories. Each row: the finding, its category, the **committed script that reproduces it** (re-run identically in Phase 2 for before/after), and the measurable Phase-2 lever where the deck specifies one. Full methodology/evidence in the per-category sections above; raw in `docs/audit/raw/`.

**Phase-1 gate: 7 / 7 categories baselined.** Conditions of record fixed (577 docs / 328 issues / 31 users). No application code changed during the audit — only reproducible instruments + deterministic test data.

### High

| # | Finding | Cat | Reproduce | Phase-2 lever |
|---|---------|-----|-----------|---------------|
| H1 | Two unbounded list endpoints (`/api/documents?type=wiki` ~300 KB, `/api/issues` ~280 KB) dominate latency and degrade ~linearly with concurrency (P95 201→362 ms, 124→222 ms @25→50). SQL is <1.5 ms → cost is JSON serialization on the shared REST+WS event loop. | 3 | `cat3-api.mjs` | Pagination/`LIMIT` → deck's "≥20% P95 reduction on ≥2 endpoints" |
| H2 | Universal per-request auth query tax: every flow runs `SELECT sessions` **+** `UPDATE sessions.last_activity` — 2 of every 4–5 queries are auth overhead. | 4 | `cat4-db.mjs` | Throttle the `last_activity` write → deck's "≥20% fewer queries on ≥1 flow" (e.g. view_document 4→3 = −25%) |
| H3 | Monolithic entry chunk: 2.0 MB raw / **576 KB gzip = 91.6% of all JS**; no route/vendor split; editor-only deps (highlight.js 376 KB, emoji-picker 398 KB) ship on first load. Confirmed user-visible: slow-3G first load ≈ 4.9 s (Cat 6). | 2 | `cat2-bundle.mjs` | Code-split + lazy-load → deck's "≥20% smaller initial bundle" |
| H4 | Keyboard navigation broken on the authenticated app: 60 Tabs reach only **3 distinct** focusable elements (vs validated **4/4** login control) despite 369–1017 interactive elements. WCAG 2.1.1 / 2.4.3 — core Section 508. | 7 | `cat7-a11y.mjs` | Focus-order fix; manual confirm pass |
| H5 | Type-safety debt: **852** escape hatches in non-test src (`!` 325, `as` 433, `any` 94) vs 213 target; **no linter** to stop new ones. | 1 | `cat1-type-safety.mjs` | Reduce ≥25% + add `@typescript-eslint` |
| H6 | The mandated `/e2e-test-runner` skill **does not exist**; the only sanctioned way to run the 882-test E2E suite is unimplemented, and coverage is unmeasurable as-shipped (`@vitest/coverage-v8` absent, web has none). | 5 | `docs/audit/raw/cat5-before.txt` | Implement runner + install coverage tooling |
| H7 | README claims "Section 508 / WCAG 2.1 AA compliant" — **contradicted**: critical `aria-required-children`, 15 color-contrast AA failures, broken keyboard nav. Compliance overclaim on a `.treasury.gov` target. | 7 | `cat7-a11y.mjs` | Remediate to substantiate (or retract) the claim |
| H8 | Unvalidated path params surface raw Postgres errors as HTTP **500** (`/api/documents/not-a-uuid`); bad-JSON / missing-CSRF return **HTML stack-trace pages** (info disclosure, inconsistent error contract API-wide). | 6 | `cat6-runtime.mjs` | Input validation + JSON error envelope |

### Medium

| # | Finding | Cat | Reproduce |
|---|---------|-----|-----------|
| M1 | Global rate limiter **100 req/min in prod** (per-IP) — very low for a multi-user collaborative app; an availability risk. | 3 | `cat3-api.mjs` |
| M2 | No pagination/`LIMIT` anywhere — result sets grow linearly with workspace size (hidden at 577 docs, visible at 10×). | 3/4 | `cat3`/`cat4` |
| M3 | No `Content-Type` enforcement: a `text/plain` body still returns **201** and persists a default document (silent junk-doc creation). | 6 | `cat6-runtime.mjs` |
| M4 | `color-contrast` AA failures (15 nodes, `/my-week`, low-opacity muted text). | 7 | `cat7-a11y.mjs` |
| M5 | `aria-required-children` (critical rule) + `listitem` (serious) ARIA/structure bugs on main_docs & view_document. | 7 | `cat7-a11y.mjs` |
| M6 | `pnpm test` runs only api unit — 16 web unit files silently excluded; docs undercount tests ~10×. | 5 | `cat5-before.txt` |
| M7 | Running unit tests truncates `ship_dev` (shared `DATABASE_URL`, no isolated unit DB) — destroys dev/seed data. | 5 | observed, documented |
| M8 | RT1 residual (refined, not the original claim): client offline path is robust (y-indexeddb + replay), but the server-side 2 s-debounced persist still swallows failures, and there is **no centralized API error logging** to detect it. | 6 | `cat6-runtime.mjs` |

### Low / positive (honest scoping — where *not* to spend Phase-2 effort)

| # | Finding | Cat |
|---|---------|-----|
| L1 | `shared/` is type-clean (0 violations) — not a Cat-1 lever. | 1 |
| L2 | Fast endpoints are genuinely fast (view_document/search/weeks P95 <25 ms @25). | 3 |
| L3 | DB is well-indexed; **no N+1**, no slow query at rubric volume — Cat-4 gains are query *count*, not speed. | 4 |
| L4 | Unit suite is stable & fast (451/451 ×3, ~16 s). | 5 |
| L5 | Normal browser use is clean: 0 console/page/network/5xx errors across 6 pages. | 6 |
| L6 | a11y baseline hygiene is solid (lang/title/single-h1/landmarks, 20–23 axe passes/page) — failures are localized, not pervasive. | 7 |

### Three strongest Phase-2 candidates (map directly to the deck's measurable 20% targets)

1. **H1 — paginate the two heavy list endpoints** → measurable P95 drop on ≥2 endpoints (`cat3-api.mjs` before/after).
2. **H2 — throttle the per-request `last_activity` write** → measurable query-count drop on ≥1 flow (`cat4-db.mjs` before/after).
3. **H3 — code-split + lazy-load the editor-only deps** → measurable initial-bundle reduction (`cat2-bundle.mjs` before/after).

Each is independently reproducible, low-blast-radius, and aligned to a quantified rubric target — the recommended Phase-2 scope.
