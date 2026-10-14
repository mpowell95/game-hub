# HANDOFF — Battleship

**Target executor:** Sonnet, **high** effort. See "Why high" at the bottom.
**Scope:** one new in-hub module game, `battleship/`: solo vs three AI tiers, plus real
two-device multiplayer over the shared `js/net.js` room protocol. Fully integrated into the hub
(launcher tile, stats, leaderboard, My Stats, i18n, theme, service worker, tests).
**Estimated size:** ~2,600 LOC across 8 files, plus ~14 integration edits in shared files.
**Risk concentration:** the multiplayer protocol (section 7). Battleship is the **first
hidden-information game in this repo**, and every existing MP game's protocol assumes both
devices can see the same state. Read section 7 before writing a line of `ui.js`.

Read the root `CLAUDE.md` first, in full — THE LAW, "Before you build: USE WHAT EXISTS", the
module contract, the "Adding a game" checklist. Then read `js/CLAUDE.md`'s "Multiplayer lockstep
— invariants" section and the consumer write-ups after it (third through ninth). This document
assumes both.

**Use `tic-tac-toe/` as your structural template** for everything except the MP payload shape.
It is the game the repo's MP conventions were settled in, its `_localSeat()` model was built in
from the first line rather than retrofitted, and its file layout, module contract, stats
recorder and integration edits are all current-convention. When this document says "follow the
existing pattern," Tic Tac Toe is the pattern. `dots-boxes/` is the closest second reference
(async delivery + `redeliverRequested`), and `hill-climb/` is the most recent game in the repo
if you want to see what a fresh folder looks like today.

---

## 0. Naming — settled, do not deviate

| Thing | Value | Precedent / note |
|---|---|---|
| Folder | `battleship/` | one word, no dash needed |
| Hub registry `id` | `'battleship'` | matches the folder, like `'chinchon'`, `'filler'` |
| **Stats game key** | **`'battleship'`** | same string as the hub id, so **no `HUB_ID` entry is needed** in `js/game-stats-ui.js` (that map exists only for the dashed-vs-undashed games: `connect4`→`connect-four`, `dotsboxes`→`dots-boxes`, …). Verify this is still true when you add it. |
| Display title | `Battleship` / es `Hundir la Flota` | the Spain-Spanish name for the game, per the "game titles translate, Spain Spanish only" decision (`js/CLAUDE.md`, "Language support"). It lives in **three** places that must stay in step — see section 10. |
| CSS prefix | `bs` → `.bs-root`, `.bs-*`, `--bs-*` | free. Taken today: `bg br cc cf db dm eb fl fly gh hc mc nb pl plr sn sv ttt un yz` |
| Settings key | `gamehub.battleship.v1` | gen-3 convention (root `CLAUDE.md` item 4) |
| Solo save key | `gamehub.battleship.save.v1` | mirrors `gamehub.tictactoe.save.v1` |
| MP save key | `gamehub.battleship.mp.v1` | mirrors `gamehub.tictactoe.mp.v1` — a separate key from the solo save, deliberately |
| Stats sub-counter | **`bs`** | free. Taken: `grid cc es nb br brOrbital sn tt db bg yz dm hc` |
| Accent color | `#34506E` (steel navy) | **verify on the real launcher grid** that it reads distinctly from Dominoes `#0E5C77` and Connect Four `#1769d4`, which are the two nearest blues. If it doesn't, go darker and greyer, not brighter. |
| `released` | the day you actually ship it | `js/hub.js` `GAMES` entry, `'YYYY-MM-DD'`. Set it. It is the only input to the New pill and it retires itself. |

**The stats key is the easiest way to silently break this build.** `recordResult` and every
`recordX` guard with `if (GAMES.indexOf(gameId) < 0) return null;` — an unknown id fails with no
error, no console warning, and stats simply never accumulate. Add `'battleship'` to the `GAMES`
array in `js/game-stats.js:136` **first**, before you write any recording code.

---

## 1. Files to create

```
battleship/index.html            standalone page (name-gated; must also be in sw.js ASSETS)
battleship/css/battleship.css    every rule descendant-scoped under .bs-root
battleship/js/game.js            pure engine, no DOM: fleet, shots, resolution, game over
battleship/js/fleet.js           pure placement helpers: legality, auto-place, rotation
battleship/js/ai.js              pure AI, no DOM, three tiers — see section 6
battleship/js/hash.js            FNV-1a state hash over PUBLIC state only — see section 7.4
battleship/js/strings.js         { en, es } dictionary
battleship/js/test.js            headless node assertions (engine + fleet + AI + hash)
battleship/CLAUDE.md             the game's own docs (checklist item 8)
```

`game.js`, `fleet.js`, `ai.js` and `hash.js` stay DOM-free and pure. That seam is what makes
`test.js` possible and it is not optional — `run-all-tests.mjs` runs these files in bare Node.

---

## 2. Patterns to copy — per axis

