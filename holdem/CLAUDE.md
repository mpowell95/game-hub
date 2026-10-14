# Texas Hold'em (`holdem/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`,
> which is always loaded alongside this file (full rule rationale: `js/CLAUDE.md`).

**Keep this file short.** A new rule goes here in one or two lines; the story behind it goes in `CLAUDE-HISTORY.md` (append a dated section). Full original text: `CLAUDE-HISTORY.md`.

No-limit Texas Hold'em, built 2026-09-27: rooms by code, up to 8 seats, solo vs up to 7 computers.
The Hub has no server, so **the host's phone is the server.**

## Hub integration

- In-hub `module: '../holdem/js/ui.js'`, **immersive**; standalone `holdem/index.html`, name-gated.
  `released: '2026-09-27'`, live to everyone. Stats id `'holdem'` (= hub id), generic `recordResult`;
  `GAME_META` and `TABS` rows exist (the Yahtzee lesson).
- `isInProgress()`: **solo false** (autosaved); **online true** while a game runs and this player has
  chips. `destroy()` never gives up a seat; only Leave does.

## Files

| File | Role |
|---|---|
| `js/engine.js` | Pure rules: deck, evaluator, blinds, betting, side pots, showdown, bust-outs, `publicView()`, `payout()`, `rigDeal`. No DOM. |
| `js/ai.js` | Computers: Monte Carlo equity + pot odds, skills 1-3 (+ Brutal 4 for the rig). Reads only its own cards, board, betting. |
| `js/table.js` | Dealer loop (`Table`): moves, bots, turn clock, away/sit-out auto-fold, next deal, `PACES`. No DOM/network. |
| `js/net-table.js` | Firebase glue for `rooms/<CODE>/pk`. |
| `js/ui.js` | Setup, lobby, table, host/guest sync, `TIERS`, `ALLEY`, `THEMES`. |
| `js/strings.js` | EN/ES. |
| `js/test.js` | `node holdem/js/test.js`: ranks, pots, betting order, 60 bot-only tournaments (chip total checked after EVERY action), deterrents, rig. Not deployed. |

## Rules as implemented

- Tournament: start 1,000 (scaled, see Stack = buy-in); blinds 10/20 rising ~1.5x every 6/10/15
  hands (Fast/Normal/Slow); no chips = out; last holding chips wins. Same-hand double bust: the one
  who started with more finishes higher.
- Heads-up: button posts the small blind, acts first preflop, last after.
- A raise must be at least the previous bet/raise. **An all-in for less than a full raise does not
  reopen the betting** (`canRaise[]`, pinned by `test.js`).
- Side pots: `buildPots()` levels by every non-folded all-in cap; a folded player's chips stay in
  the pots they reached. Uncalled chips return as a one-player pot flagged **`back: true`** (since
  2026-10-05); levelling stops first at the most any folded player put in, so a win and a refund
  never share a pot. Odd chips go to the first winner left of the button.
- Everyone all-in: board runs out (`h.runout`). A player who leaves folds at once and forfeits their stack.

## Online: host-authoritative, NOT lockstep

A lockstep deck is a deck every device holds, so every hand would be readable. The host runs `Table`
on the full state and publishes; guests render and send moves. `js/net.js` is used **unchanged**
(`createRoom(..., {seats: 8})`, `joinSeat`, `heartbeat`, `vacateSeat`, `leaveRoom`, `onRoom`,
`sendReaction`); the game writes one child of its own room:

| path | writer | what |
|---|---|---|
| `pk/lobby` | host | JSON: computers and blind speed, before the deal |
| `pk/pub` | host | JSON: `engine.publicView()` + `gid` + `waiting` (no deck, no hole cards) |
| `pk/hole/<seat>` | host | JSON `{g, h, c}`: that seat's two cards |
| `pk/act/<seat>` | that seat | JSON `{g, h, k, a, to, n}`: one move, or `leave` / `back` |
| `pk/clock` | host | `{k, ms}` turn time left |
| `pk/bank/<seat>` | that seat | number: guest bankroll, so the host deals it into a money table only if it can pay |

- **Values are JSON strings** (RTDB drops empty arrays/nulls, turns sparse arrays into objects).
- A move applies only if `g`/`h`/`k` match the host's current game, hand and action counter (`state.k`);
  `n` is a nonce so a repeated identical move is seen as new.
