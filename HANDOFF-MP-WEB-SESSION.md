# HANDOFF — Multiplayer expansion: the WEB-SESSION half

**Companion doc:** `HANDOFF-MP-LOCAL-MACHINE.md`. Together these two replace the single
`HANDOFF-MULTIPLAYER-EXPANSION.md` survey (its research is carried forward in full, corrected;
see that file's history on branch `claude/review-multiplayer-handoff-games-k3kyv0`).

**This doc covers everything that can be done start-to-finish from a Claude Code web/cloud
session** — all the code, all the headless proof, all the documentation, for eight of the nine
candidate games. **It cannot cover verification that a real multiplayer match works**, because
this environment cannot reach Firebase at all. That half lives in the companion doc.

**Target executor:** one dedicated session per game, Sonnet.
Read root `CLAUDE.md` first (THE LAW, the module contract, the games table), then `js/CLAUDE.md`
"Multiplayer lockstep — invariants" (`js/CLAUDE.md:271`) in full. Every fact in that section is
a fix for a real shipped regression, not defensive boilerplate.

---

## The boundary, measured (2026-07-26, not assumed)

Everything below was run in this environment, not inferred:

| Capability | Result | Evidence |
|---|---|---|
| Run the full test suite | **Yes** | `node run-all-tests.mjs` → 19 suites ran, 2 skipped, 0 failed |
| Run headless lockstep tests | **Yes** | `test-mp-lockstep.mjs` uses an in-file `FakeRoom`, **no Firebase, no DOM** (its own header line 2) |
| Validate the service worker | **Yes** | `node validate-sw-assets.mjs` → v222, 236 entries, all present |
| Serve the hub locally | **Yes** | `node server.mjs` → `http://localhost:8123/` 200 |
| Drive the real UI in a real browser | **Yes** | Playwright + `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` mounted Uno standalone (`.un-root` found) and rendered 14 hub cards |
| Install npm packages | **Yes** | `registry.npmjs.org` is in the proxy's `noProxy` list; `npm i playwright` and `npm i jsdom` both succeed |
| **Reach Firebase** | **NO** | `www.gstatic.com:443` → **403 CONNECT, policy denial** by the environment's network policy. The RTDB host is unreachable too (`000`). |
| **Create a real room** | **NO** | Consequence of the above — see below |
| Access `../Parchís/` | **NO** | Not in the container; the sibling project is not a remote of this repo |

### Why "no Firebase" is absolute, not a workaround away

`js/firebase-boot.js` loads the SDK by dynamic import from
`https://www.gstatic.com/firebasejs/10.12.2/...`. That host is denied by policy, so `boot()`
throws, `getStatsApp()` resolves `null`, and **`js/net.js` is inert for the whole session**. This
is observable, not theoretical — driving the hub under Playwright logs the app's own message:

```
Failed to load resource: net::ERR_TUNNEL_CONNECTION_FAILED
[stats-net] sync skipped: Firebase unavailable (offline or unconfigured).
```

So: **no room is ever created, no move is ever appended, no recovery ever round-trips** in a web
session, no matter how many browser contexts you drive. Do not try to route around the proxy.

### The one rule this implies

> **A web session ships MP code and headless proof. It never reports "multiplayer works."**

The strongest true claim available here is *"the protocol is proven headlessly against `FakeRoom`,
all five invariant probes green; real-room behaviour is unverified."* Say exactly that and hand
off. Claiming more is the failure mode this split exists to prevent.

This is less limiting than it sounds: `test-mp-lockstep.mjs` runs **two real engines against each
other** over a fake room that mirrors `js/net.js`'s semantics with per-method citations
(`startRound` clears the log at `net.js:122-128`, `appendMove` keys by padded seq at `:132-137`,
and so on). Every one of the five historical MP bugs was caught by that harness, with no network
involved. The protocol really is provable here. What is not provable is latency, real
backgrounding, real reconnects, and two real humans.

---

## Shared protocol reference

`js/CLAUDE.md:271` is the authority — this is the working summary.

### `js/net.js` contract

Scoped to `rooms/<CODE>` in the shared `'stats'` Firebase app. **Strictly two roles, `host` and
`guest`, no N-player array.** Room shape: `{ v, game, swv, created, updated, status, config,
host:{name,avatar,deviceId,lastSeen}, guest:null|{...}, round, moves, recovery, result }`.

- `createRoom(game, config, me)` — up to 5 random 4-char codes; reclaims a code only if its room
  is >24h stale. Returns `{code}` or `{error:'busy'|'offline'}`.
- `joinRoom(code, me)` — validates freshness/version, supports **rejoin** by matching `deviceId`,
  rejects a second distinct guest with `{error:'full'}`. An "unknown" SW version never blocks.
- `startRound(code, n, deckOrder, dealer)` — host-only; resets `moves`/`recovery`.
- `appendMove(code, by, seq, move, hash)` — **both sides append into the same seq-keyed log.**
  `seq` is a shared strictly-increasing counter both sides agree on; each entry carries a state
  hash for post-apply verification.
- `writeResult`/`writeRecovery` — host-only. Recovery publishes a full-state snapshot.
- `requestRecovery`/`clearRecovery` — the guest has no direct push channel to the host; recovery
  is entirely mediated through the room doc.
- `onRoom(code, cb)` — single-subscription `onValue`; a new subscription detaches the previous.
- `heartbeat`/`stopHeartbeat`/`leaveRoom`/`disconnect`.

### The five invariants (do not re-derive these the hard way)

Each is the fix for a real shipped regression with an executable `[KNOWN-BUG PROBE]` in
`test-mp-lockstep.mjs`:

1. **Decide match-end before emitting the round-scored event, gated on an explicit `matchOver`
   field — never on the engine's own `winner` property.** Chinchón's `winner` is still null at the
   instant a points/rounds finish happens; gating on it deadlocked the guest at every normal end.
2. **A transmitted recovery snapshot's `isHuman` flags are sender-relative, not
   receiver-relative** — remap agents by fixed seat (host=0, guest=1), never trust the flags.
3. **A "consumed queue" config field must be `shift()`-consumed, never indexed by a per-round
   counter** — index-based consumption replayed round 1's shuffle at round 2.
4. **Autosave after the same event's MP bookkeeping, not before** — saving before advancing
   `appliedSeq` leaves the saved seq one low, so every rejoin re-applies an applied move.
5. **A round-boundary snapshot (`midRound:false`) resumes via "next round, scores kept", never a
   full match re-init that zeroes scores** — and a restoring guest must await the host's freshly
   published round record, never a stale or locally-shuffled deck.

### Seat 0 is the HOST's human, not "the local human"

A guest's own human sits at **seat 1**. Escoba states the rule at `escoba/js/ui.js:860` — *"The
local human's seat: always 0 in solo. In MP, the host is seat 0 and the guest is seat 1 — every
'self' lookup must go through this rather than assume seat 0"* — implemented as
`_localSeat() { return this.mp ? this.mp.localSeat : 0; }` with `_human()` on top. Every "whose
turn / did I win / which hand is mine / which side renders bottom" read goes through it.

Same class of error as invariant #2, applied to the live UI instead of a recovery snapshot.
**Build the indirection in from the start** — retrofitting means auditing every seat-0 literal in
a file that already has hundreds.

### MP save-key storage: the two reference games DIVERGE

Pick deliberately; there is no settled convention (an earlier survey draft asserted one and
invented a `gamehub.escoba.mp.v1` key that does not exist):

- **Chinchón — separate key.** `STORE_MP_SAVE = 'gamehub.chinchon.mp.v1'` (`chinchon/js/ui.js:55`),
  written by `_mpSaveSnapshot()`, read by `_mpLoadSave()`, cleared by `_mpClearSave()`. Its own
  comment: *"This key is MP-only … Solo has its own separate autosave key (STORE_SOLO_SAVE) … the
  two never mix."* Three keys total.
- **Escoba — one key, an `mp` sub-object.** No `gamehub.escoba.mp.v1`, no `_mpSaveSnapshot`. The
  shared `_saveSnapshot()` writes the frozen gen-1 `escoba-save` key with an
  `mp: { code, role, seq, at }` sub-object alongside `snap`; `_tryRestoreMP()`
  (`escoba/js/ui.js:2020`) reads that one key, branching on `save.mp`. Two keys total.

**Recommendation: follow Chinchón.** Escoba's shape is a consequence of its save key being frozen
gen-1 (THE LAW rule 5) and of MP/solo sharing a snapshot writer, not something anyone would pick
fresh. **The key is permanent once shipped** — decide before the first write.

### The N-player question — decided once, here

`js/net.js` has exactly one `host` and one `guest`. Three in-scope games support more locally
(Uno 2-4, Monopoly Deal 2-5, Parchís 2-4).

- **(A) Follow precedent:** MP = exactly 2 human seats regardless of local player count; extra
  seats stay AI-filled, same as Chinchón/Escoba today. Zero `js/net.js` changes.
- **(B) Extend the protocol** to a `guests: []` array, rework move-log/seq discipline for 3+
  writers, add per-seat join/leave/reconnect. No precedent to copy, and both shipped games would
  have to stay compatible.

**DECIDED 2026-07-26 (Matt): path (B) is required, for the multi-seat games only.** MP must
support 2-4 players in Uno, Monopoly Deal, Parchís and Escoba. See
`HANDOFF-MP-ROADMAP.md` for the exact per-game targets, three open questions about seat counts,
and the sequencing.

What this means for a session reading this doc:

- **If your game is inherently 2-player** (Tic Tac Toe, Connect Four, Mancala, Dots and Boxes,
  Filler, Boggle) — nothing changes. Build exactly 2 human seats, host 0 / guest 1, **do not touch
  `js/net.js`**. Path B is explicitly not your job.
- **If your game is multi-seat** (Uno, Monopoly Deal, Parchís, Escoba) — **you are blocked until
  the `js/net.js` N-player extension ships** (roadmap phase 3). Do not start, and do not build a
  2-human version intending to extend it later.

**Still true: never change `js/net.js`'s protocol as a side effect of one game's MP work.** Path B
gets its own handoff, its own review, and its own local verification pass with real devices at 3
and 4 seats — it is shared infrastructure two production games depend on, and the one piece of
this plan that cannot be validated headlessly.

### "Generalize the seat" means two different jobs

Nothing outside Chinchón/Escoba has an agent abstraction:

- **Agent-object interface (Chinchón, Escoba only).** The engine `await`s decisions from a
  per-player `agent`, so MP swaps in `_makeRemoteAgent()` at construction
  (`makePlayer({ id: 1, name: room.guest.name, agent: this._makeRemoteAgent() })`,
  `chinchon/js/ui.js:2132`). This is what `_makeRemoteAgent()` plugs into.
- **Per-seat flag, UI drives the engine (everything else, Uno included).** The engine exposes
  plain action methods; the UI decides who acts. Uno's `ui.js:314` is
  `_isAI(pi) { return !!(this.seats && this.seats[pi] && this.seats[pi].isAI); }` over a `seats[]`
  array of `{name, emoji, isAI}`, header comment still reading "Human is always engine seat 0."
  Mancala's `mode:'friend'` is the same idea with a mode string. **There is no agent object to
  swap** — MP means adding a third seat kind ("remote") to the UI's dispatch and awaiting the move
  log where it currently calls the AI.

Neither shape is harder in the abstract; a flag-driven UI is often *less* work. What matters is
not mistaking one for the other when estimating.

---

## Sequencing

| Tier | Games | Why |
|---|---|---|
| **1 — lowest effort** | Uno, Tic Tac Toe | Pure synchronous engine, no async agent interface, state already plain-JSON via existing `snapshot()`/save paths, no hidden-info or real-time complications for a 2-player cut. |
| **2 — moderate** | Mancala, Dots and Boxes, Connect Four, Filler | Same "pure engine, vs-AI-only" shape; each needs seat-1 generalized to be network-driven. Mancala is easiest — `mancala/js/ui.js:622` (`humanTurn = this.mode === 'friend' \|\| s.turn === P1`) already proves two human-driven seats work. |
| **3 — structurally different** | Boggle | Not turn-based. Needs a simultaneous-reveal model, not lockstep. |
| **4 — hardest** | Monopoly Deal | Deep async/interrupt turn structure, real hidden information, non-ESM stack. |

**Parchís is absent from this table on purpose — it is local-machine-only.** See the companion doc.

Work the tiers in order. A session starting at tier 3 or 4 is re-deriving lockstep discipline
with a harder game as its first test case, which is backwards.

---

## Per-game briefs

Use `chinchon/js/ui.js` and `escoba/js/ui.js`'s `_mp*` methods as the literal template; deviate
only where a game's shape forces it. Each of these is a starting brief, not a full spec — a
per-game spec at `HANDOFF-DOTS-BOXES.md`'s depth is real follow-up work once a session commits.

### Uno — tier 1

- **Current state:** solo vs 1-3 AI. `uno/js/game.js` has no `Math.random` (rng injected via
  constructor), a `presetDeck` hook explicitly modeled on Chinchón's "so a future host can
  transmit deals deterministically", every state change is one explicit action method
  (`play(playerIndex, cardId, color?)`, `draw(playerIndex)`, `chooseColor(playerIndex, color)`),
  and the whole state is plain JSON via `snapshot()`/`UnoGame.fromSnapshot()`.
  `getLegalMoves(playerIndex)` is the single legality source read by both the human path
  (`ui.js:568`, `:1000`) and the AI (`ai.js:146`, `:209`) — one gate for every seat, which is what
  makes a remote seat safe to add.
- **Seat model:** flag-driven (`seats[]` + `_isAI(pi)`), **not** an agent interface. Add a third
  seat kind so `seats[pi]` can be `remote`; where the turn loop branches into the AI, await the
  move log instead. Keep `getLegalMoves` as the gate on both sides so a remote move is validated
  locally before it is applied.
- **Plan:** path (A) — host seat 0 + guest seat 1, remaining 0-2 seats AI. Build `uno/js/hash.js`
  (Chinchón's FNV-1a shape over `snapshot()`). Add the `_mp*` family to `uno/js/ui.js`. Route
  every "self" read through a new `_localSeat()` rather than the current `HUMAN` constant
  (`ui.js:568`, `:1000` both hardcode it). New key `gamehub.uno.mp.v1`.
- **Turn-order cards** (Skip, Reverse, +2 stacking) need each remote decision point enumerated in
  `getLegalMoves` — already true today, so this is verification, not new work.
- **Head-to-head:** `uno/CLAUDE.md` says head-to-head capture is "MP-only and out of scope until
  Uno gets a multiplayer pass." This ships that pass — wire it in the same milestone or explicitly
  say it's deferred again.

### Tic Tac Toe — tier 1

- **Current state:** solo vs AI, Classic (3x3) and Ultimate (nested). Both variants' state is
  plain-JSON per its own CLAUDE.md ("stored as-is since it's already plain JSON-safe data"). No
  async agent interface — "a move has no multi-step resolution to pace." Human-vs-AI hardcoded, no
  hot-seat.
- **Plan:** the simplest 2-player case in the repo — no chain rule, no Worker, no seeded board.
  Generalize seat 1 to accept remote input. Ultimate's "your move picks their board" needs the
  move payload to carry which sub-board plus meta-board resolution state; nothing there breaks
  per-move hash verification. New `tic-tac-toe/js/hash.js`, key `gamehub.tictactoe.mp.v1`.
- **Test both variants.** Ultimate's board-routing is the one place a desync can hide — the wrong
  sub-board unlocked on the remote side after a mismatch is invariant #2 applied to different state.

### Mancala — tier 2 (easiest of the tier)

- **Current state:** vs AI (3 tiers) or **local 2-human hot-seat via `mode:'friend'`**
  (`ui.js:622`) — the engine/UI already tolerate two human-controlled seats. Deterministic Kalah
  engine, no rng at all. Chain "go again" (last stone in your own store), simpler than Dots and
  Boxes' capture chaining.
- **Plan:** smallest lift in tier 2 — `'friend'` already answers "can two human seats drive this";
  the only missing piece is routing seat 1's input over the network instead of the same screen.
  Build `mancala/js/hash.js`, add `_mp*` glue, key `gamehub.mancala.mp.v1`. No seeding work.

### Dots and Boxes — tier 2

- **Current state:** vs AI only, no hot-seat. Chain-capture "go again" (a single turn can capture
  a long chain, up to 220 edges on Large). Pure engine; autosave (`gamehub.dotsboxes.save.v1`)
  already proves full serializability.
- **Plan:** generalize the seat hardcode. **Decide move granularity up front: one lockstep move
  per drawn edge** (matches `appendMove`'s grain, simplest, recommended) vs. batching a whole chain
  as one move (more complex, no clear benefit). A long chain means many rapid `appendMove` calls
  inside one real turn — **this is the one design choice a web session cannot fully de-risk**, since
  the latency question is real-network. Design for per-edge, and flag it in the handoff-out for the
  local latency check. New `dots-boxes/js/hash.js`, key `gamehub.dotsboxes.mp.v1`.

### Connect Four — tier 2

- **Current state:** vs AI only, no hot-seat.
  **Stale-doc correction:** root `CLAUDE.md`'s games table still lists this game's settings key as
  *"none (persists nothing)"*. That has not been true since batch 8. Connect Four persists **two**
  keys today — `gamehub.connect4.v1` (settings, `ui.js:24`, whose own comment reads *"Connect Four
  persisted nothing before batch 8; this is a new, standard `gamehub.<game>.v1` key"*) and
  `gamehub.connect4.save.v1` (autosave, `ui.js:42`, which root `CLAUDE.md` also lists in its own
  `isInProgress()` save-key list — the table contradicts itself). An MP key would be its **third**.
  **Per THE LAW rule 9 that row should be fixed whether or not MP happens** — it is a live
  documentation bug, and it is entirely web-session work.
- **Expert AI runs in a Web Worker** with a persistent transposition table. Off-main-thread, not
  baked into shared state, but the MP glue must account for the extra async hop when deciding
  whose move is authoritative and when — a remote human move arrives on a similar timescale to the
  Worker's reply; don't let the two race into the wrong seat.
- **`_statsDisqualified`** (set when hints/undo are used) needs an explicit MP decision. Most
  likely: never disqualify a real MP match, since undo probably shouldn't be offered against a
  live remote opponent at all.
- **Plan:** generalize seat hardcoding, new `hash.js`, key `gamehub.connect4.mp.v1`.

### Filler — tier 2

- **Current state:** vs AI only, flood-fill colour duel, no hot-seat. `generateColors(rng)` and
  `newGame(rng)` both already take an injectable rng (used for a corner-colour fairness pass), so a
  host can seed board generation with **no new hook needed**. Autosave proves serializability.
- **Plan:** generalize the human=P1/AI=P2 hardcode. New `filler/js/hash.js`, key
  `gamehub.filler.mp.v1`. **Seeding:** host rolls the seed and transmits it in room `config` (the
  pattern Chinchón uses for its deal); both sides call `newGame(seededRng)` locally rather than
  transmitting the board.

### Boggle — tier 3 (do not force lockstep here)

- **Current state:** not turn-based — "a shared-board timed sprint… both sides score independently
  against the same board with no duplicate cancellation… higher total wins, ties are real" (its own
  CLAUDE.md). The current "opponent" is a canned post-hoc reveal (`boggle/js/ai.js` samples the DFS
  solver's word list at round end), not a live turn-taker. `newBoard(rng)` takes an injectable rng.
  Autosave proves serializability.
- **Plan — genuinely different shape:** there is no discrete move to hash-check. Host creates the
  room and transmits a **board seed** via room `config` (both sides call `newBoard(seededRng)`
  locally — never transmit the board string, that's what the seed is for); both sides start a
  synced countdown off the room's `round`/`updated` timestamp; each side plays entirely locally;
  **at round end each side submits its own final found-word list** (a single write each, not a move
  stream), and the client reveals both and computes the real score — with **true duplicate-word
  handling**, now possible because both lists are visible. Simultaneous reveal, not lockstep. Do
  not retrofit an `appendMove`-per-tile-trace protocol; intermediate progress isn't
  gameplay-relevant here.
- **DECIDED 2026-07-26 (Matt): hidden until reveal.** Mid-round progress is NOT visible to the
  opponent — no live score race. The opponent's word list appears only at the end-of-round reveal,
  matching how solo already frames the reveal as a discrete moment. This was the section's one open
  design question and it is now closed; implement it that way, don't re-litigate it.
- **Note:** the synced-countdown design is the other item a web session can't fully de-risk (clock
  skew between two real devices). Design it off the room timestamp, flag it for the local pass.

### Monopoly Deal — tier 4

- **Current state:** solo vs 1-4 AI, launch-out `href:`, own nested service worker, non-ESM
  global-JS stack. `business-deal/js/game-stats-global.js` is a copy of the shared recorder, not an
  import — the body is verbatim under a 14-line header explaining why the copy exists, and
  `test-recorder-contract.mjs` enforces that they stay in sync (edit the canonical `js/` file and
  re-copy, never BD's copy directly). **No multiplayer exists today** — the single "Multiplayer"
  string in the codebase is an AI-vs-AI self-test comment (`business-deal/js/ai.js:598`).
  `Game` exposes `snapshot()`/per-player `getView()` (hides opponents' hands), but the turn loop is
  one continuous `async playTurn()` with deep `await` chains at every decision point (choose move →
  discard down → resolve targeted action → resolve Just Say No → charge/resolve payment → assign
  wild colour), and each seat's `agent` is attached to the live `Game` instance — so the constructed
  game is **not** directly JSON-serializable the way Chinchón/Escoba/Uno's are.
- **Why it's hard:** (1) 2-5 players exceeds the 2-role model — path (A) caps it at 2 humans;
  (2) the async/interrupt structure (a targeted action can trigger a Just Say No from a specific
  other seat before resolving) doesn't map onto "one move, append, hash-check" without either
  restructuring the engine into discrete resumable steps or running the whole chain host-side and
  transmitting only effects — which reopens hidden information (**never broadcast another player's
  hand**); (3) no ESM structure to hang a `net.js` import off without a larger integration change;
  (4) `HumanAgent(this)` is baked in for seat 0 only.
- **Recommendation:** don't start until at least one tier-1/2 game has shipped end-to-end
  (including its local verification pass), so `hash.js` conventions, save-key conventions and the
  recovery flow are proven in this repo first. Even under path (A), restructuring `playTurn()`'s
  await chain into discrete steps is probably the single largest sub-task in the whole plan.

---

## Web-session touchpoints checklist

1. **`<game>/js/hash.js`** — new file, FNV-1a state hash, copy Chinchón's shape.
2. **`<game>/js/ui.js`** — the `_mp*` family (create/join/room-callback/apply-recovery/
   save-snapshot/restore); a remote-seat seam (`_makeRemoteAgent()` for an agent-driven engine, a
   third "remote" seat kind for the flag-driven majority); and **a `_localSeat()` helper every
   "self" lookup goes through**.
3. **New MP save key** `gamehub.<game>.mp.v1`, distinct from the settings key and the solo-autosave
   key. Follows Chinchón; Escoba differs (see above). Permanent once shipped (THE LAW rule 5).
4. **`sw.js`** — new `hash.js` added to `ASSETS`, `CACHE` bumped (currently `v222`). Then
   `node validate-sw-assets.mjs` — **a missing `ASSETS` entry aborts the whole SW install
   atomically and silently**, which is the "version pill stuck at `vN → vN+1`" failure in root
   `CLAUDE.md`. This validation is web-session work and there is no excuse for shipping it broken.
5. **Stats recording.** Already solved in both reference games; read `chinchon/js/ui.js:924`
   (`_commitStats`) and `escoba/js/ui.js:844` before writing anything:
   - **Each device records its own result independently, and that is not double-counting.** Both
     host and guest run their own `_commitStats()`; `gamehub.stats` is keyed per PLAYER
     (`statsKey()`/`statsId()`, "Whose stats are these" in `js/CLAUDE.md`), so two devices each
     writing "I played one match" is two different people each correctly getting one.
   - **Idempotence is a local `_statsCommitted` boolean**, set *before* any write. MP reaches
     match-end by several paths (normal finish, recovery, opponent-left); the guard is what stops
     one match counting twice on one device.
   - **`_human()` must resolve through `_localSeat()`**, or a guest records the host's result as
     its own — a THE LAW rule 2 violation (a loss written as a win is not additive-safe).
   - **MP additionally calls `recordHeadToHead(gameId, opp, won)`** with the live room's opponent,
     inside a `try/catch` that must **never block the ordinary result from being recorded** ("Never
     allowed to block the result being recorded" is the comment in both files). Solo has no
     `this.mp` and is untouched.
   - **Known wart — decide, don't inherit:** both games derive the difficulty bucket from the first
     non-human player's `difficulty`, but the MP remote seat is built by
     `makePlayer({ id, name, avatar, agent })` with **no `difficulty` field**, so an MP match falls
     through to the local setup's last AI-difficulty setting (Chinchón) or the literal `'normal'`
     (Escoba). A real human opponent lands in whatever AI bucket that device had selected. Additive
     and harmless to existing data, so not a LAW problem — but not meaningful either. Decide up
     front whether MP results belong in a difficulty bucket at all.
6. **A lockstep test file** — extend `test-mp-lockstep.mjs` with a section for the new game
   (matching its per-method-citation style) or add `test-mp-lockstep-<game>.mjs`. Either way port
   all five `[KNOWN-BUG PROBE]` invariants into that game's own event vocabulary — the bugs are
   protocol-shaped, not Chinchón/Escoba-specific. **If you add a new file, register it in
   `run-all-tests.mjs`'s `SUITES` array** (the "tripwire suites" block). An unregistered suite is
   never run and goes green-by-absence — the silent-failure shape `HANDOFF-DOTS-BOXES.md` §7.7
   calls out. Extending the existing file needs no registration and is the safer default.
   **This is the single most important web-session deliverable** — it is the only proof that exists
   before the local pass.
7. **`<game>/CLAUDE.md`** — document the MP integration: which invariant checks apply, the MP save
   key, the path-(A) 2-human cap noted as a known limitation, and the **`isInProgress()`
   implication**. Both reference games flip to "true, confirm before leaving" for MP only:
   `chinchon/js/ui.js:2441` is `!!(instance && instance.mp && instance._inProgress())` and
   `escoba/js/ui.js:2124` is `!!(instance && instance.mp && !instance._matchEnded)` — solo stays
   `false` because leaving is lossless, MP returns `true` because leaving genuinely abandons a room.
   One function, two questions, depending on context.
8. **Root `CLAUDE.md` and `js/CLAUDE.md`** — per THE LAW rule 9, "Chinchón and Escoba" is written
   down in **three** places and all three go stale the moment a third game ships MP:
   - root `CLAUDE.md:127` — the shared-modules table row for `js/net.js`.
   - `js/CLAUDE.md:94` — the fuller shared-modules row for the same file.
   - `js/CLAUDE.md:273` — *"Chinchón and Escoba share one lockstep protocol over `js/net.js`"*, the
     opening sentence of the invariants section this whole doc points at.

   Also update the root games table, and — independently of MP — fix the stale Connect Four
   "persists nothing" row.

---

## Definition of done for a web session

All of these are achievable here, and all are required before handing off:

- [ ] `hash.js`, `_mp*` glue, `_localSeat()` indirection, seat generalization written.
- [ ] Lockstep test written, **all five invariant probes green**, registered in `run-all-tests.mjs`
      if it's a new file.
- [ ] `node run-all-tests.mjs` green (19+ suites, jsdom ones may skip — that's expected, or
      `npm i jsdom` in a scratch dir to run them).
- [ ] `node validate-sw-assets.mjs` green; `CACHE` bumped.
- [ ] Solo play still works, checked in a real browser (`node server.mjs` + Playwright with
      `executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`). **MP regressions
      that break solo are catchable here — check the solo path explicitly**, since the whole game
      just had its seat model rewritten.
- [ ] The game's `CLAUDE.md` + the three shared-doc touchpoints updated.
- [ ] **The handoff-out written** (below).

### The handoff-out — what to hand to the local session

End the session by appending a short block to `HANDOFF-MP-LOCAL-MACHINE.md` naming:

1. Which game, which commit/branch.
2. Which design choices were made but **could not be verified without a real network** — at
   minimum: Dots and Boxes' per-edge move granularity under real latency, Boggle's synced-countdown
   clock skew, and any game's recovery/rejoin timing.
3. Anything the headless harness had to stub or elide, so the local pass knows where to look.
4. The explicit, honest status line: *"protocol proven headlessly against FakeRoom; real-room
   behaviour unverified."*
