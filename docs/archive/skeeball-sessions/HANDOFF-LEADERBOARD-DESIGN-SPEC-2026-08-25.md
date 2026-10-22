# Leaderboard and stats screens: what they are and what has to be on them

Content spec for a designer. It says what each screen is for, what information exists, and what
technically cannot bend. It carries no visual direction and no description of the current design;
assume nothing about how any of this looks today. Where it names an existing asset or convention,
that is offered as available material, not as a requirement to reuse it.

---

## The app

A small, ad free, installable PWA that hosts 22 self contained games (Connect Four, Chinchón,
Escoba, Yahtzee, Battleship, Skeeball, Pinball, Snake, Uno, and so on). One family uses it: about
six real people, on phones, mostly through the installed app. Everything is a static file, no
backend beyond a shared database that mirrors each device's stats so a person's phone and laptop
count as one person.

Two overlays cover all of this. Both open full screen over the game launcher.

- **Leaderboard**: everybody's records. Public within the family.
- **My Stats**: the viewer's own records, in more detail.

---

## Screen map

```
LEADERBOARD  ──┬─ 1. By Player          all people, ranked across every game
               │        └─────────────► 4. One player
               └─ 2. By Game            all games, each with its current leader
                        └─────────────► 3. One game's board   all people, ranked at that game
                                              └───────────────► 4. One player
                                                                     └──► 5. One player, one game

MY STATS ──────── 6. My games            every game I have played
                        └───────────────────────────────────────────► 5. (same screen, my data)
```

Screen 5 is one component used in two places: a player's record at one game, whether that player is
you (from My Stats) or somebody else (from the Leaderboard). It has to work in both.

A back control returns along the path taken. Screen 4 can be reached from two directions and the
back label reflects which.

---

## 1. By Player

**The question it answers:** who is doing well across the whole hub.

**One entry per person**, not per device. Two devices belonging to the same person are merged before
anything is drawn.

Available per person:

| | |
|---|---|
| rank | 1..N |
| name | free text, 1 to ~20 chars, can be odd: `*TP*`, `HDJ, Inc.`, `MattyIce` |
| avatar | an emoji the player picked, or their first initial if they have none |
| wins | total wins across competitive games (solo games deliberately excluded) |
| plays | total games played, competitive plus solo runs |
| wins per difficulty tier | four tiers, see "Difficulty tiers" below |
| is this me | the viewer has to be able to find themselves at a glance |

**Needs a way to** re-sort by name, games played or wins, and to filter to a single difficulty tier.

**Scale:** 6 people today. Never more than about 12.

**States:** a player with plays but zero wins is normal and common. A brand new player with one play
must still appear.

---

## 2. By Game

**The question it answers:** which games are being played, and who currently owns each one.

**One entry per game**, all 22, in fixed alphabetical order by title (a game must not move
position between visits). Available per game:

| | |
|---|---|
| game title | translated; longest current title ~14 chars |
| game art | each game has its own inline SVG artwork, roughly 3:2, already drawn and available if useful |
| leader | that game's current top player: name + emoji avatar |
| leader's number | the metric that game ranks on, plus its unit word ("wins", "points", "meters", "obstacles", "longest", "solved") |

**States:** a game nobody has played yet shows no leader. Some games are hidden from most players
(admin only), so the list length varies by viewer.

---

## 3. One game's board

**The question it answers:** who is best at this one game, and by how much.

**One entry per person with at least one play of this game.** Available per person:

| | |
|---|---|
| rank, name, avatar, is-this-me | as screen 1 |
| the game's metric | wins for competitive games; a best score for solo games (see archetypes) |
| plays | how many times they have played this game |
| per tier breakdown | that metric at each difficulty tier the field has played |
| multiplayer wins | only for games with online multiplayer, and only when somebody has played it online |

**Needs a way to** re-sort by name, plays or the game's own metric, and to filter by difficulty
tier for the games that have tiers (several do not, and offering the filter there is wrong).

**Also on this screen, that game's standing records.** One to five of them, each a value, a label
and the person who holds it. They are lifetime figures, unaffected by any filter. Examples:

- Connect Four: wins going first, wins going second
- Chinchón: chinchóns, closes, minus tens
- Boggle: best score, words found, longest word (shown as the word itself, not its length)
- Skeeball: best game, best throw, 100 cups hit, points all time, all four colours
- Hill Climb: furthest drive, coins, flips

**Two games have two headline numbers rather than one, and both have to appear:** Tic Tac Toe
(Ultimate wins and Classic wins) and Snake (best with walls on and best with walls off). They are
separate achievements and combining them would be false.

**Scale:** 1 to 8 people.

---

## 4. One player

**The question it answers:** who is this person and what do they play.

**About the person:**

| | |
|---|---|
| avatar + name | |
| total plays, total wins | across everything |
| wins per difficulty tier | |
| their message | free text the player wrote about themselves on their profile, 0 to ~120 chars. Often empty. Shown only on their own detail screen |

