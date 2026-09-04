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

/** Milliseconds for the needle to travel one full power unit.
 *
 *  MEASURED: the backswing ran 0.036 -> 0.937 pos in 90 frames (1.500 s) = 1665 ms per unit; the
 *  downswing ran 0.865 -> 0.063 in 55 frames (0.917 s) = 1143 ms per unit. The downswing is
 *  1.46x FASTER than the backswing, which is a real part of the feel: you get time to pick your
 *  power and much less time to save the strike.
 *
 *  The old build's ring reached 100 % in 750 ms and came back at the same speed. That is more
 *  than twice as fast as the reference on the way up, and symmetric where the reference is not. */
export const UP_MS = 1650;
export const DOWN_MS = 1150;

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

/** Where the needle sits during the BACKSWING, `ms` after tap 1.
 *
 *  Past the top it does NOT ping-pong forever: the power is spent at SWING_MAX and the needle is
 *  already on its way back down. Holding too long is therefore a real decision with a real cost
 *  (a full over-swing, and its 1.5x mishit multiplier) rather than a free second lap. */
export function backswingAt(ms) {
  if (ms <= TOP_MS) return { pos: ms / UP_MS, power: null, topped: false };
  return { pos: SWING_MAX - (ms - TOP_MS) / DOWN_MS, power: SWING_MAX, topped: true };
}

/** Where the needle sits during the DOWNSWING, `ms` after the power was locked at `power`. */
export function downswingAt(ms, power) { return power - ms / DOWN_MS; }

/** The needle's position mapped onto the accuracy bar, 0 (left) .. 1 (right), 0.5 dead centre.
 *
 *  The needle enters the bar from the LEFT on the way down and travels right, so stopping it EARLY
 *  leaves it left of centre and stopping it LATE leaves it right. */
export function barPosOf(pos) {
  return Math.min(1, Math.max(0, 0.5 - pos / (2 * BAR_HALF)));
}

/** THE ACCURACY BANDS, as distance from the centre normalised to 0..1 (`off`).
 *
 *  MEASURED off the reference's bar, by angle: green is the middle 54 % of the bar, orange 11 %
 *  each side, red 10 % each side. The old build used 40 % green and 20 % orange each side, which
 *  made the target noticeably smaller than the original's.
 *
 *  A bad lie narrows the GREEN band by `zone`; orange and red then split what is left in the same
 *  ratio they have at baseline, so the bar is always full and the needle always sweeps at the same
 *  speed. A smaller target is simply harder to hit, and the player can SEE that before committing. */
export function bandsFor(zone = 1) {
  const green = 0.54 * zone;
  const rest = 1 - green;
  return { green, orange: green + rest * 0.52, red: 1 };
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
 *  clock and cannot drift from whatever the render loop is doing.
 *
 *  There is no `tick()` and nothing mutates on a timer: every intermediate state is a pure
 *  function of (phase, t0, now), including "the player never took tap 2 and the swing topped
 *  out". Only a tap or a settle changes state. */
export class Swing {
  constructor() { this.reset(); }

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
      const b = backswingAt(now - this.t0);
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
      this.pos = downswingAt(now - this.t0, this.power);
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
      const b = backswingAt(now - this.t0);
      return { pos: b.pos, power: b.power, phase: this.phase, expired: b.pos < -BAR_HALF };
    }
    if (this.phase === PHASE.DOWN) {
      const pos = downswingAt(now - this.t0, this.power);
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
