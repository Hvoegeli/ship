# Social Post — draft (X / LinkedIn)

> Draft for **@HarrisonVoegeli**, tagging **@GauntletAI**. Review/edit before posting.
> (Attach the demo video + a before/after screenshot from the scorecard.)

## Option A — single tweet (punchy)

> Spent this week running "ShipShape": a measured audit + fix pass on a real codebase.
> Rule the whole time: **never claim a number you can't reproduce.**
>
> 8 categories, all improved with before/after proof:
> • Initial JS bundle −61%
> • API P95 −55% at scale
> • DB queries −20–25%
> • 19 a11y violations → 0
> • Type "escape hatches" −27% + a real lint gate
> • Critical CVEs 2 → 0
>
> Every win has a committed harness that re-runs it. Built w/ @GauntletAI 🚢

## Option B — short thread

**1/**
ShipShape week: I audited a real app, then fixed it — but the discipline mattered more than the fixes.
Every improvement had to be **harness-measured, before & after, reproducible.** No vibes. @GauntletAI

**2/**
Results (all proven, all re-runnable):
🟢 Bundle: 576 → 222 KB initial load (−61%, code-split the editor)
🟢 API: documents endpoint −55% P95 + 2.3× throughput at 10× scale
🟢 DB: −20–25% queries/flow (stopped writing a timestamp on every request)

**3/**
🟢 Accessibility: 19 axe Critical/Serious → **0** across every page
🟢 Type safety: 236 unchecked `!` assertions → validated accessors (−27%) + installed the linter that never existed
🟢 Security: built a probe tool, killed both critical CVEs, fixed a cross-user cache leak

**4/**
Biggest lesson: a "−50% payload" optimization I was *sure* about… **measured slower** when I ran it.
The measurement loop caught it before it shipped. That's the whole point.
Measure. Don't assume. Thanks @GauntletAI 🚢

## Notes
- Lead with the demo video; pin the scorecard image.
- If LinkedIn: expand 2–3 into a short paragraph each; keep the "measure, don't assume" close.
