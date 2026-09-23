# Baseball: Game Design Doc

Game Hub (`mpowell95/game-hub`). Version 12 draft, September 12, 2026. Revised after Fable architecture review.

This doc says how the game works. It is not a coding or implementation guide. Look, layout, and UI details belong in the Design Spec (next step).

**Status tags**
- **[Locked]** Decided. Change only if Matt reopens it.
- **[Tested]** Proven in the prototype. Numbers may still be tuned.
- **[Draft]** In the prototype but not yet playtested enough to lock.
- **[Open]** Not decided.

---

## 1. Core idea

- **[Locked]** Inspired by Mario Superstar Baseball (GameCube). One flat plane: pitches vary left/right and speed. Height does not matter.
- **[Locked]** You win by playing well, not by out-grinding. Stats are a small nudge. Skill and smart pitch choices decide games.
- **[Locked]** Solo vs. CPU only. Portrait phone, two thumbs.
- **[Locked]** Standing Game Hub rules apply: no helper or instructional text in game UI, fixed geometry (nothing shifts layout during play), feedback where the player is already looking, `#ffce3a` attention color always paired with a non-color cue, 12-hour time, no em dashes.

## 2. Modes

- **[Locked]** Career mode and Quick Play.
- **[Locked]** Quick Play earns nothing toward Career.
- **[Locked]** Quick Play does not record to stats at all.
- **[Locked]** Version 1 Quick Play: pick a league, everything else random. One screen.

## 3. Game rules

- **[Locked]** 3 innings.
- **[Locked]** Tie after 3: extra innings. Every extra half-inning starts with a runner on second.
- **[Locked]** No mercy rule.
- **[Locked]** 3 strikes = out, 4 balls = walk, 3 outs per half-inning.
- **[Locked]** Foul = strike, but a foul can never be strike 3.
- **[Locked]** Home team skips the bottom of the last inning if already ahead. Walk-off ends the game immediately.
- **[Locked]** Career alternates home and away. The order is shuffled, but the split across a season is even. The prototype's always-bat-first is a prototype limitation only.

### Baserunning (automatic)
- **[Locked]** Single: all runners +1. Double: +2. Triple and home run: everyone scores.
- **[Locked]** Walk: only forced runners move.
- **[Locked]** Ground out with a runner on first and fewer than 2 outs can be a double play.
- **[Locked]** Deep fly out scores the runner from third (sac fly).
- **[Locked]** Batter Speed affects beating out grounders and stretching hits.

