# Battle Arena: spec (2026-10-23)

A match-3 monster battle, cloned from the MECHANICS of "Match Monsters" (Plato app) only. All
monsters, names, art and text are our own. Source: three screen recordings Matt uploaded
2026-10-23 (two halves of one match vs bravomike, plus a match vs oksurely09).

Phase 1 (this build): vs computer only, admin-only (`devOnly`). Phase 2 (later): live rooms
(`js/net.js`) AND turn-by-turn challenges, like Darts / Chinchón. Build the engine so a whole
match state is plain JSON and every move is a pure function `(state, move, rng) -> state`,
seeded RNG, so online play can replay it later.

## The match

1. **Draft.** Each side picks 2 different monsters from the roster (locked ones greyed with a
   lock). Tap a monster = its card (art, name, element, energy cost, special, Normal / Evolved
   tabs). Random button. Confirm. The computer drafts after you.
2. **Arena.** One arena for now: **Boiler Room** (bomb tiles, see below).
3. **Board.** 7 columns x 5 rows. Tiles: 5 element gems + Berries + Bombs.
4. **Turns.** 2 moves per turn. A move = swap two ADJACENT tiles (orthogonal) that makes a
   line of 3+. Illegal swap snaps back, costs nothing. Cascades resolve fully. 30 s turn timer
   vs computer is optional (off by default; it exists for online).
5. **Extra move.** A match of 4 or more gives +1 move, **once per turn**.
6. **Charging.** Every gem cleared (matches, cascades, bombs, specials) adds 1 energy to YOUR
   monster of that element (if you have one). Gems of other elements do nothing. Show "+3 [gem]"
   floating over the monster.
7. **Specials fire automatically** the moment a monster's bar is full (after the board settles),
   with a banner (monster + move name). Bar resets to 0. Excess energy is lost.
8. **Team HP.** Every team starts at 80, and heals can never take it above 80 ("MAX HP" flash).
   Monsters have no HP of their own (Matt, 2026-10-24). The HP column below is obsolete.
9. **Berries.** Berries MATCH like gems (3+ in a line, v2 2026-10-24); each berry matched adds 1 to your berry counter (0/4). At 4: your two
   monsters show "Evolve!", you tap one (computer picks the one closer to full), it evolves:
   new form, stronger special, heals 5 (never above 80). Counter
   resets. Each monster evolves once; when both are evolved, berries do nothing.
10. **Win.** Other team's HP hits 0: "Victory" / "<profile name> wins!" card with an X close.

## Boiler Room bombs

