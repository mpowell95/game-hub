# Shared modules (`js/`) — deep documentation

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`,
> which is always loaded alongside this file. The working rules in full are right below.

**Keep this file short.** A new rule goes here in one or two lines; the story behind it goes in
`CLAUDE-HISTORY.md` (append a dated section). Full original text: `CLAUDE-HISTORY.md`.
Every heading here has the same heading there, with the incidents, numbers and reasoning; read it
before changing anything this file only summarises.

## THE LAW — the full working rules

1. **Stored is not enough; data must stay VISIBLE.** Before shipping a data-shape change, list every
   screen that shows that data and every visibility gate (e.g. `br.runs > 0`) and prove each still
   shows pre-change history.
2. **Writes are additive, only.** Counters increment, bests only improve (`Math.max`); never zero,
   decrement or overwrite with less. **Carve-out:** a preference recreatable in one tap (favorites,
   theme, language, sort, seen-lists, read state, tagline) is not history; removing it is fine, no
   tombstones, and never refuse a removal citing this rule.
3. **Migrations carry forward everything that CAN be carried.** Only unit-incompatible values are
   archived, under a clearly named legacy key, and still SHOWN, labelled honestly.
4. **Never fabricate conversions.** Incomparable: archive, show as legacy, start fresh.
5. **Old keys are never deleted, never repurposed.** New shape = new key or new field names.
6. **No silent write failures.** Verify by fresh re-read, or at least `console.error`. A swallowed
   `catch {}` around a data write is a bug. Reference: `persist()` in game-stats.js (log locally
   first, write, re-read, retry unsynced on every open).
7. **Test migrations against real history:** run the actual old writer (`git show <old>:js/…`), then
   current code; assert intact AND visible. Synthetic new-shape fixtures prove nothing.
8. **When a player reports missing data, believe them.** Replay code history before blaming caches.
9. **A milestone is not done until CLAUDE.md reflects it** (any new convention, module or sync point).

## Data governance

Procedures (restore, monthly export) are in `RESTORE.md`; read it before touching custody of data.
- **`database.rules.json` is ONE canonical file — merge into it, never replace it.** Root
  `.read`/`.write` are `false`; **a new top-level node must be added there or it is unreachable.**
  Matt publishes rules by hand (app first, rules second). The README's node list is stale.
- **Out-of-app writes to `players/`, `usernames/`, or anyone's profile/stats need Matt's explicit yes.**
  Run `backups/rtdb-backup.mjs` before any Firebase write.
- **RTDB `update()` replaces each child it names** — an empty local store syncing before a restored
  device's history loads can overwrite it (`RESTORE.md`, "ordering matters").
- **No per-play log exists except Ball Run's**; exact per-play reattribution is impossible elsewhere.
- **RTDB calls on a dead connection never settle**; race a timeout (Battleship's `_withNetTimeout`, 12 s).

### Multiplayer process rules

- **Never change `js/net.js`'s protocol as a side effect of one game's work** (own handoff, review,
  real-device pass per seat count).
- **Never report "multiplayer works"**; say "proven headlessly against `FakeRoom`; real rooms unverified."
- **Verify with two browser PROFILES, never two tabs** (tabs share localStorage).

### Shared modules (`js/`)

Roles are in root `CLAUDE.md`'s table; this lists what must not be broken. Keep both current.

| Module | Invariant |
|---|---|
| `profile-store.js` | `loadProfile`/`saveProfile`/`clearProfile`, `hasName()`; see "The shared profile" |
| `favorites.js` | `gamehub.favorites.v1`, HUB ids (never stats keys); a preference |
| `layout.js` | `gamehub.layout.v1` (`comfortable`/`compact`), stamps `.gh-compact` at load; a preference; the hub re-renders on `onLayoutChange` (never under a mounted game) |
| `new-badge.js` | pure dates, no storage/DOM |
| `game-stats.js` | the only door to stats storage (`loadStats`/`persist`); per-player keys; sub-counters (`grid`,`cc`,`es`,`nb`,`tt`,`db`,`bg`,`yz`,`dm`,`hc`,`sk`,`ah`,`wo`,`gl`…); `tt/db/bg/yz/dm/sk` store `tied`; bests Math.max-only; rate gate `tooFast`; pending queue; activity log |
| `game-stats-global.js` | `window.__ghStats` for Monopoly Deal/Parchís; BD copy is verbatim-after-header (15-line header + marker), `tools/test-recorder-contract.mjs` |
| `firebase-boot.js` | the ONE boot of the named `'stats'` app (`getStatsApp()`, returns `uid`); `forceWebSockets()` before `getDatabase`; reconnect on return after 20 s away; `api.get` timed, slow reads in `gamehub.perf.v1` (`perfReport()`, mirrored `players/<id>/perf`) |
| `stats-net.js` | `players/<statsId>` mirror, `usernames/`, `syncHealth()`, `writesAllowed()`, `applyDeviceReset()`; `readPlayersOnce()` reuses the page's last `players/` read for 60 s (own sync clears it; callers get copies); pass `{fresh: true}` where a write follows the read (admin, code-owner lookup) |
| `arcade-scores.js` | daily best is a MAP by local day, never a resetting value; no `highscores/` node (`tools/test-arcade-scores.mjs`) |
| `hidden-players.js` | `isHiddenName`/`isHiddenDeviceId`; dependency-free; mirrored by hand in `tools/test-leaderboard-rank.mjs` on purpose |
| `players-agg.js` | identity graph (code ∪ name). **A sub-counter needs an explicit branch here or is silently dropped.** Holds `SOLO`, `ARCHIVED_GAMES`, `NAME_ALIAS`, `DISPLAY_NAME` |
| `game-stats-ui.js` | top-left back (`gs-up`: game page -> list -> close, 2026-10-15) beside the X; owns `gameListHTML`, `hubIdOf`, `unitKeyOf`, `gameChoices`, `isGameOnLauncher`, `visibleTabs` (more permissive, on purpose) |
| `leaderboard-ui.js` | read-only on data; owns `GAME_META`, `gamehub.lb.sort.v1`; `openLeaderboard({game})` opens on that board and backing out of it closes (a game's own Leaderboard button, 2026-10-15); `{onPlay, canPlay}` (the launcher only) adds Play to a game's board (2026-10-20) |
| `leaderboard-rank.js` | wins = stored `won`; rating exports dormant, keep; tier comparators |
| `arrow-maze-time.js`, `gridlock-points.js` | pure point/ladder maths; network-first; `way-out/CLAUDE.md`, `gridlock/CLAUDE.md`. Gridlock keys are `L<n>` (Firebase arrays numeric keys) |
| `gridlock-v1map.js` | GENERATED; never hand-edit |
| `difficulty-tiers.js` | READ path only; separate from `normDiff()` (write path) on purpose |
| `net.js` | rooms, lockstep log, recovery, N-seat roster, online gate. **Yahtzee uses it with no consumer write-up here (open gap)** |
| `name-gate.js` | undismissable; every entry point calls it before `init()`; a name claimed <24 h ago offers "That's me" (links to that code; iPhone Home Screen app, 2026-10-25) |
| `device-report.js` | `gatherDeviceReport()` load-bearing (bug reports); `uploadDeviceReport()` dormant, keep |
| `install-state.js` | dependency-free on purpose; checks both `display-mode` and `navigator.standalone` |
| `error-log.js` | `gamehub.errorlog.v1`, installed at LOAD so it catches a failing game import |
| `messages.js` | `cachedThreads()` = last SUCCESSFUL inbox read (display only, then a fresh read; a failed read never blanks the list); no hard delete; `myCode()`/`ensureAuthClaim()` reused by career-store and push; `logGameChat` (live-room chat copied into threads, NEVER the index, so no push) |
| `hub-messages.js` | `HUB_MESSAGES` append-only (never reuse an id or edit sent words); merged into `readMyThreads()` as the `HUB` row; `HUB` is never a player code; read receipt `players/<id>/hubMsgs` (report only, omitted when empty; `at: 0` = read before receipts existed) |
| `mp-records.js` | READ-only: live-room games' `byDiff.mp` (via players-agg, all your devices) + `h2h` folded onto the opponent's code; `LIVE_GAMES` must match hub.js `LIVE_MP_GAMES` (`tools/test-challenges.mjs`) |
| `challenges.js`, `challenge-life.js` | read-only fold of games' indexes (Cancel/Decline/Resign call the GAME's own writer via `endAction`/`endMatch`); `ANSWER_MS` 3 days; called-off rows stored `over:false` so push stays silent |
| `match-chat.js` | chat at `<node>/chat/<matchId>`, BESIDE the match, never in it; verified; nothing deleted; `gamehub.matchChatSeen.v1`; sides `a`/`b`, and `c` for a third player (Pool's Cutthroat, 2026-10-22; `match-chat-ui.js` `add({who})` names the sender) |
| `push.js` | `pushSubs/<CODE>/<sha256(endpoint)>`; permission asked inside the tap; `gamehub.push.v1` = write only on change |
| `admin-config.js`, `stats-corrections.js`, `admin-ui.js` | see "The admin config", "Score corrections" |
| `announce.js` | see "The announcement layer" |
| `career-store.js` | see "Career sync" |
| `challenge/` | retired but LOAD-BEARING (`hooks.js` imported every load; `isDevProfile` rests on `secrets.js`). Never delete |

**Firebase layering:** one project, anonymous auth, one named app `'stats'` via `firebase-boot.js`
(`challenge/challenge-net.js` alone boots the DEFAULT app). No dev/staging project exists. Node
ownership, by convention: stats-net `players/` `usernames/`; net `rooms/`; device-report
`deviceReports/`; bug-report `bugReports/` `bugReportShots/` `bugReplies/`; messages `messages/`
`msgAuth/`; push `pushSubs/`; admin-config `adminConfig/`; career-store `careers/`.

### Language support (2026-07-23)

- `js/i18n.js`: `getLang`/`setLang` over **`gamehub.lang.v1`**, `makeT(dict)` (chosen → English → key,
  `{name}` params, function values for grammar), `gamehub:lang` event, `onLangChange`. Stamps
  `<html lang>` at load too.
- Not a profile field (profile has inlined copies in Monopoly Deal/Parchís; a reset must not change
  language). A preference.
- Per-game `<game>/js/strings.js` `{en, es}`, in `sw.js` ASSETS. **Call `t()` at RENDER time, never at
  module scope.** Add each new dictionary to `tools/test-i18n-strings.mjs`'s `DICTS`.
- Only display labels translate; ids, stats keys, byDiff buckets, events stay canonical.
- Exclusions: Monopoly Deal, Parchís (own `parchis_r2_prefs.lang`; wiring needs the `../Parchís/`
  rebuild), `js/challenge/`, card suit/rank and proper names.
- **Game titles translate (Spain Spanish).** Three places in step: `js/strings.js`
  `game_title_<statsId>`, the `GAMES` entry `title: {en, es}`, the game's own `strings.js` `title`. Sort by
  displayed title at render time.
- **A new key can be missing for one visit** (cache-first `js/strings.js`): render with an English
  fallback (`tf`/`tx`).
- Live switch applies to newly rendered UI; games MAY subscribe via `onLangChange` (Snake does), not
  required. Reference implementation: `snake/`.
- **Spanish runs longer: check every screen you touch at 360px wide in BOTH languages** (2026-10-15
  review: tile names, unit labels, button rows and help lines overflowed only in Spanish). Spanish-only
  tightening is scoped `html[lang="es"]` (i18n stamps it); shorten the Spanish words before shrinking.
- **Boggle has TWO separate language choices — never merge them**: hub language = chrome; setup
  Dictionary = word list + dice (a stored `wordLang` always wins). `boggle/CLAUDE.md`.

### The New badge (2026-08-01)

Pure read of `GAMES[].released` (`isNewGame`, 7 days, UTC); nothing stored. Future date = new;
malformed = not new. **Only genuinely new games get `released`; never backfill.** `added` feeds only the
Newest sort (`sortMsOf()` in `js/launcher-sort.js`), never the pill (`tools/test-new-badge.mjs`). Pill is
`aria-hidden`; `aria-label` starts "New game.". NEW does not reorder the launcher; sorting new games
first would be Matt's call.

### Theme support (Phase 1, 2026-07-24 — docs/archive/HANDOFF-FB-THEME.md, batch 10)

- `js/theme.js`: **`gamehub.theme.v1`** (`light|dark|auto`, default auto), `resolvedTheme`,
  `onThemeChange`; stamps **`.gh-dark` on `<html>`**, the ONLY thing CSS keys off. A preference.
- Each surface overrides its own custom properties under `:root.gh-dark`. **No `prefers-color-scheme`
  query in game CSS, ever.** Each game gets its own `:root.gh-dark .xx-root` block (Nuts & Bolts is
  permanently dark by design). Toggle cycles light → dark → auto; its icon shows the RESOLVED theme.
- Chinchón's button calls global `setTheme('light'|'dark')`. **`chinchon-settings.dark` is left in
  place** (rule 5; one-time seed into the global key).

### Multiplayer lockstep — invariants (M1/M2b, hardened July 2026)

Lockstep games share `rooms/<CODE>` (seq-keyed move log, per-round `round`, `recovery`), apply the same
decisions and verify an FNV-1a hash (`<game>/js/hash.js`) after each remote move; the host is
authoritative. Each invariant is a fixed bug with a `[KNOWN-BUG PROBE]` in `tools/test-mp-lockstep.mjs`; all
hold at N seats.

1. **Decide the match end BEFORE emitting `roundScored`**; gate on the engine's pre-emit decision.
2. **Snapshots carry device-RELATIVE `isHuman`**: remap by SEAT on arrival, or better, put nothing
   device-relative in a snapshot.
3. **`presetStockResets` is a shift()-consumed queue**; per-round consumption never leaks into the
   next round (`startRound` clears `moves` atomically; entries stamped with game number).
4. **Autosave AFTER the MP bookkeeping** for the same event.
5. **A round-boundary snapshot resumes with the NEXT round, scores kept** — never `initMatch()`;
   a restoring guest awaits the host's round record.

On a hash mismatch the host TAKES the seq and publishes; the guest LATCHES (`mp.awaitingRecovery`).

### The third consumer: Tic Tac Toe (2026-07-27, roadmap phase 1)

`_localSeat()` from line one; reuse `net.js`'s existing fields (`round.n` = game number,
`round.dealer` = who opens); `writeResult` unused (`status:'ended'` = abandoned); a game with no
literal analogue of an invariant says so in its probe; **MP results go in the `'mp'` bucket** (T1-T7).

### The fourth consumer: Mancala (2026-07-27, roadmap phase 2)

Read a game's own seat shape before copying one (Mancala: host=P1 fixed). **Async delivery needs
`mp.redeliverRequested`**, set on cache refresh and checked before releasing `mp.delivering` (M1-M6).

### The fifth consumer: Filler (2026-07-27, roadmap phase 2)

Mutating `applyMove`: speculate on `cloneGame()`, commit only when the hash agrees. Needs the
redeliver latch. Per-game seed rides `round.deck` (F1-F6).

### The sixth consumer: Dots and Boxes (2026-07-27, roadmap phase 2)

One lockstep move per drawn edge; `mp.dealer` varies per game, `_localSeat()` fixed; needs the latch;
boundary restore calls `finish()` (`_statsCommitted` guards) (DB1-DB6).

### The seventh consumer: Pool (physics build, not the MP roadmap doc) - ARCHIVED 2026-09-28

History. Precedents still cited: a move may be shot PARAMETERS of deterministic physics; **no in-room
rematch series** (one game per room) is valid.

### The eighth consumer: Boggle (2026-07-28) — deliberately NOT lockstep

No shared state, so no log/hash/recovery. Host publishes the board; each side self-reports via
**`reportRoundResult`**; round over when BOTH results, stamped with the round number, are in
(`bothResultsIn`). `round.deck` = faces, `round.dealer` = start time. `tools/test-boggle-mp.mjs`.

### The ninth consumer: Chinchón at 3-4 seats (2026-07-28) — the N-player extension

- **Additive:** `seats`/`maxSeats` added, `host`/`guest` still populated; omit new args = identical
  behaviour (C7). `joinSeat`/`vacateSeat` new; `vacateSeat` is lobby-only; a departure ends the match.
- **Seat claims are transactional** (`runTransaction`, then re-read the roster).
- **Recovery is per seat**: `recovery/requests/<seat>`, `recovery/answers/<seat>`.
- Seat index = engine player id. One `pendingResolve` slot only because play is turn-based (C5-C7).

### The eleventh consumer of the SEAT model: Escoba at 3-4 seats (2026-08-11)

Zero `net.js` changes. Rule for every MP game: **record when the ENGINE decides the match, never behind
an awaited modal**; guard both MP end paths with `_commitStatsIfDecided()` (E5-E6, E8).

### The tenth consumer: Battleship (2026-08-04) — the first hidden-information game

Shot = two entries (`'s'` by shooter, authoritative `'a'` by defender from its LOCAL fleet); fleets are
never sent or hashed; recovery rebuilds the fleet from the device's own `gamehub.battleship.mp.v1`
(lost save → say so, leave the room, never invent a fleet). **Simultaneous actions need fixed
seat-derived slots** (`{k:'r'}` at `seat + 1`); `appendMove` is not a transaction. Authorship is
validated and failures go through recovery. Host divergence still runs `_afterStateChange` (BS1-BS7).

### The twelfth consumer: Texas Hold'em (2026-09-27) - host-authoritative, not lockstep

Host runs the engine under `rooms/<CODE>/pk`; guest moves stamped with `state.k`; presence judged on the
host's clock. Hole cards are devtools-readable (honest limit).
**Game invites ride on Messages:** optional `invite: {game, code}` (`asInvite`, `INVITE_GAMES`); Join
shown only on someone else's invite; code handed over via `sessionStorage['gamehub.airhockey.join']`.

### The thirteenth consumer: Air Hockey (2026-09-28) - real-time, not lockstep

`net.js` is lobby only; `air-hockey/js/live.js` streams `rooms/<CODE>/ah/s<side>`; the scored-on phone
decides goals (only-increasing counter).

## Report a bug (2026-08-11)

Writes no stats key, profile field or `players/` record.

### Where a player finds it

Launcher footer and profile page. **No in-game entry point, deliberately.** Preselects `_lastGameId`
(set before the import, so a failed load is preselected).

### What a report contains

Description + game (`gameChoices()`), the whole `gatherDeviceReport()`, and `environment` (device,
browser, install mode, screen, network, storage, SW build, GPU, `recentErrors`). **Every probe guarded
(`null` on refusal); gather failure sends the text alone with `gatherError`.**

### Screenshots

Downscale to 1400px, JPEG 0.78 → 0.36 until it fits; caps 3 / 900 KB / 2.4 MB (`fitsShotBudget()` at
pick time). Stored in `bugReportShots/<id>`, apart from `bugReports/<id>`. Need more: Firebase Storage,
never higher caps.

### The offline outbox — the part that matters most

Failed sends are KEPT (`gamehub.bugreports.pending.v1`), drained on load, `online`, return-to-launcher.
Too big → keep the text, set `shotsDropped`, **say so**. Success only after a fresh re-read; a failed
shot stamps `shotError` instead of failing the send.

### How Matt is notified

Matt's in-app inbox (`gamehub.bugadmin.v1`), `node tools/read-bug-reports.mjs` (`--shots`, `--deleted`), and
since 2026-09-24 `bugReportPush` (root "Push notifications").

### Replying, and clearing the inbox (2026-08-13)

Reply written TWICE: `bugReports/<id>/reply` `{text, atMs, at}` and **`bugReplies/<reporterDeviceId>/<id>`**
(what the player reads; admin-only writes since 2026-10-14). `{ok, delivered:false}` is shown honestly.
A reply sets `status:'done'`; done reports fold into `Show done (N)`. **Delete is SOFT** (`deleted`, `deletedAtMs`, two taps + Undo) and never
touches the player's copy; never add a hard delete. Player seen stamp `gamehub.bugreplies.seen.v1` =
newest reply's own time, never `Date.now()`. Player reads them in `openMyReplies()`; badge on the
profile pill (a count, never hue alone).

### The announcement layer

Seen-list `gamehub.announce.v1` (a preference). `until` retires an entry; a malformed date fails SAFE
(shown). **Append a NEW id; never reuse or renumber.** Text `{en, es}` on the entry. `shots` = whole
screens per theme (`resolvedTheme()`) × language in `img/`, neutral profile with code/device id
blanked; `tile: {art, name}` for a new game. Never over the name gate or a game; once per load.
`adminOnly: true` previews to Matt only (checked before `showAnnouncement`). `tools/test-bug-report.mjs`
checks paths/tiles and NOTEs gated entries.

### Privacy, stated plainly

Reports carry name, code, device id, the local store and screenshots into an `auth != null` database.
**The form deliberately says nothing about it** (Matt); re-adding a disclosure needs Matt first.

### A new report has to be VISIBLE from the launcher (2026-09-21)

**A badge goes where the thing it counts is REACHED.** `_paintReplyBadge` sums `adminUnreadCount` into
the Messages button on **`isAdminDevice()`** devices only; `openBugInbox` fires `gamehub:messages` to
repaint. When a button moves, move its count with it (`tools/test-bug-report.mjs` probe).

### What is NOT covered by a test

DOM and Firebase halves of bug reports were only hand-driven; `tools/test-bug-report.mjs` covers pure logic.

## Course drafts (2026-09-22)

`courseDrafts/<CODE>/<courseId>`; read by any signed-in session, write only by that code's `msgAuth` claim or an admin; in backup
`BRANCHES`; never deleted. `hole-editor/CLAUDE.md`.

## Messages (2026-08-31)

New paths only. The profile Messages card reserves its last height (`gamehub.pfMsgsHeight.v1`);
**Admin sits above Messages** (Matt), shown from cached `gamehub.adminDevice.v1`.

### The node

`messages/threads/<pairKey>/msgs/<pushId>` = `{from, text, atMs, invite?}`;
`messages/index/<CODE>/<other>` = `{at, from, preview, name, emoji, seenAt, hiddenAt}`.
`pairKey` = both codes sorted, joined `_`. **Index rows are `update()`d, never `set()`.**

### Addressed by player code, not deviceId

`profile.playerId`, so every device a person owns gets it.

### Read state is server-side, and it is a preference

`seenAt` = newest message's own time, never `Date.now()`; `isUnread` guards on `from`.

### Hiding is not deleting

**No hard delete in `js/messages.js`.** `hiddenAt` hides only until something newer arrives.

### The rest, briefly

Verify the message by re-read before index rows. Outbox `gamehub.messages.outbox.v1` (cap 10), only
`retryable` kept. Dev origin never writes. Everyone = N ordinary messages. Admin view is read-only by
construction. `messagePush` fires only when `at` advances from them.

### Privacy: this is the one node with real rules on it

`ensureAuthClaim()` writes `msgAuth/<uid> = <CODE>` (rewritable by its own uid, deliberately not
claim-once); an unclaimed device can do nothing under `messages/`. `threads/<pairKey>` needs the claimed
code in the key; `index/<CODE>` is readable only by that code's uid, its `<other>` rows writable by
either participant; `admins/<uid> === true` gives Matt read-all.
Not proof against someone with a (public) code and devtools — never oversell. `rtdb-backup.mjs` reads per
`BRANCHES` (keep in step with the rules) and records `messages/` as DENIED. `readAllThreads()` returns
`{threads, denied}`.

### What is NOT covered by a test

`tools/test-messages.mjs` covers the pure halves only.

## Who is on the installed app, and who is in a browser tab (2026-08-11)

`syncMyStats()` mirrors `installState()` + `build` to `players/<id>/device` (additive, never read by
gameplay). `tools/read-install-state.mjs`. **"Not seen yet" is missing data, never "browser tab".**
`a2hsDismissed` separates "asked and declined" from "never asked".

## The Device details button, retired (2026-08-11)

Button gone; `device-report.js`, `uploadDeviceReport()` (dormant), `deviceReports/` all stay.

## Hiding test/debug accounts from the leaderboard (2026-07-29, widened 2026-07-31)

Hiding never deletes. `HIDDEN_PREFIX` (device ids; add strays here, not name guesses), names starting
`test`/`zzz` plus `qa`, `dev`, `demo`, `preview`, `prueba` (prefix, not substring); QA name `zzztest`.
**Only test1, test2 and MattyIce run tests (Matt).** Never infer "test" from a name's shape, initials
or play count; hide a name only when Matt names it.

### Nameless devices — the gate, and why hiding them is not rule 1 again (2026-07-31)

Every entry point is name-gated, so nameless (and `'You'`) rows, hidden, are pre-gate history that
reattaches once named (`tools/test-leaderboard-rank.mjs` asserts the round trip). **Removing the gate requires first restoring the labelled "Unnamed player" rows.** Parchís: add the
gate tag to the `../Parchís/` source too. Monopoly Deal: the gate graph must be in `business-deal/sw.js`.

## `GAME_META` is a registry, and a missing row zeroes a whole game (2026-08-11)

A game without a `GAME_META` row counts ZERO on the leaderboard. `tools/players-agg.test.mjs` enforces a row
per stats id; **`OFF_THE_BOARD` stays empty** (admin-only games get a row from day one). Mode buckets
(`ai`, `mp`) count under All only; never map a mode onto a tier.

## The leaderboard's rating model (2026-07-22)

All read-time display; nothing stored or migrated.
- **Wins-only display**; losses/full records live on My Stats. Rating exports are dormant, keep them.
- **A draw is NOT a win** (Matt): wins = stored `won`. Never reinstate `played - lost`. `ttVariantWins()`
  is the second site.
- **Solo games show RUNS, not wins** (`SOLO` in players-agg is the single source); By Player's list
  stays on `ALL_IDS` so solo-only players stay listed.
- Difficulty filter resets to All; **unmapped buckets count in All only**; selection never by hue.
- **DIFFICULTY OUTRANKS SCORE on a game's own board** (Matt, 2026-09-08): the shown, sorted and ranked
  number is the score at the row's own tier (`boardMetricOf`); row tier = highest tier both PLAYED and
  SCORED at (`boardRankTier`); `null` tier rows (Skeeball, Golf, Yahtzee, legacy) sort below. **Hill
  Climb is tiered; read the recorder, not the extractor.** One order, `boardMetricCmp(id)`, for rows,
  badges and By Game's leader; ties by comparator; `compareBoardRow` for all six sort sites.
- **Games Played sort ignores difficulty** (Matt). **No minimum-games rule.**
- Tier chip (`tierChipHTML`) rides the NAME line; the You tab's numbers show a wordless `tierMarkHTML`,
  hidden while a filter is selected; a selected filter makes that tier everyone's tier. Ball Run, Snake,
  Hill Climb rank a BEST (`brBestAt`/`snBestAt`/`hcBestAt`); Tic Tac Toe's two numbers stay all-tier.
- Sort persists in `gamehub.lb.sort.v1` (seed) and `gamehub.lb.view.v1`; **tab, both sorts and category are
  remembered as they change** (`persistView`, 2026-10-27, Matt; no "make default" button). Nothing saved = By Game, A to Z.
- Chrome bands are shared `css/hub.css` vars: `--gh-band-title` 44px, `--gh-band-controls` 36px,
  `--gh-band-filter` 34px.
- `metaLine()`/`runsAtTier()` unused, kept. `js/game-art.js` is the one source of tile art (by hub id).
- Standing records are filter-independent except Skeeball machines (`machine` getter, else dropped).
  **Add a per-machine counter to the writer before showing one; never derive.** `colorSweeps` stays
  stored and on My Stats.

### Minesweeper's own board, and no "YOU" (2026-10-15)

`msBoardHTML()`: tabs All / Easy / Med / Hard / Expert (all four always), opening on All; no sort pills,
no note. All = one number per person: hardest level SOLVED (fastest), else hardest level with a best %
(`ms.bestClearedPct`, first written 2026-10-15), else a dash. A level tab = everyone who PLAYED it: times,
then % high to low, then dashes. Under each number: "W of N won" (that level; All = every level; 2026-10-20). `youBadge()` returns '' everywhere (root rule: profile names, never
"You"); the own row keeps its highlight.
**Every other board, same shape** (`plainBoardHTML`, same day): tabs All + the difficulties the field
played + MP (online wins) when anyone played online; one number per row (All: `boardMetricCmp` order,
tier shape beside it), games played under it, the unit once above the list; standing records unchanged.
**The game-specific boards keep their own numbers as TABS** (Matt: "Yes to all"; `boardView`):
Tic Tac Toe All / Ultimate / Classic / MP; Snake + Walls off / Walls on; Skeeball machine row over
Points / High score; Cup Pong + Solo (fewest throws); Hold'em Bankroll / Wins; Contexto, Golf, Arrow
Maze, Gridlock plain. `_view` holds a non-difficulty tab, reset with `_tier`. Old sort/filter code stays.
**Arrow Maze's board is Levels | Rush (2026-10-16)**: `woModesHTML`, `woRushHTML` (`_woMode`, `_woRush`,
set from `openLeaderboard({game:'wayout', woMode, woRush})`); Rush = Easy | Hard over This week / Weeks won
/ Past weeks, read from the merged `wo.rush.best`. It replaced the game's own Results screens.
On All views the row's difficulty is a bordered pill under the name (`tierPillHTML`, shape + word; Matt:
"more obvious"), not a shape beside the number.
Ranks 1-3 are ribboned medals (`medalSVG`, number on the face) with a metal rail; #1's row is lit gold
(Matt: "She's in first. Act like it."). Medals only on lists of every player.
**Three tabs (2026-10-27, Matt): By Player | By Game | You.** By Game = top 3 per game, NO numbers (Ana: mixed
units), via `gameStanding` (the board's own order). You = records held, closest to breaking (`gapText`, read at the
RECORD'S tier), not played yet + Play; "You" is allowed on that tab ONLY. Each board ends with
"<name> is 3rd. <gap>" (`standLineHTML`). Story: `CLAUDE-HISTORY.md`.

### The leaderboard's spacing (2026-10-11)

Scale 4/8/12/16/24; menu controls 40px (Matt's override), back buttons 44px via `backBtnHTML`; name
and tier chip on one no-wrap line.

### The leaderboard's blind-review pass (2026-10-11)

Keep: the `.lb-note` ordering line, the shape legend, plain-word labels via `tx()`, ONE row skeleton
(`playerCardHTML`) on every board, most-played-first games on the player page, Back steps up one level
(`stepBack()`), no URL change.

### My Stats and the leaderboard's player page — the shared game-list drill-down (2026-07-24)

`gameListHTML` is the one list builder; **leaderboard imports it as `gsGameListHTML`, never bare.**
A game shows by its OWN empty-state gate (`hasPlays()`), never a generic `total.played`. Player detail
has its own drill state `_playerGame`; Esc backs out game → player → close.

### Overlay scrolling — why the two overlays felt "glitchy" (2026-08-02)

**Scrolling fixed overlays get `overscroll-behavior: contain`. Never raw `resize` listeners (use
`onViewportResize`, unsubscribe in `destroy()`). Never `touchmove` on `document`.** Skip identical
re-renders; keep scrollTop on data pushes. Enforced by `tools/test-game-conventions.mjs`; mirror changes into
root's "USE WHAT EXISTS" table.

### When each game is played: the activity log (2026-10-11)

`gamehub.activity.v1` per store key, per game `{first, last, w:{<Monday>: plays}}`; stamped only in
`tooFast()`'s allowed branch; own key; additive, never pruned; mirrored as `players/<id>/activity`,
OMITTED when empty. `tools/test-activity.mjs`.

### Sync health, and why a leaderboard absence is not proof of anything (2026-07-22)

Every sync records `gamehub.syncHealth.v1` (`ok, lastOkAt, lastErrAt, lastErr, localPlays,
remotePlays`), logs failures loudly, verifies by re-read, retries on load/hide/launcher/`online`.

### A dev server never writes to the family database (2026-08-22)

Localhost never writes (stats, usernames, messages, admin config, careers); reads stay on; logged as
`dev-origin-blocked`. Opt-in: `gamehub.devAllowSync.v1`. LAN-by-IP dev servers are not covered.
Leaked test players: `tools/delete-test-players.mjs` (Matt-only, dry run by default).

**Diagnosing "my history is missing":** on their device, `JSON.parse(localStorage['gamehub.syncHealth.v1'])`;
`ok:false` or `localPlays` ≫ `remotePlays` = sync problem, data safe locally.

**Never seed fake stats/profile in a browser that can reach the real Firebase** (no staging; sync runs
every load). Seed offline or in headless tests only.

### A code's name is its NEWEST record's name (2026-09-24)

A record joins its code always, its name only if that is the code's current name (or it has no code).
**Rerun a whole-database before/after diff before changing the graph** (`tools/test-stats-identity.mjs`).

### Name aliases, and why a rename in Firebase does not stick (2026-07-31)

`NAME_ALIAS` (`matt → mattyice`, `lill → lili`), `DISPLAY_NAME` (`lili → 'Lili'`). A server rename never
sticks (devices re-mirror); durable fixes are an alias here, a rename ON the device, or linking devices
to one code. Every alias needs a test in `tools/players-agg.test.mjs` (a wrong alias merges two people).

### The Ana/Natalia correction (2026-07-23) — what was done, and how certain it actually is

Natalia: `players/660e7098-…`, code `C5PXN`, 8 plays; Ana untouched, so those plays count twice (Matt's
choice). Only two attributions have evidence; the rest is Matt's date rule, a policy. **Never present a
total built on this ledger as complete.** `name-gate.js` reserves "natalia" against Ana's code. Device
`f8ad1b82-…`'s old name is archived in `profile.nameArchived`, not destroyed. The gate passes the real
previous name to `claimUsername`; `adminReleaseUsername(name)` repairs stranded entries (no UI caller).

### Whose stats are these — the per-player store split (2026-07-23)

**The first code seen owns `gamehub.stats` and `players/<deviceId>`; nothing is ever migrated.** Others:
`gamehub.stats.p.<CODE>`, node `<deviceId>-<CODE>`. `gamehub.stats.owner.v1` (claimed once),
`gamehub.stats.forks.v1` (append-only). No game touches a key directly. `deviceId()` stays the MP
identity. Legacy stores (`chinchon-stats`, `bd-stats`) are never folded into a fork.
`game-stats-global.js` resolves the same key and never claims. The first-run gate reuses the owner's
code when the typed name matches the owner's, else mints a new one. Known gap: same person, new code,
different name forks away (data untouched; aggregation unions by name). `tools/test-stats-identity.mjs`.

### Head-to-head capture

`recordHeadToHead` writes `h2h[game][opponentDeviceId] = {name, w, l}`. **Keep the writer** (it is evidence).
**One reader since 2026-10-18 (Matt: "Yes? Sure?")**: `js/mp-records.js`, the Multiplayer screen's
Records. It sums your devices' rows, maps the opponent DEVICE id to their `players/` record (a shared
phone's `<dev>-<CODE>` node picked by the row's name) and that record to a person; no record = own row,
no code, never guessed. Multi-seat `won` = beat the whole table (counted against each opponent).

### Multiplayer on the leaderboard: on the GAME'S page, per game (2026-08-11)

**Read this before adding anything h2h-shaped again.** Cross-game h2h display was removed by Matt from
the LEADERBOARD; its only reader is the Multiplayer screen's Records (above, 2026-10-18). Instead: the per-game **VS chip** (`mpTileHTML`, `byDiff.mp.won`, a word, only
where online plays exist). Every MP game files online results under `'mp'`.

### Extracting multiplayer plays back out of the AI bucket (2026-08-11)

`splitEscobaMp()`: moves only what h2h PROVES, clamped, `total` untouched, verified by re-read, archived in
`escoba.esMpSplit` (never pruned). Reuse that pattern exactly.

### Nothing should ever be able to be lost (2026-08-11)

Matt: *"Nothing should ever be able to be lost. That's the rule."*
1. **Record at the moment of DECISION, from the engine**, and check what the recorder reads is ready.
2. **Failed writes are QUEUED** (`persistOrQueue()` → `gamehub.pendingResults.v1`); **drain never
   clears; `clearPendingResults()` only after the absorbing write succeeds.** Route other recorders' failed
   `persist()` through it (wired today: `recordEscoba`, `recordHeadToHead`).

## Career sync (2026-09-12, `js/career-store.js`)

`careers/<CODE>/baseball/{live, history/<id>, forks/<deviceId>-<time>}`; `reconcile` → none/push/adopt/fork.
**A fork archives local under `forks/` BEFORE adopting.** `retireCareer` = one verified multi-path write,
THEN the local record. Health `gamehub.careerSync.v1`; never throws. An invalid stored `state` is rejected
whole and left in place. Every call resolves `myCode()` fresh, calls `ensureAuthClaim()` before writes
and is gated by `writesAllowed()`. Documents are built with `newCareerDoc()`; the one consumer is
`baseball/js/career-io.js`. `__CAREER_TEST_BOOT__` only in tests.

## The admin config (2026-08-24)

`adminConfig/v1`: `games/<hubId>` {`live`, `allow/<CODE>`}, `skeeball/boards/<id>` {`open`, `testing`},
`online/<CODE>`, `corrections/{skeeball,holdem}`, `deviceResets/<statsId>`; each with `at`/`by`
(`statsId()`, audit only). Versioned: a new shape gets a new version, never reinterprets `/v1`.
- **Absent or non-boolean = code default.** Hiding is only an explicit `live: false`. Keep it so.
- Machine modes (`resolveBoardMode`): open / unlockable / testing (`testing` wins); `setBoardMode`
  writes both fields.
- **Synchronous cached reads** (`gamehub.adminConfig.v1`), one refresh per hub load.
- **Releases never un-earn**: `isBoardReleased` is ORed with the player's `isUnlocked`; nothing here
  writes `sk.unlocked`; `isBoardTesting` (read by `_earnedUnlocks`/`_ensureGoalUnlocks`) only declines to
  honour while set.
- **Writes verify by re-read**; clearing writes `null`; dev origin refuses.
- `online/<CODE>` overrides `ONLINE_BEFORE`; `js/online-gate.js` is the only gate caller.
- `allow` only adds viewers. `deviceResets` is Matt-only (root "Deleting a device's history").
- **Adding a switch:** resolver + reader, `setX()` on `writeOverride()`, admin-ui section,
  `tools/test-admin-config.mjs` case incl. a wiring check.
- **Writable only by `admins/` uids (2026-10-14).** Matt: *"NOBODY should have that power other than me."*

## Score corrections: "that machine was broken" (2026-08-24)

Editing `players/<id>` cannot work. A void is an OVERLAY, a BASELINE snapshot at
`adminConfig/v1/corrections/skeeball/<statsId>/<boardId>`, applied at display time, per PERSON (all
their statsIds); the raw record is untouched and shown. **Applied in all three:** `players-agg.js`
(before merge), `game-stats-ui.js` (incl. first paint), `skeeball/js/ui.js`. Lifetime counters with no
per-machine breakdown are left alone. Hold'em: `corrections.holdem.<statsId>` via `correctHoldemLedger`;
money never `| 0`. Testing machines record to `sk.practice` (shown, counted by nothing).

## The shared profile — contract and consumers

### Contract (`localStorage["gamehub.profile"]`)

`{version:1, name, emoji, preferredColor:"yellow"|"blue"|"red"|"green"|null, opponents:[{name, emoji, skill:1|2|3}], message, messageAt,
updatedAt, playerId}`. Writers: the profile page and the first-run name gate only; games read only.
Readers try/catch; a profile must never crash a game. **Extend additively; never rename fields.**
`message` (max 80 chars, own leaderboard page); `messageAt` (newest wins in players-agg) is separate
from `updatedAt`; a preference, so a newer empty message wins.

### `js/profile-store.js`

`loadProfile()` (validated or `null`), `saveProfile(p)`, `clearProfile()`.

### Monopoly Deal's must-stay-synced duplicates

Synced BY HAND: (1) profile reader in `business-deal/js/ui.js` (known cosmetic drift: emoji `'🧑'`,
slices 4 opponents; leave it, but update it if the profile SHAPE changes);
(2) `business-deal/js/challenge-hook.js`, byte-for-byte mirror of `js/challenge/{crypt,secrets}.js`;
(3) `business-deal/js/game-stats-global.js`, verbatim copy — on any change, copy it and bump
`business-deal/sw.js` `CACHE`. Parchís inlines its own read-only profile reader too.

### Consuming it in a game

Read once at setup. **Precedence: own saved settings > profile > defaults.** Never write back. Skill 1/2/3
= Easy/Medium/Hard (Connect Four's Expert is not a profile tier). No new avatar surfaces.

### An announcement can wait for its game to be live (2026-09-09)

`requiresGame: '<hubId>'` holds an entry until `isGameLive`, returning BEFORE `showAnnouncement` (which
marks seen). Seen-lists are keyed by id, never by `CACHE`.

### Who has actually seen an announcement (2026-09-09)

`players/<id>/announce` = `{seen, at}` is a REPORT, never read back. Admin view: by PERSON, filtered by
`hidden-players.js`; unreported = unknown, folded into "Not yet"; a bar plus names **one per line, never a
comma run** (Matt).

## `launch()` puts the chrome up BEFORE a game's `init()` (2026-09-10)

Order: import, then `_enterGameChrome(game)`, then `init()`; the load-failure path shares `_enterGameChrome`.

## How to test

Stats/identity: `tools/test-stats-replay.mjs`, `tools/test-stats-identity.mjs`, `tools/test-recorder-contract.mjs`,
`tools/test-rate-guard.mjs`, `tools/test-activity.mjs`. Leaderboard: `tools/players-agg.test.mjs`,
`tools/test-leaderboard-rank.mjs`. Admin/corrections: `tools/test-admin-config.mjs`, `tools/test-stats-corrections.mjs`.
MP: `tools/test-mp-lockstep.mjs`, `tools/test-boggle-mp.mjs`, per-game challenge suites, `tools/test-challenges.mjs`.
Hub: `tools/test-messages.mjs`, `tools/test-match-chat.mjs`, `tools/test-bug-report.mjs`, `tools/test-push.mjs`,
`tools/test-career-sync.mjs`, `tools/test-i18n-strings.mjs`, `tools/test-new-badge.mjs`, `tools/test-arcade-scores.mjs`.
Conventions: `tools/test-game-conventions.mjs`. Run only what covers your change; never `tools/run-all-tests.mjs`
unless Matt asks.
