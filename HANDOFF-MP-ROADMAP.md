# HANDOFF — Multiplayer roadmap (execution order)

The sequenced plan across all games. **The two working docs are
`HANDOFF-MP-WEB-SESSION.md` (all code + headless proof) and
`HANDOFF-MP-LOCAL-MACHINE.md` (real-device verification, Firebase, Parchís).** This file is the
order to do them in, who should do each, and what is still undecided.

## Matt's decisions (2026-07-26) — these set the whole shape

1. **Boggle: hidden until reveal.** Mid-round progress is NOT visible to the opponent; the
   opponent's word list appears only at the end-of-round reveal, matching how solo already frames
   the reveal as a discrete moment. **This question is now closed** — it was the one open design
   question in the Boggle section.
2. **MP must support 2-4 players for the multi-seat games, not 2.** This **reverses** the earlier
   standing recommendation (path A, cap at 2 humans forever) and makes **path (B) — extending
   `js/net.js` to N players — required work, not a deferred maybe.** Games that are inherently
   2-player stay 2-player, which is correct and needs no protocol change.

### Which games are which (verified against the code, 2026-07-26)

| Game | Local max today | MP target |
|---|---|---|
| Uno | **2-4** (`uno/js/game.js:62` throws outside 2-4) | 2-4 → needs path B |
| Monopoly Deal | **2-5** (`ui.js:83` takes up to 4 opponents) | see open question 2 below |
| Parchís | **2-4** | 2-4 → needs path B |
| Escoba | **2-3** (`escoba/CLAUDE.md:11`, "2-3 players vs AI") | see open question 1 below |
| Chinchón | **2-4** | see open question 3 below |
| Tic Tac Toe, Connect Four, Mancala, Dots and Boxes, Filler, Boggle | 2 | 2, no protocol change |

Ball Run, Nuts & Bolts and Snake are out of scope entirely and are not touched by any phase here.

### Three open questions, flagged not assumed

1. **Escoba maxes at 3 players locally, not 4.** Its own CLAUDE.md says "2-3 players vs AI". So
   "Escoba 2-4" isn't reachable without also extending the *game* to a 4th seat, which is separate
   work from the network protocol. **Assumed for now: Escoba MP = 2-3, matching its local max.**
2. **Monopoly Deal supports 2-5 locally**, one more than the "2-4" specified. **Assumed for now:
   MP = 2-4 as specified**, with the 5-player local mode staying solo-only. Say the word if MP
   should match local and go to 5.
3. **Chinchón is 2-4 locally and already has shipped 2-player MP** — the identical position to
   Escoba, but it wasn't in the list. **Assumed for now: NOT included**, i.e. Chinchón MP stays at
   2 humans. It is cheap to add to phase 4 if wanted, since path B will already exist.

The default in all three cases is "match the game's existing local max, and don't extend a game's
seat count as a side effect of network work." Correct me on any of them and the affected phase-4
item changes; nothing before phase 4 is affected either way.

---

## Why path B comes AFTER the 2-player games, not first

It is tempting to build the N-player protocol first since so much depends on it. Don't:

- **No convention template exists yet.** No game outside Chinchón/Escoba has a `hash.js`, a
  `_localSeat()`, an MP save key, or a translated invariant probe. Doing shared-infrastructure
  surgery before any of that is settled means inventing the protocol and the conventions at once.
- **Only two test cases, both legacy.** Designing the N-player protocol against Chinchón and
  Escoba alone means designing against two games that predate every convention. A third,
  freshly-built consumer (Tic Tac Toe) is a much better compatibility target.
- **It cannot be validated headlessly.** Path B is the one piece of this whole plan whose
  correctness depends on real reconnect/latency behaviour with 3+ live writers, so it needs a local
  verification pass — which means it needs the local pass to already be a practised routine.

**The cost of this ordering, stated plainly:** Uno is the easiest N-player game and would otherwise
be first, but it is now gated behind the hardest infrastructure work and lands in phase 4. That is
a real consequence of the 2-4 decision, not an oversight.

---

## The phases

