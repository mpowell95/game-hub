---
name: skeeball-data-is-test-data
description: All existing Skeeball player data in the Game Hub is disposable test data, so THE LAW does not make Skeeball's own stat counters untouchable
metadata:
  type: project
---

Every bit of Skeeball player data in the Game Hub store as of 2026-08-20 is **test data, marked to
be deleted before the game goes live** — including the MattyIce records and anything from the
pre-2026-08-11 build. Matt said so explicitly.

**Why:** `skeeball/CLAUDE.md` opens with THE LAW ("player data is never deleted, never lost, never
put at risk") and its Persistence section reads as if Skeeball's `sk` counters carry irreplaceable
family history. Reading that at face value, I declined to add per-value counters
(tens/twenties/thirties/forties) needed for a "hit every point value" unlock goal, and shipped a
narrower goal instead. That caution was misplaced.

**How to apply:** additive changes to the Skeeball `sk` block are ordinary work, not high-risk
work. Do NOT treat them as untouchable. But `js/game-stats.js` and `js/players-agg.js` are shared
by every other game in the hub, and *those* games' data is real — so care in those two files is
still warranted, for the neighbours rather than for Skeeball.
