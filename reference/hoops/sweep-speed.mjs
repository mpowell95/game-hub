// reference/hoops/sweep-speed.mjs - WHAT SPEED BAND MAKES THIS CABINET PLAYABLE?
//
// The one number a change to the cabinet's DEPTH always invalidates. `minSpeed`/`maxSpeed`
// bracket the whole dial, so a band that misses the hoop shelf leaves a machine where nothing
// scores at any power - which is exactly what happened when the display went from raked to
// vertical and the shelf moved 0.89 m nearer the player.
//
// Two modes:
//   --scan               every launch speed from lo to hi, straight and aimed: what reaches a hoop
//   --band a,b [--band c,d ...]   score a candidate min/max pair over the real power x aim grid
//
// `node reference/hoops/sweep-speed.mjs --scan` then `... --band 4.2,5.4 --band 4.4,5.6`.
import { BOARD, COLS } from '../../hoops4/js/boarddef.js';
import { simulateThrow } from '../../hoops4/js/physics.js';

const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const G = BOARD.geom;

function throwAt(speedMin, speedMax, power, aim) {
  const b = structuredClone(BOARD);
  b.id = `sweep-${speedMin}-${speedMax}`;          // buildMachine caches by id; a variant needs its own
  b.geom.minSpeed = speedMin; b.geom.maxSpeed = speedMax;
  return simulateThrow(b, { power, aim });
}

if (argv.includes('--scan')) {
  const lo = Number(arg('lo', 3.0)), hi = Number(arg('hi', 8.0)), step = Number(arg('step', 0.1));
  const aims = [-0.40, -0.20, 0, 0.20, 0.40];
  console.log('\n  speed   scored / thrown   columns reached');
  for (let v = lo; v <= hi + 1e-9; v += step) {
    let scored = 0; const cols = new Set();
    for (const aim of aims) {
      const r = throwAt(v, v, 0.5, aim);
      const h = r && r.outcome && r.outcome.hole;
      if (h && G.holes[h]) { scored++; cols.add(h); }
    }
    console.log(`  ${v.toFixed(2)}    ${scored} / ${aims.length}            ${[...cols].sort().join(' ')}`);
  }
  process.exit(0);
}

const bands = argv.filter((a) => a.startsWith('--band=')).map((a) => a.split('=')[1].split(',').map(Number));
if (!bands.length) { console.log('pass --scan or --band=min,max'); process.exit(1); }
const POWERS = Number(arg('powers', 11)), AIMS = Number(arg('aims', 41));
for (const [mn, mx] of bands) {
  let shots = 0, scored = 0, parked = 0;
  const livePowers = new Set(); const cols = new Map();
  for (let p = 0; p < POWERS; p++) {
    const power = p / (POWERS - 1);
    for (let a = 0; a < AIMS; a++) {
      const aim = -1 + (2 * a) / (AIMS - 1);
      shots++;
      let r; try { r = throwAt(mn, mx, power, aim); } catch { continue; }
      const h = r && r.outcome && r.outcome.hole;
      if (r && r.outcome && r.outcome.parked) parked++;
      if (h && G.holes[h]) {
        scored++; livePowers.add(p);
        const c = G.holes[h].value;
        if (!cols.has(c)) cols.set(c, []);
        cols.get(c).push(aim * G.aimMax);
      }
    }
  }
  const means = [];
  for (let c = 1; c <= COLS; c++) {
    const l = cols.get(c);
    means.push(l && l.length ? (l.reduce((x, y) => x + y, 0) / l.length) : NaN);
  }
  let mono = true;
  for (let c = 1; c < COLS; c++) if (!(means[c] > means[c - 1])) mono = false;
  console.log(`\n  band ${mn} / ${mx}`);
  console.log(`    scored ${scored}/${shots} (${(100 * scored / shots).toFixed(1)}%)   parked ${(100 * parked / shots).toFixed(1)}%`);
  console.log(`    live powers ${livePowers.size}/${POWERS}   columns reached ${cols.size}/${COLS}   ordered ${mono}`);
  console.log(`    mean aim per column  ${means.map((m) => (Number.isNaN(m) ? '  --  ' : m.toFixed(3).padStart(7))).join('')}`);
}
