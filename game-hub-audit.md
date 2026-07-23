# GAME HUB AUDIT — RECONNAISSANCE (READ-ONLY)

Repo: `game-hub` (mpowell95/game-hub), local path `Connect-Four/` (misnamed folder).
Snapshot 1: as of commit `3898a53`. Snapshot 2 (this update): as of commit `739341f`, `sw.js CACHE = 'game-hub-v151'`.
Sections unchanged since Snapshot 1 are marked `(unchanged)`. Sections superseded are marked `(UPDATED)`.

## [REPO-STRUCTURE] (unchanged, + additions)

Same layout as Snapshot 1, plus:
- `js/net.js` — NEW. Multiplayer transport layer (rooms/, lockstep transport). See [MP-ARCHITECTURE].
- `js/firebase-boot.js` — NEW. Shared Firebase bootstrap for `net.js` + `stats-net.js`.
- `chinchon/js/hash.js`, `escoba/js/hash.js` — NEW. FNV-1a canonical-state hashing for lockstep verification.
- `js/challenge/keepsake.js` — NEW. Read-only replacement UI for the retired challenge system.
- `test-recorder-contract.mjs`, `test-stats-replay.mjs`, `test-mp-lockstep.mjs`, `run-all-tests.mjs`, `validate-sw-assets.mjs` — NEW dev-tooling/test scripts, root level.
- `ARCH-REVIEW.md` — untracked (`??` in git status), a prior architecture-review writeup; informed several of the fixes below (cited inline).
- Untracked media files (`escoba/*.jpeg/webp`, `filler/*.jpg/png/PNG`) — screenshots/handoff assets, not code, not part of this audit.

No build step still, still no `.github/workflows`, still no `package.json`. Deploy is still manual `git push origin main` → GitHub Pages auto-build (unchanged).

## [FIREBASE] (UPDATED)

**Products**: still RTDB only. No Firestore.

**SDK**: still `10.12.2` via CDN `import()`. Now **three** logical consumers of Firebase, but only **two** share a bootstrap:
- `js/net.js` + `js/stats-net.js` → share `js/firebase-boot.js` → `getStatsApp()` (named app `'stats'`), bounded-retry (`MAX_ATTEMPTS=3`) shared in-flight promise — replaces the old race where two independent `initializeApp(cfg,'stats')` calls could collide and one would die into a swallowed catch for the whole session.
- `js/challenge/challenge-net.js` → still its own separate default-app boot, untouched by design (explicitly noted in `firebase-boot.js` comment).

**firebaseConfig**: unchanged shape, same file `js/firebase-config.js`.

**RTDB read/write paths** — old table (`players/`, `usernames/`, `challenge/`, `flight`, `selfies`) is **still all present and unchanged** (challenge system is retired from UI, not deleted — see [OTHER-CHANGES]). NEW path added:

`rooms/<CODE>` — full schema, written exclusively via `js/net.js`:
| Field | Written by | Notes |
|---|---|---|
| `v` | `createRoom` | schema version, checked in `joinRoom` |
| `game` | `createRoom` | game id |
| `swv` | `createRoom` | host's short SW version (`v151`), version-gates joins |
| `created`/`updated` | most functions | `updated` touched on nearly every write |
| `status` | lifecycle | `waiting` → `active` (`startRound`) → `ended` (`writeResult`/`leaveRoom`) |
| `config` | `createRoom` | game config, set once |
| `host`/`guest` | `createRoom`/`joinRoom` | `{...me, lastSeen}`, `lastSeen` refreshed by `heartbeat` |
| `round` | `startRound` | `{n, deck, dealer}` — host-published deterministic deck order |
| `moves` | `appendMove` | keyed by 4-digit padded seq → `{by,seq,move,h}` (h = state hash) |
| `recovery` | `writeRecovery`/`requestRecovery`/`clearRecovery` | host-authoritative full-state resync |
| `result` | `writeResult` | host-only, final outcome |

TTL: 24h (`ROOM_TTL_MS`), governs reclaim on create and staleness on join.

**Auth**: still anonymous-only, still device-UUID-based identity for stats (unchanged landmine — see [CONSTRAINTS]).

