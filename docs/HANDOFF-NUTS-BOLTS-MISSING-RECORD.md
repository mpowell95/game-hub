# Handoff: find and restore Matt's missing Nuts & Bolts history (written 2026-11-04)

**Written by a session, not by Matt.** Quotes marked "Matt:" are his exact words. Everything else is the
writing session's findings. Read root `CLAUDE.md` (THE LAW first) and `js/CLAUDE.md` before touching anything.

## What Matt said

Matt: "I'm missing TONS of plays. Why. What happened ???!!???"
Matt: "This is your fuck up. This is definitely from when you merged my profile with the test profile and
switched our codes. You fucked it up somehow absolutely. I had WAY more levels completed than even you're saying"

THE LAW, rule 8: **believe him.** Replay the code and data history first. When you report, the answer opens with
"I built it wrong." (root `CLAUDE.md`).

## Your job

1. **Find** every Nuts & Bolts level Matt completed that the hub no longer counts, and where it went.
2. **Restore** it so the leaderboard and his stats count it again. Do it as a read-time overlay (like
   `HAND_ADDS` / voids in `js/stats-corrections.js`). Never write to `players/` without Matt's explicit yes, and
   run `backups/rtdb-backup.mjs` before ANY Firebase write.
3. **Find what lost it** and make sure it cannot happen again (a test that fails on the old behaviour).
4. Tell Matt plainly: how many levels, on which difficulty, from which record, what removed it, what you changed.
   Deploy per root `CLAUDE.md` ("Asking for a change means LIVE").

## What the hub has for Matt today (read-only, 2026-11-04)

Matt's player code is `QZCC4` (never use it in a test or probe; READING his records is fine).

| Record (`players/<id>`) | Name on it | Code | Nuts & Bolts | Other plays | Last sync (Eastern) |
|---|---|---|---|---|---|
| `dc1745bc...` | MattyIce | QZCC4 | 11 (Medium 2, Hard 6, Expert 3) | ~1,900 in all games | Nov 3, 9:26 PM |
| `e0e63fde...` | Mattyice | none | 30 (no difficulty saved) | 11 | **Jul 17, 12:49 PM** |

- The leaderboard shows exactly 41 = 11 + 30. Nothing is hidden by the board itself.
- `dc1745bc` is his iPhone Home Screen app (Safari 26.6.1, iOS 18.7). Its Nuts & Bolts setup screen (Matt's
  screenshot, Nov 4) shows Easy Level 1, Medium Level 3, Hard Level 7, Expert Level 3, which agrees with its 11
  recorded wins. Its activity log (`players/<id>/activity`, since 2026-10-11) has no Nuts & Bolts entry, and the
  play log (`playLog/QZCC4`, since 2026-10-28) has none. It has long history in other games (Skeeball 804,
  Arrow Maze 292, Ball Run 81), so its storage was not wiped.
- `e0e63fde`'s 30 wins have no difficulty because Nuts & Bolts saved wins from 2026-07-16 but only saved the
  difficulty from 2026-07-18 (commit `3a819904`). Its best level is 30, so likely levels 1-30 in a row.
  On 2026-07-17 (`0dc210c5`) the game's own save moved single-ladder progress into Easy, so the storage that
  played those 30 would show Easy Level 31.

## The lead: a record carrying Matt's code is GONE

**Device `2b0d7c05`** carried Matt's code `QZCC4`. It is no longer anywhere in `players/` (checked
2026-11-04: no key starts with `2b0d7c05`).

- `docs/archive/HANDOFF-LEADERBOARD-CORRECTION.md` (July) lists Matt's records as `dc1745bc` + `2b0d7c05`
  (real code QZCC4) + `e0e63fde`.
- `js/CLAUDE-HISTORY.md`, "A code's name is its NEWEST record's name (2026-09-24)": `2b0d7c05`, last synced
  **2026-09-13**, was named **test1** while carrying **QZCC4**, and bridged test1 (code `DREG5`) and MattyIce on
  the leaderboard. Matt: "The stats for Test1 and MattyIce are identical." This is the test-profile mix-up Matt
  remembers.
- **No doc, commit or handoff in the repo records deleting `2b0d7c05`.** How many Nuts & Bolts levels it held
  is unknown.

Ways a `players/` record can disappear, each to check:
1. `tools/delete-test-players.mjs` (Matt-only): deletes whole records by profile NAME (default "Visual Test",
   `--name` for others; refuses records with h2h or a username). A run with `--name test1` would match
   `2b0d7c05`, which was named test1. Check the script's guards and every session that might have run it.