- A bomb tile shows a countdown (starts 5-6). It counts down by 1 at the end of EVERY turn.
- A match orthogonally next to a bomb detonates it: clears its whole row and column (those gems
  charge the mover's monsters as normal).
- A bomb reaching 0 explodes on its own: clears its row + column and deals 10 damage to the
  side whose turn just ended (we could not see this in the recordings; this is our rule).
- New tiles falling in: ~10% Berry, ~2.5% Bomb (max 2 bombs on the board), rest gems evenly.

## Elements and gems (colourblind-safe: every gem has its own SHAPE + icon)

| Element | Colour | Gem shape | Icon |
|---|---|---|---|
| Fire | vermilion `#E0532F` | square | flame |
| Water | blue `#1F5FA8` | triangle | drop |
| Spark | yellow `#F2B705` | circle | bolt |
| Leaf | green | diamond | leaf |
| Shadow | purple | hexagon | swirl |
| Berry | dark red | berry cluster | - |
| Bomb | charcoal | round bomb | countdown number |

## Roster

Unlocks are DERIVED from total Battle Arena wins (read from stats, never stored: nothing new to
lose). Starters are open from the first game.

### Starters (open)

| # | Monster -> Evolved | Element | HP | Cost | Special (normal / evolved) |
|---|---|---|---|---|---|
| 1 | **Emberkit** -> **Blazelynx** | Fire | 40 | 7 | Flare Pounce: 10 dmg / Blaze Pounce: 18 dmg |
| 2 | **Sproutle** -> **Mossback** | Leaf | 45 | 6 | Heal Leaf: heal 10 / Bramble Mend: heal 15 + 15 dmg |
| 3 | **Driplet** -> **Tidefang** | Water | 40 | 4 | Splash: 5 dmg / Riptide: 10 dmg |
| 4 | **Zapup** -> **Voltail** | Spark | 35 | 4 | Static Nip: 10 dmg / Electroclaw: 20 dmg |
| 5 | **Gloomite** -> **Dreadmaw** | Shadow | 40 | 6 | Mind Bite: 10 dmg, drain 2 energy from each enemy / Night Maw: 15 dmg, drain 3 |
| 6 | **Pebbleop** -> **Cragoon** | Fire | 50 | 8 | Rock Toss: 10 dmg + 5 shield / Landslide: 15 dmg + 10 shield |

Shield: absorbs the next N damage to your team, then gone (shown as a number on your HP).

### Unlockable (specialised, slightly stronger)

| # | Monster -> Evolved | Element | HP | Cost | Special (normal / evolved) | Unlock |
|---|---|---|---|---|---|---|
| 7 | **Cinderwing** -> **Pyrovern** | Fire | 40 | 8 | Scorch Row: 10 dmg + clears the row with the most Fire gems / clears 2 rows, 15 dmg | 3 wins |
| 8 | **Thornpaw** -> **Briarlord** | Leaf | 45 | 6 | Overgrowth: turns 4 random gems into Leaf, heal 5 / 6 gems, heal 10 | 6 wins |
| 9 | **Frostling** -> **Glacielle** | Water | 40 | 5 | Freeze: 10 dmg, enemy has 1 move next turn / 15 dmg, same | 10 wins |
| 10 | **Stormhorn** -> **Thundrake** | Spark | 35 | 5 | Chain Bolt: 10 dmg + 1 energy to your other monster / 15 dmg + 2 | 15 wins |
| 11 | **Hexowl** -> **Grimhoot** | Shadow | 40 | 5 | Curse: 5 dmg now + 5 at the start of each of their next 2 turns / 10 + 5 x3 | 20 wins |
| 12 | **Prismote** -> **Prismaraja** | ALL | 45 | 12 | Rainbow Beam: 20 dmg (charges 1 per gem of ANY element, half rate: 1 per 2 gems) / 30 dmg | 30 wins |

Balance numbers are a first guess; tune by playing the computer.

## Computer

Easy / Medium / Hard (difficulty markers via `diffShapeSVG()`).
- Easy: random legal move, prefers any match.
- Medium: greedy one move: score = energy to its monsters (weighted by how close each bar is to
  full) + berries + 4-match bonus + bomb denial.
- Hard: Medium plus looks at both moves of its turn and avoids leaving you an easy special;
  drafts from unlocked monsters too.
Its moves animate at a readable pace (~0.7 s per swap).

## Screens (fewest words)

- Home: "Battle Arena" title, difficulty picker, Play, How to play.
- Draft: grid of 12, two slots, Random, Confirm.
- Battle: top bar (each side: berries x/4, HP, profile name / "Computer"), moves pips + turn
  marker, 4 monsters on the arena (like the reference: opponent's two in the LEFT column,
  the player's two in the RIGHT column, facing each other), each with an element-coloured
  energy bar "3/7", then the board.
- Result card with X close.
Only a first-time tip line on the board: "2 moves per turn", "Match 4: extra move" (once each).

## Stats

`recordResult('battlearena', diff, won)` vs the computer. Hub id `battle-arena`, folder
`battle-arena/`, stats id `battlearena`, prefix `.ba-`, settings `gamehub.battlearena.v1`,
save `gamehub.battlearena.save.v1` (resume a match in progress).
