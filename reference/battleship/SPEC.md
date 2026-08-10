# Battleship — measurements off the reference screenshots

Taken on 2026-08-08 from four screenshots Matt sent of the reference mobile Battleship
("Sea Battle" style), while they were on screen. **The images themselves are not in this folder
yet** (they arrived as chat attachments, which a session receives as content, not as files on
disk — see the note at the bottom). This file is what survived the session; drop the PNGs in
beside it and the next session gets both.

Everything below is a **fraction**, never a pixel. The screenshots were 919x1919; the game runs at
393x852 and anywhere else. Ratios port, pixels do not.

## The cannon (the thing four rounds were spent getting wrong)

**Viewing angle: straight down.** This is the single fact three sessions missed, and the reason
"a large black cannon barrel on a dark ring base" was not enough — that sentence describes a
top-down turret and a side-view field gun equally well.

Let `D` = the diameter of the black base circle, `R = D/2`.

| Part | Measurement |
|---|---|
| Base circle `D` | **0.375 x screen width** (345px of 919) |
| Outer black rim | `R` down to `0.85R` |
| Owner-colour band | `0.85R` down to `0.65R` |
| Black hub | `0.65R` inward |
| Barrel width | **0.48 x D** (167px of 345) — just under half the base |
| Barrel length | ~1.67R, and it sits almost entirely INSIDE the base circle |
| Barrel overhang past the rim | ~0.06R. Nearly flush. It is foreshortened because it points away from you |
| Muzzle collar | black, as wide as the barrel's outer edge, at the tip |
| Bore | dark grey ellipse inside the collar, ~0.64 x the collar width |
| Highlight | light grey rounded stripe, ~0.24 x barrel width, offset LEFT of the barrel's centreline |
| Shadow | soft, down and to the right, and it does NOT rotate with the barrel |

Colours sampled: black `#0A0B0D`, barrel grey `#50565C`, bore `#282C31`, highlight `#9EA5AB`,
owner red `#C4463C`, owner cyan `#27ACD8`.

**Ownership and position.** Each side's cannon stands on **its own board** and fires across at the
other one. Yours is red-ringed, on your deck, pointing north. Theirs is cyan-ringed, on their
water, pointing south. Only the side currently shooting has its gun on screen. It sits at roughly
60% down its own board, horizontally centred, and rotates to aim.

## The cannonball

| Part | Measurement |
|---|---|
| Diameter | **0.62 x D** (0.23 x screen width) |
| Black rim | ~0.10 x the ball's diameter |
| Body | dark grey `#3F444A` |
| Highlight | a HARD-EDGED circle, not a soft gradient: ~0.25 x diameter, centred at 33%/30% |

It crosses **both boards**, passing over the fleet strip between them, so it cannot live inside
either board's element.

## Layout

Top to bottom, edge to edge, no page scroll:

| Band | Share of screen height | Notes |
|---|---|---|
| Deck above the enemy board | ~8% | plain salmon, nothing in it |
| Enemy board | ~39% | dark navy cells in a **medium blue** frame `#4A86B8` — the frame is a lighter blue than the cells |
| Fleet strip | ~9% | salmon, both fleets, a white disc at each end |
| Your board | remainder | brown wood cells on the salmon deck |

**The fleet strip.** A white circle at each end, each one clipped by the screen edge. Left holds
the sunk score stacked vertically: their count in cyan, a dark dot, your count in red. Right holds
**EXIT** in dark navy, rotated 90 degrees, reading top to bottom. Between them, two rows of ship
silhouettes: theirs above, yours below.

**Whose half is bright.** The board being SHOT AT is drawn at full colour; the shooter's half is
washed out toward the colour of the water or deck around it, frame included. The roster row for
the fleet under fire is bright and the other is sunk back into the deck. This is not "whose turn
is it" — during your own shot's flight the turn has already passed, and the target board must stay
bright underneath it.

## Markers

- **Miss** — a dark cross scored into the water, ~50% of a cell, plus a brief burst of white
  bubbles as it lands. Not a ring.
- **Aim** — a white crosshair on the target cell: a ring with a full cross straight through it,
  overhanging on all four sides, about 1.5 cells wide.
- **Hit / sunk** — not captured in these four screenshots. Our own treatment (filled marker with a
  burst outline; sunk ship revealed in its owner's colour) is unverified against the reference.

## What is NOT verified

Only four screenshots were supplied, all from the battle screen, all mid-game. The mode screen,
the deploy screen, the win overlay and the hit/sunk markers have never been seen. Anything this
repo does on those screens is our own invention, not a clone. **Do not describe them as matching
the reference.**

## A note for whoever reads this next

Images sent in chat reach a session as content, not as files; a session cannot write the original
bytes to disk. So the loop only closes if the images get committed once, by hand, into this
folder. Matt has approved that (`reference/README.md`). Until they are here, this file is the
best that exists, and it is strictly worse than the picture.
