# Portfolio summary: Game Hub

Written 2026-11-05 from this repo's code and docs (CLAUDE.md files, `docs/`, `TODO.md`, `js/hub.js`).
Facts only. **[unsure]** marks anything the repo does not state clearly. Usage numbers are copied
from where the repo recorded them, with their date; nothing is estimated.

## 1. Overview

- **What:** a private, ad-free, installable web app (PWA) that hosts 40+ self-made browser games for one
  family and their friends. Live at https://mpowell95.github.io/game-hub/.
- **Problem it solves:** one place for the family to play games on their phones, with no ads, shared
  profiles, shared stats and leaderboards, and online play with each other.
- **Built by:** Matt Powell (owner, product decisions, testing on his own phone), with Claude Code
  sessions writing the code under rules he set (root `CLAUDE.md`).
- **Stack:** plain JavaScript (ES modules), HTML, CSS. No framework, no build step, no dependencies.
  Hosted as static files on GitHub Pages. Firebase Realtime Database for sync and online play;
  Firebase Cloud Functions for push notifications and server-built leaderboards.
- **Size (measured 2026-11-05):** about 2,170 files in git; about 372,000 lines of JS/CSS/HTML after
  excluding the main generated data files **[unsure: some generated code may still be counted]**;
  172 files in `tools/`, 99 of them `test-*` scripts; 42 entries in the game launcher registry.
- **Timeline:** started early July 2026 as a two-game hub (a 2026-07-03 snapshot is referenced);
  folder renamed from `Connect-Four/` on 2026-07-21. Current build **v1468** (`sw.js` CACHE); pull
  requests are numbered up to #1510 (merged 2026-11-04). Git history in this clone is shallow
  (starts 2026-11-02), so earlier dates come from the docs.
- **Who uses it:** Matt, family, and friends. Docs describe "about 38 players, one family and friends.
  iPhone first" (2026-10-31). Online play is limited to accounts Matt approves.

## 2. Platform features (the hub itself)

Each line: what it does / how it works / status, date.

**App shell and offline**
- **Launcher + module system** (`js/hub.js`, `index.html`): a grid of game tiles; tapping one loads
  that game's code into the page without a reload, and unloads it cleanly on exit. Two games
  (Monopoly Deal, Parchís) open as their own pages instead. Live.
