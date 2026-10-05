# Nuts & Bolts: difficulty keeps rising (handoff, 2026-10-05)

## The ask

Matt: *"why would it stop getting more difficult at level 16!??... Of course it should continue to
get more and more difficult."* Decision: **ramp up from where each player is now**, not a jump to
whatever their level number would map to.

Ship it live per root `CLAUDE.md` ("Asking for a change means LIVE"). No sound (root `CLAUDE.md`).

## What the code does today

- `nuts-bolts/js/generator.js:39-62`, `TIERS`: each tier is a short list of bands keyed by level.
  The last band of every tier has `maxLevel: Infinity`, so difficulty is flat after it.
  | Tier (stored id) | Last band starts at | Last band |
  |---|---|---|
  | Easy (`easy`) | level 16 | F 6, C 6, E 2, S 24, H 0.10 |
  | Medium (`medium`) | level 31 | F 11, C 9, E 2, S 48, H 0.15 |
  | Hard (`hard`) | level 16 | F 13, C 10, E 2, S 64, H 0.20 |
  | Expert (`extraHard`) | level 16 | F 15, C 12, E 2, S 80, H 0.25 |

  F = full bolts, C = distinct colors (F - C bolts repeat a color), E = empty bolts,
  S = scramble steps, H = fraction of nuts hidden.
- `getDifficulty(tier, level)` (`generator.js:82`) picks the band. `generateLevel(tier, level)`
  (`generator.js:337`) reverse-scrambles a solved board (always solvable), then quality-gates it
  (`QUALITY_GATES`, `generator.js:~64`; greedy-solver probe on Medium+), up to
  `MAX_GEN_ATTEMPTS = 25`. Unseeded `Math.random`: no two plays of one level are the same board.
- `CAP = 4` nuts per bolt. `PALETTE` has **12 colors**, so C cannot pass 12 without new colors
  (Easy draws only from the first 7, the colorblind-safe pool). Every color has an embossed symbol;
  Matt is red/green colorblind, so any new color needs a distinct symbol too.
- Level counters: `this.levels[tier]` in `nuts-bolts/js/ui.js`, `+= 1` on Next level (`ui.js:629`),
  passed to `new NutsBoltsGame(tier, level, ...)` (`ui.js:368-371`, `game.js:42`). Saved in
  `gamehub.nutsbolts.v1` (schema v2, `ui.js:11`, migration at `ui.js:128`). **Per device, not
  synced.** Nothing caps the counter.
- Board fit: `SIZE_TIERS` (`ui.js:61-66`: up to 8 bolts large, up to 12 medium, else small) plus
  `fitToViewport()`'s continuous scale down to `MIN_CONTINUOUS_SCALE = 0.6` (`ui.js:76`). Expert's
  plateau is 17 bolts (15 full + 2 empty).
- Generator self-test: `nuts-bolts/js/test.js`.

## Who this affects (live data, 2026-10-05)

Plays per tier, from `players/` (levels themselves are local to each phone, so these are counts):

| Player | Expert | Hard | Medium | Easy |
|---|---|---|---|---|
| Unai | 316 | 30 | 44 | 20 |
| Lili | 218 | 15 | 0 | 51 |

So Unai is on roughly Expert level 317 and Lili roughly 219, both 200-300 levels past the plateau.

## The design

1. **A ramp past each tier's last band.** Above the plateau, difficulty keeps stepping up as levels
   go by, through these levers, in roughly this order:
   - **More bolts (F)** until the board stops fitting a phone. Measure the real ceiling at a small
     phone (375x667, and 360x640) with `fitToViewport()` at its 0.6 floor; nuts must stay tappable
     (the UX floor's tap-target minimum, `docs/BUILDING-A-GAME.md` Part 0). Do not guess it.
   - **More colors (C)** up to 12 (more only with new colors AND new symbols).
   - **More hidden nuts (H)**, toward a ceiling to be measured by play (0.5 is a reasonable first cap).
   - **More scramble (S)**, scaled with board size.
   - **E (empty bolts) stays 2.** Dropping to 1 is a cliff, not a step; only with Matt's say-so.
   Recommended pace: one small step every ~10 levels. Matt can retune.
2. **"Ramp up from where they are" needs one stored number per tier: where the ramp starts.**
   Add an additive field to the saved blob, e.g. `rampFrom: { easy, medium, hard, extraHard }`.
   On first load with the new code, for each tier with no `rampFrom`:
   `rampFrom[tier] = max(current level, first level of that tier's last band)`.
   Difficulty past the plateau is then a function of `level - rampFrom[tier]`, so:
   - Unai's next Expert level plays exactly like today's, and it gets harder from there.
   - A new player ramps from level 16 (31 on Medium) as normal.
   This is a new field, never a rename or reuse of an existing one (THE LAW rules 2 and 5). Do not
   touch the level counters. A board already in progress resumes unchanged.
3. **All four tiers ramp**, not just Expert (all four plateau). Open question for Matt in that
   session: should a lower tier's ramp stop below where the next tier begins (Easy never becomes
   Medium), or keep going? Ask; do not decide.
4. **Generation must stay fast on a phone.** Bigger boards mean slower quality probes. Time
   `generateLevel` at the top of the ramp; if it gets slow, reduce probe work for big boards rather
   than shipping a stall.

## Verify before shipping

- `node js/test.js` from the `nuts-bolts/` folder passes, extended to cover
  ramp levels (e.g. 16, 50, 100, 300, 1000 on every tier): solvable, passes the gate, no complete
  bolt at start.
- A migration check against a REAL old blob (THE LAW rule 7): take the v2 shape from git, with
  levels like `extraHard: 317`, load it with the new code, confirm the levels are unchanged and
  `rampFrom` is set to 317.
- Screenshots of the top-of-ramp board at 375x667 and 360x640, light and dark (`VISUAL-PROCESS.md`).
- `node validate-sw-assets.mjs`, bump `CACHE` in `sw.js` past what is on `main` right now, merge,
  confirm the Pages deploy run succeeded.
- Replace the "OPEN: difficulty stops rising" section of `nuts-bolts/CLAUDE.md` with what shipped
  (rule 9), and delete nothing else there.
