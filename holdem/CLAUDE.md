# Texas Hold'em (`holdem/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`,
> which is always loaded alongside this file (full rule rationale: `js/CLAUDE.md`).

No-limit Texas Hold'em, built 2026-09-27 at Matt's ask: *"Look online for examples and clone a
multiplayer Texas hold em app. So that a bunch of people can join at once."* The reference apps
were the open-source socket.io/Node poker servers on GitHub (`ptwu/distributed-texasholdem`,
`vampserv/node-poker-stack` and similar): rooms joined by code, up to 8-10 seats, one server that
holds the deck and deals, clients that only send fold/check/call/raise. This game copies that
shape; the Game Hub has no server, so **the host's phone is the server.**

## Hub integration

- In-hub `module: '../holdem/js/ui.js'`, **immersive** (its own full-bleed table). Standalone page
  `holdem/index.html`, name-gated like every other.
- `released: '2026-09-27'`, live to everyone, not `devOnly`.
- Stats id `'holdem'` (same as the hub id), recorded with the generic `recordResult` - no
  sub-counter, so no `players-agg.js` branch and the generic My Stats screen draws it. `GAME_META`
  (leaderboard) and `TABS` (My Stats) rows were added in the release commit (the Yahtzee lesson).
- `isInProgress()`: **solo answers false** (autosaved after every change, resumes on return).
  **Online answers true** while a game is running and this player still has chips: leaving the
  screen leaves your seat waiting on you, and a HOST leaving the screen stalls the whole table.
  `destroy()` never gives up a seat; only the Leave button does (the seat is kept for "Back to
  table").

## Files

| File | Role |
|---|---|
| `js/engine.js` | Pure rules: deck, hand evaluator, blinds, betting, side pots, showdown, bust-outs, `publicView()`. No DOM, runs under node. |
| `js/ai.js` | Computer players. Monte Carlo equity against random hands + pot odds, three skills. Reads only its own cards, the board and the betting. |
| `js/table.js` | The dealer loop (`Table`): applies moves, runs bots, turn clock, away/sit-out auto-fold, next deal. No DOM, no network. |
| `js/net-table.js` | Firebase glue for the online table's own child `rooms/<CODE>/pk`. |
| `js/ui.js` | Setup, lobby, table rendering, and the host/guest sync. |
| `js/strings.js` | EN/ES. |
| `js/test.js` | `node holdem/js/test.js` - hand ranking, pots, betting order, and 60 bot-only tournaments with the chip total checked after EVERY action. Not deployed. |

## Rules as implemented

- Tournament (sit-and-go): everyone starts with 1,000; blinds 10/20 rising about 1.5x a level
  every 6/10/15 hands (Fast/Normal/Slow); a player with no chips is out; the last player holding
  chips wins. Two players bust in the same hand: the one who started it with more finishes higher.
- Heads-up: the button posts the small blind and acts first before the flop, last after it.
- A raise must be at least the size of the previous bet/raise. **An all-in for less than a full
  raise does not reopen the betting**: players who already acted may only call or fold
  (`canRaise[]`). `test.js` pins this.
- Side pots: `buildPots()` levels contributions by every non-folded player's all-in cap; a folded
  player's chips stay in whatever pots they reached. Uncalled chips come back as a one-player pot,
  flagged **`back: true`** (only one player put chips in it; since 2026-10-05). When one live
  player is left with chips over everyone else's, the levelling stops first at the most any folded
  player put in, so a real win and a refund never share a pot. Odd chips in a split go to the first
  winner left of the button.
- Everyone all-in: the board runs out (`h.runout` counts the streets, the dealer waits longer).
- A player who leaves folds at once and forfeits their stack; nobody is paid it.

## Online: host-authoritative, NOT lockstep

Every other MP game here is lockstep (every device runs the same engine on the same shuffled deck).
**Poker cannot be**: a lockstep deck is a deck every device holds, so every hand would be readable.
So the host runs `Table` on the full state and publishes; guests only render and send moves.

`js/net.js` is used **unchanged**: `createRoom(..., {seats: 8})`, `joinSeat` (transactional seat
claim), `heartbeat`, `vacateSeat`, `leaveRoom`, `onRoom`, `sendReaction`. It has no shape for
"host publishes a table", so this game writes one child of its own room and nothing else:

| path | writer | what |
|---|---|---|
| `pk/lobby` | host | JSON: the computer players and blind speed, before the deal |
| `pk/pub` | host | JSON: `engine.publicView()` + `gid` + `waiting` - no deck, no hole cards |
| `pk/hole/<seat>` | host | JSON `{g, h, c}`: that seat's two cards for game `g`, hand `h` |
| `pk/act/<seat>` | that seat | JSON `{g, h, k, a, to, n}`: one move, or `leave` / `back` |
| `pk/clock` | host | `{k, ms}`: time left on the current turn |
| `pk/bank/<seat>` | that seat | number: that guest's bankroll, so the host deals it into a money table only if it can pay (2026-10-08) |

- **Values are JSON strings** because the Realtime Database drops empty arrays and nulls and turns
  sparse arrays into objects, and the engine state is full of both.
- A move is applied only if its `g`/`h`/`k` match the host's current game, hand and action counter
  (`state.k` bumps on every applied action), so a late or repeated move can never apply twice.
  `n` is a random nonce so a repeated identical move is still seen as new.
- **Presence**: the host notes when each seat's heartbeat stamp last CHANGED, on the host's own
  clock (never compares two devices' clocks). 35s without a change = Away: that player is
  checked/folded for automatically until the heartbeat comes back. A human who lets the 45s turn
  clock run out sits out until they act or tap "I'm back".
- **Joining mid-game**: the seat is claimed and the player watches; they are dealt in when the host
  starts the next game ("New game" deals everyone in the room right now, plus the computers).
- **Rejoining**: `gamehub.holdem.mp.v1` keeps `{code, seat, host, rec, bots}` (+ the full `state`
  on the host) so "Back to table CODE" on the setup screen works after a reload or a trip to the
  launcher. A host's rejoin restores the dealer from its own save and ignores moves already in the
  room (it marks their nonces as seen).
- **The host leaving (Leave button) closes the table for everyone** (`net.leaveRoom`). There is no
  host migration: the deck lives on the host.

**Honest limit, say it plainly if asked:** `rooms/` rules are `auth != null`, so a player with
developer tools can read `pk/hole/*` - every seat's cards. The app never shows another player's
cards before the showdown, but a determined snoop is not stopped. Real secrecy needs a server
dealer (a Cloud Function holding the deck), which does not exist. The host's device also holds
the whole deck in memory and localStorage.

## The bankroll (2026-09-27)

Matt: *"You should have a pile of money you can grow too."* Defaults he approved: start with
**$25,000**, **1st takes 65% of the pot and 2nd 35%**, **online tables use it too**.

- **Stored as a LEDGER, never a balance** - `games.holdem.hb = { buyins, winnings, grants, best,
  cashes, entries }` in `gamehub.stats` (`js/game-stats.js`, `recordHoldemBank`). Every field
  only grows (best: `Math.max`), so THE LAW rule 2 holds even though the balance goes down. The
  balance is DERIVED: `holdemBalance(hb) = HOLDEM_START_BANK + winnings + grants - buyins`, the
  starting $25,000 added once at read time (storing it would count it once per device).
- **It follows the player to every device** because the ledgers ADD: players-agg sums them (its
  `hb` branch), `ui.js`'s `bank()` = this device's ledger + `bankRemote` (the other devices'
  part, read like My Stats does and kept as combined-minus-local so a later local write is never
  counted twice). Offline, it shows this device's own ledger.
- **Tables** (`TIERS` in `ui.js`, the reference app's tournament tiles): Buddy's House $500, Las
  Vegas Casino $1,000, Regional $5,000, World Championship $10,000, Solar System $100,000, Galaxy
  Championship $1,000,000, Universe Championship $10,000,000. A table is locked until the
  bankroll covers it. **Since 2026-10-08 the chips at the table ARE the buy-in** ($500 at Buddy's
  House, $10M at Universe), blinds in proportion: see "Stack = buy-in" below. Plus **Behind the
  Dumpster**, the bottle-cap table for broke players, always shown first (see its own section).
- **Each table decides its computers' skill** (2026-10-08, `TIERS[].skill`): Buddy's House and
  Las Vegas Easy, Regional and World Championship Medium, Solar System and up Hard. See "Bigger
  tables, tougher computers" below.
- **Money moves at exactly two moments**: the buy-in when the cards are dealt (solo `_newSolo`;
  online `_stake`, once per game per device, keyed `code:gid:stake`), and the prize when this
  player's place is decided - `payout()` in `engine.js`: everyone at the table (computers too)
  puts the buy-in in the pot, 1st 65% and 2nd the rest with 3+ players, winner takes all
  heads-up. It rides the same once-per-game dedupe as the win/loss result (`state.rec` solo,
  `code:gid` online), so a reload can never pay twice. Walking away pays nothing.
- **Online**: the host picks the table in the lobby (only ones they can afford, or "no buy-in").
  **No seat at a money table is free** (2026-10-08, see "No free seats" below): a guest whose
  bankroll does not cover the buy-in is not dealt in and watches.
- **Broke**: there is no handout any more (2026-10-08). The table picker says "Broke? Win $250
  behind the dumpster. Win twice to buy back in." See "Behind the Dumpster" below. (It offered
  exactly $500, `HOLDEM_REFILL`, earlier that day, and up to $25,000 before.)
- **Not behind the rate gate**, deliberately (`test-rate-guard.mjs` EXEMPT, with the reason): a
  refused buy-in would be a free game and a refused prize would be money lost. The game result
  itself is still gated. A failed write is queued and replayed (`persistOrQueue`).
- **Visible**: the setup screen and table picker, the end-of-game card ("+$X to your
  bankroll"), My Stats (Bankroll, Biggest prize, Won in prizes, Paid in buy-ins), and the
  leaderboard's Texas Hold'em records (Bankroll, Biggest prize).

## Bigger tables, tougher computers (2026-10-08)

Matt: *"the goal is to have the most money - the biggest bankroll... so why would anyone play on
any difficulty other than easy?"* Nobody would: `payout()` depends only on the buy-in and the
number of players, never on the computers' skill, so an Easy win paid exactly what a Hard win paid.
Of the three fixes offered he chose this one:

- **The table decides the computers' skill**, `skill` on each `TIERS` row: Easy at Buddy's House
  and Las Vegas, Medium at Regional and World Championship, **Hard at Solar System and up**. The
  big money is only ever behind Hard computers.
- **Solo**: the setup screen's Skill row is gone; each table tile says who you are playing (shape
  + "Hard computers", `tier_bots`). `_newSolo` deals `tier.skill`, and the result still records
  under that skill (`state.skill`), so My Stats keeps its Easy/Medium/Hard split.
- **Online**: on a table with a buy-in, the lobby's skill picker is replaced by the table's skill
  and every computer plays at it (`_netBots()`, used by the lobby list, the published lobby and
  `_startNet`). "No buy-in (just for fun)" keeps the host's own pick. The host's chosen bots are
  stored unchanged; only what is dealt follows the table.
- `settings.skill` in `gamehub.holdem.v1` is still written and kept (rule 5); nothing reads it for
  a table game any more.
- Nothing already earned changed: a game saved before this keeps the computers it was dealt.
- `holdem/js/test.js` fails if a bigger table ever gets easier computers, or a money table
  (Solar System and up) is anything but Hard.

## No free seats, and broke means $500 (2026-10-08)

Matt, on learning both of these existed: *"OBVIOUSLY NO SEAT SHOULD BE FREE"* and *"The free
refill is fucked... If someone is broke, they can get enough to sit for the cheapest game there is
and that's it."*

- **The hole that was closed:** a guest who could not cover the buy-in was dealt in "just for fun",
  but `payout()` sizes the pot from EVERY seat (`pub.players.length`), so that seat put money in the
  pot nobody paid. With a second browser window under a made-up name, sitting at your own table and
  leaving at once, the host won twice the buy-in having paid it once: about +$10M every 20 seconds
  at the Universe table. **Checked against the live data the same day: nobody had ever played an
  online Hold'em game for money**, so it was never used.
- **Now every seat at a money table pays.** A guest writes its bankroll to `pk/bank/<seat>`
  (`_publishBank`, only when it changes); the host deals in only seats that cover the buy-in
  (`_payingSeat`; the host's own seat is covered by `_netTier()`). A guest on an older build
  publishes nothing and so watches at money tables. The host's lobby marks a short guest
  "Can't cover", and Start needs two people who can pay (`need_two_paying`). `_stake` always
  charges a dealt-in seat; a `:free` key in an old MP save is still honoured so a game in progress
  is never charged twice. "No buy-in" tables still deal everyone, and pay nobody.
- **The refill was the cheapest buy-in, $500** (`HOLDEM_REFILL` in `js/game-stats.js`, which still
  refuses a bigger grant). The game stopped offering it later the same day, when Behind the Dumpster
  replaced it. Grants already in a ledger are untouched (THE LAW); `holdemSuspect`'s top-up check
  still allows $25,000 a game so no existing ledger is flagged.
- Playing yourself online in any game, Hold'em included, is now blocked at the room layer: root
  `CLAUDE.md`, "Online play needs an account Matt has let in".

## Behind the Dumpster (2026-10-08)

Matt, after a second reference recording (`/Claude Code Refs/ScreenRecording_10-08-2026
09-31-58_1.MP4`, whose broke-player table is "AI Grandma's", paid in cookies): *"call it something
more insulting. it's more like an illegal game between homeless people in an alley or behind a
dumpster. Use bottle caps instead of cookies. And no- the table should ALWAYS be visible."* Then:
*"make it 2 wins. Bottle caps, you can hold at most 3, and sure on 2 hours."*

- **`ALLEY` in `ui.js`**, deliberately NOT in `TIERS` (it has no `buyin`; `test.js` reads the money
  tables out of TIERS by that shape). The first tile on the picker, broke or not, solo only. Easy
  computers, $100 stacks at $1/$2 (`stackOf`).
- **The buy-in is a bottle cap.** `gamehub.holdem.caps.v1 = { at }`, ONE timestamp: caps held =
  whole 2-hour periods since `at`, max 3 (`capsState`); spending moves `at` forward one period,
  from "full" if more had built up (`spendCap`). A new device starts full. The cap is spent the
  moment the cards are dealt (`_newSolo`), like a real buy-in. The tile shows the caps as filled or
  empty discs (fill and outline, not colour alone) and the time to the next one, live (`_tick`).
  **A refilling allowance, not earned history**, so it is device-local and THE LAW rule 2 does not
  apply to it. **Honest limit: a phone clock wound forward refills early.**
- **The winner alone gets $250** (`HOLDEM_ALLEY_PRIZE`, half the cheapest seat, so two wins buy back
  in). Recorded as `recordHoldemBank({ grant: 250, alley: true })`: a GRANT, not a prize, because
  nobody bought in and there is no pot - so it is not a cash, not a Biggest prize, and the money
  board's prize checks are untouched. `alley: true` also counts **`hb.alley`** (a new additive
  counter, summed by `players-agg.js`, part of a void baseline in `js/stats-corrections.js`), and
  `holdemSuspect` allows `grants <= entries * $25,000 + alley * $250`, so a player who has only ever
  won behind the dumpster is not flagged. `recordHoldemBank` refuses an `alley` write of any other
  amount, and alley wins share the 20-a-minute prize rate cap.
- The result still records under Easy (`recordResult('holdem', 'easy', won)`).
- Its opponents are alley critters (Trash Panda, Sewer Rat, Pigeon Pete...): see "Who you play".

## Stack = buy-in (2026-10-08)

Matt: *"you have the buy in amount to gamble with. Blinds and stuff are increased
accordingly/proportionally."* `stackOf(table)` gives `{ chips: buyin, scale: buyin / 1000 }`, so
every table opens at 50 big blinds: Buddy's House $500 at $5/$10, World $10,000 at $100/$200 (the
old game), Universe $10M at $100k/$200k. Online money tables too (`_startNet`); a no-buy-in online
table keeps the plain $10,000 game. `engine.js` takes a fractional `scale` now and ROUNDS each blind
level (`blindsOf`), so a whole-number scale - every game saved before this - deals exactly what it
did. **Hand stats' Biggest pot won is in table chips**, so since this change a pot at a big table
is genuinely bigger than one at Buddy's House; old values are kept as they were (`Math.max`).

## Who you play (2026-10-08)

`THEMES` in `ui.js`, seven per table, dealt in a random order (`botRoster(n, skill, tableId)`):
alley critters behind the dumpster, dogs at Buddy's House, Vegas characters, ordinary people at
Regional, card sharks at the World Championship, astronauts at Solar System, aliens at Galaxy,
cosmic beings at Universe. Solo only; online the host's computers keep the old house list (and the
profile's own opponents). The profile's opponents are no longer used at solo tables.

## Bankroll leaderboard (2026-09-28)

Matt: *"We definitely need"* a bankroll leaderboard. The Texas Hold'em board (`js/leaderboard-ui.js`)
now RANKS BY BANKROLL: `gameMetricAt('holdem')` is `hbBankOf(g)`, the person's combined ledger
through `holdemBalance`, voids applied. Pills are **Bankroll** (leftmost, so the board opens on it),
**Wins** (`hwins`, holdem-only, like Skeeball's `high`), Games, Name. The board is UNTIERED
(`METRIC_IS_TIER_BLIND`, `boardTierOf` returns null, no difficulty filter): a bankroll has no
difficulty axis, and ranking it tier-first would have put a $30k Hard player above a $3M Easy one.
A ledger `holdemSuspect()` calls impossible prints **"Under review"** and sorts last. Standing
records: Bankroll, Biggest prize, Hands won, Biggest pot won, Best hand ever (ranked on the hand
score, printed as its name).

## Hand stats (2026-09-28)

Matt picked "more stats: hands won, biggest pot, best hand ever". `recordHoldemHand` in
`js/game-stats.js` writes `games.holdem.hs = { hands, won, bigPot, best, bestCat, bestCards }`:
one write per hand THIS player was dealt into (their two cards known), from `_handEnd()` in
`ui.js`, which solo, host and guest all go through. `amt` is the chips this player collected;
`best` is `engine.evaluate` of their best five when they saw all five board cards and had not
folded (`bestCat` 9 = royal flush, its own name). hands/won add, bigPot/best are `Math.max`,
players-agg merges it (the best hand travels with its cards). Dedupe: `gamehub.holdem.hands.v1`,
the last 40 `gid:handNo` keys, so a reload on a result screen cannot count a hand twice. Exempt
from the 30-a-minute gate (`test-rate-guard.mjs`, reason given): a hand is not a result. Shown on
My Stats (Hands played, Hands won, Biggest pot won, Best hand ever + its five cards) and the
leaderboard records. Not retroactive: hands before 2026-09-28 were never recorded anywhere.

## Last hand replay (2026-09-28)

A **Last hand** button sits left of the pot once a hand has finished. It opens a sheet with the
board, who won each pot and with what, everyone's shown cards (and this player's own two, even
folded; winners outlined in gold), then every action street by street ("Tex raises to $900").
The actions come from `h.log` in `engine.js` - blinds (`post`), every `act`, and a player leaving
(`left`) - which is public information, so it rides `publicView` to every seat and guests replay
exactly what the host dealt. Kept in memory only (`this.lastHand`); after a reload it returns
with the next finished hand. "You" gets its own verb forms (`lgy_*`, `last_you_*`).

## Computer speed (2026-09-28)

Setup (and the online lobby, when the host added computers): **Computer speed** Slow / Normal /
Fast, `settings.pace` in `gamehub.holdem.v1`. It sets how long a computer "thinks" before acting
(`PACES` in `table.js`: 1.5-2.8s / 0.8-1.7s / 0.25-0.6s; Normal is the original pace). Changing
it mid-game applies from the computers' next move (`Table.setPace`). Rules and decisions are the
same at every speed. Not the same thing as "Blinds go up", which is the tournament's pace.

## The last hand is shown before the results (2026-10-05)

Matt: *"I went all in. Then this appeared. I didn't see the last card, I didn't see the opponent
even call."* The engine ends the game (`finishGame`) in the same call that settles the hand, so
`_checkOver` used to put the "You finished" popup straight over the runout and the showdown. Now
`_checkOver` holds the popup for `RESULT_MS + 350 * runout` (the same pause the table gives any
other result) when this device watched the game while it was still live (`this.overHold`). A tap
on the felt skips the wait (and reopens the results if they were closed); the pot box says "Tap
the table to see the results" (`tap_results`) instead of "start the next hand". A game first seen
already over (an online rejoin) shows the results at once. Measured in Chromium: popup at ~5.9 s
after the final result, ~0.16 s after a tap.

## Your own win is as visible as an opponent's (2026-10-05)

Matt: *"The only way you can tell I won this hand is the tiny 'you win' in regular text."* An
opponent's win already had a WIN stamp, a glow and "+chips"; yours had one plain line. Now a hand
this player won (any pot) gets: their line of the message as a gold pill (`.pk-ml.is-mine`), a gold **YOU WIN**
stamp on their own hole cards (`.pk-mywin`, pops once per hand, `st_you_win`), and the chips won in
green above the stack line (`.pk-mygain`). Word first, colour second (red/green colorblind rule).

## Every pot is named, splits say SPLIT, refunds are not wins (2026-10-05)

Matt, on a hand where Tex won the main pot and he and Rosa tied the side pot: *"Why did Rosa win
anything here?"* ... *"NONE of that is clear when actually playing."* The screen named only the
main pot, his own half of the side pot showed nowhere, and Rosa wore WIN +$9,500, of which $2,050
was her own uncalled bet coming back. Now:

- **One message line per pot actually won** (`_message()` returns `[{ text, mine }]`): the main pot
  with the hand name, then `Side pot: You and Rosa split 14,900 chips` / `Side pot: Rosa wins
  10,600 chips` (no hand name on side lines, for room). A line this player won is the gold pill.
  Two or more lines drop to 13px (`.pk-msg.is-multi`). **At most three lines**: past that, the
  third reads "N more side pots: see Last hand" and a pot this player won is never the one cut.
  Measured at 375x667: three lines with two pills end 1px above the board.
- **SPLIT, not WIN**, on a seat (and on your own cards, instead of YOU WIN) that only shared pots.
- **A `back` pot is not a win anywhere**: no stamp, no "+chips", no message line, not counted as a
  hand won or a biggest pot in `recordHoldemHand`, no gold outline in Last hand. The Last hand sheet
  lists it as "Rosa gets 2,050 back (nobody called it)".

## The Bankrolls page (2026-10-06)

Matt: *"Add a leaderboard or chip count or some page like that to Texas hold em so you can see
current bank roll and lifetime earnings."* The bankroll chip on the setup screen ("See all ›") and
the bankroll bar on the table picker open `screen = 'bank'` (`_renderBank` in `ui.js`):

- **Your numbers on top**, from this device's ledger plus the other devices' part
  (`_myBankFull`; `bankRemote` now also carries `cashes`, `entries`, `best`): Bankroll, **Lifetime
  winnings** (= `hb.winnings`, every prize ever won, gross), Profit (`winnings - buyins`, can be
  negative), Biggest prize, Prizes ("3 of 12 games"). Shown offline too.
- **Everyone below**, one row per person, from the same read and filters the hub leaderboard uses
  (`readPlayersOnce` -> hidden device prefixes -> `aggregatePlayers(all, corrections())` ->
  `isHiddenName`), only people who ever played for money (`entries || grants`), plus always you.
  Sort switch: **Bankroll** or **Lifetime winnings**. A `holdemSuspect()` ledger reads "Under
  review" and sorts last, like the board. Your row is gold-outlined AND says "You".
- **Never scrolls**: `_fitBank` drops rows from the bottom until the list fits, never your own row;
  `_layout` re-renders it on resize.
- `readPlayersOnce` answers `{}` when Firebase is unreachable, so an empty read is treated as
  offline: the list says so with a **Try again** button (your own numbers still show).
- Read-only: writes nothing.
- **Tap a player to see their numbers in the top card** (2026-10-06, Matt: *"When I click on
  another player, show me their stats there"*). `this.bankPick` = that row's person key; the card
  gets a name line (emoji + name, or "You") and a **Show mine** button; tapping the same row or
  your own row also goes back. The shown row has a white outline and a ▸ by its rank, and
  `_fitBank` never drops it. A "Under review" ledger shows only that label, no numbers. Rows are
  `role="button"` divs-in-list (Enter/Space work), not `<button>`s, per the UX floor.

## Cheat deterrents (2026-09-28)

Matt asked for "cheat proof" and, offered a Firebase-function dealer (truly cheat-proof, but needs
internet and a deploy), chose **deterrents only**. So, plainly: **none of this stops a determined
player** - every number is written by code on their own phone, and hole cards online are still
readable from `rooms/` with developer tools. What exists:

1. **Impossible amounts are refused at write time** (`recordHoldemBank`): a buy-in that is not a
   table price (`HOLDEM_BUYINS`), a prize no finish at any table pays (`holdemValidPrize`), a
   top-up over $500 (`HOLDEM_REFILL`; it was $25,000 until 2026-10-08), a dumpster win that is not
   exactly $250 (`HOLDEM_ALLEY_PRIZE`). Refusals are counted in `gamehub.rate.v1`'s `blocked['holdem-bank']`,
   which rides the stats mirror (`rate`), so an attempt is visible to Matt.
2. **Prizes are rate-capped**: more than 20 in a minute are refused (a heads-up game takes a person
   10s or more). Calibrated on the fastest human, like the result gate.
3. **`holdemSuspect(hb)`** (pure, `js/game-stats.js`) names why a ledger could not come from real
   play (more prizes than games, winnings bigger than prizes x best, an unpayable best prize, too
   many top-ups...). Every check survives adding two real ledgers, so it runs on a PERSON's
   combined ledger. `holdem/js/test.js` plays 200 random 60-game careers and asserts none is ever
   flagged, and that the buy-in and prize lists match `TIERS` and `payout()` exactly.
4. **Voiding**: the admin page's **Poker bankrolls** section lists everyone who has played for
   money, flagged ones first, with **Void bankroll** / **Undo void**. A void is an OVERLAY
   (`adminConfig/v1/corrections/holdem/<statsId>`, `js/stats-corrections.js`
   `correctHoldemLedger`): a BASELINE of the ledger at that moment, so the bankroll reads $25,000
   again and later games count normally; the raw ledger on the phone and in `players/` is never
   touched (THE LAW). It reaches every device of that person, and the game's own `bank()` applies
   it too, so voided money cannot be spent.

Bankroll maths no longer uses `| 0` anywhere on the money path: the top table pays $52M a win,
so a bankroll can pass 2^31, where `| 0` wraps negative.

## Step away and resume (2026-09-28)

Matt: *"make it so I can join a tournament, leave, then resume the same tourney. Otherwise I'm going
to lose a bunch of tournaments now while testing."* The table's red X no longer only forfeits. It
asks, with keeping the game as the first (gold) choice:

- **Solo: Save and leave.** The save (`gamehub.holdem.save.v1`, written after every change) is kept
  and the setup screen's big button becomes **Resume tournament** ("Buddy's House · Hand 3 · Stack:
  $9800"), which restarts the SAME game at the same hand with the same cards. **Give up this
  tournament** under it (confirmed) records one loss, no prize, and clears the save
  (`_forfeitSave`, guarded by the save's own `rec` flag so it can never count twice). Opening the
  game still resumes a saved tournament straight onto the table, as before.
- **Online: Step away.** Keeps the seat and the MP save, the same as closing the app: the host
  folds/checks for an away seat, and **Back to table** rejoins. A host stepping away pauses the
  table for everyone (the host's phone deals), and the dialog says so.
- **Give up (counts as a loss)** / **Close the table for everyone** are the second choice and do
  exactly what the old X did (`_leave`).

Nothing is recorded by stepping away. Checked in a browser: solo leave -> resume (same hand, same
cards, stats untouched) -> give up (one loss, save gone); online guest and host each stepped away
and rejoined against the local RTDB stand-in.

## Stats

One result per game per device, recorded **the moment the engine decides it** (busting out = loss,
holding every chip = win), never behind a modal - Escoba's lesson. Walking away from a game in
progress (Leave, or a host closing the table) records a loss for the one who left. Solo records
under the computers' skill (`easy`/`medium`/`hard`), online under `'mp'`. Dedupe: solo keeps
`state.rec` in the save; online keeps `code:gid` keys in the MP save.

## Keys

- `gamehub.holdem.v1` - settings (tab, opponents, skill (unread since 2026-10-08: the table
  decides), blind speed, computer speed `pace`, lobby computer count/skill/table)
- `gamehub.holdem.hands.v1` - the last 40 hands already counted in the hand stats (dedupe)
- `gamehub.holdem.save.v1` - the solo game in progress (full engine state)
- `gamehub.holdem.mp.v1` - the online seat for "Back to table" (+ host's state)
- `gamehub.holdem.caps.v1` - `{ at }`, the bottle caps for Behind the Dumpster (2026-10-08;
  device-local, a refilling allowance, not history)

## Layout: a clone of Matt's reference recording (2026-09-27)

Matt: *"make it look more like a clone of the screen recording I just uploaded to Dropbox"*
(`/Claude Code Refs/ScreenRecording_09-26-2026 23-26-39_1.mp4`, a portrait mobile poker app).
Copied from it, top to bottom:

- A league-style **banner**: red panel with the blinds, then Hand, Your Rank (by chips among the
  players still in), and hands until the blinds go up. It starts 96px in to clear the hub's back
  button. The small `i` opens the hand-rankings help.
- **Opponents on one curved row** across a navy band (`_layout`: edges sit lower, names and stacks
  tilt with the arc; 16px kept clear at each end for the red close button). Name above, round
  avatar, big stack below. The last action is a **stamp printed over the avatar** (POST, FOLD,
  CHECK, CALL, BET, RAISE, ALL IN, WIN). A small two-card icon shows who is still in the hand; at a
  showdown it becomes their two real cards. Folded players grey out.
- A **flat blue felt** with a faint weave: bets as chip + `$100` under each opponent's column, the
  `D` button beside the dealer's column (or beside my own bet), five **sunken card slots**, and a
  **sunken pot box**. The result line reads like the reference: "Jackson wins 2,700 chips with Two
  Pair, Aces and Fives" / "You take the 2,500 chip pot" (`handName`, full rank names in EN/ES).
- **My corner**: FOLD / SET RAISE tabs over two big overlapping cards on the left, one **big black
  glossy button** on the right (CHECK with a green tick, CALL $200, BET / RAISE TO / ALL IN with
  chips), and "Stack: $10.8k" under it. SET RAISE opens a bar over the bottom of the felt (pot,
  Min / 1/2 Pot / Pot / All in, slider); the big button then commits the amount.
- **One-motion raise (2026-09-27, Matt: "click 'Raise' and drag it up to whatever $ amount you
  want in 1 motion"), REBUILT 2026-10-08** as a copy of the reference's (Matt: *"Our raise drag is
  objectively worse than the example's. That one is smooth and nice, while ours is choppy and
  clunky"*). Press **SET RAISE** and a dark box (`.pk-ghost`) picks up off the tab and follows the
  finger up the table with the amount on top of it; the tab hides while it is out. The amount is a
  **straight line** from the minimum raise just above the start to the whole stack just under the
  info banner (top 3% = ALL IN); within 26px of the start it reads **NO RAISE**, and the big button
  goes back to CHECK / CALL. Letting go SETS the amount - **it does not bet** (2026-09-28, Matt:
  "it auto places the bet when I let go ... so I can confirm it") - and the big button reads
  RAISE TO / BET / ALL IN $X until tapped; letting go on NO RAISE drops it. No panel opens after a
  drag (the reference opens none); `this.raise.panel` marks the tap-opened Min / 1/2 Pot / Pot /
  All in panel, whose tab reads Cancel. **Why the old one was choppy:** every pointermove re-ran
  `_paintActions` (rebuilding the tabs and the big button), and the amount was SQUARED, so it
  crawled then jumped. Now a move only stores the finger; one `requestAnimationFrame` moves the box
  by transform and rewrites two text nodes, and the action area repaints only when NO RAISE flips.
  The pointer is captured on the game ROOT (a repaint can replace the tab mid-drag), which
  re-targets the click - so `_dragEnd` handles a no-move tap itself and swallows the click that
  follows; otherwise a mouse tap did nothing while a touch tap worked.
  **2026-10-02, Matt: "if I raise, it makes me click the raise button twice".** That swallow was
  a 500ms window, so it also ate a quick tap on RAISE TO right after the RAISE tab (and, since a
  slide fires no click, any tap within 500ms of letting go). Now any new pointerdown clears it:
  only the click of the SAME gesture is swallowed. Verified by mouse and touch, tap and slide.
- **Check / Fold pre-action.** While it is someone else's turn and you are in the hand, the big
  button is a CHECK / FOLD tick-box. Ticked, it checks whenever nothing is owed and folds the
  moment there is a bet, for the rest of that hand (it resets on the next deal; tap again to
  untick). It acts 350ms after the turn arrives, through the normal move path, so online it is
  just an ordinary move.
- **Skip ahead after folding (2026-09-27, Matt: "after i fold ... let me press anywhere on the
  table and have it fast forward").** Solo only. Folded in a hand: the pot box says "Tap the table
  to skip ahead" and a tap races the computers through the rest of THAT hand (`Table.fastForward
  ('hand')`, 40ms per move instead of ~1s) and stops on the result. Busted out: the tap races
  through EVERY remaining hand to the end of the game (`'game'`, each result shown 350ms). Same
  bots, same decisions, no thinking pause. Never online: other people's turns are theirs.
- **Card faces (2026-09-27, Matt: "the numbers intersect with the rectangle ... the rectangle
  doesn't look centered").** The corner index is a 3%..22% column (rank 0.21cw, suit 0.18cw) and
  the frame starts at 26% on BOTH sides - the upside-down index mirrors it bottom-right, so the
  frame is exactly centred and nothing crosses it. "10" is condensed (`is-ten`) to fit the same
  column instead of widening it.
  **2026-09-28, Matt: "make the numbers on the cards a little larger".** The index is now bold,
  rank 0.3cw / suit 0.23cw in a 2%..27% column, and the frame starts at 30% on both sides (centre
  pip 0.4cw) - same no-overlap, dead-centre rule, just a wider corner. The small showdown/help
  cards' index went 12px -> 14px.
  **2026-10-02, Matt: "The suit symbol is small. And the red and black cards look the same".**
  Suits ~40% bigger (corner 0.32cw, centre pip 0.6cw so it fills the frame's width, court-card
  suit 0.32cw, small cards' suit 15px), ink pure black, and `--pk-red` brightened from `#c4281c`
  to `#f2311f`. Measured with a protanopia simulation (Matt is red/green colourblind): the old red
  sat 2.4:1 from black, the new ~3.4:1, while still 3.9:1 on the white card.
- **Every opponent's move is shown (2026-10-02, Matt: "add 'check' somewhere when the computer
  checks ... it's not obvious that they did anything. Same with call and fold and anything").** The
  seat stamp is now a pill (dark, white border). A NEW move turns it gold and pops in once, for
  `MOVE_MS` (1.8s), then it settles to the dark pill until the round ends. Read from the hand's
  public `h.log`, NOT `h.last`: the move that closes a betting round is wiped by `nextStreet` in
  the same engine call, so a closing check or call was never on screen. A resume replays nothing
  (`moveSeen` starts at the log's current length). Works online too (the log is in `pub`).
- FOLD / SET RAISE tabs are 46px tall at 17px, the big button's label 22px, chips 28px (34px on
  the big button) - all "a little larger", per Matt.
- **Money is printed the reference's way**: `$9200` under ten thousand, then `$10.0k`.
- **Solo waits for "Tap the table to start the next hand"** (`Table`'s `tapToDeal`); online the
  host still deals on a timer so nobody waits on one player's tap. After a solo hand the big
  button offers **"See everyone's cards"** (the reference's "replay the last hand and see all the
  opponents' cards"): it reveals every computer's hole cards from the dealer's own state. It is
  never offered online, where it would show other people's cards.
- **Stacks were $10,000 with $100/$200 blinds** (`cfg.scale = 10`), as in the first reference. A
  game saved before this has no `cfg.scale` and keeps its 1,000-chip, 10/20 numbers. Since
  2026-10-08 the stack is the table's buy-in (see "Stack = buy-in").
- Online, the quick-chat button is moved to the felt's lower-left corner (it defaults to the
  bottom-right, which is the big action button).

Checked with no scroll at 402x874, 390x664 (8 players) and 393x780 (online).

## Verification record (2026-09-27)

- `node holdem/js/test.js`: all pass (hand ranks, pots, betting order, 60 tournaments).
- A real browser against the dev server: solo games played to showdown and to a bust-out.
- **Online was tested in three separate browser profiles against a local stand-in for the Realtime
  Database** (the cloud sandbox's proxy blocks WebSockets, so real Firebase was unreachable). It
  ran the real `js/net.js`, `net-table.js` and `ui.js`; only `js/firebase-boot.js` was swapped for a
  shim with RTDB's quirks (nulls delete, integer keys read back as arrays). Proven there: create /
  join / add a computer / start, four hands with all three devices agreeing on every stack, a guest
  leaving, the host closing, guest and host reload + "Back to table", a game played to the end
  with exactly one result recorded per device, "New game", and a dead phone marked Away after
  ~39s with the table moving on. **Not yet proven: real Firebase, on real phones.**

**2026-09-28 additions** (bankroll board, hand stats, Last hand, computer speed, deterrents):
`node holdem/js/test.js` (log, deterrent lists, 200 random careers never flagged),
`players-agg.test.mjs` (hand-stat merge, voids), `test-rate-guard`, `test-admin-config`,
`test-leaderboard-rank`, `test-stats-corrections` all pass. Browser: solo at 402x874 and 390x664
in EN and ES (Last hand sheet scrolls inside itself on the short screen, no page scroll), the
leaderboard and the admin void against the local RTDB stand-in (void -> $25,000, "Under review"
gone, raw ledger untouched), and the three-browser online game again (every device counts its own
hands; host and guest replays agree).
