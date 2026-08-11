# Yahtzee (`yahtzee/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`,
> which is always loaded alongside this file (full rule rationale: `js/CLAUDE.md`).

A pixel-exact reproduction of a mobile Yahtzee UI, built from a standalone spec
(`BUILD_INSTRUCTIONS.md` / `YAHTZEE_CLONE_SPEC.md` at the repo root, plus the reference images
`yahtzee.png` / `yahtzee_ref_409x729.png`, still at the repo root) across three phases: a diffed static reference frame,
full game logic, then the full animation spec. Originally built and verified as a fully
self-contained `yahtzee-clone/index.html`, then wired into the hub as a proper module
(2026-07-28, Matt: "Wire it into the hub launcher now. ALWAYS" — see the root memory file this
session wrote, `always-wire-new-games-into-hub`, for the standing instruction that produced this).

Hub integration: in-hub `module:` (`yahtzee/js/ui.js`), **immersive** — the game draws its own
full-bleed header/scorecard/dice chrome exactly like Escoba/Mancala/Ball Run, so the hub's own
header row is wasted space while it's mounted. `isInProgress()` uses the **"no mid-game resume"**
literal meaning (same class as Ball Run/Snake, not the autosave/resume convention every other
module game follows): `true` once any roll has happened or any category has been filled, `false`
once the game reaches `gameOver` or hasn't started. **There is no save/resume key** — leaving
mid-game is a real abandonment, matching Ball Run's reasoning that a live-action/in-progress round
can't meaningfully pause across a hub navigation. If autosave/resume is ever added here, add a
`gamehub.yahtzee.save.v1` key and update this line — don't leave the next session to guess (per the
root CLAUDE.md's explicit instruction for this decision).

## Full-bleed sizing (position:fixed, not flowed)

`.yz-root` is `position:fixed; inset:0; height:100dvh`, exactly the pattern `ball-run/css/
ball-run.css` documents: the hub's own `.hub-main` is a padded, `max-width:720px` box, so a game
that needs true edge-to-edge full-bleed (this one's fixed 410×730 stage, centered and scaled to
fit) has to escape it via `position:fixed` rather than trying to fill a flowed container. This is
also why the game measures `window.innerWidth`/`innerHeight` for its own fit-scale (`fitStage()`
in `js/ui.js`) rather than the mounted container's box — the root already **is** the viewport.

## CSS scoping

Every rule is descendant-scoped under `.yz-root` with every class and custom property `yz-`
prefixed (`css/yahtzee.css`), following the "Adding a game" checklist's CSS-scoping axis
(Mancala's discipline, not Connect Four's prefix-only shortcut). One deliberate exception: the
internal data tag `'house'` (used in `RIGHT_ICON_KIND`/`rightIcon()`'s `kind` switch, unrelated to
CSS) happens to share a word with the CSS class for that icon's shape — the class is `.yz-house`,
the data tag stays the bare string `'house'`; they were kept from colliding by hand during the
rename, not by any structural guard, so don't assume every occurrence of the word "house" in this
file's JS is a class name.

## Module lifecycle (`js/ui.js`)

Ids inside the mounted markup (`#stage`, `#pod1`, `#scorecard`, `#rollBtn`, …) are **not**
`yz`-prefixed, unlike classes — confirmed collision-free against the rest of the hub shell (no
`js/*.js` or root `*.html` file uses any of them), and safe because of the same single-instance
invariant every module game relies on: `init()` always tears down any prior instance first, and
`destroy()` clears the container's `innerHTML`, so the ids never coexist with a second copy of
themselves.