### Steal, bunt, pickoff
- **[Locked]** Steal button (batting, runner on). Bunt button (batting). Pickoff button (pitching, runner on). All sit in reserved fixed slots that never move.
- **[Locked]** All three are tap, never hold.
- **[Locked]** Batter Speed raises steal and bunt success. Pitcher Accuracy improves pickoffs.
- **[Locked, RA]** **How each works in play.** Built as `docs/BASEBALL-3D-BUILD.md` section 9's "RA"
  stage specifies; the constants are settings.js's own STEAL_*/PICKOFF_*/BUNT_*/CPU_* block and the
  rules are in game.js (the at-bat loop), swing.js (`buntSwing`), outcomes.js (`resolveBunt`),
  bases.js (`advanceSacBunt`) and agents.js (the CPU's three decisions). Everything is decided in
  the engine and emitted as an event; the UI only presents it.

  - **Steal.** Armed between pitches, before READY, when a runner's next base is empty - FIRST AND
    SECOND ONLY; a steal of home is not modelled (the success formula is not calibrated for a
    run-scoring play, and at the CPU's own rate a runner on third would walk home most innings).
    The lead eligible runner (the one closest to home) goes on the next pitch, and the figure takes
    a 4 ft lead while the well is armed. Resolved after the pitch is flown and after the swing is
    scored: safe with probability `clamp(0.45 + 0.01 * runner.hitSpd - 0.005 * pitcher.pitchAcc,
    0.20, 0.90)`. Safe advances him one base; caught is an out and the at-bat continues. **If the
    batter puts the ball in play the steal is void** - no event, the runner was already moving, and
    the play resolves exactly as it always did. A caught steal that makes the third out ends the
    half-inning, and the batter at the plate keeps the lineup pointer: he leads off the next time
    that side bats. Emitted as `steal {runnerId, from, to, safe}`.
  - **Bunt.** Armed before READY, always available; the mode row reads BUNT and the batter squares
    on the `Bunt` clip at the wind-up. Contact is TIMING ONLY, on a window 1.6x the ordinary one -
    there is no cursor, no mode and no miss: a bunt timed outside that window is a FOUL, and a foul
    bunt with two strikes is a strikeout (the one exception to "a foul can never be strike 3").
    A bunt in play is always a grounder, 8 to 40 ft, spraying inside +/-30 deg. With runners on and
    fewer than two outs it is a **sacrifice**: every runner moves up one (the runner from third
    scores) and the batter is out, unless he beats the throw - the SAME `MECHANICS.beatOutPerPt` x
    hitSpd roll an infield grounder already uses - in which case it is a **bunt single** and the
    runners still move up one. With nobody on (or with two outs) it is a bunt for a hit: that same
    roll, else a **bunt out**. Bunt mode clears after the pitch, and a take in bunt mode is an
    ordinary take. Emitted on `atBatEnd` as `outcome: 'bunt-out' | 'bunt-single' | 'sacrifice'`.
  - **Pickoff.** Offered while pitching, before PITCH, when a runner is on first. Tapping it
    THROWS NO PITCH: the pitcher turns and throws to first (`Pickoff` clip, 0.5 s, release at
    0.3 s), the runner is out with probability `clamp(0.06 + 0.01 * pitcher.pitchAcc, 0.06, 0.35)`,
    and otherwise nothing changes. Either way the count is untouched, the lineup does not advance,
    the beat is 1.5 s and the same batter is up for the next pitch. A steal armed for that pitch is
    cancelled by the throw over. A third out from a pickoff ends the half-inning by the same path a
    strikeout's third out takes. A safety valve caps it at three throws per at-bat - not a rule, a
    guarantee that the pitch loop terminates. Emitted as `pickoff {runnerId, from, out}`.
  - **What the CPU does.** Batting: it steals when eligible with probability
    `0.12 + 0.004 * runner.hitSpd` per pitch, never with two outs and a three-ball count; it bunts
    with probability 0.06 when a runner is on, there are fewer than two outs, and the batter's
    hitPow is in the bottom third of his league's cap. Pitching: it throws over with probability
    0.08 per pitch when a runner is on first. Every one of those draws comes from the game's own
    seeded stream, and none of them is taken at all when the situation does not arise, so a pitch
    with the bases empty consumes exactly the randomness it always did.

## 4. Career

### Ladder
- **[Locked]** Little League, High School, College, Minor League, Major League. (Real minor league level names rejected as confusing.)

### Each league
- **[Locked]** Regular season, then semifinal, then championship. No quarterfinal (dropped: with 8 CPU teams plus you, a quarterfinal bracket let 8 of 9 teams in, and a quarterfinal loss had no trophy slot).
- **[Locked]** Top 4 of 9 make the playoffs, from High School up.
- **[Locked] by Matt 2026-09-22 (R16)** Little League is the exception, and it is a 4-team league: you plus three of the eight CPU teams (a weak one, a middle one and the champion). *"Little league should have a shorter season. And all teams should make the playoffs... just little league."* Every team makes its playoffs, so the tutorial can never end in "missed the playoffs": it always ends in a semifinal and, for most players, a final.
- **[Locked]** Lose the semifinal = Bronze. Lose the championship = Silver. Win it = Gold.
- **[Locked]** Only Gold advances to the next league.
- **[Locked]** Miss the playoffs = replay that league's season.
- **[Locked]** Majors championship is called the World Series.
- **[Locked] by Matt 2026-09-22 (R16)** The season length is PER LEAGUE, measured rather than estimated: *"Rework the baseball career economy from scratch... Little League is basically a tutorial... each league after that should feel like a real step up... Measure the difficulty with the simulator rather than estimating."*

```
League	Teams	Regular games	Playoffs
Little League	4 (you + 3)	3 (one against each)	all 4 in: semifinal + final
High School	9	8	top 4 of 9: semifinal + final
College	9	10	top 4 of 9: semifinal + final
Minor League	9	12	top 4 of 9: semifinal + final
Major League	9	14	top 4 of 9: semifinal + final
```

- **[Locked] by Matt 2026-09-22 (R16)** Standings: each CPU team's scripted record is scaled onto the season's own length (CPU rank r finishes `round(n * r / (size - 1))` of n), and **the player wins every tie**. Before R16 a CPU record topped out at 7 wins however long the season was, and the player lost every tie to every CPU team.
- **[Locked] by Matt 2026-09-22 (R16)** A season snapshots its own length, its own team list and its own playoff format when it starts, beside the cap and the point table it already snapshotted. A tuning deploy applies from the next season and never reshapes one in progress; a season saved before R16 keeps playing as the 12-game, all-eight-slots, top-4 season it was generated as.
- **[Locked] 2026-09-23** Mid-season, a CPU team's record covers only the games played so far: its final scripted record pro-rated (`round(finalWins * played / games)`), so it ends exactly on the full-season record. Display only; the end-of-season table that decides the playoff cut is unchanged. Before this, game 1 showed every CPU team's whole season (8-0 beside your 1-0).
- **[Locked] by Matt 2026-09-23** Schedule shape: the games above eight are repeats against the MIDDLE teams (`SCHEDULE_SHAPE` 'repeatMiddle'); every team is met at least once, and the champion exactly once, last.
- **[Locked] by Matt 2026-09-23** CPU records match your results (`STANDINGS_MODEL` 'withResults'): a CPU team's games against you count as they actually went, and only its other games are scripted, at its scripted win rate. A team you beat carries that loss. Snapshotted per season; a season already in progress keeps the fully scripted table. Measured with `sim-baseball-career.mjs`: all 8 assertions still pass and every number moved within noise (median first title 11 seasons, strong first-try World Series 30.5% to 32.0%).

### After the Majors
- **[Locked]** Winning the World Series repeats the Majors season for more titles.
- **[Locked] by Matt 2026-09-23** After a World Series win: a celebration popup ("World Series Champions", the title number, Perfect Season if earned, any pitch it unlocked, points earned), then Continue to career home with the next Majors season ready. Career home shows the title count on the Gold cup ("Gold ×2"). Points keep coming, capped at 26 as before (no cap rise per title). The Majors do not get harder after a title. The Majors final is labelled "World Series".

### Saves
- **[Locked]** One active career at a time. No save slots.
- **[Locked]** A career never ends on its own, because winning the World Series repeats the Majors season. Ending one takes an explicit **Retire** action, and Retire is the only way to start a new career.
- **[Locked]** Nothing is ever deleted. Finished careers are kept as history records and feed the leaderboard.
- **[Locked]** The engine checkpoints locally at every pitch boundary, so a resume restores the count. The remote push happens per at-bat. A count only exists mid at-bat, so a per-at-bat save alone could never restore one.
- **[Locked]** Career data is stored on the device and synced per player, so it follows you to a second phone and survives a replaced phone. The local copy is the offline source of truth, not a cache. See section 15.
- **[Locked]** You can leave to the hub or force close the app mid-game and resume exactly where you were.
- **[Locked]** There is a forfeit button. Forfeiting is a loss. There is no way to leave a career game without it counting as a win or a loss.
- **[Locked]** A resumed mid-game state carries whatever the engine's `snapshot()` holds. See section 15.

## 5. Leaderboard

- **[Locked]** Ranks low to high:
  1. League reached + best trophy in it
  2. World Series Champ
  3. World Series Champ x2, x3, and so on
  4. Perfect Season
  5. Perfect Season x2, x3, and so on
- **[Locked]** Perfect Season = win every Majors regular season, playoff, and World Series game in one season. It outranks any number of World Series titles.
- **[Locked]** Perfect Season is meant to be achievable for a player who has already won the World Series and maxed every skill. It is not meant to be reachable at median skill. The simulator measures it against a maxed, strong-timing profile, not the median tier.
- **[Locked]** Shows your best result across all careers, current and finished.
- **[Locked]** Career wins also count on the hub's cross-game wins board. Baseball has a real opponent and a real loss axis. Quick Play records nothing and forfeits are losses, so there is no free win. Revisit after the first full career, since it is a read-time change either way.
- **[Locked]** The metric is in section 16.

## 6. Your player

- **[Locked]** One player who is all 9: always bats and always pitches.
- **[Locked]** Pick L or R once per player, not per career. You bat and throw that way.
- **[Locked]** The hand choice is stored in the baseball stats counters, not the profile. The profile holds defaults only and games never write back to it.

### Skills
Hitting:
- **[Locked]** **Accuracy**: bigger timing window and bigger sweet spot.
- **[Locked]** **Power**: more distance, stronger charged swings.
- **[Locked]** **Speed**: beat out grounders, stretch hits, better steals and bunts.

Pitching:
- **[Locked]** **Speed**: pitch velocity.
- **[Locked]** **Accuracy**: pitch lands closer to your aim, bigger Nice zone, better pickoffs.
- **[Locked]** **Spin**: more bend on curve, slider, and screwball; bigger speed gap on the changeup.
- **[Locked]** Rejected labels: Contact, Break.
- **[Open]** How much each skill point changes each effect. Must stay a small nudge.

### Points and caps
- **[Locked]** Start with 15 points in hitting and 15 in pitching. Cap of 10 per skill.
- **[Draft]** Caps by league: 10, 14, 18, 22, 26. (Was +5 per league to 30. Lowered because at Majors point rates the top caps were unreachable and therefore meaningless.)
- **[Locked]** After the start, earned points can go into any skill.

### Setup
- **[Locked]** Presets, Custom, and a Randomize button (true random within caps).
- **[Draft]** Presets:

```
Preset	Hit Acc	Hit Pow	Hit Spd	Pitch Spd	Pitch Acc	Pitch Spin
Two-Way Star	5	5	5	5	5	5
Table Setter	8	2	5	5	6	4
Slugger	3	10	2	7	4	4
Speedster	6	1	8	5	5	5
Flamethrower	4	7	4	10	3	2
Junkballer	7	3	5	2	5	8
Painter	6	4	5	4	9	2
```

## 7. Earning points

- **[Locked]** Every Career win earns points. Trophies add a bonus (Bronze < Silver < Gold).
- **[Locked]** Losses pay a little in Little League and High School, and nothing from College up.
- **[Locked]** Points get smaller in higher leagues.
- **[Locked]** You can only earn points in your current league.
- **[Locked]** Points past your caps are lost. No banking (firmly rejected).
- **[Locked]** Playoff wins pay no per-win points. The trophy bonus is the entire playoff reward.
- **[Locked] by Matt 2026-09-22 (R16)** The numbers below are MEASURED, through whole careers played by the real engine (`sim-baseball-career.mjs`), not estimated. The table before R16 was set against a season length that no longer exists and a player who did not: it assumed a 9-3 record at every league, and the simulator that checked it gave the player 2 to 11 points per skill less than a real career player actually arrives with.

```
League	Win	Loss	Bronze	Silver	Gold
Little League	6	2	4	8	12
High School	3	1	3	5	8
College	2	0	3	5	8
Minor League	2	0	2	4	7
Major League	1	0	2	4	6
```

**Little League pays exactly its own cap room.** A 3-0 sweep plus Gold is 3 x 6 + 12 = 30 points, and a start build (15 per side, cap 10) has exactly 30 of room: the tutorial ends with every skill at the cap, a point (or six) after every single game, and nothing lost. Above it the cap still bites, which is the intent.

Measured yields and how long a rung's cap room takes to fill, median tier, N=150 careers:

```
League	Games	Points a season	Lost to the cap	Seasons to fill the room
Little League	3	30.0	0.0	1.0
High School	8	30.7	7.8	1.1
College	10	21.3	4.9	1.4
Minor League	12	23.5	6.0	1.7
Major League	14	11.5	3.8	3.6
```

## 8. Difficulty and CPU

- **[Locked]** Difficulty comes mostly from smarter CPU behavior, not bigger CPU stats. CPU batters never time or place better than a median human, in any league or any slot. Difficulty comes from pitching behavior, chase, pattern reading and the field.
- **[Locked]** Target regular-season win rate for a median player, and the seasons to Gold that follow from it. Little League is near-total dominance; the Majors is a real grind. This replaces a flat "Gold in about two seasons everywhere".

```
League	Win rate (Locked)	Seasons to Gold (derived)
Little League	92 to 98%	about 1
High School	70 to 80%	about 1.5
College	57 to 67%	about 2
Minor League	49 to 59%	about 3
Major League	41 to 51%	about 4.5
```

The win-rate column is Locked. The seasons column is derived from it plus the bracket and standings model, and is measured by the simulator rather than set. A full career is roughly 12 seasons and 170 games.

- **[Locked] by Matt 2026-09-22 (R16)** The bands above were set against a player who does not exist. A real career player arrives at each rung holding the previous rung's cap (5 / 10 / 14 / 18 / 22 points per skill), not the CPU's own generation level, and `sim-baseball.mjs` was measuring a player 2 to 11 points per skill weaker than that. Measured against a real career player, the regular-season win rates are **99.7 / 90 / 80 / 71 / 60 percent** - the same shape, one rung's worth higher. What R16 asks is not a flatter curve but a real ladder: *"Little League is basically a tutorial... each league after that should feel like a real step up... Winning the World Series in the majors should take at least 2 seasons."*
- **[Locked] by Matt 2026-09-22 (R16)** The measure that decides difficulty is **first-attempt Gold per league for a median player**, over whole careers, not a season win rate at an assumed skill level. Target: near-certain at Little League, likely at High School, an even chance at College, rarer at the Minors, and rare in the Majors, with at least two Majors seasons before the first World Series.
- **[Locked] by Matt 2026-09-22 (R16)** CPU rosters are generated at a per-league LEVEL (`CPU_ROSTER_LEVEL`, a mean of skill points per CPU player) bounded by a per-league CEILING (`CPU_ROSTER_CEILING`), replacing the literal 0.5 that had generated every CPU team in the game at HALF its stated level (measured means 2.9 / 5.4 / 7.5 / 8.9 / 9.9 against a player at 5 to 22). Doc section 9's "CPU teams at the player's expected level" had never once been true.
- **[Locked] by Matt 2026-09-22 (R16)** Three engine defects kept four of the six skills from mattering at all, and they are fixed rather than tuned around. **Pitch Speed:** the good-contact timing window now scales with the pitch's time to the plate, so a 95 mph pitch is harder to time than a 55 mph one (it was a flat number of milliseconds for every pitch in every league). **Spin:** the pitch is aimed at target minus break, so the break lands ON the aim - judging the strike on the post-break position meant more break bought more walks. **Pitch Accuracy:** a corner aim now resolves INSIDE the zone (it reached 1.24 zone units, off the plate, so "working the corners" meant aiming at a ball and accuracy made it worse). **Hitting Speed is still dead** and is NOT fixed here: its only asymmetric mechanic is the steal, and the simulator's model human does not steal.

- **[Locked]** These bands describe a **median** player at the league's expected skill level. A player who has won the World Series and maxed every skill is far above that and wins far more. Every target in this section is a median-player target unless it says otherwise.
- **[Locked]** Within a league, the weakest opponent and the champion sit in these bands. The sequence never rises as you go up the ladder, but it need not descend evenly: a league may be flat with a cliff at the champion, or spread across all eight slots.

```
League	Weakest slot beaten	Champion
Little League	95%	65 to 80%
High School	85%	58 to 72%
College	78%	50 to 62%
Minor League	70%	45 to 57%
Major League	62%	40 to 52%
```

- **[Draft]** Every band in this section is a starting point, tunable later from the settings block. They are not worth another round of tuning to hit exactly.
- **[Locked]** Every league's CPU teams are generated below that league's cap, so the champion has room to be better than its league mates. No league may generate every team at the cap. (R16: this is `CPU_ROSTER_CEILING`, one point under the raw cap at every league but the Minors, where a ceiling of 21 against a level of 21.0 would have pinned every value on it and flattened the slot ladder entirely - measured, and written out at the table in `settings.js`.)
- **[Open]** The cap table in section 7 assumed only Little League and High School would bind. With more seasons spent in the upper leagues, caps will likely bind everywhere. To be measured, not assumed.
- **[Locked]** CPU teams must get better as you move up. Each league's teams are generated at that league's expected player level, so they are stronger than the league below.
- **[Locked]** Within a league, the 8 teams are ordered weakest to strongest, and the schedule puts harder opponents later in the season. The championship opponent is the toughest team in the league.
- **[Locked]** Rosters are fixed. The same team always has the same players. CPU stats do not track or react to your stats.
- **[Locked]** CPU teams are generated at the player's expected level for that league (the cap minus the typical shortfall), not at the raw league cap. Generating at the cap would leave the CPU 9 to 11 points above the player from College up, which contradicts "difficulty comes from behavior, not bigger stats". (This replaces the old "CPU stats stay close to yours and rise gently game to game" line, which could not be true at the same time as fixed rosters.)
- **[Locked]** No league is unwinnable. Missing the playoffs and replaying a season is a normal part of the upper leagues, but no league's math may make Gold unreachable.
- **[Locked]** A well-timed low-Power swing beats a sloppy high-Power swing.

### CPU pitching by league
- **[Locked]** Little League: mostly fastballs down the middle.
- **[Locked]** Each league up: mixes pitches more, works the corners more, spots your habits more.
- **[Locked]** Majors: attacks your weak spots.
- **[Open]** Exact pitch mix and "spots your habits" rules per league.

### CPU batting by league
- **[Locked]** Little League: swings at almost anything.
- **[Locked]** Each league up: lays off bad pitches more.
- **[Locked]** Majors: rarely chases.

### CPU batters read your patterns
- **[Locked]** The CPU batter's pattern memory is the last 3 pitches, newest weighted most. The window is the same in every league; how strongly it is used scales by league.
- **[Draft]** **Speed:** the batter times his swing to your last few pitches (newest counts most). Throw the same speed over and over and he times it. Change speeds and he swings early or late.
- **[Draft]** **Location:** the batter leans toward where you have been throwing. Keep hitting one spot and he waits there. Move the ball around for weaker contact.
- **[Tested]** **Commit point:** the batter decides to swing about halfway to the plate. A curve or slider steered after that can make him chase or miss.
- **[Draft]** **Fooled feedback:** when a CPU swing is fooled on timing, "Early" or "Late" pops above the plate, the same place as your own batting feedback.
- **[Open]** How these scale by league. Intent: younger batters get fooled more by speed changes and guess your spot less. Majors batters read patterns best.

## 9. CPU teams

- **[Locked]** 8 teams per league, each with a style: Sluggers, Small Ball, Patient, Flamethrowers, Junkballers, Shifters, Balanced, Aces.
- **[Locked]** Each team has 9 distinct batters (own stats and L/R, lineup shaped like real baseball) and 1 pitcher per game.
- **[Locked]** Teams are generated from their style and that league's expected player level, and are the same players every time.
- **[Locked]** Players are shown by jersey number and position (for example "#24 CF"). No names.
- **[Locked]** About 1 in 4 CPU players are lefties (setting).
- **[Locked]** Some teams shift their out zones toward where you tend to hit.
- **[Locked]** Team names by league: sponsor names in Little League, small towns in High School, fake colleges, lower-tier cities in the Minors, big cities in the Majors. Fictional names only.
- **[Draft]** Name examples: Tony's Pizza Pepperonis, Iron Ridge Miners, Big Sky State Bison, Des Moines Hog Callers, Boston Harbormasters.
- **[Locked, 2026-09-23]** Full name list (40 teams): `baseball/js/ui.js` `TEAM_NAMES`, one per league and style. Full name on career screens; last word on the in-game scoreboard.

## 10. Field and hit outcomes

- **[Locked]** No fielders drawn. Out zones sit where fielders would stand:
  - 4 infield ground-out zones
  - 3 outfield fly-out zones
  - Pop-ups in the infield are outs
- **[Locked]** Singles go through gaps and as bloopers. Doubles in the gaps and down the lines. Triples in deep corners and deep center. Home runs over the wall.
- **[Locked]** Fields get bigger each league (deeper fences). Out zones also grow (better fielders). Screen size stays the same; bigger fields just render smaller.
- **[Open]** Exact zone sizes and fence distances per league.

### Majors parks
- **[Locked]** Fictional names, shapes inspired by famous parks: Boston (tall, short left wall), New York (short right porch), Chicago (ivy), San Francisco (deep right-center), Houston (short left), Detroit (deep center), Denver (huge outfield), Los Angeles (even).
- **[Locked]** No wind, air, or weather.
- **[Open]** Which park features make version 1 vs. later (for example, does ivy do anything).

## 11. Pitches

### Unlocks
- **[Locked, R11]** Quick Play now throws the SAME ladder career does, at every league - RA's own
  "Quick Play unlocks all eight for both sides" is overruled by Matt, 2026-09-21: "only 'fastballs'
  should be able to be thrown" at Little League, which the all-eight override directly
  contradicted. `unlockedPitchesFor(league, wsTitles, { quickPlay: true })` returns the identical
  list `unlockedPitchesFor(league, wsTitles)` does; the CPU throws from the SAME per-league
  `pitchMix` career uses. `QUICK_PLAY_PITCH_MIX` is deleted with the override it existed only to
  serve.
- **[Locked, R11]** Little League is fastball only. Changeup moves to High School, alongside
  curveball - it does not vanish, it is simply not the very first thing a brand-new career unlocks.

```
When unlocked	Pitch
Little League	Fastball
High School	Changeup, Curveball
College	Slider
Minor League	Knuckleball
Major League	Screwball
First World Series Champ	Eephus
World Series Champ x2	Cutter
```

### How they move
- **[Locked]** Curve and slider break away from the pitcher's throwing arm. Screwball breaks the other way. The direction is never yours to choose. R2: the AMOUNT is not either - a break is a fact of the pitch type (`BREAK_OFFSET`, section 14), shown before the ball is thrown by the point cursor, and steering after release is deleted.
- **[Tested]** Fastball: straight, fastest.
- **[Tested]** Changeup: straight, much slower. Its job is to wreck the batter's timing.
- **[Tested]** Curveball: slow, big smooth one-way bend that starts right after release.
- **[Tested]** Slider: faster, smaller bend that only starts about halfway to the plate.
- **[Tested]** Knuckleball: very slow, wobbles on its own. Not steerable.
- **[Open]** Screwball, Eephus, and Cutter movement and speed.

### Speed readout
- **[Locked]** Pitch type and speed are hidden until the ball crosses the plate. This applies when you bat and when you pitch.
- **[Locked, amended R11]** The mph shown depends on the league. Until R11 it was display only,
  with travel time a separate tuned value - that was the bug: a Little League 55 mph fastball flew
  in the same 650 ms as a Majors 95 mph one. `pitch.js`'s `timeToPlateS` now divides by this same
  readout mph (alongside `PITCH_TRAVEL_MULT` and the pitcher's own skill points, as before), so the
  number shown and the time the ball actually takes agree with each other - "a slow pitch is slow"
  (Matt, 2026-09-21).
- **[Draft]** Readout by league (mph):

```
League	Scale	FB	CH	CB	SL	KN
Little League	0.58	55	50	46	50	44
High School	0.84	80	72	67	73	64
College	0.93	88	80	74	81	71
Minor League	0.98	93	84	78	85	74
Major League	1.00	95	86	80	87	76
```

Fastball values are based on published averages (MLB four-seam about 94.7 mph in 2026; youth ranges vary widely by source). Off-speed values are estimates. A Nice pitch and a higher Pitch Speed skill push the number up.

## 12. Controls

Rewritten for R2 (`docs/BASEBALL-3D-BUILD.md` section 9), against the reference game
(`docs/BASEBALL-REFERENCE-B9.md`). The zone and both cursors are 2-D; there is no pitch meter, no
steering after release and no charged swing.

### The zone
- **[Locked]** The strike zone is a rectangle, not a line. A pitch has an `x` and a `y`, both in
  zone units (1 = the zone's own half width or half height), and a strike is `|x| <= 1 and |y| <= 1`.
- **[Locked]** The LEFT control is a square 2-D pad in both states. Tapping it without dragging
  cycles (the pitch type while pitching, the batting mode while batting); dragging moves the cursor.
  The RIGHT control is one round button: PITCH, then READY, then SWING.
- **[Tested]** Both cursors are drawn in the world at the plate, through whichever camera is live,
  never only on the pad.

### Batting
- **[Locked]** Two modes, cycled on the pad: CONTACT (big circle, ordinary power) and POWER (small
  circle, x1.12 exit velocity). The trade is the whole choice; it replaces the charged swing.
- **[Locked]** Tap READY, and the pitcher winds up. Nothing moves before that.
- **[Locked]** At release, the pitch's TARGET appears on the field as a small marker at the spot the
  ball appears to be heading for, and SLIDES to where it will really cross as the pitch breaks. You
  drag your circle onto it.
- **[Locked]** Swing is ONE tap. No hold, no charge.
- **[Tested]** A pitch crossing outside your circle is a miss, whatever the timing.
- **[Tested]** How far from the circle's centre it crossed scales the contact quality.
- **[Tested]** Early contact pulls the ball. Late contact goes the opposite way. Where you met it
  horizontally adds to that.
- **[Tested]** Vertically: the ball above your circle's centre is a fly (further, a pop-up); below
  it, a grounder; on it, a line drive.
- **[Tested]** Just outside the timing window = foul. Well outside = miss.
- **[Tested]** Timing feedback pops right after contact: "Early", "Late", or "Perfect".

### Pitching
- **[Locked]** Pick a pitch (a strip tile, or tap the pad to cycle).
- **[Locked]** Tap PITCH once. The wind-up plays and the pad is live through it; drag the control
  cursor anywhere in or around the zone. At the wind-up's mark (`PITCH_DRAG_MS`, 700 ms) the cursor
  is sampled, the ball leaves the hand, and that is the pitch. There is no meter and no second tap.
- **[Locked]** A pitch that breaks shows a second, yellow POINT CURSOR offset from the control
  cursor: where the ball will END. The ball goes to the point cursor.
- **[Locked]** Break direction is the pitch type and the pitcher's own throwing arm, never the drag
  (`BREAK_OFFSET`, settings.js). Curve and slider break away from the arm, screwball the other way.
- **[Tested]** The pitch lands close to the sampled aim, not exactly on it: Accuracy tightens the
  scatter, in both axes equally, and a perfect arm still is not a laser.

## 13. Settings block

- **[Locked]** Every league's numbers live in one editable settings block, not scattered through the game. It holds at least:
  - Games per season, wins needed for playoffs
  - Points per win and loss, trophy bonuses
  - Skill caps
  - CPU strength and behavior levels (pitch mix, chase rate, pattern reading)
  - Pitch unlocks
  - Field size and out zone size
  - Speed readout scale
  - Lefty rate for CPU players
- **[Locked]** The tuned feel values below also live in settings.

## 14. Prototype tuned values

- **[Tested]** Carry these over as starting values. Times are in milliseconds.

```
Setting	Value	Meaning
fastballMs	650	Fastball travel time (R2; was 1500)
betweenMs	800	Pause between pitches (R2; was 3000)
windupMs	1000	CPU pitcher windup (R2; was 1400)
resultMs	1200	How long a hit result shows (R2; was 1800)
timingWindow	100	Good-contact timing window
foulMult	1.7	Foul margin (x timing window)
swingDelay	60	Swing start delay
inputOffset	0	Input lag offset
cursorR.contact	0.55	CONTACT cursor radius, zone units (R2; replaces sweetSpot/batReach)
cursorR.power	0.35	POWER cursor radius, zone units (R2)
modeExitMult.power	1.12	POWER exit velocity (x) (R2; replaces chargePower)
flyOffsetFrac	0.545	Fly ball above this fraction of the cursor radius (R2)
popupOffsetFrac	0.85	Pop-up above this fraction of it (R2)
flyCenterDeg	39	Fly ball launch angle, centre (R2)
flySpreadDeg	9	Fly ball launch angle, spread (R2)
offsetSprayDeg	18	Spray from meeting the ball off-centre, at the rim (R2)
placementPenaltyMph	18	Exit velocity lost at the rim (R2; was the 1-D placement penalty)
PITCH_DRAG_MS	700	Wind-up mark: when the pitching cursor is sampled (R2, ui.js)
aimScatter	0.12	Normal pitch miss from aim, BOTH axes (R2)
cpuTimingSigma	55	CPU batter timing error
cpuSwingIn	0.78	CPU swing rate at strikes
cpuChase	0.28	CPU chase rate
cpuFool	0.25	How much speed changes fool CPU
cpuGuess	0.3	How much CPU leans to your recent spot
outZoneMult	1.0	Out zone size (x)
fieldScale	1.0	Field size (x)
```

Pitch travel time as a multiple of the fastball:

```
Pitch	Multiple
Changeup	1.4
Curveball	1.3
Slider	1.1
Knuckleball	1.45
```

Break at the plate, in zone units (R2; `BREAK_OFFSET`, settings.js). `x` flips with the pitcher's
throwing arm on every row marked "handed":

```
Pitch	x	y	Handed
Fastball	0	0	-
Changeup	0	-0.25	-
Curveball	0.45	-0.35	yes
Slider	0.35	-0.10	yes
Screwball	-0.35	-0.15	yes
Cutter	0.18	0	yes
Knuckleball	+-0.30	+-0.30	random, both axes
Eephus	0	-0.10	-
```

## 15. Career persistence [Locked]

This does not exist in the hub today. Every current save is a device-local match snapshot, and only `gamehub.stats` is mirrored to Firebase. The player code identifies who you are but carries no game save. Two-way sync is new to this repo and no existing pattern carries it. This is the phase 0 blocker.

### Two records, never merged into one

**Record A: additive stats counters.** A `bb` sub-counter under `games.baseball` in `gamehub.stats`. Derived and additive only. Syncs today for free and feeds My Stats, the aggregator, and the leaderboard.

Counter list, frozen forever once shipped:

League ids, frozen: `little`, `highschool`, `college`, `minors`, `majors`.

Pinned definitions, permanent:
- `atBats` is plate appearances minus `walksDrawn`, `sacFlies` and `sacBunts`.
- `runsScored` is the player's team. `runsAllowed` is the opponent's.
- `seasons` increments when a season resolves: after the championship game, or when the regular season ends without a playoff place.
- `forfeits` is a breakout of `total.lost`, which already includes them.
- `careersFinished` equals the number of `history` rows, and `bestLeague` is derivable from `byDiff`. Both are stored anyway and never recomputed.
- Missed playoffs is `seasons` minus `bronzes` plus `silvers` plus `golds`.

```
Counter	Merge
total (played, won, lost)	add
byDiff, keyed by five fixed league ids	add
careersStarted, careersFinished	add
bestLeague (1 to 5)	max
bestTrophyByLeague (0 to 3 per league)	max
bronzes, silvers, golds	add
wsTitles, perfectSeasons	add
seasons, forfeits	add
hits, doubles, triples, homers, grandSlams, rbi, runsScored, walksDrawn	add
atBats (plate appearances minus walksDrawn minus sacFlies minus sacBunts)	add
sacFlies, sacBunts, stolenBases, caughtStealing	add
runsAllowed, hitsAllowed, homersAllowed, walksIssued, inningsPitchedOuts, pickoffs	add
strikeoutsBatting, strikeoutsPitched	add
shutouts, noHitters, perfectGames, walkoffWins, extraInningGames	add
bestRunsGame, bestStrikeoutsPitchedGame, bestWinStreak	max
hand (L or R)	first set wins, stored as value plus timestamp; the recorder refuses to overwrite
history (finished careers, keyed by careerId)	union, never trimmed
```

- Pitch unlocks are derived from `bestLeague` and `wsTitles`, never stored.
- `hand` and `history` both need an aggregator branch and a My Stats rendering. Stored is not enough.

**Record B: the live career document.** Mutable, one per player, the only source of truth for the career in progress.

- Local: a `career` field inside `gamehub.baseball.v1`, one key per game.
- Remote: `careers/<CODE>/baseball/live`, keyed by player code, not by stats id. The live document sits one level down, beside `history` and `forks`, because a node is either a document or a parent. Putting it at `careers/<CODE>/baseball` would mean a live-doc write wipes the history. A person's two phones are two players nodes unioned only at read time, and a career needs one home both phones write to.
- The local copy is not a cache. It is the offline source of truth and its own outbox. The career must be playable with no network.
- Schema: `{ v, code, careerId, seq, baseSeq, updatedAt, device, rulesV, state }`. `baseSeq` is the remote sequence the local copy last agreed with. Without it a fork cannot be told from a normal update and would be silently discarded. A validator rejects any bad document whole and never default-fills. Migrations are forward-only and fields are never repurposed.

### Units, frozen

- Lateral positions (aim, scatter, sweet spot, bat reach) are fractions of the plate's half width.
- Field distances are in feet.
- The engine's fixed timestep is 1/120 second, matching Golf and Hill Climb.

### Sync health states

The store defines these; the words land in phase 4. Each pairs with a glyph, never color alone.

```
State	Wording
Pulling	Syncing
Offline with a local career	You are offline. Your career is saved on this phone. It syncs itself next time you open the hub online.
Fork	Your career was continued on another device. This phone's version has been kept.
Denied	(rules not yet published; log loudly, keep playing locally)
```

### Sync rules

- Every at-bat writes locally. The remote push is coalesced, one in flight, latest state wins. Always sent at game end and on app hide, verified by fresh re-read at game end.
- Push cadence is per at-bat, not per game, so a mid-game state can resume on a different phone.
- Offline, the local document is its own outbox with a dirty flag, retried on the `online` event.
- On mount, pull the remote with a short deadline. Higher remote sequence wins (switched phones). Higher local sequence pushes. If both diverged from a common point, that is a fork: the remote timeline wins because other devices have seen it, the local branch is archived at `careers/<CODE>/baseball/forks/<deviceId>-<time>`, and the player gets one plain notice. Nothing is discarded.
- The career store goes in the service worker's network-first list.
- The store makes its own auth claim before its first write. The existing claim is written by the hub, so a device that only ever opens the standalone page would otherwise be denied every write.
- Firebase rules: add a `careers` branch. Read for any signed-in device, write scoped to the device that claimed that code through the existing link, plus admins. Add `careers` to the backup script's branch list.

### Retire and history

- Retire is the only way to end a career and the only way to start a new one. It is blocked while a game is in progress: forfeit first, then retire from career home.
- Retire writes the history copy first, then clears the live document, as one atomic operation (a multi-path update remotely, copy then clear then verify locally). Never clear first.
- The full document is copied to `careers/<CODE>/baseball/history/<careerId>` and a summary row is appended to `bb.history`. Neither copy is ever deleted.

### Other rules

- A season snapshots its schedule and point table from the settings block when it starts, so a tuning deploy applies from the next season and never rewrites one in progress. Caps only ever rise.
- Career state is keyed by player code, so a player who loses their profile and gets a new code would fork from their own career. A "link my old code" path on the profile page is part of this work, not a later nicety.
- Standings for the other 8 teams are simulated and scripted, deterministic per season. The strongest team in the league always wins its games and its semifinal, so the championship opponent is always the toughest team.
- **[Locked]** A resumed mid-game state carries whatever the engine's `snapshot()` holds. The engine's snapshot is the career document's `state.game` field directly, with no translation layer, so the engine's own resume test proves the exact bytes the save carries. `SNAP_V` is bumped and migrated forward-only, never reinterpreted.

## 16. Leaderboard metric [Locked]

One integer, computed at read time from the `bb` counters, never stored:

```
perfectSeasons * 10000 + wsTitles * 100 + (league - 1) * 4 + bestTrophyInThatLeague
```

- Reproduces the whole ladder in section 5. Majors Silver is 18, a first World Series title is 119 and beats any untitled row, a Perfect Season clears 10,000 and beats any number of titles.
- Ties break on career wins. Best across careers falls out of max on the components.
- Baseball is tier-blind, so every row sorts at tier 0 and the metric alone decides. The number already encodes the league.
- Needs a bespoke card that renders the number as words ("Majors, Silver", "World Series x2"), with extra rows (careers finished, W-L, homers) and five league markers using non-color trophy shapes.

## 17. Open items (summary)

1. Final swing popup wording.
2. Power pitch meter and CPU pattern reading: playtest, then lock.
3. How CPU pattern reading and pitch mix scale per league.
4. How much each skill point changes each effect.
5. Final point values, caps, and games per season (confirm by simulator, not by feel).
6. Closed: the league settings block is a source file, tuned by deploy. No admin page control.
7. Out zone sizes and fence distances per league.
8. Steal, bunt, and pickoff mechanics.
9. Screwball, Eephus, and Cutter movement and speed.
10. Closed 2026-09-23: World Series celebration popup, then the next Majors season; cap stays 26; no difficulty change.
11. Park features for version 1 vs. later.
12. Closed 2026-09-23: 40 team names (`baseball/js/ui.js` `TEAM_NAMES`).
13. Closed 2026-09-23: schedule repeats the middle teams; you win standings ties (R16); CPU records match your results.
14. Closed: no sound in version 1.
15. Closed: team and park names are proper nouns and are not translated.
