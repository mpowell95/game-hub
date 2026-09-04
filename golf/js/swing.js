// golf/js/swing.js - THE SWING: one needle, three taps. PURE and DOM-free (it is driven by a
// clock the caller owns), so golf/js/test.js can step it.
//
// ============================================================================================
// THIS IS A REWRITE (2026-09-04). The old build had TWO meters - a power ring, then a separate
// accuracy bar with its own independent ping-pong - and that is not what the reference does.
// Matt filmed the reference's meter and ours side by side; both clips were measured frame by
// frame at 60 fps (201 and 203 frames), tracking the needle's angle and the bar's marker in
// every single frame. What came back:
//
//   frames   0-33    the needle is parked DEAD CENTRE IN THE ACCURACY BAR, at 89-90 deg
//   frames  33-127   it climbs the arc at 2.22 deg/frame - the backswing
//   frame  127       A MARKER IS PLANTED AT 297 deg AND STAYS THERE for the rest of the clip,
//                    and the needle REVERSES
//   frames 130-188   it runs back down at 3.24 deg/frame - 1.46x faster - the downswing
//   frames 188-201   it STOPS at 96 deg and holds: a small miss, right of centre
//
// And the clincher: the accuracy bar's marker position is a LINEAR FUNCTION of the needle's
// angle, with the same slope (-0.0175 per degree) on the way up and on the way down. It is not
// a second meter. IT IS THE SAME NEEDLE, and the bar is a MAGNIFIED VIEW of the last ~12 % of
// arc either side of zero, so the final tap can be judged finely. That is why the bar has to sit
// in the ring's mouth: it is the same scale, unrolled.
//
// So the mechanic is the classic three-click swing:
//   tap 1  start the backswing
//   tap 2  set POWER - a marker is planted where you stopped it, and the needle reverses
//   tap 3  set ACCURACY - stop the needle as close to zero as you can on the way back down
//
// Everything below is on ONE scale, `pos`, in power units:
//   pos =  0      the accuracy point: the bar's centre, zero power, a perfect strike
//   pos =  1      100 % power
//   pos =  SWING_MAX   the top of the over-swing block
//   pos in +/- BAR_HALF   the magnified window the accuracy bar shows
// ============================================================================================

/** The top of the arc. MEASURED: the over-swing block spans 311-337 deg on a 0-100 % scale of
 *  89-311 deg, so it is 26/222 = 11.7 % of full power. */
export const SWING_MAX = 1.12;

/** Half the accuracy window, in power units. MEASURED: the bar spans 61-115 deg against zero at
 *  89 deg, so -0.126 to +0.117. Symmetric here, because a miss either way should cost the same. */
export const BAR_HALF = 0.12;

/** THE DEFAULT TEMPO: milliseconds for the needle to travel one full power unit.
 *
 *  THIS IS NOW ONLY A DEFAULT. Measured 2026-09-04 across four shots at 60 fps, the reference's
 *  meter runs at a DIFFERENT SPEED FOR DIFFERENT CLUBS - driver and 3 wood at 1685/1140, a 7 iron
 *  at 2070/1530, the putter at 2410/1923. The per-club figures and the fit that produces them live
 *  in `clubs.js`'s `swingTempo()`, because they are a property of the club; these two constants are
 *  what a `Swing` uses when nobody has told it otherwise, and they are the top of the bag.
 *
 *  The downswing is FASTER than the backswing in every sample, which is a real part of the feel:
 *  you get time to pick your power and much less time to save the strike. */
export const UP_MS = 1685;
export const DOWN_MS = 1140;

/** Input is dead for this long after the ball is struck. [MEASURED: 1.33-1.54 s across three shots] */
export const LOCK_MS = 1400;

export const PHASE = {
  IDLE: 'idle',        // needle parked at zero, waiting for tap 1
  BACK: 'back',        // the backswing: needle climbing
  DOWN: 'down',        // the downswing: power locked, needle falling
  LIVE: 'live',        // struck; the ball is away
};

/** How long the backswing takes to reach the very top. Past this the swing has auto-topped out. */
export const TOP_MS = SWING_MAX * UP_MS;

/** How long the backswing takes to reach the top at a given tempo. */
export function topMsOf(upMs = UP_MS) { return SWING_MAX * upMs; }

/** Where the needle sits during the BACKSWING, `ms` after tap 1.
 *
 *  Past the top it does NOT ping-pong forever: the power is spent at SWING_MAX and the needle is
 *  already on its way back down. Holding too long is therefore a real decision with a real cost
 *  (a full over-swing, and its 1.5x mishit multiplier) rather than a free second lap. */
