# Leaderboard v2: plan R2 (2026-10-31, overnight round 2)

Source: `docs/LEADERBOARD-V2-REVIEW-3.md`. Same rule as round 1: no new number, no new order.

## Changes

1. **Places shown on lists = the board's own place.** The Boards list, Me "Games", and the Player page show the
   viewer's/person's rank on that game's DEFAULT board (the board one tap away), so a list never says "–" where the
   board ranks you, and never "=2" where the board says "Not ranked". The Boards list's leader line likewise names
   the default board's 1st. **Medal tallies (Hall of Fame, Records held) stay the old standing** (gold = 40).
2. **By Player returns** as Hall of Fame's second view: `Medals | Wins`. Wins = the old By Player list exactly
   (category All, sort Wins: total wins, fewer plays breaks a tie, ties share the place, "N played" under the name),
   through a bridge export `lb2Players`. Parity-tested against main's old By Player tab.
3. **Player page**: totals under the name (N played · N wins), "Hall of Fame #" only once (the tile).
4. **Hall of Fame ties** marked "=" like the boards.
5. **Play** on every playable board (in the title bar), as the old board had.
6. **Me "Closest"**: holder's name and number on their own line; no truncation to 3 letters.
7. Tabs: never off-screen (done: difficulties and other tabs on two rows; Skeeball machines in one picker).
8. **Tests**: parity also checks By Player, each board's header play count, per-person golds, and the medal rule.

## Stated, not changed (morning note)
- Silver/bronze: v2 counts every tied place (40 / 31 / 31); the old By Game drew only 3 rows (40 / 32 / 30 visible).
  Golds equal. Matt can pick.
- Tic Tac Toe: the old standing (Ultimate first) gives MattyIce the record; the All tab (all wins) puts HDJ, Inc. 1st.
  The lists now follow the board; the Hall of Fame keeps the standing. Matt's call to unify.

## Revision after the critique (fresh opus reviewer, 2026-10-31 ~04:25 Eastern)

- **Item 1 reverted.** The old You tab and By Game read the standing (`gameStanding`), never a board's place, and mixing
  the two contradicted Records held, the Hall of Fame and the Player tiles (Tic Tac Toe). Every list place and leader
  line = the standing. Where the standing has no place (0 wins, never played), nothing is shown, as the old You tab.
- **By Player's line under the name** = the old card's (`catInlineHTML`: wins per tier shape, runs, VS wins), not
  "N played". It opens on All / Wins (the old default); it does not follow the old saved view, and v2 remembers nothing.
- **Release gate (THE LAW rule 1), before v2 replaces the old board for players:** v2 has no By Player categories
  (difficulty 1-4, No tier, VS), no Played / Name sorts, no six-category grid on a player page, no per-game player
  stats (losses, per difficulty). The old board stays one tap away ("Old") until those exist in v2 or Matt drops them.
- Tests added: By Player row for row vs main's old tab; each board's total plays; golds per person. Still to add: the
  full standing per game from main (golden holds By Game's top 3), Me vs the old You tab, silver/bronze totals.
