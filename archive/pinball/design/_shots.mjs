// SHOT MAP: what can each flipper actually hit?
//
// Fire a ball onto a flipper at many contact points and many flip timings, and record where it goes
// and where it crosses the ramp-mouth line. This is the instrument STARHUB used to find that its
// ramp took 67% of shots while the other six shots took 0%; the same question here is whether a
// player can reach level 2 at all.
import { step, makeBall, PHYS_DT, seg, circle, flipper } from '../js/physics.js';
import { FOOTPRINTS } from './board.js';

const K = 666.67, S = 0.000527, CX = 493, CY = 995, U = S * K;
const ux = (m) => (m / S + CX) * U, uy = (m) => (m / S + CY) * U;

function build() {
  const cols = [], flips = [];
  for (const f of FOOTPRINTS[1]) {
    if (f.dynamic) {
      flips.push(flipper(ux(f.pivot[0]), uy(f.pivot[1]), f.length * K, f.restAngle,
        f.restAngle + f.sweep, { id: f.name, r: f.rPivot * K }));
      continue;
    }
    const o = { id: f.name, e: 0.42, mu: f.kicks ? 0.02 : 0.05, kick: f.kicks ? 300 : 0 };
    if (f.shape === 'circle') cols.push(circle(ux(f.c[0]), uy(f.c[1]), f.r * K, o));
    else cols.push(seg(ux(f.a[0]), uy(f.a[1]), ux(f.b[0]), uy(f.b[1]), { ...o, r: f.r * K }));
  }
  return { cols, flips };
}

const MOUTH = { left: [45, 129], right: [866, 936] };
const MOUTH_Y = 908;

const XS = [];
let tries = 0;
const hit = { left: 0, right: 0 };
const tops = [];
const apex = [];

for (const side of ['flipper_lower_left', 'flipper_lower_right']) {
  const res = { left: 0, right: 0, n: 0, best: 1e9 };
  for (let t = 0.15; t <= 0.95; t += 0.04) {        // where along the paddle the ball lands
    for (let d = 0; d <= 26; d += 2) {              // how many solver steps before the flip
      const { cols, flips } = build();
      const world = { colliders: cols, flippers: flips, gravity: 515, drag: 0.16, nudgeX: 0, nudgeY: 0 };
      const f = flips.find((q) => q.id === side);
      const b = makeBall(f.px + Math.cos(f.angle) * f.len * t,
        f.py + Math.sin(f.angle) * f.len * t - 30, 0, 240);
      let flipped = false, top = 1e9, topX = 0, crossed = null;
      for (let i = 0; i < Math.round(5 / PHYS_DT); i++) {
        if (!flipped && i >= d) { f.pressed = true; flipped = true; }
        if (flipped && i === d + 45) f.pressed = false;
        const py0 = b.y / U;
        step(world, [b], (k, id) => {
          if (id === 'ramp_mouth_left') crossed = 'left';
          else if (id === 'ramp_mouth_right') crossed = 'right';
        });
        const py1 = b.y / U, pxx = b.x / U;
        if (py1 <= MOUTH_Y + 14) {
          if (py0 > MOUTH_Y + 14) XS.push(Math.round(pxx));
          if (pxx >= MOUTH.left[0] && pxx <= MOUTH.left[1]) crossed = 'left';
          else if (pxx >= MOUTH.right[0] && pxx <= MOUTH.right[1]) crossed = 'right';
        }
        if (py1 < top) top = py1, topX = pxx;
        if (py1 > 1950) break;
      }
      res.n++; tries++;
      if (crossed) { res[crossed]++; hit[crossed]++; }
      res.best = Math.min(res.best, top);
      tops.push(top); apex.push([Math.round(topX), Math.round(top)]);
    }
  }
  console.log(`${side}: ${res.n} shots  ->  left mouth ${res.left}   right mouth ${res.right}   highest py ${Math.round(res.best)}`);
}

const bins = {};
for (const x of XS) { const k = Math.floor(x / 50) * 50; bins[k] = (bins[k] || 0) + 1; }
console.log('');
console.log(`${XS.length} of ${tries} shots reach the mouth line (py ${MOUTH_Y}). Where they cross it:`);
Object.keys(bins).sort((a, b) => a - b).forEach((k) => {
  const n = bins[k];
  console.log(`   x ${String(k).padStart(4)}-${String(+k + 50).padEnd(4)} ${'#'.repeat(Math.ceil(n / 2))} ${n}`);
});
console.log(`   (LEFT MOUTH is x ${MOUTH.left[0]}..${MOUTH.left[1]};  RIGHT MOUTH x ${MOUTH.right[0]}..${MOUTH.right[1]})`);
tops.sort((a, b) => a - b);
console.log(`\nover all ${tries} shots: left mouth ${hit.left}, right mouth ${hit.right}`);
console.log(`highest point reached - best ${Math.round(tops[0])}, median ${Math.round(tops[tops.length >> 1])}`);

// Where does every shot that gets anywhere actually PEAK? This is the band a ramp mouth has to be
// in to be shootable, and it is the number that decides where the ramps belong.
{
  const ab = {};
  for (const [x, y] of apex) { if (y > 1400) continue; const k = Math.floor(x / 75) * 75; ab[k] = (ab[k] || 0) + 1; }
  console.log('');
  console.log('APEX of every shot that got above py 1400 - where it was at its highest:');
  Object.keys(ab).sort((a, b) => a - b).forEach((k) =>
    console.log(`   x ${String(k).padStart(4)}-${String(+k + 75).padEnd(4)} ${'#'.repeat(Math.ceil(ab[k] / 3))} ${ab[k]}`));
}

// How far UP each outer lane does a shot actually get? The mouth has to be at a height the ball
// reaches, not simply somewhere in the lane.
{
  const lane = (lo, hi) => apex.filter(([x]) => x >= lo && x <= hi).map(([, y]) => y).sort((a, b) => a - b);
  for (const [name, lo, hi] of [['LEFT lane  x 45..160', 45, 160], ['RIGHT lane x 830..975', 830, 975]]) {
    const ys = lane(lo, hi);
    if (!ys.length) { console.log(`${name}: no shots`); continue; }
    console.log(`${name}: ${ys.length} shots, highest py ${Math.round(ys[0])}, ` +
      `best quarter ${Math.round(ys[Math.floor(ys.length / 4)])}, median ${Math.round(ys[ys.length >> 1])}`);
  }
  console.log('  (the ramp mouths are at py 908; the flippers are at py 1560)');
}
