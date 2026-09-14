# Baseball Design Spec, v1 (2026-09-14)

The drawing instruction for every screen phase 3 builds. Precise enough that two people mocking it
independently produce the same layout. It is not a tuning document (no timing window, yield or CPU
number is set here), not a copy freeze (section 13 gives the words; Matt changes words freely), and
not the engine contract (section 14 names what the engine must grow, not how).

Written against `docs/BASEBALL-DESIGN-DOC.md` v12, `baseball/CLAUDE.md` at the Phase 2 close
(`game-hub-v830`), the shipped engine in `baseball/js/engine/`, `docs/BUILDING-A-GAME.md` Parts 0
to 3, `css/ui.css`, `css/hub.css`, `index.html`, and the Sudoku, Golf and Escoba screens.

**Look at the pictures in this folder before reading a word of this.** They are the input; this file
is the artifact (see `reference/README.md`).

## 0. The pictures, and the geometry convention

| File | What it is |
|---|---|
| `mock-play-batting.jpg` | THE reference for the play screen: camera behind the plate, big batter foreground, pitcher on the mound, HUD strip, eight pitch slots, pad, three action slots, ring |
| `mock-play-overhead.jpg` | The ball-in-play result view: overhead stadium, nine fielders, dotted flight path, same HUD and controls |
| `backdrop-plate.jpg` | The plate view with every player and every control removed. The field the game draws on |
| `backdrop-overhead.jpg` | The overhead stadium with the nine fielders in place and no HUD. The result view's picture |
| `batter-home.png` | Your batter, no bat, transparent. Left-handed as drawn; code flips it for a right-hander |
| `bat.png` | The bat, its own image so code rotates it for the swing |
| `pitcher-set.png` | Your pitcher, set position, transparent |
| `pitcher-sheet.png` | The same pitcher, three poses (set, wind-up, release) in one sheet; cut the second and third out |
| `pitcher-windup.png`, `pitcher-release.png` | The other two poses, cut from the sheet |
| `ball-sheet.png` | Ten balls at different seam angles, transparent; cycle them for spin |

| `batter-away.png` | The CPU batter, same pose, red uniform, no bat, transparent |


Every geometry figure below is a fraction of the game root's own rectangle, with the pixel value at
the reference phone beside it. Reference phone: 393 by 852, mounted in the hub with
`immersive: true`. Short phone: the short height `test-visual.mjs` uses for its fit check. The root
fills from under the hub's floating back button to the viewport bottom, measured by probe exactly as
Golf's `_fit()` does (Part 3). W and H below are that root's width and height.

| Root | W | H (tall) | H (short) |
|---|---|---|---|
| In hub, immersive | 361 | 714 | about 530 |
| Standalone | 393 | 852 minus safe areas | 667 minus safe areas |

## 1. Rules this spec obeys everywhere

Matt's standing rules: no helper or instructional sentences in game UI (no "Your turn", no "Tap to
swing"); fixed geometry, with space reserved for anything that appears or disappears; feedback where
the player is already looking; the viewport is a budget spent deliberately, no dead zones; red-green
colorblind safe, the `#ffce3a` attention color always paired with a non-color cue; no em dashes;
12-hour time. Part 0's floor: 11 px text minimum, 44 by 44 tap targets, `safe-area-inset-bottom`, no
scrolling anywhere (tested by `check-no-scroll.mjs`), animate only transform, opacity, filter and
box-shadow, reduced motion thins garnish but gameplay motion continues (the pitch still flies), and
the iOS rapid-tap fix on the Swing button.

Decisions already made and not reopened here: standings top four plus your row when outside; points
spent after every game; Quick Play v1 is pick a league and everything else random; steal, bunt and
pickoff are taps in reserved fixed slots; the CPU lineup is not shown before a game; no sound; team
and park names are proper nouns, untranslated; players are jersey number and position ("#24 CF"),
never names; pitch type and speed hidden until the ball crosses the plate; baseball is tier-blind.

Decision made 2026-09-14 by Matt, folded in below: **the players are visible in the overhead
ball-in-play view.** The doc's §10 line "No fielders drawn" changes in v13 to "fielders are drawn in
the overhead result view; the out zones remain the mechanic".

## 2. Reuse, tokens, and the tile

