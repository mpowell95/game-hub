# Battleship (`battleship/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`,
> which is always loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys,
> saves, and stats written by this game are governed by it: writes additive, keys never
> repurposed, no silent write failures.

**Keep this file short.** A new rule goes here in one or two lines; the story behind it goes in `CLAUDE-HISTORY.md` (append a dated section). Full original text: `CLAUDE-HISTORY.md`.

Hub integration: in-hub `module:` (`battleship/js/ui.js`), `immersive: true`. `isInProgress()` is
**mode-split**: **solo** returns `false` (autosave/resume built in, leaving mid-battle is lossless);
**MP** returns `true` while a room is joined (lobby and placement included).

The repo's **first hidden-information game**: in a LIVE room each side's fleet must never be known
to the other; that shapes almost everything below. (Challenges store both fleets in the match on
Matt's call: "Challenges, turn by turn".) Accent `#34506E` is unverified on a real launcher grid; if it
does not read distinctly from Dominoes, go darker and greyer, not brighter.

## Layout & responsibilities

```
battleship/js/game.js    pure engine: fleets (secret), shot grids (public), resolution, turn/end
battleship/js/fleet.js   pure placement: catalogs, legality, auto-place
battleship/js/ai.js      three AI tiers, no DOM, structurally unable to read a fleet
battleship/js/hash.js    FNV-1a over PUBLIC state only
battleship/js/ui.js      DOM shell: setup, placement, battle, animations, MP glue
battleship/js/ship-art.js one inline SVG per ship class
battleship/js/strings.js every user-visible string, { en, es }
battleship/js/test.js    headless assertions (node battleship/js/test.js)
battleship/css/battleship.css   all styles, .bs- prefixed, scoped under .bs-root
battleship/index.html    standalone host (name-gated)
```

## Rules

Classic rules. Ships **may touch** (the Pro AI's density search depends on it). Boards: **Quick**
(8x8, 12 cells: Battleship 4/Cruiser 3/Submarine 3/Destroyer 2) and **Classic** (10x10, 17 cells,
adds a Carrier 5), independent of AI difficulty. **No draw**: first fleet fully sunk loses.
`bonusShotOnHit` (default **off**) keeps the shooter's turn on a hit; off by default because it
multiplies async-delivery risk in MP.

## The engine's two kinds of state, and why they're kept apart

- A **fleet** is SECRET (only the owning device holds the real one). A **shots grid** is PUBLIC;
  both devices always agree on both.
- `state.fleets[seat]` is `null` for a seat this device does not own (both known in solo).
  `resolveShot(fleet, r, c)` is **the only function that reads a fleet**; in MP it runs only on the
  owning device. `applyAnswer(state, seat, r, c, answer)` (`seat` = DEFENDER) is the single place
  the match end is decided, from the answer. Cells: `CELL_UNKNOWN` -> `CELL_MISS`/`CELL_HIT` ->
  `CELL_SUNK` (lets the AI and UI tell "chase" from "resolved" using only public info).
- **`answer.cells`** (the sunk ship's own cells, present only when `sunk`) rides alongside
  `{result, shipId, sunk, fleetSunk}`. It leaks nothing (every cell was already a known hit to the
  shooter). Do not strip it out.

## The AI (`ai.js`) — no-cheat by construction

`chooseShot(state, targetSeat, shipSet, difficulty, rng)` never reads `state.fleets`; `test.js`
calls it with `fleets: [null, null]` on all tiers. Ships afloat come from `shots[targetSeat].sunkIds`.

- **Easy (`beginner`)**: random untried cell, ~50% follow-up on an active hit.
- **Medium (`intermediate`)**: hunt/target, extends colinear hits.
- **Pro (`pro`)**: probability-density over every legal placement of ships afloat; target mode
  restricted to placements covering an active hit, weighted by live hits covered squared; parity
  pruning only in pure hunt. Sub-ms: no worker, no budget. Do not add machinery.

Stored values stay `beginner`/`intermediate`/`pro`; Easy/Medium/Hard are display labels only.

## Solo autosave/resume

`gamehub.battleship.save.v1` holds one mid-BATTLE position (`saveGame`/`loadGame`/`clearGame`),
checkpointed from the post-shot funnel `_afterStateChange`, cleared on game end, Restart/rematch,
and "New game" mid-battle. **Placement is not autosaved** (nothing earned at risk).

## The deploy screen moves NOTHING while you drag (2026-08-11 — settled)

- `.bs-tray` has a **fixed height**, one row of bare silhouettes; `.bs-deploy-btns` fixed height and
  `flex-wrap: nowrap` (SAVE appearing must not reflow; a wrapping tray once pulled the board 71px
  up under the finger).
- **Rotate = tap the ship** everywhere (tap tray chip to select, again to rotate; tap a placed ship;
  `R`). No rotate buttons (they sat dead centre and blocked the drag).
- `tools/test-visual.mjs`'s battleship PLAY probe drags all five ships with real touches and fails if the
  board's box changes. A screenshot cannot catch this.
- Board sizes use `svh` under `@supports (height: 1svh)` (plain `vh` shifts with the iOS toolbar).

## The words are gone (2026-08-11)

Matt: *"There's way too much text."* No word instructions during the game. **Nothing loses its
accessible name**: every symbol has an `aria-label`; `_statusText()` feeds a hidden `aria-live`
region (`.bs-sr`). **MP status messages stay words** (failures), as do the MISS / HIT! / SUNK! banners.

## The battle screen, made legible (2026-08-11, second pass)

Lesson: **play it and look at it**; `tools/test-visual.mjs` was green throughout.

- **AIM, THEN FIRE**: first tap parks a gold crosshair (`this._aimCell`) and raises a red **FIRE**
  button; same square or FIRE shoots; `_confirmFire()` clears the aim first. **Pulse is a GLOW,
  never a scale.**
- `_maybeShowSunkBanner` raises MISS / HIT! / SUNK! on every shot, held back by the flight time.
  Banner BACKGROUND = whose good news (`mine`); sunk ship drawn in its OWNER's colour (`shipTheirs`).
  Two separate fields.
- Full-width turn bar in the shooter's colour; the board shot at wears a 3px ring; idle wash `.26`.
- Miss cross white on the enemy's navy (`--bs-miss` per board); hit = dark disc in white ring
  (Matt is red/green colorblind: shape carries it).
- Cells under a ship are filled (`.bs-board-own .bs-cell-ship`); drag follows the finger (`d.grab`,
  `_anchorFor()`, clamped to the board).
- Cannon heading `base = side === 'mine' ? 0 : 180`, clamp the DEVIATION; 25% of board width.
- **`.bs-sunk-banner` must NOT be in the reduced-motion blanket `transform: none !important` list**
  (its transform centres it). Check that list against anything added to it.

## The four screens (visual rebuild, 2026-08-05)

**The vertical sandwich**: enemy waters (navy) on top, fleet roster strip in the middle, your wooden
board on the salmon deck below. Both boards always visible, never resize, no swap/mode switch.

1. **Mode screen** (`renderSetup`): PLAY VS. BOT / PLAY VS. FRIEND (opens the EXISTING lobby
   `_friendHTML()`, no second MP path); option chips write the same `gamehub.battleship.v1` fields.
2. **Deploy screen** (`renderPlacement`): green **SAVE** pill **absent, not disabled** until all
   ships are placed. Legality is SHAPE first (solid + check vs **dashed** + cross). Use
   `_cellAtPoint(clientX, clientY)` against the board's rect, NOT `document.elementFromPoint`
   (unreliable under pointer capture).
3. **Opponent-getting-ready** (`renderWaiting` / `renderBotPlacing`, view `'botplace'`): MP shows the
   ROOM CODE and a **Leave** button and says "Opponent" until the room reports a real person
   (`_identity()` must never fall back to `profile.opponents[0]` in MP); `_mpOnRoomUpdate` repaints
   when `mp.opp` is learned. Vs bot: their fleet as loose silhouettes **on a deck, never on a
   board**, tap to skip (`.bs-tray-loose` needs `flex: none`). MP reuses `mp.localReady` /
   `_maybeStartBattle`.
4. **Battle screen** (`renderBattle`): full-bleed, both boards the same size. The enemy board shows a
   ship only once sunk. **The bright half is the half being SHOT AT**, not whose turn it is.

### The cannon and the shot

Cannon seen from directly above, each side's on its OWN board. Nesting is load-bearing
(`_cannonHtml`): `.bs-cannon` (translate only) > `.bs-cannon-aim` (rotation) > `.bs-cannon-rig`
(recoil). `_aimCannons` measures DOM geometry. **Exactly one cannon on screen**
(`_resolveCannons()`, recoil gated by `_cannonPlayed`). **The bot fires on TWO timers** in
`_afterStateChange`. Look at the reference before redrawing it (drawn wrong three times).

`_playShotFx` throws the ball (Web Animations) into `.bs-fx`; decorative only. **`FLY_MS` (850ms) is
the one knob**, pushed to CSS as `--bs-fly`; **reduced motion needs `--bs-fly: 0ms` set INLINE**.
Impact held back by `--bs-fly` on `.bs-peg.is-late`; `.bs-peg:not(.is-late)` kills the entrance
animation. **The ball's rim is a `box-shadow` spread in px set from JS** (a percentage silently
drops the declaration).

### The battle screen is full-bleed

`_bleedToEdges()` pulls the game to all four edges by **measurement** (negative margins, capped at
560px sideways). **Take both measurements off something the correction does not move** (host content
box for sides, the shell for top/bottom), or it undoes itself every second render.

### THE CLASS-NAMESPACE RULE (do not relax this)

**A decorative/animated class must never share a name with a structural/layout one.** `.bs-shell`
was both the layout container and a flying shell ending at `opacity: 0`: the whole game rendered
invisible twice. Ornaments live in their own namespace (`.bs-cannon`, `.bs-cannon-pill`,
`.bs-bubble`, `.bs-splash-ring`, `.bs-flash`, `.bs-smoke`). `node tools/test-game-conventions.mjs` fails
the build on this shape.

- **Every animation needs a `prefers-reduced-motion: reduce` branch that is an instant state
  change, and must NEVER `display: none` anything structural.**
- **A passing suite is not a rendered screen.** Done = screenshots of all six screens at 390x844 in
  normal, `reducedMotion: 'reduce'` and dark, plus a painted-element count over `.bs-root *`.

### Sizing and fit

`_updateCellSize()` sets `--bs-cell`/`--bs-pad`/`--bs-gap` **on each `.bs-board`**, measured from two
real rendered cells, never computed from width/grid size (`--bs-cell` is the cell-to-cell STEP).
`_fitBattleBoards()` measures every non-board child of `.bs-battle`, splits the remaining height
equally between the boards (cap 460px). Traps: **skip out-of-flow children** (`.bs-fx`, sunk
banner); **host chrome below the game is invisible from inside** (hub's 40px bottom padding), so
measure resulting overflow (`scrollHeight - viewport`) and take it off once; use
`document.documentElement.clientWidth`, not `window.innerWidth`.

## Visual design (pre-redesign history, kept for the reasoning)

- Boards **never resize**; turn shown by `.bs-board.is-active-turn` (`box-shadow` + `opacity`).
  Re-fit via `onViewportResize`, unsubscribed in `destroy()`.
- **Ships are boat sprites** (`ship-art.js`), two-tone `--bs-ship`/`--bs-ship-deck`; the submarine
  has no turrets, the one cue never to blur. Vertical placement rotates only the wrapper `<div>`.
- `_recordSunkShipGeometry` rebuilds a sunk enemy ship from public `answer.cells`; it is a
  **shared, non-`_mp*` helper** (MP reaches it without touching any `_mp*` method, `game.js`, `hash.js`).
- EXIT is a horizontal `‹ Exit` pill top-RIGHT (hub's back button is top-left).
- Effects are `transform`/`opacity`/`filter`/`box-shadow` only. Dark mode is `:root.gh-dark
  .bs-root`. Win/lose popup has the top-right X.
- `_shotSettleMs(shot)` / `_settleThenIdle()` hold `busy` while a shot renders (local only).
  `_sinkPlayed` and `_justRotatedShip` gate once-only animations; **gate any CSS `animation:` meant
  to play once** (the battle re-renders many times per shot).

## Multiplayer — the repo's first hidden-information protocol

Two devices over `js/net.js` (`rooms/<CODE>`), 2-seat surface like Tic Tac Toe / Dots and Boxes,
**`js/net.js` itself untouched**. Seats symmetric: host = seat 0, guest = seat 1, fixed for the room;
`round.dealer` (who shoots first) varies per game. (Full story: CLAUDE-HISTORY.md.)

### A shot is TWO log entries, not one

Shooter appends `{k:'s', g, seat, r, c}` and does **not** apply it to its own public state. The
**defender** resolves it against its own local fleet (never transmitted) and appends
`{k:'a', g, seat, r, c, result, shipId, sunk, fleetSunk, cells}`. **Both** devices apply the `'a'`
entry and hash after it (defender immediately, shooter on delivery). Uniquely here **the mover does
not apply its own move immediately**: pending reticle + radar sweep. A `{k:'r', g, seat}` ready entry
per seat: placement is **simultaneous** (`_mpApplyPlacementRound` puts both into `placement` when the
host's round record lands); the first shot waits for both `readySeats`.
**Never transmit either fleet at match start**, even as a "simplification".

### Field mapping onto `net.js`

`round.n` = game number in the series; `round.dealer` = first shooter; `round.deck` **unused**;
`appendMove` carries `'r'`/`'s'`/`'a'` by `move.k`; `writeResult` **deliberately unused**
(`status:'ended'` means "somebody abandoned the room").

### Entry validation

`'s'` valid only from the seat whose turn it is; `'a'` only from the defender of the preceding shot
(`move.seat === 1 - mp.lastShotSeat`) and for the same `{r,c}`; `'r'` always accepted (idempotent).
A failed `'s'`/`'a'` check is `console.error`'d and routed through `_mpOnDivergence`.

### The hash excludes both fleets

`hash.js` hashes only the two shot grids, shot counts, turn, `over`/`winner`, never `state.fleets`
(each device holds one real fleet and one `null`, so a fleet-inclusive hash diverges immediately).
**`mp.myFleet` lives outside the hashed state**: `state.fleets` is never populated in MP;
`_mpDefenderResolveAndAnswer` reads/updates `mp.myFleet`.

### Recovery deviates from invariant 2, on purpose

`_mpSnapshot()` is public-state-only. A recovering device rebuilds its secret fleet from **its own
local MP save** (`gamehub.battleship.mp.v1` `myFleet`), never the network. If that save is lost and
the game is past placement, `_mpCannotResume()` shows a plain message, leaves the room, returns to
setup; it never invents a fleet, forfeits silently or mirrors a fleet into the room (no stats at
stake, THE LAW not in play).

### The async delivery latch

`mp.redeliverRequested` (set by `_mpOnRoomUpdate`, checked by `_mpTryDeliverNextMove`'s drain loop
before releasing `mp.delivering`), as in Mancala/Dots and Boxes; more load-bearing here
(`bonusShotOnHit` chains of awaits). On a hash mismatch the host takes the seq and publishes a
snapshot; the guest sets `mp.awaitingRecovery`. **A divergence detected by the HOST while it was the
shooter must un-stick its own `busy`**: `_mpOnDivergence`'s host branch routes through
`_afterStateChange`; the rejected answer never mutated state, so the retry is safe.

### The two ready entries need their OWN, collision-free seq slots

Placement is the one concurrent beat; `appendMove` is a plain write, so two `++mp.appliedSeq`
reservations would collide. A ready entry lives at a FIXED seat-derived seq (`seat + 1`: host 1,
guest 2), found by scanning for `k:'r'` (`_mpRefreshReadySeats`); once both are seen `appliedSeq` is
bumped to 2 and the strict shot/answer stream starts at seq 3. **Any future game where players act at
the same time needs this fix.** **The shooter must record its own `lastShotSeat`/`lastShotRC` when it
fires** (its own entry is self-consumed and never runs the `k === 's'` branch), or every answer to
its own shot is discarded as unauthorized.

### Stats

MP results record under `MP_DIFFICULTY = 'mp'` (`tierOf('mp')` is null: counts in totals, claims no
tier pill). `_commitStats()` resolves win/loss through `_localSeat()` (recording the host's result
on a guest breaks THE LAW rule 2). `_statsCommitted` is set before any write (several paths reach
game-end). `recordHeadToHead('battleship', opp, won)` runs in MP only, in its own try/catch.

### Invariant coverage (`tools/test-mp-lockstep.mjs`, BS1-BS7)

BS1-BS5 port invariants 1-5 (BS3 has **no analogue**: no randomness queue); BS6 the
`redeliverRequested` race via a `bonusShotOnHit` chain; BS7 wrong-seat answer and out-of-turn shot
are discarded.

**Status: proven headlessly against `FakeRoom` and played end to end in real browsers against a fake
RTDB; no real Firebase room has ever been created.** Real-room latency is unverified.

### The harness that played a real match (2026-08-11)

`FakeRoom` proves the protocol, not the screens. Rebuild: two real instances in same-origin iframes
with `js/firebase-boot.js` swapped (Playwright route) for a ~30-line fake RTDB.

### The recovery deadlock (fixed 2026-08-11) — `_mpStateSeq`

A shooter reserves its seq in `_mpFireAt` before the public state changes, so `appliedSeq` runs one
AHEAD of the state. A recovery snapshot must publish **`_mpStateSeq()`** (`pendingShot ? appliedSeq
- 1 : appliedSeq`), never `appliedSeq`; **any code answering "where am I in the log" for someone
else to sync to must use it.** Also: `_mpOnDivergence`'s host branch **clears `pendingShot`**; and
`_mpApplyRecovery` **re-derives `lastShotSeat`/`lastShotRC` from the move log** (a stale pair
rejects the next good answer). All mirrored into `tools/test-mp-lockstep.mjs`'s `BattleshipSide`. BS2 was
never "flaky": it was this deadlock.

### Nothing in the lobby may wait forever (`_withNetTimeout`, 2026-08-11)

**Firebase RTDB calls do not reject when the server is unreachable, they never settle.** Every lobby
round trip (create, join, guest restore) is raced against `MP_NET_TIMEOUT_MS` (12s) and falls back
to the ordinary offline error (a late reply is harmless). `_tryRestoreMP` arms `mp.restoreProbe` +
a timer (`net.init()` proves Firebase is reachable, not that the room exists); the first real room
snapshot disarms it, otherwise the save is cleared and setup returns. Cleared in `destroy()`.

## Challenges, turn by turn (2026-10-27)

Matt: *"Why hasn't battleship been modified to have turn based multiplayer???"* Play vs. Friend's
third tab, **Challenge** (Host / Join / Challenge). `battleship/js/mp.js` (Battle Arena's model) +
`alert.js`; the screen glue is the `_ch*` methods in `ui.js`. The live-room `_mp*` code is untouched.
- **BOTH FLEETS ARE STORED IN THE MATCH** (Matt chose this: nobody is online to say "hit"). Every
  phone resolves every shot with `game.js` exactly as solo; the screen never draws the other fleet
  before the end, but dev tools could read it. Never call it hidden. Live rooms still never send one.
- **A hit shoots again, a miss passes** (Matt: *"Isn't keep shooting on a hit the standard?"*; it is a
  common house rule, not the printed one). Stored per match as `bonus: true`.
- The challenger places and sends; **the receiver places on first open and shoots first** (a shot
  needs the fleet it lands on). Both index rows are written at creation. OPEN until the receiver's
  first SHOT (placing is not an answer). Cancel / decline / resign / 3-day expiry: `js/challenge-life.js`.
- Node `battleship/` (`games/<id>`, `index/<CODE>/<id>`, `chat/<id>`); a match is two fleets + a log
  of shots, replayed and refused whole if it does not replay. Shots are written one at a time
  (outbox `gamehub.battleship.outbox.v1`); the other person's arrive by watch and play one at a time
  (`_chNext`). Counted once in `'mp'` with shots/hits (`countResult`, ledger
  `gamehub.battleship.counted.v1`), never head-to-head. Push: `battleshipTurnPush`, reminder, Remind bell.
- The list is LIVE while up (`_chWatchList`): a one-off read raced a cancel's second row write.
- The Challenge tab shows at most 4 rows (one fewer each for a note and Notify me), fitted in the hub
  at 390x664. A challenge never writes the solo save (`saveGame` returns on `ui.ch`).

## Settings & keys

- `gamehub.battleship.v1` — `{ v:1, size, difficulty, bonusShotOnHit, firstMode, nextStarter }`.
- `gamehub.battleship.save.v1` — solo mid-battle autosave.
- `gamehub.battleship.mp.v1` — MP autosave, including `myFleet`. Permanent (THE LAW rule 5).
- Challenges (2026-10-27): `gamehub.battleship.{seen,shown,counted,unseenResults,outbox,open}.v1`
  (`open` is sessionStorage). All one-tap recreatable except `counted`, the count-once ledger.

## Tests

```
node battleship/js/test.js          # engine, fleet, AI no-cheat, hash, full solo playthroughs
node tools/test-mp-lockstep.mjs           # BS1-BS7
node tools/test-visual.mjs battleship
node tools/check-no-scroll.mjs battleship          # includes the Challenge tab (EXTRA_SCREENS)
node tools/test-battleship-mp.mjs                   # challenges: replay, a whole match, cancel/decline/resign/expire
```
Two-phone browser check (2026-10-27): `js/firebase-boot.js` routed to a fake database held in node
(Playwright `exposeFunction`), test1/DREG5 vs a made-up TQWX7. Story: `CLAUDE-HISTORY.md`.

## The mode screen fits a short phone in the hub (2026-09-08)

Matt: *"I don't want any game in the gamehub to be scrollable at all. Everything MUST fit on a
single screen. Always."* `.bs-shell` must fit the 526px the hub leaves at 390x664 (and 640 high); the
`battleship.css` block is scoped under `.hub-main` (standalone fits everywhere). No text under 11px,
big buttons keep 44px. If it grows again, shorten the option-chip labels, not the font.

## Review and bug pass (2026-10-13)

Rules that came out of it (all in force):

- **`_stopGameTimers()`** stops every per-game timer (`aiTimer`, `_settleTimer`, `_bannerTimer`,
  `_botPlaceTimer`, `_endTimer`), called from `startGame`, `renderSetup`, `_mpApplyPlacementRound`.
  **Any new per-game timer goes in that list**; `startGame()` also clears `this.state`.
- Tap-to-place clamps onto the board like a drag; `_aimCell` is cleared when a battle starts,
  resumes, or setup opens.
- `finish()` writes stats immediately but holds the win/lose CARD back by `_shotSettleMs` (`_endTimer`).
- **Exit (✕) takes two taps mid-battle like Restart** (MP too); armed state is on the instance
  (`this._armed`, `_armedBtn`), not the button, since the battle re-renders. Armed pulse is a glow.
- Hover outline is `@media (hover: hover)` only. Tap targets 44px (invisible `::after` ring).
- `.bs-actions` has a **fixed 44px height** (FIRE otherwise resizes both boards when aiming).
