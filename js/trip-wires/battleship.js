// js/trip-wires/battleship.js - this game's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network, no imports. The older rule (more hits than shots, or a win in under 17 shots) lives in js/integrity.js
// checkPlayInput and is not repeated here.
// Data: the private log `x` (battleship/js/ui.js _playLog): size ('quick' 8x8, 12 ship squares | 'classic' 10x10, 17), me
// (this phone's seat), mv = [board shot at, r, c, 'h' | 'm', sunk, ms] per shot, n = shots fired per seat, win, grids =
// both public grids at the end (0 unknown, 1 miss, 2 hit, 3 sunk; grids[i] = shots AT seat i), fleets = per seat
// [[id, r, c, 'h' | 'v', length]] when this phone knows it (vs the computer: both; a live room: its own only), res, end, and
// from 2026-11-25 t0 (epoch ms the log began) and cut. `a` = [difficulty, won, { shots, hits, sunk, accuracy }].

// --- shared shape of this group's board-game files (copied, not imported: one file per game) ----------------------------
/** Real presses (touch/mouse downs and keys) in the touch log; null when it might not hold them all
 *  (js/play-log-queue.js _tok drops a press only once no move token is left to drop, so any move left = none dropped). */
function presses(n) {
  if (!n || !Array.isArray(n.ev)) return null;
  if (n.cut && !n.moves) return null;
  return n.ev.filter((q) => !q.fake && (q.kind === 'd' || q.kind === 'k')).length;
}
/** The gaps before each own action (actions = [[own, ms]] in order): count, median, spread of the middle 80%. */
function pace(actions) {
  const g = [];
  for (let k = 1; k < actions.length; k++) if (actions[k][0]) g.push(actions[k][1] - actions[k - 1][1]);
  if (!g.length) return { n: 0, med: 0, spread: 0 };
  g.sort((p, q) => p - q);
  const at = (f) => g[Math.floor(f * (g.length - 1))];
  return { n: g.length, med: at(0.5), spread: at(0.9) - at(0.1) };
}

// battleship/js/fleet.js SHIP_SETS / BOARD_SIZE.
const SIZE = { quick: 8, classic: 10 }, SHIP_SQUARES = { quick: 12, classic: 17 };
/** A known fleet's squares as a Set of r * size + c (fleet.js shipCells: 'v' runs down, 'h' across), or null. */
function fleetCells(f, size) {
  if (!Array.isArray(f) || !f.length) return null;
  const out = new Set();
  for (const s of f) {
    if (!Array.isArray(s) || !Number.isInteger(s[1]) || !Number.isInteger(s[2]) || (s[3] !== 'h' && s[3] !== 'v') || !(s[4] > 0)) return null;
    for (let i = 0; i < s[4]; i++) out.add(s[3] === 'v' ? (s[1] + i) * size + s[2] : s[1] * size + s[2] + i);
  }
  return out;
}
const sizeOf = (x) => (x && (x.size === 'quick' || x.size === 'classic') ? x.size : null);

