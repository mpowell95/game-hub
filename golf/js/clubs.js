// golf/js/clubs.js - the bag, the lie table, and the auto-pick. Pure and DOM-free.
//
// Every number here is from golf-reference-spec.md: the ladder is §21.3 (APPROVED by Matt), the
// lie table is §21.2. The reference's own MEASURED 287 yd drive is deliberately NOT the stock
// number - it was recorded with an unknown, possibly upgraded bag and left no headroom for the
// club shop, and it made a 360 yd par 4 play as a drive and a wedge.

// The swing's ONE tempo lives in swing.js; `swingTempo` below hands it to every club alike.
import { UP_MS, DOWN_MS } from './swing.js';

/** THE STOCK BAG. `upgraded` is the fully-upgraded figure from §21.3, carried here so the ladder
 *  visibly has somewhere to go; NOTHING in this build reads it. The shop is deferred, and the two
 *  intermediate tiers are deliberately unspecified.
 *
 *  `carry` is CARRY, not total: roll is added afterwards per surface (see shot.js). The five aim
 *  dots mark where the ball LANDS, so on a fairway the ball finishes slightly past dot 4.
 *
 *  `loft` (0..1) drives the flight's peak height, which is what decides whether a ball clears a
 *  tree canopy or meets its trunk. It is ours, not measured: a driver is the flattest thing in the
 *  bag and a lob wedge the steepest. */
export const CLUBS = [
  { id: 'driver', carry: 215, upgraded: 269, loft: 0.30 },
  { id: '3wood', carry: 195, upgraded: 244, loft: 0.36 },
  { id: '5wood', carry: 182, upgraded: 228, loft: 0.41 },
  { id: '2iron', carry: 175, upgraded: 219, loft: 0.45 },
  { id: '3iron', carry: 166, upgraded: 208, loft: 0.50 },
  { id: '4iron', carry: 157, upgraded: 196, loft: 0.55 },
  { id: '5iron', carry: 148, upgraded: 185, loft: 0.60 },
  { id: '6iron', carry: 139, upgraded: 174, loft: 0.65 },
  { id: '7iron', carry: 130, upgraded: 163, loft: 0.70 },
  { id: '8iron', carry: 120, upgraded: 150, loft: 0.75 },
  { id: '9iron', carry: 110, upgraded: 138, loft: 0.80 },
  { id: 'pwedge', carry: 95, upgraded: 119, loft: 0.86 },
  { id: 'swedge', carry: 72, upgraded: 90, loft: 0.92 },
  { id: 'lwedge', carry: 50, upgraded: 63, loft: 1.00 },
];

/** The putter is deliberately absent from the ladder above: it is measured in FEET, not yards, and
 *  a club with a yardage would sort into a bag it does not belong in. 60 ft at full power is ours;
 *  the reference never showed a putter's range. */
export const PUTTER = { id: 'putter', maxFeet: 60 };

export function clubById(id) {
  return id === 'putter' ? PUTTER : CLUBS.find((c) => c.id === id);
}