### Phase 0 — done / skipped

- [x] **0a. Handoff docs merged to `main`** (`275a94b`). Any session can now read them from `main`.
- [ ] ~~0b. Connect Four stale doc row~~ — **skipped by request.** Still outstanding: root
      `CLAUDE.md`'s games table says Connect Four's settings key is "none (persists nothing)"; it
      persists `gamehub.connect4.v1` and `gamehub.connect4.save.v1`. Whoever does phase 2's
      Connect Four item should fix it in passing (it's called out in that game's section).
- **Housekeeping:** deleting the superseded remote branch
  `claude/multiplayer-handoff-games-9hfq6t` failed from this environment (the git proxy rejected
  the delete). Delete it from the GitHub UI when convenient — it holds only the uncorrected
  original survey, whose content is fully carried forward.

### Phase 1 — Tic Tac Toe: prove the conventions — **Opus, high effort**

2-player, no protocol change, simplest engine in the repo (690-line `ui.js`, no chain rule, no
Worker, no rng). Both variants. Everything phases 2-4 copy is established here: the `hash.js`
shape, `_localSeat()`, the MP save key pattern, and the five invariant probes translated into a
game that shares none of Chinchón's vocabulary.

**Why Opus:** the invariants are written in Chinchón/Escoba's terms (rounds, decks, dealers,
`matchOver`, `presetStockResets`). Tic Tac Toe has none of those concepts. Porting the probes means
understanding *why* each bug happened well enough to find its analogue in a differently-shaped
game, and judging honestly when one doesn't map at all — #3 (consumed queue) and #5 (round-boundary
resume) may have no equivalent. A silently dropped probe is invisible until the bug returns.

→ **Prompt in "Prompts" below.** Then run the phase-1 verification pass before anything else starts.

### Phase 2 — the genuinely 2-player games — **Sonnet, medium-high** (except Boggle)

All fine on today's 2-role protocol; none of these ever needs path B. One game per session, in
this order, each followed by a local verification pass:

1. **Mancala** — easiest: `mode:'friend'` (`ui.js:622`) already proves two human seats work; only
   network-routing seat 1 is missing. Deterministic engine, no seeding.
2. **Filler** — `newGame(rng)` already injectable; host seeds the board via room `config`, both
   sides generate locally.
3. **Dots and Boxes** — design per-edge move granularity; **flag the chain-capture latency question
   for the local pass**, it cannot be settled in a web session.
