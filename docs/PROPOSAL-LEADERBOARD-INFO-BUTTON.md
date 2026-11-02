# Proposal: an info (i) button on each game's leaderboard board (2026-11-02)

**For:** the Leaderboard v2 session (`docs/HANDOFF-LEADERBOARD-V2-SESSION4.md`). Evaluate it, then fold it into
the v2 design if it fits. Nothing has been built. This is a proposal only, not approved by Matt for shipping.

## Why (where this came from)

Bug report `-P5RJ8SGDZz6FEenRCnc`, 2 Nov 2026, from *King of Games* (Moonis) about Flick Soccer: "Won a bunch of
hard ones and they ain't showing up." His play log (`node tools/read-play-log.mjs 3VN33`) showed every game was
recorded. His Hard **first to 1** wins were counted as **Medium**, because of the 2026-10-29 rule that a shorter
match counts one level lower (`flick-soccer/js/ui.js` `statsDiff`, `docs/INTEGRITY-CHECKS-SPEC.md`). Nothing on
any screen says so. Players can't see how a board ranks them or what each mode counts as.

Matt's idea: a small info button people can tap to see the ranking rules for that game.

## The proposal

- **Where:** an **(i)** on each game's board in the Leaderboard. Not on the game screen: the "as few words as
  possible" rule (CLAUDE.md) keeps explanations out of game screens.
- **What it opens:** one short sheet for that game:
  1. **Ranked by:** what the board sorts on (e.g. wins weighted by level, best score, points, fewest guesses).
  2. **Counts as:** a table of every mode and the level it counts as (example below).
  3. **Losses:** what counts as a loss (quitting after the first move, a challenge cancelled after you played,
     7-day timeout).
  4. **Online:** how challenges and live games count (Flick Soccer: separately, under "online").
- **Fewest words.** Names, numbers and short lines. No paragraphs.
- **Built once, filled per game:** one shared sheet component, fed by one table of rules per game in code
  (e.g. `js/lb-rules.js`). A test fails if a game on the board has no entry, so a new game can't skip it.
- **It must not change numbers.** v2 is "an interface redesign, not a stats redesign" (Matt, 2026-10-31). The
  sheet only DESCRIBES the existing maths. Where possible, build the "Counts as" table FROM the same code that
  does the counting (e.g. call `statsDiff` for every mode) so the sheet can't drift from the real maths.

## Worked example: Flick Soccer "Counts as"

Only level and match length change how a win counts. Line-ups and who kicks off don't.

| Mode played | Counted as |
|---|---|
| Hard, first to 3 | Hard |
| Hard, first to 2 | Hard |
| Medium, first to 3 | Medium |
| Medium, first to 2 | Medium |
| Hard, first to 1 | Medium |
| Easy, first to 3 | Easy |
| Easy, first to 2 | Easy |
| Medium, first to 1 | Easy |
| Easy, first to 1 | Easy (nothing lower) |

Online challenges: counted under "online", not under a level.

## Things for the v2 session to decide

1. **Fit with the v2 design:** where the (i) sits on Boards / Hall of Fame / Me, and whether one sheet covers
   all three.
2. **The ranking line per game:** confirm each board's real sort from `js/leaderboard-ui.js` (`lb2*` exports)
   and `js/leaderboard-rank.js`. Level weights today: `TIER_WEIGHT` in `js/difficulty-tiers.js`
   (Easy 0.8, Medium 1.0, Hard 1.25, Expert 1.5).
3. **Ties inside a level (open question from Matt):** today every mode inside a level counts the same, so Hard
   first to 1 ranks the same as Medium first to 3. Matt asked what the order would be if longer matches broke
   ties (the order in the table above). That WOULD be a stats change, so it needs Matt's explicit yes. The data
   exists: every result since 2026-10-30 is stored with its full mode (`games.<id>.byMode`, `withMode`).
4. **Easy first to 1** can't drop below Easy, so it counts the same as Easy first to 3. Leave it, or note it.
5. **EN/ES:** every line through `makeT`. No other player's code on the sheet (CLAUDE.md).
6. **Scope:** about 40 games. Many share one pattern (wins weighted by level) and need only the "Counts as"
   table. Solo/score games (Skeeball, Golf, Arrow Maze, Spelling Bee, Contexto, Word Weaver) each need their own
   short line.

## Reply to Moonis (draft, not sent)

> Your wins are all saved. First-to-1 games count one level lower (Hard counts as Medium) because they're
> shorter. Play first to 2 or 3 to get Hard wins. Restarting after the first flick counts as a loss.