**What they play: one entry per game they have played.** Games with zero plays are left out
entirely, never padded with zeroes. Per game: its art, its title, one headline number with its unit.
Each one opens screen 5.

**Scale:** 1 to 22 games. A real player today has between 1 and 12.

---

## 5. One player, one game

**The question it answers:** everything recorded about this person at this game.

This screen is different for every game, because every game stores different things. There are
three archetypes.

### Archetype A: played against the computer (most games)

Won, lost, tied, win rate, plus a table of the same broken down by difficulty, plus that game's own
extras. Full field lists:

| Game | Its own numbers on top of won/lost/tied/rate |
|---|---|
| Connect Four | wins and losses split by who moved first, per difficulty |
| Chinchón | games played, games finished, victories, draws, defeats, closes, minus tens, chinchóns |
| Escoba | escobas |
| Dots and Boxes | boxes claimed, longest chain |
| Boggle | best score, words found, longest word |
| Yahtzee | yahtzees rolled, best score |
| Dominoes | rounds, best round, points |
| Battleship | shots fired, hit rate, ships sunk, fewest shots to win (blank until their first win) |
| Uno, Filler, Mancala, Pool, Monopoly Deal, Parchís | won / lost / played / rate only |

### Archetype B: solo, score attack (no opponent, no losses)

There is no win rate. The honest numbers are a best and a volume.

| Game | Numbers |
|---|---|
| Ball Run | best obstacles, runs, per difficulty bests, plus an archived legacy metric in old units |
| Snake | longest snake, runs, bests split by walls-on and walls-off |
| Nuts & Bolts | levels solved, best level, moves, average moves |
| Hill Climb | furthest drive, runs, coins, flips, furthest per stage (4 stages) |
| Pinball | best score, best ball, games, average, missions, multiballs, jackpots, ramps, plays per table (3 tables) |
| Skeeball | see below, it is the most detailed |

### Archetype C: the machine dimension (Skeeball only, for now)

Skeeball adds a level the others do not have: **five different physical machines**, and every number
exists both lifetime and per machine.

---

## Skeeball in full

A solo arcade cabinet. You throw a rack of nine balls at a machine and get a score. No opponent, no
wins, no losses. Five machines, unlocked in a chain by completing objectives.

### Lifetime, all machines combined