export function backswingAt(ms, tempo) {
  const up = tempo && tempo.upMs ? tempo.upMs : UP_MS;
  const down = tempo && tempo.downMs ? tempo.downMs : DOWN_MS;
  const top = SWING_MAX * up;
  if (ms <= top) return { pos: ms / up, power: null, topped: false };
  return { pos: SWING_MAX - (ms - top) / down, power: SWING_MAX, topped: true };
}

/** Where the needle sits during the DOWNSWING, `ms` after the power was locked at `power`. */
export function downswingAt(ms, power, tempo) {
  return power - ms / (tempo && tempo.downMs ? tempo.downMs : DOWN_MS);
}

/** The needle's position mapped onto the accuracy bar, 0 (left) .. 1 (right), 0.5 dead centre.
 *
 *  The needle enters the bar from the LEFT on the way down and travels right, so stopping it EARLY
 *  leaves it left of centre and stopping it LATE leaves it right. */
export function barPosOf(pos) {
  return Math.min(1, Math.max(0, 0.5 - pos / (2 * BAR_HALF)));
}

/** THE ACCURACY BANDS, as distance from the centre normalised to 0..1 (`off`).
 *
 *  MEASURED 2026-09-04 by counting pixels across the reference's own accuracy bar at address, on
 *  four different lies. The bar runs 66 px from the centre line to either end:
 *
 *      good lie (tee, green)     red 18   orange 12   green 36   ->  green 54.5 %, orange 18.2 %
 *      bad lie (rough, bunker)   red 42   orange 18   green  6   ->  green  9.1 %, orange 27.3 %
 *
 *  So the green band is scaled by the lie's `zone` (see clubs.js, where the two measured values
 *  live), and the ORANGE band widens as green shrinks rather than staying a fixed share of what is
 *  left: it takes 40 % of the remainder at a clean lie and 30 % at the worst one. That is the
 *  difference between a bad lie being merely harder and a bad lie being a coin flip - orange is
 *  where a player from the rough is actually aiming, and it has to stay hittable.
 *
 *  The bar is always full and the needle always sweeps at the same speed for a given club, so a
 *  smaller target is simply a smaller target, and the player can SEE it before committing. */
export function bandsFor(zone = 1) {
  const green = 0.545 * zone;
  const rest = 1 - green;
  const orangeShare = 0.30 + 0.10 * Math.min(1, Math.max(0, zone));
  return { green, orange: green + rest * orangeShare, red: 1 };
}

/** The mishit. Returns { deg, distanceMul }.
 *
 *  Marker LEFT of centre pulls the ball left; right pushes it right. Over-100 % power multiplies
 *  the resulting angle by 1.5, which is what makes over-swinging risky and matches the tutorial's
 *  own warning.
 *
 *  THE DISTANCE PENALTY WAS A FLAT 10 % IN THE RED BAND AND IS NOW A RAMP (2026-09-04). The
 *  reference's third shot is the evidence: a 7 iron from a greenside bunker, power locked at
 *  46.6 %, needle stopped 45 % out of the half-window - which on that lie's 9 % green band is
 *  RED - travelled 21.1 yds. Our numbers for the same swing gave about 41. A flat 0.9 cannot
 *  close a gap that size, and the direction is unambiguous: in the reference a red strike costs
 *  a LOT of distance, not a token amount.
 *
 *  IT IS A RAMP RATHER THAN THE MEASURED NUMBER, DELIBERATELY. Closing the gap entirely would
 *  need a multiplier near 0.45, but that single sample confounds three unknowns - the mishit
 *  penalty, the greenside bunker's own distance factor, and the club's rating in a bag that
 *  (see clubs.js) is plainly upgraded. Attributing all of it to the mishit would be fabricating
 *  a number from an equation with three unknowns and one measurement. So: green costs nothing,
 *  orange shades to 0.92, and red ramps 0.92 -> 0.60 across its own width, which is punishing,
 *  recoverable, and defensible on its own terms. If Matt wants the reference's full severity, the
 *  honest way to get there is to measure the bunker's distance factor separately. */