`destroy()` is leak-free by construction, not by convention alone — verified with a dedicated
Playwright test that destroys the game mid-AI-turn (async chain + pending `setTimeout`s +
in-flight WAAPI animations all live) and confirms zero errors fire afterward:
- Every `setTimeout` used for game pacing goes through a tracked `scheduleTimeout()` helper;
  `destroy()` clears every pending id. Any in-flight `await wait(ms)` inside `aiTakeTurn`/`doRoll`
  simply never resolves once its underlying timer is cleared, which quietly halts that async
  chain without needing an explicit `destroyed` check at every `await` (a few are still there as
  belt-and-suspenders, since WAAPI-driven resumption points aren't timer-gated).
- Every `requestAnimationFrame` loop (the header count-up ticker, the confetti physics loop) goes
  through a tracked `scheduleFrame()` helper for the same reason.
- The one `window`-level listener (`resize` → `fitStage`) is stored and explicitly removed in
  `destroy()` — everything else is scoped to elements the container removal already discards.
- `window.__yzTest` (the dev/test seam, see below) is deleted on `destroy()` so a torn-down
  instance can't be driven by a stale reference.

## Dev/test seam — `window.__yzTest`

Not part of the visible game; no UI references it. Sets `init()`-time so it always matches the
live instance. Lets Playwright drive deterministic rounds (`forceDice([...])` bypasses real
randomness/animation) to assert scoring math and full-game flow headlessly, and exposes `render`
so a test can force a synchronous re-render after mutating `getState()` directly. The verification
scripts that exercise it aren't checked into this repo (built ad hoc during the build phases); the
seam itself is small and harmless enough to leave in permanently rather than strip for shipping,
same spirit as any other in-repo dev-only hook.

## HOW TO PLAY, and the two features it turned up (2026-08-11)

Matt uploaded six iPhone screen recordings to `reference/yahtzee/` (`Yahtzee how to 1..6.MOV`,
one per page of a mobile Yatzy game's tutorial) and said: *"Clone the how to pages. Exactly.
Animations included. If our game doesn't include anything in the how to (bonus, symbol
explanations, etc), build that and add it to our game as well."*

How to actually watch a `.MOV` is in `reference/README.md`, which applies to every game.

### `js/howto.js` — the carousel

A separate module, not more `ui.js`. Six pages, the reference's own order and wording, a dark
rounded modal over a white card over a salmon illustration panel, six dots, and a
`[|◀] [ OK ] [▶|]` footer whose end arrows grey out at each end of the run. Mounted **on the
persistent `.yz-root`, not inside `#screenHost`** — screenHost's `innerHTML` is replaced wholesale
on every setup↔game swap, and a sheet mounted in there would be destroyed mid-read.

Each page runs its own timeline: a pointing hand travels to a control and taps it, and the little
board reacts. `resetBoard()` wipes every page-specific mark first, so a page always starts from the
same board no matter what ran before it. Under `prefers-reduced-motion` each page instead paints a
STILL, informative pose (dice rolled / held / committed / tooltip open / bonus earned) — never a
blank panel, per the repo-wide rule that a reduced-motion branch is an instant state change and
never a removal.

**The one deliberate deviation from "exactly":** the reference's illustration shows the REFERENCE
app's scorecard. Ours draws OUR scorecard at the same small scale. A tutorial showing a board the
player is about to not see would teach the wrong thing. Everything else — chrome, order, captions,
choreography — is the clone.

Entry points: a **How to play** link on the setup screen, and the header **kebab** in game. The
kebab was previously three inert dots with no handler at all; it is a real `<button>` now with a
thumb-sized hit area around the same 8px dots.

`test-visual.mjs`'s `MOTION` probe for this game watches `.yz-ht-hand` travel (339px over ~6s). A
frozen hand would screenshot perfectly and teach nothing, which is precisely what a static check
cannot see.

### What the reference had that we did not — both now built

1. **The section bonus was invisible.** `upperBonus()` (63 in the upper column earns 35) has always
   been here and a "+35 BONUS!" toast fired when it landed, but the card never showed the target or
   how close either player was — the one thing worth playing the upper column FOR could not be seen
   until it was already won. It now sits in row 7's left half, the one cell on this card that was
   empty (six upper categories, seven rows), and follows the card's own box-vs-numeral contract:
   the pill in the box column is the local viewer's progress, the one in the numeral column is the
   opponent's.
   **Earned is green with a tick, not gold.** Gold was the first attempt and it was invisible — the
   card underneath is already gold. Three cues, only one of them colour, per the colourblind rule.
2. **Nothing said what the symbols meant.** Seven red pictograms (`3x`, `4x`, a house, two card
   fans, a star, a question mark) with no explanation anywhere in the game; a player who did not
   already know Yahtzee could not find out from inside it. **Hold a category symbol for 320ms** and
   the board dims and a popover names the combo and its score (`CAT_INFO`, `showCatInfo`). The
   reference opens this on press and closes on release; a pure press-and-hold could not work here
   because the same icons are also how you PICK a category, so a short tap still selects exactly as
   before and a hold that fired suppresses the click that follows it. No existing behaviour changed,
   which is why no existing test needed touching.

Both are wired through the game's own delegated listeners on `.yz-root` (pointerdown/up/cancel/
leave), never `document`, and all four come off in `destroy()` alongside the hold timer.

