# HANDOFF — Multiplayer expansion: the LOCAL-MACHINE half

**Companion doc:** `HANDOFF-MP-WEB-SESSION.md`. Together these two replace the single
`HANDOFF-MULTIPLAYER-EXPANSION.md` survey (its research is carried forward in full, corrected).

**This doc covers everything that cannot be done from a Claude Code web/cloud session**, and must
happen on Matt's machine (`C:\Users\powel\OneDrive\Documents\CLAUDE CODE\Personal\Game-Hub\`) with
real devices. There are four distinct categories, and only the first is a whole game.

Read root `CLAUDE.md` first (THE LAW especially), then `js/CLAUDE.md:271`.

---

## Why these four categories can't move to the cloud

Measured in a cloud session on 2026-07-26, not assumed:

- **Firebase is unreachable, absolutely.** `js/firebase-boot.js` dynamic-imports the SDK from
  `https://www.gstatic.com/firebasejs/10.12.2/...`; that host returns **403 CONNECT (policy
  denial)** from the environment's network proxy, and the RTDB host is unreachable too. So
  `getStatsApp()` resolves `null` and **`js/net.js` is inert for the entire session** — no room is
  ever created, no move appended, no recovery round-tripped, regardless of how many browser
  contexts are driven. Confirmed live: driving the hub under Playwright logs the app's own
  `[stats-net] sync skipped: Firebase unavailable`.
- **`../Parchís/` does not exist in the container.** The cloud session clones only the
  `mpowell95/game-hub` remote; the sibling project is a separate local folder, not a remote of
  anything here, and `recombine.mjs` lives inside it.
- **There are no real devices, no real latency, no real backgrounding, and no PWA install.**

Everything else — all the code, all the headless proof, all the docs — is web-session work and is
specified in the companion doc. **Do not duplicate that work here.**

---

## Category A — Parchís, entirely

This is the only game in the whole plan that cannot be *started* in a cloud session.

- **Current state:** solo vs AI (2-4 total seats), launch-out `href:`. Source lives entirely
  outside this repo at `../Parchís/src/*.js`, combined into `parchis/index.html` via
  `node recombine.mjs`. **Never hand-edit `parchis/index.html`** — `parchis/CLAUDE.md`'s build rule
  forbids it and the next `recombine.mjs` run would silently discard the work. No multiplayer
  exists (verified: no `multiplayer`/`net.js`/`room`/`peer`/`socket` references in the built file).
- **Serializability precedent is genuine:** the `Engine` object already supports
  `serialize`/`deserialize` via plain `JSON.stringify`/`JSON.parse`, used internally by the AI's
  lookahead search — unlike Monopoly Deal.
- **Dice are the one real engine gap:** `d6()` calls raw `Math.random()` directly
  (`parchis/index.html:2057` and `:2972` in the built file), with **no injectable rng/seed hook** —
  unlike every other in-scope game. Two options:
  - **Transmit the rolled value as part of each move** (recommended): no engine change needed, and
    it matches how `net.js`'s move log already works.
  - Add a seeding hook to the sibling engine: more invasive, and every change there needs a
    `recombine.mjs` rebuild before it's testable.
- **Why it's hard beyond that:** (1) 2-4 players exceeds `net.js`'s 2-role model — take path (A),
  cap MP at 2 humans with the rest AI-filled, same as every other game (see the companion doc's
  N-player section); (2) every MP-glue edit needs `recombine.mjs` re-run before it's testable in
  the hub, a build step no other game has; (3) extra-turn-on-six and capture rules add move-payload
  complexity similar in kind to Dots and Boxes' chain rule, not a new category of problem.
- **Sequencing:** last. Do not start Parchís until at least one tier-1/2 game has shipped MP
  end-to-end **including its Category B pass below**, so the `hash.js`, save-key and recovery
  conventions are proven on a game that doesn't also carry a build-step dependency.
- **Before scoping a session for it:** confirm `../Parchís/` is actually present and that
  `node recombine.mjs` runs clean on an untouched checkout. Note its em-dash check will fail the
  build on any em dash.

---

## Category B — real-network verification, for every game the web session ships

