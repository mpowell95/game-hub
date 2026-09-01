# Monopoly Deal (`business-deal/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`, which is always
> loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

Hub integration: launch-out `href:` (in-repo `business-deal/`, own nested service worker).

## Naming (settled — do not change)

The game is called **Monopoly Deal**. Every user-visible string says "Monopoly Deal":
hub card title, page title, PWA manifest name/short_name, iOS home-screen title,
watermark, setup dialog, in-game menus, My Stats label, leaderboard label.

The folder is `business-deal/` and several internal identifiers use `business` / `bd`.
**This is intentional and must never be "fixed."** A directory name is not a display
name. These identifiers are load-bearing:

- `business-deal/` is the live URL path. Renaming it breaks every installed PWA on
  every family device (PWA scope and start_url are path-based) and every bookmark.
- The stats game id `'business'` is the key inside every player's `gamehub.stats` and
  inside Firebase RTDB at `players/<deviceId>/games/business`. Renaming it orphans
  every Monopoly Deal record anyone has ever accumulated. THE LAW #1.
- `bd-stats` is folded in ONCE by foldLegacy. Rename it and the old data can never be
  recovered.
- `gamehub.bd.pendingStats.v1` is the offline retry queue. Rename it and queued plays
  are stranded on players' devices permanently.

If a future audit or review calls the folder-name/display-name split "contradictory,"
that review is mistaken. It is not a contradiction and requires no action.
Do not rename the game to "Business Deal." Do not rename the folder. Do not rename
the stats ids. This is closed.

## Difficulty (reworked 2026-09-01 — read this before touching `js/ai.js`)

Matt asked for a review of this game, "specifically the difficulty settings/code," and added two
observations: that the AIs steal from him more than from each other "even when it doesn't make
sense," and that they always seem to hold the perfect card. Both were measured. One was a real
bug, one was not, and the difficulty settings themselves turned out to be broken.

### Easy/Normal/Hard were one setting

Measured AI vs AI, seats swapped so a first-player edge cannot be mistaken for a difficulty edge
(n=800 per cell before, n=1,200 after; all intervals about +/-3):

| | before | after |
|---|---|---|
| Hard vs Hard (baseline) | 51.5% | 50.5% |
| **Medium** vs Hard | **49.5%** — identical to Hard | **36.6%** |
| **Easy** vs Hard | **42.0%** | **18.8%** |

Difficulty only touched two things: a blunder rate and Just Say No reliability. Payment (an
optimal knapsack DP), discards, wildcard placement, target choice, banking and card valuation
were all solved perfectly at every level, which is most of what a person notices.

**The knob table in the `AIAgent` constructor carries the measured value of every lever, and the
numbers there are the point.** Do not add or retune a knob by intuition; three of the obvious ones
do essentially nothing:

