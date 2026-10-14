# Batch 08 - Leaderboard Redesign - APPROVAL-GATED

One task, but it is a redesign plus a likely stats-shape change, so it is approval-gated (produce a mock,
get Matt's approval, then implement). It shares the stats system with C4-2/C4-3 (Batch 09) - do the
stats-shape work once and reuse it.

**Stats system (from `01_repo_context.md`) - read before planning:** per-result data in localStorage
`gamehub.stats` (protected key; legacy shapes must keep loading - `test-stats-replay.mjs`) and RTDB
`players/`+`usernames/` via `stats-net.js`. Written by two recorders (`game-stats-global.js`, `game-stats.js`)
plus **Monopoly Deal's in-scope copy** (in `business-deal/`), which must agree (`test-recorder-contract.mjs`).
Known trap: a Ball Run scoring change once silently discarded runs because a best-gate compared new values
against a legacy field in the same slot - avoid that pattern here.

**The leaderboard UI is `js/leaderboard-ui.js`** (label at `:21`); "My Stats" is `js/game-stats-ui.js`. Each
game's records are keyed by its stats id (e.g. Monopoly Deal = `business`, in `players/<deviceId>/games/...`)
- do not rename those ids while adding fields.

---

## LEAD-1 - Redesign the leaderboard

- **Screenshot:** `01_leaderboard_filler_tab_mattyice_15_3_record_circle.jpg` (Filler tab; MattyIce 15-3 record circled, split awkwardly across two rows; board scrolls sideways)
- **Verbatim:** "the leaderboard needs to be fixed. this looks really bad - the two rows for the W-L record. There's also no way to tell what difficulty the wins were on. I don't like the sideways scroll, but we're missing a lot of info here"

**Four problems in one:** (1) the W-L record wraps to two rows and looks bad; (2) no difficulty breakdown of
wins/losses; (3) disliked horizontal/"sideways" scroll; (4) "missing a lot of info." The core tension: Matt
wants **more** info but **no horizontal scroll on a phone** - so the redesign must add information while going
vertical, not wider.

**Likely data-model change:** to show wins/losses **by difficulty**, each result must store the difficulty it
was played at. Confirm whether `gamehub.stats` already stores that (confirmation 4 in `01_repo_context.md`).
If not: extend the shape (do NOT rename the protected key), make BOTH recorders + the `business-deal` copy write it, bucket
**legacy results with no difficulty as "unknown,"** and keep `test-recorder-contract.mjs` +
`test-stats-replay.mjs` green.

**Design directions to mock for approval (mobile-first, vertical):**
- Per-game tabs (already present) -> a stacked list of players; each shows a single-line **W-L** plus a compact per-difficulty breakdown (e.g. small chips `Easy 6-1 . Normal 7-2 . Hard 2-0`), or
- An expandable row per player (collapsed = overall W-L; tap to expand the difficulty split) to keep the default view narrow.
- Either way: eliminate horizontal scroll (wrap/stack; vertical scroll for long lists). If any color-coding is used, pair it with a non-color cue (`#ffce3a` for emphasis) - Matt is colorblind.
- Decide with Matt what "missing info" should include (propose a small set: win rate %, total games, maybe streak) rather than piling on metrics.

**Do first:** state exactly how stats are stored today and whether difficulty is per-result; propose 1-2
concrete mobile layouts (a static mock/diagram) with W-L clean + difficulty breakdown + no h-scroll; propose
the extra-info set; describe any schema change and legacy handling. Get approval, then build.

**Acceptance (post-approval):**
- [ ] W-L reads as one clean line; wins/losses broken down by difficulty; no horizontal scroll at phone width; the agreed extra info present.
- [ ] If schema changed: new results record difficulty, legacy handled as agreed, both recorders + the `business-deal` copy agree, recorder-contract + stats-replay tests pass. Existing tabs still work.

---

### Batch exit
- [ ] Mock approved before build. Verified at phone width; tests + validator clean.
- [ ] Commit; do not push. Update `CLAUDE.md` (stats shape / keys / leaderboard notes) - THE LAW rule 9.
