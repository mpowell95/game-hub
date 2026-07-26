# HANDOFF — Multiplayer expansion (nine games)

**Target executor:** one dedicated session per game, Sonnet, effort noted per section below.
**This is a planning/survey document, not an implementation.** No code has been changed. It
exists so a future session can pick one game, read its section, and start immediately instead
of re-deriving the research below.

Read root `CLAUDE.md` first — THE LAW, the module contract, the games table. Then `js/CLAUDE.md`
"Multiplayer lockstep — invariants" (`js/CLAUDE.md:271`) in full before touching any game in this
doc — every fact in that section is a fix for a real regression, not defensive boilerplate.

## Scope

**In scope** — these nine games have no multiplayer today and are candidates to gain it:
Boggle, Connect Four, Dots and Boxes, Filler, Mancala, Monopoly Deal, Parchís, Tic Tac Toe, Uno.

**Explicitly out of scope, do not add multiplayer to these** (per the request that produced this
doc): Ball Run, Nuts & Bolts, Snake. Ball Run and Snake are live-action, no-turn-order runs where
mid-run resume/opponent-turn concepts don't apply; Nuts & Bolts is excluded by the same
instruction. If a future session is asked to reconsider any of the three, that's a scope change
requiring the user's sign-off, not something to infer from this doc.

**Already have it, reference implementations:** Chinchón and Escoba, via `js/net.js` +
per-game `_mp*` glue in their `ui.js`. Every game section below points back to these two.

## The `js/net.js` contract (read the file, this is a summary)

Scoped entirely to `rooms/<CODE>` in the shared `'stats'` Firebase app (`js/firebase-boot.js`).
**Strictly two roles, `host` and `guest` — no N-player array.** Room shape: `{ v, game, swv,
created, updated, status, config, host:{name,avatar,deviceId,lastSeen}, guest:null|{...}, round,
moves, recovery, result }`.

- `createRoom(game, config, me)` — retries up to 5 random 4-char codes, reclaims a code only if
  its room is >24h stale. Returns `{code}` or `{error:'busy'|'offline'}`.
- `joinRoom(code, me)` — validates freshness/version, supports **rejoin** by matching
  `deviceId`, rejects a second distinct guest with `{error:'full'}`. An "unknown" SW version on
  either side never blocks the join.
- `startRound(code, n, deckOrder, dealer)` — host-only, resets `moves`/`recovery`.
- `appendMove(code, by, seq, move, hash)` — **both sides append into the same seq-keyed log.**
  `seq` must be a shared, strictly-increasing counter both sides agree on. Each entry carries a
  state hash for post-apply verification.
- `writeResult`/`writeRecovery` — host-only. Recovery publishes a full-state snapshot after a
  hash mismatch.
- `requestRecovery`/`clearRecovery` — guest flags a mismatch; either side clears it. The guest
  has no direct push channel to the host — recovery is entirely mediated through the room doc.
- `onRoom(code, cb)` — single-subscription `onValue`; a new subscription detaches the previous
  one. Only one live listener at a time.
- `heartbeat`/`stopHeartbeat`/`leaveRoom`/`disconnect`.

**There is no built-in support for more than one guest.** Any game with more than 2 human seats
(Monopoly Deal 2-5, Parchís 2-4, Uno 2-4) needs a decision before coding — see "The N-player
question" below.

## The lockstep pattern (Chinchón/Escoba) and five invariants not to re-break

Both games' `ui.js` carry an `_mp*`-prefixed method family: `_mpHostCreate`/`_mpHostStart` build
a 2-seat `Game` (seat 0 = local human, seat 1 = a `_makeRemoteAgent()` that resolves decisions
from the incoming move log instead of prompting); `_mpJoinSubmit` is the guest-side mirror;
`_mpRoomCallback` reacts to room-document changes; `_mpApplyRecovery` rebuilds state from a
host snapshot; `_mpSaveSnapshot`/`_tryRestoreMP` persist MP-specific state under its own key
(`gamehub.chinchon.mp.v1`, `gamehub.escoba.mp.v1`-equivalent — **separate from the solo autosave
key and the frozen settings key**). Each game has its own `<game>/js/hash.js` (FNV-1a over
serialized state) checked after every applied remote move. **MP is always exactly 2 human seats
(host id 0, guest id 1), even in games that support 3-4 local players with AI filling the
rest** — MP does not extend past 2 humans in either existing game.