- `stopEarly` (don't use all three plays every turn) is THE lever, and sharply non-linear.
- `jsn` is the second real one.
- `blunder` is weak until it is nearly total — the engine gives 3 slots a turn, so a passed-over
  move is usually just made one slot later.
- `discard` and `wild` are worth ~0 win rate and are kept **for feel, not strength** (below).
- A `pay` knob (settle debts cheapest-first instead of optimally) was built, measured at 54.0% —
  slightly *better* than playing optimally, because giving up low-rank bank money protects
  property — and removed. Overpaying is also invisible to the person being paid. Do not re-add it.

**The first sweep of these knobs was contaminated** by the winning-move bug below and made
`passivity` look worth 20 points when most of that was the easy AI declining to win. Any new
number must be measured with that guard in place. `node business-deal/js/ai.js` re-runs the whole
thing; its ladder assertion is born red against the pre-rework values.

### The AI declined to win

The blunder path picked uniformly from every positive-scoring move — including the winning one.
Easy passed up an available immediate win in about one game in five (60 times in 300), Normal one
in twelve. `chooseMove` now scores the full move list and returns a WIN-tier move before any
difficulty knob runs, which also matters for ordering: a winning move is often itself an attack, so
the `passivity` filter would otherwise hide it. Losing on purpose is not a difficulty setting.

### They really were ganging up on the human (fixed)

`enumerateMoves` lists victims in PLAYER-ID order and `chooseMove` used a strict `>`, so **the
first-enumerated victim won every tie — and seat 0 is always the human.** Over 400 four-player
games of four *identical* Hard AIs:

| seat | before | after | fair share |
|---|---|---|---|
| **0 (the human's seat)** | **42.9%** | **31.3%** | 25% |
| 1 | 27.6% | 25.9% | 25% |
| 2 | 17.5% | 23.1% | 25% |
| 3 | 12.0% | 19.8% | 25% |

44% of targeted attacks were exact ties; seat 0 won 1,122 of them and seat 3 won **zero**.
`scoreSly` was the worst of it — it had no opponent term at all, so who got robbed was decided
purely by enumeration order. Two fixes: ties are now broken at RANDOM, and `threatOf()` gives the
victim-choosing scorers an actual reason to prefer one target (so fewer decisions come down to a
tie at all).

**The residual 31.3% is legitimate and is not tie-breaking** — turning `threatOf` off leaves it at
30.5%. Seat 0 moves first, so it carries the most property on the board (4.70 cards to seat 3's
3.88) and is genuinely the biggest target. Don't "fix" it again by flattening the distribution.

### The cards are NOT rigged

`Deck.shuffle` is a correct Fisher-Yates and the deal is round-robin from one deck. Over 400
games every seat drew action cards at **32.2-32.7%** against a **32.08%** deck baseline. The
AI's view (`game.js` `getView`) exposes only `handCount` for opponents — it cannot see anybody's
hand. If this is ever asked again, the answer is measured, not assumed.

**What "they always have the perfect card" actually was:** `cardUsefulness` rated Just Say No
above everything, so the AI banked or discarded one **exactly 0 times in 300 games** and held one
on 29% of its turns. That is why `discard` and `keepJSN` exist despite being worth no win rate —
they are the only route by which an easier AI ever loses a Just Say No. Hard still never does,
which is what Hard is for.

## There is no "Reset stats" button, and there must not be one again (removed 2026-09-01)

The Stats sheet had one, calling `localStorage.removeItem('bd-stats')` with no confirmation, one
tap from Back. It broke THE LAW two ways:

1. It wiped the played/won/lost that screen exists to show, with no undo — earned history, which
   rule 2 says is never destroyed.
2. `bd-stats` is folded into the unified `gamehub.stats` exactly ONCE, and **that fold only runs
   inside `record()`, i.e. only when a game finishes.** On any device where `business._leg` had
   not latched yet, the button destroyed that player's entire pre-unified Monopoly Deal history
   before it could ever be carried forward — permanently, because `foldLegacy` would then find
   nothing (rules 1 and 5).

The app-wide clears that legitimately exist are node scripts with a backup, a dry run and a
verified re-read. A button in a game is the wrong home for one.

## Two small settled things

- **`APP_VERSION` in `js/ui.js` must equal the number in `sw.js`'s `CACHE`.** They had drifted six
  builds apart (v26 against a deployed v32), which made the stamp on the setup screen — whose only
  job is telling you which build you are on — a lie. Resynced at v33; bump both together.
- **Displayed difficulty is Easy / Medium / Hard; the STORED ids are still `easy` / `normal` /
  `hard`.** Label-only rename, so the middle rung matches every other game and the leaderboard.
  The stored ids are `byDiff` bucket keys in every player's `gamehub.stats` and in
  `players/<id>` (rule 5), and `js/difficulty-tiers.js` maps `normal` to tier 2 on the read path.
  The challenge hook also tests `difficulty === 'normal'`. Never rename the ids.
- The setup choice (opponent count + difficulty) is remembered in `gamehub.bd.setup.v1`. It is a
  one-tap preference holding no earned history, so it is exempt from rule 2, exactly as the hub's
  launcher favorites are. Before it, every fresh open silently reset the difficulty.

## Notes

Full-screen PWA that lives **in this repo** (`business-deal/`), launched like Parchís; `window.*` globals + its own nested service worker, not ESM. A precedent, not the preferred pattern. The standalone "Just Say No?" prompt (2026-07-22) is now bypassed for the case that has a known cash amount (rent/Debt Collector/Birthday) and the human is the one who'd pay: `HumanAgent.respondToAction` routes that case through `promptPayment(view, ctx, {jsn:true})` instead, adding Just Say No as one more choice alongside Pay/Clear on the normal pay screen (bank + properties + amount already visible). Declining it caches the chosen payment (keyed by creditorId+amount+reason) so the immediately-following `choosePayment()` call reuses it rather than prompting twice - the cache is only ever set for a real (>=1 card) payment, since `_charge()`'s `required<=0` early return never calls `choosePayment` for a "nothing to pay" case and would otherwise leave a stale entry. The property-steal actions (Sly Deal/Forced Deal/Deal Breaker, no cash amount) and the "counter their cancellation of YOUR action" attacker-side case still use the original standalone prompt.

The three must-stay-synced duplicates this game carries (profile reader, challenge crypto
mirror, stats recorder) are documented in the root `CLAUDE.md` under "Monopoly Deal's
must-stay-synced duplicates" — the canonical halves live in root `js/`, so that list stays
root-side.