/** THE LIE TABLE (§21.2). Every bad lie does two things: it caps distance, and it narrows the
 *  margin for error. Both are shown to the player before they swing.
 *
 *  `power` SCALES THE RESULT - it does not clamp the meter. The player can still swing to 100 %
 *  and past it from a bunker; the ball simply travels 88 % as far, and the aim dots scale by the
 *  same factor so they keep telling the truth.
 *
 *  `zone` is the straight-zone WIDTH as a multiplier on the accuracy bar's green band. The band
 *  visibly narrows (Matt's call): the alternative - leaving it looking normal while secretly
 *  punishing the same stop position harder - reads as the game cheating.
 *
 *  The design principle: SAND COSTS CONTROL, NOT DISTANCE. A real bunker shot is not short, it is
 *  unpredictable. Heavy rough is the opposite - it genuinely eats distance.
 *
 *  ============================================================================================
 *  `zone` WAS RESCALED HARD ON 2026-09-04, and only TWO of these numbers are measured.
 *
 *  Four clips of one whole hole of the reference were read frame by frame at 60 fps and the
 *  accuracy bar's colour bands counted in pixels, at the moment of address, on four different
 *  lies. The bar is 66 px per half either side of the needle. What came back:
 *
 *      tee / green     red 18   orange 12   green 36     ->  green = 54.5 % of the half
 *      rough / bunker  red 42   orange 18   green  6     ->  green =  9.1 % of the half
 *
 *  Rough and greenside bunker measured BYTE-IDENTICAL, and the same bar was still there while the
 *  player cycled s. wedge -> p. wedge -> 9 iron -> 8 iron -> 7 iron, so the bands are set by the
 *  LIE and not by the club. (The one exception found: switching to the PUTTER from the rough
 *  widened green to 22 %.) Verified visually as well as numerically - from the bunker the green
 *  band really is a two-pixel sliver either side of the centre line, with red filling the bar.
 *
 *  So the reference's bad lie is roughly SIX TIMES harsher than ours was: our worst lie gave 27 %
 *  of the half as green, its rough gives 9 %. The design that falls out of it is real and worth
 *  having: FROM A BAD LIE YOU ARE NOT TRYING TO STRIKE IT PURE, YOU ARE TRYING TO AVOID RED.
 *  Measured on the reference's own shots, the green band from a bad lie is about one frame wide
 *  and the orange band about four - and the player duly took orange from the rough (a fine 196 yd
 *  3 wood) and red from the bunker (a 7 iron that went 21 yds).
 *
 *  `greensideBunker: 0.167` is the measured value: 0.545 x 0.167 = 9.1 %.
 *  `tee` / `fairway` / `green` = 1.00 is the other measured value.
 *  EVERYTHING BETWEEN THEM IS OURS. The reference's rough measured the same as its bunker, and
 *  four shots could not tell light rough from heavy, so the gradient our seven lies need was kept
 *  rather than flattened - it just now lives between 0.167 and 0.80 instead of 0.50 and 0.94.
 *  If this proves too punishing in a playtest, these are the numbers to raise; nothing else needs
 *  to move with them.
 *  ============================================================================================ */