### i18n — the whole game, finally (2026-08-11)

Matt, straight after the carousel shipped: *"confirm that these instructions display in Spanish
too. Everything must also work in Spanish."* They did not — **not one string in this game
translated.** Yahtzee had shipped with no i18n at all and had been
`test-game-conventions.mjs`'s one standing `KNOWN_GAPS` entry ever since.

`js/strings.js` now covers **all 68 keys**: setup, lobby, every MP error and status, player names,
game-over, the section-bonus label, the combo-info popover and all six how-to captions. **That
entry is gone from `KNOWN_GAPS`, which is now empty — every in-hub game is translated.** (A stale
entry fails that suite, so translating without clearing it would have gone red.)

Two traps worth knowing, both hit here:

- **`GAME_MARKUP` had to become `gameMarkup()`.** It was a module-scope template literal; the
  moment it carried `t()` calls it would have frozen the board in whichever language loaded first.
  That is exactly the "call t() at RENDER time" rule in `js/CLAUDE.md`, and a `const` template is
  the easiest way to break it without noticing.
- **`CAT_INFO` became `catInfo(cat)`** for the same reason, deriving name and score from the key
  rather than a frozen table.

`onLangChange` re-renders whichever screen is up, and `howTo.relabel()` updates the sheet in place
if it is open (rebuilding it would throw away the running timeline). Both unsubscribe in
`destroy()`.

Not translated on purpose: **Yahtzee** itself (a proper noun in both languages, same rule the repo
applies to card-suit and figure names), and the ROLL/PLAY/SMALL/LARGE faces, which are drawn
artwork from the original pixel clone rather than text this game sets.

Verified in the browser with `gamehub.lang.v1` set to `es`: setup reads *Vs Computadora / Crear
Partida / Unirse / Jugar / Cómo se juega*, the sheet reads *CÓMO SE JUEGA* over *"Lanza los dados
al empezar cada turno"*, the pods read *Tú* and *Computadora*, and holding the house symbol gives
*Full — Puntos: 25*. The longer Spanish bonus label (*BONO DE SECCIÓN*) was measured rather than
eyeballed: 52px, no overflow, no collision with the progress pill.

## Game engine notes

- **Shared two-player scorecard, not a preview column**: the cream box always holds the viewer's
  (`state.players[0]`) committed score; the bare numeral to its right always holds
  `state.players[1]`'s committed score for the same category — verified in the original build
  phases (P1 box sum and P2 numeral sum must equal the header totals) and preserved through the
  hub-module rewrite (`renderScorecard()`'s `cell()` never swaps which slot either player's data
  renders into, regardless of whose turn it is).
- **Joker rule**: `availableCategories()` forces the matching upper box as the ONLY legal category
  when the current roll is a Yahtzee and the yahtzee box already holds 50 (a bonus situation) and
  that upper box is still open; once it's filled, joker opens the remaining lower categories at
  full value. `previewScore()` mirrors the same branching so the ghost preview a player sees always
  matches what committing would actually score.