Nothing new is drawn where a primitive exists.

| Need | Reuse | Note |
|---|---|---|
| Buttons, chips, fields, modals, overlay | `css/ui.css` `.gh-btn` (`--primary`, `--ghost`, `--danger`, `--block`, `--icon`), `.gh-chip`, `.gh-seg`, `.gh-card`, `.gh-modal`, `.gh-overlay` | Escoba's `.eb-sheet-x` close-button pattern for the X: 32 px visual inside a 44 px hit area |
| Radii, type scale, durations | `--gh-r-sm/md/lg/pill`, `--gh-fs-xs..xl`, `--gh-dur-fast/mid/slow`, `--gh-ease` | No bespoke size below 11 px anywhere |
| Ink, surfaces, dark mode | `--gh-bg/surface/ink/muted/accent`, `.gh-dark` on `<html>` | Game CSS never reads `prefers-color-scheme` |
| Colorblind palette | `--gh-cb-yellow` circle, `--gh-cb-blue` triangle, `--gh-cb-vermilion` square, `--gh-cb-teal` diamond | Used for the two teams and the ball marker |
| Attention accent | `#ffce3a` | Only for "selected or armed": the chosen pitch tile, the charged Swing button, the selected preset or league. Always with a border, shape or fill change beside it |
| Translucent HUD panels over a drawn field | Golf's hatched panel idea (`--gf-hatch`), as an own `--bb-hatch` token | Same white inner border plus dark outline, so panels read on grass and dirt in both themes. The mock's dark rounded panels are this |
| Fit and resize | `onViewportResize` plus Golf's `_fit()` probe, `min-height` on the root, never a height on `.hub-game` | Part 3 |
| Setup and how-to sheets | Escoba's `.eb-sheet` shape (max-width 340, head with title and ghost Done) | Section 12 |
| Leave and forfeit confirm | The hub's `hub_confirm_*` dialog | Section 11 |
| Tile | The existing `GAME_ART.baseball` | Keep for launch |
| Team markers | Two shapes, never two hues alone: your team is the profile color with a filled circle, the CPU team is `--gh-cb-blue` with a triangle | Beside every score and in the HUD |

CSS root `.bb-root`, prefix `.bb-`, tokens `--bb-*`. Settings key `gamehub.baseball.v1` already
exists and carries the career field; UI preferences added there are additive.

Shipped art goes to `baseball/img/` as WebP, cut from the files in this folder: backdrop-plate,
backdrop-overhead, batter-home, batter-away, bat, pitcher-set, pitcher-windup, pitcher-release,
ball-sheet. Budget about 1 MB total (the two backdrops about 300 KB each, everything else under
100 KB). They belong in `sw.js`'s `ASSETS` REST tier, never LAZY: a launcher tile opens them.

## 3. The state language

Hue plus SHAPE plus MOTION, never hue alone. This table is the whole visual vocabulary; a mock that
invents a fourth cue for one of these rows is wrong.

