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

**How measured:** _tool + commands + methodology_ → `scripts/audit/cat1-type-safety.sh`

| Metric | Baseline |
|--------|----------|
| Total `any` types | ___ |
| Total type assertions (`as`) | ___ |
| Total non-null assertions (`!`) | ___ |
| Total `@ts-ignore` / `@ts-expect-error` | ___ |
| Strict mode enabled? | **Yes** (root tsconfig: strict + noUncheckedIndexedAccess + noImplicitReturns + noFallthroughCasesInSwitch) |
| Strict mode error count (if disabled) | N/A (enabled) |
| Top 5 violation-dense files | ___ |

**Weaknesses / opportunities (ranked):** _from registers TS1–TS5, S7_

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
