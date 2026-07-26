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

**The N-player question (path B) belongs here if it is ever taken up.** Extending `js/net.js` to a
`guests: []` array reworks shared infrastructure that Chinchón and Escoba already depend on in
production. It is the one piece of the plan that cannot be validated headlessly, so it needs a
local pass against real rooms with the existing two games before anything depends on it. The
standing recommendation remains **path (A) — cap MP at 2 humans** for every game's first pass.

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

_(empty — no game has shipped its web-session pass yet)_
