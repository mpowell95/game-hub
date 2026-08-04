# Battleship (`battleship/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`,
> which is always loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys,
> saves, and stats written by this game are governed by it: writes additive, keys never
> repurposed, no silent write failures.

Hub integration: in-hub `module:` (`battleship/js/ui.js`), `immersive: true` (its own full-bleed
chrome: two boards plus a fleet roster and back affordance, same call as Escoba/Mancala/Ball
Run/Yahtzee/Pool/Hill Climb). `isInProgress()` is **mode-split**: **solo** returns `false`
(autosave/resume built in — see below, leaving mid-battle is lossless); **MP** returns `true` for
as long as a room is joined, including the lobby and simultaneous placement, since leaving is
consequential for the live opponent even though this device could rejoin.

Built from `HANDOFF-BATTLESHIP.md`. This is the repo's **first hidden-information game** — every
prior multiplayer game assumes both devices hold the same state; here one half (each side's
fleet) must never be known to the other. That single fact shapes almost everything below.

**Accent `#34506E` (steel navy) is unverified against a real rendered launcher grid** — this build
happened in a cloud session with no browser. Computed color distance against the two nearest blues
(Dominoes `#0E5C77`, Connect Four `#1769d4`) shows it reads closer to Dominoes than to Connect Four
by that one crude metric, though the hues differ (teal-leaning vs. navy/slate-leaning). The handoff's
instruction stands: check it on the real grid, and if it doesn't read distinctly, go darker and
greyer, not brighter.

## Layout & responsibilities

```
battleship/js/game.js    pure engine: fleets (secret), shot grids (public), resolution, turn/end
battleship/js/fleet.js   pure placement: ship catalogs, legality, auto-place (real shuffle), rotation
battleship/js/ai.js      three AI tiers, no DOM, structurally unable to read a fleet (see below)
battleship/js/hash.js    FNV-1a over PUBLIC state only — never a fleet
battleship/js/ui.js      DOM shell: setup, placement, battle, animations, MP glue
battleship/js/strings.js every user-visible string, { en, es }
battleship/js/test.js    headless assertions for game/fleet/ai/hash (node battleship/js/test.js)
battleship/css/battleship.css   all styles, .bs- prefixed, every rule descendant-scoped under .bs-root
battleship/index.html    standalone host (name-gated, same init() as in-hub)
```

## Rules

Classic Milton Bradley rules. Ships **may touch** — no adjacency or diagonal restriction; the Pro
AI's probability-density search (`ai.js`) depends on this being true. Two board sizes, a setting
independent of AI difficulty: **Quick** (8x8, 12 ship cells: Battleship 4/Cruiser 3/Submarine
3/Destroyer 2) and **Classic** (10x10, 17 ship cells, adds a Carrier 5). **There is no draw** — the
first fleet fully sunk loses, and only one side's fleet can finish being sunk on any single shot.
`bonusShotOnHit` (default **off**) keeps the same shooter's turn on a hit instead of passing it;
shipped off-by-default per the handoff, since it multiplies the async-delivery risk in
multiplayer and the instruction was to ship it correct rather than half-done.

## The engine's two kinds of state, and why they're kept apart

- A **fleet** is SECRET: which ships, where, which cells are hit. Only the owning device ever
  holds the real one.
- A **shots grid** is PUBLIC: what's been fired at a seat's fleet and the result. Both devices
  always agree on both shot grids.

`game.js`'s `state.fleets[seat]` is `null` for the seat this device doesn't own (both are known
locally in solo, where one process plays both sides). `resolveShot(fleet, r, c)` is **the only
function in the engine that reads a fleet**, and in multiplayer it runs only on the device that
owns that fleet. `applyAnswer(state, seat, r, c, answer)` (`seat` = the DEFENDER) is the single
place the match end is decided, from the answer, and carried as `over`/`winner` on the returned
state — both devices reach "over" through the same code path fed the same answer, never a
locally-guessed conclusion. Cells resolve through three states plus a fourth: `CELL_UNKNOWN` →
`CELL_MISS` or `CELL_HIT` → `CELL_SUNK` once every cell of that ship has been hit. `CELL_SUNK` is
a deliberate extension beyond a bare hit/miss binary: it is what lets `ai.js`'s hunt mode (and the
UI's sunk-ship reveal) tell "still actively worth chasing" apart from "fully resolved, stop
looking here" using nothing but the public grid — the same information a human player has.

