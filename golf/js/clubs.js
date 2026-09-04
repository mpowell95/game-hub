// golf/js/clubs.js - the bag, the lie table, and the auto-pick. Pure and DOM-free.
//
// Every number here is from golf-reference-spec.md: the ladder is §21.3 (APPROVED by Matt), the
// lie table is §21.2. The reference's own MEASURED 287 yd drive is deliberately NOT the stock
// number - it was recorded with an unknown, possibly upgraded bag and left no headroom for the
// club shop, and it made a 360 yd par 4 play as a drive and a wedge.

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
  tee: { power: 1.00, zone: 1.00, roll: 0.145 },
  fairway: { power: 1.00, zone: 1.00, roll: 0.145 },
  // The collar around every green. Added 2026-09-04 after Matt's playtest: hole 1's light-rough
  // corridor stopped short of the green, so a missed green landed in `base` - HEAVY ROUGH, the
  // harshest lie in the game (82 % power, 65 % band) - on all four sides. Every real course has a
  // collar, and missing a green by a yard should not be the same as being in the trees.
  fringe: { power: 0.97, zone: 0.80, roll: 0.072 },
  lightRough: { power: 0.92, zone: 0.22, roll: 0.054 },
  heavyRough: { power: 0.82, zone: 0.17, roll: 0.054 },
  fairwayBunker: { power: 0.88, zone: 0.19, roll: 0.00 },
  greensideBunker: { power: 0.75, zone: 0.167, roll: 0.00 },   // zone MEASURED
  trees: { power: 0.85, zone: 0.20, roll: 0.054 },
  green: { power: 1.00, zone: 1.00, roll: 0.036 },
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

/** THE SWING'S TEMPO, PER CLUB: how long the needle takes to cross one full power unit.
 *
 *  MEASURED (2026-09-04), by tracking the needle's angle in every frame of four shots at 60 fps.
 *  The arc is 221 degrees wide from zero to 100 %, so a rate in degrees per frame converts
 *  straight into milliseconds per power unit:
 *
 *      club              backswing        downswing       0 -> 100 %     100 % -> 0
 *      driver (tee)      2.176 deg/f      3.220 deg/f     1693 ms        1144 ms
 *      3 wood (rough)    2.195            3.271           1678           1126
 *      7 iron (bunker)   1.782            2.432           2070           1530
 *      putter (green)    1.528            1.923           2410           1923
 *
 *  THE METER IS NOT ONE SPEED. Ours was a fixed 1650 / 1150 for everything, which is right for the
 *  woods and roughly 20 % too fast for the short game - the half of the bag where a player most
 *  needs the control. The driver and the 3 wood measured IDENTICAL despite one being off a tee and
 *  the other out of rough, which is what rules the LIE out as the cause and leaves the CLUB.
 *
 *  Two regularities carry the fit, and both hold across all four samples:
 *    - the downswing is the backswing MINUS ABOUT 545 ms, not a fixed multiple of it
 *      (measured offsets: 549, 552, 540, 487);
 *    - the backswing is flat across the top of the bag and then slows one step at a time.
 *
 *  So: `1685 + max(0, index - 1) * 55`, which reproduces driver 1685 (meas 1693), 3 wood 1685
 *  (1678) and 7 iron 2070 (2070 exactly), and extrapolates to 2345 for the lob wedge. The putter
 *  is its own constant, 2410, straight off the one putt in the footage. */
export const TEMPO_BASE_MS = 1685;
export const TEMPO_STEP_MS = 55;
export const TEMPO_PUTTER_MS = 2410;
export const TEMPO_LAG_MS = 545;

export function swingTempo(club) {
  const i = club && club.id ? CLUBS.findIndex((c) => c.id === club.id) : 0;
  const upMs = i < 0 ? TEMPO_PUTTER_MS : TEMPO_BASE_MS + Math.max(0, i - 1) * TEMPO_STEP_MS;
  return { upMs, downMs: upMs - TEMPO_LAG_MS };
}

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
  if (mustPutt(lieKind)) return PUTTER;
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
  if (mustPutt(lieKind)) return PUTTER;
  const ladder = canPutt(lieKind) ? [...CLUBS, PUTTER] : CLUBS;
  const n = ladder.length;
  let i = ladder.findIndex((c) => c.id === club.id);
  if (i < 0) i = n - 1;                       // holding a putter on a lie that just lost it
  return ladder[(((i - dir) % n) + n) % n];
}