**Security rules**: **UNCHANGED** — still blanket `{"read": "auth != null", "write": "auth != null"}` in `database.rules.json`. No `rooms/`-specific rules added despite MP now writing live game state through this fully-open path. Documented as an accepted risk (ARCH-REVIEW.md S1), same posture as Snapshot 1 — node-ownership (`net.js` only touches `rooms/`, `stats-net.js` only touches `players/`+`usernames/`) is enforced by code convention only, not by rules.

## [MP-ARCHITECTURE] (NEW SECTION)

**`js/net.js`** (205 LOC) — transport-only layer, exports: `init()`, `createRoom(game,config,me)`, `joinRoom(code,me)`, `startRound(code,n,deckOrder,dealer)`, `appendMove(code,by,seq,move,hash)`, `writeResult(code,result)`, `writeRecovery(code,seq,snapshot)`, `requestRecovery(code,seq)`, `clearRecovery(code)`, `onRoom(code,cb)`, `heartbeat(code,role)`/`stopHeartbeat()`, `leaveRoom(code,role)`, `disconnect()`.

Imported by exactly two games: `chinchon/js/ui.js:19`, `escoba/js/ui.js:21`. No other game (Connect Four, Business Deal, Parchís, Mancala, Nuts & Bolts, Filler, Ball Run) imports it — all still solo/local-only. Ball Run imports `stats-net.js` only, not `net.js`.

**Lockstep model**: host-authoritative for round setup (deck order via `startRound`) and desync recovery (`writeRecovery` is host-only), but NOT authoritative for move legality — each side runs its own local engine/agent, appends moves to the shared log (`appendMove`), and both sides independently compute an FNV-1a state hash after applying each move (`chinchon/js/hash.js`, `escoba/js/hash.js`). Hash mismatch → guest triggers `requestRecovery`. This is deterministic-lockstep, not optimistic-rollback: determinism comes from the host publishing the shuffled deck order up front (`config.presetDeck`), so both engines consume identical card sequences instead of each shuffling independently.

**Version gating** (`f5339e3`): `joinRoom` compares joiner's live SW version (`v151`-style short string, fetched via the same `GET_VERSION` protocol as the hub's version pill) against `room.swv`. Mismatch → `{error:'version'}`. If either side reports `'unknown'`, check is skipped (fail-open) rather than blocking. Closes a real gap: before this, two family members on different deploys could lockstep into permanent hash-mismatch/recovery loops with no diagnosis.

## [HUB-ARCHITECTURE] (unchanged)

Navigation model, module contract, shared-module table, service worker caching strategy, localStorage key list — all unchanged from Snapshot 1 EXCEPT:
- SW cache version now `game-hub-v151` (was v144), `sw.js:9`.
- `validate-sw-assets.mjs` (new, root) now cross-checks the real executed `ASSETS` array against disk before each deploy — catches the exact "file deployed but not precached" failure mode that had previously bitten `connect-four/index.html`. **Not automated** (no CI/pre-commit) — invoked manually via `run-all-tests.mjs`, per CLAUDE.md's "run before every deploy" instruction.
- CLAUDE.md's games table now documents all 9 live games (was 6 of 9) — closes a doc-drift gap flagged in `ARCH-REVIEW.md`.

## [PER-GAME] (UPDATED for Escoba, Chinchón; unchanged for the rest)

### Escoba — now has full MP lockstep alongside solo
Imports `net.js`. MP glue in `escoba/js/ui.js`: `_mpHostCreate`, `_mpRoomCallback`, `_makeRemoteAgent`, `_mpApplyRecovery`, `_mpAfterPlay`, `_tryRestoreMP`. Snapshot/resume now MP-aware: autosave fires strictly AFTER `_mpAfterPlay` advances the applied-sequence counter (fixes a formerly-real off-by-one where a saved snapshot could omit the just-applied remote move). Recovery remaps `isHuman` flags by fixed seat (host=0/guest=1) rather than trusting the transmitted (sender-relative) flags. **RNG-loss-on-resume landmine still present** (`Game.fromSnapshot` hardcodes `rng = Math.random`, `escoba/js/game.js:82`) but neutralized for MP because MP rounds bypass `this.rng` entirely via `config.presetDeck`.