`js/CLAUDE.md:271` documents five invariants, each the fix for a real shipped regression, each
with an executable `[KNOWN-BUG PROBE]` assertion in `test-mp-lockstep.mjs`. Any new game's MP
glue must not re-derive these the hard way:

1. **Decide match-end before emitting the round-scored event, gated on an explicit `matchOver`
   field — never on the engine's own `winner` property.** Chinchón's `winner` is still null at
   the instant a points/rounds-based finish happens; gating on it deadlocked the guest at every
   normal match end.
2. **A transmitted recovery snapshot's `isHuman` flags are sender-relative, not
   receiver-relative** — a receiver must remap agents by fixed seat (host=0, guest=1), never
   trust the flags as-is, or recovery hands the guest's human agent to the host's seat.
3. **A "consumed queue" config field must be `shift()`-consumed, never indexed by a per-round
   counter** — index-based consumption replayed round 1's shuffle order at round 2.
4. **Autosave must happen after the same event's MP bookkeeping, not before** — saving before
   advancing `appliedSeq` leaves the saved seq one low, so every rejoin re-applies an
   already-applied move.
5. **A round-boundary snapshot (`midRound:false`) must resume via a "next round, scores kept"
   path, never a full match re-init that zeroes scores** — a restoring/recovering guest must
   await the host's freshly published round record before playing, never reuse a stale or
   locally-shuffled deck.

None of the nine games below has a `hash.js` yet, and no equivalent of
`test-mp-lockstep.mjs` exists for any of them — both are required deliverables for each game's
MP work, not optional polish.

## The N-player question — decide this once, before starting Uno, Monopoly Deal, or Parchís

`js/net.js`'s room schema has exactly one `host` and one `guest`. Three in-scope games support
more than 2 local players (Uno 2-4, Monopoly Deal 2-5, Parchís 2-4). Two paths:

- **(A) Follow precedent exactly:** MP = exactly 2 human seats regardless of the game's local
  player count; any additional seats stay AI-filled, same as Chinchón/Escoba today. Zero
  changes to `js/net.js`. Fastest, consistent with what's shipped, but caps real N-player online
  play at 2 humans indefinitely.
- **(B) Extend `js/net.js`'s protocol** to a `guests: []` array, rework the move-log/seq
  discipline for 3+ writers, add join/leave/reconnect handling per extra seat. Unlocks true
  N-player online play but is itself a substantial, repo-wide change to shared infrastructure
  that both existing games (Chinchón, Escoba) would need to stay compatible with, and has no
  precedent to copy — treat any such change as its own handoff, reviewed and approved before
  either it or a dependent game's work begins.

**Recommendation: (A) for the first pass on each game**, explicitly noted as a known limitation
in that game's own CLAUDE.md, not silently. Don't attempt (B) as a side effect of a single
game's MP handoff — it changes shared infrastructure two other games already depend on in
production.

## Recommended sequencing, by effort

| Tier | Games | Why |
|---|---|---|
| **1 — lowest effort** | Uno, Tic Tac Toe | Both: pure synchronous engine, no async agent interface, state already plain-JSON via existing `snapshot()`/save-state paths, no real-time or hidden-info complications for a 2-player cut. Uno's own CLAUDE.md already flags itself "MP-lockstep-clean by construction" and names this as the next step. |
| **2 — moderate** | Mancala, Dots and Boxes, Connect Four, Filler | Same "pure engine, vs-AI-only" shape, but each needs the human-vs-AI seat hardcoding in `ui.js` generalized to a per-seat agent abstraction (none of the four have one; Chinchón/Escoba/Uno do). Mancala is the easiest of the four — it already has a local 2-human `'friend'` hot-seat mode proving the engine/UI tolerate two human-driven seats. Dots and Boxes' chain-capture ("go again") and Connect Four's Worker-based Expert AI add design decisions but no fundamental blocker. |
| **3 — structurally different** | Boggle | Not turn-based at all — a shared-board timed sprint with independent simultaneous scoring, not a discrete move stream. Needs a different network model (synced countdown + end-of-round score reveal), not the Chinchón/Escoba move-log pattern. Don't force-fit lockstep here. |
| **4 — hardest** | Monopoly Deal, Parchís | N-player (see above), plus: Monopoly Deal has deep async/interrupt turn structure (Just Say No, targeted actions, payment negotiation) that doesn't map onto "one move, append, hash-check," real hidden information (hands) needing careful per-player views, and a non-ESM/own-nested-SW integration shape unlike every other game. Parchís's engine lives entirely **outside this repo** (`../Parchís/src/`, combined via `recombine.mjs`) so any MP work here has a build-step dependency no other game has, plus non-seedable dice rolls (`Math.random()` called directly in `d6()`, no rng injection point today). |