| Field | Meaning | Real value today |
|---|---|---|
| best game | best single rack ever | 700 |
| best throw | best single ball ever | 100 |
| played | racks thrown | 502 |
| balls | balls thrown | 4788 |
| points | lifetime points | 112730 |
| 100 cups | 100 point balls landed | 276 |
| 50s | 50 point balls landed | 156 |
| 10s / 20s / 30s / 40s | the same per value | recorded, not currently surfaced |
| colour sweeps | racks that hit all four colours (one machine's objective) | 1 |

### Per machine, for each machine the player has touched

| Field | Meaning |
|---|---|
| best | best rack on this machine |
| plays | racks on this machine |
| points | lifetime points on this machine |
| best throw | best single ball on this machine |
| daily | **a map of date to best score that day, kept forever.** A real per machine time series going back to the player's first day |
| baskets hit | which of the nine baskets they have ever landed, as a set |
| clean racks | racks that scored without hitting a penalty basket |
| unlocked | whether they have earned this machine |

### Objectives, per machine

Three per machine, each `{ label, current, target, met }`, recomputed on demand. Completing all
three opens the next machine in the chain. Examples:

- THE CLASSIC: five 100s ever / 360 in one rack / 10,000 points on the machine
- HOT SHOT: a ball in all nine baskets / 700 in one rack / 30,000 points on the machine
- BRICK CITY: all nine baskets / one clean rack / 1,500 net points

### Practice racks

Racks thrown while a machine was in testing. They are kept and must stay visible, and they count
towards nothing: no total, no best, no unlock, no ranking. They must never read as part of the
record.

### The five machines

Names are proper nouns and are never translated. The chain runs top to bottom. Three of the five are
admin only right now, so most players see only the first two.

| Name | Tagline | Cabinet | Face | Marquee | Bulb / glow | Ring |
|---|---|---|---|---|---|---|
| THE CLASSIC | The boardwalk original. Nine balls, the cup ladder, two corner 100s. | `#54301a` wood `#a86f38` | `#c96f2e` | `#28150b` | `#ffd977` / `#ff9d3d` | `#f6f5f2` |
| HOT SHOT | Nine orange hoops on three rows. The 100 hangs top center. | `#f2c526` metal `#5b5b66` | `#2560bd` | `#436496` | `#ffd23f` / `#ff3b1f` | `#e8541f` |
| HOT SHOT: BRICK CITY | Two 100s up top, tight as the ball. The bottom row takes points back. | `#f2c526` metal `#5b5b66` | `#1e63b8` | `#a33427` | `#ffc53d` / `#ff6b2c` | `#e8541f` |
| POPONGO | Nine color cups on bare wood. The black cups take back your last ball. | `#8a6a42` wood `#c9a36a` | `#d9b87f` | `#123a5e` | `#ffd977` / `#ffb02e` | `#f6f5f2` |
| HOT SHOT: RUNAWAY | One 100 up top, and it will not hold still. Throw where it is going. | `#f2c526` metal `#5b5b66` | `#2560bd` | `#241a4d` | `#39e0d0` / `#39e0d0` | `#e8541f` |

Those are the real colours each cabinet is drawn with inside the game itself. They are offered as
material in case machine identity is worth carrying onto these screens; nothing requires using them.

---

## Shared vocabulary

**Difficulty tiers.** Games that have difficulty use one shared four step scale: Easy, Medium, Hard,
Expert. The four have to be told apart without colour (see constraint 3); an existing shape
vocabulary exists in the app if it is useful, but nothing requires reusing it. Some games have no
tiers at all: Skeeball's axis is machines, Hill Climb's is stages, Pinball's is tables, and
multiplayer results sit outside the scale entirely.

**Competitive versus solo.** A solo run is not a win. Cross-game wins count competitive games only;
cross-game plays count everything. The two numbers are deliberately not consistent with each other.

**A player is a person, not a device.** Records from a person's phone and laptop are merged before
anything is drawn, so any "devices" concept is invisible on these screens except one line in My
Stats saying how many were combined.

**Value ranges to design for:** 0 to 112,730. Six digit numbers are real and will collide with tight
layouts. Percentages 0 to 100. Names 1 to 20 characters. Taglines and messages up to ~120.

---

## The box it has to fit in

These are technical and product limits, not art direction. Inside them the look is entirely open.

1. **Phone first.** Design at 393 x 852, survive 360 wide and 667 tall. Full screen overlay,
   scrolls vertically, content column centred at max 620px. Nothing may scroll sideways: wide
   content scrolls inside its own container.
2. **Light and dark, both.** Dark mode is a class on the root element, not a `prefers-color-scheme`
   query, because the player's explicit choice has to win. A new palette for these screens is fine;
   it just needs a value for every colour in both themes. The app's existing tokens, if you want to
   sit inside them: `--hub-bg` #f4f6fb / #0e1420, `--hub-surface` #ffffff / #1b2333,
   `--hub-surface-2` #eef2f8 / #2b3547, `--hub-ink` #16243a / #e9eef6, `--hub-muted` #5b6b82 /
   #9db0c9, `--hub-accent` #1769d4 in both.
3. **Colourblind safe.** Matt is red/green colourblind. Anywhere colour carries meaning it must be
   paired with a shape, icon, label or border. Never hue alone. This covers ranks, finding yourself,
   difficulty tiers, machines, and anything reading as good or bad.
4. **One existing app convention, flagged so it is a decision rather than an accident:** `#ffce3a`
   is used across the rest of the hub to mark the currently selected or active thing. Departing from
   it on these screens is allowed; departing from it without noticing is not.
5. **No em dashes** in any user facing string. Commas, colons or parentheses.
6. **Text no smaller than 11px. Tap targets at least 44px.** Enforced by a test that fails the build.
7. **English and Spanish.** Spanish runs 20 to 30% longer. Every label slot has to survive that.
   Machine names and player names never translate.
8. **Every stored number has to stay reachable on some screen.** The repo's first rule, written after
   a migration made a player's history invisible: a number no screen shows reads to its owner as
   deleted. Regroup and re-rank anything above freely, but do not drop a field. Equally, never show
   a number that is not actually stored: no averages, rates or per machine figures that would have
   to be invented, and a missing value shows a dash rather than a zero.
9. **Offline first PWA.** No web fonts, no CDN, no external images, no icon library. System font
   stack only. Artwork must be inline SVG or CSS. Every file is precached, so a new asset is real
   weight on every device.
10. **Vanilla CSS, no framework, no build step.** The stylesheet ships as a string inside a JS module.
    Flat, prefixed selectors.
11. **Screen 5 is currently one shared piece of markup for all 22 games.** Giving one game its own
    look is fine and is a porting problem, not a design one, but it needs to be an explicit choice:
    say whether a design is meant for every game or for that game alone.
12. **Respect `prefers-reduced-motion`**, with a still fallback that loses no information.

---

## What comes back here

Whatever form the output takes, these are what make it portable into the app, at 393px wide, in
light and dark, with real content rather than placeholders:

- **Screen 3** with these six real players, ranked on best Skeeball score:
  700 with 502 plays, 450 with 61, 370 with 26, 290 with 5, 290 with 6, 270 with 6. Note that two
  players tie on score and the leader has practised eight times harder than anyone else.
- **Screen 5** for Skeeball: one player with the lifetime numbers in the table above and two
  machines played (THE CLASSIC and HOT SHOT).
- **A thin state:** a player with five racks on one machine and nothing else.
- Every colour defined for both themes, so it can be wired to the theme class on the way in.

It gets ported by hand into `js/leaderboard-ui.js` (screens 1 to 4) and `js/game-stats-ui.js`
(screens 5 and 6), so exact markup is not the point; the layout, the type, the colour and the
hierarchy are.
