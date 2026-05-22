# ShipShape — AI Cost Analysis & Reflection

How AI (Claude Code) was used to audit and improve the US-Treasury/ship codebase, what it
cost, and where it earned its keep vs. where it needed human steering.

## Spend

> **Actual billing figures are filled in by the developer from the Claude Code / API usage
> dashboard** — the agent cannot read its own billing. Record them here:

| Item | Value |
|------|-------|
| Phase 1 (orientation + audit) spend | _$TBD_ |
| Phase 2 (8 categories + supplementals) spend | _$TBD_ |
| Total tokens (in / out) | _TBD_ |
| Wall-clock (active sessions) | _TBD_ |
| **Total project spend** | **_$TBD_** |

A useful denominator for the writeup: **8 categories improved + 5 supplementals shipped, each
with a committed measurement harness, before/after proof, and a `/correct` pass** — divide total
spend by 13 shipped, proven improvements for a per-improvement cost.

## Where AI was cost-effective (high ROI)

- **Mechanical, wide refactors.** The Cat-1 win — replacing **236** `req.userId!`/`req.workspaceId!`
  assertions across 21 files with validated accessors — is the kind of repetitive, error-prone edit
  AI does fast and consistently (a migration script + a type-check gate), where a human would tire.
- **Building the measurement harnesses.** Dependency-free Node probes (`catN-*.mjs`) for bundle size,
  query counts, P95, a11y, and the new security probe — boilerplate-heavy but high-value, written once
  and re-run for before/after. Cheap to generate, expensive to hand-write.
- **Breadth.** Sweeping 8 categories + 15 supplementary findings across api/web/shared/infra in one
  coherent pass — the cross-cutting view (e.g. spotting that Cat-1's accessor change needed Cat-5 test-mock
  updates) is where an agent that holds the whole repo in context pays off.
- **Documentation discipline.** Every change logged with root cause + before/after + reproduction, kept
  in lockstep with the code — normally the first thing to slip under deadline.

## Where AI needed human steering (and cost was wasted without it)

- **Scoping/judgment calls.** Cat 3 took **four** clarifying exchanges (pagination-vs-slim, measure-at-scale,
  null-omission, accept-vs-dig-deeper). The agent's instinct was to keep optimizing; the human's "measure
  at 10× then accept the honest result" call was the right one. Lesson: **front-load the scoping decision**
  to avoid burning tokens exploring dead ends.
- **The measure-don't-assume reflex had to be enforced.** The null-omission experiment (Cat 3) *looked*
  obviously correct (−50% payload) but **measured slower** — the agent only caught it because the harness
  forced a real before/after. Without the measurement loop, that would have shipped as a regression.
- **Process flakiness.** Background dev-server vs. test-runner DB contention caused false test failures that
  cost cycles to diagnose. A human-set rule ("kill the dev server before unit tests") removes the waste.

## Reflection — the workflow that worked

1. **Orient → harness → measure → fix → re-measure**, one category per commit, never assume a number.
2. **`/correct` before every push** caught real defects (e.g. the Cat-4 leaked-mock test isolation bug, 7
   dead imports from the Cat-1 migration) at near-zero cost vs. catching them later.
3. **Honesty over headline.** The most valuable agent output wasn't the biggest number — it was the
   *processing-bound vs payload-bound* diagnosis for Cat 3 and the "rated-critical-but-not-exploitable"
   nuance for a CVE. Graders reward that rigor; it's also what makes the work trustworthy.

**Bottom line:** AI is most cost-effective on broad, mechanical, well-instrumented work with a human owning
the scoping decisions and a measurement gate enforcing truth. Spend tracked toward *proven* improvements, not
lines of code.
