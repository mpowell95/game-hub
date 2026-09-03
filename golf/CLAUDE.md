# Golf — CLAUDE.md

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. The law
> and its nine working rules are at the top of the root `CLAUDE.md`, always loaded alongside this
> file. Rules 4 and 5 do real work in this game: see "Stored shape" below.

## Status: BEING REBUILT (Stage A complete, 2026-09-03)

**`golf-reference-spec.md` at the repo root is the only spec.** Read it in full before touching
anything here. It is the written record of a commercial mobile golf game reconstructed from five
screen recordings, plus the decisions that turn it into the game we are actually building. Where
it is silent, ask, or decide and write it down there.

The 3D game that used to live in this folder — three.js + cannon-es rigid bodies, aim/power/spin
on three separate meters, Modified Stableford scoring, a course called Harbor Links — **is gone.**
Matt's verdict on it: *"It's terrible and this is a MAJOR overhaul... I don't trust anything that
the current build does."* Do not carry its decisions, tuning numbers, physics constants, course
design or UI forward, and do not go looking for them in git history to "restore" something.

Deleted in Stage A: `js/render.js`, `camera.js`, `terrain.js`, `minimap.js`, `physics.js`,
`flight.js`, `meters.js`, `game.js`, `clubs.js`, `test.js`, `js/vendor/` (cannon-es + two three.js
bundles, ~1.1 MB), `courses/`, `tools/`, `DECISIONS.md`, `docs/GOLF-HANDOFF.md`,
`docs/GOLF-PART9.md`. **The three deleted documents were specs for the old game and would mislead
the next session; that is why they went rather than being left "for reference".**

What is here now is a placeholder: `js/ui.js` renders one screen saying the game is being rebuilt,
and keeps the three module-contract exports so nothing in the repo carries a broken import.

### Where the rebuild is

| Stage | Contents | State |
|---|---|---|
| A | Clear the ground; the leaderboard metric, sort and filter change | **done** |
| — | The hole-data format, written down before anything is built against it | next |
| B | Core loop: tilemap, ball + shadow, HUD, aim ladder, clubs, meters, three-tap, flight | not started |
| C | Lies, hazards and drops, putting with break, result banner, scorecard, preview scroll | not started |
| D | Stats wiring, strings EN/ES, this file, `sw.js`, the test suites, release | not started |

The stages map onto `golf-reference-spec.md` §16's phases, with three approved changes: the
leaderboard metric change moved forward into Stage A, the `test-visual.mjs` entry gets written at
the start of Stage B, and the hole-data format is decided before Stage B rather than during it.

## Harbor Links is gone from the product, but its keys are not

Matt: *"I do not want to see 'harbor' anywhere in the hub. No mention of it ever."* So: no course
named harbor, no `courses/harbor/`, no harbor string in any UI, no harbor row in My Stats, no
harbor entry in the admin page's per-course config, no mention in user-facing copy in either
language.

**The one thing that is NOT deleted: the stored stats keys.** THE LAW rule 5 is that old keys are
never deleted and never repurposed, and it holds even for keys everyone believes are empty. So
`gf.practice.harbor` and `bestRoundByCourse.harbor` are simply **never written and never read**
again. They are not removed from `ensureGf`'s shape, and no cleanup code goes hunting for them. An
empty key nobody reads shows nothing to anybody, which satisfies "no mention of harbor" with no
destructive write.

**This was verified, not assumed** (2026-09-03, `golf-reference-spec.md` §16 Phase 0). A full RTDB
backup was taken and read: of 218 player device records, 11 carry a `stats.games.golf` key and all
11 are the all-zero skeleton `ensureGf` writes on first sync. Zero non-zero values, zero
`bestRoundByCourse` entries, zero `gf.practice` entries, zero occurrences of the string "harbor"
anywhere in the database, and nothing in `archive/players`. Matt confirmed the same on his own
phone's My Stats. **There is no golf history in existence to lose.**

## Names — frozen forever (THE LAW rule 5)

| Thing | Value |
|---|---|
| Folder | `golf/` |
| Stats id | `'golf'` |
| Settings key | `gamehub.golf.v1` |
| Recorder | `recordGolf(difficulty, extras)` |
| CSS root / prefix | `.gf-root` / `.gf-` |
| Hub integration | in-hub `module: '../golf/js/ui.js'`, `immersive: true` |

**Do not mint `gamehub.golf.save.v1`.** `gamehub.golf.v1` already exists and already holds the
round. A second store would create two sources of truth.

