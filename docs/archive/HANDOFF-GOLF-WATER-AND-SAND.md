# Handoff: golf's water drop and its bunker edges (2026-09-11)

> **ALL THREE ARE DONE AND LIVE (2026-09-12).** Kept for the reasoning it records, which is still
> accurate about what the code used to do and why. The result, and everything learned building it,
> is in `golf/CLAUDE.md` - "The ball goes in the water, and the player picks the drop" and "Sand
> runs a ball now". This file is history, not a to-do list.

Three things Matt asked for, in his words, plus what the code does today and why - so the next
session changes the right thing instead of rediscovering the reasoning.

**Read first:** `golf/CLAUDE.md`'s status block (the game is BUILT, ADMIN-ONLY right now, and Pine
Valley is the only open course), then `golf-reference-spec.md`. Nothing below overrides either.

---

## 1. A ball that lands in water must go IN the water

> *"When you land in the water, the ball doesn't go IN the water. It stops and slowly moves to the
> drop zone. The ball needs to go underwater. This can mean just disappearing. It should not be
> visible until after the camera moves to the drop zone. Then it can reappear as if it was dropped."*

**What happens today, and why it looks like that.** `resolveShot` (`golf/js/shot.js`, "THE PENALTY
DROP", ~line 512) resolves the water rule INSIDE the shot: when the ball's resting place is water it
walks the flight line backwards to the last dry point, **overwrites `rest` with the drop spot**, and
returns `penalty: 1`. So by the time `ui.js` animates anything, the only resting place it has ever
been told about is the DROP. The ball flies, lands, and rolls to a spot on dry land - which is
exactly the "stops and slowly moves to the drop zone" Matt is describing. **There is no bug in the
water rule; the shot simply never tells anyone the ball was in the water.**

**What that means for the fix.** `resolveShot` has to return BOTH points - where the ball actually
finished (call it the splash point) and where it is dropped - and `ui.js` has to play them as three
beats: fly and land in the water, hide the ball (a splash, or just gone), move the camera to the
drop, put the ball back. The animation is `this.anim = { type: 'flight', ... }` in `_fire()`
(`ui.js` ~1578) and the ball is placed by `_settleShot`.

**Do not lose the stroke or the anti-stuck rules while doing it.** Both exist because of measured
shipping loops, and both are documented at the call site: a ball in a pocket beside a lake on Pine
Valley 3, 10 and 17 ran holes to 16, 17 and 24 strokes, and `MIN_DROP_YD` (2.5) exists because a
drop that does not MOVE the ball leaves the same swing doing the same thing for ever.

## 2. The player chooses where to drop

> *"You should have the option to drop right before the water or from your previous location. Same
> penalty for either."*

**This is new UI, and it reverses a written decision.** `shot.js` says of the current rule: *"The
rule is real golf's and it needs no UI."* It needs one now. Two options, one stroke either way:

- **Before the water** - the existing behaviour: the last dry point on the flight line.
- **Where you played from** - `from`, the previous lie, which `resolveShot` already has.

Notes for whoever builds it: `resolveShot` is PURE and every test depends on that, so the choice
cannot be asked for from inside it - return both candidate spots and let `ui.js` prompt. There is a
prompt precedent to copy rather than invent: the `In the trees` drop prompt (`golf/CLAUDE.md`,
Stage C). And the tee is the floor - a drop must never finish behind where the shot was struck.

## 3. A ball on the edge of a bunker should be able to roll out

> *"If a shot lands in a bunker - a tee shot with driver especially, and it lands on just the edge,
> it shouldn't just stop. It should roll still and possibly roll out depending on the shot. But
> having it stop in the sand 100% of the time doesn't feel realistic."*

**He is exactly right about the 100 %, and it is two numbers.** In `golf/js/clubs.js`:

```
fairwayBunker:   { power: 0.88, zone: 0.19,  roll: 0.00 }
greensideBunker: { power: 0.75, zone: 0.167, roll: 0.00 }
```

`rollFactor` multiplies the LANDING surface's `roll`, so a ball that touches sand rolls exactly zero
yards - every time, at any speed, from any angle. `groundPoint` in `shot.js` (~line 91) also lists
both bunkers in `noHop`, so it does not bounce either. A driver clipping the edge at 250 yds and a
wedge dropping in from 60 behave identically: dead stop.

**What the fix has to respect.** The zero was deliberate - "A ball that LANDS in sand plugs" - and a
high wedge landing in a greenside bunker genuinely should plug. The realistic split is by HOW THE
BALL ARRIVES, not by which bunker it is: a steep, slow arrival plugs; a shallow, fast one skids and
can run out. `rollFactor` already takes the club, and `apex`/`carry` are both known at the call
site, so arrival angle is available without new plumbing.

**A test asserts the current behaviour and will need rewriting, not deleting:**
`golf/js/test.js:764` - `'a ball that lands in sand does not roll'`. Replace it with the rule that
is actually wanted (a steep arrival still plugs; a shallow fast one can run), so the next session
after this one cannot quietly undo it.

---

## Constraints that apply to all three

- **Propose before building.** Matt, mid-edit on 2026-09-10: *"you shouldn't be touching anything.
  you should tell me which idea is better, how you would implement it, then when we agree on
  something, you present mockups."* For anything that changes feel, bring numbers first.
- **The swing numbers are his.** `BLOCK_KEEPS_DIST`, the tempo, `BLOCK_SPRAY_DEG` and the approved
  club ladder in `golf-reference-spec.md` §21.3 are calibrated values. Two sessions have now been
  caught changing them without asking. An approved table is a decision, not a starting point.
- **The physics were rebuilt on 2026-09-10** - four sections at the end of `golf/CLAUDE.md`. Dead
  centre is dead straight and the longest shot, a struck ball carries NO randomness at all, and a
  max-power driver tops out at exactly 250 yds. Do not reintroduce a random term anywhere in a
  struck shot.
- **THE LAW.** None of this touches stored player data, and none of it should.
- **Deploying means live**, per the root `CLAUDE.md`: commit, push, PR, merge to `main`, and verify
  the `pages build and deployment` run actually succeeded. Golf being admin-only does not change
  that; it just means the family will not see it yet.

## How to check the work

- `node golf/js/test.js` - the engine suite, ~4 min. Section 15c plays every hole 24 times and
  reports each against par; a before/after of the SAME simulated player is how a difficulty claim
  gets settled here. Oasis Sands hole 4 is a named gap and prints on every run - it is not a failure
  and that course is not open.
- `node test-visual.mjs golf` - drives a real browser, including a full tee-to-cup play probe.
- `node check-no-scroll.mjs golf` - no game in this hub may scroll.
- `node validate-sw-assets.mjs` before any deploy, and bump `CACHE` in `sw.js` past whatever is on
  `main` at that moment, not past your working copy.