The settings **key** (a localStorage name nobody sees) and the settings **screen** (the setup
UI) are separate axes with different best examples. Do not infer one from the other.

| Axis | Copy from | Notes |
|---|---|---|
| **Setup screen** | **Escoba** `escoba/js/ui.js:288-330` | the accordion: `this._setupExpanded` (one row open at a time), `data-action="toggle-row"`, `eb-summary-row`. Matt's stated preference. **Do not copy Connect Four's screen** — the root file calls it the weakest in the repo. |
| **CSS scoping** | **Mancala** `mancala/css/mancala.css` | zero unscoped rules. Every rule `.bs-root .bs-x`, never a bare `.bs-x`. Cited for CSS discipline only, not for its screen. |
| **Stylesheet injection** | **Filler** `filler/js/ui.js:84-93` | `ensureStylesheet()` via `new URL('../css/battleship.css', import.meta.url)`, idempotent |
| **Standalone page** | **Dots and Boxes** `dots-boxes/index.html` | copy the `requireName()` block verbatim, change the ids |
| **MP glue** | **Tic Tac Toe** `tic-tac-toe/js/ui.js` (`_mp*` methods) | seat model, lobby screens, divergence latch, `MP_DIFFICULTY` |
| **Async MP delivery** | **Dots and Boxes** / **Mancala** | `mp.redeliverRequested` — you need it, see 7.6 |
| **Everything else structural** | **Tic Tac Toe** | newest game built to a handoff written from this same contract |

---

## 3. Rules and settings

### Core rules (classic, Milton Bradley)

- Two 10×10 grids per player: your **fleet** (ships placed, hidden from the opponent) and your
  **shot grid** (what you have fired at, hits and misses marked).
- Players alternate shots. Each shot names one cell on the opponent's fleet grid. The
  **defender** answers: miss, hit, or hit-and-sunk (naming the ship).
- **Ships may touch.** No adjacency or diagonal restriction. The AI's density model in section 6
  depends on this being true, so do not quietly add a no-touching rule.
- Ships are axis-aligned, horizontal or vertical, fully on the board, never overlapping.
- A player wins when every one of the opponent's ships is sunk.
- **There is no draw.** Unlike Tic Tac Toe/Dots and Boxes/Dominoes, this game cannot tie — the
  first fleet fully sunk loses, and only one side can be sunk on any single shot. So the `bs`
  sub-counter has no `tied` field and `recordBattleship` never passes `null` for `won`. Say this
  in a comment where the counter is defined, so a later session doesn't "fix" the omission.

### Board sizes (a setting, not a difficulty)

| Label | Grid | Fleet | Total ship cells |
|---|---|---|---|
| Quick | 8×8 | Battleship 4, Cruiser 3, Submarine 3, Destroyer 2 | 12 |
| **Classic** (default) | 10×10 | Carrier 5, Battleship 4, Cruiser 3, Submarine 3, Destroyer 2 | 17 |

Board size is **not** the difficulty tier. AI skill is (section 6), because `profile.skill` maps
1:1 onto beginner/intermediate/pro and `DIFF_META` in `js/game-stats-ui.js` expects exactly
those keys. Keep the two settings independent, the way Dots and Boxes keeps board size and AI
skill independent.

### Optional variant: Bonus shot on hit

