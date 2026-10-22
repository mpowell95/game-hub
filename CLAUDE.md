# Game Hub — CLAUDE.md

**Keep this file short.** It loads into every session, every turn. A new rule goes here in one or
two lines; the story behind it goes in `CLAUDE-HISTORY.md` (append a dated section). The same goes
for every `<folder>/CLAUDE.md`: each has a `CLAUDE-HISTORY.md` beside it holding its full original
text (trimmed 2026-10-14; nothing was deleted). Section headings below match the history file, so
a reference like `CLAUDE.md, "Push notifications"` finds the full story there.

A small, ad-free, installable **PWA that hosts self-contained game modules**. Vanilla JS (ES
modules), **no build step, no dependencies, no framework**. Static files on GitHub Pages. A shared
**user profile** prefills every game.

## Repo location (settled — do not change)

Local folder `Game-Hub/` under `C:\Users\powel\OneDrive\Documents\CLAUDE CODE\Personal\`; remote
`mpowell95/game-hub`. (It was `Connect-Four/` until 2026-07-21.) `Game-Hub-Docs/` (sibling) is a
planning archive, NOT a git repo, NOT part of this project. The folder name has no relationship to
the remote, Pages, the URL or player data. Do not rename anything again.

## Monopoly Deal naming (settled — do not change)

Displays as **Monopoly Deal**; folder `business-deal/`, stats id `'business'`, keys `bd-stats` and
`gamehub.bd.pendingStats.v1`. **Intentional and load-bearing (THE LAW rule 1): never "fix" it.**
If an audit calls it contradictory, the audit is wrong. Details: `business-deal/CLAUDE.md`.

## THE LAW: player data is never deleted, never lost, never put at risk

Matt's words, after a migration hid his whole Ball Run history (July 2026):

> **"You must never delete or lose or risk deleting or losing any player data. You must always
> verify this."**

No feature, cleanup, refactor or deadline outranks it. Every `<game>/CLAUDE.md` and `js/CLAUDE.md`
points back here; do not duplicate it, do not move it down. Nine working rules, each from a real
incident (full text: `js/CLAUDE.md`):

1. **Stored is not enough; data must stay visible** — prove every UI gate still shows pre-change data.
2. **Writes are additive, only** — counters increment, bests only improve (`Math.max`). One-tap
   recreatable preferences (e.g. favorites) are exempt; earned history never is.
3. **Migrations carry forward everything that CAN be carried** — incompatible values are archived
   under a legacy key and still SHOWN, honestly labeled.
4. **Never fabricate conversions** between incomparable metrics.
5. **Old keys are never deleted, never repurposed.**
6. **No silent write failures** — verify by fresh re-read, or at minimum log loudly.
7. **Test migrations against real history** (the old writer code from git), never synthetic stores.
8. **When a player reports missing data, believe them** — replay the code history first.
9. **A milestone is not done until CLAUDE.md reflects it** (in short form; the story goes in
   `CLAUDE-HISTORY.md`).

## Asking for a change means LIVE on the deployed Game Hub — not just committed to a branch

Any request to change, fix, add or remove something means make it live. Pre-authorized, no
re-confirming per step, no need for Matt to say "deploy":

1. Commit and push the branch. 2. Open a PR into `main` if none exists. 3. **Merge it.**
4. **Verify the `pages build and deployment` run for that merge commit ends `completed` /
   `success`.** 5. Only then tell Matt it is **live** (not "pushed" or "merged").

Pause only for a genuinely destructive step (force-push, history rewrite). If something should not
ship yet, Matt will say so.

## When Matt asks what you are doing, ANSWER HIM. Immediately.

A mid-turn message is not a note for the final report. Stop and say where you are, what is left
and why it is taking this long, before the next tool call. Then carry on.

## Mockups are sketches, not pitches

A mockup is the thing itself and its numbers. No lede, no framing, no "why", nothing written to
persuade. Reasoning goes in the repo doc or commit message. Applies to every artifact, mockup,
plan page and diagram.

## Game screens: as few words as possible (Matt, 2026-10-14)

Matt, on Gridlock's setup screen: *"There are WAY too many words. This is the same comment you force
me to make 10 times per day."* **Every screen you build or touch ships with the fewest words that
still work.** No tagline under the title, no labels above controls that already say what they are
("Look", "Difficulty"), no second or third line on a button (level ranges, "Level 4"), no "this is
worth N points" footnotes, no explanatory sentences. Names, numbers and one action word per button.
Explanations belong in How to play, nowhere else. Before showing Matt any screen, delete every word
you can and look again. Worked example: `gridlock/js/ui.js` `_homeHTML`.

## Send the Claude.ai handoff files WITHOUT being asked

Matt reviews work in a second Claude.ai chat that cannot open artifact URLs. Whenever a turn
produces or changes an artifact, mockup, diagram or design doc, end it by sending, unprompted:
the artifact as a full-page **image**; the artifact's **HTML file**; the **repo doc** if any; the
**public raw GitHub link** for anything on `main`. `SendUserFile` rejects ~1 MB: dark/gradient
pages as JPEG q90, light text pages as PNG, rendered at `deviceScaleFactor: 1`.

## Answer about the game you were asked about

Report on THAT game only. Failures elsewhere, shared patterns, unrelated red tests stay out of the
reply; note them in the relevant `CLAUDE.md` if a future session needs them.

## No sound, ever (Matt, 2026-10-05)

*"NO SOUND FROM ANY GAME EVER. UNLESS SPECIFICALLY DIRECTED TO BY ME. NEVER SOUND."* No sound,
music, effects or audio option in any game, and do not suggest it. Nothing constructs an
`AudioContext` or `Audio` element; keep it that way.

## Subagents: save USAGE (Matt, 2026-09-22)

Goal: fewer tokens billed. Every subagent re-reads this file first.

- **Delegate only big jobs** (many files, long suites, big docs, a whole build stage). **Never
  small ones** (a lookup, a grep, a one-line edit).
- **Always pass the cheapest `model`**: Haiku mechanical; Sonnet specified work (screens, CSS,
  docs, probes); Opus engine, persistence, judgment.
- **One agent, many tasks**, full brief up front.
- **An agent never pushes or touches `sw.js`/`version.json`/CACHE.** It commits on its own branch;
  you verify (never paste its report), merge, bump CACHE, deploy. Resume a cut-off agent; never
  restart it.

Baseball's stage process: `baseball/CLAUDE.md`, "How a stage runs".

## Run it

```
node server.mjs           # http://localhost:8123/  (hub; /profile/, /<game>/ standalone)
```
A dev server is required (ES modules, workers and the service worker cannot run from `file://`).
It sends `Cache-Control: no-store`.