export default [
  {
    // battleship/js/game.js resolveShot is the only reader of a fleet: a shot is a hit exactly when it lands on a ship
    // square, and isShotLegal refuses a square already shot. Against every fleet this phone knows, each logged shot and
    // each square of the public grid at the end must say what the fleet says.
    id: 'battleship-shots-not-fleet',
    text: 'a hit on open water, a miss on a ship, or the same square shot twice',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, sz = sizeOf(x);
      if (!sz || !Array.isArray(x.fleets)) return null;
      const size = SIZE[sz];
      const fl = [0, 1].map((k) => fleetCells(x.fleets[k], size));
      if (Array.isArray(x.mv) && !x.cut) {
        const seen = [new Set(), new Set()];
        for (const q of x.mv) {
          if (!Array.isArray(q)) continue;
          const b = q[0] === 1 ? 1 : 0, at = Number(q[1]) * size + Number(q[2]);
          // twice: vs the computer only (x.diff is set only there), where nothing replays a shot (a live room's recovery may)
          if (x.diff != null && seen[b].has(at)) return { v: `board ${b} square ${q[1]},${q[2]} shot twice`, lim: 'one shot a square' };
          seen[b].add(at);
          if (fl[b] && (q[3] === 'h') !== fl[b].has(at)) return { v: `board ${b} square ${q[1]},${q[2]} logged ${q[3] === 'h' ? 'hit' : 'miss'}`, lim: fl[b].has(at) ? 'hit' : 'miss' };
        }
      }
      if (Array.isArray(x.grids)) {
        for (const b of [0, 1]) {
          const g = String(x.grids[b] || '');
          if (!fl[b] || g.length !== size * size) continue;
          for (let i = 0; i < g.length; i++) {
            const v = g[i];
            if ((v === '2' || v === '3') && !fl[b].has(i)) return { v: `board ${b} square ${Math.floor(i / size)},${i % size} a hit on open water`, lim: 'miss' };
            if (v === '1' && fl[b].has(i)) return { v: `board ${b} square ${Math.floor(i / size)},${i % size} a miss on a ship`, lim: 'hit' };
          }
        }
      }
      return null;
    },
  },
  {
    // game.js applyAnswer ends the match only when the defender's whole fleet is sunk (fleetSunk), so a win leaves every
    // ship square of the other board hit: 12 on Quick, 17 on Classic. ui.js _commitStats takes hits from that same grid.
    // A recorded win with fewer, or a recorded hit count the grid does not hold, is impossible.
    id: 'battleship-win-not-sunk',
    text: 'a recorded win with ships still afloat, or hits the board does not show',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, a = ctx.a, sz = sizeOf(x);
      if (!sz || !Array.isArray(x.grids) || !Array.isArray(a) || e.f !== 'recordBattleship') return null;
      const size = SIZE[sz], other = x.me === 1 ? 0 : 1, g = String(x.grids[other] || '');
      if (g.length !== size * size) return null;
      const hits = Array.from(g).filter((v) => v === '2' || v === '3').length;
      const ex = a[2] && typeof a[2] === 'object' ? a[2] : null;
      if (ex && Number.isFinite(Number(ex.hits)) && Number(ex.hits) !== hits && x.end === 'over') return { v: `recorded ${ex.hits} hits, the board shows ${hits}`, lim: hits };
      if (a[1] === true && hits < SHIP_SQUARES[sz]) return { v: `a win with ${hits} of ${SHIP_SQUARES[sz]} ship squares hit`, lim: SHIP_SQUARES[sz] };
      return null;
    },
  },
  {
    // A shot is fired only by tapping a square (aim) and then FIRE or the same square again (ui.js _onBattleTap /
    // _confirmFire); a salvo aims several squares and fires once. So each shot needs at least one press. More of the
    // player's shots after the touch log's first event than real presses in it means something else fired them.
    id: 'battleship-shots-without-taps',
    text: 'more shots fired than taps',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, p = presses(ctx.n);
      if (!x || !Array.isArray(x.mv) || p == null || !(Number(x.t0) > 0)) return null;
      const target = x.me === 1 ? 0 : 1;
      const mine = x.mv.filter((q) => Array.isArray(q) && q[0] === target && Number(x.t0) + Number(q[5]) >= ctx.n.t0).length;
      return mine > p ? { v: `${mine} shots, ${p} presses`, lim: p } : null;
    },
  },
  {
    // A person's gap before each shot varies (the ball flies 850 ms, FLY_MS, and the board stays locked until it settles).
    // Over 15+ shots, an even rhythm (spread under 100 ms) or a median under 300 ms is a script's. Suspicious only.
    id: 'battleship-machine-pace',
    text: 'shots fired at a machine-like, even pace',
    proven: false,
    check(e, ctx) {
      const x = ctx.x;
      if (!x || !Array.isArray(x.mv)) return null;
      const target = x.me === 1 ? 0 : 1;
      // a salvo's shots land together (one volley = one action): keep the first of each same-time run
      const acts = [];
      for (const q of x.mv.filter(Array.isArray)) { const t = Number(q[5]) || 0, own = q[0] === target; const last = acts[acts.length - 1]; if (last && last[0] === own && t - last[1] < 50) continue; acts.push([own, t]); }
      const pc = pace(acts);
      if (pc.n < 15) return null;
      if (pc.spread < 100 || pc.med < 300) return { v: `${pc.n} volleys, ${pc.med} ms apart (middle), spread ${pc.spread} ms`, lim: 'spread 100 ms, median 300 ms' };
      return null;
    },
  },
];
