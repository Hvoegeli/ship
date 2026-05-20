# ShipShape — Remediation Plan (Phase-2 fix playbook)

> **What this is.** A per-category plan for the *potential fixes* that Phase 2 will implement, written
> from the Phase-1 audit's root-cause analysis. For each of the 7 categories: the finding, the root cause,
> the **recommended fix** (with the exact change-sites and alternatives considered), how it maps to the
> brief's **Improvement Target**, the **measurement protocol** (which committed harness proves it,
> before/after, under the snapshot-pinned condition of record), and **risk / tests-affected / effort**.
>
> **What this is *not* (yet).** No application code has been changed — the Wednesday MVP is audit-only.
> This document is the bridge from diagnosis to treatment; the brief's *Improvement Documentation*
> deliverable (before → root cause → fix → after → proof) gets its "after" half filled in as each fix
> lands in Phase 2. Findings/IDs reference [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md); every "measure"
> row re-runs a script from [`scripts/audit/`](../../scripts/audit/) against the locked snapshot
> (`bash scripts/audit/db-restore.sh`).
>
> **Sequencing (recommended landing order in Phase 2):** Cat 4 → Cat 3 → Cat 6 → Cat 2 → Cat 7 → Cat 1 → Cat 5.
> Rationale: lead with the lowest-risk, cleanest-measured wins (4, 3) to validate the before/after
> pipeline; group the API-edge work (3, 6); save the broad-but-shallow ones (1 type-safety, 5 tests) for
> when the harness loop is proven. Each fix is a separate labeled branch / commit per the rubric.

| # | Category | Recommended fix (one line) | Brief target | Proven by | Risk | Effort |
|---|----------|----------------------------|--------------|-----------|------|--------|
| 1 | Type Safety | Narrow the top-5 `any`/`as`/`!`-dense files + add `@typescript-eslint` gate | −25% violations | `cat1-type-safety.mjs` | Med | M |
| 2 | Bundle Size | Lazy-load editor-only deps (emoji-picker, lowlight) out of the entry chunk | −20% initial bundle | `cat2-bundle.mjs` | Med | M |
| 3 | API Response | Paginate + slim the two unbounded list endpoints | −20% P95 on ≥2 | `cat3-api.mjs` | Med | M |
| 4 | DB Queries | Throttle the per-request `last_activity` write | −20% queries on ≥1 flow | `cat4-db.mjs` | **Low** | **S** |
| 5 | Test Coverage | Implement `/e2e-test-runner` + fix 3 failing web tests (or +3 tests on zero-coverage paths) | +3 tests / 3 flakes w/ RCA | `pnpm test` + coverage | Low | M |
| 6 | Runtime Errors | Input validation + centralized JSON error envelope + root ErrorBoundary | 3 fixes, ≥1 data-loss | `cat6-runtime.mjs` | Med | M |
| 7 | Accessibility | Stop the standup modal auto-opening + fix contrast/ARIA on top-3 | +10 LH worst page / all C+S top-3 | `cat7-*.mjs` | Med | M |

---

## Category 1 — Type Safety

**Finding (H5).** 852 type-safety escape hatches in non-test `src` (`any` 94, `as` 433, `!` 325, `@ts-ignore` 0); **no linter** stops new ones. Top-5 dense: `api/src/routes/weeks.ts` (84), `projects.ts` (51), `issues.ts` (48), `web/src/pages/UnifiedDocumentPage.tsx` (37), `api/src/db/seed.ts` (35). Strict mode is **on** (web tsconfig omits 3 sub-flags — TS1).

**Root cause.** `as`/`!` are used to paper over (a) `pg` query results typed as `any`/`QueryResult<any>`, and (b) the JSONB `properties` blob being cast to concrete shapes at the call site instead of narrowed once. No `eslint` config means the count only grows.

**Recommended fix.**
1. Add `@typescript-eslint` with `no-explicit-any`, `no-non-null-assertion`, `consistent-type-assertions` (warn → error on changed files) — *stops the bleed*, which is the durable win.
2. Narrow the densest seams meaningfully: type `pg` rows with row interfaces / a small `query<T>()` helper; replace `properties as WeekProperties` with a **type guard** (`isWeekProperties`) so the discriminated-union variants from `shared/types/document.ts` do the work. Prioritize `weeks.ts` + `projects.ts` + `issues.ts` (183 of 852 = 21% in three files).
- *Alternatives considered:* blanket `any`→`unknown` (rejected — the brief explicitly says that's not an improvement without narrowing); `// @ts-expect-error` (rejected — moves the lie, doesn't fix it).

