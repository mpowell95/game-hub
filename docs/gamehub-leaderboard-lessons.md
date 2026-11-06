# Game Hub leaderboard: lessons for another project

Written 2026-11-06 from this repo's docs, handoffs, reviews, commit history, and code. For a different project (a
client dashboard), so it teaches the lessons, not the leaderboard. Quotes marked **Matt:** are his exact words.
Other players are not named.

Main sources: `docs/LEADERBOARD-V2-*.md`, `docs/HANDOFF-LEADERBOARD-V2-*.md`, `docs/HANDOFF-LB2-SESSION7.md`,
`docs/HANDOFF-LB-POINTS-INFO.md`, `docs/LEADERBOARD-POINTS-DECISIONS.md`, `docs/LEADERBOARD-CONTENT.md`,
`docs/archive/HANDOFF-LEADERBOARD-REDESIGN.md`, `CLAUDE-HISTORY.md`, `js/CLAUDE-HISTORY.md`, and git log
(July to November 2026).

---

## 1. Before: what it looked like, and what was wrong

### July 2026 (the first cleanup)
- Each game's page stacked **four dense tables**: wins-losses, win rate, and a 0-100 "rating". Matt, who built
  the app, "couldn't find anything" on it.
- The title bars of the launcher, the leaderboard, and My Stats were different sizes. Matt called out that they
  were "clearly built independently".
- Draws were quietly counted as wins. **Matt:** "Tictactoe ties are being counted as wins. That's wrong."

### Late October 2026 (the board v2 replaced)
- Three tabs: **By Player**, **By Game**, **You**. By Player had 7 filters (Everything, Easy, Medium, Hard,
  Expert, No tier, Versus) and 3 sorts. By Game showed the top 3 per game.
- A game's board: tabs (All, each difficulty, "MP"), one row per player, a "Standing records" block underneath.
- **What was wrong (found by players, Matt, and three outside reviews):**
  - **No clear starting point.** It opened on By Game sorted by Most played, with nothing saying why games were
    in that order.
  - **Mixed units side by side.** The right-hand column mixed points, times, puzzles solved, obstacles, wins,
    and metres.
  - **Hidden rules looked like bugs.** "Difficulty outranks score" put 2 Expert wins above 85 Easy wins, with
    nothing on screen saying why. Sudoku's "no-hint solves rank first" lost its "no hints" label. A reviewer
    rated "compare yourself to others" a D+.
  - **One word, many meanings.** "Records" meant 3 things (gold count, lifetime feats, 1st place). The medal
    icon meant 5 things (rank, medal counts, a puzzle's solve type, most played, every row of a past-weeks list).
  - **Jargon.** "MP" (it meant Online), "Med", "Hall of Fame #".
  - **Numbers that disagreed.** The same game's leader differed between the game list and its board (Tic Tac
    Toe). A board said 2 wins while My Stats said 88 (one counted only the hardest level). The header's "N
    played" changed meaning from tab to tab.
  - **Mismatched pairs.** "Easy · 1 of 24 won" put one difficulty's badge next to a count from all
    difficulties.
  - **Inconsistent formats.** Ranks showed as "1st", "#5", "5", "=5", or a medal. Ties sometimes had no "=".
  - **Off-by-one advice.** "Take the record" hints told you how to tie, not how to lead.
  - **Too many controls.** One screen (Arrow Maze Rush) had 3 rows of tabs. Some tabs sat off-screen until you
    swiped sideways.
  - **Players thought their results were missing.** Only wins at your hardest level counted, and a shorter
    match quietly counted one level lower. A player's bug report: "Won a bunch of hard ones and they ain't
    showing up." Every game had been recorded.
  - **Slow.** Every screen downloaded every player's whole record (~930 KB) and added it up on the phone.

---

## 2. After: what it looks like now (live for everyone since 2026-11-04, v1462)

### What a person sees first
- **Games** tab: one list. Your favorites first, a divider, then every other game. Each row: game art, name,
  the leader with a gold medal, and **your place** on the right.
- Tap a game: its **board**. Name, total plays, Play, heart at the top. Tabs on top (All, each difficulty,
  Online). Then **every player**: rank, name, games played, one number with its unit.