### Diagnostic: the version pill stuck at `vN → vN+1`

Two causes that look identical; separate them in this order:
1. **The pill is not listening** (fixed 2026-09-01, `_watchForUpdates` in `js/hub.js`): is a
   `controllerchange` listener wired up? `tools/test-sw-update.mjs` is the probe.
2. **The shell install failed** (one 404 in the atomic SHELL aborts `cache.addAll`): pull the
   deployed `sw.js`, evaluate `ASSETS` + `isShellAsset`, request every SHELL entry live. All 200
   rules this out. Prevention: `tools/validate-sw-assets.mjs`, `tools/test-sw-strategy.mjs`.

A new build applies itself silently on the launcher (never while a game is mounted). An arrow that
persists is a bug.

### Diagnostic: the launcher renders as raw unstyled HTML (fixed 2026-08-11)

A 404/503 during a Pages redeploy used to reach the page. Fixed in `sw.js`: `if (!res || !res.ok)
return cached;` on the network-first path; with nothing cached the error passes through honestly.
`tools/test-sw-strategy.mjs` pins it.

### The service worker's caching strategy (rewritten 2026-08-02)

Do not "simplify" any of this; full rationale in `sw.js` comments and `CLAUDE-HISTORY.md`.

- **Three tiers of `ASSETS`.** `SHELL` (`index.html`, `css/`, `js/`, `icons/`, `profile/`) is
  atomic and blocks install. `REST` (every game's files) is warmed after activation by
  `warmRest()`, best-effort, resumable; never inside `activate`'s `waitUntil`. `LAZY` (Boggle word
  lists, Contexto data) is in `ASSETS` but never fetched by the warm, only on first play. **Only
  large, single-game DATA goes in LAZY, never game code.** The `isLazyAsset` check sits BELOW the
  carry-forward in the warm loop (a `[KNOWN-BUG PROBE]` pins it).
- **HELD BACK (2026-10-14): an admin-only game warms only onto phones that show it.** GENERATED
  `HELD_BACK` (by `tools/validate-sw-assets.mjs`): per `devOnly` hub id (+ `pinball2`), its files that
  nothing outside held-back folders imports. The hub posts `SHOWN_GAMES` (its visible list) after
  each launcher paint; the warm skips the rest, BELOW the carry-forward. Saves ~4.3 MB per phone.
  **Held-back files carry no hash and are network-first, so editing an unreleased game sends
  players NO update: do not bump CACHE or touch sw.js for it** (the validator NOTEs a needless
  bump). Adding/removing a file or touching shared files still does. The hub imports `alerts`
  modules only for games on that launcher, so those are held back too.
- **Network-first with a deadline** (`NET_TIMEOUT_MS` 2.5 s) plus a `SLOW_LATCH_MS` (10 s) "network
  is bad" latch. A request with nothing cached is never short-circuited.
- **Unchanged files are carried forward across a CACHE bump** via the GENERATED `REST_MANIFEST`
  (content hashes, written by `tools/validate-sw-assets.mjs`; HTTP validators cannot do it because Pages
  re-stamps every ETag).
- **REST is cache-first; the shell is split**: `NETWORK_FIRST` (hand-listed modules that read or
  write player data or gate its visibility, Matt: *"keep the stats code fresh"*) vs
  `SHELL_CACHE_FIRST`. It is an allow-list derived from `ASSETS` (so it can never swallow `sw.js`),
  per file, never transitive. A test fails if a cache-first shell module writes a `gamehub.*` key.
- **Old caches are deleted at the END of the warm**, not at activate; fetches consult the CURRENT
  cache before `caches.match`.
