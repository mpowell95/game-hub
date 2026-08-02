# Dominoes (`dominoes/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`,
> which is always loaded alongside this file (full rule rationale: `js/CLAUDE.md`).

Double-six **All Fives** against one bot, built 2026-08-01 from a written spec derived from a
reference app's screenshots, plus **Addendum 1**, which corrected the spec on three rules and
specified the how-to-play carousel. You score during play whenever the open ends add up to a
multiple of five; first to the target score (300 by default) takes the match.

**Where the addendum overrode the main spec, the addendum wins**, and the three places that
matters are called out in "Rules" below: both players score at a round end (A1), every round is
opened by the highest double and the lead is forced (A3), and the target is reach-OR-PASS (A4).

Hub integration: in-hub `module:` (`dominoes/js/ui.js`), **not immersive**, no multiplayer.
`isInProgress()` uses the **autosave/resume** meaning (returns `false` always): the match
snapshots after every settled action into `gamehub.dominoes.save.v1` and restores silently on the
next mount, so leaving mid-match is lossless and the hub's "leave game?" confirm would be a lie.

**Not immersive on purpose.** The spec's own header band carries a back chevron; immersive mode
would put the hub's floating back button in exactly that corner, so the game keeps the ordinary
hub header for going back and its teal band carries the back-to-setup chevron, the difficulty
chip, the scoreboard and restart.

**`_fit()` measures the host with a PROBE, and re-fits after layout.** Two separate defects put a
collapsed, unplayable board on screen for anyone who left a match and came back (2026-08-01,
reported with a screenshot), and both are worth not repeating:

1. **It ran before the host had laid the container out.** The resume path mounts from the
   constructor, so `getBoundingClientRect().top` read **0** and the stack was sized for the whole
   viewport. `_refitSoon()` now re-fits on the next animation frame and again 150ms later; `_fit`
   is idempotent, so the extra calls cost nothing and the settled layout wins.
2. **It corrected by subtracting the document's total overflow.** That blames this element for
   overflow it may not have caused and can only ever SHRINK, so it could not undo defect 1 - it
   compounded it, landing on `.dm-play`'s 340px floor.