- On All, players are grouped under thin difficulty dividers, each with a shape (circle, square, diamond,
  double diamond), so "harder ranks higher" is visible without a sentence.
- Your own row is highlighted and shows your name, never "You". A copy of it is pinned at the bottom, but
  only while your real row is off-screen.
- **Points:** every win adds points. Harder levels, longer matches, and more opponents pay more. Medals go to
  the most points.

### One tap away
- **Medal Count** tab: Medals | Wins | Win %. Win % is an extra view; it never gives medals.
- **Me** tab: 3 tiles (records held, medal place, games played), then ONE list at a time: **Golds | Lost | Closest**.
  Each Closest row is one line: "**5 points** for gold" (the gap in bold gold).
- Tap any name: that person's stats for that game. "All games" opens their page. A message button sits there.
- Search (behind an icon) and sort (an icon: A to Z, My rank, Most played, Recent).

### Hidden until wanted
- **"See how scores are calculated"**, under every board: ONE table for that game (levels down the side,
  options across, Online set apart, one footnote for the 20-point limit).
- **"?"**: how rankings work (a shape key and 4 lines).
- Full per-game details for any person: wins, losses, ties, by difficulty, by mode.
- The lifetime "Bests" were removed from boards (planned for a later "more stats" button).
- A one-time intro popup (2 pages) with "Show me where", which walks the player to the real buttons.

---

## 3. Every change, and why (grouped by theme)

### Trust the numbers first
- **"Interface redesign, not a stats redesign."** The first v2 draft invented new rankings: Win % by default,
  a 10-game minimum, separate boards per mode, a "Top level" Hall of Fame. Result: **104 gold medals instead
  of 40**, and 8 games whose default board was empty. All removed overnight. Every board now matches the old
  board row for row, checked by an automated test on real data (149 tabs, 34 games, English and Spanish).
