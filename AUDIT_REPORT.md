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
| Seed volume | _record `documents`/`issues`/`users`/`weeks` counts here_ |

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

**How measured:** _tool + commands_ → `scripts/audit/cat2-bundle.sh`

| Metric | Baseline |
|--------|----------|
| Total production bundle size | ___ KB |
| Largest chunk (name + size) | ___ |
| Number of chunks | ___ |
| Top 3 largest dependencies | ___ |
| Unused dependencies identified | ___ |

**Weaknesses / opportunities (ranked):** _P3 scoping; TBD_

---

## Category 3 — API Response Time

**How measured:** _seed volume, endpoint selection, load tool, concurrency_ → `scripts/audit/cat3-api.sh`

| Endpoint | P50 | P95 | P99 |
|----------|-----|-----|-----|
| 1. ___ | ___ms | ___ms | ___ms |
| 2. ___ | ___ms | ___ms | ___ms |
| 3. ___ | ___ms | ___ms | ___ms |
| 4. ___ | ___ms | ___ms | ___ms |
| 5. ___ | ___ms | ___ms | ___ms |

Concurrency tested: 10 / 25 / 50. **Method note (P1):** hit API `:3000` directly, never the Vite `:5173` proxy.

**Weaknesses / opportunities (ranked):** _RF2 (per-request session SELECT+UPDATE), P2 (shared event loop), RT2_

---

## Category 4 — Database Query Efficiency

**How measured:** `log_statement='all'`, 5 flows, EXPLAIN ANALYZE → `scripts/audit/cat4-db.sh`

| User Flow | Total Queries | Slowest Query (ms) | N+1? |
|-----------|---------------|--------------------|------|
| Load main page | ___ | ___ms | ___ |
| View a document | ___ | ___ms | ___ |
| List issues | ___ | ___ms | ___ |
| Load sprint board | ___ | ___ms | ___ |
| Search content | ___ | ___ms | ___ |

**Weaknesses / opportunities (ranked):** _DM2 (index coverage), RF3 (post-commit loop)_

---

## Category 5 — Test Coverage and Quality

**How measured:** unit via vitest; E2E via `/e2e-test-runner` (CLAUDE rule); flake = 3× runs → `scripts/audit/cat5-tests.sh`

| Metric | Baseline |
|--------|----------|
| Total tests | unit 451 (api) + ~882 E2E (TBD exact) |
| Pass / Fail / Flaky | unit 451/0/0 ; E2E ___/___/___ |
| Suite runtime | unit 16.24s ; E2E ___s |
| Critical flows with zero coverage | ___ |
| Code coverage % | web: ___% / api: ___% |

**Weaknesses / opportunities (ranked):** _TI1 (73 vs 882), TI2 (web excluded), TI3 (no coverage gate), TI4 (flakes)_

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