## Stored shape

`ensureGf()` in `js/game-stats.js` owns it, and it is unchanged by the rewrite:
`rounds, holes, strokes, points, birdies, eagles, aces, longestDriveYd, bestRoundByCourse, practice`.
Changes are **additive only**. `js/players-agg.js` already has the matching merge branch, including
the per-key `Math.min` for `bestRoundByCourse`.

- **`points` keeps being written.** Modified Stableford points are a pure function of (hole score,
  par), and the new stroke-play game knows both, so the lifetime counter stays truthful with no
  fabrication and nothing has to be archived as a dead legacy value. It is My Stats' "Skill level".
- **`bestRoundByCourse` stores STROKES**, keyed by course, `Math.min` per key. The leaderboard
  subtracts par at display time; the stored value is never a to-par number.
- **Course keys are frozen the moment one round is recorded.** `pinevalley3` today.
  `pinevalley9` when holes 4-9 ship. **They are never merged and never compared** - a 3-hole best
  and a 9-hole best are not the same measurement (rule 4) - and `pinevalley3` is never repurposed
  into the 9-hole key (rule 5). Every screen that shows one names which it is showing.

## The leaderboard number changed in Stage A

Matt, 2026-09-03: golf's board number is the player's **best round on a named course, as a score
to par, lowest wins** - not the lifetime Stableford total it used to be. `gf.points` is still
written and still shown on My Stats, so nothing was hidden by this; it was re-ranked.

It is the only metric on the whole leaderboard where **lower wins** and where **good values are
<= 0**, which broke two assumptions baked in everywhere:

- Every sort site compared `b - a`. Sorted that way, a stroke score puts the WORST golfer in the
  family on top, and it looks plausible enough to go unnoticed for weeks.
- `gameListHTML` filtered leaders with `metric > 0`, which drops level par (0) and every
  under-par round - a stored best that no screen shows reads as deleted (rule 1).

So the extractor, the sort direction at all six of its call sites (four in `sortRows`, the game
list, and `rankMap`, which numbers the rank badges) and the filter changed **in one commit** with a
test. The maths is in `js/leaderboard-rank.js` - pure and headless-testable, which is why it lives
there rather than in the DOM file - and `test-leaderboard-rank.mjs` covers it.

## Who can play it right now

**Nobody but a dev profile, and that is deliberate.** The adminConfig override
`adminConfig/v1/games/golf` is `live: false` (set 2026-09-03), and `js/hub.js` filters the launcher
on `isGameLive(g.id, !g.devOnly) || dev`. Matt: *"The default should be testing mode. So only I can
see or play it."*

**No `devOnly` flag was added on top of this, on purpose.** Two switches for one decision is how a
game ends up shipped hidden by accident. Releasing golf to the family is a tap on the admin page,
not a deploy.

`js/admin-config.js`'s per-COURSE resolvers (`resolveCourseMode` and friends) still exist and are
still tested, but have **no caller** while the game is rebuilt, and `js/admin-ui.js` has never had a
per-course section at all. Releasing an individual course will need that section written.

## Repo rules that bite in this game specifically

Read `docs/BUILDING-A-GAME.md` Part 0 (the UX floor) before touching any UI, and the game-ui skill's
guidance. The ones this game is most likely to get wrong:

- **`onViewportResize(cb)` from `js/viewport.js`**, never a raw `resize`/`orientationchange`/
  `visualViewport` listener. Hill Climb shipped that bug exactly once.
- **`touchmove` binds to `.gf-root`**, never to `document` or `window`. The swipe surface gets
  `touch-action: none`; tappable controls get `touch-action: manipulation`.
- **`overscroll-behavior: contain`** on any fixed overlay that scrolls (the scorecard).
- **Immersive fit:** one screen at a tall AND a short phone height, standalone AND mounted in the
  hub's real chrome (~138 px of it). `test-visual.mjs`'s `fit` checks. Golf has no entry in that
  suite yet - writing one is the first task of Stage B.
- **`prefers-reduced-motion`** thins garnish (sunburst rays, shake) and never freezes gameplay: the
  ball still flies.
- **No em dashes in user-facing copy.** The round-complete screen gets a close (X) top-right.
- **The player's name comes from `loadProfile()`, defaults-only.** Golf prefills from it and never
  writes back.
- **Every visible string goes through `t()` at RENDER time**, EN and ES, in `js/strings.js`.
