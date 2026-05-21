# ShipShape — Phase 2 Task List (Implementation)

> **The bar (PRD + deck + Cat-8 doc):** measurable improvement in **all 8 categories** — "not pick-three" — each with **before/after proof under identical conditions**, tests still passing, root cause documented, commit discipline. Grading: Measurable improvement 40% · Technical depth 25% · TypeScript quality 15% · Documentation 10% · Commit discipline 10%.
>
> **Deadline:** **Sunday** only (~10:59 PM CT). No Friday submission. Internal goal: *mostly done by Friday*, Sat/Sun for polish + extra credit.
>
> **Scope:** the 8 mains first; supplementals (S1/S3/S4…) after. Detail for each fix lives in [`REMEDIATION-PLAN.md`](REMEDIATION-PLAN.md); this is the execution checklist.

## The per-fix loop (every category below)
1. Branch `phase2/<cat>-<slug>` off `shipshape/audit`.
2. Re-run the harness → **before** (mostly already captured in `docs/audit/raw/`).
3. Implement the fix.
4. Re-run the harness → **after**; confirm the target is hit.
5. `pnpm type-check` + the relevant tests stay green (fix-or-revert if a test breaks *because of us*).
6. Write the **before → root cause → fix → after → proof** block (this is the *Improvement Documentation* deliverable).
7. Commit (clear message) → merge to `shipshape/audit` → mirror-push to GitLab.

All "before/after" runs use the locked snapshot (`bash scripts/audit/db-restore.sh`) for identical conditions. *(Cat 5 is the exception — needs a fresh `pnpm db:seed`, then restore.)*

---

## 0 · Do-first (grader feedback — doc-only, ~30 min, no branch needed)
- [ ] **F1** — Move/mirror the **High/Med/Low severity criteria** from `ORIENTATION_NOTES.md` into the `AUDIT_REPORT.md` body (near Ranked Findings), so the rubric is visible without cross-referencing.
- [ ] **F2** — Inline the **`EXPLAIN ANALYZE` plan trees** for Cat 4's slowest queries into the `AUDIT_REPORT.md` Cat 4 section (not just a raw-file pointer). *Doubles as Cat 4's "before" evidence.*

---

## Category fixes — landing order

### ① Cat 4 — DB query count · `phase2/cat4-last-activity-throttle` · risk LOW
- **Fix:** throttle the per-request `last_activity` write (`auth.ts:206`) — only update if older than ~60 s (touch-coalescing).
- **Target:** −20% queries on ≥1 flow (`view_document` 4→3 = −25%).
- **Proof:** `cat4-db.mjs before|after` (PG `log_statement=all`; **revert logging after**).
- **Keep green:** session-timeout / auth unit tests.
- [ ] before · [ ] fix · [ ] after · [ ] tests · [ ] doc · [ ] commit+push

### ② Cat 3 — API P95 · `phase2/cat3-paginate-list-endpoints` · risk MED
- **Fix:** paginate + **slim** `/api/documents` & `/api/issues` (omit `content`/`yjs_state` from list responses).
- **Target:** −20% P95 on ≥2 endpoints (`main_page` + `list_issues`).
- **Proof:** `cat3-api.mjs before|after` (snapshot-pinned, :3000 direct).
- **Keep green:** documents/issues E2E + list consumers must follow the new contract.
- [ ] before · [ ] fix · [ ] after · [ ] tests · [ ] doc · [ ] commit+push

