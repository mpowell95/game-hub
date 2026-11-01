# Leaderboard review: answers and context (please revise your review)

You reviewed 50 screenshots of a family game app's new leaderboard with no background. That was on purpose.
Below are the owner's settled design rules (they will not change), plus the facts behind the things you could
not know from the screens. **Please revise your review with this information:** re-grade, keep every finding
that still stands, drop or reword the ones that were based on a misreading, and for anything that is
"working as designed but invisible", judge how well the screens communicate it and how to fix that
communication without changing the rule.

## About the app and this redesign

- A private app for one family and friends (about 38 players). iPhone first. Dark mode is the default.
- **This is an INTERFACE redesign only, not a stats redesign.** The owner's words: "This is an interface redesign,
  not a stats redesign." Every ranking, number, tie and medal must stay exactly what the old leaderboard showed.
  The redesign is checked by an automated test against the old leaderboard. So any ranking rule you saw is the
  old, deliberate rule, carried over unchanged.
- Gold medals: one standing per game decides 1st/2nd/3rd (40 golds across 34 games). An earlier draft gave out
  104 golds and the owner rejected it.
- The screens were captured from the point of view of the player "\*King of Games\*" (the test browser is not
  allowed to use the owner's own account). That is why King appears as "me" everywhere.
- The bottom bar belongs to the whole app (Games, Multiplayer, Messages, Leaderboards, Profile). The flask is the
  test account's chosen profile emoji, not a feature.
- The "Old" link at the bottom of Games is an admin-only escape hatch to the previous leaderboard. Players
  never see it; it disappears at release.

## The owner's settled rules (will not change)

1. **Difficulty outranks score** on a game's board. On "All", a row's place is decided first by the hardest
   difficulty the player both played and scored at, then by the number at that difficulty. So 2 wins on Expert
   ranks above 85 wins on Easy, and a 5:22 on Expert ranks above a 1:12 on Easy. The badge next to the number on
   "All" is that row's ranking difficulty (the hardest one they scored at), and the number is meant to be the
   number at that difficulty.
2. **No-hint solves rank first** (Sudoku, Murdoku): every player with a solve that used no hints ranks above every
   player whose solves all used hints. The old leaderboard said "no hints" under the number; the redesign
   dropped that label by mistake. That explains the Sudoku case you flagged (2 no-hint Medium solves above 1
   Expert solve that used hints).
3. **Never call the viewer "You".** Every player, including the viewer, is shown by their profile name. The owner
   has repeated this many times. Highlighting or bolding the viewer's own name is fine.
4. **Wins only, no win % or averages, no minimum-games cutoff.** The owner removed win % and a 10-game minimum
   from an earlier draft because they changed the rankings and medals.
5. **No time windows** (this week / this month) for now. Owner's decision.
6. **Head-to-head is shown in exactly one place**: the app's Multiplayer screen ("Records", your record against
   each person). Not on the leaderboard.
7. **Fewest words on every screen.** No taglines, no explanatory sentences on game screens; explanations belong in
   a "How to play" style screen. An info button is allowed only if it opens such a screen on purpose.
8. **Colorblind-safe** (the owner is red/green colorblind): every difficulty has its own shape (Easy circle,
   Medium square, Hard diamond, Expert two diamonds). The shapes stay; how they look can be tweaked.
9. **Standing Records** (e.g. "Wins going first", "100 cups hit") are lifetime feats across all difficulties, by
   design not filtered by the difficulty tab.
10. **Players' names are their own choice.** Asterisks ("\*King of Games\*", "\*TP\*") and titles under names ("The
    Architect", "Titititiriii") are names and taglines the players typed themselves.

## Answers to what you found confusing

- **"MP" tab (Darts and others)**: online games against other people (as opposed to vs the computer). The word
  could be clearer ("Online").
- **Golf "-2"**: strokes against par. Lower is better.
- **Contexto "🥇 9"**: Contexto awards a medal per puzzle (gold for a solve with no hints, then silver, bronze,
  plain solve). The number is how many of the player's best medal they have: "🥇 9" = 9 golds.
- **"100 cups hit"**: a Skeeball standing record: how many balls went into the 100-point hole.
- **Skeeball "Points" vs "High score"**: Points = every point scored, all games added up. High score = the best
  single game.
- **Spelling Bee "win"**: one daily puzzle; a day counts as played when you play it, and as won when you reach
  "Genius" that day.
- **"Played 34" = "All 34"**: King of Games has played every one of the 34 games. The heart chip is the
  viewer's favorites; King has none, so 0.
- **"Begoña" vs "Bego", "Andrew Powell" vs "Andrew P."**: not yet known whether these are the same people or
  separate records. Only the owner can decide to merge two names (merging the wrong two would combine two
  people's stats). Treat it as an open question, not a confirmed duplicate.
- **"Sort by my rank" on Games**: it already exists in the sort menu above the list ("A to Z" / "My rank" / "Most
  played" / "Recent"). If it was not discoverable, that is a valid finding about the control.
- **Tic Tac Toe (12 wins on Medium is #2, the leader has 3)**: a known inconsistency the redesign inherited from the
  old leaderboard: the game list counts Ultimate (the harder variant) wins first, the board's All tab counts all
  wins. The owner has to choose one rule. Valid finding.

## Confirmed by us as real problems (you were right)

- **"Take the record" hints are off by one**: they bring you to a tie, not the lead. Real bug.
- **"Records" means three different things** (gold count, standing feats, 1st place).
- **"Easy · 1 of 24 won"** pairs a difficulty badge with an all-difficulty count.
- The missing "no hints" label (rule 2).
- Your formatting, consistency and layout points (rank formats, ties without "=", filter controls, "Med" vs
  "Medium", number separators, truncated names, empty space, tappable rows, the pinned bar repeating your row).

## What we would like back

1. A revised grade and the reasoning.
2. Your problem list, revised: removed items listed with one line each on why; reworded items; new items if the
   rules above create new concerns (for example, rules that the screens fail to communicate).
3. For every rule above that a newcomer cannot see, your best way to make it understandable with the fewest
   words (the owner dislikes explanatory text on screens).
4. Keep it blunt.