- `cache: 'reload'` stays, and the SHELL install always uses it (2026-10-14; Pages' `max-age=600`
  otherwise installs the previous build's files).

## Architecture

```
index.html              hub shell host
js/hub.js               launcher grid + module mount/unmount  (the GAMES registry)
css/hub.css             shell chrome only
sw.js                   shared service worker
manifest.webmanifest    one manifest for the whole hub
profile/index.html      the shared profile page
<game>/                 one folder per game
```

Tapping a **module** game dynamically imports and mounts it (no reload); a **launch-out** game
navigates to its own URL.

### Shared modules (`js/`)

Full map, invariants and history: `js/CLAUDE.md` (auto-loaded when working there).

| Module | Role |
|---|---|
| `profile-store.js` | validated read/write of `gamehub.profile`; player-code helpers; `hasName()` |
| `name-gate.js` | the undismissable "choose a name" gate (`name-gate-auto.js` for classic pages) |
| `favorites.js` | launcher favorites (`gamehub.favorites.v1`) |
| `new-badge.js` | the "New" pill, pure date maths over each entry's `released` |
| `i18n.js` | EN/ES: `getLang`/`setLang` (`gamehub.lang.v1`), `makeT(dict)`, `onLangChange` |
| `theme.js` | light/dark/auto (`gamehub.theme.v1`), `.gh-dark` on `<html>` |
| `layout.js` | launcher Comfortable/Compact (`gamehub.layout.v1`), `.gh-compact` on `<html>`; see "The compact layout" |
| `emoji.js` / `emoji-data.js` | `isEmoji()` gate at the moment of choosing only (never in `glyph()`); GENERATED emoji set (`tools/build-emoji-data.mjs`); search keywords `emoji-search-{en,es}.js` kept out of SHELL |
| `viewport.js` | `onViewportResize(cb)`: the ONE way to re-fit on resize |
| `no-zoom.js` | classic script on every page: no double-tap/pinch zoom, no text selection (inputs excepted) |
| `game-stats.js` | unified per-player stats; one recorder per game; failed writes queued (`gamehub.pendingResults.v1`); rate gate; play activity (`gamehub.activity.v1`, mirrored to `players/<id>/activity`) |
| `game-stats-global.js` | non-ESM recorder for Monopoly Deal/Parchís (`window.__ghStats`) |
| `firebase-boot.js` | the ONE bootstrap for the `'stats'` Firebase app |
| `stats-net.js` | mirror to `players/<id>`; username registry; `syncHealth()`; device reset |
| `players-agg.js` | per-person aggregation of synced devices (no `headToHeadRows`; removed 2026-08-11) |
| `game-stats-ui.js` / `leaderboard-ui.js` | My Stats / Leaderboards overlays (wins-only; per-game VS chip; admin-only games off By Game) |
| `arrow-maze-time.js` / `gridlock-points.js` | Arrow Maze timer, ladder bands, points, Rush; Gridlock bands, stars, points. Network-first |
| `leaderboard-rank.js` | pure rating maths + board comparators |
| `game-art.js` | every tile's inline SVG, keyed by hub id |
| `difficulty-tiers.js` | READ-path mapping of difficulties onto tiers 1-4 |
| `arcade-scores.js` | Skeeball's high scores, daily bests, unlocks |
| `net.js` | multiplayer rooms (`rooms/<CODE>`), incl. N-seat (`joinSeat`/`vacateSeat`) |
| `online-gate.js` | who may play online (see "Online play needs an account Matt has let in") |
| `a2hs.js` | add-to-home-screen sheet |
| `device-report.js` / `install-state.js` | device dump used by every bug report; installed-vs-tab plus phone size (`tools/read-install-state.mjs --screens`) |
| `bug-report.js` / `bug-report-ui.js` | Report a bug, offline outbox, Matt's replies (`bugReplies/<deviceId>/`), soft delete |
| `messages.js` / `messages-ui.js` | player-to-player Messages (see "Messages") |
| `hub-messages.js` | messages FROM the Game Hub (`HUB_MESSAGES`, in code; see "Messages") |
| `challenges.js` / `challenges-ui.js` / `challenge-life.js` | the Multiplayer screen (was Challenges; reads only) and the shared cancel/expire rules (`ANSWER_MS` 3 days) |
| `mp-records.js` | the Multiplayer screen's Records for live-room games: `byDiff.mp` + `h2h`, read only |
| `game-chat-history.js` | READ ONLY: your in-game quick chat with one person (challenge games), merged into that Messages conversation |
| `match-chat.js` / `match-chat-ui.js` | in-match quick chat for EVERY online game, at `<node>/chat/<matchId>` (beside the match, never inside) |
| `error-log.js` | last 20 uncaught errors (`gamehub.errorlog.v1`) |
| `admin-config.js` / `admin-ui.js` | `adminConfig/v1` resolvers (offline-safe, absent = code default) and the admin page; also the device reset |
| `stats-corrections.js` | read-time score voids (`VOIDED_MATCHES` too); raw records untouched |
| `announce.js` / `announce-ui.js` | one-time launcher announcements (`gamehub.announce.v1`), each with an `until` date |
| `challenge/` | retired challenge system, still load-bearing (`hub.js` imports `hooks.js`); do not delete |
| `push.js` | push notifications, app half (see "Push notifications") |
| `career-store.js` | Baseball's career sync (`careers/<CODE>/baseball/…`) |

**When a screen is removed, grep this table and `js/CLAUDE.md` for what fed it.**

### Where the deep docs live

- `js/CLAUDE.md`: module map, THE LAW's full rules, lockstep invariants, sync health, the profile
  contract, Report a bug pipeline.
- Old handoffs and specs: `docs/archive/` (moved from the root 2026-10-14; code comments may name them bare).
- `<game>/CLAUDE.md`: each game. `docs/BUILDING-A-GAME.md`: the UX floor, module contract, "Adding
  a game" checklist. `VISUAL-PROCESS.md`: how to verify a screen looks and plays right.
- **Head-to-head is DISPLAYED in ONE place: the Multiplayer screen's Records** (`js/mp-records.js`;
  Matt, 2026-10-18, reversing 2026-08-11). Nowhere else; the leaderboard stays per game. Read
  `js/CLAUDE.md`, "Head-to-head capture" first. The `h2h` data stays (rule 5).

### Dev tooling (`tools/`, not deployed; run from the repo root, e.g. `node tools/validate-sw-assets.mjs`)

Every script's description and flags: **`docs/DEV-TOOLING.md`** (add new tools there AND here).

- **Run `node tools/validate-sw-assets.mjs` before every deploy**; it rewrites `REST_MANIFEST` and
  `version.json`. Commit `sw.js` after changing any game file.
- **Never run `tools/run-all-tests.mjs` unless Matt asks by name.** Run only the suites for what changed.
- **`tools/test-visual.mjs`: never `--all` without asking Matt.**
- **Run `backups/rtdb-backup.mjs` before ANY Firebase write, rules change or schema change.**
- **Firebase-writing scripts are Matt-only, dry-run by default** (`tools/clear-skeeball-stats.mjs`,
  `tools/delete-test-players.mjs`, `tools/delete-device-record.mjs`, `tools/fix-natalia-record.mjs`). Never `--write`
  on your own judgement.
