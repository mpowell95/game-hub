# Design brief: Skeeball's two leaderboard screens

For a designer (Claude Design or a person) picking up the look of these screens. Written
2026-08-25, after Matt: *"The skeeball leaderboard per player looks terrible. And the by game
leaderboard is also terrible."*

Everything below is fact checked against the shipped code. Where a number is an example it says so.

---

## 1. What you are designing

Two screens inside the Game Hub's **Leaderboard** overlay. The hub is a small, ad free, installable
PWA that hosts ~22 self contained games. About six real people use it: one family, on phones,
mostly the installed app rather than a browser tab.

Skeeball is one of those games: a **solo arcade cabinet**. No opponent, no wins, no losses. You
throw a rack of nine balls at a machine and get a score. There are five machines, unlocked in a
chain.

| Screen | Where it is | Who sees it |
|---|---|---|
| **A. The Skeeball board** | Leaderboard → *By Game* → Skeeball | everyone, it is the public ranking |
| **B. A player's Skeeball screen** | Leaderboard → tap any player → Skeeball, **and** the hub's own *My Stats* → Skeeball | everyone (it is the same code for both) |

Screen B is the one Matt called terrible first. Screen A he called terrible second.

---

## 2. What was already fixed, so you do not re design a bug

A data pass landed on 2026-08-25 (branch `claude/skeeball-leaderboard-ui-9y2b8r`). It corrected
what the screens *said*; it deliberately did not touch what they *look* like, which is why Matt's
reply was "these look identical to before". The corrections, so nothing here is re litigated:

- Screen B used to lead with **Wins / Losses / Tied / Win rate**, all four reading `0`. Skeeball has
  had no opponent since 2026-08-11, so those counters are frozen at whatever they were. They are now
  shown only on a device that actually has a non zero one, labelled as the earlier vs computer era.
- Machines rendered as raw translation keys: `gs_sk_board_basketball`, `gs_sk_board_popongo`. Fixed.
- The per machine table was five columns wide and did not fit a phone, so the **whole overlay
  scrolled sideways**. It is a card list now.
- A "Record by difficulty" table listed the *machines* as difficulties, each at a meaningless 100%.
  Removed.
- Screen A was ranking a high score game by **how many racks each person had thrown**, so #1 had 502
  plays and the scores ran down the list in no order (700, 450, 370, 290, 270, 290). It ranks on the
  best score now.

So: the content is right, the layout is a generic grid of gray tiles and near identical cards. That
is the job.

---

## 3. Screen A: the Skeeball board (the ranking)

Today it is a vertical list of near identical rounded cards, one per player: rank number, emoji
avatar, name, one big number on the right with its unit stacked underneath, a chevron, and a small
muted second number on a second row. Below the list sits a "WHO LEADS WHAT" grid of tinted chips.