export const LIES = {
  // BACK ON SPEC (2026-09-10). `golf-reference-spec.md` §21.3's decisions say, in the same breath
  // as the approved club ladder: **"Roll after landing: fairway ~8 % of carry, green ~2 %, rough
  // ~3 %, bunker 0."** This row said 0.145, and `rollFactor` then multiplies it by the club's loft
  // term (1.24 for the driver), so a drive ran out **18 % of its carry - 39 yds** and a clean 100 %
  // swing finished 254 yds from the tee against the 232 the approved numbers give. Matt, on a
  // player's 293 yd drive: *"we agreed on a table with precise and specific numbers for each club.
  // And you just completely ignored that?"* He had: the spec is dated 2026-09-03 and this number
  // was never his.
  //
  // The change was not even justified by its own reasoning - `shot.js`'s rollout comment argues for
  // a driver rollout of **17 yds**, which IS the approved 8 %, while the number here delivered 39.
  //
  // 0.0645 x the driver's 1.24 loft term = 0.080 exactly. Shorter clubs roll less, as they did.
  // Every other surface is LEFT ALONE: the green (0.090) and the collar were each raised later, by
  // Matt, against measured scoring, and those decisions stand over the spec's original 2 %.
  tee: { power: 1.00, zone: 1.00, roll: 0.0645 },
  fairway: { power: 1.00, zone: 1.00, roll: 0.0645 },
  // The collar around every green. Added 2026-09-04 after Matt's playtest: hole 1's light-rough
  // corridor stopped short of the green, so a missed green landed in `base` - HEAVY ROUGH, the
  // harshest lie in the game (82 % power, 65 % band) - on all four sides. Every real course has a
  // collar, and missing a green by a yard should not be the same as being in the trees.
  // The collar rolls a shade more than it did (0.072 -> 0.075), only so that it stays BETWEEN the
  // green and the rough after the green was raised below. The ordering is the thing being kept.
  fringe: { power: 0.97, zone: 0.80, roll: 0.075 },
  lightRough: { power: 0.92, zone: 0.22, roll: 0.054 },
  heavyRough: { power: 0.82, zone: 0.17, roll: 0.054 },
  // SAND NO LONGER STOPS A BALL DEAD 100 % OF THE TIME (2026-09-12). Matt: *"If a shot lands in a
  // bunker - a tee shot with driver especially, and it lands on just the edge, it shouldn't just
  // stop. It should roll still and possibly roll out depending on the shot. But having it stop in
  // the sand 100% of the time doesn't feel realistic."*
  //
  // The zero was deliberate and its reasoning was half right - a high wedge dropping into a
  // greenside bunker genuinely does plug. What it got wrong is that `roll: 0.00` is not a rule
  // about wedges, it is a rule about SAND: it applied identically to a driver clipping the edge at
  // 215 yds and to a lob wedge falling in from 60.
  //
  // THE SPLIT NEEDS NO NEW MACHINERY, WHICH IS WHY IT IS TWO NUMBERS AND NOT A NEW BRANCH.
  // `rollFactor` below is already `surface x (1.6 - 1.2 * loft)` and the roll it returns is
  // multiplied by CARRY - so how steeply the ball arrives (a driver descends at 27 deg, a lob
  // wedge at 58) and how fast it arrives are both already in the formula. A "steep arrivals plug,
  // shallow ones skid" threshold would be a second, discontinuous copy of a thing the engine
  // already does smoothly. Nothing random was added; nothing about the swing moved.
  //
  // Run-out after LANDING in sand, full swing, at these values (fairway is 0.0645 for scale):
  //
  //      driver 215 yd, 27 deg descent   8.0 yd fairway bunker   4.8 greenside
  //      5 iron 148 yd, 40 deg           3.9                     2.3
  //      p wedge 95 yd, 52 deg           1.6                     1.0
  //      l wedge  50 yd, 58 deg          0.6                     0.4
  //
  // Pine Valley's fairway bunkers are r 6-8 yd, so 12-16 yds across: a driver that catches the
  // edge runs 8 yds and can get out, the same driver in the middle cannot, and a wedge dropping in
  // still plugs at well under a yard. That is the "possibly, depending on the shot" he asked for.
  //
  // The GREENSIDE number is the lower of the two because that sand is softer, deeper and raked,
  // and because the shots that reach it are the steep ones - it must never become a surface an
  // approach runs THROUGH.
  //
  // The TIMING needed no change: sand's `PUTT_DRAG` is 6.00 against the fairway's 1.90, so
  // `rollMs` gives an 8 yd run-out 1.1 s. It reads as a skid, which is what it is. `groundPoint`'s
  // `noHop` list is also untouched on purpose - sand does not bounce a ball, it runs it.
  fairwayBunker: { power: 0.88, zone: 0.19, roll: 0.030 },
  greensideBunker: { power: 0.75, zone: 0.167, roll: 0.018 },   // zone MEASURED
  trees: { power: 0.85, zone: 0.20, roll: 0.054 },
  // THE GREEN USED TO BE THE SLOWEST SURFACE IN THE GAME, AT 0.036 (raised 2026-09-08).
  //
  // Matt: *"Balls don't run out or bounce much on the green. Is this intentional?"* It was not.
  // The green's `roll` sat BELOW the fringe's (0.072) and below both roughs (0.054), so a ball
  // pitching on the putting surface stopped faster than one pitching in the cabbage - while
  // `PUTT_DRAG` over in shot.js, which that file says is deliberately shared so that "a surface
  // cannot be fast for a putt and slow for a run-out", makes the green the FASTEST thing on the
  // course (1.00 against the fairway's 1.90). The two tables disagreed, and the green was the only
  // row they disagreed about.
  //
  // It is also a large part of the answer to *"I just played through all of Pine Valley and got a
  // birdie on every single hole."* An approach that stops dead where it lands turns a green into a
  // target that cannot be run through, so reaching one was worth a birdie and no hole design could
  // change that. Measured over 40 rounds of Pine Valley, same seeds, only this number moving:
  //
  //      green.roll        0.036    0.070    0.090    0.110    0.150
  //      good player       -1.6     +0.1      -       +2.2     +3.9
  //      expert player     -6.2     -3.8      -       -1.1     +0.6
  //
  // 0.090 is 62 % of the fairway's 0.145: a green is short-cut and runs, but it is also softer than
  // a summer fairway and takes more out of the bounce, so it is not simply the faster of the two. A
  // 7 iron now releases about 9 yds on a green 20-30 yds deep, so an approach has to be landed
  // short of the pin rather than at it - and `aimDots` shows CARRY, so that is a thing to learn.
  //
  // `golf/js/test.js` section 19 pins the ORDERING (green > fringe > rough, and PUTT_DRAG agreeing)
  // rather than the value, so this can be retuned without the inversion coming back.
  green: { power: 1.00, zone: 1.00, roll: 0.090 },
  water: { power: 1.00, zone: 1.00, roll: 0.00 },   // never actually played from; see Stage C
};