- **AI** (`aiChooseHolds`/`pickCategoryForAI`) is a simple greedy heuristic: hold the largest
  matching group, or a 4-run toward a straight if one exists; after up to 3 rolls, pick the
  highest-scoring open category, breaking ties toward the lower section. `MODE` is a single
  top-of-file constant (`'ai'` | `'hotseat'`), same pattern as the spec called for — no UI toggle
  exists for it yet.

## Settings / persistence

None yet. `MODE` is a hardcoded constant, not a saved preference; there is no settings screen. If
one is added, use `gamehub.yahtzee.v1` per the standard convention (root CLAUDE.md item 4).

## Multiplayer (2026-07-28)

Shipped. Two human seats over the shared `js/net.js` room protocol (`gamehub.tictactoe.mp.v1`-
style conventions, `js/CLAUDE.md`'s "third consumer" section), adapted to this game's roll/hold/
commit turn shape. `js/net.js` itself is untouched. Deliberately **simpler** than the reference
games in two stated ways:

1. **No in-room rematch series** (Pool's precedent, `js/CLAUDE.md`'s "seventh consumer"): one game
   per room. A rematch is a fresh room — `room.round.n` is always `1`.
2. **No autosave/rejoin window.** `destroy()` while an MP room is live always calls
   `net.leaveRoom()`, ending the room for both sides, rather than persisting a save to rejoin
   later. This applies to ANY teardown, including the hub's own back-navigation — unlike Tic Tac
   Toe/Chinchón/Escoba, which deliberately do NOT abandon a room on ordinary hub navigation (their
   30-minute rejoin window depends on that). Simpler and more honest than a half-abandoned room
   with no UI to rejoin it, but a real capability gap if that's ever wanted later.

**Setup/lobby screen** (new — this game had none before): a `view: 'setup' | 'game'` module-level
state machine. `init()` always opens on setup; `#screenHost`'s `innerHTML` swaps between the
lobby markup and the existing full game `MARKUP` template (`mountSetupScreen()` /
`mountGameScreen()`). A segmented Vs Computer / Host Online / Join Online control mirrors Tic Tac
Toe's phase-1 shape; the room-code input auto-submits at 4 characters, same as every reference
game. All setup/lobby/game input is one delegated click/input listener on the persistent `.yz-root`
(`onRootClick`/`onRootInput`), not per-element listeners, so it survives the screen swap without
re-wiring.

**Seats and rendering perspective — the part that took real design work.** Every reference game's
`_localSeat()` note assumes the engine's own state already has a "seat" concept to hang off. This
game's engine didn't: `state.players[0]`/`[1]` were built (Phase 2, solo) as **viewer-relative**
— `[0]` is always "the box column, me", `[1]` is always "the numeral column, them" — because that
is exactly what the shared two-player scorecard's box-vs-numeral contract means (see "Game engine
notes" above). For MP, both devices must hash-verify an IDENTICAL representation, which a
viewer-relative one can never be (the host's `players[0]` and the guest's `players[0]` would be
different people). The fix: `state.players[0]`/`[1]` became **ABSOLUTE** during MP — `[0]` is
always the host's data, `[1]` always the guest's, exactly like `state.dice`/`state.current` — and
`localSeat()`/`remoteSeat()` (`localSeat()` returns `state.mp.localSeat`, fixed at match start;
`0` in solo, always) are the ONLY thing that changed: every render function that used to read
`state.players[0]` for the box column and `state.players[1]` for the numeral column now reads
`state.players[localSeat()]` and `state.players[remoteSeat()]` instead. Since `localSeat()` is
always `0` outside MP, this is a no-op for solo — verified by re-running the full 42-assertion
solo suite after the change with zero regressions, and independently by the real two-device MP
test asserting each device's OWN screen renders itself in the box column and the OTHER player in
the opponent-numeral column (the exact "shared card" contract, now proven under real MP, not just
solo).

**Move vocabulary** (`net.appendMove`'s `move` payload — three types, not the single generic
"move" the board-game references use):
- `{t:'roll', dice:[v0..v4]}` — like a Pool shot's physics parameters (`js/CLAUDE.md`'s "seventh
  consumer"), a roll's dice VALUES are random, so the roller generates them locally with real
  `Math.random()` and transmits the RESULT; the peer adopts the identical values (respecting its
  own already-synced held flags) rather than trying to synchronize the RNG itself. The peer's
  screen still plays the full CSS-cube tumble animation for a remote roll, same as a local one.
- `{t:'hold', i}` — toggle hold on die `i`.
- `{t:'commit', cat}` — the category being filled. **The resulting score is never transmitted.**
  `previewScore()`/`applyCommit()` are pure functions of already-synced state (dice + both
  players' scores), so both sides compute the identical result deterministically, including the
  joker rule and bonus-Yahtzee logic — a remote-committed Yahtzee triggers the FULL celebration
  set piece on both screens, not just the committer's.
- Category selection (the ghost-preview highlight) is never synced — purely local UI state.

**Async remote delivery needs the `redeliverRequested` latch** (`js/CLAUDE.md`'s Mancala/Filler
generalization note): applying a remote `'roll'` move `await`s the full ~860ms tumble animation
before the drain loop checks for the next entry, so `mpTryDeliverNextMove()`/`mpApplyNextEntry()`
follow Mancala's pattern exactly — `mp.redeliverRequested` is set (not delivered immediately) if a
room update arrives while `mp.delivering` is already true, and drained once the current entry
finishes.

**Recovery**: same shape as every reference game — on a hash mismatch the host takes the seq and
publishes a full snapshot (`mpSnapshot()`/`applyMpSnapshot()`, absolute/seat-indexed, no
device-relative field); the guest latches (`mp.awaitingRecovery`) until that snapshot lands, per
`js/CLAUDE.md`'s explicit warning about what happens without the latch (every subsequent room
update re-delivers the same diverged entry and burns the attempt budget before the host can
answer). `MP_RECOVERY_MAX_ATTEMPTS = 3`, same as Tic Tac Toe.

**`round.dealer`** carries the ABSOLUTE seat (0 or 1) that plays first — always `0` (the host)
here, since there's no rematch series to alternate the opener across. A sixth reuse of that field,
after Tic Tac Toe (who plays X), Dots and Boxes (who opens), Pool (who breaks), Boggle
(round-start timestamp) and Filler (an rng seed via `round.deck` instead).

**Status: verified against real Firebase, two real browser contexts** (not a `FakeRoom` mock —
this game has no `test-mp-lockstep.mjs` entry yet, see Tests below). Confirmed: room
create/join/start, real random dice rolls syncing byte-identical between devices, a hold+reroll
staying in sync, category commits agreeing on score on both sides, turn passing correctly,
`localSeat()`-relative rendering (the perspective-flip described above) holding on BOTH screens
simultaneously, and the explicit Leave button ending the room and notifying the other side. Not
yet verified: the hash-mismatch/recovery path itself (never forced to diverge in testing), and
opponent-disconnect-via-heartbeat-staleness detection (no `MP_STALE_MS` UI was built — only an
explicit Leave or an opponent's own `destroy()` ends a room here, there is no passive
"opponent seems to have vanished" indicator).

**Known gaps, stated honestly:**
- No staleness/disconnect detection beyond the explicit Leave button and the other side's own
  `status:'ended'` write.
- No i18n — all lobby/setup strings are plain English literals, consistent with the base game
  (also not yet on the shared `js/i18n.js` layer). The stats screen's own strings (Won/Lost/
  Tied/Played/Yahtzees/Best score, the game title) DO go through `js/strings.js`/`t()` — see
  "Stats" below — since that infrastructure is shared with every other game, not this game's own.