- **One standing per game decides medals.** Not one per difficulty or mode.
- **Show everyone.** A top-10 cut was replaced by every player. A later "fold the zero rows" ("=7 · 9
  players") was undone (Matt: "ALWAYS show everybody").
- **Lists and boards must agree.** Showing a game's board place in the list was tried, then reverted: it
  contradicted Records held, Medal Count, and the player page. One source feeds all of them.
- **Tic Tac Toe's two leaders** (inherited from the old board) were unified on one rule.
- **Two pairs of similar names merged** into one person each, only on Matt's word (a wrong merge combines two
  people's results).
- **Puzzle "fewest guesses"** counts only solves without hints (a 1-guess solve after 8 hints showed as 1).

### Fairness rules (changes Matt chose on purpose)
- **Hardest level first, then points.** "Only your hardest level's wins count" made players think wins were
  missing, and one lucky Hard win could decide a board. Replaced by points per win, set per game and level.
- **No farming.** Levels won 90%+ of the time pay 1 point a win, and only the first 20 points from them count.
- **More opponents pay more** (Matt: "Games are more difficult when more people play").
- **Spelling Bee English and Spanish give separate medals** (a player reported the combined board as unfair).
- **Ties, three tries in two days:** equal points went to fewer wins, then to fewer plays, then finally to
  **the better average game, never just fewer plays** (Matt: "It should NOT go to player B because they have
  fewer rounds"). Only equal on both is a tie.

### Make the hidden rules visible, with almost no words
- Difficulty dividers with shapes on All tabs.
- A "No hints" divider on top for Sudoku and Murdoku.
- One-word labels where an order would otherwise look wrong ("Hard", "No hints").
- Advice says the gap at the record's own level: "◆ 5 longer for gold", not a meaningless difference.
- Every explanation lives behind one button with the same words on every game.

### Words and names
- "Boards" became **Games**. "MP" became **Online**. "Standing Records" became **Bests**, then left the board.
  "Hall of Fame" became **Medal Count**. "Everything" became **All difficulties**. "Hall of Fame #" became
  **Medals**. "Game Stats" became **My Stats** (one title, one close button).
- "Records" means one thing only: games where you hold 1st.
- Never "You": every person, the viewer included, by profile name. The "Me" tab is the one label exception.
- One rank format: #5, =5 for ties, medals for 1-3 only.
- Medals only where earned: none on a 0-win row, plain "#1" on lists that are not a real standing.
- Labels that say what a number is: Golf "3 under", Skeeball "Total" and "Best game".

### Layout and controls
- Tabs on top, players right under them. No tab may sit off-screen. Long tab sets get a picker.
- One list at a time on Me (Golds | Lost | Closest) instead of stacked sections with titles.
- The pinned "your row" appears only while your real row is off-screen.
- Search behind an icon; filters and sort on one line.
- Back (button or phone swipe) goes exactly one screen back, to the same tab and scroll. After Play, back
  returns to the board you came from, not the home screen.
- Hearts red; the double diamond full size; shapes as big in light mode as in dark (Matt is red/green
  colorblind, so every colour has a shape too).

### The scores table (7 mockup rounds, then rebuilt again)
- v1 big tiles with numbers: not clear they were points. v2 "Hard win +6 points": "not clear at all".
- v3 plain rows: "way better", but it hid the caveats and said "counts as 1 lower" instead of real numbers.
- v4 grouped cards: order made no sense; stars on some rows and not others.
- v6-v7: a "20-point limit" pill on every row was too much. It became a small yellow "20" ball on each limited
  row, explained once at the bottom.
- Final: one table per game, built from the code's own numbers (never typed by hand). Arrow Maze went from 151
  words to under 50.

### The intro popup (12 mockups, then 4 more)
- Title on 2 lines, made a real title. All body text one style. No line may wrap a single word.
- Both pages the same height, so the buttons never move.
- No words about the old system. A third page about the 20-point cap was cut.
- A frame and pointing finger added without being asked were removed ("put it back how we had it").
- First-open tips on each tab were dropped as obvious.

### Speed
- Boards are now built once on the server and sent as one small package (~60 KB instead of ~930 KB). Matt: "why
  are we making every individual phone do all that work". It became "instantly faster".

### Tried and undone (all in one place)
- Win % as the default, plus a 10-game minimum (later back as an optional view, with no medals).
- Boards per mode, per-mode online boards, "Top level" medals, rank-change arrows.
- Top 10 only. Folding zero rows.
- Remembering each board's last tab.
- Showing the board place on lists.
- "N more to take the record" on the board and pinned row (moved to the Me tab, as one line).
- "Reach length 44 to get gold" (became the difference: "◆ 5 longer for gold").
- The Bests block under boards.
- A "Make this my default view" button (it now just remembers).
- "Always open on By Game, Most played" (September), reversed in October.
- The 0-100 rating (July; kept in the code, off the screen).
- Points and a popup shipped to every player by a helper session without Matt's OK (rolled back the same
  evening).
- Ties to fewer wins, then to fewer plays (both replaced by "better average").

---

## 4. Principles (short rules any project can apply)

**At a glance vs. on demand**
- First screen answers one question: "where do I stand, and who leads?" One number per row, one unit.
- One click: comparisons, other views, another person's page.
- Hidden until wanted: how things are calculated, full history, rare details. Put them behind ONE button with
  the same words on every page.
- Never cut a detail. Move it behind a tap. Someone uses it.

**Defaults**
- Open on the most useful view, and make the order obvious (favorites first, a divider, then the rest).
- Remember the last view on its own. No "make this my default" buttons.
- Default rules must not empty a screen. If a default hides most people or items, the default is wrong.

**Numbers**
- One number per row. Extra numbers go one tap away.
- Never mix units in one column.
- Every screen that shows the same fact must show the same value from the same source.
- Change how things look OR how they are counted, never both in one project. Prove it with a test.
- Show everyone and everything. No top-10 cuts, no folded tails.

**Tags, badges, icons**
- One symbol = one meaning. If an icon means two things, use something else for the second.
- Earned symbols only where earned (no medal for 0).
- Never colour alone. Pair colour with a shape or a word.
- One format for the same thing everywhere (#5, =5).

**Words and names**
- Fewest words that still work. No taglines, no explanatory sentences on the main screen.
- One word = one meaning. Write the vocabulary down and use it everywhere.
- Plain words, no jargon or abbreviations ("Online", not "MP"; "Medium", not "Med").
- Name people by name, never "You".
- Say what it is now, never what it used to be.
- Advice states the difference: "5 points for gold", not "you have X, the record is Y".

**Rules people cannot see**
- If a rule changes an order, show it with a divider, a shape, or one word. No paragraph.
- Never write vague phrases like "counts as one level lower". Show the real result.
- Never hide an important caveat to save words. Put it once, prominently.

**Layout**
- Controls on top, content right under them. Nothing off-screen. One row of controls where possible.
- One list at a time instead of stacked sections.
- Buttons never move between pages of the same dialog.
- Text big and bright (body 17px or more, never dim grey), and no line wraps one key word onto its own row.
- Back goes exactly one step back, to the same place and scroll.

**Process**
- Mockup first, with real data. Feedback changes the mockup. Build only on "build it".
- Ship to the owner only first; release only on the owner's exact words.
- Check with real data before calling something done.
- Give outside reviewers the rules and definitions up front, or they spend the review on guesses.

**How this maps to a dashboard (examples only)**
- At a glance: what needs doing today and what is overdue, one status per row.
- One click: a client's page, a task's history, filters.
- On demand: how a priority or status was decided, email sweep details, full document checklists.
- One word = one meaning: "Missing", "Review", "Done" each mean one thing on every page.

---

## 5. Matt's preferences, in his words (the other project must follow them too)

**What the work is**
- "This is an interface redesign, not a stats redesign."
- "The number of gold medals this leaderboard gives out is SIGNIFICANTLY more than we previously had."
- On the July layout, keep old work but take it off screen: "drop the rating for now… keep the work on it
  somewhere in the repo for later."

**Words**
- "There are WAY too many words. This is the same comment you force me to make 10 times per day."
- "Reach length 44 to get gold is incredibly wordy. And it doesn't tell me how close I already am... I want THE
  DIFFERENCE shown. And make the bold part gold. Convey the message in as few words as possible."
- "we could easily cut the number of words in half"
- "You're like explaining how to play, which is not the purpose of this screen"
- "who cares what the system used to be? Say what it is nowwww"
- "Stop making me give you this comment" (text too small, too dim, or badly wrapped).
- Use an Oxford comma, always.

**Names**
- "Stop using 'You'. Use profile names. Don't make me tell you again"
- "Make sure that NOWHERE does it say 'You'... It must use profile names everywhere always."

**Show everything, clearly**
- "ALWAYS show everybody"
- "She's in first. Act like it." (make 1st place stand out)
- "more obvious" (the difficulty label)
- "why are you hiding the important caveats?"
- "the game to 1 part is minimized. It should be super obvious. And i dont even know what you mean by this.
  counts as 1 lower? what?"
- "it's not clear that those giant numbers are points awarded for a win on that difficulty."
- "when there are a bunch of options, like in tic tac toe, add some color or group them in a way that makes
  sense or something. it's ugly to just look at that table as is"
- "the order of things in cup pong doesn't make any sense at all. Does it to you? or did you just list stuff?"

**Clutter**
- "I don't like the 20 point limit yellow pill everywhere. i want it only at the bottom as the disclaimer."
- "Escoba Easy + Hard computers wraps onto 2 lines. is that necessary??"
- On the Bests: "I don't like them anywhere ... Maybe down the road we can add a 'more stats' button."
- On the popup: "feels chaotic... The title isn't a title... Everything looks the same"
- "those popups are super obvious" (no tips for obvious things)
- "it's annoying for the user to have the Next button move places"
- On a picture of a button: it "is confusing. People are going to try clicking on it." Then, on extras nobody
  asked for: "put it back how we had it".

**Where things live**
- "No I don't like that layout. I want it to be here in the Me tab... consolidate everything into 1 piece of
  info. Do not show my record and the all time record. Just show what is needed to beat the record."
- "press back and go back to where I was on the stats page instead of having to go back to the hub landing
  page."
- "Admin only games should not appear on the leaderboard. Not for me and not for anyone else."
- "Eventually I think we should move the info button that displays the point values to the setup screen of
  every game." (an idea, not built)

**Fairness**
- "a player can only outrank someone by matching or beating their difficulty tier. A higher score in a lower
  tier never beats a lower score in a higher tier." (the old rule, later replaced by points)
- On farming easy wins: "I don't want [a player] to be able to just farm his way so high he's untouchable...
  on easy guaranteed win games"
- "Each game should be considered its own game for gold medal leaderboard purposes"
- "Games are more difficult when more people play"
- "all ties across the gamehub should be treated this way" / "It should NOT go to player B because they have
  fewer rounds"
- "leave out the weeks" (no weekly boards for now)

**How to work with him**
- "Build and implement this ONLY for admin." / "Just implement for admin and I'll tweak it." / "build it - do
  not make it live yet"
- Release only on his words: "release it. Including the popup. Force the update so the next time someone
  opens the app they see it"
- When a helper shipped without his OK: "Undo that ..."
- "Do not argue with me and say you can't 3 times until I make you. Do it the first time I ask. Always."
- "these screens must be redone. Completely overhauled. It's terrible. I assume the rest are just as bad."
- "It's like pulling teeth" (on getting a usable mockup)
- When something broke because of the build, the answer opens with "I built it wrong."
- Matt is red/green colorblind: never colour alone.

---

## 6. What took the most rounds, and what would have saved time

### Most rounds
- **The scores table:** 7 mockup versions, then a full rebuild of every game's table. Each round fixed one
  comment at a time, a few games at a time.
- **The intro popup:** 12 mockups, then 4 more after Matt saw it built.
- **Gold medals:** the first build gave 104 instead of 40. Two overnight rounds to restore the old numbers.
- **Ties:** three different rules in two days.
- **"How close am I to the record":** 4 placements and wordings (board line, pinned row, own row, then one
  line on Me with the difference).
- **"You" and word count:** Matt repeated both many times across sessions.
- **Ranking rule:** "hardest level first" ran for weeks before players' "missing wins" reports led to points.

### Would have saved time if decided up front
- **Whether the project changes the look, the numbers, or both.** Writing "look only" on day one would have
  avoided the 104-medal build.
- **One source of truth** for every repeated number (list, board, profile, totals).
- **The tie rule and the counting rule**, written down before building.
- **A vocabulary sheet:** one word per idea, no jargon, never "You".
- **The text rules:** minimum sizes, no one-word wraps, no dim grey, fewest words.
- **"Show everyone, hide nothing, details behind one button."**
- **Where explanations live** (one button, same words everywhere).
- **Every mockup self-checked** against all the rules before Matt saw it, with ALL screens at once.
- **Real data in every mockup and review.**
- **Reviewer context given up front.** Round 1 spent most of its findings on rules it could not see.
- **The release gate:** owner-only preview, then release only on the owner's words.

---

## 7. Checklist for any screen

- [ ] Does the first view answer the main question in one glance?
- [ ] One number (or one status) per row, with its unit or label?
- [ ] No mixed units in one column?
- [ ] Is every number the same here as on every other screen that shows it?
- [ ] Is everyone and everything shown (no cut-offs, no folded tails)?
- [ ] Does each word, icon, and colour mean exactly one thing across the whole app?
- [ ] Every colour paired with a shape or word?
- [ ] No jargon, no abbreviations, no "You"?
- [ ] Fewest words? Delete every word you can, then look again.
- [ ] Is any rule that changes the order visible (a divider, a shape, one word)?
- [ ] Are caveats shown once, clearly, not hidden?
- [ ] Details behind one tap, with the same button words everywhere?
- [ ] Controls on top, nothing off-screen, one row where possible?
- [ ] Text at least 17px, bright, no line wrapping one key word alone?
- [ ] Does back go one step back, to the same place and scroll?
- [ ] Does it say what is true now, not what changed?
- [ ] Checked with real data, on the real phone size, in every language?
- [ ] Mockup approved, owner-only first, released only on the owner's words?
