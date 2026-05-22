# E2E Test Runner

Run Playwright E2E tests **safely** — never stream the raw output of the ~880-test
suite into the conversation (it causes output explosion and crashes the session).
Instead: launch the run detached, then poll the compact `test-results/summary.json`
that `e2e/progress-reporter.ts` writes live.

## Trigger

- User asks to run E2E / end-to-end / Playwright tests.
- Any time you would otherwise type `pnpm test:e2e` directly. **Do not** run
  `pnpm test:e2e` in the foreground — use this procedure.

## Why this exists (audit finding H6)

`CLAUDE.md` mandates this runner, but it didn't exist. The suite is large; its raw
stdout (hundreds of specs × per-step logs) overflows the context window. The repo
already ships the machinery — `e2e/progress-reporter.ts` (writes
`test-results/summary.json` + per-test `test-results/errors/`) and
`scripts/watch-tests.sh` — this skill is the procedure that uses them.

## Procedure

1. **Preflight:** Postgres up, and (for a full run) the app build current. E2E
   uses its own isolated env (`e2e/fixtures/isolated-env.ts`); confirm seed data
   requirements there if a spec needs specific rows.

2. **Launch detached** (background — do NOT capture stdout in the tool result):
   ```bash
   pnpm test:e2e > /tmp/ship-e2e.log 2>&1 &
   ```
   Or, for a focused run, target a file/grep: `pnpm test:e2e some-spec.spec.ts`.

3. **Poll the summary** (cheap, bounded output) instead of reading the log:
   ```bash
   cat test-results/summary.json   # { total, passed, failed, skipped, pending }
   # or, human-readable one-shot:
   ./scripts/watch-tests.sh --once
   ```
   Re-poll every ~15–30s until `pending` reaches 0. Never `cat /tmp/ship-e2e.log`
   in full — it's the explosion source.

4. **Inspect only failures:** read `test-results/errors/` (one file per failed
   test) — not the full log. Report the failing spec names + their error heads.

5. **Iterate fast** with `--last-failed` so you only re-run what broke:
   ```bash
   pnpm test:e2e --last-failed > /tmp/ship-e2e.log 2>&1 &
   ```
   Repeat poll → fix → `--last-failed` until `failed` is 0.

## Rules

- **Empty-test footgun:** a test body with only TODO comments passes silently.
  Use `test.fixme()` for unimplemented tests; the pre-commit
  `scripts/check-empty-tests.sh` catches empties.
- **Seed data:** if a spec needs N rows, ensure `e2e/fixtures/isolated-env.ts`
  creates ≥ N+2; assert with an actionable message instead of `test.skip()`.
- Always poll `summary.json`; never paste raw suite output into the conversation.
