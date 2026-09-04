// golf/js/swing.js - the three-tap swing: the power ring, the accuracy bar, and the mishit model.
// PURE and DOM-free (it is driven by a clock the caller owns), so golf/js/test.js can step it.
//
// This is the single most important mechanic in the game and the one a coarse reading of the
// reference gets wrong, so the measured facts are written down beside the code that implements
// them (golf-reference-spec.md §5, §6, §8, §17.9):
//
//  - The meter is STATIC until tap 1. Over a 24 s idle stretch the marker does not move. [MEASURED]
//  - It reaches 100 % in ~0.75 s. [MEASURED]
//  - It then REVERSES and sweeps back down: a ping-pong, not a one-way fill that stops at the top.
//    [MEASURED, frame by frame at 15 and 20 fps] A mistimed tap therefore gives you a LOW reading
//    rather than a maximum one, and waiting one more cycle costs nothing - which is what makes the
//    meter forgiving in a way a one-way fill is not.
//  - The accuracy window does NOT narrow as power rises. Measured directly: the green pixel count
//    is pinned for the entire power sweep. Do not implement it. (The band DOES narrow on a bad
//    LIE - a different cause, and that one is real: clubs.js's LIES.zone.)
//  - The two meters run in SEPARATE PHASES: while the accuracy line sweeps, the power tick sits
//    parked where it was locked. [MEASURED]
//  - Input is locked for ~1.4 s after every shot, which stops a double-tap queuing a second swing.

/** The arc runs 0 to 110 %, not 0 to 100: the tick's travel continues past the green segment into
 *  the over-swing block, which is what makes over-100 reachable at all. RING_UP_MS is set so that
 *  reaching 100 % takes exactly the MEASURED 750 ms; the full sweep and the 1.65 s cycle fall out
 *  of that. (An earlier draft of the spec called the cycle 1.4 s and a later one 1.5 s, both
 *  INFERRED from the same 0.75 s. The measured number is the one that is honoured here.) */
export const RING_MAX = 1.10;
export const RING_UP_MS = 825;                     // 825 ms to the top; exactly 750 ms to 100 %
export const RING_CYCLE_MS = 1650;                 // up and back

/** The accuracy marker's own ping-pong. Not separately measured; the reference's tap 2 -> tap 3 gap
 *  was 1.04 s, so a cycle a shade longer than that gives a player about one full pass to read. */
export const BAR_CYCLE_MS = 1100;

/** Input is dead for this long after the ball is struck. [MEASURED: 1.33-1.54 s across three shots] */
export const LOCK_MS = 1400;

export const PHASE = { IDLE: 'idle', POWER: 'power', ACCURACY: 'accuracy', LIVE: 'live', LOCKED: 'locked' };

/** Where the power tick sits, 0..RING_MAX, `ms` after tap 1. Ping-pong. */
export function ringAt(ms) {
  const t = ((ms % RING_CYCLE_MS) + RING_CYCLE_MS) % RING_CYCLE_MS;
  const up = t <= RING_UP_MS;
  return (up ? t / RING_UP_MS : (RING_CYCLE_MS - t) / RING_UP_MS) * RING_MAX;
}

/** Where the accuracy marker sits, 0..1 across the bar, `ms` after tap 2. Ping-pong off both ends.
 *  It starts at the CENTRE and moves right: starting at an end would make the first pass through
 *  the green band arrive at a moment the player has not been given time to read. */
export function barAt(ms) {
  // The quarter-cycle offset is what puts the marker at the CENTRE at ms = 0, moving right:
  // centre -> right -> centre -> left -> centre. Starting it at an end instead would send it
  // through the green band before the player has had a moment to read the bar.
  const u = ((ms / BAR_CYCLE_MS + 0.25) % 1 + 1) % 1;
  return u < 0.5 ? u * 2 : (1 - u) * 2;
}

