# Game Hub — Architecture Review

Read-only structural review, July 2026. Scope: the shape of the system, not line-level bugs.
Sections are written incrementally; confidence tags on judgment calls.

---

## S1 — System map

### What is actually built

**Hub shell.** `index.html` (34 lines) boots `js/hub.js` (`Hub` class, 626 lines): a launcher
grid rendered from a hardcoded `GAMES` array (id, title, blurb, inline-SVG art, accent, and
either `module:` or `href:`). Module games are mounted by dynamic `import()` into one shared
`<section data-role="game">`; the grid is hidden, not unmounted. Back-navigation calls the
module's `destroy()` and reuses the same container for the next game. An `immersive` flag
(escoba, mancala, ball-run) collapses the hub header to a floating back button.

**The module contract, as practiced.** CLAUDE.md says a game exports "exactly"
`init(container)` / `destroy()`. Reality: every one of the seven module games also exports
`isInProgress()` (hub.js:582 probes for it to gate the leave-game confirm), and the hub relies
on it. The contract has a third member that the documentation doesn't admit to. Games must also
run standalone from `<game>/index.html`. Compliance is otherwise real — all seven module games
export the trio and a default object (verified by grep; per-game quality assessed in S2).

**Launch-out apps.** Two live in-repo but outside the module system: `business-deal/`
(full-page PWA, `window.*` globals, its own nested service worker) and `parchis/` (a 3,477-line
compiled single file built in the sibling `../Parchís/` project by `recombine.mjs` and copied
in). Both are linked as plain `<a href>` cards. Parchís is precached by the root SW;
Business Deal is *not* — it is served entirely by its own nested SW (see S4 for the seam
this creates around `js/game-stats-global.js`).

