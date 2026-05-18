# Ship — Codebase Orientation Notes

> Phase 1 deliverable for the ShipShape audit. Built up live during orientation.
> Methodology: follow the README **as written**, in order, and record every place
> reality diverges from the documentation. No measuring, no fixing during this phase.

## Environment (machine this was done on)

| Tool | Version / Status |
|------|------------------|
| Node.js | v20.20.2 ✅ (README requires 20+) |
| pnpm | ❌ not pre-installed — pinned `pnpm@10.27.0` activated via `corepack` |
| PostgreSQL (local) | ❌ `psql` not found — used Docker per README |
| Docker | v29.4.2, runtime = **Colima 0.10.1** (Lima VM, macOS Virtualization.Framework) |
| Docker Compose | v5.1.3 (v2 — `docker compose`, space form) |
| OS | macOS (Darwin 23.6.0), aarch64 |
| Git branch | `dev` (not a fresh `master` clone) |

**End state:** app runs. API `http://localhost:3000` (`/health` → `{"status":"ok"}`), Web `http://localhost:5173` (HTTP 200), `shared` tsc-watch 0 errors. Postgres in Docker on `:5432` (`ship-postgres-1`, `postgres:16`, healthy), seeded with 104 issues / 15 projects / 11 people / etc.

---

## Phase 1: First Contact

### 1. Repository Overview

#### Setup log (README steps, in order, with what actually happened)