| Meaning | Hue | Shape | Motion |
|---|---|---|---|
| Out zone (where a fielder stands) | Translucent dark hatch | Diagonal hatch, sector outline | None at rest; outline thickens one beat when it catches a ball |
| Fielder (overhead view only) | As painted | The painted figure, standing inside its sector | The figure nearest the landing point hops once when it makes the out (transform only) |
| Gap (a hit lands here) | Plain field | No hatch | None |
| Foul territory | Slightly darker field | Solid foul lines | None |
| Ball in flight | White ball, dark outline | Circle, grows with approach in the plate view; a white dotted trail in the overhead view | Follows the flight; never thinned under reduced motion |
| Ball caught (out) | Ink | X drawn over the landing point | Appears at landing |
| Ball lands for a hit | White | Filled circle with the base label (1B, 2B, 3B) | Appears at landing |
| Over the fence | Fence segment | Fence segment doubles in stroke, label HR | One flash |
| Strike zone | White outline | Rectangle above the plate | None |
| Bat sweet spot (batting) | Profile color | Short horizontal bar with a center notch, drawn over the strike zone | Slides with the pad |
| Aim point (pitching) | Profile color | Crosshair circle over the strike zone | Slides with the pad |
| Selected pitch tile | `#ffce3a` fill | 2 px ink border, tile lifts 1 px | `--gh-dur-fast` |
| Swing button, idle | Surface | Round, label SWING | None |
| Swing button, charging | Ring filling | Ring from lower right, clockwise | Fill over `chargeTime` |
| Swing button, charged | `#ffce3a` fill | Ring full, 2 px ink border, label unchanged | One scale pulse 1.00 to 1.06; under reduced motion fill and border alone |
| Throw ring, filling | Neutral fill | Clockwise from lower right | Over `meterTime` |
| Nice zone | Lighter segment | Two white 2 px radial ticks at the edges, a small white diamond at the center | None |
| Release marker | White | 2 px radial tick at the release angle | Holds one second, fades over `--gh-dur-slow` |
| Hung pitch | Muted | Ring fill drains from the top back to the start | Drain over `--gh-dur-mid` |
| Timing feedback Early | Ink | Left chevron plus word | Rises 8 px over `--gh-dur-mid`; instant under reduced motion |
| Timing feedback Late | Ink | Right chevron plus word | Same |
| Timing feedback Perfect | `#ffce3a` | Star plus word | Same |
| Runner on base | Profile color, ink border | Filled diamond on the HUD diamond | None |
| Out recorded | Ink | Filled circle in the O row | None |
| Trophy Bronze / Silver / Gold | Bronze `#b87333`, silver `#a8a9ad`, gold `--gh-cb-yellow` | A cup with one, two or three horizontal bands | None |
| Sync: Pulling | Muted | Circular-arrows glyph | Rotates; still rotates under reduced motion |
| Sync: Offline, local career | Muted | Cloud with a slash | None |
| Sync: Fork | Ink | Branch glyph | None |
| Sync: Denied | Muted | Lock glyph | None; logged loudly |

## 4. Screen inventory and flow

| Screen | Host | Reached from |
|---|---|---|
| Career home | Full root, scrolls nothing | Tile; also every game end |
| Player creation | Sheet | Career home with no career |
| Skill spend | Sheet | Career home (points to spend) and player creation (Custom) |
| Quick Play setup | Sheet | Career home's secondary button |
| Play screen | Full root | Career home's Play, Quick Play's Play |
| Game-end modal | `.gh-modal` with X | Play screen |
| Trophy or advance ceremony | Same modal, richer body | Game end when a season resolves |
| Retire confirm | `.gh-modal` | Career home |
| Forfeit confirm | Hub leave dialog with forfeit wording | Hub back button during a career game |
| How-to sheet | Sheet | Career home, Quick Play, and once on first run |
| History and records | Existing My Stats tab | Profile page |
| Leaderboard card | Existing leaderboard | Leaderboards |

There is no separate between-innings modal (section 9). Career home is the loop's fixed point: every
game ends on the modal, its primary button returns to career home, and points are spent there before
the next game is offered. Quick Play returns to career home too (its modal says Play again and Done).

## 5. The play screen

Four bands stacked, top to bottom: HUD, field, pitch strip, control band. Exactly what
`mock-play-batting.jpg` shows. Three bands are fixed pixel heights because thumbs and text are fixed
sizes. The field is the only flexible element and absorbs the whole difference between phones, with a
floor.

| Band | Height | At tall | At short | Rule |
|---|---|---|---|---|
| HUD | 48 px | 48 | 48 | Fixed |
| Field | remainder | 386 | 202 | Floor 0.28 H; if the floor cannot be met, the pitch strip collapses to one row of 44 (last four pitches), nothing else changes |
| Pitch strip | 2 rows of 44 plus 4 gap, 8 px margins | 108 | 108 | Fixed |
| Control band | 172 px | 172 | 172 | Fixed |

Widths inside the control band, left to right, as fractions of W with pixels at 361:

| Element | Fraction | Px | Rule |
|---|---|---|---|
| Left pad | 0.44 W square | 159 | `touch-action: none`; drag anywhere inside it |
| Gap | 0.025 W | 9 | |
| Action column | 0.13 W | 47 | Three reserved slots stacked, each 47 by 44, 8 px apart, top-aligned to the pad |
| Gap | 0.025 W | 9 | |
| Swing/Throw ring | 0.38 W diameter | 137 | Ring 10 px thick; the button inside is 101 px across; centered vertically in the band |

