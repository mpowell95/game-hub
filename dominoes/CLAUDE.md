# Dominoes (`dominoes/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`,
> which is always loaded alongside this file (full rule rationale: `js/CLAUDE.md`).

Double-six **All Fives** against one bot, built 2026-08-01 from a written spec derived from a
reference app's screenshots. You score during play whenever the open ends add up to a multiple of
five; first to the target score (300 by default) takes the match.

Hub integration: in-hub `module:` (`dominoes/js/ui.js`), **not immersive**, no multiplayer.
`isInProgress()` uses the **autosave/resume** meaning (returns `false` always): the match
snapshots after every settled action into `gamehub.dominoes.save.v1` and restores silently on the
next mount, so leaving mid-match is lossless and the hub's "leave game?" confirm would be a lie.

**Not immersive on purpose.** The spec's own header band carries a back chevron; immersive mode
would put the hub's floating back button in exactly that corner, so the game keeps the ordinary
hub header for going back and its teal band carries only the difficulty chip, the scoreboard and
restart. The play stack measures its own height from `getBoundingClientRect().top` (`_fit()`),
which is why the same markup works under the hub's padded content area and on the bare
standalone page.

## Layout & responsibilities

```
dominoes/js/game.js     pure rules engine: the set, hands, boneyard, the chain, legality,
                        All Fives counting, going out, blocked rounds, match to target
dominoes/js/board.js    pure geometry: the chain's grid rectangles, spinner branches, elbows,
                        bounding box. Recomputed from scratch on every render
dominoes/js/ai.js       the three bot tiers (pure; the "thinking" pause lives in ui.js)
dominoes/js/ui.js       DOM shell: setup, play screen, boneyard drawer, round card, animations
dominoes/js/strings.js  every user-visible string, { en, es }
dominoes/js/test.js     headless assertions for all three pure modules (node dominoes/js/test.js)
dominoes/css/dominoes.css  all styles, .dm- prefixed, every rule descendant-scoped under .dm-root
dominoes/index.html     standalone host (name-gated, same init() as in-hub)
```

## Two models, deliberately separate

The single most useful thing to know before changing anything here.

- **`game.js` owns the chain as three ordered arrays** (`line`, `up`, `down`) plus `spinnerId`
  and `originId`. `line[i].b === line[i+1].a` always holds; branch entries are `{a: inner,
  b: outer}` ordered from the spinner outward. Nothing in the engine knows about pixels, grids,
  orientation or corners.
- **`board.js` owns the geometry** and derives it from those arrays every render. There is no
  stored position anywhere; a tile's coordinates are a function of the chain, so a snapshot
  restore, a language switch and a window resize all reproduce the identical board with no
  migration and no drift.

Keep it that way. A placement rule belongs in `game.js`; a "where does it sit" rule belongs in
`board.js`. If you find yourself storing an `x` on an engine entry, something has gone wrong.

### Board geometry, in one paragraph

The unit is **half a domino's short side** — the coarsest grid on which every legal placement
lands on an integer, because a double laid crosswise straddles its run by exactly half a cell on
each side. A domino is 4x2 units along the run and 2x4 across it. The **spinner is the origin**
whenever one exists (the round's first tile before that), so the two branches always leave from
the middle of the board while the runs only fold near the extents, half a board away — anchoring
on the opening tile instead put a fold right on top of a branch. A run goes straight until it
would pass its extent limit (`LIMIT_X`/`LIMIT_Y`) or overlap something already laid, then elbows,
preferring the perpendicular that folds away from the other run. **A double never turns a
corner**: it is laid crosswise in the current direction and the turn waits for the next tile,
which keeps the corner rule to a single shape.

`walk()`'s preference order is load-bearing and its comment says so: straight-and-within-limit,
then elbow-and-within-limit, then straight-and-free, then any-free-elbow, then straight
regardless. An earlier version folded on the first free corner and produced zig-zags; an earlier
one still folded only on the limit and let long runs walk straight through a branch.

**The last-resort branch can overlap, and that is accepted.** A double with nowhere legal to go
is placed anyway rather than dropped. Measured over 119,229 boards from 800 full simulated
matches: **one** overlapping board, on a 27-tile chain (a 21-tile line with a 6-tile branch). The
fit-to-felt scale absorbs it; dropping a tile would be a correctness bug, and reserving corridors
for the branches would need a two-pass layout to buy back that one board in a hundred thousand.

## Rules (All Fives)

1. Double-six set, 28 tiles, 7 each, the remaining 14 are the boneyard.
2. **Round 1's lead goes to whoever holds the highest double** (the heaviest tile if neither
   does); later rounds are opened by the previous round's winner. The opener may lead **any**
   tile — the traditional "and must lead that double" clause is deliberately not enforced, so
   every round starts with a real choice.
3. On your turn: play a tile matching an open end, or draw until you can. Passing is only legal
   with an empty boneyard, and drawing is only legal with no play — `requiredAction()` is the one
   function that decides which, for both seats.
4. Doubles lie crosswise. The **first double played** is the spinner; its two perpendicular sides
   open only once the main line has a tile on both of its in-line sides (the standard rule), and
   an unplayed branch side is **not** an end and counts nothing.