4. **Connect Four** — Worker/network race on the Expert tier; decide `_statsDisqualified` explicitly
   (recommend: never disqualify a real MP match, and don't offer undo against a live opponent).
   **Fix the stale root `CLAUDE.md` row here.**
5. **Boggle — Opus, high effort.** Not turn-based; needs the simultaneous-reveal model designed
   properly. **Decision 1 above closes its open question: hidden until reveal.** Seeded board via
   room `config`, synced countdown off the room timestamp, one word-list write per side at round
   end, true duplicate handling at reveal. Do not force lockstep onto it.

### Phase 3 — extend `js/net.js` to N players (path B) — **Opus, high effort, own handoff**

The prerequisite for everything in phase 4. **This needs its own handoff document at
`HANDOFF-DOTS-BOXES.md` depth before coding starts** — it is shared infrastructure that two
production games depend on, and this roadmap entry is a brief, not a spec.

Scope, as currently understood:

- **`guests: []` instead of a single `guest`.** The room shape already carries a `v` field — bump
  it and support both shapes, so a device on the old build isn't handed a room it can't parse.
  `joinRoom`'s `{error:'full'}` becomes seat-count-aware.
- **Seq discipline for 3+ writers.** Today `appendMove` relies on two sides agreeing on a shared
  strictly-increasing counter. With 3-4 writers, agreeing on "next seq" is the core problem to
  solve, and it is where a desync will live.
- **Per-seat join/leave/reconnect/heartbeat.** Today "the guest left" is one case; with 4 seats it's
  a matrix. Decide what happens to a match when seat 3 leaves and doesn't return.
- **Recovery with N seats.** Invariant #2 generalizes: the receiver must remap agents by fixed seat
  for *every* seat, and `_localSeat()` becomes "my index among N", not "0 or 1".
- **Head-to-head with N opponents.** `recordHeadToHead(gameId, opponent, won)` takes ONE opponent.
  `gamehub.stats -> h2h[gameId][opponentDeviceId] = {name,w,l}` is keyed per-opponent, so calling
  it once per opponent is naturally additive and LAW-safe — that's the recommended answer.
  Separately note: `js/players-agg.js` does not aggregate `h2h` at all today. Nothing displays it
  yet, so nothing is broken, but if h2h ever gets a screen it needs a `players-agg` branch per root
  `CLAUDE.md`'s touchpoint-7 rule.
- **Backward compatibility is a hard requirement.** Chinchón and Escoba are in production. Their
  existing 2-player MP must keep working across the change, and `test-mp-lockstep.mjs`'s five
  probes must stay green throughout.
- **Mandatory local verification** (`HANDOFF-MP-LOCAL-MACHINE.md`, Category C) with real devices at
  3 and 4 seats, plus a rules review before the first real N-player match, backed up first.

### Phase 4 — the N-player games — after phase 3 only

1. **UN-6 first** (Sonnet, medium) — ship Uno's hand sort toggle from `HANDOFF-UNO-VISUAL.md`
   before Uno MP, so two sessions don't fight over `uno/js/ui.js`. Outstanding today:
   `uno/js/ui.js:644` already carries a comment anticipating "UN-6's `sortedHand()`".
2. **Uno MP, 2-4** (Sonnet, med-high) — flag-driven seats (`seats[]` + `_isAI`), no agent object to
   swap. Also wire head-to-head capture, or defer it explicitly again.
3. **Escoba MP extension, 2→2-3** (Sonnet, med-high) — retrofit a shipped production game onto the
   N-player protocol. See open question 1.
4. **Chinchón MP extension, 2→2-4** (Sonnet, med-high) — **only if you confirm open question 3.**
5. **Monopoly Deal MP** (Opus, high) — the largest single task in the plan: restructuring
   `playTurn()`'s `await` chain into discrete resumable steps, plus real hidden information (never
   broadcast another player's hand) and a non-ESM stack with no path to `import js/net.js` today.
6. **Parchís MP** (Opus, high, **local machine only**) — `../Parchís/` isn't in a cloud container
   and `recombine.mjs` lives inside it. Never hand-edit `parchis/index.html`. Recommended dice
   approach: transmit the rolled value in each move rather than adding a seed hook.

### Ongoing — after every single game

Run `HANDOFF-MP-LOCAL-MACHINE.md`'s Category B on **two real devices** (not two tabs — same-device
tabs share a clock, a network path and often a `deviceId`, hiding exactly these bugs). **B2, the
guest seat-identity check, is the priority**: a guest recording the host's result is a THE LAW rule
2 violation. Don't stack three games and verify once.

---

## Prompts

### Phase 1 — Tic Tac Toe (Opus, high effort)

```
Read HANDOFF-MP-WEB-SESSION.md in full, then js/CLAUDE.md:271 ("Multiplayer
lockstep — invariants"), then root CLAUDE.md. HANDOFF-MP-ROADMAP.md has the
sequencing context: you are phase 1, and every convention you establish is what
phases 2-4 copy.

Implement multiplayer for Tic Tac Toe only — both variants, Classic and
Ultimate. Follow the web-session doc's touchpoint checklist 1-8 and its
definition of done. Do not start any other game; Uno's visual rebuild (UN-6) is
mid-flight in the same file it would need.

Non-negotiable:
- Tic Tac Toe is a 2-player game: exactly 2 human seats, host 0 / guest 1, and
  do not touch js/net.js. (A separate later phase extends the protocol to 2-4
  players for the multi-seat games; that is explicitly not your job.)
- Build _localSeat() in from the start — a guest's human is seat 1.
- New key gamehub.tictactoe.mp.v1. Never rename or repurpose an existing key.
- Port all five invariant probes into Tic Tac Toe's own event vocabulary. If one
  genuinely doesn't apply, say so with the reason — don't silently drop it.
- node run-all-tests.mjs and node validate-sw-assets.mjs both green before you
  finish.

Firebase is unreachable here by network policy, so you cannot test a real room.
Don't try to route around it, and don't report that multiplayer works. Your
honest status line is: "protocol proven headlessly against FakeRoom; real-room
behaviour unverified."

Finish by appending your handoff to the inbox at the bottom of
HANDOFF-MP-LOCAL-MACHINE.md. Develop, commit and push on branch <name>.
```

