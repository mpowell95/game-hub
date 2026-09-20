# Baseball: the reference game (Baseball 9), read from Matt's recording

Matt, 2026-09-20, with a 3:20 screen recording of Baseball 9's tutorial (Playus Soft, iOS, landscape): *"does exactly
what I want our game to look like... Ours should be as close to a clone of this game as possible."*

This file is what that recording shows, measured (2 fps sheets of the whole clip, 20 fps windows around one pitch, one
batted ball and the home run), then what ours does today, the gap, and the decisions the gap forces. The recording and
its frames stay in Matt's Dropbox (`Claude Code Refs/ScreenRecording_09-19-2026 23-43-17_1.mp4`); none of it goes in
this public repo. **We copy the mechanics, the flow and the feel, never their art, names, logos or text.**

## 1. What the reference does

### Screen layout (both modes)
- Full-screen 3D scene. No HUD band, no strip band: the field IS the screen.
- Two round buttons, bottom corners, ~140 px on a 2622 px wide frame: LEFT = the pad (a circle showing a diamond
  cursor or four arrows), RIGHT = the action (PITCH / READY / SWING).
- Bottom centre, a thin dark bar: pitching = the pitch types with a number each (`4FB:53  SL:52  CB:46  CH:54  FRK:47`,
  selected one highlighted blue); batting = the batting modes (`CONTACT  POWER  BUNT I  BUNT II`).
- Top centre, a dark tutorial box (tutorial only). Top right, `Pitching 1 / 5` counter (practice only).
- The big verdict word sits ABOVE THE BATTER'S HEAD in the scene, not in a band: `STRIKE` / `BALL` in italic bold white
  with a second line `FASTBALL 84.7 mph`, plus a third small line for the swing (`SWING AND A MISS`, `LATE SWING`,
  `EARLY SWING`) or the pitch bonus (`NICE PITCH 4FB +5`, `PERFECT PITCH 4FB +10`).

### Pitching (camera BEHIND THE PITCHER, low, over his shoulder; batter, catcher and umpire in view)
1. Idle: pitcher standing on the rubber, glove up. Left button = "select pitch type" (cycles), or tap a type on the
   bottom bar. The strike zone is drawn as a white box on the catcher, with the control cursor (a ring with a
   crosshair) inside it.
2. Tap PITCH once. The wind-up starts immediately. **There is no meter.** Left button turns into the control pad.
3. During the wind-up, until the ball leaves the hand (~0.6 s), drag on the pad to move the control cursor anywhere in
   or around the zone. For a breaking pitch a second, yellow "point cursor" ring sits offset from the control cursor
   and shows where the pitch will END; the ball goes to the point cursor.
4. Release. The ball flies to the plate in about 0.35 to 0.45 s with a fire trail on a strike. The verdict appears the
   instant it crosses.
5. Pitcher follow-through, then walks back to the rubber; the verdict fades after ~1.2 s; the next pitch is ready
   ~2.2 s after the tap. The pitch bar comes back with the attribute numbers.
6. Practice mode: the catcher shows a target square; landing on it pays `NICE PITCH +5` or `PERFECT PITCH +10`.
   Accuracy is distance from the target, decided by the pitcher's attribute and the drag.

### Batting (camera BEHIND THE BATTER, low, looking at the pitcher; the whole stadium in view)
1. Idle: batter in stance, right side. The batting cursor is drawn on the field in front of him: a translucent
   square (the zone) with a circle inside (contact mode: big circle; power mode: smaller circle, square tinted).
   Left button = change batting mode; bottom bar shows the modes. Right button = READY.
2. Tap READY. The pitcher winds up (~1 s). Left button becomes the batting pad, right becomes SWING.
3. When the pitcher throws, the pitch's TARGET is shown on the field as a small marker; you drag the cursor circle onto
   it. For an off-speed pitch the marker MOVES during the flight and you follow it.
4. The ball comes in over ~0.45 s and grows. Swing when the ball is inside the circle. Where the ball sits relative to
   the circle's centre decides direction (pull / opposite) and height (ground / fly).
5. Miss: `STRIKE`, pitch name + mph, and `SWING AND A MISS` / `LATE SWING` / `EARLY SWING`. Batter resets.
6. Contact: a fire burst at the bat, ~0.7 s of follow-through with the ball leaving up and away, then a CUT to a
   ball-chase camera (behind and above the ball, following it over the infield/outfield), a mini diamond widget on the
   right showing runners (HOME / 1B / 2B / 3B, the runner's number moving between them), `0 OUT` top left, fielders
   drawn with name tags. The chase lasts about 1.8 s to the catch or landing.
7. Home run: the chase camera tilts up to the sky and follows the ball ~2.5 s with `99.2 mph  38°` under it, then a
   huge orange `HOMERUN` word with confetti for ~3 s, then the batter's trot with a stats bar (`421 ft  99.2 mph  38°`,
   season line).