**One additive deviation from the handoff's literal answer shape**: `answer.cells` (the sunk
ship's own cell list, present only when `sunk` is true) rides alongside
`{result, shipId, sunk, fleetSunk}`. This does not leak new information — a ship can only be
reported sunk once every one of its cells has individually been hit BY THE SHOOTER, so every cell
in `cells` was already known to the shooter as a hit; the defender is only telling it which of its
own prior hits belong to the same ship, exactly as a real opponent saying "you sank my Cruiser"
would. Documented here so a later session doesn't read the handoff's literal shape as license to
strip it back out.

## The AI (`ai.js`) — no-cheat by construction

`chooseShot(state, targetSeat, shipSet, difficulty, rng)` never reads `state.fleets` — not a
promise, a fact you can grep for. `test.js` calls it with `fleets: [null, null]` across all three
tiers and asserts a legal shot every time. Ship lengths still afloat are derived from
`state.shots[targetSeat].sunkIds` against the known ship catalog, never from a fleet.

- **Easy (`beginner`)** — uniform random untried cell; ~50% chance of following up on an active
  hit's neighbour.
- **Medium (`intermediate`)** — hunt/target: on any active hit, extends along the line implied by
  two or more colinear active hits before falling back to any untried neighbour of any active hit.
- **Pro (`pro`)** — probability-density search: enumerates every legal placement of every ship
  still afloat over cells not known-miss/known-sunk, counts how many cover each untried cell,
  shoots the maximum. In target mode (any active hit present) the enumeration is restricted to
  placements covering at least one active hit — the standard trick that unifies "hunt" and
  "target" into one rule. Parity pruning (checkerboard) applies only in pure-hunt mode, keyed to
  the shortest remaining ship's length. Sub-millisecond per shot on a 10x10 board with 5 ships —
  no worker, no time budget, no iterative deepening needed, unlike Tic Tac Toe's Ultimate Pro
  tier. Do not add machinery here; `test.js` pins Pro beating Beginner in most games as a sanity
  check on tier ordering.

The bot gets a 300-600ms "thinking" beat before it shoots, shortened under
`prefers-reduced-motion`.

## Solo autosave/resume

