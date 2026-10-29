# Integrity checks across games: the playbook (2026-10-28)

Written at the end of the Spelling Bee fair-play build, for the session that reviews every other game
and adds integrity checks where possible. **Done 2026-10-28: `docs/INTEGRITY-CHECKS-SPEC.md`** (what was built,
what each game records, and what a timed log would add). Spelling Bee is the worked example; its full spec is
`docs/SPELLING-BEE-INTEGRITY-SPEC.md` and its contract `spelling-bee/CLAUDE.md` ("Fair play").

## Matt's decisions (they apply to every game)

1. **THE LAW first.** A void is a READ-TIME overlay. Saves, stats stores, board rows and logs are never
   changed or deleted. The voided result still counts as **played**, with 0 points, no win, and no place,
   and it sorts **last**. "Voided days are last place always and never get any credit for any place."
2. **Silent.** The cheater's own phone never shows the void (his own rows are untouched). Everyone
   else sees 0. Matt: if he opens the hub Leaderboard and sees the corrected result, that is fine.
3. **Everyone, every language, flag-only alerts.** Checks run for all players; Matt gets a push for each
   flag. Missing or partial data is an ALERT, never a void.
4. **Strong and supporting checks.** A strong check voids on its own; any two supporting checks
   together void. A check that honest players also trip is dropped (Spelling Bee's "copy typo" was).
5. **No room for mistakes.** Before a check goes live, replay it over EVERY real log in the database and
   prove no honest player trips it. Put the replay table in the game's spec. Keep a margin (Spelling
   Bee: honest best 1.3 right per wrong, threshold 2).
6. **Matt can undo** any automatic flag on the admin page (`adminConfig/v1/<game>/undo/...`).
7. **Hand voids** go in `VOIDED_MATCHES` (`js/stats-corrections.js`), with `keepPlayed` when the play
   still counts as played.
8. **Wording.** Say "voided for cheating" or "failed the integrity checks", never "copying". Do not call
   counts "real" ("his 'REAL' Genius count is 0"). Never describe the hub as cheat-proof.

## How Spelling Bee does it (copy the shape)

| Piece | Spelling Bee |
|---|---|
| Timed event log | `beeLog/<puzzle>/<CODE>`: every guess and action with the phone's time (`spelling-bee/js/log.js`). **Detection is impossible without one**: Oct 26 and 27 had no log and were voided by hand. |
| Pure rules, shared phone/server | `js/bee-fairplay.js` (`detectCopying`, `flagSummary`), copied to the server by `tools/sync-functions-shared.mjs` |
| Server detection | `functions/bee.js` + `beeWatch` in `functions/index.js` (every 5 min): writes `beeFlags/<puzzle>/<CODE>` ONCE, pushes to admins (`adminCodes`) |
| Read-time void | the phone reads flags + `VOIDED_MATCHES` minus Matt's undo (`voidedOn`, `voidedAt`) |
| Long-term board | `boards/v1/bee`, built on the server from rows + flags (`buildBeeBoard`) |
| Admin | "Spelling Bee flags" section: Undo / Void again, hand voids, log gaps |
| Rules + backup | new nodes in `database.rules.json` and `backups/rtdb-backup.mjs` `BRANCHES` |
| Tests | `tools/test-bee-fairplay.mjs`, `tools/test-bee-server.mjs` (fake database) |

The 7 Spelling Bee checks: sorted run, no-miss burst, best words first (strong); back and burst,
Genius under 10 minutes, re-typed (supporting); right vs wrong was retired 2026-10-29 (an honest
fluent player, Ana, reached 2.5). The ideas that carry to other games:
**too fast for a person, too accurate (no misses), the best moves first, perfect order, no ordinary
human slips (re-typing, retries), and bursts right after leaving the app.**

## What other games already have (start from these)

- **Rate gate** (`js/game-stats.js`): 30 results per game per minute. Calibrated on the fastest human;
  do not narrow it.
- **Score voids** (`js/stats-corrections.js`): `VOIDED_MATCHES`, Skeeball per-machine corrections
  (`correctSkeeballRecord`), Hold'em bankroll voids (`correctHoldemLedger`), board corrections.
- **Device resets** (`adminConfig/v1/deviceResets/<statsId>`), Matt only, per incident.
- **Online gate** (`js/online-gate.js`): only codes Matt let in play online.
- **Hidden test players** (`js/hidden-players.js`): `isHiddenName`, `HIDDEN_DEVICE_PREFIX` (includes
  `a49fcaf8`, "sk", 65CNF, an automated browser).

## The first question for every game

**What does it record with timestamps?** Most games record only results (win/loss, score, best).
A check needs per-move or per-level timing. If a game has none, the first step is a log like
`beeLog` (rules branch, backup branch, writer verified by re-read), then checks on the data it gathers.

## Working rules from this session

- **Compute every number from the data before saying it.** Several wrong statements this session
  (gaps, counts, pangrams) angered Matt. If not computed, do not say it.
- **Never show Matt Spelling Bee answer words** (or any game's answers): give lengths, counts, ranks.
- Tests and probes use **test1 / `DREG5`** only, never Matt's code or name.
- **Always use an Oxford comma.** No em dashes in user-facing copy.
- King of Games (`3VN33`) was caught cheating in Spelling Bee (all 7 checks, Oct 28). Matt may want
  his other games' records looked at first.