- **Presence**: host notes when each heartbeat stamp last CHANGED on its OWN clock (never compares
  two devices' clocks); 35s = Away (auto check/fold). A human who lets the 45s clock run out sits
  out until they act or tap "I'm back".
- Joining mid-game: watch, dealt in at the next "New game".
- Rejoining: `gamehub.holdem.mp.v1` `{code, seat, host, rec, bots}` (+ full `state` on the host);
  a host rejoin restores the dealer from its save and marks already-seen nonces.
- **Host Leave closes the table for everyone** (`net.leaveRoom`); no host migration.

**Honest limit, say it plainly:** `rooms/` is `auth != null`, so developer tools can read `pk/hole/*`;
real secrecy needs a server dealer (does not exist).

## The bankroll (2026-09-27)

Matt approved: start **$25,000**, **1st takes 65% and 2nd 35%**, **online tables use it too**.

- **Stored as a LEDGER, never a balance**: `games.holdem.hb = { buyins, winnings, grants, best,
  cashes, entries }` (+ `alley`) in `gamehub.stats` via `recordHoldemBank`. Fields only grow (best
  `Math.max`; THE LAW rule 2). Balance is DERIVED: `holdemBalance(hb) = HOLDEM_START_BANK +
  winnings + grants - buyins` (the $25,000 added once at read time).
- Follows the player to every device: players-agg sums ledgers (`hb` branch); `ui.js` `bank()` =
  this device's ledger + `bankRemote` (combined-minus-local, so a later local write is not counted
  twice). Offline shows this device's ledger.
- **Tables** (`TIERS`): Buddy's House $500, Las Vegas $1,000, Regional $5,000, World $10,000, Solar
  System $100,000, Galaxy $1,000,000, Universe $10,000,000; locked until the bankroll covers it.
  Plus **Behind the Dumpster** (`ALLEY`, below), always first.
- **Money moves at exactly two moments**: buy-in when cards are dealt (solo `_newSolo`; online
  `_stake`, once per game per device, keyed `code:gid:stake`) and the prize when the player's place
  is decided (`payout()`: everyone puts the buy-in in; 3+ players 1st 65% / 2nd rest; heads-up see
  below). It rides the same once-per-game dedupe as the result (`state.rec` solo, `code:gid`
  online), so a reload can never pay twice. Walking away pays nothing.
- **Not behind the rate gate** (`test-rate-guard.mjs` EXEMPT): a refused buy-in is a free game, a
  refused prize is lost money. A failed write is queued and replayed (`persistOrQueue`).
- Visible: setup screen, table picker, end card ("+$X to your bankroll"), My Stats, leaderboard.
- Bankroll maths never uses `| 0` on the money path (top table pays $52M a win; 2^31 wraps).

### Heads-up pays less (2026-10-13)

Matt: *"the payout shouldn't be the full payout if you play against only 1 person."* Heads-up winner
gets **75% of the pot = 1.5x buy-in** (`HEADS_UP_SHARE`); 3+ unchanged. **Versioned**: new games carry
`cfg.pv = 2` (`PAYOUT_V`); `_prizeFor` passes `pub.cfg.pv || 1`, so older saves pay v1.
**`js/game-stats.js`'s valid-prize set accepts BOTH rules for ever** (rule 1: old heads-up prizes
must never read "Under review"); `HOLDEM_MAX_PRIZE` is computed from v1.

### Bigger tables, tougher computers (2026-10-08)

`payout()` ignores skill, so **the table decides the computers' skill** (`TIERS[].skill`): Easy at
Buddy's/Las Vegas, Medium at Regional/World, **Hard at Solar System and up**. Solo setup has no Skill
row; `_newSolo` deals `tier.skill` and records under it. Online on a buy-in table the table's skill
replaces the lobby picker (`_netBots()`); "No buy-in" keeps the host's pick. `settings.skill` is still
written, nothing reads it for table games (rule 5). `test.js` fails if a bigger table gets easier
computers or a money table is not Hard.

### No free seats, and no refill (2026-10-08)

