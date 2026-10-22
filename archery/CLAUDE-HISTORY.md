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

## 2026-10-20: the arrow vanishing at the hit, and the sight's weight

Matt: the arrow "disappears the moment before it hits... like it vanishes and the game freezes for
a second", then reappears with the score. Cause: `_arrive` removed the flying arrow and re-stuck
only the earlier arrows; the new one was added in `_landed`, HIT_POP (0.6 s) later, with the number.
Fix: `_arrive` sticks it at once.

Matt: the sight "pretty much goes exactly where I place it"; in the recording "it floats around a
bit... if you move your aim in a jerky movement, it overshoots where you want to aim and kind of
keeps floating that direction until corrected. The more subtle your movement, the more accurate and
smooth it is". Built as `stepHand` in engine.js: the finger moves a target, the sight follows on an
under-damped spring (k 55, damping 0.5), and a move faster than 1.5 face radii a second pushes a
drift (full from 8 r/s) worth up to 0.55 of the move, fading over 0.8 s; a move back against it
cancels it. Simulated: 0.3 r slowly lands on 0.30 (peak 0.31); a 1 r jerk in 0.1 s floats on to
about 1.5. In Chromium, a 60 px flick floated on about a quarter ring past the finger's stop.

## 2026-10-20 (later): Matt's frame-by-frame review of a two-round recording

Matt pointed at frames: the scored-ring flash (a DOM ellipse) "pops out and on top of every other
thing... looks like a glitch"; the arrows "look more like nerf gun bullets"; a new arrow landing
beside an old one was hard to tell apart; on release (11.375 to 11.500 s) the arrow jumped up and
right; the computer's arrows appeared from nowhere (0.28 s) and scored at once while his popped
0.6 s later; the camera snapped at the end of the glide. Done: the flash is now two yellow rings
with a dark edge drawn on the face in 3D (under the arrows, at the face's angle); the arrow is 2.2 cm
thick with a point and swept vanes, parts shared (it used to build 7 new materials per arrow on every
rebuild); every arrow sticks and quivers the moment it hits and the old number clears; numbers pop
0.3 s after for both players; the flight starts on the sight (no climb to an apex); the camera eases
to a stop; the computer's arrows fly in over 0.5 s with a trail. The arm and hand: not changed yet,
options put to Matt.

## 2026-10-21: the arm becomes a real model

Matt: "the arm and hand are still way fucked up... What do you recommend". Options given: drop the
arm, a ready-made model, or a flat drawing; Matt chose to keep it and asked for a prompt for
ChatGPT/Gemini. Lesson from three rounds of pictures: the prompt over-asked (three views, an exact
finger-wide hole); what mattered was one clean cartoony arm on white. Meshy turned the picture into a
model; its flagship model (7.1) is paid to download, the Lite model was free. The converter
(`tools/convert-archery-arm.mjs`) measures the gap and cuff off that one source. Fitting it: aimed at
the stand-in's shoulder the arm was seen end-on and the sleeve hid the hand; a separate
`ARM_SHOULDER` well down and left shows it from the side, as the recording does.

## 2026-10-21 (later): one model for the bow and the arm

Matt: the arm-only model's hand "isn't grabbing the bow... The thumb doesn't go around the bow
handle". Its fist had a see-through slot a finger wide; the built grip is four times that. Opening
the slot in the converter left the fingers beside the grip, not round it. Matt's call: make the bow
and arm as one object. ChatGPT refused the first prompt (likely "cut off" next to "bow"; reworded as
a "toy-style game asset" with a "rounded, closed" sleeve end); Meshy 6 Lite made the model. It
replaces the built bow; the built sight stays (a Meshy sight would not line up with the aiming
ring). The arm in the model lies in the bow's plane, so seen from the eye it was end on: the
converter weights the forearm/sleeve and a shader turns them about the wrist toward `ARM_SHOULDER`.
`arm.bin` and `convert-archery-arm.mjs` were removed (the source `arm-meshy.glb` stays in reference/).

## 2026-10-21 (later still): the model is drawn as made

The wrist bend read as "a broken wrist"; spreading it along the forearm still changed the model.
Matt: "The 3d model is correct. I just checked. Just don't change it?" The bend weights, the stretch
and the shader were removed (format BOW2); the model is only placed, scaled and turned (-1.1 rad, the
smallest turn that keeps the sleeve's closed end off screen with the bow down).

## 2026-10-22: a straight flight, and the arm's end

Matt: the flight "curves towards the camera then back to the target... NOT an arrow flying straight
towards a target". The arrow was placed from the moving camera (screen-space framing). Now it flies a
real straight line from the sight to the hit, and the camera chases behind it looking at it, dropping
back to the close-up's distance and drifting to its side, settling as the arrow lands. Two failed
tries on the way: a camera that kept drifting sideways while 2 m behind swung the arrow up and right;
a late swing to the close-up caught the arrow up so it loomed and left the screen.
Matt also: "i shouldn't see the end of the arm". Measured: with the bow down the sleeve's closed end
sits 35-55 px inside the left edge on every phone (the Meshy arm is 0.45 bow heights; this camera
needs about 1.0 at 54 deg left, 20 deg down for the end to stay off screen in every pose, including
the bow sliding back in). Turning the model further only reaches the edge. Waiting on a new model
from the prompt (long arm).