export function lieOf(kind) { return LIES[kind] || LIES.fairway; }

/** Surfaces where the putter is the ONLY club offered: the green and its collar. This is the
 *  strong form - it drives the auto-pick, it locks the club ladder, and it is what the camera
 *  zooms for.
 *
 *  It used to be called `isPuttable` and it gated all of that AND "may the player select a
 *  putter at all", which conflated two different questions. Matt, 2026-09-04: "You should make
 *  the putter available when on the fairway and fringe. Not the rough. But long putts from off
 *  the green (from the fairway or fringe) should be possible." A fairway lie must OFFER the
 *  putter without FORCING it, so the two questions are now two functions. */
export function mustPutt(kind) { return kind === 'green' || kind === 'fringe'; }

/** Surfaces the putter may be CHOSEN from: the above, plus the fairway and the tee. Grass short
 *  enough that a putt rolls. Never from rough, sand or trees - the ball would not go anywhere,
 *  and offering a club that cannot work is worse than not offering it. */
export function canPutt(kind) {
  return mustPutt(kind) || kind === 'fairway' || kind === 'tee';
}

/** @deprecated the old name for `mustPutt`, kept so nothing outside this file breaks silently. */
export const isPuttable = mustPutt;

/** How far a full-power putt runs, in feet. MUST match shot.js's MAX_PUTT_FT - test.js asserts it,
 *  because the two files cannot import each other (shot.js already imports this one). */
export const PUTTER_REACH_FT = 60;

/** Where the putter is the ONLY club: the putting surface itself.
 *
 *  NOT the fringe, since 2026-09-07. `mustPutt` covers the collar too - that is right for which
 *  club to HAND the player - but it was also used to lock the club buttons, and a ball on the
 *  fringe can be further from the hole than a putter can reach. Measured over 40 rounds of Pine
 *  Valley: eight lies on the collar 60-67 ft from the cup, where the only club offered could not
 *  get there however perfectly it was struck. A forced two-putt from the fringe is not a golf
 *  problem, it is a bag problem. On the green itself the putter stays the only option, which is
 *  both real and what keeps the green simple. */
export function lockedToPutter(kind) { return kind === 'green'; }

