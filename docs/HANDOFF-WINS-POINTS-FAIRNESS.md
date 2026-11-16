# Handoff: are the wins games' points per difficulty fair? (2026-11-16)

**Written by a session, not by Matt.** Matt's words (2026-11-16), about the puzzle games' handoff
(`docs/HANDOFF-PUZZLE-POINTS-FAIRNESS.md`): *"evaluate them and see if the points per difficulty make sense are are
fair... Me and a session semi-arbitrarily assigned the point values"*, *"everything should be based on actual, human
plays"*, then *"Now do group 2. Group them into subgroups if that makes sense."*

**Cleared: evaluation and a written recommendation only.** NOT cleared: changing any point value, any leaderboard,
or anything players can see. Players see a change only when Matt says "release it", "ship it", or "make it live for
everyone" (root `CLAUDE.md`).

## The question

Twenty games you play to win, against the computer or online, pay leaderboard points for each win, more at harder
computer levels and with harder options. The numbers were picked by feel. Find out whether they make sense and are
fair, and say what you would change, if anything.

This is open-ended. Some angles worth considering (not a checklist, and not a hint at the answer):

- **Within a game:** does each level's points match how hard real people find it (win rate, how long a game takes,
  how often people quit)? Is Connect Four's 12 for Expert right next to its 8 for Hard?
- **Within a subgroup:** games of the same kind should probably pay about the same for about the same effort. Do they?
- **Across subgroups:** should a lucky win at Uno pay like a skilled win at Mancala? Should aim games pay like
  thinking games?
- **The 20-point cap:** the easy levels people nearly always win (90%+) are capped at 20 points per game per person.
  Are the right levels capped, and is 20 the right number? Is a level that real people now win less often wrongly
  capped, or the reverse?
- **Options:** the extras (more computers, longer matches, Cricket in order, no reracks, Cutthroat) double or add up
  points. Do real plays show those options are really that much harder?
- **Shortened matches:** they are filed one level down. Is that fair, given real win rates?
- **Online:** each game pays a flat amount for an online win against a person. Is that in line with its computer
  levels?
- **Farming:** can someone pile up points fast with an easy setup?
- **Small data:** some games or levels have very few plays. Say plainly where the data is too thin to judge.

## REAL HUMAN PLAYS ONLY (Matt, 2026-11-16: "everything should be based on actual, human plays")

- Every finding and every proposed number must come from real players' real games: wins, losses, times, quits, and
  options chosen, read from the database.
- **Not evidence:** simulations, the computer players' code or settings, your own judgement of how hard a level
  "should" be, or the "est" (estimated) numbers in the earlier proposal (`docs/LEADERBOARD-POINTS-PROPOSAL.md`, which
  marks its guesses "est").
- **Leave out non-human and test plays:** the test profile test1 / `DREG5`, any made-up test code, test-automation
  plays, and admin-only TEST-area plays (`testGames`).
- Where a level or option has too few human plays to judge, say so and leave its value alone. Never fill the gap
  with a guess.
- Every number in the report shows how many human plays and how many people it rests on, and which dates.
- If you cannot reach real player data, STOP and tell Matt. Do not evaluate without it.

## The subgroups (a starting point)

Sorted by what decides the game. If the real data says a game belongs elsewhere, move it and say why.

Points are per win at Easy / Medium / Hard (/ Expert). "Capped" = inside the 20-point limit. Code: `js/lb-points.js`
(table `P`).

### A. Strategy board games: no luck, the computer's strength is the difficulty

| Game | Per win | Online | Extras |
|---|---|---|---|
| Tic Tac Toe | Classic 1 / 1 / 5 (Easy and Medium capped); Ultimate 1 / 3 / 10 | 3 | |
| Connect Four | 1 / 6 / 8 / 12 | 5 | |
| Dots and Boxes | Small 1 / 3 / 5; Medium board 1 / 4 / 8; Large 2 / 6 / 10 | 3 | each board its own table (2026-11-09) |
| Filler | 1 / 2 / 3 | 2 | |
| Mancala | 1 / 2 / 6 | 3 | |