**This is the gate between "code written" and "multiplayer works."** A web session can prove the
protocol headlessly against `FakeRoom` and nothing more; it is instructed to hand off with exactly
that claim. Everything below is what turns that into a real one.

Run this per game, with **two real devices** (not two tabs on one machine — same-device tabs share
a clock, a network path, and often a `deviceId`, which hides precisely the bugs this pass exists
to find).

### B1 — the happy path
- [ ] Host creates a room; the 4-char code appears. Guest joins by code. Both reach the game screen.
- [ ] Play a full match to a natural finish. **No hash mismatch logged on either side.**
- [ ] Both devices show the same final result, with each player's own seat rendered as "you".
- [ ] Both devices record the match (My Stats increments on each), and head-to-head shows the real
      opponent's name.

### B2 — the seat-identity sweep (invariant #2 and `_localSeat()`)
The single highest-yield check, and unprovable without two devices.
- [ ] **From the GUEST's device specifically:** its own hand/side/turn indicator is its own, not the
      host's. A guest's human is seat 1 — every "self" read must have gone through `_localSeat()`.
- [ ] The guest's win/loss is recorded as the *guest's* result. A guest recording the host's result
      is a THE LAW rule 2 violation (a loss written as a win is not additive-safe and cannot be
      undone) — **if this fails, stop and fix before any further play, and check whether any bad
      row already landed.**

