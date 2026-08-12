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

## The deploy screen moves NOTHING while you drag (2026-08-11 — settled)

Matt: *"It moves around if you drag your boats while placing them."* Two separate causes, both in
the header/tray above the board, neither of them in the drag code:

1. **The tray wrapped.** Five chips carrying a NAME and a rotate BUTTON each needed two rows at
   393px. Placing the first ship dropped it to one row and pulled the board **71px up the screen**,
   under the finger, mid-drag. It is one row now — bare silhouettes, no labels — with a **fixed
   height on `.bs-tray`** so an emptying tray leaves the board exactly where it was. The header's
   button row (`.bs-deploy-btns`) has the same fixed height and `flex-wrap: nowrap` for the same
   reason: SAVE appears in it the moment the last ship lands, which was the second jump.
2. **The rotate button sat dead centre on the chip** — the natural place to grab a ship — and
   `onPointerDown` returns early on `[data-action="rotate-ship"]`, so a drag started there did
   *nothing at all*. Both the tray buttons and the placed ships' corner arrows are gone. **Rotate
   is now the same gesture everywhere: tap the ship.** Tap an unplaced chip to select it, tap the
   selected chip again to rotate; tap a placed ship to rotate it in place. `R` still works.

`test-visual.mjs`'s battleship PLAY probe drags all five ships with real touch events and fails if
the board's box changes even once, or if fewer than five land. **A screenshot cannot catch this** —
every individual frame of the bug looks perfect; only the sequence is wrong.

## The words are gone (2026-08-11)