2. `tools/delete-device-record.mjs` (Matt-only): used 2026-09-12 on `e8e6ba7c` (TP). Was it run again?
3. **The "Perf" records, deleted 2026-10-23 at Matt's request** (root `CLAUDE.md`, "Tests NEVER use Matt's
   code or name"): a perf test had set MattyIce / QZCC4 in a headless browser. Find exactly which `players/`
   ids were deleted then (session transcripts, commits around 2026-10-22/23, `docs/`), and whether
   `2b0d7c05` or any record holding Matt's Nuts & Bolts was one of them.
4. A device reset (`adminConfig/v1/deviceResets/<statsId>`): today only `e8e6ba7c` (TP, 2026-09-12) is
   stamped.
5. Anything in `functions/` that deletes under `players/` (it should not; check).

## Where the lost data can still be

1. **Matt's backups on his PC** (sessions do not have them):
   - `backups/rtdb-2026-09-12T22-08-55-909Z.json` in his game-hub folder
     (`C:\Users\powel\OneDrive\Documents\CLAUDE CODE\Personal\Game-Hub\backups\`).
   - Any later `backups/rtdb-*.json` (`backups/rtdb-backup.mjs` is supposed to run before every Firebase write,
     so there may be several, e.g. from 2026-10-23 before the Perf delete).
   - Monthly `players/` exports (`RESTORE.md`, section (c)).
   Ask Matt to upload them (Dropbox: he types `/dropbox`). In each, look up `players/2b0d7c05...` and any
   record with `profile.playerId === 'QZCC4'` or a Matt-like name, and read `stats.games.nutsbolts`
   (`total`, `byDiff`, `nb.solved`, `nb.bestLevel`, `nb.bestByTier`).
2. **The Firebase console**: check whether Realtime Database backups are switched on for the project
   (Blaze plan) and, if so, what dates exist. Matt would have to look; give him exact clicks.
3. **Storage on one of Matt's devices that never synced again**: the storage behind `e0e63fde` (last sync
   Jul 17) or behind `2b0d7c05` (last sync Sep 13). On an iPhone, Safari and the Home Screen app keep separate
   storage. Opening the hub in that browser uploads whatever it holds (it never overwrites other records).
   Matt said opening it elsewhere did not help ("No they don't"), so do not lean on this; ask which devices and
   browsers he has used.

## How to read the live data (read-only)

`GAMEHUB_READER` is set in the session environment. This lists Matt's records with their Nuts & Bolts numbers:

```js
// node read-mine.mjs out.json   (READ-ONLY)
import { signInForReading } from '<repo>/tools/reader-auth.mjs';
import { firebaseConfig } from '<repo>/js/firebase-config.js';
import fs from 'node:fs';
const { idToken } = await signInForReading();
const all = await (await fetch(`${firebaseConfig.databaseURL}/players.json?auth=${idToken}`)).json();
fs.writeFileSync(process.argv[2], JSON.stringify(all));
for (const [id, rec] of Object.entries(all)) {
  const p = rec.profile || {};
  if (p.playerId !== 'QZCC4' && !/matt/i.test(p.name || '') && !id.startsWith('2b0d7c05')) continue;
  const g = ((rec.stats || {}).games || {}).nutsbolts || {};
  console.log(id, p.name, p.playerId === 'QZCC4', JSON.stringify(g.total), JSON.stringify(g.byDiff), JSON.stringify(g.nb));
}
```

Also useful: `node tools/read-play-log.mjs QZCC4` (since 2026-10-28), `node tools/read-lb-snapshot.mjs`
(the board package), `git fetch --shallow-since=2026-07-01 origin main` (the clone is shallow).

## Restoring (once the numbers are known)

- Read-time only: add the recovered Nuts & Bolts wins per difficulty to Matt's person in the aggregation
  (follow `HAND_ADDS` in `js/stats-corrections.js` and how `players-agg.js` applies corrections), so the
  server-built board (`functions/boards.js`, which copies `players-agg.js`) and his phone both count them.
  Nuts & Bolts counts each level once per person (`dedupeNutsBolts`); make sure restored levels are not
  removed as duplicates of his current record's levels.
- Show Matt the before/after numbers and get his OK before deploying.
- `tools/test-puzzle-points.mjs`, `tools/players-agg.test.mjs`, `tools/test-stats-corrections.mjs`,
  `tools/test-boards.mjs` must stay green; add a case for the restore.

## Related, on hold (do not change without Matt)

Nuts & Bolts POINTS (admin devices only, v1458): 1, 2, 4, 8 a level, Easy at most 20 points. Matt called it
"too crazy" and said "Don't change nuts and bolts scoring yet". Options he has seen: 1, 2, 3, 4 or 1, 1, 2, 2.
See `docs/HANDOFF-LB2-SESSION7.md`, "On hold".
