// table.js — 8-ball rack layout and table spots. Pure, no DOM.
import { R, TABLE, createBall } from './physics.js';

// Standard spots, table-local coords (origin at table center, +y toward the foot
// rail where the rack sits, matching physics.js's pocket layout).
export const FOOT_SPOT = { x: 0, y: TABLE.h * 0.25 };
export const HEAD_SPOT = { x: 0, y: -TABLE.h * 0.25 };

// A fixed, valid 8-ball rack: 8-ball dead center (row 2 of 5, middle slot), one
// solid + one stripe in the two back-row corners. Deterministic — no shuffling —
// so the same rack always results from the same starting call (root CLAUDE.md's
// "no hidden randomness" rule extends to setup, not just physics, for MP fairness:
// both seats always see the identical opening position).
const RACK_ROWS = [
  [1],
  [9, 2],
  [3, 8, 10],
  [11, 4, 12, 5],
  [6, 13, 7, 14, 15],
];

function ballKind(n) {
  if (n === 8) return 'eight';
  return n <= 7 ? 'solid' : 'stripe';
}

/** Build the 16-ball rack for a fresh 8-ball game: id 'cue' plus 1-15. */
export function rackBalls() {
  const balls = [];
  balls.push(createBall('cue', HEAD_SPOT.x, HEAD_SPOT.y, 'cue', 0));
  const rowGap = R * Math.sqrt(3) * 1.005; // tiny clearance so the rack doesn't self-jam
  const apexY = FOOT_SPOT.y;
  for (let row = 0; row < RACK_ROWS.length; row++) {
    const nums = RACK_ROWS[row];
    const rowWidth = (nums.length - 1) * R * 2.01;
    const y = apexY + row * rowGap;
    for (let i = 0; i < nums.length; i++) {
      const x = -rowWidth / 2 + i * R * 2.01;
      const n = nums[i];
      balls.push(createBall('b' + n, x, y, ballKind(n), n));
    }
  }
  return balls;
}

export function ballById(balls, id) { return balls.find((b) => b.id === id); }