Matt: *"There's way too much text."* Same instruction Pool got a day earlier ("no word instructions
during the game, it must be self explanatory with symbols"). What went, and what replaced it:

| Was | Now |
|---|---|
| "Your turn: fire!" / "Incoming!" / "Bot thinking" / "Hit! Fire again." | `_turnBarHtml()` — the shooter's avatar and a chevron pointing at the board about to be hit (up = enemy waters, down = your deck) |
| "Drag to move, tap to rotate, or try random placement." | nothing; the gesture IS drag and tap |
| "5 ships left to place" / "Every ship is on the board." / "Fleet ready. Tap SAVE to sail." | the tray itself, and SAVE existing at all |
| CARRIER / BATTLESHIP / CRUISER / SUBMARINE / DESTROYER in the tray | the silhouettes, which is what you are actually dragging |
| "Clear" / "How to play" / "Restart" buttons, "Shots: 3" | icon discs, and `⌖ 3` |
| EXIT spelled top-to-bottom in the fleet strip | an `✕` disc |
| "Sunk: Carrier" | the ship, struck through, in its owner's colour |
| "Miss = ripple. Hit = flash. Sunk = the whole ship reveals." (in How to play) | `_helpMarkerKey()` — the three real markers, drawn. That sentence had also gone stale: a miss has been a CROSS since the 2026-08 redesign |

**Nothing lost its accessible name.** Every symbol carries the old wording as an `aria-label`, and
`_statusText()` still exists — it feeds a visually-hidden `aria-live` region (`.bs-sr`) inside the
turn bar. A symbol with no accessible name is a step backwards, not a simplification.

**MP status messages stay as words** (connection error, resyncing, opponent disconnected). They are
failures, not instructions; a glyph for "we lost sync" teaches nobody anything.

**Side effect worth knowing: this is what made the battle screen FIT.** Battleship was
`test-visual.mjs`'s longest-standing `fits one screen` gap — up to 221px too tall in the hub on a
short phone. `_fitBattleBoards()` was not touched; the sentences it was competing with were simply
deleted, and the entry is gone from `KNOWN_GAPS`.

## The four screens (visual rebuild, 2026-08-05, `HANDOFF-BATTLESHIP-REDESIGN.md`)

The game was rebuilt visually and interactively against a reference mobile Battleship. The engine,
the MP protocol, the stats recorder and every storage key were untouched by that pass; everything
below is `ui.js` rendering, `battleship.css`, `ship-art.js` and `strings.js` only.

**The one idea the whole layout hangs on: the vertical sandwich.** Enemy waters on top as a dark
navy grid, the fleet roster strip in the middle, your own board below as a brown wooden grid on a
salmon deck. Both boards are always visible, neither ever resizes, there is no swap or mode
switch. Get that wrong and nothing else matters.

1. **Mode screen** (`renderSetup`) — a dark navy header panel with the game's own one-line
   explanation, and a card riding over it: the opponent's avatar (from `loadProfile()`, read-only
   as always), the difficulty name in gold caps with the ski-slope `diffShapeSVG` tier marker
   beside it, a three-stop **slider**, then **PLAY VS. BOT** (amber) and **PLAY VS. FRIEND**
   (purple, which opens the EXISTING host/join lobby, `_friendHTML()` — there is no second MP
   path), then an **Options** row of chips (board size, first shot, bonus shot) and the How to
   play link. The old four-row accordion is gone; every setting it carried is on a chip that
   cycles, and every one still writes the same `gamehub.battleship.v1` fields.
   **The slider is display only**: the stored values stay `beginner`/`intermediate`/`pro` (storage
   vocabulary `js/difficulty-tiers.js` and `js/game-stats-ui.js`'s `DIFF_META` both key on). Only
   the labels are Easy/Medium/Hard.
2. **Deploy screen** (`renderPlacement`) — navy panel with the title and ONE fixed-height row of
   controls (exit, clear, random, help as icon discs) plus a green **SAVE** pill that is **absent,
   not disabled**, until every ship is placed. The hint line is gone; see "The deploy screen moves
   NOTHING while you drag" and "The words are gone" above, which supersede the rest of this entry
   wherever they disagree with it.
   Below it the salmon deck carries the tray of unplaced ships and the wooden board. A placed ship
   is a real sprite you can pick straight off the board: drag to move, or release without moving to
   rotate in place (`onPointerUp`'s `origin` branch; `_rotatePlacedShip` and the corner arrow it
   served are gone). Legality is SHAPE first: solid outline + a check badge when legal, **dashed**
   outline + a cross badge when not. The keyboard path (arrows/`R`/Enter) is unchanged.
3. **Opponent-getting-ready screen** (`renderWaiting` / `renderBotPlacing`, view `'botplace'`) —
   **in MP this is no longer a dead end (2026-08-11).** Matt's screenshot of multiplayer failing was
   exactly this screen, frozen on "Waiting for Anita Bonita…" — a name belonging to a COMPUTER
   opponent configured on the profile page, because `_identity()` fell back to `profile.opponents[0]`
   whenever the room had not yet said who joined. It never does that in MP now; until the room
   reports a real person it says "Opponent". The screen also carries the ROOM CODE (so a stuck
   player can compare it against the other phone) and a **Leave** button, and `_mpOnRoomUpdate`
   repaints it the moment `mp.opp` is first learned, instead of leaving its one initial guess up for
   the rest of the match.

   enemy waters empty and dark on top, the line "Bot is placing ships", and the bot's fleet below
   in THEIR blue as loose silhouettes **on a deck, never on a board** (showing where they sit would
   hand the player the game). Two seconds, skippable by a tap. In MP the same screen renders
   "Waiting for {opponent}", driven by the **existing** ready handshake (`mp.localReady` /
   `_maybeStartBattle`) — no second handshake was invented, and no `_mp*` method was touched.
4. **Battle screen** (`renderBattle`) — the sandwich above, full-bleed, both boards the SAME size
   (see "The battle screen is full-bleed" below). The fleet strip between them carries both fleets
   as small silhouettes (theirs blue, yours coral, via a per-row `--bs-ship`), each struck through
   when sunk, with the sunk score in a white disc at one end and EXIT in a white disc at the other.
   Your own ships show on your board as faint ghosts so incoming fire can be seen landing on them;
   the enemy board still shows a ship only once it is sunk.

### The cannon (rebuilt 2026-08-08 against Matt's own screenshots of the reference)

**It is seen from directly above.** A fat black ring base with the OWNER's colour banded inside
it, a stubby grey barrel lying across the middle with a bright highlight down one side, and a
black muzzle collar around a dark bore at the tip. No wheels, no carriage, no side-on silhouette.
Think gun turret photographed from a helicopter, not a field gun in a museum.

**Each side's cannon stands on its OWN board and fires across at the other one.** Yours is
red-ringed (`--bs-cannon-mine`) on your deck pointing north; theirs is blue-ringed
(`--bs-cannon-theirs`) on their water pointing south. It rotates to point at the cell being fired
at (`_aimCannons`, which measures the real geometry between the cannon's pivot and the target cell
from the DOM, because the two boards are separate elements and nothing in CSS knows how far apart
they ended up), recoils, and throws a cannonball that crosses the whole screen.

Three nested elements, and the nesting is load-bearing (`_cannonHtml`):

| Element | Does |
|---|---|
| `.bs-cannon` | positions, and casts the drop shadow. Only ever TRANSLATED, so the shadow keeps falling the same way whichever way the barrel points |
| `.bs-cannon-aim` | the rotation, about the base centre (`transform-origin: 50% 50%`, matching the SVG) |
| `.bs-cannon-rig` | the recoil -- a plain `translateY`, which INSIDE the rotation is a shove straight back along the barrel |

**Exactly one cannon is on screen at a time**, decided once per render by `_resolveCannons()`
rather than by each board working it out for itself (which is how you end up with both):
a shot whose recoil has not played yet puts up the SHOOTER's cannon and arms `_fxPending`;
otherwise the bot's aiming beat puts up theirs with the "Bot thinking" pill; otherwise a settling
shot keeps the shooter's cannon up; otherwise it is the cannon of whoever's turn it is, idle and
still pointing where that side last fired (`_aimBySide` -- a gun does not snap back to north).
The recoil is gated by `_cannonPlayed` for exactly the reason the sink reveal is gated by
`_sinkPlayed`: `_lastShot` survives several re-renders and an ungated CSS `animation:` replays on
every one of them.

**The bot fires on TWO timers, not one** (`_afterStateChange`). The first waits out the shot that
just rendered, so the player's own shell finishes its flight with the player's own cannon still on
screen; only then does `_botAiming` go true, the bot's cannon come up on its own water, and a
think-beat later the shot go off. Firing straight out of a single timer meant the bot's gun never
appeared before the shot it fired.

### The shot: ball, smoke, splash

`_playShotFx` throws the ball imperatively (Web Animations) into `.bs-fx`, an overlay spanning
BOTH boards -- the whole point of a shot is that it crosses between them, so it cannot live inside
either. It launches from the muzzle at whatever angle the barrel is currently at, lands dead
centre on the target cell, and leaves a puff of white smoke behind it. It is purely decorative:
under `prefers-reduced-motion`, or if anything it needs is missing, it does nothing at all and the
shot still resolves.

**`FLY_MS` is the one knob for the whole sequence and it is 850ms.** It started at 340ms and Matt
could not see the ball move at all -- across a whole phone screen that is a blink. `renderBattle`
pushes it into CSS as `--bs-fly` rather than the stylesheet keeping a second copy, so the impact
delay, the reticle fade and `_shotSettleMs`'s pacing all follow from changing this one number.
Two things that must move with it:

- **Reduced motion needs `--bs-fly: 0ms` set INLINE**, which is what `renderBattle` does. An
  inline custom property beats any stylesheet rule, so leaving the real value in would hold every
  impact back by most of a second with no ball in the air to explain the wait.
- The ball travels at **constant speed** (`easing: 'linear'`, keyframes evenly spaced along the
  path). A ball that accelerates or brakes mid-air reads as a glitch, not as a shot. The SCALE is
  what sells the arc: in a top-down view "up" is "bigger", so it swells out of the muzzle (0.55),
  rides large across the middle (1.36) and shrinks as it drops onto the cell (0.78).

**The impact is held back by exactly the flight time.** `--bs-fly` delays every animation on the
target cell's peg (`.bs-peg.is-late`), so the splash happens when the ball ARRIVES rather than
before it has left the barrel, and `_shotSettleMs` adds `FLY_MS` to the window a shot owns before
the next re-render. `.bs-peg:not(.is-late)` kills the entrance animation outright: a settled cell
outlives many re-renders, and re-dropping every marker on each one read as the board twitching.

Miss = a cross scored into the water (the reference's own mark, and a stronger SHAPE contrast
against a filled hit marker than the hollow ring it replaced -- Matt is red/green colorblind, so
the silhouette has to carry it) plus a burst of white bubbles. Hit = an impact flash and a filled
marker with a rotated-square burst outline. Sunk = the ship reveals in its owner's colour and
settles under the waterline. **The old arcing-projectile model is gone**: `.bs-ordnance`,
`.bs-ordnance-shadow`, `.bs-plume`, `.bs-speck`, `.bs-fireball`, `.bs-shockwave`, `.bs-radar` and
their keyframes were deleted outright rather than left alongside the cannon.

**One implementation trap worth keeping written down**: the cannonball's black iron rim is a
`box-shadow` spread set in px from `_playShotFx`, not in CSS. A percentage is not a valid
box-shadow length, and writing `max(3px, 9%)` there dropped the whole declaration silently -- the
ball rendered rimless and nothing anywhere reported a problem.

### History, so a future session does not re-walk this path

First cut: 2.1 cells, fused with a permanent `--bs-gold` reticle, and the battle screen needed
scrolling to see past it. Second: shrunk to 1.25 cells and gated to vanish after the settle window
-- Matt corrected that directly, the reference cannon is scenery sitting on the water, not a
one-frame muzzle flash. Third (2026-08-08): 1.7 cells, a wheeled side-view field gun with a
carriage and visible wheels, drawn on the board being fired AT. **Matt sent screenshots of the
actual reference and the answer was that this was still nowhere near.** It never was a side view;
it is top-down, it belongs to the shooter and stands on the shooter's own board, and the shot is a
visible iron ball crossing from one board to the other. The lesson, stated plainly: three rounds
were spent adjusting the SIZE and the PERSISTENCE of a drawing whose whole viewing angle was
wrong, because nobody had looked at the reference. Look at the picture first.

### The battle screen is full-bleed

The reference's identity is two edge-to-edge boards sandwiching a fleet strip, so the shell drops
its gutter (`.bs-shell-battle`) and `_bleedToEdges()` pulls the game out to all four screen edges.
In the hub that means `.hub-main`'s 16px sides, its 40px bottom, and the ~98px of top clearance the
floating back button needs; the standalone page has none of it. All of it is **measured, not
assumed**, so neither host is hard-coded and neither ends up with a band of hub grey where the
reference has continuous deck. Sideways it is negative margins, capped at 560px total so a
desktop window does not stretch the game across the whole screen. Vertically it is negative margin
PLUS matching padding, so the background reaches the edge while the content stays put and the page
height is unchanged.

**Both measurements are taken off something the correction does not move** -- the host's content
box for the sides, the shell for top and bottom. Reading the root's own box back would see the
previous pass's correction, compute zero, and undo itself on every second render. That happened
once during this work and the symptom (the sides silently reverting while top and bottom held) is
worth recognising.

Between the boards, the fleet strip carries the sunk score in a white disc at one end and EXIT in
a white disc at the other, both half off the screen edge, exactly where the reference puts them.
**The bright half of the screen is the half being SHOT AT** -- board wash, frame wash and roster
row all key off it. That is deliberately not "whose turn is it": while your own shell is still in
the air the turn has already passed, and washing out your target board underneath your own shot
was exactly backwards.

### THE CLASS-NAMESPACE RULE (do not relax this)

**A decorative/animated class must never share a name with a structural/layout one.** `.bs-shell`
was once both the root layout container AND a flying shell whose animation ends at `opacity: 0`
(and `display: none` under reduced motion): the entire game rendered invisible, twice, with
perfect HTML and no failing test. Ornaments live in their own namespace (`.bs-cannon`,
`.bs-cannon-pill`, `.bs-bubble`, `.bs-splash-ring`, `.bs-flash`, `.bs-smoke`) and never take a
layout name. `node test-game-conventions.mjs` fails the build on this exact shape.

Two related rules the same incident bought:

- **Every animation needs a `prefers-reduced-motion: reduce` branch that is an instant state
  change, and it must NEVER `display: none` anything structural.** The reduced-motion block settles
  each element to its final pose instead.
- **A passing test suite is not a rendered screen.** This redesign's definition of done was
  screenshots of all six screens (mode, deploy mid-drag with a valid AND an invalid ghost,
  bot-placing, battle, miss/hit/sink, win overlay) at 390x844, looked at, in three conditions:
  normal, `reducedMotion: 'reduce'` (headless Chromium's default, and the setting that hid the
  whole game last time), and dark. A painted-element count over `.bs-root *` guards the "it is in
  the DOM but invisible" failure that a `innerHTML.length` assertion cannot see. That pass caught a
  real regression while it ran: `.bs-board-place { width: min(100%, ...) }` inside a shrink-to-fit
  wrap resolved to ZERO and collapsed the whole placement board, with every node still in the DOM.

### Sizing: `--bs-cell`, `--bs-pad`, `--bs-gap`, per board

`_updateCellSize()` sets all three **on each `.bs-board`**, measured from two real rendered cells
(and the board's own padding box), never computed from the board's width and grid size — that
arithmetic duplicates the CSS by hand and drifts. `--bs-cell` is the cell-to-cell STEP, so a sprite
spanning `len` cells (`len * --bs-cell - --bs-gap`) lands exactly on the grid instead of falling
short by (len-1) gaps. They stay per-board because the battle screen's two boards are different
widths; a single root-level value drew the small board's ships at the large board's scale.

### `_fitBattleBoards()` — the battle screen must fit ONE viewport, measured, not guessed

The battle screen is "fixed, no page scroll." The first cut sized the two boards with static CSS
ceilings (`min(90vw, 42vh, 420px)` for enemy, `min(64vw, 30vh, 300px)` for your own) as if the
boards were the only thing on the page. They aren't: the hub's own immersive floating-back-button
padding, the status line, the fleet strip and the actions row all eat real vertical space those
formulas knew nothing about, so on a real device the bottom of your own board scrolled off screen.

It measures instead. Every non-board child of `.bs-battle` is read at its REAL rendered height,
plus each panel's own frame padding, plus the grid's row gaps; that comes off the real viewport
height available below `.bs-battle`'s own top, and what is left is **split equally between the two
boards** (they are equals in the reference, not a big one and a little one), capped at 460px and
at the viewport width. It sets `style.width` directly on each `.bs-board`, which wins over the
stylesheet by construction.

Three traps it has already fallen into, all of them fixed and all of them silent:

- **Out-of-flow children must be skipped.** `.bs-fx` is `position: absolute; inset: 0`, so its box
  is the FULL height of the screen; counting it as consumed space collapsed both boards to their
  minimum the moment it appeared. Anything `absolute` or `fixed` (the sunk banner too) is skipped.
- **Host chrome BELOW the game is invisible from inside it.** In the hub that is `.hub-main`'s 40px
  of bottom padding, which is why the screen fitted exactly standalone and hung 40px off the bottom
  once mounted in the hub. Rather than hard-code the host's padding, it measures the overflow that
  actually resulted (`scrollHeight - viewport`) and takes it off both boards once. Idempotent: a
  re-run measures no overflow and changes nothing.
- **`window.innerWidth` includes the scrollbar**; `document.documentElement.clientWidth` does not.

Verified with Playwright at 393×852 standalone AND mounted in the real hub
(`document.documentElement.scrollHeight <= window.innerHeight`) across a full battle to game-end,
in normal, `prefers-reduced-motion: reduce`, and dark mode.

## Visual design (pre-redesign history, kept for the reasoning)

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

**The hull silhouette got a real redraw (2026-08-08)** after Matt reported the ships "don't look
like anything at all." `hull()`'s path used a shallow taper starting at the very tip, which at tray
scale (16px) and even at in-cell scale read as a plain rounded pill with a barely-visible dogear,
not a boat. The bow taper now starts at 78% of the hull's length (a real triangular point, not a
clipped corner), `.bs-ship-hull` carries a visible dark outline (`stroke: rgba(0,0,0,.38)`, absent
before — the single biggest legibility fix, since a ship's fill color sits close in hue to its own
board: coral-on-salmon for your own fleet, blue-on-navy for theirs), and every hull now carries a
full-length `bs-ship-waterline` stripe (a lighter line following the hull's own taper) so the
silhouette reads as a hull with a deck edge instead of a flat color patch. Turret/deck details were
also enlarged and given more contrast (Battleship's forward turret gained a visible bore hole,
Cruiser's turrets moved further apart). Submarine is intentionally still closest to a plain shape —
per its own long-standing rule, no turrets is the one cue that must never be confused with a
surface combatant.

**EXIT moved from a floating circle to a normal top-right pill (2026-08-08).** It used to be a lone
54px circle pinned to the board's right edge with its label spelled top-to-bottom
(`writing-mode: vertical-rl`) — Matt called it "a strange and bad location" with a poorly-written
label, and he was right: nothing else in this game (or the hub) puts a control there, and vertical
text reads as decoration before it reads as a button. It now lives inside `.bs-headerpanel`'s own
top-right corner as a plain horizontal `‹ Exit` pill, the same visual language as the hub's own
`‹ Hub` back button (`css/hub.css`) — deliberately on the RIGHT so the two floating pills (hub's
top-LEFT, this one top-right) never collide.

**Board sizing during placement now protects against a real mobile-Safari class of bug: the
dynamic toolbar.** Matt reported "everything shifts when I select a boat to drag around." The
placement board's width was `min(100%, 44vh, 400px)` — plain `vh` on iOS Safari tracks the LARGE
viewport (toolbar hidden), and the toolbar can hide or show mid-gesture, including from the touch
interaction of picking up a ship to drag it. That would resize the board (and shift every element
below/around it) for no reason the player did anything to directly cause. Every `vh`-based board
formula in this file (`.bs-board-place`, `.bs-wait-board`, both `.bs-boardpanel-*` battle formulas)
now has an `@supports (height: 1svh)` override to `svh` — the SMALL viewport, pinned to
toolbar-visible size, immune to the toolbar animating. Plain `vh` stays as the fallback for
browsers without `svh` support. Unverified on a real iOS device (no browser access in this cloud
session) but a well-documented mobile Safari behavior class, and a strict improvement regardless.

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

**The whole screen went blank shortly after the polish pass above shipped** (2026-08-04, later the
same day): `.bs-shell` was two different things — the root layout container (`display: grid`,
present from `mount()` onward) AND the new flying-ordnance projectile, whose travel animation ends
at `opacity: 0` with `animation-fill-mode: both`. Any element matching `.bs-shell` ran that
animation, including the layout container itself, so the whole UI faded to invisible on first
paint (immediately under `prefers-reduced-motion`, which set `display: none` on it outright). The
projectile is `.bs-ordnance` now, never `.bs-shell`; `test-game-conventions.mjs` gained a
regression check ("no class is both a layout container and something decoration hides") that
fails on this exact shape in any game, not just this one. The lesson that check encodes: a DOM
byte-count assertion (`innerHTML.length`) is not a visibility assertion — it was checked here and
still missed the bug, because collapsed-to-zero-opacity HTML is still HTML.

**A second fix pass** (2026-08-05, `HANDOFF-BATTLESHIP-REDESIGN.md`'s six numbered bugs) landed
once the blank-screen fix was on `main`:

- **Turn pacing.** The bot fired after only `_aiThinkMs()` (300-600ms) — far shorter than the
  ~1.15-2.05s travel/impact/sink sequence above, so the bot's re-render was cutting the player's
  own shot off mid-animation, and the reverse on the way back. `_shotSettleMs(shot)` bounds how
  long a just-rendered shot needs before the NEXT re-render is safe to happen (longer if it sank a
  ship); `_settleThenIdle()` holds `busy` (which gates `fireAt`/the fire buttons) through that
  window on both sides of an exchange, not just before the bot's own shot.
- **Ship sizing/scale.** `--bs-cell` was computed as `boardWidth / gridSize`, which has to
  duplicate the board's own `padding`/`gap` CSS by hand and silently drifts the moment either
  changes — ships rendered 1-2 squares oversized. It's now measured from an actual rendered
  `.bs-cell`'s own box, per board (the battle screen's two boards are different widths, so a
  single value on `.bs-root` also drew the small board's ships at the large board's scale — fixed
  the same day as the blank-screen bug, independently of this pass; `_updateCellSize()` now sets
  the variable on each `.bs-board` from a cell inside THAT board, plus once more on the root for
  the roster silhouettes, which sit outside both boards).
- **Sink animation playing twice.** `_lastShot` stays pointed at the same sunk shot across every
  re-render until the next shot fires — including the sunk banner's own 1600ms auto-clear
  re-render — so a plain "is this the last shot" gate replayed the reveal on a freshly-built DOM
  element each time. `_sinkPlayed` (a `Set` of `"seat:shipId"`) marks a sink reveal played and
  gates `_shouldPlaySink` from ever replaying it; reset alongside `_sunkShips` at every point a
  fresh game starts.
- **Rotation control.** The old bare "⟳" was a `bs-link` with an ~8px hit area. `.bs-rotate-btn` is
  a dedicated 44x44 circular button; its icon plays a one-tap 180° spin — gated the same way as
  the sink fix (`_justRotatedShip`, consumed once by the very next `renderPlacement()`) so an
  unconditional CSS `animation:` doesn't replay on every unrelated re-render (a drag move, another
  ship's placement) the way it would if simply attached to the icon's class.
- **Drag-and-drop placement.** `onPointerMove` resolved the cell under the pointer via
  `document.elementFromPoint`, which is unreliable under an active `setPointerCapture` on several
  mobile browsers — it can keep resolving to the capturing element (the ship chip) for every
  pointer position, so a real drag gesture never found a target cell and silently fell back to the
  separate tap-a-cell path, which read as "click to place" even though the drag code was present
  and exercised. `_cellAtPoint(clientX, clientY)` computes the target cell directly from the
  pointer's own coordinates against the board's `getBoundingClientRect()`, sidestepping hit-testing
  (and its capture quirks) entirely.

None of the above touches `game.js`, `hash.js`, or any `_mp*` method — see the multiplayer
boundary note below; every one of these is either purely local UI state or a shared, non-MP helper
(`_shotSettleMs`/`_settleThenIdle` gate local rendering only, not the wire protocol).

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

**Status: proven headlessly against `FakeRoom`, AND played end to end twice in real browsers
against a fake RTDB; no real Firebase room has ever been created.** A cloud session cannot reach
Firebase or even gstatic — same honest caveat Tic Tac Toe, Pool, Boggle and Chinchón's N-seat work
all carry. Real-room behaviour, including the `bonusShotOnHit` chain's latency under real network
conditions, is unverified until a local-device pass runs.

### The harness that finally played a real match (2026-08-11)

Matt: *"MP doesn't work AT ALL."* `FakeRoom` proves the protocol; it cannot prove the SCREENS, and
every defect found that day was in the screens or in the lifecycle around them. What it took was
**two real `battleship/` instances in two same-origin iframes, with `js/firebase-boot.js` swapped
out by a Playwright route for a ~30-line fake RTDB** (`ref`/`get`/`set`/`update`/`onValue`/
`runTransaction` over a plain object held in the parent frame). Everything above that line is the
shipped code: `js/net.js`, `js/ui.js`, the whole MP glue, real DOM, real clicks.

It is worth rebuilding rather than reasoning about, because it caught things nothing else could:
the sunk banner eating taps, the waiting screen's dead end, and a full 190-shot match agreeing on
both screens. Same-origin iframes share `localStorage`, so both sides end up with ONE profile —
fine for protocol work, misleading if you are reading names off the screen.

### The recovery deadlock (fixed 2026-08-11) — `_mpStateSeq`

This file used to record BS2 as having "an intermittent timeout, ~1 in 3 to 1 in 6, that passes in
isolation." **It was not flaky. It was a real deadlock, reproducible 4 runs in 6 once the timeout
printed the two sides' state instead of just failing.**

A shooter reserves its seq in `_mpFireAt` **before anything about the public state changes** — only
the defender's answer changes it. So a device with a shot in the air has `appliedSeq` one AHEAD of
the last entry its `state` actually reflects. The host answered a recovery request with
`net.writeRecovery(code, mp.appliedSeq, snapshot)`, and if it had fired in the window between the
guest's request and its own reply — a window as wide as the round trip on real phones — the
snapshot said "I am at seq N" while carrying a state that did not include seq N. The guest adopted
N, so it **skipped the host's shot without ever running the `k:'s'` branch**: never resolved it
against its own fleet, never published an answer. The host then waited for that answer forever.

No error, no busy-loop, no failed hash: both boards simply stopped. That is what "MP doesn't work"
looks like from the sofa.

Three parts to the fix, all of them mirrored into `test-mp-lockstep.mjs`'s `BattleshipSide`:

- **`_mpStateSeq()`** — `pendingShot ? appliedSeq - 1 : appliedSeq`, the highest seq the public
  state truly reflects. It is what a recovery snapshot publishes now. Any future code that answers
  "where am I in the log" for someone ELSE to sync to must use this, not `appliedSeq`.
- **`_mpOnDivergence`'s host branch clears `pendingShot`.** The rejected entry is consumed and never
  applied, so a shot whose answer was just thrown away is not outstanding any more — leaving it set
  reached the same deadlock from the other side.
- **`_mpApplyRecovery` re-derives `lastShotSeat`/`lastShotRC` from the move log** (from the entry at
  the recovered seq, if it is a shot) instead of carrying across whatever they were before the
  jump. A stale pair rejects the next perfectly good answer and bounces straight into another
  recovery.

BS2 has been green for eight consecutive full runs of the suite since.

### Nothing in the lobby may wait forever (`_withNetTimeout`, 2026-08-11)

**Firebase RTDB reads and writes do not REJECT when the device cannot reach the server — they
simply never settle.** So `await net.createRoom(...)` on a phone with a bad signal left "Creating
room…" spinning indefinitely, with no error, no retry and nothing to tap but Back. Every lobby
round trip (create, join, and the guest's restore) is raced against `MP_NET_TIMEOUT_MS` (12s) now
and falls back to the ordinary offline error. A late reply is harmless — the room is abandoned to
its TTL, exactly as if the app had been closed at that moment.

The restore path has its own version of the same problem and its own watchdog: `net.init()`
succeeding proves Firebase is reachable, **not** that this room still exists. A room that ended or
aged past its TTL reads back as `null`, and `_mpOnRoomUpdate` returns early on a null room, so the
device sat waiting on an opponent who was never coming. `_tryRestoreMP` now arms `mp.restoreProbe`
plus a timer; the first real room snapshot disarms it, and if none arrives the save is cleared and
the player gets their setup screen back. Cleared in `destroy()` like every other timer here.

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
