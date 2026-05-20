# Discovery Write-up — 3 Things I Didn't Know Before

> ShipShape rubric deliverable. Three patterns/techniques in Treasury/ship that were new to me,
> each with: **what** it is, **where** it lives (file + line range), **what it does and why it matters**,
> and **how I'd apply it** in a future project. Discovered during the Phase-0 orientation pass; the
> running notes that produced these are in [`ORIENTATION_NOTES.md`](ORIENTATION_NOTES.md).

---

## Discovery 1 — `pg_advisory_xact_lock` for gap-free per-tenant sequence numbers

**Where:** [`api/src/routes/issues.ts:587-601`](api/src/routes/issues.ts#L587-L601)

**What it does / why it matters.** Ship gives every issue a human-facing per-workspace ticket number
(e.g. `ENG-14`). The naive way — `SELECT MAX(ticket_number)+1` then `INSERT` — has a classic race: two
concurrent creates read the same `MAX` and collide. A global `SERIAL`/sequence would be race-free but
leaks gaps across tenants and couples all workspaces to one counter. Ship instead takes a
**transaction-scoped Postgres advisory lock keyed by the workspace** before computing the next number:
it derives an integer lock key from the workspace UUID (`parseInt(workspaceId.replace(/-/g,'').substring(0,15), 16)`)
and calls `SELECT pg_advisory_xact_lock($key)` inside the `BEGIN`. The lock is held only for the
transaction, serializes *just the creates within one workspace*, auto-releases on commit/rollback (no
leak if the request dies), and lets different workspaces proceed in parallel. It's a way to get a
per-tenant critical section without a separate lock table or an external mutex. (One subtlety worth
flagging in a review: truncating the UUID to 15 hex chars means the key space isn't collision-free —
two workspaces could share a lock key and serialize unnecessarily, though never *incorrectly*.)

**How I'd apply it.** Any time I need a per-tenant monotonic, gap-free counter — invoice numbers, order
numbers, per-org document IDs — `pg_advisory_xact_lock` keyed by the tenant id is a lightweight,
crash-safe alternative to either a global sequence (gaps, contention) or application-level locking
(fragile across processes). It keeps the critical section inside the same transaction as the write, so
there's no window where the lock is held but the write hasn't happened.

---

## Discovery 2 — CRDT ↔ REST reconciliation via a custom `messageClearCache` WebSocket frame

**Where:** [`api/src/collaboration/index.ts:17`](api/src/collaboration/index.ts#L17) (the custom message constant) and [`:695-704`](api/src/collaboration/index.ts#L695-L704) (encode + send)

**What it does / why it matters.** Ship has a genuine dual-source-of-truth problem: the editor body lives
as a **Yjs CRDT** (binary `yjs_state`, synced over WebSocket, cached offline in IndexedDB), but the same
content is *also* mirrored to a JSON `content` column so the REST API and non-editor surfaces can read it
without instantiating a Y.Doc. The danger is a stale client: a browser holding an out-of-date IndexedDB
copy can reconnect and *merge its stale CRDT state back in*, silently resurrecting deleted content. Ship
defends against this with a **bespoke protocol message** — a custom `messageClearCache` frame on top of the
standard y-websocket sync/awareness messages — that tells the client to **wipe its IndexedDB cache before
syncing** when the server detects the client is too far behind. It's an explicit reconciliation handshake
bolted onto the CRDT transport.

**How I'd apply it.** Whenever I mix a CRDT editor with REST reads of the same data, I now know the mirror
column is the easy part and **stale-cache resurrection is the real hazard**. Extending the sync protocol
with an app-specific "invalidate your local state" message — rather than trusting CRDT merge to always do
the right thing — is the pattern. More broadly: when two representations of the same data exist, design the
*reconciliation* path as deliberately as the happy path.

---

## Discovery 3 — Hand-written ambient `.d.ts` shim to confine `any` for an untyped dependency

**Where:** [`api/src/types/y-protocols.d.ts`](api/src/types/y-protocols.d.ts)

**What it does / why it matters.** `y-protocols` ships without usable types. The tempting move is to
sprinkle `// @ts-ignore` or `as any` at every call site — which scatters untyped seams through the
codebase. Ship instead writes a small **ambient module declaration** (`declare module 'y-protocols/...'`)
that types the library *at its boundary*, once. Everything downstream stays fully type-checked, and the
unavoidable `any` is quarantined in a single declared file you can point at and later improve. It's the
disciplined version of "the dependency is untyped" — own the boundary instead of leaking it everywhere.

**How I'd apply it.** Before reaching for `@ts-ignore` on an untyped npm package, write a local
`*.d.ts` shim declaring just the surface I actually use. It keeps `strict` mode meaningful, gives one
obvious place to tighten types later (or delete the shim if `@types/...` ships), and makes the "here be
dragons" seam explicit and greppable rather than diffuse.

---

*These three were chosen because each is a transferable technique, not a one-off quirk — the rubric's
point is "the thing you'll remember in your next job," not the metric you moved. The orientation register
([`ORIENTATION_NOTES.md`](ORIENTATION_NOTES.md)) lists several more candidate discoveries (e.g. per-worker
testcontainers isolation, the deliberately-deleted offline mutation queue) that informed the audit.*