### B. Luck games: cards, tiles, and dice; often several computers at one table

| Game | Per win | Online | Extras |
|---|---|---|---|
| Monopoly Deal | 1 / 2 / 3 | 3 | x the number of computers (2-4) |
| Uno | 1 / 2 / 3 | 2 | x (players - 1), 3-4 players |
| Chinchón | 1 / 2 / 4 | 3, x opponents | 2-3 computers: each computer's points added up; a short match counts each one level down |
| Escoba | 1 / 2 / 4 | 2, x opponents | 2-3 computers: added up |
| Parchís | 1 / 2 / 4 | 2 | 2-3 computers (one human): added up |
| Dominoes | 1 / 2 / 3 | 3 | to 500: x2; to 150: one level down |
| Yahtzee | 1 a win, no levels | 1 | |

### C. Aim and physics games: hand skill decides it

| Game | Per win | Online | Extras |
|---|---|---|---|
| Cup Pong | 1 / 1 / 3 (Easy and Medium capped) | 3 | no reracks: x2; unlimited reracks: one level down |
| Darts | 1 / 2 / 3 | 3 | Cricket in order: x2; 101/201: one level down |
| Pool | 1 / 3 / 5 | 3 | 3 racks: x2; Cutthroat (2 opponents): x2 more; 1 rack: one level down |
| Flick Soccer | 1 / 3 / 6 (Easy capped) | 3 | first to 3 goals: Medium 4, Hard 9; first to 1: one level down (shown at the level picked) |
| Connect 4 Hoops | 1 / 3 / 5 | 3 | "until you score": one level down, Hard pays 2 |
| Air Hockey | 1 / 2 / 5 | 3 | |

### D. Neither: some luck, some skill

| Game | Per win | Online | Extras |
|---|---|---|---|
| Battleship | 1 / 1 / 3 (Easy capped) | 3 | quick board: one level's points lower |
| Boggle | 2 / 6 / 10 (Beginner / Intermediate / Pro) | 3 | 2-minute timer: one level down |

**Out of scope:** Battle Arena, Archery, and Baseball are admin-only and pay a flat 1 a win with no table yet.

## Where the history is

- How the values were chosen: `docs/LEADERBOARD-POINTS-PROPOSAL.md`, `docs/LEADERBOARD-POINTS-DECISIONS.md`,
  `docs/LEADERBOARD-POINTS-TABLE.md`, `docs/HANDOFF-OPPONENT-POINTS.md` (more opponents = more points), each game's
  `CLAUDE.md`.
- Shortened matches shown at the level picked: `js/stats-corrections.js` (`FULL_LEVEL`), `tools/test-full-level.mjs`.

## Data you can read (all read-only)

- `node tools/read-lb-snapshot.mjs` - a local copy of the server-built leaderboard (`backups/lb-z.json`): each
  person's games, per level played and won (`byDiff`), per option (`byMode`, saved since 2026-10-30).
- `node tools/read-play-log.mjs <CODE>` - every finished game with its time, mode, and detail (since 2026-10-28).
- Most need the env var `GAMEHUB_READER` (the reader key) and `NODE_USE_ENV_PROXY=1`.
- Options were saved only from 2026-10-30, and the play log only from 2026-10-28. Older wins have a level but no
  option and no time. Say which dates each number covers.

## Rules that apply

- **Read only.** No Firebase writes, no `--write` flags, no changes to the live game.
- Never use Matt's code or name in a test or probe. Test profile: test1, code `DREG5`.
- Show times in US Eastern. Never put another player's code on a page.
- Delegate only big jobs, on the cheapest model that can do them (root `CLAUDE.md`, "Subagents").

## What to send back

A short report in `docs/` (e.g. `docs/WINS-POINTS-REVIEW.md`):

1. For each subgroup, then each game: is today's table fair, with the numbers behind the answer.
2. Anything unfair between subgroups.
3. What you would change, as a before-and-after table, and who would move on each board (names, places, medals).
4. Where the data is too thin to decide.

Plain words, no padding. Matt decides; nothing ships from this report alone.
