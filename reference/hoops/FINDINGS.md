# Connect 4 Hoops — is the machine playable? (measured 2026-09-21)

Design sketch: `skeeball/mockup-hoops-four.html`. Nothing is built; no folder, no engine, no
`BOARDS` entry. This is the feasibility measurement that should decide whether it gets built.

## The question

Every existing machine asks the player to pick at most **3** lateral targets (HOT SHOT's three
columns). Connect 4 Hoops asks for **7**. If a swipe cannot separate seven, the game is
frustrating no matter how good everything else is.

## How it was measured

`sweep-hoops-columns.mjs` builds a candidate cabinet and throws at it through **HOT SHOT's real
engine** — `simulateThrow(board, {power, aim})` takes the board as an argument, so a candidate
never has to be registered in `BOARDS`. 21 powers x 41 aims = 861 throws per run.
`analyze-hoops-columns.mjs` prints the grid (one row per power, digit = column it went in) and
the statistic that matters: **the mean aim per column must increase left to right**, or aim is
not choosing anything.

```
node sweep-hoops-columns.mjs --aim=0.45 --rowv=5.3 --mins=4.70 --maxs=5.60 --wallrest=0.03 --out=g.json
node analyze-hoops-columns.mjs g.json
```

## The cabinet has to be 28% wider, and that is arithmetic

`MACHINE-SPEC.md`'s `holes.spacing` wants 1.30X between hole centres:

```
6 gaps x 1.30X + holeR 0.5X margin each side  =  8.800X minimum
THE CLASSIC / HOT SHOT / BRICK CITY boardW     =  6.875X
```

Forced into 6.875X the pitch falls to 0.979X and a standard 1.0X rim **overlaps its neighbour by
0.021X**. Not a tight fit — impossible. The alternative to widening is shrinking the rims, and a
basket's width is never a session's to change (this folder's hard rule), so the cabinet moved.

## Three tuning deltas from HOT SHOT, each measured

| | HOT SHOT | here | why |
|---|---|---|---|
| `boardW` | 6.875X | **8.800X** | above |
| hoop row | 3 rows of 3 | **one row of 7** at v 5.3X | it is a Connect 4 board, not a staircase of baskets |
| `minSpeed`/`maxSpeed` | 2.60 / 6.60 | **4.70 / 5.60** | see below |
| `wallRest` | 0.15 | **0.03** | see below |
| `aimMax` | 0.45 | 0.45, unchanged | already enough to reach both outer columns |

**The speed range.** With the hoops on the TOP tread and HOT SHOT's 2.60–6.60, nothing scored
below power 0.65 — two thirds of the dial dead, which is a spec failure on its own. Dropping the
row to the middle tread and narrowing the dial onto the band that actually works took it from
**9 of 21 powers dead to 0 of 21**.

**The side walls.** At 0.15 the outer columns were catch-alls: hoops 1 and 7 took 91 and 95 hits
against 26–42 for the middle, because an over-aimed ball banked off the rail and fell into the end
column. Ordering also rotted as power rose (0.69–0.76 at the top of the dial). Deadening the rail
makes over-aim an honest miss — which costs the player a shot, not their turn — and took the
powers where aim cleanly picks a column from **5 of 21 to 8 of 21**.

## The result

```
21 of 21 powers score          (no dead dial)
7 of 7 columns reachable
mean aim per column:  -0.42  -0.34  -0.20  -0.02  +0.18  +0.34  +0.42
spread:               ±0.16  ±0.20  ±0.22  ±0.22  ±0.22  ±0.19  ±0.16
```

**Monotonic. Aim selects the column.** A sample row, power 0.45, reading left to right across the
aim dial:

```
.......11111111222344.5...77777777.......
```

## Two honest caveats

**The outer columns are easier than the middle** (112 and 113 hits against 26–43). Everything
past the aim needed to reach column 1 still lands in column 1, which is geometrically
unavoidable. It is arguably the right way round — Connect 4's centre columns carry the most
winning lines, so the valuable shot is the hard one — but it is a real asymmetry, not a
neutral one, and a first playtest should confirm it feels like skill rather than like the ends
being a dumping ground.

**Spread is comparable to the gap between columns** (±0.16–0.22 against gaps of 0.08–0.20). That
makes it a genuine skill shot rather than a gimme, and it is also why the miss rule matters: a
turn must not end on a miss, or a match dies of dead air.

## What was NOT measured

- Whether a human swipe has this precision. The sweep drives `aim` directly; `js/swipe.js` maps a
  real gesture onto it through `aimCurve` (unset = 2, the square), and that mapping is untested
  here. **This is the next measurement**, and it could still sink the design.
- Anything about the async multiplayer half.
- Anything in a browser. This is all headless.