The pad sits lower-left under the left thumb, the ring lower-right under the right thumb. Both are
`touch-action: none`. Everything above the control band is `touch-action: manipulation`. The Swing
button takes Hill Climb's rapid-tap cure verbatim (`hill-climb/js/ui.js`, `bindPlay`): non-passive
`touchstart` with default prevented, touch driving the button directly, pointer events ignored for
`pointerType === 'touch'`, `selectstart` blocked on the root.

HUD, one row, left to right, all text `--gh-fs-xs` or larger, on one hatched panel spanning the
width:

| Slot | Content | Width |
|---|---|---|
| Score | Your marker, three-letter team code, runs; CPU marker, code, runs | 0.34 W |
| Inning | Up or down triangle plus the inning number | 0.12 W |
| Count | B with three dots, S with two dots, O with three dots; dots fill left to right | 0.30 W |
| Bases | A small diamond; three base squares that fill with the profile color when a runner is on | 0.14 W |
| Batter | `#24 CF` in the pitching state; your own `#` and position in the batting state | 0.10 W |

Two reserved lines live inside the field band, centered above the strike zone, each one text row
tall with an explicit 4 px gap; blank when there is nothing to say and never removed.

| Line | Batting state | Pitching state |
|---|---|---|
| Line 1 (verdict) | Ball, Strike, Foul, Early, Late, Perfect, then the outcome word after resolution (Single, Double, Triple, Home run, Out, Walk, Strikeout) | Nice or Hung at release, then Ball, Strike, Foul, then the outcome word |
| Line 2 (readout) | Pitch name and mph, painted the instant the ball crosses the plate | Same |

Both states, in one frame, with nothing moving between them:

| Element | Batting | Pitching |
|---|---|---|
| Foreground figure | `batter-home` plus `bat` at the near box, your hand's side | `batter-away` plus `bat` at the near box, the CPU batter's side |
| Mound figure | `pitcher-*` poses, small, CPU pitcher | `pitcher-*` poses, small, you |
| Left pad | Slides the sweet-spot bar along the strike zone's width | Slides the aim crosshair; after release on curve, slider or screwball the same pad steers, and a break-direction arrow appears inside the pad at release |
| Ring button label | SWING | THROW |
| Ring | Charge meter | Throw meter |
| Pitch strip | The at-bat strip: the last eight pitches of this at-bat, each tile filling in as it crosses the plate with the pitch code and mph plus a small ball or strike mark | The pitch selector: one tile per unlocked pitch, locked pitches as empty wells with a lock glyph, selected tile in the accent |
| Action slot 1 | Bunt | Empty well |
| Action slot 2 | Steal (enabled only with a runner on) | Empty well |
| Action slot 3 | Empty well | Pickoff (enabled only with a runner on) |

Transition: a half-inning end is a fixed 3000 ms beat (`FEEL.ui.betweenMs`). During it Line 1 shows
the half-inning result ("End of the 2nd"), and the labels swap in place: SWING becomes THROW, the
strip cross-fades from at-bat readouts to the selector, the wells swap, the foreground figure
cross-fades between the two batters. No element changes size or position. Under reduced motion the
swap is instant at the beat's midpoint.

## 6. The field band: two pictures, one rectangle

The field band shows one of two pictures. Both fill exactly the same rectangle, so a cut between them
moves nothing else on the screen. HUD, strip, pad, action slots and ring never move.

**The plate view** (`backdrop-plate`, `mock-play-batting.jpg`) is on screen for the pitch and the
swing: camera behind and above the plate, plate at the bottom center, mound a third of the way up,
fence and stands at the top. The pitch flies from the mound toward the plate, growing as it comes.
A swing that misses, a take, a foul, a walk and a strikeout all resolve here; the two reserved lines
carry the words.

**The overhead view** (`backdrop-overhead`, `mock-play-overhead.jpg`) is on screen only for a ball
in play: the cut happens at contact, the ball's flight is drawn as a growing white dotted trail from
the plate to the landing point, the landing marker appears (X for an out, filled circle with 1B/2B/3B
for a hit, the fence flash for HR), Line 1 says the outcome, the beat holds for `FEEL.ui.resultMs`,
and the band cuts back to the plate view for the next pitch. Runners advancing are drawn on this view
as profile-color diamonds sliding base to base along the paths.

