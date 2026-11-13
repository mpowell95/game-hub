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
Later the same day Matt: "You can't edit the 3d model just to fix this?" The converter now lengthens
only the upper sleeve along its own straight run (from just past the elbow, 4.3x), leaving the hand,
wrist, forearm, cuff and angles as made. Measured: the end sits 300-500 px off the left edge in every
pose (bow down, sliding back in, drawn, drawn aimed up-right) at 360, 393 and 430 wide.

## 2026-10-22 (later): a smooth flight camera, and the arm lowered

Matt: "watch every frame from the moment before the arrow is released to the moment it hits the
target. It's really jerky and weird." Frame by frame his recording showed three things: the bow
jumped and turned for two frames at the release (the `JOLT_T` kick), the camera then looked at the
arrow so the target slid left across the screen, and in the last 0.1 s it swung back onto the
close-up. Fixed: no kick (the string still snaps and the arrow still leaves over `JOLT_T`), and
`_camAt` always looks at the target (its look point eases from the aim line to the close-up's),
while the camera rides behind the arrow and eases out to the close-up's side late. Checked frame by
frame headless: the arrow is in view every frame and the target grows steadily in the middle.

Matt, same message: "the arm looks a little strange... the arrow will be at eye level, but the arm
is angled in such a way that the arrow is below the armpit... it's like your arm is above your
head." The model's arm is level with the hand, so on screen it ran flat off the left edge. The model
is now leaned `MODEL_CANT` 0.3 rad about its grip (shape unchanged): the arm rises from low on the
left up to the hand, and the bow leans a little with it (0.45 lowered the arm more but leaned the
bow so far the sight looked detached). The sleeve's closed end stays 380-620 px off the left edge at
360, 393 and 430 wide.

Same day, Matt's screenshot ("You messed something up bad"): the lean moved the hand but not the
arrow's rest point, so the drawn arrow lay across the fingers and ran into the grip. `_loadModel` now
leans `MODEL_REST` with the model (into the model's frame upright, back out leaned).

## 2026-10-26: the bow upright while aiming

Matt's recording (`ScreenRecording_10-26-2026 18-31-08_1.MP4`): drawn, the bow leaned about 30 degrees
on screen and its upper limb cut across the middle of the view, through the sight. Matt: "2 is the most
important... undo that rule and fix it" (the 2026-10-22 `MODEL_CANT` 0.3 lean). Standing the model up
by cant alone put the arm flat across the screen again (the "above the head" look), and no yaw fixes
that (a level arm at eye height always projects flat). Instead the drawn pose turns the arm toward the
eye (yaw -0.7) and tips it down toward the eye (pitch 0.3), with cant -0.15 to stand the bow up: the
arm now runs off the bottom-left corner, as a real bow arm does from the eye. The bow down keeps the
old turn (a pitched resting bow swung its sleeve across the view); `setPose` blends the two by `p` and
turns the arrow's rest with the model each frame. Checked headless at 360, 393, 430 wide: drawn,
mid-draw (p 0.5), aimed at the face's corners, and down.

## 2026-11-13: the target bow back, the Meshy arm kept

Matt: "archery does NOT work. It have HUGE visual problems", then "you never got the 3d bow thing correct".
Side by side with the recording (frames pulled from the Dropbox video): the recording's bow is an upright target
bow, only its middle on screen, the sight on a bar off the riser; ours (since 2026-10-21) was the Meshy model's
plain recurve, its whole length showing, the sight ring floating beside it with nothing holding it, and a string
running off the top of the screen. The built target bow (laid out from the recording 2026-10-14, hidden since the
model) was still in the code and already matched the recording closely; only its built hand was crude. Matt chose
"New bow, keep arm": the model now draws only its arm and hand (skin and sleeve triangles), on the built grip,
turned so the arm comes up from the bottom-left corner. The string rods and `MODEL_REST` are gone.

## 2026-11-13 (later): fast incoming arrows, no swing on the draw

Matt's recording (`ScreenRecording_11-13-2026 18-01-40_1.mov`): "the computer's arrows hitting the target. They're
incredibly slow... Arrows come in fast", and the bow "glitchy/shaky" ("Constant jitter"). The incoming arrow ran 3.5 m
in 0.5 s (7 m/s); now 9 m in 0.15 s (about 60 m/s), trail kept. Measured frame by frame, the recording's bow and sight
did not move during a held aim (only the leaves did); the motion was the draw: the bow tilted 7 degrees and swung left
then back on the way up, and the first draw froze for 70 ms (the sight's magnified view built on first use). The swing
is gone and the magnified view is built at load (`render.js _warm`).

## 2026-11-13 (later still): the flicker

Matt, on a cropped copy of the same recording: "look at every frame between 0s and 3.5s... it's VERY clear that it's
fucked up". Frame-by-frame differences during a held aim showed the bow's column flickering: its strips, its white
marks and a block of its face appearing and disappearing frame to frame (depth fighting; SwiftShader, which the
session's checks use, never shows it). Causes: the bow camera's near plane at 0.05 while nothing on screen is nearer
than about 8 bow units (the depth buffer's precision spent on empty space), strips only 0.02 clear of the column, and
the three white marks exactly level with its front. Near plane now 2 (range camera 0.25 m), strips 0.04+ clear, marks
in front, the target face polygon-offset. The tilt and swing on the draw (also in these frames) had gone earlier today.