5. **Counting**: sum the open ends after each placement; a multiple of five scores itself. A
   double at an end contributes **both** halves. Two cases that trip people up and are both
   pinned by tests: a lone first tile counts **once** (a 5-5 opener is 10, not 20), and an
   interior spinner contributes nothing of its own.
6. Going out pays the **raw** pip total left in the other hand, never rounded to a five — which
   is why a round total like 31 is legitimate while an in-play score never is. A blocked round
   pays the lower hand the difference; **equal pips score nothing and name no winner** rather
   than inventing one.
7. First to the target score wins. A match is a **race**, so exactly one side ever crosses the
   line and there is no tie to record (see "Stats").

`_deadlocked()` is checked after every placement so a round where neither side can move and the
boneyard is empty ends immediately, instead of sitting in a dead state waiting for two passes
that the turn loop would never ask for.

## The bot

`ai.js`, three tiers, all pure and all playing from the honest information set — `unseen()` is
the full set minus the bot's own hand minus the board, i.e. the opponent's hand plus the
boneyard. **Nothing ever reads `hands[1 - seat]`.**

- **Easy** — a random legal move.
- **Medium** — the highest-scoring move this turn, ties broken by the heaviest tile (so it sheds
  pips rather than hoarding them into somebody else's going-out bonus).
- **Hard** — medium's score minus a one-ply estimate of what it hands back (the best score any
  unseen tile could make on the ends it is about to leave, weighted 0.55 because the opponent may
  not hold it), plus a bonus for leaving ends the opponent is **known** to be missing.

That last input is `game.voids`, filled in by the engine every time a seat draws or passes: the
ends it could not match at that moment are values it demonstrably does not hold. It is the only
real information a dominoes player ever gets, and it lives on the engine so it survives a
snapshot restore like everything else.

Measured over 600 matches per pairing (`node dominoes/js/test.js` covers legality and
termination; the strength numbers came from a throwaway sweep): medium beats easy 97.5%, hard
beats easy 99.2%, hard beats medium 69.0%, and easy against itself is 48.5%, which is the honest
size of the first-mover edge.

## Reading the game state without words

There is not one instructional sentence in the play screen. Four channels carry all of it:

- **Whose turn** — the felt colour, warm peach for you and cool blue for the bot, cross-faded
  over half a second. One mat element with a second gradient layer whose opacity animates;
  custom properties do not interpolate, so this is not a colour transition.
- **What you can play** — tile brightness. Illegal tiles dim to a muddy olive. There is
  deliberately no "no valid moves" text anywhere.
- **Where you can play it** — the end badges. Tapping a tile with exactly one legal end plays it
  straight away; a tile that fits two or more lifts out of the hand and lights only its legal
  badges. **Colorblind rule: the scoring state is carried by SHAPE first** — a circle when the
  ends already add to a five, a rounded square when they do not — with the green/amber hues only
  reinforcing it.
- **What just happened** — a `+5` and a star burst at the tile that caused it, plus the header
  score counting up. Never a log, never a banner.

Everything else (bot thinking, the boneyard drawer, a pass, the round card) is an **overlay**.
The header, both hand rows and the floor keep fixed space, so nothing in the play screen ever
reflows.

## Settings & persistence

- `gamehub.dominoes.v1` — `{ difficulty, target }`. Precedence: saved settings > the shared
  profile's first opponent skill (1/2/3 → easy/medium/hard) > medium. An unknown target falls
  back to 300, so a future removed option can never crash the setup screen.
- `gamehub.dominoes.save.v1` — `{ snap, difficulty, target, bestRound, statsCommitted, ts }`,
  written after every settled action and on `destroy()`. `statsCommitted` rides in the save so a
  finished match cannot be recorded twice by a restore.
- Language is NOT stored here: it is the hub-wide `gamehub.lang.v1`.

## Stats

`recordDominoes(difficulty, won, extras)` in `js/game-stats.js`, called **once per MATCH** (a
race to the target, not per round), guarded by `_statsCommitted`. `dm: { played, won, lost,
rounds, bestRound, points }` — counters additive, `bestRound` Math.max only per THE LAW rule 2.

**There is no `tied` here, on purpose**, unlike `tt`/`db`/`bg`/`yz`: a match ends the instant one
side crosses the target, so exactly one side can be over it.

All three mandatory sub-counter surfaces exist (root checklist item 7): the `ensureDm`/
`recordDominoes` pair in `js/game-stats.js`, `dominoesScreen` in `js/game-stats-ui.js`, and the
`dm` branch in `js/players-agg.js` with its own regression case in `players-agg.test.mjs`.
Dominoes is a COMPETITIVE game (not in players-agg's `SOLO` set), so the leaderboard shows it on
the ordinary wins metric with no extra wiring.

## Tests

```
node dominoes/js/test.js
```
300 assertions: the set's integrity, every All Fives counting case above (including the lone
double and the interior spinner), branch opening, legality including a tile that fits both ends,
chain bookkeeping, the non-destructive `countAfter` preview, the deal, going out, blocked rounds
both ways, drawing and passing legality, the match-end trigger, a snapshot round trip, board
geometry (crosswise doubles, branch direction, a folded run, no overlaps), the bot tiers' choices
and legality, plus a 60-full-match sweep asserting that no tile is ever lost, every placed tile is
laid out, no chain overlaps itself, and in-play scores are always multiples of five credited only
to the mover. Wired into `run-all-tests.mjs`.