**The players are visible in the overhead view.** The nine fielders painted into `backdrop-overhead`
stand at the standard positions. The seven out zones from `zonesFor(league)` are drawn as hatched
translucent sectors UNDER the painted fielders, so every fielder stands inside a hatch and the hatch
is what decides. This works because the sectors' angles are fixed across leagues (only their depth
and the field's overall scale change, and the overhead picture scales as one image), and a Shifters
team rotates a sector by at most `SHIFT_MAX_DEG` (3 degrees), which is invisible at this size. The
one honest cost: a shifted sector's fielder does not move with it. Accepted for v1; the hatch is the
truth and is always drawn.

Rendering scale in the plate view: the current league's center-field fence distance maps to 0.92 of
the band's height, so a bigger league renders smaller exactly as the doc locks. The strike zone has a
floor of 0.30 W wide so the pad's travel never becomes a slider of a few pixels. In the overhead view
the whole picture scales so the fence arc sits at the same screen height at every league; the hatch
sectors scale with it.

Hit versus out at a glance is the landing marker, not the hue: an X inside a hatch, a filled circle in
a gap, the fence flashing for a home run, and a landing outside the foul line is a foul with Line 1
saying so. The marker holds for the result beat and clears with the cut back.

## 7. The Swing button

Round, 101 px, inside the 137 px ring. Tap (release under 300 ms, `FEEL.engine.chargeTime`) swings
on release. Hold past 300 ms charges, and release swings charged. The player tells which they are
doing by the ring alone: nothing during the first 300 ms, then the ring fills clockwise from the lower
right over that window and locks full; the button turns accent with a 2 px ink border and one scale
pulse. A charged swing has the smaller timing window; the button gives no hint of that, the how-to
sheet does. There is no visible timing window; the feedback is Line 1 after the pitch. A hold that
outlasts the pitch is a charged swing at the moment of release, wherever that lands; the engine
decides. The swing itself is `bat.png` rotating about the hands over about 120 ms (transform only),
the batter body unchanged; a hit adds one 60 ms body lean.

## 8. The Throw ring