**Shared modules** (the part CLAUDE.md's architecture diagram omits almost entirely):

| Module | Role |
|---|---|
| `js/profile-store.js` (83) | validated read/write of `gamehub.profile`; player-code helpers |
| `js/game-stats.js` (379) | unified per-device stats in `gamehub.stats`; one bespoke `recordX()` per game plus generic `recordResult`; legacy-store folds and the Ball Run migration machinery |
| `js/stats-net.js` (134) | Firebase mirror of profile+stats to `players/<deviceId>`; username reservation registry |
| `js/players-agg.js` (174) | pure identity-graph aggregation (code ∪ name union-find) of synced devices into per-person rows |
| `js/game-stats-ui.js` (347) | "My Stats" overlay; per-game tailored screens |
| `js/leaderboard-ui.js` (252) | "Leaderboards" overlay; live `watchPlayers` subscription |
| `js/net.js` (205) | multiplayer room layer (`rooms/<CODE>`, lockstep move log, heartbeat, recovery) used by Chinchón and Escoba |
| `js/game-stats-global.js` (60) | a non-ESM "classic" port of game-stats.js's recorder, exposed as `window.__ghStats` for Business Deal and Parchís — a second, parallel implementation of the stats-write path |
| `js/a2hs.js` (166) | add-to-home-screen bottom sheet; polls hub DOM state to avoid overlay collisions |
| `js/challenge/` (~10 modules + assets) | retired gift/challenge system — see below |

**Firebase layers.** One project (`js/firebase-config.js`), anonymous auth, RTDB rules
`auth != null` (known-intentional, effectively open since anyone can sign in anonymously).
Three separate client layers each with their own SDK-loading `init()`: `stats-net.js`
(named app `'stats'`), `net.js` (same named app, fetch-or-create), and
`js/challenge/challenge-net.js` (default app). The named-vs-default split exists so the
challenge and stats stacks could coexist on one page. Node ownership is disciplined by
convention: stats-net touches `players/` + `usernames/`, net.js touches `rooms/` only,
challenge-net touches its own nodes. Nothing enforces this but comments.

**Service worker.** Root `sw.js` (223 lines): a hand-maintained `ASSETS` precache list
(~180 entries incl. two generated deck loops), manual `CACHE = 'game-hub-v149'` bump per
deploy, network-first with `cache: 'reload'` for code (a hard-won fix — the comment documents
the browser-HTTP-cache staleness incident), cache-first for images, `GET_VERSION`
MessageChannel protocol serving the hub's version pill and net.js's room-version stamp.
Business Deal registers a second, nested SW at `business-deal/sw.js` with its own scope
inside the root SW's scope.

**Identity model.** Per-device UUID (`gamehub.deviceId`) is the storage key; a claimable
5-char player code (`profile.playerId`) plus profile name group devices into people at
*read* time (players-agg union-find). Stats are never merged at rest — aggregation is
display-time only. This is genuinely good design. The hub's first-run gate (name-or-code)
feeds it.

### The challenge footprint (retired, still load-bearing)

The hidden-gift system is "retired" (M3b) but is not structurally gone:

- `js/hub.js` imports `isChallengeActive / isAdmin / isDevProfile` from
  `js/challenge/hooks.js` on every load; `js/game-stats-ui.js` imports `isDevProfile`.
- **`isDevProfile` — the gate for showing unreleased (`devOnly`) games — is implemented on
  top of the challenge's `secrets.js` hash list.** A retired one-off gift feature is now the
  hub's de facto role/permission system. That is the single most consequential piece of
  entanglement: every future "test this game before release" flow routes through
  challenge-era code.
- The SW still precaches all ten challenge modules plus `css/challenge.css` (380 lines),
  including `challenge-ui.js`/`unlock.js`, which the SW's own comment admits are
  "unimported dead modules, kept precached only for reversibility."
- Business Deal ships `business-deal/js/challenge-hook.js` (its inlined copy of the hook
  subset — assessed in S3).

### Where reality diverges from CLAUDE.md

1. **The documented architecture is ~40% of the running system.** The "Architecture" diagram
   lists 7 files; the stats stack, both overlay UIs, the Firebase/net layers, players-agg,
   a2hs, and the challenge directory — roughly 2,000 lines of shared shell code and every
   networked feature — appear nowhere in it. The games table documents 6 of 9 games (Filler,
   Nuts & Bolts, Ball Run are absent; two of those three are among the newest, i.e. doc
   drift is accelerating, not shrinking).
2. **The module contract is understated.** `isInProgress()` is a de facto third contract
   member; `immersive` is a de facto registry flag; the settings-precedence rule (own
   settings > profile > defaults) is documented, but the settings *key naming* convention is
   not — and S2 shows three generations of key styles as a result.
3. **"Only the profile page writes gamehub.profile" is no longer true.** `js/hub.js`'s
   first-run gate writes it (`saveProfile` at hub.js:498/514, adding `playerId` and adopting
   a linked owner's name/emoji). The evolution was reasonable; the invariant in the doc is
   simply stale, and stale invariants about who-writes-what are the dangerous kind.
4. **THE LAW section is accurate and clearly battle-tested** — the git history (d7f284b →
   a5571f3, then 3898a53) matches the narrative. No divergence found there; the additive-only
   discipline in `game-stats.js` is real.

Confidence: high on all of S1 (directly read).

---

## S2 — Consistency matrix

Legend: **✓** conforms to the current best practice in the repo · **±** works but diverges
from it · **✗** absent · **—** not applicable. Footnotes carry the evidence.

| | Contract (init/destroy/isInProgress) | ESM | Settings key + style | Stats recording | Setup pattern | MP | CSS scoping | Dark mode | Engine/UI split |
|---|---|---|---|---|---|---|---|---|---|
| **Connect Four** | ✓ ¹ | ✓ | ✗ none persisted ² | ✓ `recordConnect4` | ± old flat segmented | — | ± prefix-only, `.cf-root` ³ | ✗ | ✓ clean |
| **Chinchón** | ✓ | ✓ | ± `chinchon-settings` (gen-1) + `gamehub.chinchon.mp.v1` (gen-3) ⁴ | ✓ `recordChinchon` | ✓ new accordion (copied from Escoba) | ✓ ~480 LOC | ✓ exemplary | ✓ manual toggle (only game) | ✓ clean |
| **Escoba** | ✓ ⁵ | ✓ | ± `escoba-settings`, `escoba-save` (gen-1) | ✓ `recordEscoba` | ✓ new accordion (origin) | ✓ ~410 LOC | ✓ exemplary | ✗ | ✓ clean |
| **Filler** | ✓ | ✓ | ✓ `gamehub.filler.v1` (gen-3) | ✓ `recordResult` | ± old flat segmented | — | ± root is `.filler` not `.fl-root`; prefix-only | ✗ | ✓ clean |
| **Mancala** | ✓ ⁶ | ✓ | ✓ `gamehub.mancala.v1` + `.game.v1` (gen-3) | ✓ `recordResult` (bot games only) | ± old flat segmented | — | ± root is `.mancala`; but best descendant-scoping in repo | ✗ | ✓ cleanest seam (event descriptors) |
| **Nuts & Bolts** | ✓ | ✓ | ✓ `gamehub.nutsbolts.v1` (gen-3, schema-versioned w/ migration) | ✓ `recordNutsBolts` | ± tier menu (neither pattern) | — | ✓ `.nb-root` | ✗ | ✓ clean |
| **Ball Run** | ✓ best teardown ⁷ | ✓ | ± `ballrun.*` dotted, un-namespaced (gen-2) | ✓ `recordBallRun` via verified flight recorder (best pattern) | ± flat slider | — | ✓ `.br-root`, full-bleed by design | ✗ ⁸ | ✓ cleanest split in repo (sim/track/render/input/ui) |
| **Business Deal** | ✗ full-page app | ✗ `window.*` globals | ± only `bd-stats` (gen-1); no settings key | ± dual-write: `__ghStats` + `bd-stats` ⁹ | ± own pattern | — | ✗ unprefixed globals (`#app`, `.stat`) ¹⁰ | ✗ | ± IIFE globals, but Deck/Game/AI are separated |
| **Parchís** | ✗ compiled single file | ✗ inline scripts | ± own inline state | ± `__ghStats.record('parchis')` ⁹ | ± own pattern | — | — own document | ± dark default + `body.pc-light` | — (built in sibling repo) |

¹ Two stray `setTimeout`s not cleared in `destroy()` (connect-four/js/ui.js:579, :472) — guarded, harmless, but not leak-clean.
² Difficulty/first-move reset every visit; every other AI game persists last-used. An odd gap in the oldest game.
³ Prefix (`.cf-`) is the only isolation; rules aren't descendant-scoped under `.cf-root`. Same for Filler. Only Mancala scopes every rule under its root; Chinchón/Escoba/NB/BR scope under root correctly too.
⁴ One game, two key generations — the MP save adopted the new convention while the settings key kept the old one.
⁵ `isInProgress()` deliberately returns false for solo (snapshot-resume makes leaving lossless) and true only mid-MP. Correct behavior, but it means "isInProgress" now means different things per game.
⁶ Hardcoded `return false` (mancala/js/ui.js:973) — also deliberate (autosave/resume). Same caveat as ⁵.
⁷ Full GL disposal, though no `forceContextLoss()` — see S4.
⁸ All games except Chinchón have a single fixed palette; several are intrinsically dark (Ball Run, Nuts & Bolts). "Dark mode" as a hub-wide concept doesn't exist — no `prefers-color-scheme` anywhere in the repo, including the light-only hub shell.
⁹ The `__ghStats` write is conditional and silently skipped if the global failed to load — see S4, this is the standout data-integrity issue.
¹⁰ Known-intentional exception (own full-page document, so no collision risk today).

**Storage-key naming — three generations, still non-convergent.** Gen-1 dashed
(`chinchon-settings`, `bd-stats`, `escoba-settings`); gen-2 dotted un-namespaced
(`ballrun.difficulty`); gen-3 namespaced+versioned (`gamehub.<game>.v1`). Legacy keys are
protected (intentional, not relitigated), but the point for S5 is that *new* code kept
minting new styles: Escoba (May–Jul) chose gen-1, Ball Run (Jul) chose gen-2, while
Filler/Mancala/NB chose gen-3 in the same period. The convention was never written down, so
each AI build session re-derived one.

**How inconsistent is it really?** The seven module games are *strongly* consistent where it
counts: contract shape, ESM, engine purity, stats funneling into one store, colorblind-safe
UI. The inconsistency concentrates in four places: settings-key naming (cosmetic, but
permanent — keys can never be renamed), setup-screen pattern (two generations of UX,
5 games on the old one), root-class/scoping style (three variants), and the two non-module
games which sit entirely outside every convention. Confidence: high.

---

## S3 — Duplication inventory

Ordered by consolidation value, not size.

| # | What | Copies | ~LOC dup. | Drifted? | Consolidation cost |
|---|---|---|---|---|---|
| 1 | **Stats recorder, twice**: `js/game-stats.js` (ESM) vs `js/game-stats-global.js` (classic port for BD/Parchís) | 2 | ~60 | **Yes, structurally**: the port has `foldLegacy` + generic `record` but none of the ESM file's migrations (Ball Run metric, chinchon extras). Fine today because BD/Parchís only need `record('business'/'parchis')`; every future stats change must now be evaluated against two files | **Cheap** (test that the port matches, or generate it) |
| 2 | **Firebase init ×3**: `stats-net.js`, `net.js`, `challenge/challenge-net.js` — each loads the SDK from gstatic and inits an app | 3 | ~45 | **Yes, dangerously**: stats-net calls `initializeApp('stats')` unconditionally (stats-net.js:33); net.js does `getApp`-or-create (net.js:37-38). Whichever loses the init race throws into a silent `catch` → that layer is dead for the session (see S4) | **Cheap** (one `js/firebase-app.js` helper) |
| 3 | **MP lockstep glue** in chinchon/ui.js (~480 LOC) + escoba/ui.js (~410 LOC): copy-descended (`_mpHostCreate`, `_mpRoomCallback`, `_makeRemoteAgent`, recovery, lobby UI) | 2 | ~400 shared skeleton | Deliberately diverged where turn models differ; not silently drifted (verified) | **Expensive** now; becomes mandatory the moment a third game gets MP |
| 4 | **Overlay/modal idiom**: hand-rolled scrim+card overlays in all 7 module games (~50–130 LOC each) plus the hub's twin `gs-`/`lb-` overlay shells (game-stats-ui.js / leaderboard-ui.js — near-identical tab bar, panel, `ensureCss`, `esc`, `pct`, key/close handling, ~100 LOC each) | 9 | ~600 total | The two hub overlays are true twins; per-game overlays are same-idiom, different markup | **Moderate**; hub-twin merge alone is cheap |
| 5 | **Setup accordion scaffold**: `_summaryRow`/`_seg`/toggle-row verbatim prefix-swapped between escoba and chinchon (chinchon/js/ui.js:306-315 says "mirrors Escoba's M1.2") | 2 | ~60 | No (copied recently) | **Cheap** to extract; the larger cost is migrating the 5 old-pattern setups onto it (per-game M) |
| 6 | **Profile readers**: canonical `profile-store.js` + inline copies in BD ui.js:56-75, BD challenge-hook.js:33-36, and the compiled Parchís (`readProfile`, no validation) | 4 | ~30 | **Yes, already**: BD emoji defaults `🧑`/null vs canonical `🙂`/`🤖`; BD slices 4 opponents vs contract's 3; Parchís and challenge-hook do zero normalization | **Cheap** for BD (load the ESM via a module script); Parchís fix lives in the sibling repo |
| 7 | **Challenge crypto mirror**: BD challenge-hook.js:10-36 inlines hash/obf/deobf + salts that must stay byte-identical to the retired `js/challenge/secrets.js` | 2 | ~30 | Not yet — but the pairing is invisible and the master copy is "retired" | **Cheap** (BD side is neutralized; delete or freeze with a comment) |
| 8 | **Micro-utilities**: `esc()`, `ensureStylesheet()`, `loadJSON/saveJSON` storage wrappers, AI name/emoji rosters (mancala `AI_ROSTER`, chinchon/escoba avatar lists), `shuffle()` (chinchon/deck.js:94-101 ≡ escoba/deck.js:61-68), FNV-1a `stateHash` core | 7–9 each | ~150 total | No meaningful drift | **Cheap but low value** — see S5 "live with it" |

Not counted as duplication: escoba's `cards.js`/`deck.js` vs chinchon's — these are
re-implementations sharing only `shuffle()` and an idiom, and escoba correctly *reuses*
chinchon's Anita image assets rather than copying them. The `js/challenge/` directory
(~10 modules, retired) is dead weight rather than duplication; its structural footprint is
items 6–7 plus the SW precache list and the live `hooks.js` imports noted in S1.

Confidence: high (items verified against both copies by direct read).

---

## S4 — Load-bearing fragility

The subset that threatens durability. Ordered by expected damage.

**1. The Business Deal / Parchís stats write is conditional and silently skippable.**
`_recordResult` does `if (window.__ghStats) __ghStats.record(...)` then increments
`bd-stats` unconditionally (business-deal/js/ui.js:1668-1675, empty `catch {}` on both).
`game-stats-global.js` lives *outside* the nested BD service worker's scope and is not in
its cache list — a device that installed only `/business-deal/` and goes offline loads the
page fine but `__ghStats` is undefined. Those plays land in `bd-stats` only, and because the
one-time `_leg` fold guard is already set in `gamehub.stats`, **they can never be folded in
later**. Silent, permanent under-count on the unified stats and leaderboard — precisely the
failure class THE LAW rule 6 exists for, in the one code path that doesn't follow it.
Parchís shares the conditional-write pattern but is root-SW-precached, so only a load
failure triggers it there. Confidence: high (data flow verified end-to-end).

**2. Firebase named-app init is order-dependent, and the loser dies silently.**
`stats-net.js:33` calls `initializeApp(cfg, 'stats')` unconditionally; `net.js:37-38`
does `getApp`-or-create. Both wrap everything in a `catch` that returns `_ok = false`
forever (`_tried` latches). Today the hub constructor kicks off `syncMyStats()` before any
game can touch net.js, which usually wins the race — but the SDK imports are async, so a
player who opens an MP lobby immediately after app start can have net.js create the app
first, at which point **stats sync is dead for the whole session with zero symptoms**. This
is exactly the kind of invariant no future session will know exists. Confidence: high on
the mechanism, medium on how often the race actually fires.

**3. The module contract is enforced by copy-paste alone, and the container is shared.**
Nothing checks that `destroy()` is complete; the hub reuses one DOM node for every game and
injected stylesheets accumulate for the session. The system's real isolation is CSS-prefix
discipline — which S2 shows has three variants, two of which (`.filler`, prefix-only
scoping in connect-four) work only because no one has yet minted a colliding class. A game
#10 built by copying Connect Four or Filler as the exemplar (they are the oldest and most
"template-looking") inherits the weakest patterns: prefix-only scoping, no settings
persistence, stray timers in destroy. The exemplar a future session picks is effectively
random — that is the fragility.

**4. `devOnly` gating and identity run through the retired challenge's hash list.**
`isDevProfile` (challenge/hooks.js:33-35) reads `secrets.js` hashes; BD's inlined mirror
must stay byte-identical to a file that is officially dead. Changing a profile name, salt,
or "retiring harder" (deleting `js/challenge/`) breaks: dev-game visibility, the keepsake,
BD's neutralized hooks, and two live hub imports (hub.js:10, game-stats-ui.js:13) — the hub
shell would fail to load. The challenge is retired as a *feature* but is a hard structural
dependency of the shell.

**5. Manual SW ASSETS list (decision made; residual risks worth naming).**
`cache.addAll` is atomic: one 404'd path and the new SW never installs — online users still
get fresh code (network-first), so the only symptom is the version pill never advancing and
offline serving the previous build indefinitely. With ~180 hand-maintained entries plus two
generated loops, the base rate for a miss is real (untracked WhatsApp images sitting in
`escoba/` suggest the working tree and the list drift casually). Also: room `swv` is
recorded on MP room creation but `joinRoom` never compares it, so a mid-deploy family can
lockstep two different builds against each other (net.js:111-118 checks only `room.v`).

**6. WebGL context churn in Ball Run remounts.** `renderer.dispose()` without
`forceContextLoss()`; every mount rebuilds the canvas and context, reclaimed only by GC.
Repeated hub↔game cycles can hit the browser's ~16-context cap; a second canvas game built
"the same way" would compound it and add another ~700 KB vendored engine to the precache.
Confidence: medium (mechanism certain, threshold device-dependent).

**7. Display-time identity is a graph keyed on free-text names.** players-agg unions
devices by code *or* lowercased name, with a hand-maintained `NAME_ALIAS` map
(players-agg.js:27). Family-scale fine (accepted), but note the failure shape: two people
choosing the same name merge into one leaderboard row at read time, and nothing in the UI
explains why. The soft username reservation (client-side only, admitted in stats-net.js:90-92)
is the only guard.

---

## S5 — Roadmap

### Do before adding anything else

| # | What | Why | Cost | Risk | Unblocks |
|---|---|---|---|---|---|
| 1 | **Close the `__ghStats` silent-skip** (S4-1): make BD/Parchís stats writes log loudly on skip and queue-retry (reuse the flight-recorder idiom from ball-run/js/ui.js:64-90); either add `game-stats-global.js` to BD's nested SW cache (copy it into scope) or precache BD in the root SW | The one live path where THE LAW can be violated silently today | **S** | Low — additive | Trustworthy leaderboard as MP/family usage grows |
| 2 | **One Firebase bootstrap** (S4-2): a shared `getOrInitStatsApp()` used by stats-net and net | Removes the init race; 3 copies → 1 | **S** | Low | Every future networked feature |
| 3 | **Write the real contract down**: update CLAUDE.md's contract section (isInProgress + its two legitimate meanings, `immersive`, settings-key convention `gamehub.<game>.v1`, `.xx-root` + descendant scoping, accordion setup as the reference pattern, "copy Escoba, not Connect Four" as the explicit exemplar), and extend the games table to all 9 | S2's spread exists because each AI session re-derived conventions; the doc is the compiler for this pipeline — cheapest possible leverage | **S** | None | Every future game landing consistent by default |
| 4 | **`validate-sw-assets.mjs`**: script that fails if any ASSETS entry 404s on disk or any deployed game file is missing from ASSETS; run before deploy | Converts the most likely day-scale breakage (S6) into a 2-second check | **S** | None | Safe manual deploys (the manual list itself stays, per decision) |

### Do opportunistically (when already touching the area)

| # | What | Why | Cost | Risk |
|---|---|---|---|---|
| 5 | Extract `js/ui-kit.js` (accordion `_summaryRow`/`_seg`, overlay scrim+card, `esc`, storage wrapper) and adopt it per-game **only when a game is next edited**; migrate old flat setups to the accordion the same way | Halts new duplication without a big-bang rewrite | **M** (spread) | Low per-game |
| 6 | Merge the `gs-`/`lb-` twin overlay shells into one | ~100 LOC and a whole drift surface | **S-M** | Low |
| 7 | Move `isDevProfile`/`isAdmin` into a tiny `js/roles.js` (still hash-based) so hub.js and game-stats-ui.js stop importing `challenge/hooks.js`; stop precaching the dead challenge-ui/unlock modules | Decouples the shell from the retired system without touching the keepsake | **S-M** | Low — keepsake keeps its own imports |
| 8 | Contract-test `game-stats-global.js` against `game-stats.js` (same inputs → same store) in the existing node test style | Two implementations of the LAW-critical path need a tripwire, not a merge | **S** | None |
| 9 | Enforce `swv` match (or at least warn) in `joinRoom` | Mid-deploy MP desync (S4-5) | **S** | Low |
| 10 | Ball Run: call `forceContextLoss()` in the renderer teardown | Cheap insurance on the context cap | **S** | Low |

### Not worth it — live with it

- **Renaming legacy storage keys or converging the three key generations retroactively.**
  Protected by THE LAW anyway; the win is only aesthetic. Codify the convention for new
  keys (item 3) and stop.
- **Converting Business Deal to ESM/the module contract.** Decision made, and the cost of
  the exception is now bounded: it's the S4-1 fix plus two inline mirrors to keep in sync.
  Document those two sync points in CLAUDE.md instead.
- **Extracting the MP glue now.** ~400 LOC × 2 copies that have *not* drifted and are
  each entangled with game-specific turn models. Do it as the first act of adding MP to a
  third game — not before. (If no third MP game is planned, never.)
- **Sharing the 10-line micro-utilities** (`esc`, `ensureStylesheet`, `shuffle`) outside
  of item 5. The self-contained-module rule has real value; don't trade it for 150 LOC.
- **Hub-wide dark mode.** Only Chinchón has a toggle; most games are fixed-palette by
  design. Treat per-game theming as a product choice, not debt.
- **Parchís build pipeline.** Odd, but isolated and working; its risks live in the sibling
  repo.

---

## S6 — Failure forecast

**In a DAY — a deploy misses the SW checklist.** Mechanism: the two-step manual ritual
(edit ASSETS, bump `CACHE`) plus `cache.addAll`'s atomicity: one wrong path and the new
worker silently never installs (S4-5); alternatively a bump-without-add leaves a new file
un-precached and offline half-broken. Trigger: the very next feature deploy — the last
month averaged a deploy every ~1–2 days (v132→v149). Symptom is subtle (version pill stuck;
offline serves the old build), so it survives until someone plays offline. **Address:**
prevention is item S5-4 (assets validator, trivially cheap). Detection already half-exists:
the version pill showing `vN → vN+1` that never resolves is the tell — note it in CLAUDE.md
as the diagnostic. Confidence: **high** (pure base-rate: 149 manual iterations, and the
fifth-playthrough HTTP-cache incident shows this subsystem's failures are the quiet kind).

**In a WEEK — multiplayer desyncs mid-family-match.** Mechanism: the M1–M3b lockstep stack
is the newest, least-soaked code (all landed within ~2 weeks), needs two devices to
exercise, and has two live edges: (a) mid-deploy version skew — `joinRoom` checks `room.v`
but never `swv`, so a v148 host and v149 guest lockstep different state shapes into a hash
mismatch → recovery loop (net.js:111-118); (b) iOS tab suspension kills the 10s heartbeat
and the guest's `onValue`, leaving a room that looks alive for up to the 24h TTL. The
recovery path (`writeRecovery`/`requestRecovery`) is the least-tested code in the repo.
**Address:** S5-9 (swv check, cheap) for (a); for (b), detection over prevention — surface
"opponent connection lost" from stale `lastSeen` (the data is already written every 10s,
nothing reads it aggressively). Confidence: **medium-high**.

**In a MONTH — a stats/data-shape change makes someone's history invisible again.**
Mechanism: not hypothetical — the empirical base rate. The Ball Run metric change took four
commits over a week (d7f284b → a5571f3) to stop hiding history, and produced THE LAW.
The structural conditions that caused it are still present: two parallel recorder
implementations (S3-1), visibility gates like `br.runs > 0` scattered across two UI files,
and the BD silent-skip path (S4-1) accumulating divergence that will surface as "the
leaderboard is wrong" during some future audit. **Address:** S5-1 and S5-8 directly; plus
make LAW rule 7 (replay real old stores from git history) an actual runnable test file
rather than a procedure — the repo already has the node-test idiom (players-agg.test.mjs)
to host it. Confidence: **high** that the next data-shape change is the month-scale risk;
**medium** on whether one lands within a month at current velocity (it would have, any of
the last four weeks).

**In 3 MONTHS — a September iOS release shifts PWA/SW/storage behavior under the family's
iPhones.** Mechanism: this hub is installed-PWA-first on iOS (a2hs.js exists precisely for
that), and its riskiest dependencies are exactly the surfaces Apple historically adjusts in
the fall release: SW cache eviction policy, nested-scope SW handling (the BD double-SW
arrangement), localStorage persistence for installed apps (the entire identity model is one
un-backed-up `gamehub.deviceId`), and WebGL context limits (Ball Run). A July review
puts the next major iOS ~September. **Address:** prevention isn't available; buy detection
and recovery instead — (a) the version pill plus a one-line "storage health" check (does
`gamehub.deviceId` still match what `players/<id>` last saw?) would turn "my stats
vanished" into a diagnosable state; (b) the S7-1 restore path is the real insurance,
because the Firebase mirror already holds every device's full history. Confidence:
**medium** — the specific breakage is unpredictable, but *some* iOS behavior shift landing
in a 3-month window that includes September is the way to bet; the alternative candidate
(pinned Firebase SDK 10.12.2 from gstatic breaking) is lower-likelihood.

---

## S7 — Blind spots

Three, argued honestly. None is a rehash; each is a question the charter didn't ask.

**1. You have backup without restore — and the LAW only governs code, not custody.**
Every protection in this repo guards against *code deleting data*. Nothing addresses the
data's custody: player history lives in localStorage on a handful of family phones, keyed
by a `deviceId` that exists nowhere but that phone, mirrored to a Firebase project with
open-by-design rules, no export, and no restore path. A lost/reset phone, a Safari storage
eviction, or a fat-fingered Firebase console action loses history *through the front door*
while every in-repo rule is honored. The mirror already contains everything needed —
`players/<deviceId>` holds full per-device stats — but no code can pull a record back onto
a device, and adopting an old `deviceId` onto a new phone (the correct restore, since
aggregation assumes one-device-one-record) is undocumented. **First step:** a monthly JSON
export of `players/` (even a manual console download, dated, kept outside OneDrive), plus a
ten-line documented procedure: "to restore a lost device, write its old deviceId into
`gamehub.deviceId` before first play." That's the whole insurance policy, and it costs an
afternoon.

**2. In an AI-session pipeline, CLAUDE.md is not documentation — it is the build system.**
Every inconsistency in S2 maps to a session boundary where a convention wasn't written
down: three storage-key generations, two setup patterns, three root-class styles, a
contract missing its third member. Human teams absorb unwritten conventions through code
review and memory; this project's "team" is a sequence of fresh AI sessions whose entire
inherited context *is* CLAUDE.md plus handoff files. The doc being at ~40% coverage
(S1) isn't a documentation debt, it's the mechanism generating the debt everywhere
else — and it compounds, because each divergent game becomes a plausible exemplar for the
next session to copy. The corollary nobody has stated: **doc updates are not overhead on a
milestone, they are the milestone's deliverable to the next session.** First step: S5-3,
plus a one-line rule in CLAUDE.md itself: no milestone is done until the conventions it
created or changed are reflected here.

**3. The tests guard the layer that never breaks.** Engine tests exist and pass
(chinchon, escoba, nuts-bolts, connect-four, players-agg) — and no incident in this repo's
history was an engine bug. Every incident was integration-layer: the HTTP-cache staleness
under the SW, the migration that hid Ball Run history, the stats folding subtleties. That
layer has zero automated coverage, and it is also where S4's fragilities all live (SW list,
`__ghStats` seam, init race, contract-by-convention). The asymmetry is understandable —
engines are easy to test headless — but it means the test suite's green light says nothing
about the failures that actually happen. **First step:** two node scripts in the existing
test idiom: the S5-4 assets validator, and one "device replay" test that seeds a real
old-shape `gamehub.stats` (extracted per LAW rule 7 via `git show`) and asserts the current
loaders keep it visible. Those two cover the actual incident history of this project.

---

*End of review. S1–S7 complete; written incrementally, each section usable standalone.*