- Add a `### The Nth consumer: Yahtzee` entry to `js/CLAUDE.md`'s multiplayer-lockstep section
  (per the documentation convention every prior MP game followed) — not yet done as of this note.

## Stats (2026-07-28)

Wired into the shared `js/game-stats.js` recorder (Matt: "stats should be recorded" — added
right after the MP pass above, in response to the CLAUDE.md draft calling out its own absence
as a gap). `recordYahtzee(difficulty, won, extras)`, called once per finished match from
`endTurn()` via a `commitStatsOnce()` idempotence guard (`state.statsCommitted`, same pattern
as every reference game's `_statsCommitted`) — fires for BOTH a local commit and a remote
MP commit, since every game-ending commit funnels through the same `applyCommit()` → `endTurn()`
path regardless of who made it.

- **`difficulty`** is `'ai'` (solo vs the computer) or `'mp'` (multiplayer) — this game has no
  real difficulty tiers, so both are unrecognized by `difficulty-tiers.js` and read as a
  legacy/no-pill bucket, same convention as Tic Tac Toe's `'mp'` bucket
  (`js/CLAUDE.md`'s "third consumer" section).
- **`won`** is `true`/`false`/`null` (tie) from comparing `totalScore(me)` vs `totalScore(them)` —
  a 13-round match CAN tie (equal totals), so `won: null` increments `played`+`tied` only, the
  same shape as Tic Tac Toe/Dots and Boxes/Boggle's own tie-capable recorders.
- **`extras.yahtzees`** is this game's count of Yahtzee-box scores of 50 plus every bonus
  Yahtzee (`state.yahtzeeBonusCount[localSeat()]`), added to a running total. **`extras.score`**
  is this game's final total, folded into a Math.max-only `bestScore` — per THE LAW rule 2,
  never overwritten with a lower value.
- **Each device records its own perspective independently** (`localSeat()`-relative, same as
  every other stat this game touches) — that is not double-counting; `gamehub.stats` is keyed
  per player, not per room.
- All three required edits per root `CLAUDE.md`'s "Adding a game" item 7 are done: the
  `ensureYz()`/`recordYahtzee()` writer in `js/game-stats.js`, a rendering screen in
  `js/game-stats-ui.js` (`yahtzeeScreen`, Won/Lost/Tied/Played + Yahtzees + Best score — visible
  in both My Stats and the Leaderboard's player detail, since both share `gameListHTML`/
  `screenFor`), and an explicit `g === 'yahtzee' && src.yz` branch in `js/players-agg.js` so the
  `yz` sub-counter survives a cross-device combine instead of blanking to zero — verified by a
  dedicated `players-agg.test.mjs` case (counters sum, `bestScore` takes the max, not the sum).
- `game_title_yahtzee`/`gs_yz_yahtzees`/`gs_yz_best` added to `js/strings.js` (EN+ES) —
  `test-i18n-strings.mjs` green.
- Verified: a real headless 13-round game recorded correctly to `localStorage['gamehub.stats']`
  (`total`/`byDiff.ai`/`yz` all populated, `won`/`yahtzees`/`bestScore` matching the actual game),
  and the My Stats overlay renders the drill-down screen with real numbers after seeding a fixture.

## Tests

No automated test files are checked into this repo for this game yet, WITH ONE EXCEPTION —
`players-agg.test.mjs`'s Yahtzee case above IS committed and wired into `run-all-tests.mjs`.
Everything else (scoring coverage, a full 13-round game, animation timing, `prefers-reduced-
motion`, module lifecycle/leak checks, the real two-device MP test, and the stats-recording
check described above) were run ad hoc from a scratch directory during development, not
committed. If this game gains real regression coverage, follow the pattern of
`test-mp-lockstep.mjs`/`test-stats-identity.mjs` etc. — a checked-in, `run-all-tests.mjs`-wired
suite — rather than leaving verification to a session's own scratch scripts again. A
`FakeRoom`-backed lockstep test (matching the seven reference games' own suite) would also let
the recovery/divergence path finally be exercised, which the real-Firebase pass above could not
force.