Work through the tiers in order; a session picking up tier 3 or 4 without tiers 1-2 shipped
first will be re-deriving lockstep discipline from scratch with a harder game as the first test
case, which is exactly backwards.

---

## Per-game sections

Each section is a starting brief, not a full spec (compare to `HANDOFF-DOTS-BOXES.md`'s depth
for a single new game — a full per-game MP spec at that depth is real follow-up work once a
session commits to a specific game). Use `chinchon/js/ui.js` and `escoba/js/ui.js`'s `_mp*`
methods as the literal template for structure; deviate only where a game's shape forces it.

### Uno — tier 1

- **Current state:** solo vs 1-3 AI, human always engine seat 0. `uno/js/game.js` has no
  `Math.random` (rng injected via constructor), a `presetDeck` hook explicitly modeled on
  Chinchón's pattern "so a future host can transmit deals deterministically," every state
  change is one explicit action method (`play(playerIndex, cardId, color?)`, `draw(playerIndex)`,
  `chooseColor(playerIndex, color)`), and the whole state is plain JSON via `snapshot()`/
  `UnoGame.fromSnapshot()`. `getLegalMoves(playerIndex)` is the single legality source read by
  both human and AI paths — the exact seam `_makeRemoteAgent()` needs.
- **Plan:** apply path (A) from the N-player question — MP is host (seat 0) + guest (seat 1),
  remaining 0-2 seats stay AI. Build `uno/js/hash.js` (copy Chinchón's FNV-1a shape over
  `snapshot()`). Add `_mpHostCreate`/`_mpJoinSubmit`/`_mpRoomCallback`/`_mpApplyRecovery`/
  `_mpSaveSnapshot` to `uno/js/ui.js`, modeled directly on Chinchón's. New save key
  `gamehub.uno.mp.v1` (separate from `gamehub.uno.save.v1` and `gamehub.uno.v1` settings).
  Direction/turn-order cards (Skip, Reverse, +2 stacking) need each remote-agent decision point
  enumerated in `getLegalMoves` — already true today, so this is verification, not new work.
- **Note in the CLAUDE.md update:** Uno's own file already says "head-to-head capture is
  MP-only and out of scope until Uno gets a multiplayer pass" — this ships that pass; wire
  head-to-head capture in the same milestone if in scope, or explicitly say it's deferred again.
- **Test:** extend `test-mp-lockstep.mjs`'s pattern with a Uno-specific mirror (or a new
  `test-mp-lockstep-uno.mjs`), including a `[KNOWN-BUG PROBE]` for each of the five invariants
  above applied to Uno's own event shape (e.g. its own "match end" signal, its own save-then-seq
  ordering).

### Tic Tac Toe — tier 1

- **Current state:** solo vs AI, Classic (3x3) and Ultimate (nested 3x3s) variants, both
  variants' state confirmed plain-JSON by its own CLAUDE.md ("stored as-is since it's already
  plain JSON-safe data"). No async agent interface — "a move has no multi-step resolution to
  pace." Human-vs-AI hardcoded in `ui.js`, no local hot-seat mode.
- **Plan:** of the four "pure engine, vs-AI-only" games, this is the simplest 2-player case —
  no chain rule, no Worker, no seeded-board generation to reason about. Generalize the seat
  assumption in `ui.js` to accept a remote agent for seat 1. Ultimate's "your move picks their
  board" needs the move payload to carry which sub-board plus meta-board resolution state, but
  nothing here breaks per-move hash verification. New `tic-tac-toe/js/hash.js`, new save key
  `gamehub.tictactoe.mp.v1`.
