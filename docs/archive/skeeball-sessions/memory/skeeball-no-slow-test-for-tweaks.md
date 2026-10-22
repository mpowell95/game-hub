---
name: skeeball-no-slow-test-for-tweaks
description: Never run test.js or big engine sweeps for small Skeeball tuning tweaks — just change and deploy.
metadata:
  type: feedback
---

For Skeeball tuning tweaks (a bounce/restitution value, a fin/geometry nudge, a material, a number), DO NOT run `node skeeball/js/test.js` or big `simulateThrow` sweeps. They play hundreds of throws, take ~5 min, and burn Matt's tokens/time for a change that's small, low-risk, and `devOnly`.

**Why:** Matt (2026-08-17), angry: *"You're sitting here playing skeeball throwing 100 balls wasting my tokens?"* A fin took 2 minutes to write and I spent minutes running the full suite before confirming.

**How to apply:** Make the change, syntax-check, and deploy (per [[skeeball-iteration-auto-deploy]]). At most a tiny sanity check if genuinely unsure. Let Matt feel it — he's the judge of feel. Reserve the full test suite / large measurement sweeps for real correctness questions (a physics rewrite, a reachability concern he raised), not routine tuning.