export function mishit(barPos, power, zone = 1) {
  const signed = (barPos - 0.5) * 2;                 // -1 left .. +1 right
  const off = Math.min(1, Math.abs(signed));
  const b = bandsFor(zone);
  let deg;
  let distanceMul = 1;
  if (off <= b.green) {
    deg = (off / b.green) * 1.5;
  } else if (off <= b.orange) {
    const q = (off - b.green) / Math.max(1e-6, b.orange - b.green);
    deg = 1.5 + q * 2.5;
    distanceMul = 1 - 0.08 * q;                      // 1.00 at the green edge -> 0.92 at red
  } else {
    const q = (off - b.orange) / Math.max(1e-6, b.red - b.orange);
    deg = 4 + q * 4;
    distanceMul = 0.92 - 0.32 * q;                   // 0.92 just into red -> 0.60 at a full miss
  }
  if (power > 1) deg *= 1.5;
  return { deg: deg * Math.sign(signed || 1), distanceMul };
}

/** The three-tap state machine. The caller supplies `now` (ms) so this is testable without a
 *  clock and cannot drift from whatever the render loop is doing.
 *
 *  There is no `tick()` and nothing mutates on a timer: every intermediate state is a pure
 *  function of (phase, t0, now), including "the player never took tap 2 and the swing topped
 *  out". Only a tap or a settle changes state. */
export class Swing {
  constructor() { this.tempo = { upMs: UP_MS, downMs: DOWN_MS }; this.reset(); }

  /** Set the tempo for the NEXT swing. The caller passes the club's own figures (clubs.js's
   *  `swingTempo`); a swing already in progress keeps the tempo it started with, because changing
   *  the needle's speed mid-stroke would move the target under the player's thumb. */
  setTempo(tempo) {
    if (this.phase !== PHASE.IDLE) return;
    if (tempo && tempo.upMs > 0 && tempo.downMs > 0) this.tempo = { upMs: tempo.upMs, downMs: tempo.downMs };
  }

  reset() {
    this.phase = PHASE.IDLE;
    this.t0 = 0;
    this.power = 0;
    this.pos = 0;
    this.lockUntil = 0;
  }

  /** True while the player may not act: the ball is live, or the post-shot lock has not expired. */
  locked(now) { return this.phase === PHASE.LIVE || now < this.lockUntil; }

  /** One tap. Returns 'begin' | 'power' | 'fire' | null (null = the tap did nothing). */
  tap(now) {
    if (this.locked(now)) return null;
    if (this.phase === PHASE.IDLE) { this.phase = PHASE.BACK; this.t0 = now; return 'begin'; }
    if (this.phase === PHASE.BACK) {
      const b = backswingAt(now - this.t0, this.tempo);
      if (b.topped) {
        // The backswing already ran out of arc: power is spent at the maximum and THIS tap is the
        // accuracy tap, not a second power tap. Anything else would give a free extra tap to a
        // player who mistimed the first one.
        this.power = SWING_MAX; this.pos = b.pos; this.phase = PHASE.LIVE; return 'fire';
      }
      this.power = b.pos; this.phase = PHASE.DOWN; this.t0 = now;
      return 'power';
    }
    if (this.phase === PHASE.DOWN) {
      this.pos = downswingAt(now - this.t0, this.power, this.tempo);
      this.phase = PHASE.LIVE;
      return 'fire';
    }
    return null;
  }

  /** What the meter should DRAW right now, and whether the swing has run out of window.
   *
   *  `power` is the PLANTED MARKER - null until tap 2, then the locked value, which stays on the
   *  arc for the whole downswing exactly as the reference's does.
   *  `expired` means the needle has run off the bottom of the bar with no third tap; the caller
   *  fires the shot at that worst-case accuracy rather than leaving the swing stuck. */
  read(now) {
    if (this.phase === PHASE.BACK) {
      const b = backswingAt(now - this.t0, this.tempo);
      return { pos: b.pos, power: b.power, phase: this.phase, expired: b.pos < -BAR_HALF };
    }
    if (this.phase === PHASE.DOWN) {
      const pos = downswingAt(now - this.t0, this.power, this.tempo);
      return { pos, power: this.power, phase: this.phase, expired: pos < -BAR_HALF };
    }
    if (this.phase === PHASE.IDLE) return { pos: 0, power: null, phase: this.phase, expired: false };
    return { pos: this.pos, power: this.power, phase: this.phase, expired: false };
  }

  /** Called when the ball comes to rest: the input lock runs from here. */
  settle(now) {
    this.phase = PHASE.IDLE; this.lockUntil = now + LOCK_MS; this.power = 0; this.pos = 0;
  }
}