- **Test:** both variants need their own lockstep coverage — Ultimate's board-routing logic is
  the one place a desync could hide (the wrong sub-board unlocked on the remote side after a
  hash mismatch is exactly the kind of bug invariant #2 warns about, applied to a different
  piece of state).

### Mancala — tier 2 (easiest of the tier)

- **Current state:** vs AI (3 tiers) or **local 2-human hot-seat via `mode:'friend'`** —
  `humanTurn = this.mode === 'friend' || s.turn === P1` already proves the engine/UI tolerate
  two human-controlled seats. Deterministic engine (Kalah rules), no rng at all — no seeding
  concern. Chain "go again" rule (landing the last stone in your own store) similar in shape to
  Dots and Boxes' extra-turn rule but simpler (no capture chaining).
- **Plan:** the smallest lift in tier 2 — `'friend'` mode already answers "can the engine run
  with two human-driven seats," the only missing piece is routing seat 1's input over the
  network instead of the same device/screen. Build `mancala/js/hash.js`, add `_mp*` glue to
  `mancala/js/ui.js` following Chinchón's shape, new save key `gamehub.mancala.mp.v1`. No
  rng/seeding work needed given the deterministic engine.

### Dots and Boxes — tier 2

- **Current state:** vs AI only, no local hot-seat. Chain-capture "go again" rule (completing
  a box's 4th side grants another move; a single turn can capture a long chain, up to 220 edges
  on Large). Engine is pure, autosave (`gamehub.dotsboxes.save.v1`) already proves full
  serializability.