### ③ Cat 6 — runtime/error handling · `phase2/cat6-error-envelope` · risk MED
- **Fix (3 gaps, ≥1 data-loss):** zod `uuid()` path validation → 400/404 JSON; centralized JSON error-envelope middleware (kills HTML stack-trace leak); top-level `ErrorBoundary` in `main.tsx`; **data-loss item = surface the swallowed Yjs persist failure** (overlaps S4).
- **Target:** 3 error-handling fixes, ≥1 real data-loss/confusion.
- **Proof:** `cat6-runtime.mjs before|after` + repro screenshots.
- ⚠️ **Keep distinct from Cat 8:** Cat 6 = robustness/contract; Cat 8 fixes must be *security-specific* (don't double-count the same change).
- [ ] before · [ ] fix · [ ] after · [ ] tests · [ ] doc · [ ] commit+push

### ④ Cat 8 — SECURITY (NEW, heaviest) · `phase2/cat8-security-probe` · risk MED
- **Build the probe tool:** `scripts/audit/cat8-security.mjs` — actively tests 4 surfaces: (1) auth/session, (2) WebSocket message validation, (3) input sanitization (XSS/SQLi/overlong, stored+reflected), (4) `npm audit` parse for high/critical CVEs. Emits structured **JSON + markdown** report w/ severity + repro. **Single command.** Borrow agentforge's findings/severity/report schema + CLI shape + auth-probe blueprint (`target/adapter.py`).
- **Manual review (harvest from Supplementary):** CORS/CSP, secret exposure (S15: none — verified), rate limiting (M1: 100/min), error verbosity (H8).
- **Baseline:** add a **Category 8 section** to `AUDIT_REPORT.md` (deliverable table + manual-review answers).
- **Fix ≥2 verified vulns (distinct from Cat 6):** likely **S12 (cache identity-scoping — cross-user exposure)** + one of {high/critical `npm audit` CVE bump · WebSocket message validation · CSP/CORS hardening} — pick from what the probe finds.
- **Proof:** `cat8-security.mjs before|after`.
- [ ] tool runs · [ ] baseline+report · [ ] manual review · [ ] fix 1 · [ ] fix 2 · [ ] doc · [ ] commit+push

### ⑤ Cat 2 — bundle size · `phase2/cat2-code-split-editor` · risk MED
- **Fix:** `React.lazy()` the `EmojiPicker`; lazy-load the `lowlight` code-block highlighter; route-level lazy for the editor page.
- **Target:** −20% initial-load bundle.
- **Proof:** `cat2-bundle.mjs before|after` (prereq: `cd web && VITE_API_URL= npx vite build --sourcemap`).
- **Keep green:** editor E2E + Suspense fallbacks.
- [ ] before · [ ] fix · [ ] after · [ ] tests · [ ] doc · [ ] commit+push

### ⑥ Cat 7 — accessibility · `phase2/cat7-a11y-top3` · risk MED
- **Fix:** stop the standup modal auto-opening (or make it non-focus-stealing); fix `aria-required-children` + `listitem`; raise the `.text-muted/*` contrast token ≥4.5:1; add editor `aria-label` + descriptive page titles.
- **Target:** 0 Critical/Serious on top-3 pages *(LH headroom too low for the "+10" path — view_document already 91)*.
- **Proof:** `cat7-a11y.mjs` + `cat7-lighthouse.mjs` + `cat7-sr-tree.mjs` before|after.
- **Keep green:** a11y + E2E selectors (modal change may shift them).
- [ ] before · [ ] fix · [ ] after · [ ] tests · [ ] doc · [ ] commit+push

### ⑦ Cat 1 — type safety · `phase2/cat1-narrow-types` · risk MED (tedious)
- **Fix:** install `@typescript-eslint` gate (`no-explicit-any`, `no-non-null-assertion`); narrow the dense seams `weeks.ts`/`projects.ts`/`issues.ts` with row interfaces + type guards.
- **Target:** −25% (≈213) violations, *meaningfully* typed.
- **Proof:** `cat1-type-safety.mjs before|after`; `pnpm type-check` + tests green.
- [ ] before · [ ] fix · [ ] after · [ ] tests · [ ] doc · [ ] commit+push

### ⑧ Cat 5 — test coverage · `phase2/cat5-tests` · risk LOW
- **Fix:** fix **3 failing web tests with RCA** (or +3 tests on zero-coverage paths: document CRUD over HTTP, auth, the advisory-lock ticket race); implement the `/e2e-test-runner` skill (H6).
- **Target:** +3 meaningful tests / 3 flakes-with-RCA.
- ⚠️ **Caveat:** web has **13 pre-existing failures**; fixing 3 doubles as the deliverable — document the rest as pre-existing (not caused by us). api tests need fresh seed → restore snapshot after.
- [ ] before · [ ] fix · [ ] after · [ ] tests · [ ] doc · [ ] commit+push

---

## Supplementals (after the 8 mains)
- [ ] **S1** — guard migration 033's `RENAME VALUE`s so a fresh DB provisions (reproducibility; quick).
- [ ] **S3** — JSONB expression indexes → strengthens Cat 4 into a *speed* win (`EXPLAIN ANALYZE` seq-scan→index-scan; pairs with F2).
- [ ] **S4** — SIGTERM shutdown flush of `pendingSaves` → strengthens Cat 6's data-loss fix.
- [ ] Others as time permits: S2 (soft-delete leak), S7 (route lazy/virtualize), S8/S9 (deleted_at type + real lint), S10 (test flake), S12–S15 (security/ops/hygiene).

## Non-code deliverables (Sunday)
- [ ] **Improvement Documentation** — per category (filled by step 6 of each loop).
- [ ] **Demo video** updated to cover findings **+ before/after** (our script is the first half).
- [ ] **AI Cost Analysis** — dev spend + reflection.
- [ ] **Social post** — X/LinkedIn, key findings, tag **@GauntletAI**.
- [ ] **Deployed fork** — public, running. ⚠️ Needs its own host plan (repo deploy scripts point at Treasury AWS, not ours).

## Timeline
- **Thu→Fri (mostly-done target):** F1/F2 · Cat 4 · Cat 3 · Cat 6 · Cat 8 (tool + baseline).
- **Sat:** Cat 2 · Cat 7 · Cat 1 · Cat 5 · supplementals (S1/S3/S4).
- **Sat/Sun:** polish · improvement docs · deployed fork · demo video · AI cost · social post.
- **Sun ≤10:59 PM CT:** final submit (GitHub **+** GitLab).
