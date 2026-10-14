# Archery — CLAUDE-HISTORY.md

The full text that `archery/CLAUDE.md` once carried, kept here so the short version can stay short.
Nothing here is a rule that the short file does not also state.

## The look, matched to the recording (2026-10-14)

Three rounds in one day.

1. *"yes fix all"*: a 2D pass. One-shot flight with a camera glide, an SVG bow, a brighter board,
   sky, a curved roof.
2. *"Do the 3d rebuild"*: the bow, hand, sleeve and arrow became lit 3D models (`bow3d.js`), the
   roof a canopy with ribs, sun shadows on the board.
3. *"keep working until you are satisfied"*: everything re-measured on a grid over the
   recording's frames. Three findings changed most of it:
   - **The recording's game area is 1206 x 2154 px of the 1206 x 2622 frame (402 x 718 CSS px),
     not a phone's full screen.** Earlier comparisons at 402 x 874 had squashed it, so sizes and
     positions read wrong. Compare at 402 x 718.
   - **The sight ring was 1.3x too big against the bow.** Everything else had been fitted to it.
     Now the outer ring is a tenth of the width and the bow's layout is measured in ring radii.
   - **Motion, at 30 fps:** the bow comes up in 0.25 s (it was 0.18); the release kick is about
     two frames (0.06 s); in the flight the camera holds for the first ~0.2 while the arrow climbs,
     then glides at a near-steady speed (it was easing out from the start); arrow to target 0.8 s.
     Back on the line the view cuts and the bow slides up into place; at a hit the scored ring
     flashes yellow.

What was deliberately NOT copied: the recording's lettering on the bow, its Bitmoji faces, and its
artwork as such. Shapes, proportions, colours, positions and timing were matched; the models are
our own, built from code.

### The 2D pass, as it was written then

- The flight is ONE shot, no cut: the bow kicks up and the arrow leaps off it, then the camera
  glides down the lane from the line into the close-up. The arrow is placed FROM THE CAMERA
  (`_tipAt`): it shows big at the top right, rides up and right of the target and drops onto it
  from the right, with a white trail; its arc varies a little shot to shot. It is framed like a
  film, not simulated; the rules decided where it lands before it left.
- The close-up: the board about half the screen's width, seen a little from the left and above,
  stands behind. Arrows arrive from the right (`inDir`), so they stick out long, up and to the
  right. The board and face are unlit (bright white).
- The bow (then an SVG): a chunky metallic-blue riser with black parts, a thick black sight bar
  with a small foot, a blue shelf, a thick black grip, the hand a fist seen from the back. The
  sleeve was a separate screen-space SVG to the bottom-left corner.
