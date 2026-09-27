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
  player's chips stay in whatever pots they reached. Uncalled chips come back as a one-player pot.
  Odd chips in a split go to the first winner left of the button.
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

## Stats

One result per game per device, recorded **the moment the engine decides it** (busting out = loss,
holding every chip = win), never behind a modal - Escoba's lesson. Walking away from a game in
progress (Leave, or a host closing the table) records a loss for the one who left. Solo records
under the computers' skill (`easy`/`medium`/`hard`), online under `'mp'`. Dedupe: solo keeps
`state.rec` in the save; online keeps `code:gid` keys in the MP save.

## Keys

- `gamehub.holdem.v1` - settings (tab, opponents, skill, blind speed, lobby computer count/skill)
- `gamehub.holdem.save.v1` - the solo game in progress (full engine state)
- `gamehub.holdem.mp.v1` - the online seat for "Back to table" (+ host's state)

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
  want in 1 motion").** Press RAISE and slide up: a meter rises from the button with the amount on
  a bubble, the big button reads RAISE TO $X live, and letting go bets it. The curve is squared
  (fine control low, races to the whole stack high) and the top 4% is ALL IN; sliding back to the
  start cancels. A plain tap still opens the Min / 1/2 Pot / Pot / All in slider panel. The
  pointer is captured on the game ROOT (a repaint can replace the button mid-drag), which
  re-targets the click - so `_dragEnd` handles a no-move tap itself and swallows the click that
  follows; otherwise a mouse tap did nothing while a touch tap worked.
- **Check / Fold pre-action.** While it is someone else's turn and you are in the hand, the big
  button is a CHECK / FOLD tick-box. Ticked, it checks whenever nothing is owed and folds the
  moment there is a bet, for the rest of that hand (it resets on the next deal; tap again to
  untick). It acts 350ms after the turn arrives, through the normal move path, so online it is
  just an ordinary move.
- **Money is printed the reference's way**: `$9200` under ten thousand, then `$10.0k`.
- **Solo waits for "Tap the table to start the next hand"** (`Table`'s `tapToDeal`); online the
  host still deals on a timer so nobody waits on one player's tap. After a solo hand the big
  button offers **"See everyone's cards"** (the reference's "replay the last hand and see all the
  opponents' cards"): it reveals every computer's hole cards from the dealer's own state. It is
  never offered online, where it would show other people's cards.
- **Stacks are $10,000 with $100/$200 blinds** (`cfg.scale = 10`), as in the reference. A game
  saved before this has no `cfg.scale` and keeps its 1,000-chip, 10/20 numbers.
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