/** ROLL after landing, as a fraction of carry: the surface the ball comes down ON, times how
 *  FLAT the club sends it in.
 *
 *  Matt, 2026-09-04: "the ball rolls a tiny bit after landing, but still not much. It stops
 *  unnaturally short." The surface term alone gave every club the same 8 % of its carry, so a
 *  driver ran 17 yds (real: 20-25) while a lob wedge ran 4 (real: about 1) - nothing in the bag
 *  behaved like itself. Descent angle is the missing half: a driver arrives shallow and runs, a
 *  wedge drops almost vertically and sits. `loft` is already the flight's steepness parameter, so
 *  the multiplier falls straight out of it - no new field, no new tuning surface.
 *
 *  THE SURFACE TERM WAS RAISED 0.08 -> 0.145 ON 2026-09-04, from a measurement.
 *
 *  Four clips of one whole hole of the reference give a shot whose arithmetic is decisive. Shot 2
 *  was a 3 wood from 253.2 yds out; the ring's hub read 196.0 for it; the ball finished 25.0 yds
 *  from the pin. A ball that ends 25.0 from the pin having started 253.2 from it MUST have
 *  travelled at least 253.2 - 25.0 = 228.2 yds, whatever direction it took. 196.0 is less than
 *  that, so 196.0 cannot be the ball's total travel - it is the CARRY, and the ball ran at least
 *  228.2 - 196.0 = 32.2 yds after it came down. That is >= 16.4 % of carry against our 9.3 %.
 *
 *  (The clip is called "Shot 2 - bounce into sand", and that run-out is exactly what it shows:
 *  the ball pitches on grass, bounces, and finishes in a greenside bunker.)
 *
 *  Sighting shots on a fairway now: driver 38.7 yds (total 254), 3 wood 33 (228), 5 iron 19 (167),
 *  9 iron 11 (121), lob wedge 2.9 (53). Longer than real golf, which is correct - the reference is
 *  not simulating real golf, and this is the number its own footage gives.
 *
 *  ONE THING PULLS THE OTHER WAY AND IS RECORDED HERE RATHER THAN AVERAGED AWAY: shot 1 (driver,
 *  hub 247.0) moved the player 246.0 yds closer to the pin, which leaves no room for a run-out
 *  unless the hole doglegs enough for the path to differ from the straight line. It plainly does
 *  dogleg, but that cannot be measured from the footage, so shot 2 - whose arithmetic needs no
 *  assumption at all - is the one this number comes from. */
export function rollFactor(kind, club) {
  const surface = lieOf(kind).roll;
  if (!club || !Number.isFinite(club.loft)) return surface;
  return surface * (1.6 - 1.2 * club.loft);
}

/** THE SWING'S TEMPO. ONE SPEED FOR THE WHOLE BAG.
 *
 *  REVERTED 2026-09-05, ON MATT'S INSTRUCTION. Between 2026-09-04 and now this returned a
 *  DIFFERENT speed per club, and that was a change nobody asked for: *"I did NOT instruct you to
 *  change anything about tempo. I specifically stated to fix the width of the green zone in the
 *  aim/power meter."*
 *
 *  It came out of the measuring pass rather than out of the playtest list. The needle was tracked
 *  frame by frame across four reference shots and it ran at 2.18 deg/frame for a driver, 2.20 for a
 *  3 wood, 1.78 for a 7 iron and 1.53 for the putter - so the reference's meter really is not one
 *  speed, and that measurement stands. It is recorded here rather than deleted, because the next
 *  session to watch that footage will find it again and should know it was a deliberate decision
 *  not to ship it.
 *
 *  WHAT IT ACTUALLY DID IN PLAY, which is the part that made it the wrong change to make
 *  unprompted: the driver's meter stayed about where it was and the SHORT clubs and the PUTTER got
 *  slower. So the half of the bag that was already easiest got easier, which is the opposite end
 *  from the complaint on the list ("Driver off the fairway shouldn't be super easy to hit"). That
 *  complaint is about the GREEN ZONE'S WIDTH, and it is answered by `swingZone` below.
 *
 *  The single speed is `swing.js`'s UP_MS / DOWN_MS. */
/** ONE TEMPO. STILL ONE TEMPO. It was made per-club for the putter on 2026-09-06 (to move a short
 *  putt's tap out of iOS's double-tap window) and Matt reverted it the same day, for the second
 *  time: *"You also fucked up the power/aim meter while putting BIG TIME. REVERT."*
 *
 *  The measurement behind the attempt still stands and is worth keeping: a 2 ft putt holes for
 *  8.4-25.9 % of the meter, which at 1585 ms per power unit is a second tap 132-411 ms after the
 *  first - fast enough that iOS takes the gesture. That problem is real and is still open. What is
 *  now twice established is that TEMPO IS NOT THE LEVER: it is the one thing in this game a player
 *  builds a rhythm against, and changing it for one club breaks that. Fix the short putt somewhere
 *  else. */
