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

## Layout

Seats sit on fixed slots (fractions of the measured table area, `SLOT`/`SLOTS_FOR` in `ui.js`),
with this device always at the bottom and the rest clockwise. The side columns keep clear of the
board. Each seat's action tag and bet share one line under the name plate. The raise panel
overlays my cards instead of growing the action bar (a growing bar resized the table and moved
every seat). Online, the action bar keeps 70px clear on the right for the quick-chat button.
Checked with no scroll at 393x852, 390x664 and 1280x720.

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