### Chinchón — M2a groundwork (snapshot/preset-deck/hash) → M2b MP live
"Preset deck": `config.presetDeck` (`game.js:231-233`) — host-published card order consumed instead of local shuffle. "Preset stock resets": `config.presetStockResets` (`game.js:258-274`) — a `shift()`-consumed **queue** of stock-reset orders, deliberately not index-addressed (a real bug fixed by `739341f`: index-addressing replayed round 1's reset order at round 2). State hash: `chinchon/js/hash.js` `canonicalState()`+`stateHash()`, FNV-1a over a fixed-key-order JSON snapshot (deck/discard order preserved as real state; hand/meld order sorted as cosmetic). RNG made fair for MP the same way as Escoba — transmitted deck, not shared seed.

### All others (Connect Four, Business Deal, Parchís, Nuts & Bolts, Filler, Mancala, Ball Run)
Unchanged from Snapshot 1 — solo/local-only, no `net.js` import. Ball Run additionally got a WebGL teardown fix (`forceContextLoss()` after `dispose()`, `ball-run/js/render.js:419`) — unrelated to MP, prevents context-limit exhaustion across repeated hub remounts.

## [TRIPWIRE TESTS] (NEW SECTION)

Definition (per repo convention): a test deliberately written red against a real, already-fixed bug, then kept green — its failure message names the original defect so a regression trips it immediately, rather than a generic assertion.

Three new suites (`4021607`):
- `test-recorder-contract.mjs` — asserts the classic (`game-stats-global.js`) and ESM (`game-stats.js`) stat writers agree, including Business Deal's in-scope copy.
- `test-stats-replay.mjs` — loads real historical `gamehub.stats` shapes through current loaders, asserts data survives and stays visible.
- `test-mp-lockstep.mjs` — headless two-engine lockstep simulator (Chinchón + Escoba) over a fake in-memory room, mirroring each game's real MP glue line-for-line since the real `ui.js` builds DOM in its constructor and can't run headless.

Five MP lockstep defects fixed by `739341f` (all now covered by the tripwire suite and documented in CLAUDE.md's "Multiplayer lockstep — invariants"):
1. Chinchón guest match-end deadlock — must gate on the engine's pre-emit `payload.matchOver`, never the momentarily-null `game.winner`.
2. Recovery seat-swap (both games) — remap transmitted `isHuman` by fixed seat, not as sender-relative flags.
3. Chinchón stale cross-round `presetStockResets` — must be a consumed queue, not index-addressed.
4. Escoba play-save seq off-by-one — autosave must happen after `_mpAfterPlay`, not before.
5. Chinchón restore `initMatch` wipe — round-boundary resume must take the resume-next-round branch (keeps scores), never re-init; a recovering guest must await the host's next round rather than reusing a stale deck.

## [OTHER CHANGES SINCE SNAPSHOT 1]

- **Business Deal `__ghStats` silent-skip closed** (`8f888ee`): BD's offline-first nested SW previously couldn't load the shared stats recorder at all in some installs, silently under-counting the leaderboard permanently (no retry). Fixed via a `gamehub.bd.pendingStats.v1` retry queue drained on next successful load or hub visit; BD now carries its own in-scope copy of `game-stats-global.js`, added to BD's own SW asset list.
- **Ball Run WebGL teardown** (`2c2f904`): explicit `forceContextLoss()` after `dispose()`.
- **`validate-sw-assets.mjs`** (`d655e6d`): new manual pre-deploy check, executes the real `ASSETS` array out of `sw.js` source (not hand-transcribed) and diffs against disk — already caught and fixed one real gap on introduction.
- **Challenge system retired, not deleted** (`43a31fa`, "M3b"): all trigger checks force-`false`'d, hub drops the challenge card/badges/unlock announcement; `challenge-net.js`/`challenge-ui.js`/`unlock.js` left in place, unimported, "kept for reversibility." Replacement: a small surviving hub button opens `js/challenge/keepsake.js` — a read-only view of earned codes/boarding pass, no tasks/progress/locks, one read-only Firebase pull. **No Firebase paths were added or removed** — `challenge/`, `flight`, `selfies` still exist as reachable-only-via-keepsake-read code paths.
- **CLAUDE.md truth pass** (`7a6c1e8`): documents the 3-Firebase-consumer→2-share-a-bootstrap change, adds the MP lockstep invariants section (the 5-defect list above), completes the games table to all 9 live games, adds a dev-tooling table, and adds THE LAW rule 9 ("a milestone isn't done until CLAUDE.md reflects it").

## [UI-CHROME] (unchanged)

Modal/scrim/card idiom, Escoba's announcement-row deviation, `.hub-card` aspect-ratio square tiles, fixed-height reservations — all unchanged from Snapshot 1.

## [CONSTRAINTS-DISCOVERED] (status of Snapshot-1 landmines + new ones)

Resolved since Snapshot 1:
- ~~No version negotiation between clients~~ → **FIXED**, `swv` check in `joinRoom` (fail-open on unknown).
- ~~Firebase App instantiation race between two independent init sites~~ → **FIXED**, shared `firebase-boot.js`.
- ~~SW asset list drift (manual, unchecked)~~ → **PARTIALLY FIXED** — `validate-sw-assets.mjs` exists and catches it, but is a manual ritual, not CI-enforced. Still `[LANDMINE]` if the human ritual is skipped.

Still present, unchanged:
- `[LANDMINE]` `escoba/js/game.js:82` — `fromSnapshot` hardcodes `Math.random`, discarding any injected RNG (neutralized for MP by preset-deck transmission, but still live for any future seeded-solo-replay feature).
- `[LANDMINE]` `database.rules.json` — still blanket `auth != null` read/write, now covering live MP room state too, not just stats/challenge data. Any device can read or overwrite any other pair's in-progress game.
- `[LANDMINE]` device-UUID identity (`gamehub.deviceId`) still not a real player identity — MP rooms identify host/guest via `me={name,avatar,deviceId}` passed in at join time, same soft-identity model as stats, no server-side uniqueness enforcement.

New, from MP build-out:
- `[LANDMINE]` `js/hub.js` module-teardown contract — MP games (Chinchón, Escoba) now hold live Firebase `onValue` listeners + heartbeat intervals while mounted; must call `net.disconnect()`/`stopHeartbeat()` in `destroy()` or they leak across hub navigations. (Not independently re-verified this pass that `destroy()` in both games actually calls `net.disconnect()` — flag as unverified, check before treating as closed.)
- `[LANDMINE]` Chinchón/Escoba MP glue are separately hand-maintained (~450 lines each) rather than sharing a common MP controller module — `ARCH-REVIEW.md` claims divergence is deliberate (different turn models), not drift, but this was not independently re-derived line-by-line this pass — take with caution.

## [VERSIONS] (unchanged mechanism, now load-bearing for MP)

Version pill mechanism unchanged (network-first fetch of live `sw.js`, GET_VERSION postMessage protocol). What's new: this same `swv` value is now used to GATE multiplayer room joins (see [MP-ARCHITECTURE]), so the previously-cosmetic version-mismatch indicator now has a real functional consequence — stale clients can no longer silently lockstep against current ones (except when SW version is unresolvable, which fails open).

## [GAPS]

- Did not verify `destroy()` in `chinchon/js/ui.js`/`escoba/js/ui.js` actually calls `net.disconnect()`/`stopHeartbeat()` — flagged as unverified landmine above, not confirmed either way.
- Did not confirm `js/stats-net.js` itself was edited to call `getStatsApp()` (inferred from CLAUDE.md + net.js's import, not from reading stats-net.js's import line directly).
- Did not verify in practice whether Escoba solo-mode resume ever relied on a non-default seeded `rng` (the fromSnapshot landmine's real-world impact is unconfirmed, likely moot).
- Did not independently re-derive the "deliberate divergence not drift" claim between Chinchón's and Escoba's ~450-line MP glue blocks — taken from `ARCH-REVIEW.md` at face value.
- Parchís, Business Deal internals: same gaps as Snapshot 1 (Parchís source lives in sibling out-of-scope repo; Business Deal's AI-invocation timing not fully read).
- `js/challenge/keepsake.js` internals beyond its `showKeepsake(name)` signature not traced in depth.
