# Pool — measurements off Matt's reference screenshots

Taken 2026-08-10, from four screenshots Matt sent of a friendly mobile 8-ball game, while they were
on screen. Matt: *"These colors are so dark and are not friendly or welcoming at all... See how
much friendlier the attached photos are?? Copy this style. Make ours a clone."*

**The images themselves are not in this folder yet** — they arrived as chat attachments, which a
session receives as content, not as files on disk. Drop the PNGs in beside this file and the next
session gets both (`reference/README.md`). Until then this file is the best that exists, and it is
strictly worse than the picture.

Screenshots were 919x1919. **Everything below is a fraction of the screen or of the table**, never
a pixel — the game runs at 393x852 and anywhere else.

## The one thing that makes it feel friendly

**Nothing on screen is near-black.** Our build painted a `#12100d` page, a `#3a2418` almost-black
rail and a `#0b3d2e` bottle-green cloth, all of it under a black surround — a dark room. The
reference is a bright toy: a saturated pastel BACKGROUND behind the table, warm mid-brown wood, a
vivid green cloth, and only four ball colours. If you change one thing, change the value (lightness)
of every surface, not the hue.

## The background colour is the turn indicator

The whole area around the table is a flat, saturated pastel, and **it changes colour with whose
turn it is**:

| Background | Meaning | Sampled |
|---|---|---|
| Warm salmon / peach | your shot | `#F2A183` |
| Sky blue | their shot | `#6BA9CE` |

Those are the same two hues as the players themselves (you coral, them cyan). It is a whole-screen,
wordless "it is you now" that cannot be missed, and it is the single strongest idea in these
screenshots. It also transitions, not cuts — it eases over roughly a third of a second.

## The table

Drawn as a stack of four rounded rectangles, each inset inside the last:

| Layer | Size | Colour |
|---|---|---|
| Black outline | corner radius ~0.045 x table width | `#0B0B0B`, ~10px at 919 wide = **0.011 x table width** |
| Wood frame | inset **0.06 x table width** | `#8C5A3F` (mid brown; the outer edge is a shade darker, `#7A4E36`) |
| Cushion band | a further **0.033 x table width** | `#3FBE63`, bevel highlight `#4ACB6E` along its inner edge |
| Cloth | the rest | `#0F8A3C` |

- The table **bleeds to both side edges of the screen** — the wood runs off the left and right, and
  the background only shows above and below it. That is a big part of why it reads as a real object
  rather than a widget.
- The cushion band is **mitred at every pocket**: it does not run straight into the pocket circle,
  it chamfers away from it at 45 degrees, so each pocket sits in a little notch.
- The cloth carries no texture and no vignette. Flat colour.

## Pockets

- **Pure black circles**, no gradient, no grey rim. Ours draws a three-stop radial gradient; the
  reference does not.
- Radius **0.06 x table width** — noticeably bigger than ours (we use `R * 1.9`, about 0.042).
  Larger pockets are most of why the reference looks generous rather than fiddly.
- Corner pockets are centred on the corner of the CLOTH, so they overlap the wood.

## Balls

**There are no numbers and no stripes.** The entire rack is four colours:

| Ball | Colour | Highlight |
|---|---|---|
| One group | coral `#F2604C` | `#FFB0A0` |
| The other group | cyan `#33C6F4` | `#B0EBFF` |
| The 8 | `#101010`, with a small white 8 | — |
| Cue | cream `#F7EFCB` | — |

- Diameter **0.048 x table width** (radius ~22px of 919).
- Each ball has a thin dark outline and ONE small highlight: a soft blob at about 30%/28% from the
  top-left, roughly 0.3 x the ball's diameter. Not a full radial gradient sweep.
- **Coral vs cyan is a colourblind-safe pair** (this repo's rule exists because Matt is red/green
  colourblind; red against cyan is exactly the axis that survives). Coral-vs-green would not be.

## Wordless feedback the reference uses (worth stealing)

- **A soft green halo around the cue ball** when it is yours to shoot — `#7DC242` at ~45%, radius
  about 2.2 x the ball's radius. Friendly, and it says "this one" without a caption.
- **A ring bursting out of the pocket** a ball just dropped into, in the colour of the group that
  scored, growing and fading over roughly half a second.

## Chrome (and the part we deliberately do NOT clone)

The reference puts a dark rounded pill across the top — `YOU 0 / VS / BOT 4`, with a small tab above
it reading `MEDIUM` — flanked by two large circular translucent-white buttons, a `<` at top-left and
a `↺` at top-right, each about 0.09 x screen width. It also prints `Bot thinking` and a big outlined
`Foul!` over the table.

**Its shapes we copy; its words we do not.** One message before these screenshots Matt said:
*"No word instructions during the game. It must be self explanatory with symbols."* Both
instructions stand together, so: the dark rounded pill, the corner discs and the sizes are cloned,
and what sits inside the pill is our two faces and their group discs rather than `YOU 0 VS BOT 4`.
`Bot thinking` is the bot's face bobbing; `Foul!` is the warning disc. See
`pool/CLAUDE.md`, "NO WORDS DURING PLAY".

## What is NOT verified

Four screenshots, all mid-game on the play screen, plus one of OUR build for contrast. The
reference's mode/setup screen, its win overlay, its aim/power controls and its ball-in-hand state
have never been seen. **Anything this repo does on those screens is our own invention, not a
clone** — do not describe them as matching the reference.