/** THE ACCURACY BANDS, as distance from the centre normalised to 0..1 (`off`).
 *
 *  At a clean lie: green is the middle 40 % of the bar, orange the next 20 % each side, red the
 *  outer 10 % each side - which is 40 + 20 + 20 + 10 + 10 = 100 % (an earlier draft of the spec
 *  used 40/30/15, summing to 130 %, which cannot be laid out).
 *
 *  A bad lie narrows the GREEN band by `zone`; orange and red then split what is left in the same
 *  2:1 ratio they have at baseline, so the bar is always full and the marker always sweeps at the
 *  same speed. A smaller target is simply harder to hit, and the player can SEE that before
 *  committing to the shot. */
export function bandsFor(zone = 1) {
  const green = 0.4 * zone;
  const rest = 1 - green;
  return { green, orange: green + (rest * 2) / 3, red: 1 };
}

/** The mishit (§17.9, ours - every shot in all five clips was struck cleanly, so the penalty was
 *  never observed). Returns { deg, distanceMul }.
 *
 *  Marker LEFT of centre pulls the ball left; right pushes it right. Over-100 % power multiplies
 *  the resulting angle by 1.5, which is what makes over-swinging risky and matches the tutorial's
 *  own warning. At the stock driver's 215 yds a full red miss (8 deg) lands about 30 yds offline:
 *  punishing, recoverable, not round-ending. */
export function mishit(barPos, power, zone = 1) {
  const signed = (barPos - 0.5) * 2;                 // -1 left .. +1 right
  const off = Math.min(1, Math.abs(signed));
  const b = bandsFor(zone);
  let deg;
  let distanceMul = 1;
  if (off <= b.green) {
    deg = (off / b.green) * 1.5;
  } else if (off <= b.orange) {
    deg = 1.5 + ((off - b.green) / (b.orange - b.green)) * 2.5;
  } else {
    deg = 4 + ((off - b.orange) / Math.max(1e-6, b.red - b.orange)) * 4;
    distanceMul = 0.9;                               // a red miss also loses 10 % of its distance
  }
  if (power > 1) deg *= 1.5;
  return { deg: deg * Math.sign(signed || 1), distanceMul };
}

/** The three-tap state machine. The caller supplies `now` (ms) so this is testable without a
 *  clock and cannot drift from whatever the render loop is doing. */
export class Swing {
  constructor() { this.reset(); }

  reset() {
    this.phase = PHASE.IDLE;
    this.t0 = 0;
    this.power = 0;
    this.bar = 0.5;
    this.lockUntil = 0;
  }

  /** True while the player may not act: the ball is live, or the post-shot lock has not expired. */
  locked(now) { return this.phase === PHASE.LIVE || now < this.lockUntil; }

  /** One tap. Returns 'begin' | 'power' | 'fire' | null (null = the tap did nothing). */
  tap(now) {
    if (this.locked(now)) return null;
    if (this.phase === PHASE.IDLE) { this.phase = PHASE.POWER; this.t0 = now; return 'begin'; }
    if (this.phase === PHASE.POWER) {
      this.power = ringAt(now - this.t0);
      this.phase = PHASE.ACCURACY; this.t0 = now;
      return 'power';
    }
    if (this.phase === PHASE.ACCURACY) {
      this.bar = barAt(now - this.t0);
      this.phase = PHASE.LIVE;
      return 'fire';
    }
    return null;
  }

  /** What the meter should DRAW right now. The power tick parks where it was locked once the
   *  accuracy phase starts - the two meters never sweep at the same time. */
  read(now) {
    if (this.phase === PHASE.POWER) return { power: ringAt(now - this.t0), bar: 0.5, sweeping: 'power' };
    if (this.phase === PHASE.ACCURACY) return { power: this.power, bar: barAt(now - this.t0), sweeping: 'bar' };
    if (this.phase === PHASE.IDLE) return { power: 0, bar: 0.5, sweeping: null };
    return { power: this.power, bar: this.bar, sweeping: null };
  }

  /** Called when the ball comes to rest: the input lock runs from here. */
  settle(now) { this.phase = PHASE.IDLE; this.lockUntil = now + LOCK_MS; this.power = 0; this.bar = 0.5; }
}
