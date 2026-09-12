# Baseball: Game Design Doc

Game Hub (`mpowell95/game-hub`). Version 8 draft, September 12, 2026. Revised after Fable architecture review.

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
- **[Open]** How each works in play (timing, success odds, what the CPU does).

## 4. Career

### Ladder
- **[Locked]** Little League, High School, College, Minor League, Major League. (Real minor league level names rejected as confusing.)

### Each league
- **[Locked]** Regular season, then semifinal, then championship. No quarterfinal (dropped: with 8 CPU teams plus you, a quarterfinal bracket let 8 of 9 teams in, and a quarterfinal loss had no trophy slot).
- **[Locked]** Top 4 of 9 make the playoffs.
- **[Locked]** Lose the semifinal = Bronze. Lose the championship = Silver. Win it = Gold.
- **[Locked]** Only Gold advances to the next league.
- **[Locked]** Miss the playoffs = replay that league's season.
- **[Locked]** Majors championship is called the World Series.
- **[Draft]** 12 regular season games per league across 8 opponents. Tune after playtesting.
- **[Open]** Schedule shape (12 games over 8 teams) and standings tie-breakers.

### After the Majors
- **[Locked]** Winning the World Series repeats the Majors season for more titles.
- **[Open]** Confirm: after a World Series win, does the next Majors season start right away, and do points keep coming (subject to caps)?

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
- **[Draft]** Numbers, to tune after playtesting. At 12 games a season with a 9-3 record and Gold:

```
League	Cap room	Yield	Cap binds
Little League	30	38	Yes, excess lost
High School	24	27	Yes, barely
College	24	15	No, about 1.5 seasons
Minor League	24	13	No, about 2 seasons
Major League	24	12	No, about 2 seasons
```

Only the first two leagues hit their cap. The simulator confirms or retunes all of this before any number is locked.

```
League	Win	Loss	Bronze	Silver	Gold
Little League	3	1	3	5	8
High School	2	1	2	4	6
College	1	0	2	4	6
Minor League	1	0	1	2	4
Major League	1	0	1	2	3
```

## 8. Difficulty and CPU

- **[Locked]** Difficulty comes mostly from smarter CPU behavior, not bigger CPU stats.
- **[Locked]** CPU teams must get better as you move up. Each league's teams are generated at that league's expected player level, so they are stronger than the league below.
- **[Locked]** Within a league, the 8 teams are ordered weakest to strongest, and the schedule puts harder opponents later in the season. The championship opponent is the toughest team in the league.
- **[Locked]** Rosters are fixed. The same team always has the same players. CPU stats do not track or react to your stats.
- **[Locked]** CPU teams are generated at the player's expected level for that league (the cap minus the typical shortfall), not at the raw league cap. Generating at the cap would leave the CPU 9 to 11 points above the player from College up, which contradicts "difficulty comes from behavior, not bigger stats". (This replaces the old "CPU stats stay close to yours and rise gently game to game" line, which could not be true at the same time as fixed rosters.)
- **[Locked]** Nothing should force replays by math alone.
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
- **[Open]** Full name list (40 teams).

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
- **[Locked]**

```
When unlocked	Pitch
Little League	Fastball, Changeup
High School	Curveball
College	Slider
Minor League	Knuckleball
Major League	Screwball
First World Series Champ	Eephus
World Series Champ x2	Cutter
```

### How they move
- **[Locked]** Curve and slider break away from the pitcher's throwing arm. Screwball breaks the other way. You control how much and when, never which way.
- **[Tested]** Fastball: straight, fastest.
- **[Tested]** Changeup: straight, much slower. Its job is to wreck the batter's timing.
- **[Tested]** Curveball: slow, big smooth one-way bend that can start right after release. Steered by the player (see Controls).
- **[Tested]** Slider: faster, smaller bend that only starts about halfway to the plate.
- **[Tested]** Knuckleball: very slow, wobbles on its own. Not steerable.
- **[Open]** Screwball, Eephus, and Cutter movement and speed.

### Speed readout
- **[Locked]** Pitch type and speed are hidden until the ball crosses the plate. This applies when you bat and when you pitch.
- **[Locked]** The mph shown depends on the league. It is display only; how fast the ball actually travels is a separate tuned value.
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

### Batting
- **[Tested]** Left pad: drag to move the bat's sweet spot left or right.
- **[Tested]** Swing button: tap to swing instantly. Or press and hold before the pitch arrives to charge, then release to swing.
- **[Tested]** Charged swing: more power and more fly balls, but a smaller timing window.
- **[Tested]** Early contact pulls the ball. Late contact goes the opposite way.
- **[Tested]** Centered on the sweet spot: line drive or fly ball. Off-center: grounder toward the bat's end, pop-up toward the handle.
- **[Tested]** Just outside the timing window = foul. Well outside = miss.
- **[Tested]** Timing feedback pops above the plate right after contact: "Early", "Late", or "Perfect".
- **[Open]** Final popup wording. Current: Early / Late / Perfect. Alternative: Fast! / Slow!

### Pitching
- **[Tested]** Pick a pitch from the pitch buttons.
- **[Tested]** Left pad: drag to aim.
- **[Draft]** Throw button:
  - **Tap:** normal pitch. Lands close to your aim, not exact.
  - **Hold and release in the Nice zone:** power pitch. Faster, more bend, lands exactly on your aim. "Nice" confirms it.
  - **Hold too long:** the pitch hangs. Slower, less bend, drifts toward the middle of the plate.
- **[Draft]** The meter is a ring around the Throw button. It fills clockwise starting at the lower right (under the thumb) and the Nice zone sits near the top where it stays visible. Nice zone edges have white marks, not just color. Where you stopped stays visible for about 1 second.
- **[Locked]** The throw meter is not a bar above the plate (tried and rejected).
- **[Tested]** Curve and slider are steered after release: drag the left pad toward the break side. More drag = more bend. Dragging earlier = more bend. Dragging the wrong way does nothing. (Mario-style steering chosen over automatic break.)

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
fastballMs	1500	Fastball travel time
betweenMs	3000	Pause between pitches
windupMs	1400	CPU pitcher windup
resultMs	1800	How long a hit result shows
timingWindow	100	Good-contact timing window
foulMult	1.7	Foul margin (x timing window)
swingDelay	60	Swing start delay
inputOffset	0	Input lag offset
sweetSpot	0.28	Sweet spot size
batReach	0.8	Bat reach
chargeTime	300	Hold needed to charge a swing
chargeWindowMult	0.6	Charged swing timing window (x)
chargePower	1.22	Charged swing power (x)
meterTime	1100	Pitch meter fill time
niceWidth	0.12	Nice zone width
niceBoost	1.06	Nice pitch speed (x)
niceBreak	1.3	Nice pitch bend (x)
aimScatter	0.12	Normal pitch miss from aim
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
10. What happens after a World Series win (next season flow).
11. Park features for version 1 vs. later.
12. Full list of 40 team names.
13. Schedule shape (12 games over 8 opponents) and standings tie-breakers.
14. Closed: no sound in version 1.
15. Closed: team and park names are proper nouns and are not translated.