- **Never hand-edit generated files** (`js/emoji-data.js`, `js/emoji-search-*.js`,
  `boggle/data/words-es.txt`, `contexto/data/*`, `baseball/models/*`, `gridlock/js/levels.js`,
  `js/gridlock-v1map.js`, `archery/models/bow.bin`, sw.js's `REST_MANIFEST` and `HELD_BACK`); re-run the generator.

Main suites: service worker (`test-sw-strategy`, `test-sw-update`); data safety
(`players-agg.test`, `test-recorder-contract`, `test-stats-replay`, `test-stats-identity`,
`test-stats-corrections`, `test-rate-guard`, `test-activity`, `test-admin-config`); cross-game
(`test-game-conventions`, `check-no-scroll`, `test-mp-lockstep`); per-feature `test-*.mjs`.

### The module contract

In `docs/BUILDING-A-GAME.md`, "Part 1 — Building a game" (exports, leak-free `destroy()`, name
gate, `isInProgress()`'s two legitimate meanings, `immersive: true`). Read it before touching any
game's mount/unmount lifecycle.

### Before you build: USE WHAT EXISTS (read this before writing a line of a new game)

**`node tools/test-game-conventions.mjs` enforces most of this; run it before committing a game.**

| Need | Use | Never |
|---|---|---|
| Re-fit on resize/rotate | `onViewportResize(cb)` (`js/viewport.js`) | raw `resize`/`orientationchange`/`visualViewport` listeners (mobile scroll jank) |
| User-visible text | `makeT(STRINGS)` + `<game>/js/strings.js` `{en, es}`; call `t()` at render time | hardcoded English, `t()` at module scope |
| Light/dark | `js/theme.js` (`.gh-dark`) | `prefers-color-scheme` in game CSS |
| Name/emoji/opponents | `loadProfile()` (defaults only; games never write it back) | your own prompt |
| Recording a result | `recordX()` / `recordResult()` (`js/game-stats.js`) | touching `gamehub.stats` yourself |
| Difficulty markers | `diffShapeSVG()` / `tierOf()` | hue-only tiers (Matt is red/green colorblind) |
| Name gate | `await requireName()` in `index.html` before `init()` | mounting ungated |
| Multiplayer | `js/net.js`; read `js/CLAUDE.md`'s lockstep invariants first | a second Firebase app or own room layer |
| Chat in an online match (REQUIRED, Matt 2026-10-14) | `createMatchChat()` + `js/match-chat.js` | online play without it, or chat inside the match document |
| Tile art | `GAME_ART[id]` (`js/game-art.js`) | inline SVG in `GAMES` |
| Buttons, cards, fields, modals | `css/ui.css` `.gh-*` + `--gh-*` tokens | chrome from scratch |

**Scroll and touch rules:**
- **No page zooms or selects, and no game screen scrolls (Matt, 2026-10-15).** Every page's viewport
  meta has `maximum-scale=1, user-scalable=no` and loads `js/no-zoom.js` right after it (a `*`
  `touch-action: pan-x pan-y` + `user-select: none`, inputs excepted, + Safari's `gesturestart`
  cancelled); `tools/test-game-conventions.mjs` fails a page without it. While a game is mounted the
  hub sets `html.gh-ingame` (page `overflow: hidden`, no bounce).
- A scrolling `position: fixed` overlay needs `overscroll-behavior: contain`.
- **Never put a `touchmove` listener on `document` or `window`**; bind it to the game's root.
- Swipe surface: `touch-action: none`; tappable control: `touch-action: manipulation`.

**Bump `CACHE` in `sw.js` past what is on `main` RIGHT NOW** (never for edits confined to an unreleased game's files), not past your working copy (two
branches computing the same number leave devices on a permanently mixed build).

### Adding a game — checklist

In `docs/BUILDING-A-GAME.md`, "Part 1" (12 steps). Read Part 0 (the UX floor) before changing ANY
game's UI or CSS.

## The games

Each game's full docs: `<game>/CLAUDE.md`.

| Game | Integration | CSS root / prefix | Settings key | Stats recorder |
|---|---|---|---|---|
| Air Hockey | module, immersive, devOnly; vs computer + live online (`rooms/<CODE>/ah/`); hub id `air-hockey`, stats id `airhockey` | `.ah-root` / `.ah-` | `gamehub.airhockey.v1` | `recordAirHockey` (`ah`) |
| Archery | module, immersive, devOnly; vs computer, pass and play, online challenges (`archery/`) | `.ar-root` / `.ar-` | `gamehub.archery.v1` (+ `.save.v1`) | `recordResult('archery', …)` |
| Arrow Maze | module, immersive, devOnly; one ladder, points leaderboard, Rush. **Folder `way-out/`, hub id `way-out`, stats id `wayout`, `gamehub.wayout.*` keep the first name on purpose** (rule 5) | `.wo-root` / `.wo-` | `gamehub.wayout.v1` (+ several frozen save/clock keys, see `way-out/CLAUDE.md`) | `recordWayOut` + `recordWayOutRush` (`wo`) |
| Ball Run | module, immersive | `.br-root` / `.br-` | `ballrun.*` (frozen) | `recordBallRun` |
| Baseball | module, immersive, devOnly; three.js stadium, being rebuilt per `docs/BASEBALL-REFERENCE-B9.md` | `.bb-root` / `.bb-` | `gamehub.baseball.v1` | `recordBaseball` |
| Battleship | module, immersive, multiplayer (`gamehub.battleship.mp.v1`) | `.bs-root` / `.bs-` | `gamehub.battleship.v1` | `recordBattleship` |
| Boggle | module, multiplayer (`gamehub.boggle.mp.v1`), EN/ES word lists | `.bg-root` / `.bg-` | `gamehub.boggle.v1` | `recordBoggle` |
| Brick Breaker | module, immersive, solo | `.bx-root` / `.bx-` | `gamehub.brickblitz.v1` | `recordBrickBlitz` |
| Chinchón | module; live rooms + turn-by-turn challenges (`chinchon/`, 2026-10-18) | `.cc-root` / `.cc-` (many bare rules) | `chinchon-settings` (frozen) | `recordChinchon` |
| Connect Four | module | `.cf-root` / `.cf-` (many bare rules) | `gamehub.connect4.v1` (+ `.save.v1`) | `recordConnect4` |
| Connect 4 Hoops | module, immersive, devOnly; live rooms + turn-by-turn (`hoops/games/<id>`) | `.h4-root` / `.h4-` | `gamehub.hoops4.v1` | `recordResult('hoops4', …)` |
| Contexto | module, solo, EN/ES; data GENERATED by `tools/build-contexto-data.mjs` (LAZY) | `.ct-root` / `.ct-` | `gamehub.contexto.v1` (+ `.save.v1`) | `recordContexto` |
| Course Creator | launch-out (`hole-editor/?course=new`), devOnly, opened to chosen codes from the admin page; no stats | own page | `golf.holeEditor.*` | none |
| Cup Pong | module, immersive, devOnly; vs computer, Solo, challenges (`cuppong/`); folder `cup-pong/`, ids `cuppong` | `.cp-root` / `.cp-` | `gamehub.cuppong.v1` | `recordResult('cuppong', …)` |
| Darts | module, immersive, devOnly; vs computer, pass and play, challenges (`darts/`) | `.dt-root` / `.dt-` | `gamehub.darts.v1` (+ `.save.v1`) | `recordResult('darts', …)` |
| Dominoes | module | `.dm-root` / `.dm-` | `gamehub.dominoes.v1` | `recordDominoes` |
| Dots and Boxes | module, multiplayer (`gamehub.dotsboxes.mp.v1`) | `.db-root` / `.db-` | `gamehub.dotsboxes.v1` | `recordDotsBoxes` |
| Escoba | module, immersive, multiplayer 2-4 seats (`escoba-save`) + 2-player turn-by-turn challenges (`escoba/`, 2026-10-18) | `.eb-root` / `.eb-` | `escoba-settings` (frozen) | `recordEscoba` (challenges: `'mp'`, never h2h) |
| Filler | module, multiplayer (`gamehub.filler.mp.v1`) | `.filler` / `.fl-` (frozen) | `gamehub.filler.v1` | `recordResult('filler', …)` |
| Flick Soccer | module, immersive, released 2026-10-20; vs computer, 2 players, challenges (`flicksoccer/`); hub id `flick-soccer`, stats id `flicksoccer` | `.fs-root` / `.fs-` | `gamehub.flicksoccer.v1` (+ `.save.v1`) | `recordResult('flicksoccer', …)` |
| Golf | module, immersive | `.gf-root` / `.gf-` | `gamehub.golf.v1` (+ `.save.v1`) | `recordGolf` |
| Gridlock | module, immersive, devOnly; 4,000-level ladder, Wood/Cars looks; levels GENERATED (append-only) | `.gl-root` / `.gl-` | `gamehub.gridlock.v1` (+ `.save.v2`; `.save.v1` read once) | `recordGridlock` + `recordGridlockHint` (`gl`) |
| Hill Climb | module, immersive | `.hc-root` / `.hc-` | `gamehub.hillclimb.v1` | `recordHillClimb` |
| Mancala | module, immersive, multiplayer (`gamehub.mancala.mp.v1`) | `.mancala` / `.mc-` (frozen) | `gamehub.mancala.v1` | `recordResult('mancala', …)` |
| Minesweeper | module, immersive (own title row), grid puzzle | `.ms-root` / `.ms-` | `gamehub.minesweeper.v1` (+ `.save.v1`) | `recordMinesweeper` |
| Monopoly Deal | launch-out (`business-deal/`, own nested SW) | own page | own keys | `window.__ghStats` → `'business'` |
| Murdoku | module, immersive, solo logic puzzle | `.mu-root` / `.mu-` | `gamehub.murdoku.v1` (+ `.save.v1`) | `recordResult('murdoku', …)` |
| Nuts & Bolts | module | `.nb-root` / `.nb-` | `gamehub.nutsbolts.v1` | `recordNutsBolts` |
| Parchís | launch-out (built from sibling `../Parchís/`) | own page | `parchis_r2_prefs` | `window.__ghStats` → `'parchis'` |
| Pool | module, immersive, devOnly; the Flick Soccer way: 8-ball, 9-ball, Cutthroat (3 players), call / banks / obstacles options, vs computer + pass and play (`eight-ball/`, 2026-10-22; online is Stages 2-4). **Folder/hub id `eight-ball`, stats id `eightball`: NOT the archived Pool's ids** | `.ep-root` / `.ep-` | `gamehub.eightball.v1` (+ `.save.v1`) | `recordResult('eightball', …)` |
| Skeeball | module, immersive, solo, unlockable machines, challenges (`skeeChallenges/`) | `.sk-root` / `.sk-` | `gamehub.skeeball.v1` | `recordSkeeball` |
| Snake | module | `.sn-root` / `.sn-` | `gamehub.snake.v1` | `recordSnake` |
| Sudoku | module | `.sd-root` / `.sd-` | `gamehub.sudoku.v1` | `recordSudoku` |
| Texas Hold'em | module, immersive, multiplayer up to 8, HOST-AUTHORITATIVE (`rooms/<CODE>/pk`), bankroll | `.pk-root` / `.pk-` | `gamehub.holdem.v1` | `recordResult('holdem', …)` + `recordHoldemBank` / `recordHoldemHand` |
| Tic Tac Toe | module, multiplayer (`gamehub.tictactoe.mp.v1`) | `.ttt-root` / `.ttt-` | `gamehub.tictactoe.v1` | `recordTicTacToe` |
| Uno | module | `.un-root` / `.un-` | `gamehub.uno.v1` | `recordResult('uno', …)` |
| Yahtzee | module, immersive, multiplayer (`js/net.js`) | `.yz-root` / `.yz-` | none yet | `recordYahtzee` |

Prefix cells verified against the CSS on 2026-07-23 (`.ttt-`, `.filler`, `.mancala` are real).
devOnly is only a DEFAULT: the admin page can make a game live without a commit.
**Releasing a game = the admin switch AND a release commit, together (Matt, 2026-10-14).** When
Matt says "release X" (or has switched it live on the admin page), remove `devOnly: true` from its
`GAMES` entry (add `released`), run `tools/validate-sw-assets.mjs` (it drops X from `HELD_BACK` and gives
its files hashes), bump `CACHE`, deploy. That alone makes it live for everyone unless the admin
page holds an explicit "hidden" override for it; a session never writes the admin config. Players get ONE update and the
game is saved cache-first like any other. A game left `devOnly` but switched live re-downloads its
files on every open (held back: network-first, no hash).

## Archived games (2026-09-28)

Pinball, Pool and Pipes live in `archive/<game>/` (restore steps in each), skipped by the service
worker. **An archived game is hidden, never deleted:** `'pinball'`, `'pool'`, `'poolv2'`, `'pipes'`
stay in `js/game-stats.js`'s `GAMES` and in `ARCHIVED_GAMES` (kept out of totals); their stored
keys are untouched. Archive the next one the same way.

## The shared profile

`profile/index.html` + `js/profile-store.js`, stored in `gamehub.profile`: name, emoji, colour, up
to 3 computer opponents, a tagline. **Defaults-only**: games prefill from it, their own saved
settings win, games never write it back (writers: the profile page and `hub.js`'s first-run gate).
Extend additively, never rename fields; readers treat missing/malformed as "no profile" and must
never crash.

- **Any emoji can be chosen, only emoji are selectable** (validation at choosing time,
  `js/emoji.js`; `glyph()` stays permissive on read). Recent picks: `gamehub.emojiRecent.v1`.
- Open items: see the root TODO.md, "Hub (shared)".
- Contract and Monopoly Deal's must-stay-synced duplicates: `js/CLAUDE.md`.

## Messages (2026-08-31)

- **Addressed to a PLAYER CODE, never a deviceId** (people have two phones).
- One conversation = `messages/threads/<pairKey>` (two codes sorted); inbox =
  `messages/index/<CODE>/<other>` with `seenAt`/`hiddenAt`. Read state lives in Firebase.
- **Nothing is ever deleted**: "Hide" stamps `hiddenAt` on your own row only. No hard delete exists.
- Matt can send to **Everyone** (one ordinary message per person). Admin view is read-only by
  construction.
- Top bar: Messages replaced My Stats (which moved to the profile page; its data is also reachable
  via Leaderboards). Messages badge = unread messages (+ new bug reports on Matt's devices);
  profile pill badge = bug-report replies.
- "Send message" on a leaderboard detail screen; hidden on your own row and on records with no
  code. Full contract: `js/CLAUDE.md`, "Messages".
- **In-game quick chat shows in the conversation (2026-10-17)**: `js/game-chat-history.js` reads your
  challenge matches with that code (each game's index) and their `<node>/chat/<id>` (Hoops: the match's
  own `chat`), merged by time under a tile-art + game-name header, DASHED bubbles. Read only.
  **Live-room games** (Hold'em, Air Hockey, Escoba...): `js/net.js` `sendReaction` also saves each line
  into the sender's thread with every other seat (`messages.js` `logGameChat`, `game: {id, s, room, t, v}`
  + plain `text`). THREAD ONLY, never the index: no push, no unread, no inbox row. Lines before
  2026-10-17 were never stored, so they cannot appear.
- **Messages from the Game Hub (2026-10-14)**: `js/hub-messages.js` `HUB_MESSAGES`, append-only, by
  player code; sending = appending an entry + deploying. One "Game Hub" conversation with the hub
  icon, no reply box, no Hide; read state local (`gamehub.hubMessages.v1`). `play: '<hubId>'` adds a
  Play button: newest build, then that game's newest files (`sw.js` `WARM_GAME`), then the game
  (`hub.openGameFresh`). No phone notification (would need a Cloud Function). **Read receipt**:
  first open stamps the time, mirrored as `players/<id>/hubMsgs` (a report); Admin → **Game Hub
  messages** shows Read <time> / Not yet per recipient.

## The compact layout (2026-10-17)

A per-device choice (Profile > Settings > Layout; default Comfortable). Compact = one title row, 3-across
tiles with the name under the art, no heart on favorites (the edit button moves AND removes them), and
an icons-only bottom tab bar (Games, Multiplayer, Messages, Leaderboards, Profile) carrying the same
badges. CSS is `html.gh-compact:not(.gh-ingame)` so games mount identically. Each tab calls the comfortable
layout's own button, so the two cannot drift. Announced by `compact-layout-2026-10-17` (Try it = switch).
**Bottom-bar tips** (`_runTour`): the first time a device shows Compact, one "your turn"-style bubble per
tab says what it is; seen-stamp `compact-tour-2026-10-17` (an ANNOUNCEMENTS entry with `tour: true`, never a
popup) so Admin > Announcements lists who has seen it. The popup was redesigned under the SAME id (not resent).
**The PAGE scrolls in Compact (2026-10-20). Never lock `html`/`body` to the screen height** (v1208 tried it to dodge an
iOS 26 keyboard bug; on Matt's iPhone it left the tab bar ~65pt above the bottom). Story: `CLAUDE-HISTORY.md`.

## The profile page's structure (2026-08-31)

**You** · **Settings** (one list of collapsible rows, one level deep) · **Your devices** · **Help**
· **Reset profile** at the bottom. (Messages left this page 2026-10-17: both launcher layouts open it.) Every block is a `.pf-section` card;
full-width row buttons use `.pf-linkbtn`.

**Firebase rules:** root `.read`/`.write` are `false` and every branch is enumerated in
`database.rules.json`; **add a new top-level node there or it is unreachable**, and add it to
`backups/rtdb-backup.mjs`'s `BRANCHES` (which cannot read `messages/`; export that from the
console). **Rules deploy with the merge** (the Firebase workflow, see "Push notifications"). `messages/` is scoped by `msgAuth/<uid>` → code; `admins/<uid>` grants Matt read-all.
**`adminConfig/` and `bugReplies/` are writable only by a uid in `admins/`** (2026-10-14). It does
not stop someone with another player's code and dev tools. Rules reach Firebase with the merge
(the workflow) or, as a fallback, by Matt pasting the whole file (console → Realtime Database → Rules).
**When a step is "Matt pastes this into a console", record it with the date and close the line the
moment he confirms** (a stale "OUTSTANDING" line was once repeated back to him).

## Deleting a device's history, and the rate gate (2026-09-12)

**Matt's authority, not a session's:** *"It's my game, I control every aspect of it... The rules
are for YOU."* A session must still **never delete player data on its own judgement**; only when
Matt asks, personally, per incident.

1. **Server-side delete**: `tools/delete-device-record.mjs` (Matt-only).
2. **Device reset** (`adminConfig/v1/deviceResets/<statsId>`; `applyDeviceReset()` runs INSIDE
   `syncMyStats()` before the record is built, otherwise the device re-uploads its store). A stamp
   compared against a local ack, acted on once; clears only the active player's stats store.
3. **Rate gate** (`js/game-stats.js`): 30 results per game per minute, refused before the store is
   read, counted in the mirror's `rate` node. **Calibrated on the fastest human; do not narrow it.**

None of this makes the hub cheat-proof; never describe it that way.

## Push notifications (2026-09-23)

- **Pieces:** `js/push.js` (permission asked INSIDE the tap; subscriptions at
  `pushSubs/<PLAYER CODE>/<key>`), Cloud Functions in `functions/` (decisions in the pure
  `functions/decide.js`), and `sw.js` (shows every push, never silently; opens the game on tap).
- **Functions AND database rules deploy automatically on merge (2026-10-18, Matt: "i'd much prefer you
  be able to do it automatically")**: `.github/workflows/firebase-deploy.yml`, signed in with the repo
  secret `FIREBASE_SERVICE_ACCOUNT` (set up by Matt 2026-10-21; first run green). Check its run like the Pages run
  before saying "live". Fallback only if it is broken: Matt runs `firebase deploy --only functions` from
  `C:\Users\powel\game-hub-deploy`; **give those steps as one copy-paste block per command.** Blaze plan.
- **Deployed triggers (all, by the workflow 2026-10-21):** `hoopsTurnPush`, `messagePush`, `bugReportPush`,
  `skeeChallengePush`, `cupPongTurnPush`, `dartsTurnPush`, `flickSoccerTurnPush`, `archeryTurnPush`,
  `chinchonTurnPush`, `escobaTurnPush`, `turnReminderPush`, `nudgePush`, `directoryBuild` +
  `directoryOnApprove` (2026-10-22); rules incl. `archery`, `chinchon`, `escoba`, `nudges`, `directory`.
- **Player directory (2026-10-22, Matt: multiplayer felt slow)**: `directory/<CODE>` = `{name, emoji, at}`,
  rebuilt by the server from `players/` hourly and on any Online play change (`buildDirectory`). Every
  challenge game's "pick a person" reads it via `stats-net.js` `readOpponentProfiles()` (2 KB vs ~930 KB);
  no directory = the old full read. Anything needing stats (Records, Skeeball unlocks) still reads `players/`.
- **Remind bell (2026-10-22, Matt)**: a bell on each their-turn row of the Multiplayer screen writes
  `nudges/<THEIR CODE>/<node>~<id>` = `{from, t}` (`js/messages.js` `sendNudge`); rules: only as your own
  claimed code, once per match per 6 h. `nudgePush` sends "Reminder: your turn vs X" only if it really is
  their turn in a match with the sender (`decideNudge`).
- **24-hour reminder (2026-10-20, Matt: "for every game")**: `turnReminderPush` (hourly `onSchedule`) sends "Reminder: your
  turn vs X" once per turn when a challenge row has waited 24-72 h (`decideReminder`, `REMINDER_GAMES` in
  `functions/decide.js`). Sent-stamps live in `pushReminders/<code>/<node>~<id>` (server-only), NEVER on the index row.
  Deployed 2026-10-21 (workflow run, `turnReminderPush` created).
- **The VAPID private key is a Firebase secret; never in this repo.** Its public half is in
  `js/push.js` and `functions/index.js`; `tools/test-push.mjs` fails if they differ.
- iPhone: only the Home Screen app (iOS 16.4+) can receive them; `pushState()` returns `'install'`.
- Never notify about your own action (`by` on the match). No push to a device with the hub open
  (`activeAt` heartbeat, decided on the SERVER in `isActive`). Opening the hub clears shown
  notifications.
- **App icon badge** (2026-10-14): `sw.js` `syncBadge()` sets it to the number of our notifications
  showing, only after one shows; `clearShownNotifications()` clears it. iPhone Home Screen app,
  installed desktop Chrome/Edge; a no-op elsewhere.
- **A tap opens THAT match** and survives a reload: the tap is written to sessionStorage
  (`hub.pushOpen`, 2 min) before acting, cleared only once mounted; same game open → `openArmed()`.
- If notifications stop around late December 2026, check whether Blaze's free-trial billing needs
  activating first (not certain).

## Online play needs an account Matt has let in (2026-10-08)

- A code may play online only if listed: `ONLINE_BEFORE` in `js/admin-config.js` plus
  `adminConfig/v1/online/<CODE>` (admin page, **Online play**). Matt's devices always may.
- **Checked centrally**: `js/net.js` create/join/joinSeat (before any network call), every
  challenge `createGame` (also refuses a non-allowed opponent), every challenge picker and invite
  list. Two devices on ONE code cannot join the same room (`'same-player'`).
- Refusals: `'no-code'`, `'not-approved'`, `'same-player'`, `'them-not-approved'`; show
  `onlineGateText(err)`.
- It does not stop collusion between two real approved players or dev-tools tampering. A new
  family member cannot play online until Matt taps them in.

## The Multiplayer screen (2026-10-18; the Challenges screen 2026-10-05)

- Matt's mockup, built: a FULL screen (compact: under the tab bar, its tab lit). Your turn (Play),
  their turn as one-line rows, Cancel/Decline/Resign behind **⋯**, then every multiplayer game on the
  launcher in ONE A-Z grid (no "Live"/"Anytime" labels, Matt). A challenge game opens a pick-a-person
  sheet; a live-room game (`LIVE_MP_GAMES` in hub.js = `LIVE_GAMES` in `js/mp-records.js`) opens the
  game. The record chip ("12-5") opens **Records** (People, Games, Recent; a person's page).
- Records count live-room games from `byDiff.mp` (Games) and `h2h` (People; from 2026-07-22 to 08-04
  per game; Air Hockey, Hold'em, Yahtzee have none; a 3-4 seat Chinchón/Escoba loss counts against
  every opponent at that table). Hoops counts from its challenge index only (its 'mp' bucket mixes both).
- The full-width button and the tab are both "Multiplayer" (shown if any challenge OR live game is on
  the launcher), "Your turn: N" from each alerts module's `myTurnCount()`.
- `js/challenges.js` only READS each game's index through the game's own reader; Cancel / Decline
  / Resign call the game's own writer.
- **A new challenge game needs** `armOpen(id)`, `armChallenge({code,name,emoji})`,
  `myTurnCount()` in its alerts module, plus a `SOURCES` entry in `js/challenges.js`
  (`tools/test-challenges.mjs` checks).

## Cancel, decline, resign, expire (2026-10-13)

Shared rules in `js/challenge-life.js`; writes in each game's `mp.js` (Skeeball `challenge.js`),
verified by re-read, deleting nothing.

- **OPEN until the receiver's first move** (later series games are never open). While open: the
  sender can **cancel**, the receiver can **decline**; counts for nobody (`over: { winner: 'none',
  why }`). `resignGame` on an open match calls it off instead of awarding a win. A cancel racing
  the first move is void on read.
- **Once answered, only RESIGN**: the other person wins.
- **Expiry: 3 days unanswered** (only matches made from 2026-10-13, `lapse: true`). Nothing is
  written; every phone derives it; a late move is refused (`'expired'`).
- Called-off rows are stored `over: false, yourTurn: false, ended: <why>` **on purpose**: the
  deployed push functions do not know "cancelled", so this shape sends no push. Rows also carry
  `open`, `expires`, `sent`.
- The "Challenge cancelled." line stays up 6 s across repaints (`FLASH_MS`, 2026-10-20): the cancel's own
  index write repainted the list and wiped it, so Matt saw no confirmation.
- Tests: `tools/test-challenges.mjs` plus each game's `test-*-mp.mjs` / `tools/test-skee-challenge.mjs`.

## Skeeball challenges (2026-09-24)

Contract: `skeeball/CLAUDE.md`, "Challenges". Node `skeeChallenges/` (`games/<id>` +
`index/<CODE>/<id>`), published 2026-09-24; push `skeeChallengePush` deployed 2026-09-25. With two
or more game alerts, the launcher draws small per-tile "Your turn!" pills instead of one bubble.

## The admin control page (2026-08-24)

**🛠️ Admin** (Matt only) → `js/admin-ui.js` writes `adminConfig/v1` via `js/admin-config.js`; every
device reads it once per load and caches it. Written for ONE reader: collapsed sections, no prose,
no Default buttons.

- **An override sits ON TOP of the code default**; absent/unreachable config = code behaviour, so a
  config failure can never hide a released game (rule 1).
- **Skeeball machines: Open / Unlockable / Testing, all read-time only.** Nothing writes
  `sk.unlocked`; moving a machine back never deletes an earned unlock. A Testing machine records to
  `sk.practice`, which counts for nothing.
- **An admin-only game is hidden from the launcher AND the leaderboard** via one helper,
  `isGameOnLauncher(statsId)`. **Never filter `GAME_META`, the player-detail game list or stored
  data with it** (wins would vanish from totals). `visibleTabs()` keeps its own, more permissive
  rule on purpose; do not unify them.
- `hideFrom: ['<CODE>']` on a `GAMES` entry hides a game from named players (never Matt/dev).
  `games/<id>/allow/<CODE>` opens a hidden game to named players (`ALLOW_PICKER`); it hides the
  tile, not the URL.
- **Every admin-only game needs a `GAME_META` row**; `tools/players-agg.test.mjs`'s `OFF_THE_BOARD` must
  stay empty (a missing row zeroes every win, how Yahtzee shipped).
- Score voids (per player, per machine) and Hold'em bankroll voids
  (`adminConfig/v1/corrections/holdem/<statsId>`) are read-time overlays; raw data untouched.
  Deterrents, not cheat-proofing.
- **Nothing on this page deletes or rewrites player data.** Every write verifies by re-read; a dev
  origin never writes the family's config.

Full contract: `js/CLAUDE.md`, "The admin config".

### Accessibility + copy conventions

- **Colorblind-safe** (Matt is red/green colorblind): pair every hue with a shape. Palette: yellow
  `#F2B705` circle, blue `#1F5FA8` triangle, vermilion `#E0532F` square, teal `#178A7A` diamond.
- **`#ffce3a`** is the selection/emphasis accent, always with a non-colour indicator.
- **Name every player by their PROFILE NAME, never "You"** (Matt, 2026-10-14, after telling two
  sessions: *"Stop using 'You'. Use profile names. Don't make me tell you again"*): lists, rankings,
  badges, result lines, logs and results cards print the player's own name like anyone else's.
  Instructions spoken TO the player ("Tap the table...") are not names and are fine.
  `{me}` in any `makeT` string is filled with the profile name (`myName()`, `js/i18n.js`, 2026-10-15);
  the hub (alerts, Messages, match chat, profile heading) uses it. Matt, same day: in-game
  lines like "Your turn" may stay; the leaderboard and shared screens must not say "You".
  **Exception (Matt, 2026-10-18): the Multiplayer screen's heading and button say "Your turn".**
- **No em dashes** in user-facing game or profile copy.
- **Every "you win / you lose" popup gets a close (X) top-right.**
- Text size, tap targets, safe areas, motion: `docs/BUILDING-A-GAME.md`, "Part 0 — The UX floor".