`gamehub.battleship.save.v1` holds one mid-BATTLE position (`saveGame`/`loadGame`/`clearGame` in
`ui.js`, mirroring `mancala/js/ui.js`'s pattern). **Placement itself is not autosaved** — leaving
mid-placement just restarts placement on the next mount, an accepted simplification since nothing
earned is ever at risk there (no shots have been fired, no result could exist yet). Checkpointed
from the single post-shot funnel (`_afterStateChange`), cleared on game end, on Restart/rematch,
and on "New game" mid-battle. `isInProgress()` reflects this: solo always returns `false`.

## Visual design

Two boards, deliberately unequal, per `HANDOFF-BATTLESHIP.md` section 4.3 — "the single best
interface idea in this document." **Revised 2026-08-04** (`HANDOFF-BATTLESHIP-POLISH.md`, a fix
pass over the shipped build): the original per-turn size swap (`.bs-boardpanel.is-primary`/
`is-secondary`, CSS `transition: max-width`) read as the game glitching on a real phone — a
layout property animating on every turn flip. Boards now **never resize**: enemy waters is always
the large panel (`.bs-boardpanel-enemy`), your own fleet always the small one
(`.bs-boardpanel-own`), fixed classes with no per-turn swap. Whose turn it is is shown only by
`.bs-board.is-active-turn` (`box-shadow` + `opacity`, both compositor-safe) and the status line —
never a resize. A single CSS custom property, `--bs-cell`, is computed once per real viewport
change (`js/viewport.js`'s `onViewportResize`, coalesced to one callback per frame — see
`hill-climb/js/ui.js`'s usage for the pattern; unsubscribed in `destroy()`) from the actual
rendered board width, and everything derived from it (ship sprites, the roster) stays in step
with the board without recomputing anything independently.

Placement is drag-to-place (pointer capture on the ship chip, so drag events keep bubbling to the
root-scoped listener) with tap-to-rotate and a full keyboard path (arrow keys move a cursor, `R`
rotates, Enter/Space places) once a ship is selected — legality shown by shape AND color (a solid
outline + ship silhouette when valid, a dashed outline + ✕ badges on the offending cells when
not), never hue alone.

**Ships render as boat sprites, not flat cell backgrounds** (`battleship/js/ship-art.js`, added in
the same polish pass): one inline SVG per ship class (Carrier/Battleship/Cruiser/Submarine/
Destroyer), each with a distinct silhouette (a submarine has no turrets — deliberately the one
shape cue that must never be confused with a surface combatant), two-tone via `--bs-ship` (hull)
and `--bs-ship-deck` (lighter deck-detail tint, both dark-mode-aware). Drawn once, horizontally,
bow-to-the-right; vertical placement rotates only the SVG's own wrapper `<div>` in place (`ui.js`'s
`_shipSpriteHtml`) — the markup itself is never redrawn. The same builder is reused in all three
places the handoff called for: placement drag chips, the fleet roster (now a fixed single row,
`overflow-x: auto` and `overscroll-behavior: contain` if it ever needs to scroll), and the board
itself, where a ship is one absolutely-positioned element spanning `len × --bs-cell` (cells
underneath stay plain water — there is no more `.bs-has-ship` background rule). The enemy board
never shows a ship until it's sunk; `ui.js`'s `_recordSunkShipGeometry` reconstructs a sunk ship's
board position purely from its own already-public revealed cells (`answer.cells` — every one of
which this device already knew as a hit before the ship could be confirmed sunk, same reasoning as
the answer shape itself), so this works in MP too without ever knowing the enemy's un-sunk layout.
That helper is intentionally a **shared, non-`_mp*` method** so it stays reachable from the MP
path without touching any `_mp*` method or `game.js`/`hash.js` — see the note on that boundary in
the multiplayer section below.

**Firing is a 5-beat sequence, not a single circle popping in**: launch (reticle snap, unchanged),
travel (a small shell arcs in over a growing/darkening water-shadow, `transform`/`opacity` only),
then impact — a **miss settles to a hollow ring** (plume + expanding rings + specks on the way in)
and a **hit settles to a filled peg with a rotated-square burst OUTLINE** (fireball + flash +
shockwave + smoke puff on the way in) — deliberately different SHAPES, not just different colors,
per the repo's colorblind rule. A sunk ship's own sprite lists ~13° and slides under the waterline
with a spreading oil-slick darkening beneath it (`.bs-ship-sprite.is-sinking`), instead of a
separate `.bs-sunk-ship` overlay element. The old `.bs-radar` "teal wedge" (read as a rendering
artifact in review) is now a much thinner, lower-opacity leading-edge sweep. Every one of these is
`transform`/`opacity`/`filter`/`box-shadow` only — never `width`/`height`/`inset`/`background-size`
— and `prefers-reduced-motion: reduce` strips the entire travel/impact-decoration layer down to the
settled peg or sprite state appearing instantly; the whole game stays fully legible with animation
off. Dark mode is a `:root.gh-dark .bs-root` variable override, never a `prefers-color-scheme`
query in the game's own CSS. The win/lose popup has a top-right close (X), per the repo-wide rule.

## Multiplayer — the repo's first hidden-information protocol