**Target mapping.** Eliminate ≥25% (≈213) with *meaningful* types. The top-3 files alone get most of the way; the eslint gate guarantees no regression.

**Measure.** `node scripts/audit/cat1-type-safety.mjs before|after` — per-file and per-kind counts. Pass = total drops ≥25% **and** `pnpm type-check` + `pnpm test` stay green.

**Risk / tests / effort.** Med risk (narrowing can surface latent bugs — that's the point). Tests: full api unit suite. Effort: M (mechanical but must be meaningful per fix).

---

## Category 2 — Bundle Size

**Finding (H3).** 2.0 MB raw / **576 KB gzip = 91.6% of all JS in one entry chunk**; 261 chunks but no route/vendor split; editor-only deps ship on first load. Confirmed user-visible: slow-3G first load ≈ 4.9 s (Cat 6).

**Root cause.** The TipTap editor and its heavy deps — `emoji-picker-react` (statically imported at [`web/src/components/EmojiPicker.tsx:2`](../../web/src/components/EmojiPicker.tsx#L2)) and the `lowlight`/highlight.js code-block syntax highlighter — are imported eagerly into the main graph. There is **no `manualChunks`/`rollupOptions` config** in `web/vite.config.ts`, so Rollup leaves everything in the entry chunk.

**Recommended fix.**
1. `React.lazy()` the `EmojiPicker` component (it only renders on user action) so `emoji-picker-react` becomes its own async chunk.
2. Lazy-load the code-block lowlight extension (register the highlighter on first code-block use) so highlight.js leaves the entry chunk.
3. Route-level `React.lazy` + `Suspense` for the heavy editor route so the docs list / login don't pay for the editor.
- *Alternatives considered:* `manualChunks` vendor-splitting (helps caching but doesn't reduce *initial* load as much as lazy-loading the editor path); swapping libraries (rejected — "boring technology", and removing functionality doesn't count).

**Target mapping.** "20% smaller initial-load bundle via code splitting." Moving emoji-picker (~398 KB) + highlight.js (~376 KB) out of the entry chunk comfortably clears 20% of initial JS.

**Measure.** `node scripts/audit/cat2-bundle.mjs before|after` (prereq: `cd web && VITE_API_URL= npx vite build --sourcemap`) — entry-chunk size + treemap. Pass = initial bundle ≥20% smaller, app still builds + loads.

**Risk / tests / effort.** Med (lazy boundaries can cause loading-state regressions; needs a Suspense fallback). Tests: E2E editor flows. Effort: M.

---

## Category 3 — API Response Time

**Finding (H1).** Two unbounded list endpoints — `/api/documents?document_type=wiki` (~300 KB) and `/api/issues` (~280 KB) — dominate latency and degrade ~linearly with concurrency (P95 grows @25→50). SQL is <1.5 ms → the cost is **JSON serialization of large unbounded result sets** on the shared REST+WS event loop.

**Root cause.** No `LIMIT`/pagination anywhere on list routes ([`api/src/routes/documents.ts`](../../api/src/routes/documents.ts) only uses `LIMIT 1` for single-row lookups), and list responses include the full `content` JSONB body per row, so payload scales with workspace size.

**Recommended fix.**
1. Add cursor (or offset) pagination to `/api/documents` and `/api/issues` (`LIMIT`/`OFFSET` + a `nextCursor`).
2. **Slim the list projection** — omit the heavy `content`/`yjs_state` columns from list responses (list views only need title/type/status/metadata); fetch the body on document open. This alone cuts the payload dramatically.
- *Alternatives considered:* response compression (helps bytes-on-wire but not serialization CPU on the shared loop); moving WS to a separate process (correct long-term — see RT2 — but out of scope for a 20% P95 win).

**Target mapping.** "20% P95 reduction on ≥2 endpoints, identical conditions." Both target endpoints are list routes; slimming + paginating attacks the serialization cost directly.

**Measure.** `node scripts/audit/cat3-api.mjs before|after` (snapshot-pinned, API :3000 direct, 10/25/50 concurrency, 62 s rate-limit gap). Pass = P95 down ≥20% on both `main_page` and `list_issues`.

**Risk / tests / effort.** Med (pagination changes the API contract — frontend list consumers + E2E must follow). Tests: documents/issues E2E + any list unit tests. Effort: M.

---

## Category 4 — Database Query Efficiency

**Finding (H2).** Every authenticated request runs `SELECT sessions` **+** `UPDATE sessions.last_activity` — 2 of every 4–5 queries are auth overhead. Honest baseline: at rubric volume per-query times are <1.5 ms and there's no N+1, so the win is **query count**, not speed.

**Root cause.** The session middleware writes `last_activity` on *every* request to support the 15-minute idle timeout — an unconditional write where a coalesced one would do. The hot-path write is [`api/src/middleware/auth.ts:206`](../../api/src/middleware/auth.ts#L206) (`UPDATE sessions SET last_activity = $1 WHERE id = $2`).

**Recommended fix.** Throttle the write: only `UPDATE last_activity` if the stored value is **older than a threshold** (e.g., 60 s) — "touch coalescing." The idle-timeout semantics are preserved (60 s resolution is irrelevant against a 15-min window); most requests skip the write entirely.
- *Alternatives considered:* move `last_activity` to Redis/in-memory (better but adds infra — violates "boring technology" for a 20% win); fire-and-forget async UPDATE (hides the query from latency but not from the DB — doesn't reduce *count*).

**Target mapping.** "20% fewer queries on ≥1 flow." `view_document` goes 4 → 3 queries = **−25%**, clearing the bar; most other flows benefit too.

**Measure.** `node scripts/audit/cat4-db.mjs before|after` (PG `log_statement=all`, marker-bracketed flows, snapshot-pinned). Pass = ≥20% fewer queries on ≥1 flow; **revert PG logging after**.

**Risk / tests / effort.** **Low** (one well-scoped middleware change; semantics preserved). Tests: session-timeout / auth unit tests must still pass. Effort: **S** — the recommended *first* fix.

---

## Category 5 — Test Coverage and Quality

**Finding.** api **451/0/0** (3 runs stable, fresh seed); web **138/13** (8.6% failing — TipTap/ProseMirror schema, hidden by default `pnpm test`); coverage api **40.52%** / web **28.53%** lines. **The mandated `/e2e-test-runner` skill does not exist** (H6) → the 882-test E2E suite can't be run by the sanctioned method. Zero unit coverage on: document CRUD over HTTP, auth, real-time Yjs collaboration.

**Root cause.** `pnpm test` only runs the api package, so 16 web unit files (and their 13 failures) are invisible; coverage tooling was absent (added in audit #3b); the E2E runner referenced by `CLAUDE.md:56` was never implemented.

**Recommended fix (pick the path that best fits the brief's "meaningful" bar).**
1. **Fix 3 failing web tests with RCA** — the 13 TipTap/ProseMirror-schema failures are real; root-cause and fix 3, each with a comment on the regression it guards. *(Cleanest match to "fix 3 flaky/failing with documented RCA".)*
2. **Or add 3 tests on zero-coverage critical paths** — document CRUD over HTTP, auth, and the advisory-lock ticket-number race (Discovery #1) are high-value and currently untested at the unit level.
3. Implement the `/e2e-test-runner` skill (background run + `test-results/summary.json` polling) so E2E is measurable at all — addresses H6 and unblocks the rubric's stated method.
- *Alternatives considered:* chasing the full 882-test E2E green (too large for the window; the runner gap blocks it anyway).

**Target mapping.** "+3 meaningful tests on untested paths, **or** fix 3 flaky tests with RCA." Either path 1 or path 2 satisfies it; each test gets a comment naming the risk it mitigates.

**Measure.** `pnpm --filter @ship/api test` + `pnpm --filter @ship/web exec -- vitest run` (counts), coverage JSON per package. Pass = 3 new/fixed meaningful tests green, no regressions.

**Risk / tests / effort.** Low (additive). Effort: M (RCA on the web failures is the time sink).

---

## Category 6 — Runtime Error and Edge Case Handling

**Finding.** H8: unvalidated path params surface raw Postgres errors as HTTP **500** (`/api/documents/not-a-uuid`); bad-JSON / missing-CSRF return **HTML stack-trace pages** (info disclosure + inconsistent contract). M3: no `Content-Type` enforcement → a `text/plain` body returns **201** and persists a junk document (silent failure). #10: error boundaries cover only the `<Outlet>` + editor — the root/providers/chrome/public routes are unwrapped. RT1 residual: server-side debounced Yjs persist **swallows failures**.

**Root cause.** Error responses are hand-rolled per route (`res.status(500).json(...)` scattered across `comments.ts`, `search.ts`, `projects.ts`, …) with no centralized error-handling middleware, so unvalidated input falls through to Express's default HTML error page; there's no shared input-validation layer on path params; and no top-level React `ErrorBoundary`.

**Recommended fix (3 gaps, ≥1 user-facing).**
1. **Input validation** on path params (zod `uuid()` guard) → return `400`/`404` JSON instead of a 500 from the driver.
2. **Centralized JSON error envelope** middleware (`{code,message}` matching `shared/types/api.ts`) replacing the ad-hoc `res.status(500)` calls and Express's HTML default — consistent contract, no stack-trace leak.
3. **Top-level `ErrorBoundary`** in [`web/src/main.tsx`](../../web/src/main.tsx) (and around the public-route subtree) so a provider/chrome/public-route throw shows a fallback instead of a white screen.
4. **(the data-loss/confusion one)** Surface the server-side persist failure (RT1) — log + signal the client — instead of silently swallowing it, so a failed save isn't mistaken for a successful one.
- *Alternatives considered:* per-route try/catch hardening (rejected — doesn't fix the systemic contract; centralizing does).

**Target mapping.** "Fix 3 error-handling gaps, ≥1 real data-loss/confusion." Fixes 1–3 are the 3; fix 4 is the data-loss scenario with before/after.

**Measure.** `node scripts/audit/cat6-runtime.mjs before|after` (malformed-input matrix, probes). Pass = bad-UUID → 400/404 JSON, malformed body → JSON error (no HTML stack), wrong Content-Type rejected; each with reproduction + screenshot.

**Risk / tests / effort.** Med (touches the global error path — broad surface). Tests: full api suite + error-path E2E. Effort: M.

---

## Category 7 — Accessibility Compliance

**Finding.** Auto-opening "Action Items" standup modal occludes every authed page from keyboard/SR users until dismissed (escapable; structure sound underneath); **15 color-contrast AA** failures on `/my-week`; **critical `aria-required-children`** + `listitem` on main_docs & view_document; editor is an unlabeled edit region; view_document + my_week page titles are `Ship | Ship` (WCAG 2.4.2). README claims 508/AA — not supported. Lighthouse worst page = **91** (view_document & main_docs).

**Root cause.** A Radix modal auto-opens on load whenever the user owes an accountability item and aria-hides `main`+`nav`; muted-text utility tokens fall below 4.5:1; a composite ARIA role is missing required children; the contenteditable body has no `aria-label`; the doc/week routes don't set a descriptive `<title>`.

**Recommended fix (pick the brief's cleaner path: "all Critical/Serious on top-3").**
1. **Stop the standup modal auto-opening** (or render it as a non-focus-stealing `role="status"` aside; if it must be modal, add `aria-modal`, return focus on close, don't reopen per-navigation) — un-occludes the sound structure for every keyboard/SR user.
2. Fix **`aria-required-children`** + `listitem` on main_docs & view_document (correct the role's child structure / wrap list items).
3. Raise the **`.text-muted/*` contrast token** to clear 4.5:1 → removes all 15 serious nodes on `/my-week`.
4. Add **`aria-label`/`aria-labelledby`** to the editor body; set descriptive **page titles** for view_document + my_week.
- *Alternatives considered:* "+10 Lighthouse on worst page" — view_document is already 91, so +10 = 101 > 100 max; the "fix all Critical/Serious on top-3" path is the achievable one given the low headroom.

**Target mapping.** "Fix all Critical/Serious on the 3 most important pages." Fixes 2–3 clear the axe Critical/Serious set on main_docs/view_document/my_week; fix 1 is the highest-leverage UX/SR win; before/after via all three Cat-7 harnesses.

**Measure.** `node scripts/audit/cat7-a11y.mjs` + `cat7-lighthouse.mjs` (3-run median) + `cat7-sr-tree.mjs` (modal-open vs removed diff) before|after. Pass = 0 Critical/Serious on the top-3, modal no longer occludes, Lighthouse non-regressing.

**Risk / tests / effort.** Med (modal behavior change touches a real product flow + may shift E2E selectors). Tests: a11y + relevant E2E. Effort: M.

---

### Reproducibility note
Every "Measure" row runs against the **locked condition of record** (`bash scripts/audit/db-restore.sh` → 627 docs / 328 issues / 35 sprints / 31 users) so the before/after comparison is under identical conditions, satisfying the brief's "identical conditions" rule. Cat-5 coverage is the one exception — it needs a fresh `pnpm db:seed` (api tests aren't isolated from pre-state; see RUNBOOK), then restore the snapshot afterward.