/** THE PUTTER'S DEAD ZONE: the needle holds at zero for this long after the first tap, then climbs
 *  at exactly the same speed as every other club.
 *
 *  The problem, measured through the real resolver rather than estimated: a 2 ft putt holes for
 *  8.4-25.9 % of the meter, which at 1585 ms per power unit is a second tap **132-411 ms** after
 *  the first. A second tap that fast is iOS's select-a-word gesture, so the OS takes it and shows
 *  the copy bar - Matt: *"Short putts are hard to hit correctly because the meter doesn't let you
 *  hit it that soft. If you tap that fast it selects something to copy."*
 *
 *  Two fixes were tried on 2026-09-06 and BOTH were reverted by Matt within hours: a steeper
 *  `PUTT_GAMMA` (it also moves the dial's 25/50/75/100 ticks - *"you fucked up the power/aim meter
 *  while putting BIG TIME"*) and a slower putter backswing (tempo is one speed for the whole bag,
 *  twice established). So the constraint on any third attempt was explicit: leave the dial and the
 *  tempo alone.
 *
 *  A dead zone does. Every tick stays where it is, the needle sweeps at the same rate, the power
 *  curve is unchanged, and the other fourteen clubs never see it - the ONLY thing that moves is
 *  when the climb starts, which slides every putt's window later by a fixed 250 ms. */
export const PUTTER_DEAD_MS = 250;
export function swingTempo(club) {
  return {
    upMs: UP_MS,
    downMs: DOWN_MS,
    deadMs: (club && club.id === 'putter') ? PUTTER_DEAD_MS : 0,
  };
}

/** HOW WIDE THE GREEN ZONE IS FOR THIS CLUB, as a multiplier on the accuracy band.
 *
 *  Matt, from the playtest list: *"You haven't paid attention to how the power/aim bars change size
 *  depending on the club. Driver off the fairway shouldn't be super easy to hit."*
 *
 *  A longer club is harder to strike cleanly, and until now nothing in the game said so: the band
 *  was a function of the LIE alone, so a driver off a fairway was exactly as forgiving as a lob
 *  wedge off the same fairway. It runs from `ZONE_DRIVER` at the top of the bag to 1.00 at the
 *  bottom, linearly by index, and the putter gets the full band.
 *
 *  THE NUMBERS ARE DECIDED, NOT MEASURED, AND THE MEASUREMENT POINTS THE OTHER WAY - which is worth
 *  writing down rather than burying. Four reference shots were read at 60 fps: a driver off a tee
 *  and a putter on a green both measured 54.5 % green, and a 3 wood from rough and a 7 iron from a
 *  bunker both measured 9.1 % - byte-identical within each pair, across very different clubs. On
 *  that evidence the reference's band tracks the lie and not the club. Matt asked for it anyway,
 *  having been told; it is his game and this is a better rule than the reference's. Recorded so the
 *  next session does not "fix" it back.
 *
 *  It multiplies the LIE's zone rather than replacing it, and it deliberately does NOT touch the
 *  orange band - orange's job is that a bad lie stays hittable, which is a property of the lie. */
/** THREE TIERS, NOT A FOURTEEN-STEP RAMP (2026-09-06).
 *
 *  The first version ran linearly by index from 0.72 to 1.00, which is a 2.2 % step per club.
 *  Matt, having cycled the entire bag on one lie and filmed it: *"they were ALL equally difficult
 *  (or easy) to hit... at a minimum, 1 difficulty setting for the driver and woods, another for
 *  irons, and a third for the wedges."*
 *
 *  He is right, and the pixels prove it. Measured off that video, the accuracy bar's green band was
 *  0 px wide for EVERY club - driver 0/29/71 green/orange/red, lob wedge 0/31/70, within one pixel
 *  of each other. A 0.72-to-1.00 ramp is 8.5 px against 11.9 px on that bar, and the needle drawn
 *  over the middle of it is 6 px. There was nothing to see. */
export const ZONE_WOODS = 0.62;
export const ZONE_IRONS = 0.80;
export const ZONE_WEDGES = 1.00;

/** Which tier a club is in: `woods` (driver, 3 wood, 5 wood), `irons` (2-9), `wedges` (p/s/l). */
export function clubTier(club) {
  if (!club || club.id === 'putter') return 'putter';
  if (club.id === 'driver' || /wood$/.test(club.id)) return 'woods';
  if (/wedge$/.test(club.id)) return 'wedges';
  return 'irons';
}