Two human devices over the shared `js/net.js` room protocol (`rooms/<CODE>`), same 2-seat surface
Tic Tac Toe and Dots and Boxes use, **`js/net.js` itself untouched**. Seats are **symmetric**
(both sides have a fleet and shoot): host = seat 0, guest = seat 1, fixed for the whole room;
`round.dealer` (the seat that shoots first) is what varies per game.

### A shot is TWO log entries, not one

The shooter appends `{k:'s', g, seat, r, c}`. It does **not** apply this to its own public state —
there is nothing to apply yet. The **defender** resolves it against its own local fleet (never
transmitted) and appends the authoritative `{k:'a', g, seat, r, c, result, shipId, sunk,
fleetSunk, cells}`. **Both** devices apply the `'a'` entry to their shared public state and hash
after it — the defender applies it immediately (it authored the result, so it doesn't need to
wait for a round trip); the shooter applies it on delivery. This is why, uniquely among this
repo's games, **the mover does not apply its own move immediately** — it shows a pending reticle
and a radar sweep and waits.

There is also a `{k:'r', g, seat}` ready entry per seat: placement happens **simultaneously**
(both devices place privately, `_mpApplyPlacementRound` puts both into the `placement` view the
instant the host's round record lands), each announces readiness on its own, and the first shot
waits for both `readySeats` to be present. This is the one genuinely concurrent beat in the
protocol — every other exchange here is strictly turn-based.

**Do not transmit either fleet at match start**, even as a "simplification." That would put the
enemy fleet in the guest's memory and in the room record, one console log away from ruining every
game, and it would put a value in the hash the protocol is specifically designed to keep out.

### Field mapping onto `net.js` (sixth game to re-purpose the same slots)

| `net.js` field | Meaning here |
|---|---|
| `round.n` | the game number within a rematch series hosted by one room |
| `round.dealer` | the seat that shoots first this game |
| `round.deck` | **unused** — no shared randomness; both fleets are private and locally generated |
| `appendMove` | carries all three entry kinds, discriminated by `move.k` (`'r'`/`'s'`/`'a'`) |
| `writeResult` | **deliberately unused** — `status:'ended'` means exactly "somebody abandoned the room" |

### Entry validation (new to this game, section 7.3)

- a `'s'` entry is valid only from the seat whose turn it currently is (`move.seat === state.turn`)
- an `'a'` entry is valid only from the defender of the immediately preceding shot
  (`move.seat === 1 - mp.lastShotSeat`) and must reference the same `{r,c}`
- a `'r'` entry is unconditionally accepted (idempotent by seat-set membership; there's no state
  to diverge on)

A failed check on `'s'`/`'a'` is logged loudly (`console.error`) and routed through
`_mpOnDivergence`, the same recovery path a hash mismatch takes — a discard here is a protocol
violation, not a normal condition.

### The hash excludes both fleets (section 7.4)

`battleship/js/hash.js` hashes only the two shot grids, shot counts, turn, `over`/`winner` — never
`state.fleets` (solo isn't hashed at all; MP never has real fleet data in `state` in the first
place, see below). This is not a shortcut: each device holds one real fleet and one `null`, so a
fleet-inclusive hash would diverge on the very first byte, on every single match, by construction.

### `mp.myFleet` lives outside the hashed state

In multiplayer, `state.fleets` is never populated at all — the local device's own actual fleet is
kept on `this.mp.myFleet`, entirely separate from the engine state that gets hashed and
transmitted. `_mpDefenderResolveAndAnswer` reads and updates it directly. This is the structural
guarantee that makes "the hash never contains a fleet" true by construction rather than by
discipline.

### Recovery deviates from invariant 2, on purpose (section 7.5)

The host's recovery snapshot (`_mpSnapshot()`) is public-state-only — same shape as the normal MP
autosave minus `myFleet`. The recovering device rebuilds its own secret fleet from **its own local
MP save** (`gamehub.battleship.mp.v1`'s `myFleet` field), never from the network. Unlike Tic Tac
Toe/Mancala, there's nothing device-relative to remap in the snapshot at all (seats are fixed for
the room, not swapped per game) — solved by construction, same shape as Tic Tac Toe's own
snapshot design.

**The honest failure case, handled and not papered over**: if this device lost its local save
(storage cleared, different browser) and the game has moved past placement, it cannot recover its
own fleet and the match cannot continue here. `_mpCannotResume()` shows a plain message, leaves
the room, and returns to setup. It does **not** invent a fleet, forfeit silently, or mirror a
fleet into the room to dodge this — an unfinished match records no stats, so no earned history is
at stake and THE LAW is not in play; losing an in-progress match is an inconvenience, leaking the
enemy fleet would be a broken game.

### The async delivery latch

`mp.redeliverRequested`, set by `_mpOnRoomUpdate` whenever it refreshes the move-log cache and
checked by `_mpTryDeliverNextMove`'s drain loop before it releases `mp.delivering` — same
construction, same reasoning, as `mancala/js/ui.js` and `dots-boxes/js/ui.js`. Remote answers
animate (a paced `await` after applying an `'a'` entry, `_mpApplyNextEntry`), which opens exactly
the race Mancala found: a room update carrying the next entry can land in the gap right after the
drain loop's own "nothing left to apply" check already read a stale cache. **More load-bearing
here than in any previous game**: with `bonusShotOnHit` on, a single turn can be a long chain of
shot/answer pairs, each one an `await`.

The divergence latch is the same shape as every other game here: on a hash mismatch (or a
discarded protocol violation) the host takes the seq and publishes a snapshot; the guest sets
`mp.awaitingRecovery` until that snapshot lands.

**A divergence detected by the HOST while it was itself the shooter must un-stick its own `busy`
flag, not just publish a snapshot.** Found by this game's own BS2 lockstep case, where the
corrupted entry happened to be the answer to the host's own pending shot: every OTHER game's
divergence handling assumes the detecting device is either the host (which just republishes and
moves on) or a guest that will shortly consume a recovery snapshot via the normal
apply-recovery-then-continue path. Here, the host's `busy` flag (set the instant it fired,
released only when a valid answer lands) has nothing to release it if the host detects the bad
answer itself — it never consumes its own recovery. `_mpOnDivergence`'s host branch fixes this by
routing through the ordinary `_afterStateChange` funnel (which unconditionally resets `busy` and
re-renders), not by treating a divergence as a dead end needing its own special recovery. The
host's own local `this.state` is never mutated by a rejected answer, so this "recheck whose turn
it is and carry on" is a genuine, safe retry — from the host's own perspective the disputed cell
was never actually marked fired.