Same ring. The fill starts at the lower right (about 4 o'clock, under the resting thumb) and runs
clockwise, so the Nice zone sits at the top, centered on 12 o'clock and never hidden by a thumb. Its
width is `niceWidth` (0.12 of the circumference, about 43 degrees), and its edges are the two white
ticks with a white diamond at its center, so a player who cannot see the lighter segment still has the
marks. The mock's ticks sit at about 10 and 12 o'clock; draw them straddling 12. Tap: normal pitch.
Hold and release inside the zone: power pitch, Line 1 says Nice. Hold past the zone: the fill keeps
going to the full circle and any release after the zone's far edge is a hang, Line 1 says Hung, the
ring drains. Release before the zone: normal pitch (proposed, section 15). The release tick stays one
second. Fill time is `FEEL.engine.meterTime`. The mound figure steps set, wind-up, release in time
with the fill and the throw.

## 9. Feedback, readouts, and beats

Everything the player is told appears in Line 1 or Line 2, above the plate, where the eyes already
are, or in the HUD, which updates silently. Timing wording: keep Early, Late, Perfect, each with its
chevron or star. Fast! and Slow! are rejected because they are ambiguous on this screen (the pitch has
a speed too, and Line 2 prints it two rows down). Between innings there is no modal: the beat, the
Line 1 text, and the in-place swap in section 5. Between at-bats the next batter's `#` and position
appears in the HUD's batter slot with no announcement.

The CPU wind-up: the mound figure steps from set to wind-up 400 ms before release (`pitcher-windup`),
then to release as the ball leaves. Fixed length every pitch (`FEEL.ui.windupMs`), so rhythm is
learnable. Reduced motion keeps the pose steps, because they are the release cue.

## 10. Career home and the sync states

One column, no scrolling, five blocks of fixed height at the tall phone; the standings block loses its
fifth row at the short phone and nothing else changes.

| Block | Height | Content |
|---|---|---|
| Status row | 32 px, always present | Sync glyph plus text from section 13, or the league and season line when healthy ("College, Season 2") |
| Next game card | 0.28 H | Opponent code and marker, "vs" or "at", the park name in Majors, the game label ("Game 7 of 12", "Semifinal", "Championship", "World Series"), the Play button `.gh-btn--primary --block` |
| Standings | 5 rows of 36 px plus a 24 px header | Rank, team code with marker, W-L. Rows 1 to 4 always the top four. Row 5 is the fifth-placed team when you are in the top four, and a "···" divider plus your own row when you are outside. Your row is always marked with your marker, never by hue |
| Season strip and points | 56 px | Twelve 12 px marks: filled circle for a win, hollow circle with an X for a loss, dot for unplayed, a bar under the current game. Right: a chip "Points 4" and a `Skills` ghost button (44 px) |
| Footer row | 44 px | `Quick Play` ghost, `How to play` ghost, `Retire` danger, equal widths |

The truth rule: a painted number that could change when the pull returns is painted in muted ink, and
the status row says Syncing. With no local career and a pull in flight, the Play button's slot holds
the Syncing row itself, not a Start button, because offering "Start a career" before the remote
answers is how a player forks their own career. When the pull fails with no local career, the slot
becomes Start a career and the status row shows the offline wording, which names the path back ("it
syncs itself next time you open the hub online"). The Fork notice replaces the status row until tapped
once, then that row returns to normal; nothing else on the screen changes. Denied logs loudly and
shows the lock glyph with "Saved on this phone".

## 11. The other screens

Player creation: a sheet with a `.gh-seg` for L / R at the top, the seven presets as 44 px rows with
a radio mark and their six numbers in `--gh-fs-xs`, a `Custom` row that opens skill spend, `Randomize`
ghost, `Start` primary. Skill spend: six rows, each a name, ten pips (filled to the current point, a
tick at the current cap), minus and plus at 44 px; a chip at the top reads "Points left 3"; `Done`
primary; minus is disabled below the preset's floor during creation and below the current value
after. Quick Play setup: a five-row `.gh-seg` for the league, `Play` primary, nothing else. Game-end
modal: X top right, headline (Win or Loss with your marker), the line score as three columns per
inning plus R H, a points row ("+3 points" or "+0"), then `Continue` primary; in Quick Play the
buttons are `Play again` and `Done`. Ceremony: the same modal with the trophy cup (bands, section 3)
and the advance line ("Next: College") or the replay line ("Season replays"); one modal, no second
screen. Retire confirm: `.gh-modal`, two buttons, danger on Retire, disabled with a lock glyph while a
game is in progress. Forfeit: the hub's leave dialog with forfeit wording during a career game; Quick
Play uses the standard leave wording. History in My Stats: one row per finished career, "Sep 14,
3:42 PM", best league and trophy cup, W-L. Leaderboard card: the metric as words ("Majors, Silver",
"World Series x2"), the five league cups in a row (empty outline where nothing was won), then careers
finished, W-L, homers.

## 12. The how-to sheet

The four-part pattern, once, with three diagram rows so it fits both heights: goal sentence in bold
("Hit the gaps, pitch to the corners"), then three rows, each a 96 by 64 diagram left and a one-line
caption right: swing (a tap arrow versus a hold bar with the ring filling), ring (the zone at the top
with its white ticks and a release tick inside it), steering (the pad with a drag arrow toward the
break side and the ball bending the same way). Then the four-line list: "Tap swings, hold charges",
"Release in the marked zone for a power pitch", "Hold too long and the pitch hangs", "Drag toward the
break to bend curves and sliders". Every line measured to one row, nowrap. Opened from career home
and Quick Play, and opened once automatically before the first game ever, stored as a preference flag
in `gamehub.baseball.v1`. This is the only teaching surface; no play-screen text ever explains a
control.

## 13. Copy

English and Spanish, no em dashes, 12-hour times, team and park names untranslated, players as
`#24 CF`.

| Key | EN | ES |
|---|---|---|
| swing | SWING | BATEAR |
| throw | THROW | LANZAR |
| bunt / steal / pickoff | Bunt / Steal / Pickoff | Toque / Robar / Pickoff |
| early / late / perfect | Early / Late / Perfect | Antes / Tarde / Perfecto |
| nice / hung | Nice / Hung | Genial / Colgado |
| ball / strike / foul | Ball / Strike / Foul | Bola / Strike / Foul |
| outcomes | Single, Double, Triple, Home run, Out, Walk, Strikeout | Sencillo, Doble, Triple, Jonrón, Out, Base por bolas, Ponche |
| pitch codes | FB CH CB SL KN SC EP CT | same |
| pitch names | Fastball, Changeup, Curveball, Slider, Knuckleball, Screwball, Eephus, Cutter | Recta, Cambio, Curva, Slider, Nudillos, Screwball, Eephus, Cutter |
| half inning end | End of the 2nd | Fin de la 2.ª |
| game labels | Game 7 of 12, Semifinal, Championship, World Series | Partido 7 de 12, Semifinal, Final, Serie Mundial |
| sync | Syncing; the two doc §15 sentences; Saved on this phone | Sincronizando; Estás sin conexión. Tu carrera está guardada en este teléfono. Se sincroniza sola la próxima vez que abras el hub con conexión.; Tu carrera continuó en otro dispositivo. Se conservó la versión de este teléfono.; Guardada en este teléfono |
| forfeit confirm | Forfeit this game? It counts as a loss. / Keep playing / Forfeit | ¿Abandonar este partido? Cuenta como derrota. / Seguir jugando / Abandonar |
| retire confirm | Retire this player? The career is kept in your history. / Keep playing / Retire | ¿Retirar a este jugador? La carrera queda en tu historial. / Seguir / Retirar |

## 14. Engine seams phase 3 must add

Named so the builder knows which visuals have no engine behind them yet. Hold, Nice and hang: the
engine has `meterTime`, `niceWidth`, `niceBoost`, `niceBreak` unused and no release-angle input; the
pitch decision needs a hold field. Steering: no post-release lateral input exists; the swing side
already carries `charged`, the pitch side needs a steer stream sampled during `timeToPlateS`. Input
timing: the UI must map the release timestamp to `timingErrorMs` through `swingDelay` and
`inputOffset`, tested with synthetic taps. Flight path: `flyPitch` returns only the final `x`; the
drawn path from aim to `x` with the slider's late break is presentation, and the engine's `x` is the
truth. The overhead flight: `atBatEnd` carries `sprayAngleDeg` and `distanceFt`, which is exactly the
landing point; the dotted trail is drawn from those two numbers. Readout: the mph table is by league
only; the Nice and skill push on the number is unwired. Steal, bunt, pickoff: locked as tap, mechanics
open, so the slots are drawn and disabled until the engine has them.

## 15. Deliberately open, and who decides

| Item | Proposed default in this spec | Decides |
|---|---|---|
| Where the forfeit button lives | The hub back button during a career game opens the forfeit confirm; no button on the play screen | Matt |
| Hold and release before the Nice zone | A normal pitch | Matt, after playtest |
| The pad's two jobs (aim, then steer) | One pad, an arrow appears at release | Matt |
| Wind-up length | Fixed 1400 ms every pitch | Matt, after playtest |
| Pitch strip in the batting state | The at-bat strip (last eight pitches) | Matt |
| Trophy shape | Cup with one, two or three bands | Matt |
| A shifted sector's painted fielder not moving with it | Accepted for v1 | Matt, if it ever reads wrong in play |
| Exact field sizes and zone sizes per league | Draw from `FIELD` and `zonesFor` as shipped | Open item 7, tuning phase |
| Majors park shapes | Draw the five-point fence as shipped, no ivy or porch features in v1 | Open item 11 |
| Timing popup wording | Early / Late / Perfect with shapes | Open item 1, Matt |
| Between-innings beat content | Line 1 text only | Matt |

## 16. What this spec does not specify

Tuning numbers, CPU behaviour, point yields, the schedule shape, the career store's internals, the
leaderboard metric (all locked or open elsewhere), sound (none in v1), and any screen for the admin
page. Nothing here changes a frozen key, a stored counter, or the engine's snapshot.

## Mock order

Play screen in the batting state at the tall phone; the same frame at the short phone; the pitching
state in the same frame (a mock that moves anything between those two fails); the overhead result
view in the same frame; one sheet of the Swing/Throw button in all its states; career home in all four
sync states; the how-to sheet; the game-end modal. Everything else reuses primitives.