- **Service worker / offline caching** (`sw.js`): caches the app in three tiers (core shell, every
  game's files warmed in the background, large data only on first use). Carries unchanged files
  across updates by content hash, so an update downloads only what changed. Has a network deadline
  so a bad connection falls back to cache. Live; rewritten 2026-08-02, extended through 2026-10-22.
- **Update control:** players' phones switch to a new build only at a fresh open (not mid-game);
  important builds can be flagged to update sooner (`IMPORTANT_SINCE`). Live, 2026-10-22.
- **Unreleased games held back:** an admin-only game's files are only downloaded to phones that show
  it. Live, 2026-10-14 (doc: saves ~4.3 MB per phone).
- **Light/dark theme, English/Spanish, Comfortable/Compact layout** (`js/theme.js`, `js/i18n.js`,
  `js/layout.js`): per-device settings. Compact adds a bottom tab bar. Live; compact layout 2026-10-17.
- **No zoom / no page scroll on game screens, back swipe = one screen back** (`js/no-zoom.js`,
  `js/back-stack.js`). Live; back swipe 2026-11-02.

**Profiles and identity**
- **Shared profile** (`profile/`, `js/profile-store.js`): name, emoji, colour, computer opponents,
  tagline; every game prefills from it. Includes a "choose a name" gate. Live; profile page rebuilt
  2026-10-29.
- **Player codes:** each person has a short code that links their phones; stats from all their
  devices are combined (`js/players-agg.js`). Live.
- **Device keys (security):** each claimed phone registers a device key with the server
  (`js/device-key.js`, `functions/claim.js`). Step A live (v1465, 2026-11-04, invisible to players).
  Step B (PINs for a new phone, tighter database rules) is planned, not built.

**Stats and leaderboards**
- **Unified stats** (`js/game-stats.js`): one recorder per game; every result records the mode and
  options it was played with (`withMode`), enforced by a scan of every file
  (`tools/scan-game-modes.mjs`). Failed writes are queued and retried. Live; mode recording 2026-10-30,
  enforced 2026-11-02.
- **Data-safety rules ("THE LAW"):** player data is never deleted or lowered; migrations carry
  everything forward; writes are verified by re-read. Written after a 2026-07 migration hid one
  player's history. Enforced by many test scripts (e.g. `players-agg.test`, `test-stats-replay`).
- **Sync to Firebase** (`js/stats-net.js`): each device mirrors its stats to `players/<id>`; a sync
  with nothing new sends nothing (2026-10-23). Live.
- **Server-built leaderboard** (`functions/boards.js`): the server groups all players once and
  publishes one compressed package; phones read that instead of the whole player list. Live,
  2026-10-22. Recorded effect: ~60 KB download instead of ~930 KB.
- **Leaderboard v2** (`js/leaderboard2-ui.js`): Games / Medal Count / Me tabs, points on wins boards
  and on Sudoku, Murdoku, and Minesweeper, an intro popup. Released to everyone 2026-11-04 (v1462).
  A test proves its numbers match the old board on real data (397/397, 2026-11-03).
  Nuts & Bolts points still admin-only (held by Matt).
- **My Stats**, **Records** (head-to-head, on the Multiplayer screen). Live.
- **Rate gate:** at most 30 results per game per minute per device. Live, 2026-09-12.
- **Integrity checks (anti-cheat)** (`js/integrity.js`, `js/bee-fairplay.js`, `functions/integrity.js`,
  `functions/bee.js`): impossible stored numbers void that game on the server-built board; other
  rules push an alert to admins; Spelling Bee copy detection every 5 minutes. Live, 2026-10-28/29.
  Docs say plainly it does not make the hub cheat-proof.
- **Score corrections:** voids applied at read time; raw data never changed (`js/stats-corrections.js`).
  Live.
- **Play log** (`js/play-log.js`): every recorded result (and Contexto's every guess) sent to an
  admin-only log as evidence. Live, 2026-10-28.

**Multiplayer and social**
- **Live rooms** (`js/net.js`): real-time online games over Firebase, 2 to 8 seats; leaving after
  your first move counts as a loss (`js/live-leave.js`, 2026-10-29). Idle rooms deleted by the server
  after an hour (2026-10-23). Live.
- **Turn-by-turn challenges:** play-by-mail matches in many games (Darts, Cup Pong, Pool, Battleship,
  Chinchón, Escoba, Flick Soccer, Skeeball, Hoops, Archery, Battle Arena). Moves use the server's
  clock; 3 days to answer, 7 days per turn then forfeit (2026-10-29). Live; first ones 2026-09-24.
- **Multiplayer screen** (`js/challenges-ui.js`): your-turn list, their-turn list, every multiplayer
  game, a Remind bell. Live, 2026-10-18 (was the Challenges screen, 2026-10-05).
- **Online approval gate** (`js/online-gate.js`): only codes Matt lets in can play online. Live,
  2026-10-08.
- **Messages** (`js/messages.js`): player-to-player messages addressed by player code; nothing is ever
  deleted ("Hide" only). In-game quick chat appears in the conversation. Messages from the Game Hub
  itself, with read receipts. Live, 2026-08-31 (hub messages 2026-10-14).
- **In-match chat** for every online game (`js/match-chat.js`). Live, 2026-10-14.
- **Push notifications** (`js/push.js`, `functions/`): "your turn", new message, bug report, reminders
  after 24 hours, nudges; never for your own action, never while the hub is open; app icon badge.
  Live, 2026-09-23 (reminders 2026-10-20, Remind bell 2026-10-22).
- **Player directory** (`directory/`): a small server-built name list for "pick a person" screens.
  Live, 2026-10-22. Recorded effect: 2 KB instead of ~930 KB.

**Admin and support**
- **Admin page** (`js/admin-ui.js`): Matt-only. Show/hide games, approve online players, review
  integrity flags (Keep / Void / Undo), voids, announcements, Game Hub messages. Every write
  re-read to verify; nothing on it deletes player data. Live, 2026-08-24; rebuilt as its own page
  2026-10-29.
- **Report a bug** (`js/bug-report.js`): in-app report with a device dump, offline outbox, Matt's
  replies shown back to the player. Live.
- **Announcements** (`js/announce.js`): one-time launcher popups with an end date. Live.
- **Automatic deploys:** merging to `main` deploys the site (GitHub Pages) and the Cloud Functions and
  database rules (GitHub Actions workflow). Live, 2026-10-18 (first green run 2026-10-21).
- **Test-automation guard** (`js/automation.js`): a test browser can never write player data or play
  online. Live, 2026-10-29.
- **Performance logging:** database reads over 1.5 s are logged per phone; websockets forced and fast
  reconnect after time away (`js/firebase-boot.js`). Live, 2026-10-27.

## 3. Games

Status as recorded in `js/hub.js` and root `CLAUDE.md` on 2026-11-05. "Admin-only" = only Matt (and
anyone he opens it to) sees it. "Released" dates are the go-live dates recorded in `js/hub.js`;
games with no date were already live before 2026-08-02 and their exact date is not recorded.

| Game | What it is | Status | Date |
|---|---|---|---|
| Connect Four | vs computer; Expert uses an exact solver in a Web Worker | Live | first game, July 2026 |
| Chinchón | Spanish rummy, 2-4 players; live rooms + challenges | Live | July 2026; challenges 2026-10-18 |
| Monopoly Deal | card game vs computer, own page (folder `business-deal/`) | Live | not recorded |
| Parchís | board game, own page, built from a separate project | Live | not recorded |
| Dominoes | vs computer | Live | 2026-08-01 |
| Escoba | Spanish card game, 2-4 seats + challenges | Live | challenges 2026-10-18 |
| Filler, Mancala, Tic Tac Toe, Dots and Boxes | classic games with online play | Live | not recorded |
| Boggle | English/Spanish word lists, online | Live | not recorded |
| Snake, Nuts & Bolts, Ball Run, Uno, Yahtzee | solo / vs computer (Yahtzee online) | Live | not recorded |
| Hill Climb | driving game | Live | 2026-08-02 |
| Battleship | online + challenges with salvos | Live | 2026-08-04; challenges 2026-10-27 |
| Skeeball | 5 machines, unlocks, challenges | Live | 2026-08-24 |
| Sudoku | hint use lowers rank | Live | 2026-09-12 |
| Minesweeper | grid puzzle | Live | 2026-09-22 |
| Connect 4 Hoops | shoot balls into 7 hoops over a Connect Four board; online | Live | 2026-09-22 (in code 2026-10-26) |
| Brick Breaker | solo | Live | 2026-09-23 |
| Texas Hold'em | up to 8 players online, bankroll | Live | 2026-09-27 |
| Cup Pong | vs computer, solo, challenges | Live | 2026-09-28 (in code 2026-10-26) |
| Air Hockey | vs computer + live online | Live | 2026-09-28 (in code 2026-10-26) |
| Contexto | word-guessing by meaning, EN/ES, daily board | Live | 2026-09-28 |
| Murdoku | logic puzzle | Live | 2026-09-30 |
| Darts | vs computer, pass and play, challenges | Live | 2026-10-03 (in code 2026-10-26) |
| Arrow Maze | puzzle ladder, points, Rush mode (folder `way-out/`) | Live | 2026-10-13 (in code 2026-10-27) |
| Flick Soccer | vs computer, 2 players, challenges | Live | 2026-10-20 |
| Pool | 8-ball, 9-ball, Cutthroat; challenges for 2 or 3 players | Live | 2026-10-23 (in code 2026-10-26) |
| Spelling Bee | one puzzle a day, EN/ES, daily board, fair-play checks | Live | 2026-10-26 |
| Gridlock | sliding-block puzzle, 4,000-level ladder | Live | 2026-11-02 |
| Word Weaver | swipe-letters crossword, EN/ES, daily puzzle, points | Live | 2026-11-02 |
| Golf | three-tap swing, courses, own leaderboard | **[unsure]** made admin-only on 2026-09-10 by an admin switch; current setting is not in the repo | built by 2026-09-11 |
| Course Creator | golf hole/course editor, no stats | Admin-only (opened to chosen codes) | not recorded |
| Archery | vs computer, pass and play, challenges | Admin-only, in progress | not recorded |
| Battle Arena | match-3 monster battle, online | Admin-only, test mode | 2026-10-24 |
| Baseball | 3D (three.js) stadium, being rebuilt in stages | Admin-only, in progress | not recorded |
| Cup Baseball | on Cup Pong's table | Admin-only | 2026-10-23 |
| Tower | stack sliding blocks | Admin-only | 2026-11-01 |
| Pinball 2 | new pinball engine and editor; no stats yet | In progress, not on launcher | not recorded |
| Pinball, Pool (old), Pipes | earlier games | **Retired** (archived, data kept) | 2026-09-28 |

## 4. Developer and admin tools (not deployed)

- **Test suite:** 99 `tools/test-*` scripts: service worker update/caching, data safety and
  migrations, mode recording, integrity rules, leaderboard parity, no player codes in pages, swipe
  back, game conventions. Many run against real (read-only) database snapshots. Live, used by
  every session.
- **Asset validator** (`tools/validate-sw-assets.mjs`): rebuilds the service worker's file list and
  content hashes before each deploy. Live.
- **Database backup** (`backups/rtdb-backup.mjs`): full snapshot, required before any database write.
  Live, 2026-07-23.
- **Read-only admin readers** (`tools/read-play-log.mjs`, `read-builds.mjs`, `read-install-state.mjs`,
  `read-lb-snapshot.mjs`, and others): read logs and stats with a limited reader key. Live,
  2026-10-30.
- **Matt-only data scripts** (delete a device record, delete test players): dry-run by default.
- **Data generators:** Contexto data, Spelling Bee puzzles (EN/ES), Word Weaver levels (EN/ES),
  Gridlock levels, Arrow Maze boards, emoji set.
- **Mockup Pad** (`tools/mockup-pad/`): a phone photo editor (claude.ai artifact) Matt uses to mark up
  screenshots for Claude. Live (private), version of 2026-11-03.
- **Simulators/probes:** e.g. a Baseball career economy simulator, Skeeball throw grids,
  computer-vs-computer match runs used to tune difficulty.

## 5. Usage numbers recorded in the repo

These come from different counting methods (device records vs people vs filtered boards), so they
do not line up with each other. Do not combine them.

| Date | Number | Source |
|---|---|---|
| 2026-08-25 | "6 people today. Never more than about 12." (planning assumption at the time) | `docs/archive/skeeball-sessions/HANDOFF-LEADERBOARD-DESIGN-SPEC-2026-08-25.md` |
| 2026-09-12 | 263 device records in the database (262 after one cheating device was removed); that one device had 4,839 plays, 4,725 of them a Tic Tac Toe bot | `docs/DEV-TOOLING.md`, `docs/CLAUDE-HISTORY.md` |
| 2026-09-24 **[unsure of exact date]** | 280 synced records; total across everyone 2,594 **[unsure what unit: likely plays]** | `js/CLAUDE-HISTORY.md` |
| 2026-10-01 | 289 device records and 8,597 plays | `darts/CLAUDE-HISTORY.md` |
| 2026-10-22 | 24,627 Skeeball throws stored (then archived and deleted 2026-10-23 at Matt's request) | root `CLAUDE.md` |
| 2026-10-29 | 93 records, 58 people (fresh snapshot); 89 records, 55 people (earlier backup) | `docs/INTEGRITY-CHECKS-SPEC.md` |
| 2026-10-31 | 38 people on the leaderboard (after hiding test names); 34 games on the launcher | `docs/LEADERBOARD-V2-REVIEW-2.md` |
| 2026-10-31 | "About 38 players, one family and friends" | `docs/LEADERBOARD-V2-REVIEWER-CONTEXT-2.md` |
| 2026-11-02 | 36 people on the board (after hidden-name filter); play log: 849 entries, from 7 people | `docs/LEADERBOARD-POINTS-PROPOSAL.md` |
| ~2026-11-02 | 61 "real people" in a stats-screen test run **[unsure how counted; differs from the 36-38 above]** | `docs/HANDOFF-LB-POINTS-INFO.md` |
| Arrow Maze | 62 real records checked for a points change | `way-out/CLAUDE.md` |
| Connect 4 Hoops | 75 of 75 real matches agreed with a new win rule | `hoops4/CLAUDE.md` |

**Performance numbers recorded:**
- Whole player list ~930 KB vs server-built board ~60 KB and player directory 2 KB (2026-10-22).
- Launcher load under an injected 8 s-per-request slow network: 40.6 s to 2.6 s after the service
  worker rewrite (August 2026 **[unsure of exact date]**).
- Background download tier: 11.92 MB across 255 files, 3.23 MB of it Boggle word lists, which were
  then moved to load-on-first-play (August 2026).
- Holding back unreleased games: ~4.3 MB saved per phone (2026-10-14).
- Play screen waited up to 12 s on a setup card before the 2026-10-27 connection fix.

**None found:** daily/monthly active users, total installs, retention, session length, number of
online matches played, push notifications sent, bug reports received.