### The two ready entries need their OWN, collision-free seq slots

**Placement is the one genuinely concurrent beat in this protocol, and that broke the ordinary
seq-reservation pattern.** Every other local-move write in this repo (`++mp.appliedSeq` before the
network `await`) is safe because only ONE seat is ever mid-turn at a time — but both seats place
simultaneously, and `net.js`'s `appendMove` is a plain write, not a transaction. Two independent
`++mp.appliedSeq` reservations starting from the same fresh count WOULD collide on the identical
seq slot, each write silently clobbering the other in the room's move log (found by this game's
own BS1 lockstep test while this handoff was being implemented — an actual regression, not a
hypothetical). The fix: a ready entry lives at a FIXED, seat-derived seq (`seat + 1` — host always
1, guest always 2) that can never collide by construction, discovered by scanning the log for
`k:'r'` entries (`_mpRefreshReadySeats`) rather than by walking the strict `appliedSeq + 1` stream.
Once both are seen, `appliedSeq` is bumped past both reserved slots (to 2) so the strict shot/
answer stream — which genuinely is single-writer-per-turn — starts clean at seq 3. **Any future
game whose players can legitimately act at the same time (not just Battleship's placement) should
expect this exact hazard and reach for this exact fix**, not assume the single shared counter
every turn-based game here uses is safe by default.

**The shooter must record its own `lastShotSeat`/`lastShotRC` at the moment it fires, not only
when a defender processes the incoming `'s'` entry.** The shooter's own copy of that entry is
self-consumed by the synchronous seq reservation (the same "already accounted for" pattern every
local move uses) and so never actually runs through `_mpApplyNextEntry`'s `k === 's'` branch — the
one place that would otherwise set these fields. Missing this left the shooter with nothing to
validate the incoming answer against, so every answer to its own shot was wrongly discarded as an
unauthorized author (also found by BS1, before the fix — the very first exchange of every match
hung).

### `_localSeat()` from the first line

Seats are symmetric (both sides have a fleet and shoot, like Dots and Boxes' engine seat 0/1, not
Mancala's fixed board halves), so host = seat 0 / guest = seat 1 stays fixed for the whole room —
the Dots and Boxes shape, not Mancala's. `round.dealer` is what varies per game.

### Stats

MP results record under `MP_DIFFICULTY = 'mp'`, never the local setup's last AI tier —
`tierOf('mp')` is null, so the play counts in every total and the leaderboard's All filter and
claims no tier pill. `_commitStats()` resolves win/loss through `_localSeat()` (`s.winner ===
this._localSeat()`) — a guest recording the host's result would be a THE LAW rule 2 violation (a
loss written as a win is not additive-safe). `_statsCommitted` is set before any write, since MP
reaches game-end by several paths (normal finish, restore of a finished game).
`recordHeadToHead('battleship', opp, won)` runs in MP only, wrapped in its own try/catch that can
never block the ordinary result.

### Invariant coverage (`test-mp-lockstep.mjs`, BS1-BS7)

| Probe | Ports as |
|---|---|
| BS1 | invariant 1 — match end decided in `applyAnswer` from the answer; every gate keys on `state.over`/`state.winner`, never a local guess |
| BS2 | invariant 2 — the snapshot carries no fleet and nothing device-relative; a recovering device rebuilds its fleet from its own save |
| BS3 | invariant 3 — **no literal analogue** (no consumable randomness queue, `round.deck` unused). Stated explicitly in the probe message rather than inventing a gate that was never there |
| BS4 | invariant 4 — autosave after the seq advance |
| BS5 | invariant 5 — a boundary restore resumes the series |
| BS6 | the `redeliverRequested` race, driven by a `bonusShotOnHit` chain |
| BS7 | new to this game: an answer authored by the wrong seat, and a shot out of turn, are both discarded rather than applied |

**Status: proven headlessly against `FakeRoom`; no real room has ever been created.** A cloud
session cannot reach Firebase — same honest caveat Tic Tac Toe, Pool, Boggle and Chinchón's N-seat
work all carry. Real-room behaviour, including the `bonusShotOnHit` chain's latency under real
network conditions, is unverified until a local-device pass runs.

## Settings & keys

- `gamehub.battleship.v1` — `{ v:1, size, difficulty, bonusShotOnHit, firstMode, nextStarter }`.
- `gamehub.battleship.save.v1` — solo mid-battle autosave (see above).
- `gamehub.battleship.mp.v1` — MP autosave, including `myFleet` (the whole point — see recovery
  above). A third, separate key from the other two, permanent once shipped (THE LAW rule 5).

## Tests

```
node battleship/js/test.js
```
Placement legality at every edge/overlap case; `autoPlace` always producing a legal, complete
fleet across 300 seeds x 2 board sizes with no cell shared between ships; `resolveShot`
hit/sunk/fleetSunk transitions; `applyAnswer`'s turn flip with and without `bonusShotOnHit` and its
`over`/`winner` decision; the hash agreeing across two independently-built states fed the same
answer sequence AND being unaffected by which fleet object either side happens to hold (including
`fleets: [null, null]`, the real MP shape); the AI's structural no-cheat property across all three
tiers; every tier-pair x board-size full solo playthrough terminating without throwing; Pro beating
Beginner in most of 40 games as a sanity check on tier ordering.