One toggle, `bonusShotOnHit`, default **off**. When on, a hit keeps the turn (a chain, like Dots
and Boxes' box capture); a miss passes it. It costs almost nothing once the shot/answer protocol
in section 7 exists — the turn simply does not flip on a hit — but it does mean **one turn can
be many shots**, so the drain loop and the `redeliverRequested` latch have to be right. If you
are running short, ship this off-by-default and correct rather than half-done.

### Persisted settings — `gamehub.battleship.v1`

```js
{ v: 1, size: 'classic'|'quick', difficulty: 'beginner'|'intermediate'|'pro',
  bonusShotOnHit: false, firstMode: 'you'|'opponent'|'alternate', nextStarter: 'you'|'opponent' }
```

`firstMode` defaults to `'alternate'` — Matt's standing rule that every turn-based game defaults
to alternating who opens (`tic-tac-toe/CLAUDE.md`, "Who goes first"). Copy Tic Tac Toe's
`nextStarter` flip: persist it in `startGame()` **before** the state is built, so the flip
survives leaving mid-game.

---

## 4. Screens and visual design — this is half the ask

Matt asked for graphics, visuals, interface and animations that are **awesome**. That is a real
requirement here, not a garnish. Budget real time for it. Three screens.

### 4.1 Setup (Escoba accordion)

Rows: Opponent (Bot / Play a friend), Difficulty, Board size, Who goes first, Bonus shot on hit.
Difficulty pills render the shared ski-slope shape before the label — `diffShapeSVG()` /
`tierOf()` from `js/difficulty-tiers.js`, **never** a hand-drawn shape or a hue-only tier (Matt
is red/green colorblind). Copy the `.ttt-root .lb-dshape` sizing rules from `tic-tac-toe.css`.

A **How to play** button opens a sheet built on the pattern in `tic-tac-toe/CLAUDE.md`
(`openHelp()` is its reference implementation): a small diagram, a short lead line, no essay.
Read the variant/size at render time, never at module scope.

### 4.2 Placement

The screen that makes or breaks this game's feel.

- Ships listed beside the grid; **drag to place, tap to rotate** while dragging or while
  selected. Snap to the cell under the pointer, with a ghost preview of the whole ship.
- Legality shown by **shape and text, never hue alone**: a valid ghost is a solid outline with
  the ship's silhouette, an invalid one is a dashed outline with a small ✕ badge on the
  offending cells. Use the palette (`#E0532F` vermilion for invalid, `#178A7A` teal for valid)
  as reinforcement on top of the shape difference.
- **Auto-place** and **Clear** buttons. Auto-place must be a real shuffle (`fleet.js`,
  pure, seedable), not a fixed layout — a fixed layout would make every game against the same
  bot identical.
- Pointer events, not touch events. The board gets `touch-action: none`; every button gets
  `touch-action: manipulation`. **Never bind `touchmove` to `document` or `window`** — bind to
  the game's own root. A non-passive `document`-level `touchmove` kills compositor scrolling for
  the whole page for as long as the game is mounted, and `test-game-conventions.mjs` fails the
  build for it.
- Keyboard path: arrow keys move a cursor, `R` rotates, `Enter`/`Space` places. Cheap to add
  once the pure `fleet.js` legality check exists, and it is the only way this screen is usable
  without a pointer.

### 4.3 Battle

- **Two boards, deliberately unequal.** The enemy waters are the primary board, large and
  centered; your own fleet is a compact board below it. **When the turn flips to the opponent,
  the sizes swap with a transition** — your fleet grows, the enemy grid shrinks — so attention
  follows the action instead of the player having to hunt for what just happened. This is the
  single best interface idea in this document; do it.
- Turn banner, shot counter, and a small fleet roster per side showing which ships are still
  afloat (silhouette + name, struck through and dimmed when sunk).
- **Animations** (all of them `transform`/`opacity` only, no layout-triggering properties):
  - shot travel: a reticle snapping to the target cell, then a brief arc
  - **miss**: a splash — two or three expanding rings that fade, plus a white hollow peg
    dropping into the cell with a small bounce
  - **hit**: a burst — a scaled-up flash, a shockwave ring, and a filled vermilion peg; a short
    shake of the target board (`translate` only)
  - **sunk**: the whole ship reveals on the shooter's grid, tilts and settles with a darkened
    overlay, plus a banner: `Sunk: Cruiser`
  - **radar sweep** on the enemy grid while the opponent is thinking or while waiting on the
    network — this doubles as the honest "waiting for the other device" affordance in MP
  - **water**: a very subtle animated shimmer on untouched cells. Keep it cheap: one CSS
    animation on a pseudo-element with a long duration, not a per-cell JS loop.
  - **win/lose**: reveal the loser's whole remaining fleet before the popup lands.
- **`prefers-reduced-motion` is honored** — every game in this repo that animates already does
  (`chinchon`, `escoba`, `filler`, `mancala`, `yahtzee`, `boggle`). Under it, animations become
  instant state changes: the peg appears, the ship reveals, no travel, no shake, no shimmer.
  The game must be fully playable and fully legible with every animation disabled.
- **DOM + CSS, not canvas.** A 10×10 grid is 100 elements; two of them is nothing. Canvas would
  cost you the theme layer, the text scaling, the focus ring, the screen reader and
  `prefers-reduced-motion`, and buy nothing. Ball Run and Hill Climb use canvas because they are
  continuous-motion games; this is not one.
- **Dark mode from day one**: a `:root.gh-dark .bs-root` block overriding the `--bs-*` variables.
  No `prefers-color-scheme` media query in game CSS — `'auto'` is resolved once in JS by
  `js/theme.js` so the hub toggle always wins.
- **The win/lose popup gets a close (X) in its top-right corner** (root `CLAUDE.md`,
  accessibility conventions). Non-negotiable, it is a repo-wide rule.
- **No em dashes in user-facing copy.** Commas, colons or parentheses.
- Re-fitting on rotate/resize goes through `onViewportResize(cb)` from `js/viewport.js` and
  nothing else. `hill-climb/js/ui.js:120` is the current usage. A raw
  `window.addEventListener('resize', …)` is a mobile scroll-jank bug and fails
  `test-game-conventions.mjs`.

---

## 5. The engine (`game.js`, `fleet.js`)

Pure, DOM-free, JSON-safe state. Suggested shape:

```js
// A fleet is the SECRET half. A shot grid is the PUBLIC half. Keep them separate objects —
// section 7 depends on being able to transmit one and never the other.
fleet  = { size: 10, ships: [{ id:'carrier', len:5, r, c, dir:'h'|'v', hits:[false,…] }] }
shots  = { size: 10, cells: Int8Array-like /* 0 unknown, 1 miss, 2 hit */, sunkIds: [] }
state  = { size, bonusShotOnHit, turn: 0|1,
           fleets: [fleetOrNull, fleetOrNull],   // index = seat; the REMOTE seat is null in MP
           shots:  [shotsSeat0, shotsSeat1],     // both public, both fully known on both devices
           shotCount: [n0, n1], over: false, winner: null|0|1 }
```

Key functions, all pure:

- `placeShip(fleet, shipId, r, c, dir)` → new fleet or `null` if illegal
- `autoPlace(size, shipDefs, rng)` → a fleet; seedable rng so tests are deterministic
- `legalPlacements(size, len, isBlocked)` → used by both auto-place and the Pro AI
- `resolveShot(fleet, r, c)` → `{ result: 'miss'|'hit', shipId|null, sunk: bool, fleetSunk: bool }`
  — **this is the only function that reads a fleet**, and in MP it only ever runs on the device
  that owns that fleet
- `applyAnswer(state, seat, r, c, answer)` → new state, updating the public shot grid, the sunk
  list, the turn (respecting `bonusShotOnHit`) and `over`/`winner`

**Decide the game end inside `applyAnswer`, from the answer, and carry it out as a field on the
returned state** (MP invariant 1: decide the end before you emit, and gate on the engine's
pre-emit decision, never on a locally-guessed `winner`). The last sink is revealed by the
defender's answer, so both devices reach "over" through the same code path with the same input.

`test.js` must cover: placement legality at every edge and overlap case, auto-place always
producing a legal complete fleet across a few hundred seeds, `resolveShot` hit/sunk/fleet-sunk
transitions, turn flipping with and without `bonusShotOnHit`, and the hash agreeing across two
independently-built states that received the same answer sequence.

---

## 6. The AI (`ai.js`) — three tiers, none of them cheat

`ai.js` receives **only the public view**: its own shot grid, the ship lengths still afloat, the
board size, and the variant flags. **It never receives the opponent's fleet.** Make that
structural rather than a promise: the function signature simply has no parameter for it, and
`test.js` asserts that calling the AI with a state object whose `fleets` array is `[null, null]`
still returns a legal shot. A cheating Battleship AI is indistinguishable from a great one until
someone reads the code, which is exactly why it has to be impossible by construction.

| Tier | Key (canonical, do not translate) | Behaviour |
|---|---|---|
| Easy | `beginner` | uniform random untried cell. On a hit, ~50% chance it follows up on an adjacent cell, otherwise it wanders off. Beatable by anyone. |
| Medium | `intermediate` | random search with **hunt/target**: on a hit, queue the four orthogonal neighbours; after two collinear hits, extend along that axis first and only fall back to the perpendicular when the line is exhausted. |
| Hard | `pro` | **probability density.** For every ship still afloat, enumerate every legal placement over cells not yet known to be a miss; count how many placements cover each cell; shoot the maximum. In target mode, restrict the enumeration to placements covering at least one unresolved hit, which turns "hunt" and "target" into one uniform rule instead of two modes. Add parity pruning for the shortest remaining ship in pure-search mode. This is the standard near-optimal Battleship algorithm and it averages roughly 40 shots on a 10×10 classic fleet. |

Cost check: 10×10 with 5 ships is a few thousand placement tests per shot, sub-millisecond. No
worker, no time budget, no iterative deepening needed — unlike Tic Tac Toe's Ultimate Pro tier.
Say so in a comment so a later session doesn't add machinery this game does not need.

The tier keys `beginner`/`intermediate`/`pro` are storage vocabulary and map onto tiers 1/2/3 in
`js/difficulty-tiers.js` with no edit needed there. Only their **display labels** translate.

Give the bot a short "thinking" beat before it shoots (300-600ms, scaled down under
`prefers-reduced-motion`) so its shot reads as a move rather than a glitch.

---

## 7. Multiplayer — read this section twice

Two human devices over `js/net.js` (`rooms/<CODE>`), joined by a code, exactly like Tic Tac Toe
and Dots and Boxes. **`js/net.js` itself must not change.** Two seats, host 0, guest 1, using
the pre-existing 2-seat surface — not the N-seat extension Chinchón uses.

### 7.1 Why this game is genuinely new

Every existing lockstep consumer transmits moves from a finite vocabulary because one player's
action changes a board the other player's next action depends on. Both devices hold the **same**
state and verify the same hash. Boggle is the documented exception in the other direction: no
shared mutable state at all, so nothing to lockstep.

Battleship is neither. There **is** shared mutable state that both sides must agree on (the two
shot grids, the sunk lists, the turn), **and** there is state one side must never learn (the
other side's fleet). That combination is new here, and it decides the whole protocol:

> **A shot is two log entries, not one.** The shooter appends `shot {r,c}`. The **defender**
> resolves it against its own fleet and appends `answer {r,c,result,shipId,sunk,fleetSunk}`. The
> answer is the authoritative event; both devices apply it and hash after it. The shooter cannot
> resolve its own shot, so — uniquely among this repo's games — **the mover does not apply its
> own move immediately.** It shows a pending reticle and waits for the answer.

Do not be tempted to "simplify" this by transmitting both fleets at match start. That would make
the enemy fleet present in the guest's memory and in the room record, one console log away from
ruining every game, and it would put a value in the hash that the protocol is specifically
designed to keep out. The two-entry shape is the design; document it as such in
`battleship/CLAUDE.md`.

### 7.2 Mapping onto `net.js`'s existing fields

Reuse, never add fields (this is the sixth game to re-purpose the same slots — see
`js/CLAUDE.md`'s consumer sections for the previous five):

| `net.js` field | Meaning here |
|---|---|
| `round.n` | the game number within a rematch series hosted by one room |
| `round.dealer` | **the seat that shoots first** in this game (Tic Tac Toe uses it for "the seat that plays X", Pool for "the seat that breaks") |
| `round.deck` | **unused** — there is no shared randomness in this game. Both fleets are private and locally generated. Say so explicitly rather than inventing a payload. |
| `appendMove` | carries both entry kinds, discriminated by a `k: 's'|'a'` field |
| `writeResult` | **deliberately unused** — it sets `status:'ended'`, which would kill a room meant to host the next game. `status:'ended'` therefore means exactly "somebody abandoned the room". |

### 7.3 Entry validation — new, and load-bearing

Each entry must be checked against **who was allowed to author it**, which no previous game
needed because no previous game had an entry only one specific seat may write:

- a `shot` entry is valid only from the seat whose turn it is; anything else is discarded
- an `answer` entry is valid only from the **defender** of the immediately preceding shot;
  an answer from the shooter is discarded
- an answer must reference the same `{r,c}` as the shot it answers, and must carry the current
  game number (`mp.gameNum`), same stamp discipline as Tic Tac Toe's `_mpEncodeMove`

A discard here is a protocol violation, not a normal condition — log it loudly (THE LAW rule 6's
spirit) and treat it as divergence rather than silently continuing.

### 7.4 The hash covers PUBLIC state only

`battleship/js/hash.js` is FNV-1a like every other game's, but it hashes **only** the two shot
grids, both sunk lists, the shot counts, the turn, and `over`/`winner`. **It must not include
either fleet.** This is not a shortcut — each device holds one real fleet and one `null`, so a
fleet-inclusive hash would diverge on the first byte by construction. Write that reason in the
file header; it is exactly the kind of thing a later session "fixes" into a bug.

### 7.5 Recovery deviates from invariant 2, on purpose

The host answers a recovery request with a snapshot of **public state only**. The recovering
device rebuilds its own secret fleet from **its own local MP save** (`gamehub.battleship.mp.v1`),
never from the network.

Invariant 2 says a receiver must remap transmitted `isHuman` flags by seat because a snapshot's
flags are the sender's perspective. Here the equivalent problem is solved by construction, the
way Tic Tac Toe solved it: the snapshot contains nothing device-relative, so there is nothing to
remap. Prefer this shape.

**The honest failure case, which must be handled and must not be papered over:** a device that
lost its local save mid-match (storage cleared, different browser) cannot recover its own fleet
and the match cannot continue for it. Show a plain message ("This match can't be resumed on this
device"), leave the room, return to setup. Do **not** invent a fleet, do not forfeit silently,
and do not mirror fleets into the room to dodge this — an unfinished match records no stats, so
no earned history is at stake and THE LAW is not in play. Losing an in-progress match is an
inconvenience; leaking the enemy fleet is a broken game.

### 7.6 The async delivery latch — you need it

Remote answers **animate** (splash, burst, sink), so the drain loop `await`s between entries.
That is precisely the race Mancala found and Filler confirmed: a room update carrying the next
entry can land in the microtask gap right after the drain loop's "nothing left to apply" check
already read a stale cache, and the entry then sits undelivered until some unrelated room update
happens to trigger a new drain — which may never come, so the game hangs.

Implement `mp.redeliverRequested`: set it whenever the room-update handler refreshes the move-log
cache, check it in the drain loop before releasing `mp.delivering`. Copy the two comments from
`mancala/js/ui.js` explaining why. With `bonusShotOnHit` on, a single turn can be a long chain of
shot/answer pairs, which makes this more load-bearing here than in any previous game.

Also copy Tic Tac Toe's **divergence latch**: on a hash mismatch the host takes the seq (keeps
its authoritative state, publishes a snapshot) and the guest sets `mp.awaitingRecovery` until
that snapshot lands. Without the latch, every subsequent room update re-delivers the same entry
onto already-diverged state and burns the three-attempt budget before the host's answer arrives.

### 7.7 The rest of the MP surface

- `_localSeat()` from the first line, not retrofitted. Seats are **symmetric** here (both sides
  have a fleet and shoot), so host = seat 0, guest = seat 1, fixed for the room, and
  `round.dealer` is what varies per game — the Dots and Boxes shape, not Mancala's fixed board
  halves.
- Placement happens **simultaneously** at the start of each game: both devices place privately,
  each announces readiness, and the first shot waits for both. This is the one genuinely
  concurrent beat in the protocol — every other game is strictly turn-based — so it needs its own
  small ready-handshake rather than being folded into the move log. Model it as a `k:'r'` (ready)
  entry per seat and gate the first shot on both being present.
- MP results record under `MP_DIFFICULTY = 'mp'`, never the local setup's last AI tier. `tierOf('mp')`
  is null, so the play counts in every total and in the leaderboard's All filter and claims no
  tier pill; `DIFF_META` in `js/game-stats-ui.js` already gives `mp` a real label.
- `_commitStats()` resolves win/loss through `_localSeat()`. **A guest recording the host's
  result is a THE LAW rule 2 violation** — a loss written as a win is not additive-safe. Guard
  with a `_statsCommitted` flag set before any write, because MP reaches game-end by several
  paths (normal finish, restore of a finished game).
- `recordHeadToHead('battleship', opp, won)` in MP only, wrapped in its own try/catch, never
  allowed to block the ordinary result — copy `tic-tac-toe/js/ui.js:786`.
- `destroy()` must leave the room cleanly if a lobby was opened but never joined
  (`tic-tac-toe/js/ui.js:195-201` is the pattern).
- `isInProgress()` is **mode-split**, like Tic Tac Toe's: solo returns `false` (autosave/resume,
  leaving is lossless), MP returns `true` while a room is live. Put the reasoning in a comment
  right next to the function — the root `CLAUDE.md` requires the chosen meaning to be stated,
  not inferred from behaviour.
- Autosave **after** the MP bookkeeping for the same event (invariant 4). Saving first stores
  `mp.seq` one low and every rejoin re-applies an entry it already had.

### 7.8 Tests and honesty about status

Add a **`BS1-BS7` block to `test-mp-lockstep.mjs`**, mirroring the ui.js MP glue with per-method
citations the way the existing blocks do, and port the five invariant probes:

| Probe | Ports as |
|---|---|
| BS1 | invariant 1 — the match end is decided in `applyAnswer` from the answer, and every gate keys on that, not a local guess |
| BS2 | invariant 2 — the snapshot carries no fleet and nothing device-relative; a recovering device rebuilds its fleet from its own save |
| BS3 | invariant 3 — **no literal analogue** (no consumable randomness queue, `round.deck` unused). State the non-mapping explicitly in the probe message, the way DB2 and T-invariant-3 do, rather than inventing a gate that was never there |
| BS4 | invariant 4 — autosave after the seq advance |
| BS5 | invariant 5 — a boundary restore resumes the series with scores kept |
| BS6 | the `redeliverRequested` race, driven by a chain of `bonusShotOnHit` answers |
| BS7 | **new to this game**: an answer authored by the wrong seat, and a shot out of turn, are both discarded rather than applied |

**Be honest about status in `battleship/CLAUDE.md`.** A cloud session cannot reach Firebase, so
nothing here will have been played in a real room. Write "proven headlessly against `FakeRoom`;
no real room has ever been created" — the same caveat Tic Tac Toe, Pool, Boggle and Chinchón's
N-seat work all carry. Do not claim it works on two devices.

---

## 8. Stats — three edits, and the third is the one that gets missed

Root `CLAUDE.md` checklist item 7. Missing the third edit is a THE LAW rule 1 bug that is
**invisible on a single device** and has been missed twice in a row historically.

**8.1 `js/game-stats.js`**
- add `'battleship'` to the `GAMES` array (line ~136) — **do this first**
- `ensureBs(g)` + its call in `normalize()`
- `recordBattleship(difficulty, won, extras)`, additive only:

```js
g.bs = { played, won, lost, shots, hits, sunk, bestAccuracy: 0, fewestShotsWin: 0 }
```

`played/won/lost/shots/hits/sunk` are counters, they only ever increment. No `tied` field — this
game cannot draw (section 3).

**`fewestShotsWin` is the repo's first best that improves by going DOWN.** Every other best in
`game-stats.js` is a `Math.max`. Handle the unset sentinel explicitly at both the write site and
the aggregation site:

```js
g.bs.fewestShotsWin = g.bs.fewestShotsWin ? Math.min(g.bs.fewestShotsWin, n) : n;
```

`0` means "no win recorded yet", never "zero shots". Write that in a comment in both files. A
naive `Math.min(dst, src)` in `players-agg.js` would latch every player at 0 the moment a device
with no wins syncs — a silent, permanent, LAW-rule-1 wrong number.

`bestAccuracy` is a percentage 0-100, `Math.max`, and only updated on games that actually
finished, so a quit game cannot mint a fake 100%.

**8.2 `js/game-stats-ui.js`** — a screen that actually renders it. Stored is not enough (rule 1).
Add `{ id: 'battleship', labelKey: 'game_title_battleship' }` to `TABS`, and a per-game screen
showing W/L, total shots, hit rate, ships sunk, fewest-shots win, and the by-difficulty table.
Check whether `HUB_ID` needs an entry (it should not — the hub id and stats id are the same
string) and leave `UNIT_KEY` alone: this game's headline unit is wins, the default.

**8.3 `js/players-agg.js`** — an explicit `else if (g === 'battleship' && src.bs)` branch in
`aggregatePlayers`. Counters add; `bestAccuracy` takes `Math.max`; `fewestShotsWin` takes the
**minimum of the non-zero values** per above. Without this branch the game's own Stats screen
reads zeroes the moment a person's second device syncs, with every local store intact.

Add a per-game regression case to `players-agg.test.mjs` beside the existing ones, including a
case where one device has `fewestShotsWin: 0` (no wins yet) and the other has a real number — the
merged result must be the real number, not 0. The structural `[KNOWN-BUG PROBE]` guard in that
file discovers sub-counter keys straight out of `game-stats.js`, so it will fail the whole suite
if you add `bs` and skip either surface. That is the safety net working; do not route around it.

**8.4 `js/leaderboard-ui.js`** — add `{ id: 'battleship', labelKey: 'game_title_battleship' }` to
`GAME_META`. It is a competitive game, so leave `players-agg.js`'s `SOLO` set alone: `COMPETITIVE`
is derived as `GAMES.filter((g) => !SOLO.has(g))` over the list you already extended in 8.1, and
`leaderboard-ui.js`'s own `COMP_IDS`/`SOLO_IDS` are derived from `GAME_META` the same way. Adding
the id in 8.1 plus the `GAME_META` row is the whole edit; there is no third list to keep in step.

---

## 9. Hub integration

**9.1 `js/hub.js` `GAMES` entry:**

```js
{
  id: 'battleship',
  released: '2026-08-XX',                       // the real ship date
  title: { en: 'Battleship', es: 'Hundir la Flota' },
  blurb: { en: '…', es: '…' },                  // one line, no em dashes
  module: '../battleship/js/ui.js',
  immersive: true,
  accent: '#34506E',
  art: GAME_ART['battleship'],
}
```

`immersive: true` because this game owns its whole viewport (two boards plus its own chrome and
back affordance), the same call Escoba, Mancala, Ball Run, Yahtzee, Pool and Hill Climb made.

Array position is irrelevant — the launcher renders favorites first, then alphabetically by
displayed title, computed at render time.

**9.2 `js/game-art.js`** — add a `'battleship'` entry. **Landscape `viewBox="0 0 160 90"`, composed
to fill the frame, with a full-bleed background rect.** Do not draw a square composition and crop
it with `preserveAspectRatio="slice"`; that was tried in the 2026-07 tile redesign and rejected
for cutting shapes off mid-shape. A good composition for this frame: a ship silhouette in profile
on the right two-thirds, a peg grid on the left third, one vermilion hit peg and a splash ring.
The leaderboard's By Game screen reads the same map for its thumbnails, so it must look right
small.

**9.3 `sw.js`** — add every file (including `battleship/index.html` and the trailing-slash
`./battleship/`) to `ASSETS`, then bump `CACHE`. **Bump it past what is on `main` right now, not
past what is in your working copy** — two branches open at once both compute the same next number,
which happened on 2026-08-02 and produced two different builds both calling themselves
`game-hub-v260`. `activate` only deletes caches whose name differs and `warmRest` skips entries
already present, so the collision leaves a device permanently on a mixed build. `main` is at
`game-hub-v263` as of this writing; check it again before you commit.

Your files land in the `REST` tier automatically (`isShellAsset` only matches `./css/`, `./js/`,
`./icons/`, `./profile/` and the root shell), which is correct — they warm after activation,
best-effort, and cache on demand if the warm is interrupted.

Run `node validate-sw-assets.mjs` before committing. It fails on any `ASSETS` entry that 404s and
warns about deployed files not in the list — the exact mistake that left Connect Four's
standalone page uncached for a long time with no other symptom.

---

## 10. i18n

`battleship/js/strings.js` exports `{ en: {...}, es: {...} }`; English is the source of truth and
a missing Spanish key falls back to English, so partial translation never breaks. Build
`const t = makeT(STRINGS)` in `ui.js` and **call `t()` at render time, never at module scope**.
Include aria-labels. `snake/js/strings.js` + `snake/js/ui.js` are the reference implementation.

Ship-class names translate (Portaaviones, Acorazado, Crucero, Submarino, Destructor). Cell
coordinates (A1, B7) do not — they are notation, not vocabulary. Difficulty keys, size keys and
the `mp` bucket stay canonical; only display labels translate.

**The title lives in three places that must stay in step** (`js/CLAUDE.md`, "Language support"):
`js/strings.js`'s `game_title_battleship` key (read by *both* the leaderboard's `GAME_META` and My
Stats' `TABS`, so those two can never disagree), the hub `GAMES` entry's `title: {en, es}`, and
`battleship/js/strings.js`'s own `title`.

Add `battleship/js/strings.js` to `test-i18n-strings.mjs`'s `DICTS` list — it is the drift
tripwire for orphaned `es` keys, mismatched `{placeholder}` tokens and empty values.

---

## 11. Tests to run, and to add

Add `{ file: 'battleship/js/test.js' }` to `run-all-tests.mjs`'s engine-suite block.

Before you commit:

```
node test-game-conventions.mjs     # the machine-checkable half of the checklist
node validate-sw-assets.mjs        # no 404'd precache entry
node run-all-tests.mjs             # everything, exit-code aggregated. All green expected.
```

`test-game-conventions.mjs` discovers game folders from disk, so `battleship/` is covered the day
it appears. It will fail you, by name and with the fix, for: a raw resize/`orientationchange`/
`visualViewport` listener, a `document`-level `touchmove`, a fixed scrolling overlay without
`overscroll-behavior: contain`, an ungated standalone page, a missing `init`/`destroy`/
`isInProgress` export, unbalanced listeners, a missing `CLAUDE.md`, or a missing `{en,es}`
dictionary.

**If it fails, fix the game. Do not add `battleship` to its `KNOWN_GAPS` list.** That list is for
pre-existing debt only, and a brand-new entry there is a shortcut, not an exception — the file
says so in its own comments.

---

## 12. Documentation (checklist item 8, THE LAW rule 9)

**`battleship/CLAUDE.md`** — open with the THE-LAW pointer block copied from any existing game
file, then: hub integration (module, immersive, which `isInProgress()` meaning and why), layout
and responsibilities, key design decisions, correctness-critical engine notes, settings/save keys,
tests. `escoba/CLAUDE.md` is the reference for depth and structure.

**Root `CLAUDE.md`** — one row in the games table (integration, prefix, settings key, recorder)
and nothing more. Game-specific detail belongs in the game's own file.

**`js/CLAUDE.md`** — a new **"The tenth consumer: Battleship — the first hidden-information
game"** section after the ninth. This is the part a future session will actually need: the
two-entry shot/answer protocol, why the hash excludes fleets, why recovery restores the fleet
locally, the seat-authorship validation rule, and the honest unverified-on-real-devices status.
Also update the `js/net.js` row's consumer list and the `js/game-stats.js` row's sub-counter list
to include this game.

A milestone is not done until CLAUDE.md reflects it. This project's team is a sequence of fresh
sessions with no memory of each other, and every undocumented convention gets silently re-derived
and re-diverged by the next one.

---

## 13. Traps — the things that break silently

1. **Unknown stats id.** `recordBattleship` returns `null` with no warning if `'battleship'` is
   not in `game-stats.js`'s `GAMES` array. Nothing accumulates, nothing errors.
2. **Missing `players-agg.js` branch.** Perfect on one device, zeroes forever after a second
   device syncs.
3. **`fewestShotsWin` merged with a bare `Math.min`.** Latches everyone at 0 the moment a device
   with no wins syncs.
4. **A fleet in the hash.** Diverges on move one, by construction, on every single match.
5. **A fleet in the recovery snapshot.** The bug you will not notice because the game still
   works.
6. **No `redeliverRequested` latch.** MP hangs mid-match, intermittently, worse with
   `bonusShotOnHit` on. Reliably reproduced by Mancala's M1 case.
7. **`CACHE` bumped past your working copy instead of past `main`.** A permanently mixed build on
   any device that saw the other branch.
8. **A raw resize listener.** Re-lays-out the boards several times per frame during every scroll
   on mobile. This exact bug shipped in Hill Climb on the day it was removed everywhere else.
9. **The guest recording the host's result.** THE LAW rule 2. Resolve every win/loss through
   `_localSeat()`.

---

## Why high effort

Three things in this game are genuinely new to the repo rather than a copy of an existing
pattern, and each one is the kind of mistake that ships looking fine:

1. **The hidden-information protocol** (section 7). Every MP reference game in this repo assumes
   both devices hold the same state. This one cannot, and the resulting shot/answer shape,
   public-only hash, and local-fleet recovery have no precedent to copy — only invariants to
   port carefully.
2. **The first downward-improving best** (`fewestShotsWin`). Every other best in the codebase is
   `Math.max`, and the aggregation path has no sentinel handling to copy.
3. **The visual bar.** "Awesome graphics, visuals, interface and animations" is an explicit part
   of the ask. Placement drag-and-drop, the swapping board emphasis, and the hit/miss/sink
   animation set are real work, and they have to survive `prefers-reduced-motion`, dark mode, a
   phone viewport, and a colorblind player.

Suggested order: engine + fleet + tests → solo UI + placement + animations → stats and hub
integration (all four surfaces) → MP → docs → full test run. Get solo genuinely good before you
start the room protocol; a beautiful solo game with MP deferred is a better outcome than a
complete protocol behind a board nobody enjoys looking at.