Matt: *"OBVIOUSLY NO SEAT SHOULD BE FREE."* `payout()` sizes the pot from EVERY seat, so a free
guest seat let the host win 2x buy-in having paid once. Now every seat at a money table pays: a guest
writes its bankroll to `pk/bank/<seat>` (`_publishBank`); the host deals in only seats that cover the
buy-in (`_payingSeat`; host's own via `_netTier()`); older-build guests publish nothing and watch; the
lobby marks "Can't cover"; Start needs two paying people (`need_two_paying`). `_stake` always charges
a dealt-in seat (an old save's `:free` key is still honoured). "No buy-in" tables deal everyone and pay
nobody. `HOLDEM_REFILL` ($500) stays in `js/game-stats.js` (refuses bigger grants; existing grants
untouched) but no refill is offered (Behind the Dumpster replaced it). Self-play online is blocked at
the room layer (root `CLAUDE.md`, "Online play needs an account Matt has let in").

### Behind the Dumpster (2026-10-08)

Matt: *"call it something more insulting... bottle caps instead of cookies... the table should ALWAYS
be visible"*, *"make it 2 wins. Bottle caps, you can hold at most 3, and sure on 2 hours."*

- `ALLEY` in `ui.js`, **deliberately NOT in `TIERS`** (no `buyin`; `test.js` reads money tables out
  of TIERS by that shape). First tile always, solo only, Easy computers, $100 stacks at $1/$2.
- Buy-in is a bottle cap: `gamehub.holdem.caps.v1 = { at }`, ONE timestamp; caps = whole 2-hour
  periods since `at`, max 3 (`capsState`); `spendCap` moves `at` forward (from "full" if more had
  built up); new device starts full; spent when cards are dealt. Tile shows discs (fill and outline,
  not colour alone) and a live countdown. **Device-local refilling allowance, not earned history**
  (rule 2 n/a). **Honest limit: a wound-forward phone clock refills early.**
- **Winner alone gets $250** (`HOLDEM_ALLEY_PRIZE`), recorded as `recordHoldemBank({ grant: 250,
  alley: true })`: a GRANT, not a prize (not a cash, not a Biggest prize). `alley: true` counts
  **`hb.alley`** (additive, summed by `players-agg.js`, part of a void baseline in
  `js/stats-corrections.js`); `holdemSuspect` allows `grants <= entries * $25,000 + alley * $250`;
  `recordHoldemBank` refuses an `alley` write of any other amount; alley wins share the 20-a-minute
  prize cap. Result records under Easy.

### Stack = buy-in (2026-10-08)

`stackOf(table)` = `{ chips: buyin, scale: buyin / 1000 }`: every table opens at 50 big blinds
(Buddy's $500 at $5/$10, World $10,000 at $100/$200, Universe $10M at $100k/$200k). Online money
tables too (`_startNet`); no-buy-in online keeps the plain $10,000 game. `engine.js` takes a
fractional `scale` and ROUNDS each blind level (`blindsOf`); a whole-number scale (every earlier save)
deals exactly as before. Hand stats' Biggest pot is in table chips; old values kept (`Math.max`).

### Who you play (2026-10-08)

`THEMES` in `ui.js`, seven per table, random order (`botRoster(n, skill, tableId)`). Solo only;
online keeps the house list; profile opponents are not used at solo tables.

## The shove exploit, the fix, and the rig (2026-10-10)

Matt: *"King of games has $50m... Either he's cheating or it's WAY too easy."* `ai.js` made bots want
`0.12 x skill` extra equity to call off their stack, so all-in-every-hand beat one Hard computer 91%.
**Fix:** `commit` per skill (Easy 0.08, Medium 0.02, Hard 0), call margins looser (Medium -0.02, Hard
-0.05); `test.js` fails above 62% heads-up. **The rig** (`RIGGED_CODES` in `ui.js`; `rig: <seat>` on
`Table`; `rigDeal`; Brutal skill 4 + `decide(..., { peek })`) was **taken off 2026-10-14** (Matt:
*"Take off the fix against the king of games"*): `RIGGED_CODES` is empty, games deal fair. The
mechanism stays for a future name; `test.js` still measures it (rigged all-in-every-hand <=20%; a
rigged deal is one real 52-card deck). Nothing about it is saved in state. His $50M was NOT touched
(Void bankroll is Matt's call).

## Bankroll leaderboard (2026-09-28) and Bankrolls page (2026-10-06)

- The Hold'em board ranks by **Bankroll** (`gameMetricAt('holdem')` = `hbBankOf(g)`, voids applied);
  pills Bankroll (leftmost), Wins (`hwins`), Games, Name. **UNTIERED** (`METRIC_IS_TIER_BLIND`,
  `boardTierOf` null). A `holdemSuspect()` ledger prints **"Under review"** and sorts last.
- **Bankrolls page** (`screen = 'bank'`, `_renderBank`): your numbers (`_myBankFull`) above everyone
  who ever played for money (`entries || grants`) via `readPlayersOnce` -> hidden prefixes ->
  `aggregatePlayers(all, corrections())` -> `isHiddenName`; sort Bankroll or Lifetime winnings;
  **never scrolls** (`_fitBank` drops rows from the bottom, never yours or the picked one); empty
  read = offline with **Try again**; read-only. Tapping a row (`this.bankPick`) shows their numbers
  (tap it again, or your own row, to go back); rows are `role="button"` divs. **No "Show mine"
  button and one fixed card height since 2026-10-14** (Matt: *"useless and is a waste of space"*;
  the card moved when switching players): an "Under review" card keeps the numbers' space hidden
  (`.pk-bknums`) with the label laid over it. Measured 173px for every row.

## Hand stats (2026-09-28)

`recordHoldemHand` writes `games.holdem.hs = { hands, won, bigPot, best, bestCat, bestCards }`, one
write per hand this player was dealt into, from `_handEnd()` (solo, host, guest all go through it).
hands/won add; bigPot/best `Math.max`; best = `engine.evaluate` when they saw all five board cards and
did not fold. Dedupe: `gamehub.holdem.hands.v1` (last 40 `gid:handNo`). Exempt from the 30-a-minute
gate. Not retroactive before 2026-09-28. A **`back` pot is not a win anywhere** (not a hand won, not
a biggest pot).

## Screen behaviour that is in force

- **Last hand** button replays from `h.log` (public), memory only (`this.lastHand`).
- **Computer speed** Slow/Normal/Fast (`settings.pace`, `PACES` in `table.js`: 1.5-2.8 / 0.8-1.7 /
  0.25-0.6s); `Table.setPace` applies from the next move. Not the tournament's blind speed.
- **Table settings gear** (`.pk-gear`, `overlay = 'tset'`, 2026-10-13): separate **Check / Fold
  button** (`settings.cfMode: 'split' | 'one'`, **ON by default since 2026-10-14**; the first
  build's `cfSplit` is ignored in storage), Computer speed, **Go to casino floor** (CASINO FLOOR =
  table picker `screen = 'tiers'`; MENU = setup). The split button (`.pk-cfbtn`, 44px) is live ONLY
  on someone else's turn (`this.canPre`) so a finger can never land on CALL (Matt hit Call after a
  raise); on your turn the big button stays dead (`mode = 'idle'`) 350ms until the auto check/fold
  has gone (`this.autoDone`). Online the room-code pill sits at `left: 36px`. Solo end card:
  **Casino floor** / **Menu** over **Play again**.
- A saved tournament dims the casino floor tables (`.is-held`) and `_newSolo` **refuses to deal over
  a saved tournament** (its buy-in is paid and its result would vanish).
- **The last hand is shown before the results**: `_checkOver` holds the popup for `RESULT_MS + 350 *
  runout` when the device watched live (`this.overHold`); a tap skips.
- **Your own win is as visible as an opponent's**: gold message pill (`.pk-ml.is-mine`), gold **YOU
  WIN** stamp (`.pk-mywin`), green chips (`.pk-mygain`). Word first, colour second.
- **Every pot is named, SPLIT not WIN**: `_message()` returns `[{ text, mine }]`, one line per pot
  won, **at most three lines** (a pot this player won is never the one cut); a seat that only shared
  pots wears SPLIT.
- **Step away and resume**: the red X asks first. Solo **Save and leave** keeps
  `gamehub.holdem.save.v1` and setup shows **Resume tournament**; **Give up this tournament**
  (`_forfeitSave`, guarded by the save's `rec` flag) records one loss. Online **Step away** keeps the
  seat (host stepping away pauses the table); **Give up** / **Close the table** do what the old X did
  (`_leave`). Stepping away records nothing.

## Cheat deterrents (2026-09-28)

Matt asked for "cheat proof", was offered a server dealer, and chose **deterrents only**. **None of
this stops a determined player** (every number is written by code on their phone; hole cards online
are readable with developer tools). What exists:

1. **Impossible amounts refused at write time** (`recordHoldemBank`): buy-in not in `HOLDEM_BUYINS`,
   prize no finish pays (`holdemValidPrize`), top-up over $500 (`HOLDEM_REFILL`), dumpster win not
   exactly $250. Refusals counted in `gamehub.rate.v1` `blocked['holdem-bank']`, which rides the
   stats mirror (`rate`).
2. **Prizes rate-capped**: more than 20 a minute refused.
3. **`holdemSuspect(hb)`** (pure, `js/game-stats.js`) names why a ledger could not come from real
   play; every check survives adding two real ledgers, so it runs on a PERSON's combined ledger.
   `test.js` plays 200 random 60-game careers and asserts none is flagged and that buy-in/prize lists
   match `TIERS` and `payout()` exactly.
4. **Voiding**: admin page **Poker bankrolls** section (flagged first), **Void bankroll** / **Undo
   void**: an OVERLAY (`adminConfig/v1/corrections/holdem/<statsId>`, `correctHoldemLedger`), a
   BASELINE at that moment so the bankroll reads $25,000 and later games count; the raw ledger is
   never touched (THE LAW); reaches every device and the game's own `bank()`.
5. **Two-tab trick closed (2026-10-13)**: **one window per tournament**, `gamehub.holdem.tab.v1 = {
   id, at }` claimed by `_startSolo`/give up; the newest wins and any other copy stops WITHOUT saving
   or recording (`_yieldTab`) and offers Resume. **The cards still to come are reshuffled before
   every street** (`nextStreet`), so a save says nothing about the flop/turn/river (a rigged hand
   keeps its run-out; the mark is an in-memory WeakSet). Still open: reading the computers' hole
   cards in the save with developer tools.

## Stats

One result per game per device, recorded **the moment the engine decides it** (never behind a modal).
Walking away records a loss for the one who left. Solo records under the computers' skill
(`easy`/`medium`/`hard`), online under `'mp'`. Dedupe: solo `state.rec` in the save; online `code:gid`
in the MP save.

## Keys

- `gamehub.holdem.v1` settings (tab, opponents, skill (unread since 2026-10-08), blind speed, `pace`,
  `cfMode`, lobby computer count/skill/table)
- `gamehub.holdem.hands.v1` last 40 counted hands; `gamehub.holdem.save.v1` solo game in progress;
  `gamehub.holdem.mp.v1` online seat (+ host's state)
- `gamehub.holdem.tab.v1` `{ id, at }` window lock (not history); `gamehub.holdem.caps.v1` `{ at }`
  bottle caps (device-local allowance, not history)

## Layout (a clone of Matt's reference recording, 2026-09-27) — rules in force

- Banner starts 96px in to clear the hub back button. Opponents on one curved row (`_layout`; 16px
  clear each end for the red X); the last action is a stamp pill over the avatar, **read from the
  hand's public `h.log`, NOT `h.last`** (the move that closes a round is wiped by `nextStreet`); a NEW
  move is gold for `MOVE_MS` (1.8s); a resume replays nothing (`moveSeen` starts at the log length).
- **One-motion raise** (rebuilt 2026-10-08): SET RAISE, the `.pk-ghost` box follows the finger up
  (straight-line amount; within 26px reads **NO RAISE**). **Letting go SETS the amount, it does not
  bet.** One `requestAnimationFrame` moves the box by transform; the action area repaints only when
  NO RAISE flips. Pointer captured on the game ROOT, so `_dragEnd` handles a no-move tap itself and
  swallows only the click of the SAME gesture (any new pointerdown clears it).
- Check / Fold pre-action acts 350ms after the turn arrives, via the normal move path.
- **Skip ahead after folding** (solo only): `Table.fastForward('hand'|'game')`. Never online.
- Card faces: frame exactly centred, nothing crosses it; ink pure black, `--pk-red` `#f2311f`
  (colourblind-measured). Money `$9200` then `$10.0k`. Solo waits for "Tap the table to start the
  next hand" (`tapToDeal`); online the host deals on a timer. "See everyone's cards" after a solo
  hand, never online. Online quick-chat button at the felt's lower-left. A save without `cfg.scale`
  keeps the 1,000-chip numbers.
- Checked with no scroll at 402x874, 390x664 (8 players), 393x780 (online).

## Verification status

`node holdem/js/test.js` passes. Online was proven in three browser profiles against a local RTDB
stand-in (only `js/firebase-boot.js` swapped); **real Firebase on real phones is not yet proven.**
Related suites: `players-agg.test.mjs`, `test-rate-guard.mjs`, `test-admin-config.mjs`,
`test-leaderboard-rank.mjs`, `test-stats-corrections.mjs`.