- **Plan:** generalize the human-vs-AI seat hardcode in `ui.js` (same gap as Filler/Connect
  Four/Tic Tac Toe). Decide move granularity up front: **one lockstep move per drawn edge**
  (matches `net.js`'s per-move `appendMove` grain, simplest, recommended) vs. batching a whole
  chain-capture as one move (more complex, no clear benefit). A long chain on Large means many
  rapid `appendMove` calls within one real turn — worth a manual latency check against Firebase
  RTDB write timing before committing to per-edge granularity, but nothing in the design rules
  it out. New `dots-boxes/js/hash.js`, save key `gamehub.dotsboxes.mp.v1`.

### Connect Four — tier 2

- **Current state:** vs AI only (no local hot-seat — `gamehub.connect4.v1` only stores a
  "who opens" preference, not a two-human mode). "Connect Four persists nothing" beyond that one
  field, per root CLAUDE.md — this game is the odd one out on settings persistence generally.
  The Expert AI tier runs in a **Web Worker** with a persistent transposition table; this is
  off-main-thread computation, not baked into shared game state, but the MP glue must account for
  the extra async hop when deciding "whose move is authoritative and when" (a remote human move
  arrives over the network on a similar timescale to the Worker's own reply — don't let the two
  race into the wrong seat). `_statsDisqualified` (set when hints/undo are used) needs an
  explicit MP-mode decision — most likely: never disqualify a real MP match's stats, since undo
  probably shouldn't even be offered against a live remote opponent.
- **Plan:** generalize seat hardcoding same as the other tier-2 games. New `hash.js`, save key
  `gamehub.connect4.mp.v1` (first persisted key of its kind for this game — note it explicitly
  in the CLAUDE.md update since "Connect Four persists nothing" stops being fully true).

### Filler — tier 2

- **Current state:** vs AI only, flood-fill color duel, no local hot-seat. `generateColors(rng)`
  and `newGame(rng)` both already take an injectable rng (used for a fairness pass on corner
  colors) — a host can seed board generation deterministically with no new hook needed, unlike
  Parchís. Autosave already proves serializability.
- **Plan:** generalize the human=P1/AI=P2 hardcode in `ui.js` into a per-seat agent interface.
  New `filler/js/hash.js`, save key `gamehub.filler.mp.v1`. Board generation seeding: host rolls
  the seed, transmits it as part of room `config` (same pattern Chinchón uses for its deal), both
  sides call `newGame(seededRng)` locally rather than transmitting the whole board.

### Boggle — tier 3 (do not force lockstep here)

- **Current state:** not turn-based — "a shared-board timed sprint... both sides score
  independently against the same board with no duplicate cancellation... higher total wins, ties
  are real" (its own CLAUDE.md). The current "opponent" is a canned post-hoc reveal
  (`boggle/js/ai.js` samples from the DFS solver's word list at round end), not a live turn-taker.
  `newBoard(rng)` already takes an injectable rng, so a host-generated seed is transmittable.
  Autosave (`gamehub.boggle.save.v1`) proves state serializability.
- **Plan — genuinely different shape from every other game in this doc:** there is no discrete
  move to hash-check. Recommended model: host creates the room and picks/transmits a board seed
  via room `config` (both sides call `newBoard(seededRng)` locally — never transmit the full
  board string, that's what the seed is for); both sides start a synced countdown off the room's
  `round`/`updated` timestamp; each side plays entirely locally against its own copy of the same
  board; **at round end, each side submits its own final found-word list to the room** (a single
  write each, not a move stream) and the client reveals both lists and computes the real score
  (with true duplicate-word handling now that both lists are visible, which solo play doesn't
  need since there's no second real list to compare against). This is a simultaneous-reveal
  pattern, not lockstep — don't try to retrofit an `appendMove`-per-tile-trace protocol, it adds
  complexity for no benefit since intermediate progress isn't gameplay-relevant here.
- **Open design question for whoever picks this up:** should mid-round progress be visible to
  the opponent at all (a live score race) or strictly hidden until reveal (closer to how solo
  play already frames "the reveal" as a discrete moment)? Either is defensible; it wasn't decided
  as part of this survey and should be a conscious choice, not a default.

### Monopoly Deal — tier 4

- **Current state:** solo vs 1-4 AI, launch-out `href:` with its own nested service worker and
  non-ESM global-JS stack (`business-deal/js/game-stats-global.js` is a verbatim copy of the
  shared recorder, not an import — this game does not currently import shared `js/` modules the
  way in-hub games do). **No multiplayer or online capability exists today** — the one
  "Multiplayer" string hit in the codebase is an AI-vs-AI self-test harness comment, not real
  netplay. `business-deal/js/game.js`'s `Game` class already exposes `snapshot()`/per-player
  `getView()` (hides opponents' hands) for agent consumption, but the turn loop itself is one
  continuous `async playTurn()` with deep `await` chains at every decision point (choose move →
  discard down → resolve a targeted action → resolve Just Say No → charge/resolve payment →
  assign wild color), and each seat's `agent` object is attached directly to the live `Game`
  instance — the constructed game is not directly JSON-serializable the way Chinchón/Escoba/
  Uno's snapshot-based engines are.
- **Why this is hard, concretely:** (1) 2-5 players exceeds `net.js`'s 2-role model — see the
  N-player question; (2) the async/interrupt turn structure (a targeted action can trigger a
  Just Say No response from a specific other seat before resolving) doesn't map onto "one move,
  append, hash-check" without either restructuring the engine into discrete resumable steps, or
  running the whole async chain host-side and transmitting only its effects (which reopens the
  hidden-information question — never broadcast another player's full hand); (3) no ESM
  structure to hang a `net.js` import off of without a larger integration change first; (4) the
  human-seat assumption (`HumanAgent(this)` for seat 0 only) is baked in with no code path for a
  second live human agent today.
- **Recommendation:** don't start this one until at least one tier-1/2 game has shipped its MP
  pass end-to-end (proving out `hash.js` conventions, save-key conventions, and the recovery
  flow in this repo generally), and until the N-player question above has an actual decision.
  Even under path (A) (cap at 2 humans), the async/interrupt turn structure is real, non-optional
  work — restructuring `playTurn()`'s await chain into discrete steps the way Chinchón/Escoba/Uno
  already are is probably the single largest sub-task in this whole document.

### Parchís — tier 4

- **Current state:** solo vs AI (2-4 total seats), launch-out `href:`, **source lives entirely
  outside this repo** at `../Parchís/src/*.js`, combined into `parchis/index.html` via
  `recombine.mjs` — **do not hand-edit `index.html`.** No multiplayer/online capability exists
  (checked directly: no `multiplayer`/`net.js`/`room`/`peer`/`socket` references in the built
  file). The `Engine` object already supports `serialize`/`deserialize` via plain
  `JSON.stringify`/`JSON.parse` (used internally by the AI's lookahead search) — genuine
  serializability precedent, unlike Monopoly Deal. **However dice rolls call raw `Math.random()`
  directly inside `d6()`, with no injectable rng/seed hook** — unlike every other in-scope game,
  this one needs a new seeding hook added to the sibling engine before a host can transmit
  deterministic rolls; the alternative (transmit the rolled value itself as part of each move,
  no engine change needed) is simpler and matches how `net.js`'s move log already works.
- **Why this is hard, concretely:** (1) 2-4 players exceeds `net.js`'s 2-role model — same as
  Monopoly Deal; (2) the sibling-repo build step means every MP-glue edit here needs `recombine.mjs`
  re-run before it's testable in the hub, an extra step no other game in this doc has, and any
  session working on this needs the sibling `../Parchís/` folder available at all, which is not
  guaranteed for every session; (3) extra-turn-on-six / capture rules add move-payload
  complexity similar in kind to Dots and Boxes' chain rule, not a new category of problem.
- **Recommendation:** same as Monopoly Deal — sequence last. Additionally, resolve the sibling-repo
  workflow question (is `../Parchís/` available in the environment this work will actually happen
  in?) before scoping a session for this game specifically; that's an environment fact this
  survey couldn't verify from inside `game-hub/`.

---

## Cross-cutting touchpoints every per-game MP handoff will need (beyond the game's own engine/UI work)

Modeled on the "seven touchpoints" pattern in `HANDOFF-DOTS-BOXES.md` section 7 — MP work has
its own recurring checklist, distinct from that one:

1. **`<game>/js/hash.js`** — new file, FNV-1a state hash, copy Chinchón's shape.
2. **`<game>/js/ui.js`** — `_mp*` method family (create/join/room-callback/apply-recovery/
   save-snapshot/restore), a `_makeRemoteAgent()` seam, and (for the tier-2 games) a first-time
   generalization of the hardcoded human-vs-AI seat into an agent interface.
3. **New MP save key** `gamehub.<game>.mp.v1`, distinct from the existing settings key and the
   existing solo-autosave key (three separate keys per game once this ships, same as Chinchón/
   Escoba today).
4. **`sw.js`** — new `hash.js` file(s) added to `ASSETS`, `CACHE` bumped. Currently `v222`.
5. **Stats recording implications** — decide, per game, how an MP match's result gets recorded
   locally on both host and guest devices without double-counting or corrupting `Math.max`
   bests (THE LAW rules 1-2). This wasn't a solved problem before Chinchón/Escoba; check how
   their recorders handle "who calls `recordX` and when" in MP mode before assuming a new game's
   solo recorder call site is still correct unchanged.
6. **A lockstep test file** — either extend `test-mp-lockstep.mjs` with a section for the new
   game (matching its existing per-method-citation style) or add a dedicated
   `test-mp-lockstep-<game>.mjs`. Either way, port the five `[KNOWN-BUG PROBE]` invariants
   above into that game's own event vocabulary — don't skip this because "it's a different
   game," the bugs they guard against are protocol-shaped, not Chinchón/Escoba-specific.
7. **`<game>/CLAUDE.md`** — document the MP integration: which invariant checks apply, the MP
   save key, the N-player decision made (path A capped at 2 humans, noted as a known
   limitation), and the `isInProgress()` implication (an active MP match should almost certainly
   flip to "true, confirm before leaving" the way Chinchón/Escoba's MP path already does, even
   for games whose solo mode auto-resumes).
8. **Root `CLAUDE.md`** — per THE LAW rule 9, update the games table's stats-recorder column
   or add an MP note once a game ships this, and update `js/net.js`'s one-line role description
   in the shared-modules table if the set of games using it grows beyond "Chinchón and Escoba."

## What this doc deliberately does not do

- It does not extend `js/net.js`'s protocol to N players — that's flagged as its own future
  decision, not started here.
- It does not write any `hash.js`, `_mp*` glue, or test file for any of the nine games — each
  needs its own dedicated handoff at `HANDOFF-DOTS-BOXES.md`'s depth once a session commits to a
  specific game, using this doc's per-game section as the starting brief.
- It does not touch Ball Run, Nuts & Bolts, or Snake in any way.
- It does not change `sw.js`, any settings key, or any existing game's code.