### Measured timings
| Beat | Reference | Ours (v860) |
|---|---|---|
| Pitching: tap to release | ~0.6 s (drag window) | tap, meter 1.1 s, second tap |
| Pitch flight | ~0.35 to 0.45 s | 1.5 s (fastball) |
| Verdict on screen | ~1.2 s | 1.8 s |
| Pitch tap to next ready | ~2.2 s | 6.2 s |
| Batting: READY to release | ~1.0 s | 1.4 s wind-up (auto) |
| Contact hold before cut | ~0.7 s | 0.4 s |
| Chase / overhead flight | ~1.8 s (HR ~2.5 s) | 1.0 s + 1.0 s marker |
| Whole at-bat beat after a ball in play | ~4 to 5 s | 4.8 s |

## 2. What ours does today
One painted plate camera (`plate.webp`, behind the batter) for BOTH modes, with the 3D figures composited on it; a
painted overhead (`overhead.webp`) for the cutaway. Pitching uses a hold-and-release meter with a Nice zone; aim is a
1-D pad (left/right only); breaking pitches are steered after release. Batting uses a 1-D pad that shifts the batter
in the box and a tap/charge swing timed against the ball's arrival. Verdicts are big words in a band over the field,
pitch name and mph on a small line. A ball in play cuts to the overhead picture with a dot and a landing marker; no
fielders, no runners on screen. HUD, strip and control bands are fixed-geometry DOM. Portrait.

## 3. The gap, biggest first
1. **The scene.** Theirs is a real 3D stadium with two cameras (behind pitcher, behind batter) and a chase camera. Ours
   is two paintings. A painting cannot follow a ball. This is the one that decides everything else.
2. **Aim is 2-D.** Theirs: drag a cursor anywhere in the zone (pitching: where it goes; batting: where to meet it).
   Ours: left/right only.
3. **No meter.** Theirs: tap once, aim during the wind-up. Ours: tap, wait, tap.
4. **Batting cursor follows the pitch.** Theirs shows the pitch's target and moves it for off-speed. Ours has no target.
5. **Speed.** Their beats are 2 to 3x faster than ours everywhere.
6. **Ball in play.** Theirs shows the ball, the fielders and the runners. Ours shows a dot on a picture.
7. **Presentation.** Verdict over the batter's head with pitch + mph under it; fire trail on strikes; fire burst on
   contact; HOMERUN word and confetti; stats bar after a homer.
8. **Batting modes** (contact / power / bunt) and pitch attribute numbers on the bar.

## 4. Decisions before anything is built
- **D1 Orientation.** The reference is landscape. Every game in this hub is portrait with fixed-geometry bands. A
  landscape Baseball is possible (the hub mounts an immersive module full-screen) but it is the first landscape game
  and every fit test and the no-scroll rule assume portrait. Recommendation: stay portrait; the two cameras compose
  fine tall (their screens are mostly sky and dirt at the sides anyway), and the corner buttons sit where thumbs are.
- **D2 The scene.** Either (a) rebuild the field as real three.js geometry (diamond, mound, fences, a stadium ring,
  nine fielders and runners from the same Kenney rig) so cameras can move and a ball can be chased, or (b) keep the two
  paintings and add a third painted "behind the pitcher" camera, fake the chase with the overhead. (a) is the clone;
  (b) is a cheaper look-alike that cannot do the chase camera or runners. Recommendation: (a), staged.
- **D3 Controls.** Replace the meter with tap-and-drag-during-wind-up, and the 1-D pads with a 2-D cursor. This changes
  `settings.js`'s pitching model (the meter, Nice, hang, steer after release) and `pitch.js`'s scoring; the design
  doc's section 12 gets rewritten. The engine's swing timing and contact quality stay.
- **D4 Art.** Our own stadium, our own figures (Kenney, already in), our own words. Nothing lifted from the recording.

## 5. Proposed stages (after D1 to D4)
- **R1 Field in 3D.** Diamond, mound, foul lines, fences at each league's distances, a simple stadium ring and sky.
  Three cameras (pitcher-back, batter-back, chase) with the existing actors placed in world units instead of canvas
  px. No gameplay change. Stills from all three cameras at 393x852.
- **R2 Controls.** Tap PITCH, drag a 2-D cursor during the wind-up, breaking-pitch point cursor; READY then a 2-D
  batting cursor with the pitch target shown and moving. Engine scoring follows the cursor distance. Beats re-timed
  to the table above.
- **R3 Ball in play.** Chase camera on the batted ball, nine fielders standing at their positions (no fielding AI yet,
  the engine already decides the outcome), runners advancing on the diamond, the mini diamond widget.
- **R4 Presentation.** Verdict over the batter, fire trail and contact burst, HOMERUN word, stats bar, batting modes.