### B3 — desync, recovery, rejoin
- [ ] Force a mismatch (or wait for one). Host publishes recovery; guest applies it and play
      continues. **Check the guest's human agent is still the guest's** after recovery (invariant
      #2's exact failure was recovery handing the guest's human to the host's seat).
- [ ] Background the guest's app mid-match, return within 30 minutes → it reattaches to the same
      room and fast-replays the moves that landed while away. Scores and round number survive
      (invariant #5: a round-boundary resume must keep scores, never re-init).
- [ ] Rejoin does **not** re-apply an already-applied move (invariant #4 — the saved seq must not
      be one low).
- [ ] Airplane-mode one device for ~30s mid-match, then restore.
- [ ] Leave and re-enter via the hub launcher: the "leave game?" confirm must fire during an active
      MP match (`isInProgress()` returns true for MP even in games whose solo mode auto-resumes).

### B4 — the two latency questions a web session explicitly could not de-risk
Both are flagged in the companion doc for exactly this pass:
- [ ] **Dots and Boxes — per-edge move granularity.** A long chain capture on Large fires many
      rapid `appendMove` calls inside one real turn. Confirm they land in order and the guest's
      board keeps up. If per-edge proves too chatty against real RTDB write timing, that's the
      signal to reconsider batching a chain as one move.
- [ ] **Boggle — synced countdown clock skew.** Both sides start the timer off the room's
      `round`/`updated` timestamp. With two real devices, confirm the clocks agree closely enough
      that neither player loses meaningful time, and that end-of-round submission from both sides
      reveals cleanly.

### B5 — sanity
- [ ] Solo play in the same game is unaffected (it just had its seat model rewritten).
- [ ] The pre-existing Chinchón and Escoba MP paths still work — they share `js/net.js`.

**Any B-series failure goes back to a web session as a code fix**, with the observed symptom. The
web session can reproduce most protocol bugs in `test-mp-lockstep.mjs` once it knows what to look
for — and per the repo's own convention, a fixed MP bug earns a new `[KNOWN-BUG PROBE]` assertion
so it stays fixed.

---

## Category C — anything that touches Firebase itself

A cloud session cannot do any of this, and equally importantly **cannot run the backup that the
repo requires first** — which is a second, independent reason it must never try.

- [ ] **`node backups/rtdb-backup.mjs` BEFORE any script that writes to Firebase, any rules change,
      any schema change.** This is the repo's standing rule, not a suggestion. Snapshots are
      gitignored (`backups/*.json`) because this is a public repo and they hold every player's real
      name, code and stats — keep them that way.
- [ ] Any `database.rules.json` change needed for `rooms/<CODE>` as new games start writing there.
      Review the rules against the new traffic **before** the first real match, and back up first.
- [ ] If MP ever needs schema changes under `rooms/`, they are local-only, backed up first, and
      verified by fresh re-read (THE LAW rule 6: no silent write failures).
- [ ] **Never touch `players/<deviceId>` or `gamehub.stats` shapes as part of MP work.** MP records
      through the existing per-game recorders and `recordHeadToHead`; if a change seems to require
      touching stored stats shapes, stop — that's a separate handoff under THE LAW.

### The N-player extension (path B) — decided, and its verification lands here

**DECIDED 2026-07-26 (Matt): MP must support 2-4 players for the multi-seat games** (Uno, Monopoly
Deal, Parchís, Escoba). Extending `js/net.js` to a `guests: []` array is therefore required work,
not a deferred maybe. See `HANDOFF-MP-ROADMAP.md` phase 3 for scope and the three open seat-count
questions.

**It cannot be validated in a cloud session at all** — its correctness depends on real
reconnect and latency behaviour with 3+ concurrent writers, which is precisely what a headless
`FakeRoom` cannot model. So this pass is mandatory, not optional:

- [ ] Back up first (`node backups/rtdb-backup.mjs`), then review `database.rules.json` against
      N-seat room traffic **before** the first real 3+ player match.
- [ ] Chinchón and Escoba's existing **2-player** MP still works after the change — they are in
      production and are the backward-compatibility test cases.
- [ ] A real 3-seat match and a real 4-seat match complete on real devices.
- [ ] Seat identity holds for **every** non-host seat, not just seat 1 — run B2 from each guest
      device in turn. `_localSeat()` becomes "my index among N" and this is where it breaks.
- [ ] Mid-match: one seat leaves and does not return. Confirm the agreed behaviour actually happens
      rather than hanging the remaining players.
- [ ] Head-to-head records one row per opponent (additive per-opponent, THE LAW rule 2 safe).
- [ ] An old-build device is handed a new-shape room and degrades gracefully rather than corrupting
      it (the room `v` field is the hook for this).

---

## Category D — deploy and PWA verification

- [ ] `node run-all-tests.mjs` and `node validate-sw-assets.mjs` green before deploying (both also
      run in a web session — this is the last-line re-check, not the first).
- [ ] Deploy, then **watch the hub's version pill**. If it shows `vN → vN+1` and the arrow never
      resolves after a reload or two, **the new service worker's install failed** — almost always
      one `ASSETS` entry 404ing, which is atomic: the whole install aborts silently and the previous
      worker keeps serving the old build offline, with no other visible symptom. This is the tell to
      check before suspecting anything else when a deploy "didn't take." See `RESTORE.md`.
- [ ] Install the PWA on a real phone and play an MP match from the installed app, not just the
      browser tab. Confirm the new `hash.js` is precached (offline standalone play).
- [ ] Confirm the game's standalone page (`/<game>/`) still works, and that its `index.html` is in
      `sw.js`'s `ASSETS` — Connect Four's was missing for a long time and silently broke offline
      standalone play with no other symptom.

---

## Acceptance — a game's MP is "done" when

1. Its web-session checklist is complete (companion doc).
2. **Category B passes on two real devices**, B2 especially.
3. Category C is clean: a backup exists from before anything wrote to Firebase, and no player-data
   shape changed.
4. Category D passes: deployed, version pill resolved, PWA plays MP on a real phone.
5. `<game>/CLAUDE.md`, root `CLAUDE.md`, and `js/CLAUDE.md` reflect it — including all three places
   "Chinchón and Escoba" is written down as the complete MP set (`CLAUDE.md:127`,
   `js/CLAUDE.md:94`, `js/CLAUDE.md:273`). **A milestone is not done until CLAUDE.md reflects it**
   (THE LAW rule 9).

---

## Inbox — handoffs from web sessions

Web sessions append here on completion: game, branch/commit, design choices that could not be
verified without a real network, anything the headless harness stubbed or elided, and the honest
status line.

### Tic Tac Toe — roadmap phase 1 (2026-07-27)

**Branch `claude/mp-tictactoe-rruu9j`.** Both variants (Classic and Ultimate), 2 human seats,
host 0 / guest 1. **`js/net.js` was not touched.**

**Status: protocol proven headlessly against FakeRoom; real-room behaviour unverified.**
No room has ever been created from this session — Firebase is unreachable by network policy
(`www.gstatic.com:443` → 403 CONNECT), so `net.js` was inert throughout. Nothing below is a
claim that multiplayer works.

What IS verified here: `node run-all-tests.mjs` → 19 suites ran, 2 skipped (jsdom), 0 failed.
`node validate-sw-assets.mjs` → v223, 237 entries, all present. `test-mp-lockstep.mjs` gained a
T1-T7 block driving two real engines against each other over `FakeRoom`, with all five
`js/CLAUDE.md:271` invariants ported into this game's vocabulary and green. **Each of the five
was mutation-tested** — the mirror was deliberately broken five ways and each probe went red for
its own defect, so none of them is green-by-vacuity. Solo play was re-checked in a real browser
(Playwright + the bundled Chromium): Classic to a finish, Ultimate mid-game autosave and reload
resume, stats recorded under the chosen AI tier, no MP key written by solo play, the module still
mounts in-hub, and a failed host/join attempt lands on a graceful "Offline" message instead of a
crash.

**Design choices that could not be verified without a real network** — these are the ones to
watch during Category B:

1. **The room hosts a rematch SERIES, not one match.** A `round` record is one game; `round.n`
   is the game number and `round.dealer` carries the seat that plays X. Consequences to check
   live: the host tapping "Play again" must move BOTH devices to game 2, the guest must adopt
   the host's opening seat (which alternates), and the series tally must agree on both screens.
2. **`net.js`'s `writeResult` is deliberately never called**, because it sets `status:'ended'`
   and would kill a room meant to host the next game. So `status:'ended'` is read as "the other
   device abandoned". Check that a real Leave on either side shows the other the "Opponent left"
   modal, and that backgrounding (hub back button, locking the phone) does NOT.
3. **Rejoin timing.** The MP autosave has a 30-minute window and the guest re-`joinRoom`s by
   `deviceId`. Untested against real backgrounding: close the PWA mid-game on the guest, reopen,
   confirm it lands back on the live board rather than the setup screen, with the series intact.
4. **The divergence latch.** On a mismatch the host takes the seq and publishes a snapshot; the
   guest sets `mp.awaitingRecovery` and stops consuming the log until it lands. Under real
   latency the host's answer takes a round trip that `FakeRoom` resolves in a microtask — worth
   forcing one desync deliberately if you can, and confirming the "Resyncing..." status clears.
5. **Heartbeat staleness.** `MP_STALE_MS` is 60s; the "Opponent disconnected" status has only
   ever been exercised against a fake clock.

**What the harness stubbed or elided** (where to look if something behaves oddly live):

- `net.js`'s room lifecycle: `createRoom`/`joinRoom`/`heartbeat`/`leaveRoom` and the SW-version
  match on join are all absent from `FakeRoom`. Lobby flow, room codes, the "wrong game" and
  "room full" errors, and the update-required path are **entirely unexercised**.
- The local human's tap is stood in for by a scripted policy (`takeTurnIfMine`, marked
  HARNESS ONLY). All render/DOM paths are outside the harness by construction.
- `_resolveStarter()` reads localStorage and the setup screen; the harness passes the resolved
  seat straight in, so the Alternate-across-a-series behaviour is only checked at the protocol
  level, not through the settings UI.
- Stats are captured into an array instead of written, so `recordTicTacToe`/`recordHeadToHead`
  are proven to be CALLED with the right arguments (the guest's own result, the `'mp'` bucket)
  but not proven to land in `gamehub.stats`. **B2 is still the priority check.**
- One known real-network gap with no headless expression: a move appended while offline advances
  the local seq with nothing written to the room, leaving a gap the peer waits on. Chinchón and
  Escoba have the same property; recovery is the backstop.

**One shared-file change beyond this game:** `js/game-stats-ui.js` gained a `DIFF_META` row and
`js/strings.js` a `gs_diff_mp` label, so the new `'mp'` difficulty bucket renders with a real
name. MP results record under that bucket rather than inheriting whatever AI tier the setup
screen was showing (the wart the web-session doc flags in both reference games). `tierOf('mp')`
is null, so those plays count in every total and in the leaderboard's All filter and claim no
tier pill — additive, and no existing record is touched.