How it measures now: the page below the game (the hub's content padding) cannot be read off
`scrollHeight` directly, because **that value never drops below the viewport height**, so an
element shorter than the screen makes plain empty space look like host chrome (an intermediate
attempt did exactly that and under-sized every board). So it sets `--dm-h` to a 2000px PROBE,
where `scrollHeight` is pure content, reads `below = scrollHeight - ourTop - PROBE`, and then sets
the real height. Both writes are in one frame, so nothing paints at the probe size.

`innerHeight`, not `visualViewport.height`: it has to share a basis with `scrollHeight`, and
mixing the two over-shrank by the height of a phone's URL bar. **A game screen that scrolls at all
is a bug**, and so is one that does not fill what it was given; `.dm-play`'s `min-height` (340px)
is a last-resort floor, and if you ever see it actually binding, `_fit` is wrong again.

## Layout & responsibilities

```
dominoes/js/game.js     pure rules engine: the set, hands, boneyard, the chain, legality,
                        All Fives counting, going out, blocked rounds, match to target
dominoes/js/board.js    pure geometry: the chain's grid rectangles, spinner branches, elbows,
                        bounding box. Recomputed from scratch on every render
dominoes/js/ai.js       the three bot tiers (pure; the "thinking" pause lives in ui.js)
dominoes/js/tiles.js    the domino as markup, i18n-free, shared by the board and the tutorial
dominoes/js/tutorial.js the eight-page How to Play carousel and its illustrations
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
is placed anyway rather than dropped. Measured over 86,258 boards from 800 full simulated
matches: **one** overlapping board, on a 27-tile chain. The fit-to-felt scale absorbs it; dropping a tile would be a correctness bug, and
reserving corridors for the branches would need a two-pass layout to buy back two boards in a
hundred thousand.

## The badges, the count, and what the player can see

`openEnds()` returns three things per open end, and they are not the same number:

- **`value`** — the pip you must MATCH to play there.
- **`contrib`** — what that end adds to the All Fives count.
- **`pending`** — true for an open-but-unplayed spinner side: playable, but **not an end yet**, so
  `contrib` is 0 and the UI draws it as a hollow dashed marker rather than a coloured badge.

`countEnds()` is literally `sum(contrib)`, the end badge renders `contrib`, and a pending side
never shows a number to add up — so what the player totals on screen is exactly what the board
scores. `dominoes/js/test.js` pins that as an invariant over every board a full simulated match
can reach.

`value` and `contrib` differ for a double at the end of a run: it lies crosswise, both halves are
exposed, so it contributes twice over (a 6-6 at an end contributes 12) while you still play a 6
on it. Three cases, all pinned:

| Board | Ends | Count |
|---|---|---|
| lone 5-5 opener | it is BOTH ends at once, 5 each | 10, not 20 |
| 6-6 at the end of a run | one end, crosswise, both halves exposed | 12 |
| open spinner, no arms yet | two PENDING sides | 0 - they are places to play, not ends |

**Two bugs live here, in opposite directions. Both are worth knowing about.**

1. **Pending sides drawn as scoring badges (fixed, first attempt).** They showed a number and
   accepted plays, but counted nothing, so a board whose badges read 3 + 2 + 6 + 6 = 17 scored on
   5. Real inconsistency.
2. **Then counting them (fixed, second attempt - the over-correction).** Reading the main spec's
   "while the spinner has no arms yet, it counts as a single end of its full value" as *count the
   free sides* gave an open 6-6 a permanent **+12** on every count. A score-seeking bot exploits a
   constant far better than a person does: bot scoring went 24.6% -> 36.6% of plays while a casual
   human's stayed at ~19%, and matches ran 35-167. It is also arithmetically impossible - the
   reference screenshots show amber totals of 4, 6 and 7, which an open 6-6 could never allow.

The lesson for the next person: the fix for "the badges do not match the count" was to change how
pending sides are DRAWN, not what they are worth.

## The bot is not cheating, and the tiers contain no dice

Checked, because it does not feel that way when you lose 35-167 (reported 2026-08-01). Identical
strategy on both seats, 400 matches:

```
both MEDIUM: seat0 wins 51.3% | avg 288-287 | scoring plays 33.8% vs 33.8%
both EASY  : seat0 wins 45.8% | avg 278-281 | scoring plays 19.4% vs 19.9%
deal, 4000 rounds: avg pips 42.07 vs 42.09 | opens 2057 vs 1943
```

Same rules, same deal, one scoring function. `ai.js`'s `unseen()` is the full set minus the bot's
own hand minus the board, so it never reads `hands[1 - seat]`.

What the gap actually was: Medium evaluates every legal move and takes the highest-scoring one,
every turn — 33.8% of plays score. A player who cannot see which of their moves scores plays at
the blind rate, ~19%. Over a race to 300 that compounds to 2% human win rate. **An information
gap, not a difficulty one.**

So the hand shows **what each tile is worth**: a `+N` badge on any tile with a scoring placement
(`worth` in `_syncHands`, the max over that tile's legal moves). It is the same number the bot
optimises on, offered to the player.

**Do not "fix" bot strength by making it choose randomly.** It was measured (best move 85/70/55/40%
of the time -> human win rate 6/10/10/14%) and rejected: it buys a few points of win rate by making
the opponent erratic instead of beatable, which is coding luck into a game whose whole point is
counting. Tiers differ by what the bot KNOWS and how far it looks - random legal move, greedy
score, greedy plus one-ply lookahead and void tracking - never by a die roll on top of a better
move.

## Rules (All Fives)

## Rules (All Fives)

1. Double-six set, 28 tiles, 7 each, the remaining 14 are the boneyard.
2. **Every round is opened by the highest double in play, and the lead is FORCED** (addendum A3:
   "the very first tile is always a double and always the spinner"). `startRound` computes
   `openerTileId` and seats the turn with whoever was dealt it; `legalMoves()` returns exactly
   that one move while the board is empty, so the opener has no choice and the other seat has no
   moves at all.
   - **This supersedes the main spec's §7.2 on two counts, deliberately.** The spec said later
     rounds are opened by the previous round's winner, and an earlier build of this game let the
     opener lead any tile. Neither survives A3's invariant: a previous-winner lead only opens
     with a double by luck, and a free choice almost never does. `leader` is gone from the engine
     entirely; the deal alone decides who opens.
   - The **heaviest-tile fallback** still exists for the one case A3 cannot cover: all seven
     doubles sitting in the boneyard (~1 deal in a few hundred). That round opens without a
     spinner and the first double played later becomes one, on the unchanged code path.
   - Nice side effect, and the reason it is worth doing beyond fidelity: on the first turn of
     every round exactly one tile in your hand is lit, which teaches the rule with no text.
3. On your turn: play a tile matching an open end, or draw until you can. Passing is only legal
   with an empty boneyard, and drawing is only legal with no play — `requiredAction()` is the one
   function that decides which, for both seats.
4. Doubles lie crosswise. The **first double played** is the spinner; its two perpendicular sides
   open only once the main line has a tile on both of its in-line sides (the standard rule), and
   an unplayed branch side is **not** an end and counts nothing.
5. **Counting**: sum the open ends after each placement; a multiple of five scores itself. See
   "The badges, the count, and what the player can see" above — that section is the whole rule,
   and it carries both scoring bugs this game has had, in opposite directions.
6. **At a round end BOTH players score the pips left in their OPPONENT's hand** (addendum A1,
   which corrected the main spec). Going out is simply the case where one of those two totals is
   zero; a blocked round pays each side the other's leftovers rather than paying one side the
   difference, and equal hands pay both equally with no winner named. These are **raw** pip
   counts, never rounded to a five, which is why a round total like 31 is legitimate while an
   in-play score never is. `_settleRound` is the single function that does this for both endings.
7. **Reach OR PASS the target** to win (addendum A4 — a final total of 304 is a normal win, not
   an edge case). Because both sides gain at every settle, both totals can cross in the SAME
   settle, so `matchWinner` is null on a genuine draw and every caller has to cope with that
   (`dm.tied`, the finished card's medal-less rows).

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

Measured over 600 matches per pairing, re-run after the A1/A3 rule changes (`node
dominoes/js/test.js` covers legality and termination; the strength numbers came from a throwaway
sweep, re-run after the scoring fix): medium beats easy 96.8%, hard beats easy 98.7%, hard beats
medium 67.3%, and easy against itself is 50.3%, which is the honest size of the first-mover edge.

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

  **The badge number is the end's CONTRIBUTION, not the pip you match** (changed 2026-08-01
  alongside the scoring fix above; an earlier build showed the match value and argued for it
  here). A 6-6 at a run end reads 12 even though you play a 6 on it. That is the trade: the badge
  gives up being a placement hint so that the badges always sum to the score, which is the one
  thing a player has to be able to do in All Fives. It also matches addendum A2's "green shows
  the number you would gain" and the reference screenshots' badge value of 10, which is only
  reachable as a doubled 5-5. Placement is not hurt: illegal tiles are already dimmed, and
  lifting a tile lights only the ends it can legally go on, so the badge number was never how you
  found a legal move.
- **What just happened** — a `+5` and a star burst at the tile that caused it, plus the header
  score counting up. Never a log, never a banner.

Everything else (bot thinking, the boneyard drawer, a pass, the round card) is an **overlay**.
The header, both hand rows and the floor keep fixed space, so nothing in the play screen ever
reflows.

## How to play: the eight-page carousel (`tutorial.js`)

Addendum §B/§C. Opened from the purple `?` on the setup screen; a near-black card holding a
**white** block, which is the whole visual hook — nothing else in this game is white like that.
Eight pages, one illustration and one sentence each, the captions verbatim from §C
(`tut_1`..`tut_8` in `strings.js`).

**The illustrations are the real game rendered small, not eight drawings.** They use the same
`tileHTML` the board uses and the same `layoutChain` geometry, on a frame whose three background
colours are swapped to the tutorial palette (cyan header, peach felt, flat red floor — cyan for
the bot's side, red for yours, so the art itself teaches which end is which). Every board is
built by running the engine's own `placeOn`, so an illustration can never show a position the
rules would reject, and a change to a tile or to the layout follows into the tutorial for free.
`miniBoard()` returns an `at(a, b)` helper so a page hangs the pointing hand off the exact tile
its caption is about rather than a guessed coordinate.

Two teaching devices, both from §B: the **amber ring** (`.dm-ring`, around the 6-6 in your hand
on page 2 and around both open ends on page 4) and the **cartoon pointing hand** (`.dm-point`,
drawn in a faded red on the blocked page, off to the side away from any tile, which reads as
"this tap does nothing").

**The two side buttons are PREVIOUS and NEXT, not first and last.** The addendum specifies
first/last, that is what shipped, and it was wrong in practice: the only two visible controls
jumped between page 1 and page 8, so a player tapping through the tutorial saw exactly two of
the eight pages and reasonably concluded only two existed (reported 2026-08-01). The other six
were reachable only by swiping. A build note in this very file had even observed that first/last
"leaves nothing that pages one step at a time" and answered it with ARROW KEYS, on a phone game —
if a fix for a touch UI is a keyboard, it is not a fix. Swipe, tappable dots and the arrow keys
all still work; the buttons disable at the ends. Two things that bit and are worth not re-learning: the overlay is
`position: fixed` (the setup screen's `.dm-root` is only as tall as its own content, so an
absolute scrim left the page undimmed), and the card carries an explicit `z-index` (without one
the absolutely-positioned scrim covered the page dots, so tapping one closed the tutorial).

## The Game Finished card (addendum §D)

The same slate card as the round card, with four differences: titled `Game Finished!` with no
rules reminder under it (just space, then the table), and the avatar becomes the winner's face
on a **green celebration disc with a crown** over it.

The addendum describes a green avatar and `Red`/`Blue` row labels but flags both as possibly
coming from a two-colour variant and recommends keeping YOU/BOT. That recommendation is taken,
and extended to the face: the disc goes green and gains the crown, but the face stays the
WINNER's own (your red smiley or the bot's tiered scowl), so the red-you / blue-bot identity the
rest of the screen teaches survives to the last screen. A drawn match gets neither crown nor
medals, which reads as level without needing a word for it.

## Settings & persistence

- `gamehub.dominoes.v1` — `{ difficulty, target }`. Precedence: saved settings > the shared
  profile's first opponent skill (1/2/3 → easy/medium/hard) > medium. An unknown target falls
  back to 300, so a future removed option can never crash the setup screen.
- **Getting back to the setup screen mid-match** is the header's LEFT icon (the 36px slot that
  was a bare spacer until 2026-08-01). It is deliberately **non-destructive**: it persists and
  leaves the save alone, so setup can offer **Resume match** alongside **New match** (Play is
  relabelled whenever a live save exists) and only `start` ever clears it. Before this there was
  no route at all — the header restart only ever restarted the match at the same settings, the
  match-over card's red button was the sole path to setup, and backing out to the hub just
  resumed on re-entry. Changing difficulty or target mid-match was impossible.
- `gamehub.dominoes.save.v1` — `{ snap, difficulty, target, bestRound, statsCommitted, ts }`,
  written after every settled action and on `destroy()`. `statsCommitted` rides in the save so a
  finished match cannot be recorded twice by a restore.
- Language is NOT stored here: it is the hub-wide `gamehub.lang.v1`.

## Stats

`recordDominoes(difficulty, won, extras)` in `js/game-stats.js`, called **once per MATCH** (a
race to the target, not per round), guarded by `_statsCommitted`. `dm: { played, won, lost, tied,
rounds, bestRound, points }` — counters additive, `bestRound` Math.max only per THE LAW rule 2.

**`tied` is real here** (it was omitted in this game's first build, when only the player who went
out scored). Under addendum A1 both players gain at every settle, so both totals can pass the
target in the same round and land equal; `matchWinner` is null then and `recordDominoes` reads a
null `won` as a tie, matching `recordTicTacToe`/`recordDotsBoxes`/`recordBoggle`/`recordYahtzee`.
Rare, not impossible — which is exactly the kind of thing that must be stored before it happens
rather than after somebody reports a loss they did not take.

All three mandatory sub-counter surfaces exist (root checklist item 7): the `ensureDm`/
`recordDominoes` pair in `js/game-stats.js`, `dominoesScreen` in `js/game-stats-ui.js`, and the
`dm` branch in `js/players-agg.js` with its own regression case in `players-agg.test.mjs`.
Dominoes is a COMPETITIVE game (not in players-agg's `SOLO` set), so the leaderboard shows it on
the ordinary wins metric with no extra wiring.

## Tests

```
node dominoes/js/test.js
```
553 assertions: the set's integrity, every All Fives counting case above (including the lone
double and the interior spinner), branch opening, legality including a tile that fits both ends,
chain bookkeeping, the non-destructive `countAfter` preview, the deal, drawing and passing
legality, a snapshot round trip, board geometry (crosswise doubles, branch direction, a folded
run, no overlaps), the bot tiers' choices and legality, plus a 60-full-match sweep asserting that
no tile is ever lost, every placed tile is laid out, no chain overlaps itself, **the end badges
always sum to the score the board is showing**, and in-play scores are always multiples of five
credited only to the mover (round-ending plays are excluded there — the A1 settle pays both
sides raw pip counts, and its own blocks cover it).

The addendum's rule changes each have their own block, and they are the ones to keep green:
**A1** going out (opponent's leftovers, zero back the other way) and blocked rounds both ways,
including equal hands paying both sides; **A3** a 40-seed sweep proving every round opens on the
highest double in play, that it is the opener's ONLY legal move, that the other seat has none,
that it becomes the spinner the moment it lands, and that round 2 is decided by its own deal
rather than by who won round 1; **A4** an overshoot (304 on a 300 target) still winning, and both
totals crossing in one settle producing a real match end with the higher total winning.
Wired into `run-all-tests.mjs`.
