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
 *  unpredictable. Heavy rough is the opposite - it genuinely eats distance. */
export const LIES = {
  tee: { power: 1.00, zone: 1.00, roll: 0.08 },
  fairway: { power: 1.00, zone: 1.00, roll: 0.08 },
  lightRough: { power: 0.92, zone: 0.85, roll: 0.03 },
  heavyRough: { power: 0.82, zone: 0.65, roll: 0.03 },
  fairwayBunker: { power: 0.88, zone: 0.55, roll: 0.00 },
  greensideBunker: { power: 0.75, zone: 0.50, roll: 0.00 },
  trees: { power: 0.85, zone: 0.80, roll: 0.03 },
  green: { power: 1.00, zone: 1.00, roll: 0.02 },
  water: { power: 1.00, zone: 1.00, roll: 0.00 },   // never actually played from; see Stage C
};

export function lieOf(kind) { return LIES[kind] || LIES.fairway; }

/** ROLL after landing, by the surface the ball comes down ON, as a fraction of carry (§20). */
export function rollFactor(kind) { return lieOf(kind).roll; }

/** Auto-pick a club for the shot in hand (§10.2: the game offers one after every shot, and the
 *  player overrides with ^ / v). On the green it is always the putter - no other club is offered,
 *  because no other club is the right answer.
 *
 *  Off the green it picks the shortest club that can still REACH at full power from this lie,
 *  which is what a golfer does: take enough club, not the most club. If nothing reaches, it hands
 *  over the driver and the player swings for as much as they can get. */
export function autoSelectClub(distanceYd, lieKind) {
  if (lieKind === 'green') return PUTTER;
  const reach = lieOf(lieKind).power;
  for (let i = CLUBS.length - 1; i >= 0; i--) {
    if (CLUBS[i].carry * reach >= distanceYd) return CLUBS[i];
  }
  return CLUBS[0];
}

/** Cycle the bag. `dir` +1 is MORE club (further), -1 is less. The putter is not in the cycle: it
 *  is on the green and nowhere else. */
export function stepClub(club, dir) {
  if (club.id === 'putter') return PUTTER;
  const i = CLUBS.findIndex((c) => c.id === club.id);
  return CLUBS[Math.min(CLUBS.length - 1, Math.max(0, i - dir))];
}