- **Realistic size: 6 rows.** It has never been more than 8 and will not exceed ~12.
- Every row is a **button** (tap opens that player's screen B). Keep a tap target of at least 44px.
- The viewer's own row carries a highlight. Today that is a colored border. It must not be colour
  alone (see constraints).
- Rows are ranked 1..N. Today ranks 1/2/3 get gold/silver/bronze medal discs.
- There is a **Sort by** control above the list (Alphabetical / Games Played / Points). It defaults
  to Points on this board. There is deliberately **no difficulty filter** on Skeeball: its buckets
  are machines, not difficulties.

**Real data from the live board** (Matt's screenshots, 2026-08-25):

| Rank | Player | Best game | Racks played |
|---|---|---|---|
| 1 | 🤠 King of Games | 700 | 502 |
| 2 | 🦖 MattyIce | 450 | 61 |
| 3 | 🧐 \*TP\* | 370 | 26 |
| 4 | 🙂 HDJ, Inc. | 290 | 5 |
| 5 | 🦁 Anita Bonita | 290 | 6 |
| 6 | 🙂 Unai | 270 | 6 |

Note the shape of that data: **one player has 8x everyone else's plays**, several players tie on
score, and the interesting story (who is actually good, who has barely played) is invisible in a
list of identical cards. Names are short but can be odd (`*TP*`, `HDJ, Inc.`) and always carry an
emoji avatar. Numbers here are 3 digits; lifetime numbers elsewhere reach 6.

**"Who leads what" chips** below the list, one per record, each naming the holder: best game (700),
best throw (100), 100 cups hit (276), points all time (112730), all 4 colours (1). Today they are
five pastel tinted rounded rectangles in a 2 column grid, and in dark mode they stay pastel, which
is the loudest thing on the screen.

---

## 4. Screen B: one player's Skeeball screen

The full inventory of what is available. **Everything currently shown must stay visible somewhere**
(see THE LAW, constraint 8) but you may re rank, re group and re weight it freely.

### Lifetime numbers (per player, all machines combined)

| Field | Meaning | Example (real) |
|---|---|---|
| `bestGame` | best single rack ever | 700 |
| `bestThrow` | best single ball ever | 100 |
| `played` | racks thrown | 502 |
| `balls` | balls thrown | 4788 |
| `points` | lifetime points | 112730 |
| `hundreds` | 100 cups hit | 276 |
| `fifties` | 50s hit | 156 |
| `tens`,`twenties`,`thirties`,`forties` | same per value | stored, **currently shown nowhere** |
| `colorSweeps` | racks that hit all four colours (POPONGO) | 1 |

### Per machine (this is the richest, least used data)

For each machine a player has touched:

| Field | Meaning | Shown today? |
|---|---|---|
| `best` | best rack on this machine | yes |
| `plays` | racks on this machine | yes |
| `points` | lifetime points on this machine | **no** |
| `bestThrow` | best single ball on this machine | **no** |
| `daily` | a **map of date → best score that day**, kept forever | only as "best today" + a day count |
| `slots` | which of the nine baskets this player has ever landed | **no** |
| `cleanRacks` | racks that scored without hitting a penalty basket | **no** |

`daily` is a genuine time series per machine per player. Nothing in the app draws it. A sparkline,
a "your last 14 days" strip, or a personal best trend line is all available with no new storage.

### Goal progress (per machine, three objectives each)

Derived, never stored: `readGoals(machineId, store)` returns three objects of
`{ id, label, now, target, met }`. Examples: THE CLASSIC = five 100s ever / 360 in one rack /
10,000 points on the machine. HOT SHOT = land in all nine baskets / 700 in one rack / 30,000 points.
Completing a machine's three is what unlocks the next machine. The admin page renders these; the
player's own stats screen does not.

### Practice racks

Racks thrown while a machine was in testing. Kept, shown on their own quieter row, counted by
nothing. They must remain visible and must never look like part of the record.

---

## 5. The five machines (your best creative material)

They are physical arcade cabinets with their own paint. **The names are proper nouns and are never
translated.** Ids are frozen forever.

| id | Name | Tagline | Unlocked by |
|---|---|---|---|
| `classic` | THE CLASSIC | The boardwalk original. Nine balls, the cup ladder, two corner 100s. | always open |
| `basketball` | HOT SHOT | Nine orange hoops on three rows. The 100 hangs top center. | THE CLASSIC's 3 goals |
| `brickcity` | HOT SHOT: BRICK CITY | Two 100s up top, tight as the ball. The bottom row takes points back. | HOT SHOT's 3 goals |
| `popongo` | POPONGO | Nine color cups on bare wood. The black cups take back your last ball. | BRICK CITY's 3 goals |
| `runaway` | HOT SHOT: RUNAWAY | One 100 up top, and it will not hold still. Throw where it is going. | POPONGO's 3 goals |

Each machine already has a full palette in the game engine. These are the real hexes the cabinet is
drawn with, and they are the obvious way to make a machine's row feel like *that machine*:

| id | cabinet | face | marquee | marquee text | glow | ring |
|---|---|---|---|---|---|---|
| `classic` | `#54301a` | `#c96f2e` | `#28150b` | `#ffd977` | `#ff9d3d` | `#f6f5f2` |
| `basketball` | `#f2c526` | `#2560bd` | `#436496` | `#ffd23f` | `#ff3b1f` | `#e8541f` |
| `brickcity` | `#f2c526` | `#1e63b8` | `#a33427` | `#ffc53d` | `#ff6b2c` | `#e8541f` |
| `popongo` | `#8a6a42` | `#d9b87f` | `#123a5e` | `#ffd977` | `#ffb02e` | `#f6f5f2` |
| `runaway` | `#f2c526` | `#2560bd` | `#241a4d` | `#39e0d0` | `#39e0d0` | `#e8541f` |

Wood tones for the two wooden cabinets: `#a86f38` / `#7c4d22` (classic), `#c9a36a` / `#96713f`
(popongo). The three HOT SHOT cabinets share a gray metal body `#5b5b66` / `#191a1e`.

Three of the five are admin only right now, so most players will only ever see THE CLASSIC and
HOT SHOT on their screen. A design that only works with five machines listed is wrong; a design that
only works with one is also wrong.

---

## 6. Hard constraints

These are not preferences. A design that breaks one of them cannot ship.

1. **Phone first, and it must fit.** Design at **393 x 852** (iPhone 14/15). It must also survive
   360 wide and 667 tall. The overlay is full screen, scrolls vertically, and the panel is centred
   with `max-width: 620px` (screen A) / `560px` (screen B). **Nothing may ever scroll sideways** -
   that bug is exactly what shipped, and wide content has to scroll inside its own container.
   A sticky header of ~44px plus the device safe area sits above the content.
2. **Light and dark, both.** Dark mode is a **class on `<html>` (`.gh-dark`)**, never a
   `prefers-color-scheme` media query, because the user's explicit choice has to win. Every colour
   must be defined for both. The tokens:

   | token | light | dark |
   |---|---|---|
   | `--hub-bg` | `#f4f6fb` | `#0e1420` |
   | `--hub-surface` | `#ffffff` | `#1b2333` |
   | `--hub-surface-2` | `#eef2f8` | `#2b3547` |
   | `--hub-ink` | `#16243a` | `#e9eef6` |
   | `--hub-muted` | `#5b6b82` | `#9db0c9` |
   | `--hub-accent` | `#1769d4` | `#1769d4` |

   A machine's own palette (section 5) is a brand colour, not a theme colour: if you use it, make it
   work on both grounds, or tint it.
3. **Colourblind safe. Matt is red/green colourblind.** Wherever colour carries meaning it must be
   paired with a shape, an icon, a label or a border. Never hue alone. This applies to rank medals,
   the viewer's own row, machine identity, and anything that reads as "good/bad".
4. **`#ffce3a` is the standing selection/emphasis accent** app wide, always paired with a non colour
   indicator.
5. **No em dashes in user facing copy.** Commas, colons or parentheses.
6. **Text no smaller than 11px. Tap targets at least 44px.**
7. **English and Spanish.** Spanish strings run 20-30% longer ("Puntos totales", "Mejor lanzamiento",
   "Partidas anteriores (contra la máquina)"). Any label slot must survive that without truncating or
   wrapping into a mess. **Machine names never translate.**
8. **THE LAW: player data is never deleted, never lost, never hidden.** The repo's first rule, set
   after a migration made a player's history invisible. Its working rule 1 is *"stored is not enough;
   data must stay visible"* - a number no screen shows reads to its owner as deleted. Concretely:
   you may re rank and re group every number in section 4, but you may not design a screen that
   drops one. Rule 4 is *"never fabricate"*: no averages, rates or per machine numbers that are not
   actually stored, and a missing value shows a dash rather than a zero.
9. **Offline first PWA.** No web fonts, no CDN, no external images, no icon library. System font
   stack only (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`). Any artwork must be
   inline SVG or CSS. Every file is precached by a service worker, so new assets are real weight.
10. **Vanilla CSS. No framework, no build step, no dependencies.** The stylesheet for these two
    screens ships as a **string inside a JS module** and is injected once. Keep selectors flat and
    prefixed (`lb-` for the leaderboard, `gs-` for the stats screens).
11. **Screen B's markup is shared with every other game.** The same `gs-*` classes render Connect
    Four's, Yahtzee's, Battleship's and every other stats screen. A Skeeball only look must be scoped under its own
    wrapper class, not by editing the shared primitives.
12. **Respect `prefers-reduced-motion`.** Any animation needs a still fallback.

---

## 7. What "good" would look like

Not a spec, just the read on why the current screens feel dead:

- **Everything has the same weight.** Nine rounded gray tiles with a big number and a caption, all
  the same size, all the same colour. Nothing tells you what matters. 700 (a personal record) and
  4788 (balls thrown, which only goes up) are drawn identically.
- **Screen A cannot be scanned.** Six identical cards, one number each. You cannot see that #1 is
  eight times more practised than #2, or that two players are tied, or who is improving.
- **The game has a strong physical identity and none of it is here.** Skeeball is a wooden cabinet
  with a lit marquee and an orange face. The hub's stats chrome is a calm white/blue card grid. The
  interesting design question is how much cabinet to bring in: a marquee style header and per machine
  colour would make these screens unmistakably Skeeball, while the surrounding overlay stays hub.
- **The unused data is where the life is:** per machine daily bests going back weeks, the three
  objectives per machine with progress, which of the nine baskets you have hit, clean racks, points
  per machine. That is a screen with something to say instead of a wall of counters.

---

## 8. What to hand back

Static **HTML + CSS**, one file per screen, self contained, no JS needed for the look. Ideally:

- both screens, at 393px wide, in **light and dark**;
- realistic content: the six players in section 3, the two machines a real player has actually
  played (THE CLASSIC and HOT SHOT), six digit numbers where they occur;
- an empty/thin state: a player with 5 racks on one machine and nothing else;
- use the `--hub-*` tokens above rather than hard coded greys, so it drops straight into the theme.

I will port it into `js/leaderboard-ui.js` (screen A) and `js/game-stats-ui.js` (screen B), keeping
the class prefixes, and check it at 393x852 in both themes with no sideways scroll before it ships.