export function swingZone(club) {
  const tier = clubTier(club);
  if (tier === 'putter') return 1;
  if (tier === 'woods') return ZONE_WOODS;
  if (tier === 'irons') return ZONE_IRONS;
  return ZONE_WEDGES;
}

/** THE SMALLEST GREEN BAND A TIER MAY EVER BE SHOWN AS, as a fraction of the accuracy bar.
 *
 *  On a clean lie the measured numbers stand untouched (`0.545 * zone * clubZone`). The floor only
 *  ever lifts a band that has COLLAPSED, and every lie but tee/fairway/green collapses: `LIES.zone`
 *  is 0.167-0.22 for rough, sand and trees, so a driver's green band came out at 8.6 % of the bar -
 *  a 0.8-frame half-window at 60 fps, about 8 device px, underneath a 6 px needle. That is not a
 *  hard target, it is an invisible one, and it made all fourteen clubs identical.
 *
 *  IT IS PER TIER RATHER THAN ONE NUMBER, which is the whole point: a single floor would clamp all
 *  three tiers to the same value on exactly the lies where they were already indistinguishable, and
 *  re-create the bug it exists to fix. Orange is untouched and still keyed on the lie alone, so a
 *  bad lie is still about avoiding red - it just has a target you can see while you do it. */
export const GREEN_FLOOR = { woods: 0.16, irons: 0.21, wedges: 0.26, putter: 0.26 };

/** Auto-pick a club for the shot in hand (§10.2: the game offers one after every shot, and the
 *  player overrides with ^ / v). On the green it is always the putter - no other club is offered,
 *  because no other club is the right answer.
 *
 *  Off the green it picks the shortest club that can still REACH at full power from this lie,
 *  which is what a golfer does: take enough club, not the most club. If nothing reaches, it hands
 *  over the driver and the player swings for as much as they can get. */
export function autoSelectClub(distanceYd, lieKind) {
  // THE PUTTER IS OFFERED FROM THE COLLAR TOO, not only from the putting surface. Without this a
  // ball two feet off the green is handed the shortest club in the bag - a lob wedge, 50 yds - and
  // blasted clean over the green. Real golfers putt from the fringe; so does this.
  // ...but only while the cup is inside the putter's range. Beyond that the collar gets a club
  // that can actually reach it (see lockedToPutter above).
  if (mustPutt(lieKind) && (lockedToPutter(lieKind) || distanceYd * 3 <= PUTTER_REACH_FT * 0.92)) return PUTTER;
  const reach = lieOf(lieKind).power;
  for (let i = CLUBS.length - 1; i >= 0; i--) {
    if (CLUBS[i].carry * reach >= distanceYd) return CLUBS[i];
  }
  return CLUBS[0];
}

/** Cycle the bag. `dir` +1 is MORE club (further), -1 is less.
 *
 *  `lieKind` decides whether the putter is IN the ladder. Where `mustPutt` holds it is the only
 *  club and the ladder does not move at all; where `canPutt` holds but `mustPutt` does not (the
 *  fairway, the tee) the putter sits at the SHORT end, one step past the lob wedge, so a long
 *  putt from the fairway is reachable by the same two buttons as every other club. Anywhere
 *  else it is absent.
 *
 *  THE LADDER WRAPS. Matt: "if I press up all the way to driver, it should cycle back to the Lob
 *  Wedge. same for the other direction." It used to CLAMP at both ends, so the only way back from
 *  the driver was thirteen taps the other way - and holding the button just sat there doing
 *  nothing, which reads as broken rather than as a limit. */
export function stepClub(club, dir, lieKind) {
  if (lockedToPutter(lieKind)) return PUTTER;
  const ladder = canPutt(lieKind) ? [...CLUBS, PUTTER] : CLUBS;
  const n = ladder.length;
  let i = ladder.findIndex((c) => c.id === club.id);
  if (i < 0) i = n - 1;                       // holding a putter on a lie that just lost it
  return ladder[(((i - dir) % n) + n) % n];
}