### Phase 2 — template (Sonnet, med-high; Boggle → Opus, high)

```
Read HANDOFF-MP-WEB-SESSION.md in full, then js/CLAUDE.md:271, then root
CLAUDE.md. Then read tic-tac-toe/js/hash.js, the _mp* methods in
tic-tac-toe/js/ui.js, and its lockstep test — that game shipped this pass first
and is your in-repo template.

Implement multiplayer for <GAME> only, following its section in the handoff doc
plus the touchpoint checklist 1-8. <GAME> is a 2-player game: exactly 2 human
seats, no js/net.js changes, _localSeat() from the start, new key
gamehub.<game>.mp.v1, all five invariant probes ported to this game's own
vocabulary, run-all-tests.mjs and validate-sw-assets.mjs green.

Firebase is unreachable here. Don't report that multiplayer works — the honest
status is "protocol proven headlessly against FakeRoom; real-room behaviour
unverified." Append your handoff to the inbox in HANDOFF-MP-LOCAL-MACHINE.md.
Branch <name>.
```

### Verification pass — after every game (Sonnet, medium, local machine)

```
Read HANDOFF-MP-LOCAL-MACHINE.md, Category B. <GAME>'s multiplayer was built in
a cloud session and is headlessly proven only — no real room has ever been
created. Walk me through B1-B5 on two real devices and record each result.

B2 is the priority: from the GUEST's device, confirm its own seat renders as
"you" and its own win/loss is recorded as its own. A guest recording the host's
result is a THE LAW rule 2 violation — if that fails, stop everything and tell
me before any further play.

Then Category C (backup first) and Category D (deploy, version pill, PWA on a
real phone). Report failures as symptoms; code fixes go back to a cloud session.
```

### Phase 3 — write the path-B handoff first (Opus, high effort)

```
Read HANDOFF-MP-ROADMAP.md phase 3, HANDOFF-MP-WEB-SESSION.md's js/net.js
contract and five invariants, js/CLAUDE.md:271, and js/net.js itself.

Do NOT write protocol code yet. Produce a handoff document for extending
js/net.js from 2 roles to N players (2-4), at HANDOFF-DOTS-BOXES.md's depth,
covering at minimum: the guests[] room shape and how the `v` field carries both
shapes; seq discipline with 3+ concurrent writers; per-seat
join/leave/reconnect/heartbeat including "seat 3 left and isn't coming back";
recovery generalized so every seat is remapped by fixed index and _localSeat()
becomes "my index among N"; head-to-head with N opponents; and how Chinchon's
and Escoba's shipped 2-player MP stays working across the change with all five
[KNOWN-BUG PROBE] assertions green throughout.

Flag every decision you cannot make from the code alone rather than assuming it.
This is shared infrastructure two production games depend on, so the document
gets reviewed before any code is written.
```

---

## Status

| Phase | Item | State |
|---|---|---|
| 0a | Docs on `main` | **done** (`275a94b`) |
| 0b | Connect Four doc row | skipped; folded into phase 2 item 4 |
| 1 | Tic Tac Toe MP | **ready to send** |
| 1v | Tic Tac Toe verification | blocked on 1 |
| 2 | Mancala, Filler, Dots and Boxes, Connect Four, Boggle | blocked on 1v |
| 3 | `js/net.js` N-player handoff, then implementation | blocked on phase 2 |
| 4 | UN-6, Uno, Escoba, Chinchón?, Monopoly Deal, Parchís | blocked on 3 |