1. **Tooling check** — Node ✅; pnpm ❌ → corepack; psql ❌; Docker ✅ (Colima).
2. **README Step 1 `git clone`** — already in repo at `/Users/harrisonvoegeli/projects/ship`, branch `dev`. N/A.
3. **README Step 2 `pnpm install`** — repo pins `pnpm@10.27.0` (`packageManager`). Used `corepack enable && corepack prepare --activate` → 10.27.0. `pnpm install --frozen-lockfile` → OK in 8.8s. Postinstall surfaced Findings #3, #4.
4. **README Step 3 copy env** — `cp api/.env.example api/.env.local`; `cp web/.env.example web/.env`. `DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_dev` (matches `docker-compose.yml`).
5. **README Step 4 `docker-compose up -d`** — used `docker compose` (v2). First attempt **failed**: port 5432 already allocated (Finding #5). Freed 5432 per user instruction → triggered Docker outage incident (Finding #6). Recovered with `colima restart`. First container came up with **no port binding** (created during the failed run); fixed with `docker compose down && up -d --force-recreate` (Finding #7). Container healthy, `127.0.0.1:5432` reachable.
6. **README Step 5 `pnpm db:seed`** — first run failed (DB unreachable, see #6/#7). After fix: ✅ seeded full data set. Note: seed **bootstraps the schema itself**.
7. **README Step 6 `pnpm db:migrate`** — applied migrations 002–010+, then `"Database schema already exists, continuing..."` (no-op tail). Works only because seed already laid the schema (Finding #8).
8. **README Step 7 `pnpm dev`** — first run: **API crashed** `ERR_MODULE_NOT_FOUND @ship/shared/dist/index.js`. README never says to build `shared`; `CLAUDE.md` does (Finding #9). Ran `pnpm build:shared`, restarted → API + Web both up and healthy.

#### Setup Deviations & Findings

Severity scale:
- **High** = blocks a new engineer from running the app on a fresh, reasonable setup
- **Medium** = wrong but workable; causes confusion or affects later audit work
- **Low** = imprecise/cosmetic; minor friction

| # | Step | README says | Reality | What I did | Severity | Future impact |
|---|------|-------------|---------|-----------|----------|---------------|
| 1 | DB runtime | `docker-compose up -d` as step 4 of 7, no alternative given | **Three-way conflict, sourced:** README pushes Docker; `docker-compose.yml` header literally says *"This file is NOT required. Most developers use native PostgreSQL instead"*; `CLAUDE.md` recommends native Postgres + `pnpm dev` auto-create. README's documented happy-path is disavowed by the file it tells you to run. Creds DO match `.env.example`. | Chose Docker — README is the audit's source of truth; the conflict IS the finding | **High** | README sends new engineers down a path the codebase explicitly disavows. Doc reconciliation = Category-improvement candidate. Pins reproducible `postgres:16` for Cat 3/4 benchmarks |
| 1a | `docker-compose up -d` | hyphenated `docker-compose` (Compose v1) | Machine has Compose v2 only (`docker compose`); v1 form absent | Used `docker compose` | Low | README command fails verbatim on modern Docker |
| 1b | `docker-compose.yml` | — | Declares obsolete `version: '3.8'` (warned + ignored by Compose v2) | Noted only | Low | Warning noise on every compose call |
| 2 | Install pnpm | `npm install -g pnpm` (latest) | **Confirmed:** repo pins `pnpm@10.27.0` via `packageManager`; README would install newer | Used `corepack` → exactly 10.27.0 | Low | Version drift → confusing install failures + inconsistent dep tree, undermining Cat 1/2 measurements |
| 3 | `pnpm install` postinstall | not mentioned | postinstall warns `comply` CLI missing; `CLAUDE.md` requires `comply opensource` in pre-commit hooks | Logged; resolve before first commit | Medium | New engineer hits failing pre-commit hook on first `git commit`. Affects audit's **commit-discipline** grading |
| 4 | `pnpm install` build scripts | not mentioned | pnpm 10 blocked native builds: `esbuild`, `leveldown`, `cpu-features`, `ssh2`, `protobufjs`, `@scarf/scarf` | Watch item — no action unless build/run fails (it didn't) | Low (watch) | If frontend build (`esbuild`) or Yjs persistence (`leveldown`) breaks later, suspect #1 |
| 5 | `docker-compose up -d` | assumes `:5432` free | `:5432` held by unrelated `prospector-db` container + a Colima SSH port-forwarder. Compose hardcodes `5432:5432` with **no** conflict handling — yet repo's `scripts/dev.sh` *does* auto-find free app ports (3000+/5173+) | Freed 5432 per user direction | Medium | README assumes a clean machine; multi-project dev boxes collide instantly. Inconsistent: app ports auto-resolve, DB port doesn't |
| 6 | (incident) | — | Misidentified Colima's SSH port-forwarder as a user tunnel and killed it → **Docker daemon went unreachable** | Diagnosed (Colima/Lima), `colima restart` recovered; OpenEMR stack auto-restarted (later stopped per user); `prospector-db` left stopped | Medium | Lesson: on this machine Docker = Colima; published-port forwarders are `ssh` procs. Identify the runtime before killing processes on shared ports |
| 7 | `docker compose up -d` | implies one command works | A container *created* during the failed (port-blocked) run had **no port binding**; a later `up -d` only *restarted* it (binding never appeared) → `db:seed` got `ECONNREFUSED` despite "healthy" | `docker compose down && up -d --force-recreate` | Medium | "Healthy" ≠ "reachable from host." Stale broken container is a silent trap; force-recreate after a failed up |
| 8 | Steps 5→6 order | seed **then** migrate | Reverse of conventional migrate→seed. Works only because `seed.ts` lays the full current schema and `migrate` then no-ops (`"schema already exists, continuing..."`) | Followed README order, documented | Medium | Fragile/confusing ordering; `CLAUDE.md`/`pnpm dev` use the correct migrate→seed. Doc + script divergence |
| 9 | `pnpm dev` (Step 7) | single command starts everything | API imports compiled `@ship/shared/dist` but `pnpm dev` starts `api` before the `shared` tsc-watch finishes first build → **race → API crash** on fresh install. `CLAUDE.md` documents `pnpm build:shared` first; README does **not** | `pnpm build:shared`, then restart `pnpm dev` → OK | **High** | A fresh engineer following only the README cannot start the app. Missing prerequisite step is the single biggest onboarding defect found |

#### docs/ summary (in my own words)

Read in full: `ship-philosophy.md`, `application-architecture.md`, `unified-document-model.md`, `document-model-conventions.md`. Remaining top-level docs swept via sub-agent for net-new decisions. (`docs/claude-reference/` is auto-generated reference — skipped for "decisions".)

**A. The product is an opinionated philosophy encoded as software.**
Ship is not a neutral task tracker. Hierarchy: `Programs → Projects → Weeks → Issues`.
- **Programs** never complete (permanent areas of responsibility).
- **Projects** are *scientific experiments*: a hypothesis scored with **ICE** (Impact × Confidence × Ease, max 125), ending **binary** — validated or invalidated, *no partial credit* (deliberately blocks goalpost-moving).
- **Weeks** are *derived* 7-day windows (computed from a workspace `sprint_start_date`, never stored) with exactly **one accountable human owner**; a person owns at most one week per window across all programs.
- **Issues** are a *trailing* indicator (what got done); the **weekly plan is the leading indicator** (declared intent). This is the core inversion vs. normal trackers.
- Accountability system layers on: non-dismissible action-item modal/banner on login, RACI (Responsible vs Accountable — only Accountable/admin approves), federal-holiday-aware due dates, "Changed Since Approved" re-approval state.

**B. The data model: "everything is a document."**
One `documents` table; `document_type` discriminates (`wiki`, `issue`, `program`, `project`, `sprint`, `weekly_plan`, `weekly_retro`, `person`, future `view`). Type-specific data lives in a schema-less **`properties` JSONB** column, structure enforced only by TypeScript (custom props without migrations). Rules of thumb: opens a full page → document; appears in a dropdown → configuration (states/labels are just strings in `properties`, not tables).
- **Relationships**: `parent_id` column = 1:1 hierarchy/containment only. All organizational many-to-many (program/project/week) goes through the **`document_associations`** junction table. Always use `api/src/utils/document-crud.ts` helpers — never raw association SQL.
- **Auth vs content are separate layers**: `workspace_memberships` (authorization, audited) vs `documents WHERE document_type='person'` (profile content). They connect only via `person.properties.user_id → users.id`. Permissions are **workspace-level only** (in or out; roles admin/member).

**C. Architecture decisions (the "boring technology" thesis).**
Four principles: *maximally simple, boring technology, single codebase, server is source of truth*. Notable, audit-relevant choices (with a dated **Decision Log** explaining the "why" — read it before "fixing" anything):
- **Raw `pg` SQL, no ORM** — intentional (full SQL control). Relevant to Cat 4 (DB query efficiency).
- **Two-layer caching**: Yjs + `y-indexeddb` for editor *content* (CRDT, offline-tolerant); TanStack Query + IndexedDB for *lists/metadata* (stale-while-revalidate, optimistic updates + rollback). **No offline writes** — an offline mutation queue *existed and was deliberately deleted* (Jan 2025) for being too complex/buggy.
- **Single Express process** serves REST *and* WebSocket (2 WS paths: `/collaboration/*` TipTap sync, `/events` accountability). Scaling implies sticky sessions.
- **E2E-heavy, Chromium-only** Playwright; unit tests only for complex logic by design. Directly relevant to Cat 5.
- **Deploy**: S3+CloudFront (web) / Elastic Beanstalk Docker (API) / Aurora Postgres. WebSocket needs an explicit CloudFront cache behavior (forward `Upgrade`/`Connection`/`Sec-WebSocket-*`, `ttl=0`) or it 404s.
- Gov constraints: Section 508/WCAG 2.1 AA strict, 15-min session timeout, CloudWatch-only (no Sentry/external APM), SSM/Secrets Manager for secrets, no external CDN/telemetry.
- API-first: everything doable in UI is an API; an MCP server auto-generates ~92 tools from the live OpenAPI spec.

**D. Doc → Audit Traceability Register.**

Keyed by audit category + source document, with the exact code location to verify each claim (the auditor's discipline: docs mix target/current/superseded — never trust prose, confirm in code during Tasks 5–6). IDs `D#` are referenced from the narrative above and will be promoted to baseline measurements in the Phase 1 audit report.

| ID | Audit Category | Source doc (lines) | Claim / Tension found in docs | Verify-by (code to check) | Severity |
|----|----------------|--------------------|-------------------------------|---------------------------|----------|
| D1 | Type Safety + DB Query | `unified-document-model.md` 500–508; `document-model-conventions.md` 233–240, 884–895 | Docs describe a *target* pure-JSONB properties model, simultaneously say "migration planned", *and* say legacy assoc columns (`program_id`/`project_id`/`sprint_id`) already **dropped** (mig 027/029). Prose mixes target/current/superseded. | `api/src/db/schema.sql` + `api/src/db/migrations/` — what columns actually exist now (Task 5) | High |
| D2 | Type Safety + Comprehension | `unified-document-model.md` 72, 156–171; `document-model-conventions.md` 173, 805 | `sprint → week` rename never propagated to DB/code: `document_type:'sprint'`, `sprint_iterations`, `sprint_number`, `sprint_start_date`, `getSprintAssociation()`. | grep `sprint` across `api/src`, `shared/`, `web/src` (Task 3/5). Discovery-write-up candidate. | Medium |
| D3 | Type Safety (Cat 1) | `document-model-conventions.md` 87–116; `unified-document-model.md` 237–297 | `properties` is `Record<string, any>` **by design** — model flexibility is built on `any`. "Eliminate 25% of `any`" must use real typed interfaces, not blanket `unknown`. | `shared/` property interfaces (`IssueProperties` etc.) vs actual usage (Task 3) | High (scoping) |
| D4 | Runtime Errors (Cat 6) | `developer-workflow-guide.md` 178–198 | Self-reported baseline UX ~2.5/10 with concrete broken flows (tab switching, issue→week 400, week-goal save 400, missing doc types). | Reproduce flows in running app; check `api/src/routes` for the 400s (Task 6) | Medium (defect leads) |
| D5 | API Response Time + DB (Cat 3/4) | `unified-document-model.md` 312–322; `document-model-conventions.md` 421–431 | Roll-ups (`count`/`sum`/`percent_complete`) computed on-demand client-side, **no caching** ("optimize later"). | Profile list endpoints under 500+ doc seed; client roll-up code in `web/src` (Cat 3/4 audit) | Medium |
| D6 | Onboarding (→ setup Finding #1) | `application-architecture.md` 686–700 | Architecture doc documents Docker-Postgres local setup, contradicting CLAUDE.md's "native Postgres". | n/a — already confirmed in setup; cross-ref Finding #1 | Low (corroborating) |
| D7 | Test Coverage (Cat 5) | `application-architecture.md` 481–520 | E2E-heavy, **Chromium-only**, unit tests only for "complex logic" by explicit decision — not an accident. | `playwright.config`, `e2e/`, vitest config (Cat 5 audit) | Info (intentional — frame, don't "fix") |
| D8 | Runtime Errors (Cat 6) | `application-architecture.md` 895–923 | Offline write queue **deliberately deleted** (Jan 2025) for complexity/bugs; "no offline writes" is intentional. | Confirm no mutation-queue code remains; don't propose re-adding | Info (intentional tradeoff) |

#### shared/ package notes

**Size & shape.** 469 LOC total. Pure types + a few constants + one helper (`computeICEScore`). `document.ts` (344) is ~73% of it. Build output is the contract: `main: ./dist/index.js`, `types: ./dist/index.d.ts`, `composite: true` project references → consumers import the *compiled* `dist/`. This **structurally explains setup Finding #9** (must build `shared` before `api`/`web`; race on fresh `pnpm dev`).

**The contract is thin by intent — and that's a risk.** `types/auth.ts` is empty: *"All auth types are defined locally in api/ and web/ packages."* So front and back **redefine auth types independently** → drift risk. What IS shared: `Document` + typed variants, property interfaces, `User`, `Workspace*`, `ApiResponse/ApiError`, `HTTP_STATUS`/`ERROR_CODES`, session timeouts (15-min idle, 12-hr absolute, cites NIST SP 800-63B-4 AAL2).

**Re-scopes Category 1 (Type Safety).** `shared/` is the *clean* layer: zero `any` (uses `unknown`), a real discriminated union on `document_type`, closed unions (`IssueState`, `IssuePriority`, `ICEScore`). The deliberate escape hatch is `[key: string]: unknown` on every `*Properties` interface + `Document.properties: Record<string, unknown>` (base is untyped; only the typed variants narrow it). **Implication: the `any` violations live in `api/`+`web/`, not here — don't waste Cat-1 effort in `shared/`.**

> **`unknown` interpretation note (per review question).** The `unknown`/`[key:string]:unknown` usage in `shared/` is **correct and intentional**, NOT a violation — `unknown` is the *safe* tool and the brief explicitly says swapping `any`→`unknown` without narrowing is *not* an improvement. Do **not** "fix" these. The genuinely fixable Cat-1 angle is **downstream** (see watch item S7): code that consumes a plain `Document` (losing discriminated-union narrowing) or reads `properties.x` then `as`-casts instead of narrowing. Revisit during the Category 1 audit.

**Contract Findings (same axis as the D-register; cross-refs in brackets).**

| ID | Audit Category | Source (shared/ file:line) | Finding | Verify-by | Severity |
|----|----------------|----------------------------|---------|-----------|----------|
| S1 | Type Safety + Comprehension [confirms D2] | `types/document.ts:289-292,154-156` | `WeekDocument` type ↔ `document_type:'sprint'`; `WeekProperties.sprint_number`; `BelongsToType` includes `'sprint'`; `WeeklyReviewProperties.sprint_id`. Name says Week, wire says sprint. | `schema.sql` enum + grep `sprint` in api/web (Task 5) | Medium (Discovery candidate) |
| S2 | Type Safety [resolves D1] | `types/document.ts:245-247` | `Document` explicitly drops `program_id/project_id/sprint_id` (cites mig 027/029), uses `belongs_to`. **Types are current; `unified-document-model.md` prose is stale.** Trust types over docs. | confirm no legacy cols in `schema.sql` (Task 5) | Low (doc-rot, not code) |
| S3 | Type Safety + Runtime (Cat 1/6) | `types/document.ts:47,73-74` vs docs | `IssueState` is a **closed 7-value union**; `IssueProperties.state: IssueState`. Docs claim "4 required + custom string". If workspaces really allow custom states, the type is wrong (or docs are). | check issue create/update validation in `api/src/routes` (Task 6) | Medium |
| S4 | Comprehension / API (Cat 6) | `types/api.ts:8-12` vs `application-architecture.md` | `ApiError = {code,message,details?}` but architecture doc says `{error,code?}`. Which does the API actually return? | inspect error middleware + a real 4xx response (Task 6) | Low |
| S5 | Type Safety + Runtime (Cat 1/6) | `types/auth.ts:1-2` | Auth types deliberately NOT shared; api/ and web/ define their own → silent drift if one side changes. | diff auth type defs in api/ vs web/ (Task 3 follow-up / Task 6) | Medium |
| S6 | Comprehension | `types/document.ts:34-44` vs docs | Enum has 10 types incl. `standup`,`weekly_review`; **no `'view'`** (docs list it as future). Comment claims "matching PostgreSQL enum". | diff against `schema.sql` enum (Task 5) | Low |
| S7 | Type Safety (Cat 1) — **WATCH** | `types/document.ts:241,247` (base `Document.content`/`.properties: Record<string,unknown>`) | `unknown` in `shared/` is correct/intentional. Fixable angle is **downstream consumption**: plain `Document` usage discards the typed-variant narrowing; `properties.x` reads + `as` casts instead of discriminated-union narrowing. Real, measurable Cat-1 target that preserves the safe design. | grep `as ` casts + `.properties` access in `api/src`, `web/src`; quantify during Cat 1 | Watch (revisit Cat 1) |

#### Package diagram (web/ ↔ api/ ↔ shared/)

**Two distinct connection layers — do not conflate.**

```
BUILD-TIME (compile dependency graph — order is forced)

        shared/  (no deps; pure TS types + constants + computeICEScore)
        │  tsc, composite project refs → emits dist/index.js + .d.ts
        ├──────────────► api/   "@ship/shared": "workspace:*"  (pnpm symlink)
        │                       imports VALUES+TYPES (SESSION_TIMEOUT_MS,
        │                       ERROR_CODES, HTTP_STATUS, Document types…)
        └──────────────► web/   "@ship/shared": "workspace:*"
                                imports mostly `import type {…}`  → ERASED at build
        ⇒ Build order: shared → (api, web).  Root cause of setup Finding #9.
        ⇒ Cat 2: shared/ contributes ~0 to web bundle (types erased).


RUN-TIME (network — dev topology)

  ┌──────────┐   http://localhost:5173 (Vite dev server, strictPort)
  │ Browser  │   React + TanStack Query (REST) + Yjs (WS) + IndexedDB cache
  └────┬─────┘
       │ all traffic hits Vite origin only
       ▼
  ┌──────────────── Vite proxy (vite.config.ts) ────────────────┐
  │  /api           → http://localhost:3000        (HTTP)        │
  │  /collaboration → http://localhost:3000  ws:true (WebSocket) │
  │  /events        → http://localhost:3000  ws:true (WebSocket) │
  └────────────────────────────┬────────────────────────────────┘
                                ▼  (port read from .ports file; multi-worktree)
  ┌───────────────────────── api/ : ONE Node process, ONE port 3000 ──────────┐
  │ index.ts → createApp(Express, CORS) + http.createServer                    │
  │            + setupCollaboration(server)  ← ws / y-websocket on same server │
  │  REST  /api/*            (documents, issues, programs, weeks, auth…)       │
  │  WS    /collaboration/*  Yjs CRDT editor sync                              │
  │  WS    /events           accountability live updates                      │
  │  server timeouts hardened (Slowloris): 60s/65s/66s                         │
  │  env: .env.local then .env ; SSM secrets only if NODE_ENV=production       │
  └────────────────────────────┬──────────────────────────────────────────────┘
                                ▼  pg Pool (only api/ touches the DB)
                       ┌──────────────────┐
                       │   PostgreSQL     │  source of truth
                       └──────────────────┘

  PROD differs: no Vite — CloudFront does the /api,/collaboration,/events routing
  (S3 = web static, Elastic Beanstalk = api, Aurora = db). See app-architecture.md.
```

**Audit-relevant notes (cross-axis):**

| ID | Audit Category | Source | Note | Severity |
|----|----------------|--------|------|----------|
| P1 | API Response Time (Cat 3) — **method** | `web/vite.config.ts:29-43`, `api/src/index.ts:24-39` | Benchmark the API **directly on :3000**, never via the Vite :5173 proxy, or numbers measure the proxy. Pin the port from `.ports`. | Method (mandatory for valid Cat 3) |
| P2 | API Response Time (Cat 3) — hypothesis | `api/src/index.ts:27-36` | REST + both WS channels share **one process / one event loop**. Heavy Yjs/collab load can degrade REST P95. Test under concurrent WS + REST. | Medium (hypothesis to test) |
| P3 | Bundle Size (Cat 2) — scoping | `web/` imports of `@ship/shared` | `shared` reaches web as `import type` → erased; **not** a bundle contributor. Look for bloat in web's real deps, not shared/. | Info (scoping) |
| P4 | Type Safety / Comprehension [→ S5] | `api/src/middleware/auth.ts`, web auth code | Only `api/` consumes `shared` runtime values; `web` is type-only. Auth types unshared (S5) → drift risk is real, not theoretical. | cross-ref S5 |

### 2. Data Model

Sources: `api/src/db/schema.sql` (437 LOC, consolidated *current* snapshot), `api/src/db/migrations/` (42 files, 001→037).

**Table inventory (17 tables).**

| Group | Tables |
|-------|--------|
| Identity/Auth | `users`, `workspaces`, `workspace_memberships`, `workspace_invites`, `sessions`, `oauth_state`, `api_tokens` |
| Content (the model) | **`documents`** (one table, all types), `document_associations` (junction), `document_history` (field audit), `document_snapshots` (pre-conversion undo), `document_links` |
| Work tracking | `sprint_iterations` (week-level, Claude `/work`), `issue_iterations` (issue-level) |
| Misc | `audit_logs`, `files`, `comments` |

**How one table serves docs/issues/projects/weeks (the unified model, verified in DDL).**
- `documents.document_type` is a PG **enum** discriminator: `wiki, issue, program, project, sprint, person, weekly_plan, weekly_retro, standup, weekly_review` (10; **no `view`**).
- Columns shared by ALL types: `id, workspace_id, document_type, title('Untitled' default), content JSONB (TipTap), yjs_state BYTEA, parent_id, position, properties JSONB, ticket_number, archived_at, deleted_at, status timestamps, conversion fields, visibility('private'|'workspace')`.
- **Three relationship mechanisms, by design:** (1) `parent_id` self-FK = hierarchy/containment, with a recursive `prevent_circular_parent` trigger (max depth 100) + self-parent CHECK; (2) **`document_associations`** junction (`relationship_type` enum `parent|project|sprint|program`, unique triple, no self-ref) = all org membership; (3) `properties` JSONB = everything type-specific (typed only in TS).
- Legacy separate tables actively destroyed: `DROP TABLE IF EXISTS sprints, projects CASCADE` at end of schema — enforces "everything is a document".
- Indexing (matters for Cat 4): **GIN index on `properties`**, expression index `idx_documents_person_user_id` on `(properties->>'user_id') WHERE document_type='person'`, partial `idx_documents_active`. JSONB filters are *not* automatically full scans.

**Reconciliation verdicts (closes prior verify-by debts):**

| Register item | Verdict after reading schema | Action |
|---------------|------------------------------|--------|
| **D1 / S2** | **RESOLVED.** No `program_id/project_id/sprint_id` columns (comment cites mig 027/029). `shared/` types + `document-model-conventions.md` correct; `unified-document-model.md` prose **stale**. | Trust types/schema; flag doc as rotted |
| **S6** | **RESOLVED.** PG `document_type` enum == `shared/` `DocumentType` exactly (10, no `view`). | shared↔schema in sync; doc stale |
| **D2** | **CONFIRMED + DEEPER.** `033_sprint_to_week_rename.sql` exists, yet enum value `'sprint'`, `relationship_type 'sprint'`, table `sprint_iterations` + indexes all remain. Rename stopped at data layer (risky to rename PG enums/tables). | Promote to **primary Discovery write-up** |
| **#8** | **EXPLAINED.** `schema.sql` is consolidated-current (references mig 027/029, has mig-035 `comments`), so seed lays full schema → migrate no-ops. | Close as understood |

**New data-model findings:**

| ID | Audit Category | Source | Finding | Severity |
|----|----------------|--------|---------|----------|
| DM1 | Type Safety + Comprehension [⇒ D2] | `schema.sql:100,203,270`; `migrations/033,015b,026` | Dual debt: (a) sprint→week rename never reached DB enums/tables despite migration 033; (b) **two** iteration tables (`sprint_iterations` week-level vs `issue_iterations` issue-level) with overlapping purpose. High onboarding-confusion. | Medium (Discovery) |
| DM2 | DB Query Efficiency (Cat 4) — scoping | `schema.sql:355-368` | `properties` has a GIN index + targeted partial/expression indexes already exist. Cat-4 baseline must `EXPLAIN ANALYZE` real queries — don't assume JSONB = seq scan. Look for *missing* composite indexes on association-join + `properties->>` filters not covered. | Method (Cat 4) |
| DM3 | Runtime Errors (Cat 6) — positive | `schema.sql:106-208` | Edge handling partly present: circular-parent trigger, self-parent CHECK, soft-delete (`deleted_at` 30d) vs `archived_at`, conversion snapshots. Frame Cat-6 around what's *missing*, not absent basics. | Info (scoping) |
| DM4 | Commit Discipline / DB process | `migrations/024,007b,014b,015b,018b,020b` | Migration-numbering collisions happened (dedicated `024_renumber_collision_migrations.sql` + b-suffixed files). Process smell; relevant context for any new migration we add in Phase 2. | Low |
| DM5 | Comprehension (doc-rot) | `schema.sql:128-132` comments | In-file comments still describe `Sprint properties: start_date, end_date, sprint_status` though `shared/` `WeekProperties` computes dates (not stored). Even the schema's own comments drifted. | Low |

### 3. Request Flow

**Traced action: create an issue.** Sources: `web/src/hooks/useIssuesQuery.ts`, `web/src/lib/api.ts`, `api/src/app.ts`, `api/src/middleware/auth.ts`, `api/src/routes/issues.ts`.

```
Browser: useCreateIssue() [TanStack useMutation]
  └─ onMutate: optimistic Issue (temp-uuid) inserted into query cache  ← instant UI
  └─ mutationFn → apiPost('/api/issues', data)   (web/src/lib/api.ts)
       1. GET /api/csrf-token            (credentials:'include')
       2. POST /api/issues  headers:{x-csrf-token}, cookie session, JSON body
            │  dev: → Vite :5173 proxy → API :3000   (prod: CloudFront)
            ▼
API middleware chain (order is significant):
  helmet → apiLimiter(/api/) → cors(credentials) → express.json(10mb)
  → cookieParser → express-session(15m cookie) → conditionalCsrf
        (Bearer? skip CSRF : enforce csrf-sync)  → route
            ▼
  authMiddleware  (api/src/middleware/auth.ts)
    • Bearer path: SHA-256 hash → api_tokens lookup, expiry/revoke check
    • Session path: sessions lookup; enforce ABSOLUTE_SESSION_TIMEOUT_MS (12h)
      AND SESSION_TIMEOUT_MS (15m idle); DELETE session if expired (401)
    • UPDATE sessions SET last_activity  ← write on EVERY request
    • sets req.userId, req.workspaceId
            ▼
  POST '/' handler (routes/issues.ts:563)
    • createIssueSchema.safeParse(req.body) → 400 {error,details} on fail
    • BEGIN
    • pg_advisory_xact_lock(hash(workspaceId))   ← serialize ticket numbers
    • SELECT MAX(ticket_number)+1  WHERE workspace_id, document_type='issue'
    • INSERT INTO documents (... document_type='issue' ...) RETURNING *
    • for assoc in belongs_to: INSERT document_associations ON CONFLICT DO NOTHING
    • COMMIT
    • [post-commit] per-sprint-assoc COUNT(*) → broadcastToUser WS 'accountability:updated'
    • 201 {...issue, display_id:'#<ticket>'}
            ▼
Browser: onSuccess replaces temp row with real row; onError → rollback + toast
```

**Middleware chain (what runs before every API request):** `helmet` (CSP, HSTS) → `apiLimiter` (100/min prod, 1000 dev) → `cors` (credentialed, single origin) → body parsers (10 MB) → `cookieParser` → `express-session` → `conditionalCsrf` → per-route `authMiddleware`. Public exceptions mounted *before* protected routes: `/health`, `/api/csrf-token`, Swagger, `/api/setup`, public feedback, `/api/auth/login` (extra `loginLimiter` 5 fails/15min), read-only GET routers (`search`, `activity`, `dashboard`, `accountability`, `claude`) skip CSRF by design.

**Auth model:** session cookie (browser, PIV/CAIA or password) **or** `Bearer ship_<hex>` API token (CLI/Claude). Unauthenticated request → `authMiddleware` returns 401 (`ERROR_CODES`/`HTTP_STATUS` from `shared/`) before any handler logic. Workspace scoping via `req.workspaceId` from the session/token row; extra guards `superAdminMiddleware`/`workspaceAdminMiddleware` where needed.

**Request-flow findings:**

| ID | Audit Category | Source | Finding | Severity |
|----|----------------|--------|---------|----------|
| RF1 | Type Safety (Cat 1) | `routes/issues.ts:32` vs `shared/types/document.ts:50` vs `useIssuesQuery.ts:223` | Priority enum **drift**: API Zod accepts `'none'`, web optimistic issue sets `priority:'none'`, but `shared/` `IssuePriority` has no `'none'`. Contract ↔ validator ↔ client disagree. Concrete, provable Cat-1 item. | Medium |
| RF2 | API Response Time (Cat 3) — hypothesis | `middleware/auth.ts:127,206` | Every authed request does a `sessions` SELECT **and** an `UPDATE sessions SET last_activity`. ≥2 DB round-trips + a write before any handler. Prime P95 bottleneck under concurrency. | High (test in Cat 3) |
| RF3 | DB Query Efficiency (Cat 4) | `routes/issues.ts:638-653` | Post-`COMMIT` loop issues a `COUNT(*)` per `sprint` association (outside txn). Bounded but unnecessary round-trips; pattern to watch elsewhere (lists). | Low |
| RF4 | Runtime Errors (Cat 6) — positive | `routes/issues.ts:585-636` | Create is transactional (BEGIN/COMMIT) + advisory-locked + Zod-validated + optimistic rollback client-side. Mature. Frame Cat-6 around *missing* coverage, not this path. | Info (scoping) |
| RF5 | API Response Time (Cat 3) — surface | `app.ts:142` | `express.json({limit:'10mb'})` — large bodies parsed on the shared event loop (REST+WS same process, see P2). Consider when load-testing big payloads. | Low |
| RF6 | Runtime Errors (Cat 6) | `routes/issues.ts:241,332,...` | Error responses are bare `res.status(500).json({error:'Internal server error'})` — shape `{error}` (matches docs, contradicts `shared/` `ApiError {code,message,details}` → confirms S4). No central error handler observed; per-route try/catch. | Medium |

---

## Phase 2: Deep Dive

### 4. Real-time Collaboration

Source: `api/src/collaboration/index.ts` (834 LOC), `web/src/components/Editor*.tsx`.

**Connection establishment.** One HTTP server; `server.on('upgrade')` dispatches by URL path to two `WebSocketServer({noServer:true, maxPayload})` instances: `/collaboration/<type:uuid>` (Yjs editor) and `/events` (notifications). Handshake order: per-IP connection rate-limit (30/min) → `validateWebSocketSession` (parses `cookie` header → `sessions` lookup, enforces idle 15m + absolute 12h, updates `last_activity`) → `canAccessDocumentForCollab` (visibility/workspace) → `handleUpgrade`. Failures: 429 / 401 / 403 *before* any Yjs.

**Yjs sync.** Standard `y-protocols/sync` + `awareness`. On connect: server sends syncStep1 + current awareness states. `doc.on('update')` re-broadcasts the binary delta to every other socket in the same room (skip origin, only `readyState===OPEN`). Two users editing the same field simultaneously → Yjs CRDT auto-merges (conflict-free by construction); the in-memory `Y.Doc` per room is the live authority.

**Server persistence.** `docs: Map<docName, Y.Doc>` in process memory. Saves **debounced 2000 ms** (`schedulePersist`, timer reset on every update). `persistDocument`: `Y.encodeStateAsUpdate` → SELECT existing props/type/content/created_by → (weekly_plan/retro only) throttled `INSERT document_history` (≤1/min) → single `UPDATE documents SET yjs_state, content, properties, updated_at`. `content` JSON kept in lockstep with `yjs_state` as API-read fallback. Last client disconnect → immediate final persist, doc kept 30 s for quick reconnect, then evicted. Load path prefers `yjs_state`; else converts JSON `content` (API-created docs), flags `freshFromJsonDocs` → sends `messageClearCache` so the browser drops stale IndexedDB before sync.

**Source of truth on reconnect:** server's persisted `yjs_state`; client offline edits (y-indexeddb) re-merge via CRDT on reconnect (no data loss *if* they reach the server).

**Real-time collaboration findings:**

| ID | Audit Category | Source | Finding | Severity |
|----|----------------|--------|---------|----------|
| RT1 | Runtime Errors (Cat 6) — **data loss** | `collaboration/index.ts:111-180,181-189` | Persistence is in-memory + 2 s-debounced + **failure-silent** (`persistDocument` catch only `console.error`). DB write failure, or process death between debounced saves, loses ≥2 s of edits with **no user signal**. Strong candidate for Cat-6's required "≥1 real data-loss scenario". | High |
| RT2 | API Response Time (Cat 3) + Phase 3 "10×" | `collaboration/index.ts:97-180`; `app.ts:142` | All `Y.Doc`s in one process's memory; persist = multi-query write-amplification serializing full JSON+binary (10 MB bodies allowed) on the shared REST/WS event loop. Memory + write storms = first failure at scale. | High (hypothesis) |
| RT3 | Runtime Errors (Cat 6) — hypothesis | `collaboration/index.ts:691-704` | `freshFromJsonDocs.delete()` after **first** client → near-simultaneous 2nd client on an API-created doc can miss `messageClearCache` and merge stale IndexedDB content (data confusion). Testable with two tabs. | Medium |
| RT4 | Runtime Errors (Cat 6) — positive/scoping | `collaboration/index.ts:610-682,705-790` | Auth+rate-limit+visibility before upgrade; message size/rate caps + progressive penalties; final-persist-on-disconnect; JSON-fallback cache-clear handshake. Mature — frame Cat-6 around RT1/RT3, not basics. | Info |
| RT5 | Comprehension [⇒ D2] | `collaboration/index.ts:102-105` | Room/`parseDocId` comments still enumerate `sprint`; naming debt reaches the realtime layer too. | Low |

### 5. TypeScript Patterns

TS `^5.7.2` declared in all 4 packages (root install resolved 5.9.3). `module/moduleResolution`: `NodeNext` (root/api), `bundler` (web).

**Strict mode = ON, stricter than default.** Root `tsconfig.json`: `strict` + `noUncheckedIndexedAccess` + `noImplicitReturns` + `noFallthroughCasesInSwitch` + `forceConsistentCasingInFileNames` + `isolatedModules`, `skipLibCheck`. `api/` & `shared/` `extends: "../tsconfig.json"`. **`web/tsconfig.json` does NOT extend root** — own config, `strict:true` but missing the three extra strictness flags + `noEmit:true` + `moduleResolution:bundler`. ⇒ **Audit Cat-1 deliverable: "Strict mode enabled? = YES"** (skip the `tsc --strict` count path).

**Baseline type-safety counts** (non-test `src/`, regex — upper-bound, refine with ESLint in real audit):

| Pkg | files | LOC | `any` | `as` assert | `!` | @ts-ignore |
|-----|-------|-----|-------|-------------|-----|------------|
| api | 81 | 35,344 | ~59 | ~48 | ~1 | 0 |
| web | 182 | 44,109 | ~29 | **~203** | ~2 | 0 |
| shared | 8 | 469 | **0** | **0** | 0 | 0 |
| **Σ** | 271 | 79,817 | **~88** | **~251** | ~3 | **0** (1 incl tests) |

Top `any`-dense: `api/routes/projects.ts`(13), `api/utils/yjsConverter.ts`(12), `api/routes/weeks.ts`(10), `api/types/y-protocols.d.ts`(7), `web/components/editor/FileAttachment.tsx`(7), `web/components/editor/SlashCommands.tsx`(6).

**Patterns found (deliverable 2.5):** generics (`ApiResponse<T>` `shared/types/api.ts`); discriminated union (`Document`+variants on `document_type`, narrowed at `api/src/routes/documents.ts:265-295`); ~290 utility-type uses (`Partial/Pick/Omit/Record/…`); 8 type-guard predicates (`isValidRelationshipType(value:unknown): value is RelationshipType` `routes/associations.ts:36`; `isCascadeWarningError` web). Advanced/less-common: hand-written ambient `.d.ts` shim for an untyped dep (`api/src/types/y-protocols.d.ts`).

**TypeScript-patterns findings:**

| ID | Audit Category | Source | Finding | Severity |
|----|----------------|--------|---------|----------|
| TS1 | Type Safety (Cat 1) — baseline | `tsconfig.json`, `api/web/shared tsconfig` | Strict ON. **Inconsistency:** web doesn't extend root → loses `noUncheckedIndexedAccess`/`noImplicitReturns`/`noFallthroughCasesInSwitch`. Aligning web = measurable Cat-1 win (will surface new errors to fix). | Medium |
| TS2 | Type Safety (Cat 1) — scoping [⇒ S7] | counts above | Violations concentrate: `any` in **api/** (59), `as` casts dominate **web/** (~203). `shared/`=0. Target api `any` + web `as`-cast narrowing; ignore shared. | High (scoping) |
| TS3 | Type Safety (Cat 1) — methodology | this section | Counts are regex upper-bounds (`as const`, `as React.X` inflate `as`). Real audit must use ESLint `@typescript-eslint/no-explicit-any` + precise matcher; report tool + exact numbers. | Method (mandatory) |
| TS4 | Type Safety (Cat 1) — candidate | `api/src/types/y-protocols.d.ts` | Hand-written ambient shim for untyped `y-protocols` concentrates `any` (7). Typing it properly preserves behavior, removes real `any`s, demonstrates TS depth — strong Phase-2 fix candidate. | Medium |
| TS5 | Type Safety (Cat 1) — candidate | `api/routes/projects.ts`(13), `weeks.ts`(10), `utils/yjsConverter.ts`(12) | Highest-density real-code `any` files (not shims/tests). Best ROI targets for the "25% reduction" with genuine typed interfaces. | Medium |

### 6. Testing Infrastructure

Two systems. **Unit:** `vitest`. `pnpm test` (root) = `pnpm --filter @ship/api test` **only**. api: 28 files, `fileParallelism:false` (sequential files → avoid DB conflicts), real Postgres via `src/test/setup.ts`, v8 coverage configured (`text,html`) but not enforced/gated. web: 16 unit test files (**not run by root `pnpm test`**). **E2E:** Playwright, `testDir:./e2e`, `fullyParallel`, retries 2 CI / 1 local, **testcontainers per-worker isolation** (each worker = own Postgres container + API + Vite *preview*), memory-aware `getWorkerCount()` (reserve 2 GB, `min(memLimit,cpuCores)`).

**Test DB lifecycle:** unit → shared running Postgres + `src/test/setup.ts`. E2E → ephemeral per-worker testcontainers Postgres (auto create/destroy) + `e2e/global-setup.ts`.

**Baseline measured (unit, safe to run):** `pnpm --filter @ship/api test` → **28 files / 451 tests / 100% pass / 16.24 s**. E2E NOT run (CLAUDE rule — output explosion; use `/e2e-test-runner`).

**Counts:** 71 E2E spec files; **~882 `test()`** (regex). `test.fixme`=2, `test.skip`=0.

**Testing-infra findings:**

| ID | Audit Category | Source | Finding | Severity |
|----|----------------|--------|---------|----------|
| TI1 | Test Coverage (Cat 5) — baseline | `playwright.config.ts`, PRD/README/CLAUDE | Docs say "73+ tests"; reality ≈ **882 tests across 71 specs** (~10× undercount; "73" ≈ spec-file count, mislabeled). Cat-5 baseline must be gathered via `/e2e-test-runner`, reported as test count + pass/fail + runtime. | Medium |
| TI2 | Test Coverage (Cat 5) | root `package.json` `test` | `pnpm test` runs **api unit only**; 16 `web/` unit files excluded → silent coverage blind spot; audit "run pnpm test" deliverable misses web. Adding web to the script = legit Cat-5 improvement. | Medium |
| TI3 | Test Coverage (Cat 5) — method | `api/vitest.config.ts` | v8 coverage configured but never reported/gated; web has none. Cat-5 wants per-package %. Wire up + report = deliverable. | Method |
| TI4 | Test Coverage (Cat 5) — flakiness | `playwright.config.ts` retries; git log `58dba17 "harden E2E against flakiness under parallel load"` | Local retry=1 masks flakes; recent commits explicitly fight parallel-load flakiness → known flake history. Fix-3-flakes-with-RCA path is viable for Cat 5. | Medium |
| TI5 | Phase 3 "strongest decisions" — positive | `playwright.config.ts` | Per-worker testcontainers isolation (own PG+API+preview) = zero shared test state. Architecturally strong; cite in synthesis. | Info |
| TI6 | Runtime/Infra — improvement candidate | `playwright.config.ts` header (90GB crash history) | Already mitigated (vite preview + mem-aware workers). Further hardening ideas logged: single PG + DB-per-worker (N→1 containers), memory-first hard worker ceiling, `--max-old-space-size`, container `--memory` caps, RSS watchdog in global-setup, CI sharding, guaranteed teardown/reaper. Candidate Phase-2 infra improvement. | Low (opportunity) |

### 7. Build & Deploy

**Artifacts:** `Dockerfile` (api: `node:20-slim` from ECR Public, installs `pnpm@9.15.4`, `pnpm install --prod --ignore-scripts`, then **COPYs pre-built `shared/dist` + `api/dist`** — does NOT build in-image; `CMD node dist/db/migrate.js && node dist/index.js`, port 80, `NODE_ENV=production`). Also `Dockerfile.web`, `Dockerfile.dev`. Compose: `docker-compose.yml` (dev PG, "optional"), `docker-compose.local.yml`. **No `docker-compose.prod.yml`.**

**Infra:** Terraform, 42 `.tf` — `elastic-beanstalk`, `database`(RDS Aurora), `s3-cloudfront`, `waf`, `vpc`, `ssm`, `security-groups`, `cloudfront-logging`, `bootstrap/`. Matches `application-architecture.md` deploy diagram.

**CI/CD:** **none** (no `.github/`, GitLab, Circle). Deploy = manual scripts: `scripts/deploy.sh`, `deploy-api.sh`, `deploy-frontend.sh`/`deploy-web.sh`, `deploy-infrastructure.sh`, `terraform.sh`, `init-database.sh`, `copy-db-to-shadow.sh`. Intentional (Decision Log: "manual deploys, add CI/CD when painful").

**api build script:** `tsc && cp src/db/schema.sql dist/db/ && cp -r src/db/migrations dist/db/` (migrations shipped into image).

**Build & deploy findings:**

| ID | Audit Category | Source | Finding | Severity |
|----|----------------|--------|---------|----------|
| BD1 | Reproducibility / [⇒ #9] | `Dockerfile:18-22` | Image **copies pre-built `dist/`**, doesn't build. Non-hermetic: forgetting `pnpm build` (esp. `shared`) ships stale code silently. Undermines reproducible-benchmark mandate. | Medium |
| BD2 | Type Safety/Bundle baseline integrity [⇒ #2] | `Dockerfile:11` vs `package.json packageManager` | Prod uses `pnpm@9.15.4`; repo pins `10.27.0`. Different resolver than dev/lockfile → prod artifact may differ from what we audit (Cat 1/2). | Medium |
| BD3 | Test Coverage / Commit discipline (Cat 5) | absence of CI | No automated test/type/lint gate before manual deploy. "Tests must still pass" has no enforcement. Intentional, but a real risk to surface. | Medium |
| BD4 | Comprehension (doc drift) | `Dockerfile:31` vs `application-architecture.md:642` | Migrations auto-run every container start (`CMD`), docs say "manual/deploy script". Drift + op note (idempotent via `schema_migrations`). | Low |
| BD5 | Context (not a defect) | `Dockerfile:7-11`, `terraform/waf.tf` | Gov adaptations: `strict-ssl false`, ECR mirror (Docker Hub blocked), WAF/VPC/SSM IaC. Explains "boring/gov-compliant"; don't "fix". | Info |
| BD6 | Phase 3 "strongest decisions" — positive | `terraform/*` (42 tf) | Reasonably complete IaC (WAF, VPC, RDS, CloudFront, SSM, bootstrap) for a small team. Cite in synthesis. | Info |

---

## Phase 3: Synthesis (Architecture Assessment)

### 3 strongest architectural decisions
1. **Unified document model with TS-enforced JSONB** (`shared/types/document.ts`, `schema.sql`). One table + `document_type` discriminant + typed variants over `Record<string,unknown>`. New types/properties need no migration; discriminated unions give app-layer safety. Coherent and cleanly executed.
2. **Per-worker testcontainers isolation** (`playwright.config.ts`). Each E2E worker gets its own ephemeral Postgres+API+preview → zero shared test state, the dominant E2E-flake cause designed out.
3. **"Boring technology" + a dated Decision Log** (`application-architecture.md`, `document-model-conventions.md`). Raw `pg`, single process, manual deploys — *with documented rationale and explicitly deleted features*. This is what makes the system auditable and is why this orientation was tractable.

### 3 weakest points (focus areas)
1. **Systemic documentation rot.** README ⊥ CLAUDE.md ⊥ docs ⊥ schema ⊥ types disagree (DB setup #1/D6, "73+"=882 TI1, sprint/week D2, dropped columns D1). Highest onboarding tax; cheap, high-value fixes.
2. **Realtime durability (RT1).** In-memory + 2 s-debounced + failure-silent persistence = real data-loss path. Highest-severity correctness issue found.
3. **No build/test gate (BD1–BD3).** Non-hermetic Docker (copies prebuilt dist), pnpm 9 vs 10 drift, zero CI → stale/unverified code can ship.

### What breaks first at 10× users
The **single Node process** (REST + both WS channels + in-memory Y.Docs, one event loop):
1. `Y.Doc` memory accumulation + persist write-amplification (full JSON+binary, 10 MB bodies) on the shared loop (**RT2**).
2. Per-request `SELECT`+`UPDATE sessions.last_activity` on every authed call saturates the DB (**RF2**).
3. Client-side uncached roll-ups over 10× documents (**D5**).
No horizontal scale path without sticky sessions for WS. Order of failure: memory → DB write saturation → frontend compute.

### What to tell a new engineer first
> "`sprint` in code/DB = **week** in the product. Everything is a row in `documents`. **Trust the types and `schema.sql`, not the prose docs** — docs describe target/current/superseded simultaneously. You must `pnpm build:shared` before `api`/`web` run. Read the Decision Logs before 'fixing' anything — many odd choices are deliberate (offline queue was *removed* on purpose)."

### Discovery write-up candidates (rubric deliverable — 3 things newly learned)

| # | Discovery | Where | What it does / why it matters | How I'd reuse it |
|---|-----------|-------|-------------------------------|------------------|
| 1 | **`pg_advisory_xact_lock` for per-tenant sequence generation** | `api/src/routes/issues.ts:590-601` | Transaction-scoped Postgres advisory lock keyed by workspace makes `MAX(ticket_number)+1` race-free per tenant without a global SERIAL — per-tenant monotonic IDs, no cross-tenant contention. | Any per-tenant counter (invoice #s, order #s) needing gap-free per-tenant sequences. |
| 2 | **CRDT↔REST reconciliation via custom `messageClearCache` WS frame** | `api/src/collaboration/index.ts:170-176,261-279,691-704` | JSON `content` mirrored to binary `yjs_state` as an API-readable fallback; a bespoke protocol message tells the browser to wipe IndexedDB before sync to prevent stale-CRDT merge corruption. Bridges the offline-CRDT and REST worlds. | Any app mixing a CRDT editor with REST reads of the same data. |
| 3 | **Hand-written ambient `.d.ts` shim for an untyped dependency** | `api/src/types/y-protocols.d.ts` | Types a JS-only library at the boundary so the rest of the codebase stays strict — confines `any` to one declared seam. | Adopting any untyped/loosely-typed npm dep without `@types`. |

---

## Appendix: Finding Register Index (how to use these notes)

Three artifacts, three axes:
- **Setup Deviations table** (#1–#9) — onboarding axis (run-the-app gaps).
- **Narrative summaries** — comprehension (system mental model).
- **Audit registers** — keyed to the 7 graded categories. Filter by `Audit Category` when writing each audit section.

| Register | IDs | Where | Primary audit categories |
|----------|-----|-------|--------------------------|
| Doc → Audit | D1–D8 | §1 docs summary | Type Safety, DB, Cat 3/4/5/6 |
| shared/ Contract | S1–S7 | §1 shared notes | Type Safety (Cat 1), Cat 6 |
| Package wiring | P1–P4 | §1 diagram | Cat 2/3 (method) |
| Data Model | DM1–DM5 | §2 | Cat 1/4/6 |
| Request Flow | RF1–RF6 | §3 | Cat 1/3/4/6 |
| Realtime | RT1–RT5 | §4 | Cat 6 (RT1 = data-loss), Cat 3 |
| TypeScript | TS1–TS5 | §5 | Cat 1 (baseline + targets) |
| Testing | TI1–TI6 | §6 | Cat 5 |
| Build/Deploy | BD1–BD6 | §7 | Reproducibility, Cat 5 |

**Resolved verify-by debts:** D1/S2 (no legacy cols — types correct, prose stale), S6 (enum in sync), #8 (schema.sql is consolidated-current), D2 (sprint→week confirmed pervasive, promoted to Discovery #—see DM1).

**Orientation status:** Phase 1 (First Contact) ✅ · Phase 2 (Deep Dive) ✅ · Phase 3 (Synthesis) ✅ — orientation checklist complete.
