// liveplay.js : playtest 1, batch 4a - A BALL IN PLAY, PLAYED OUT IN TIME.
//
// Replaces, for a season that snapshotted `livePlays`, the out-zone model (`outcomes.js`
// `resolveContact` + `zones.js`). Matt: "the other team is getting to some of my hits in time to
// catch them, and they actually do catch the ball, but then it'll say I got a hit... if it's caught,
// it's an out." The old model decided the result first and the drawing then sent a fielder to the
// ball on a timer that always arrived exactly as it landed. Here nothing is decided up front: the
// ball flies, lands, bounces, rolls and comes off the wall; nine fielders run to it at their league's
// speed; the first one to get there either CATCHES it (always an out) or picks it up and throws;
// runners run at a speed set by their own Speed; outs are force outs and tags, decided by who gets
// to the base first. The result is whatever happened.
//
// Pure and deterministic: every random draw comes from the `rand01` the caller passes (game.js's
// own snapshotted RNG), in a fixed order, so a seed replays the same play. The whole play resolves
// in ONE synchronous call inside the pitch pass, so there is never a half-played ball to snapshot:
// a resume lands on the pitch boundary before it or after it, never inside it.
//
// Coordinates: the engine's plan feet (x right, y toward centre field, home at the origin), the
// same convention `zones.js`, `outcomes.js` and `field.js`'s `polar()` share. A batted ball moves
// only along its own spray ray (it can reverse off the wall), so its position is one number `s`
// (feet from home along the ray) plus a height `h`.
//
// Runners live on the base path as one number too: 0 is home, 90 first, 180 second, 270 third,
// 360 home again (scored). Base index k (0 first, 1 second, 2 third, 3 home) sits at 90*(k+1).
//
// What the automatic decisions are (batch 4: both teams, the player's too - batches 5 and 6 hand
// the player's side over):
//   - FIELDING: the fielder who can reach the ball first takes it. A ball reached before it touches
//     the ground is caught.
//   - RUNNING: a forced runner always goes. Every runner then takes the furthest base he judges he
//     can reach before the ball could be thrown there, with a small safety margin and his own
//     misjudgement (`runnerNoiseS`) - which is what gets a runner thrown out at home now and then.
//     On a fly ball with fewer than two outs runners hold until it is caught (then tag up) or drops.
//     Batch 5: in a season that snapshotted `runControl` the PLAYER'S runners make none of these
//     decisions - he taps bases instead (`controlPlay`, below; game.js `_livePlay`). The CPU's
//     runners stay automatic.
//     Batch 6: in a season that snapshotted `fieldControl` the PLAYER'S fielders still run to the
//     ball on their own, but the catch is his tap and the first throw his choice (`fieldPlay`).
//   - THROWING: the defense throws at the most advanced runner it can get; if it can get nobody it
//     throws to the lead runner's base. After an out it may make one more throw (the double play's
//     pivot). A throw longer than the thrower's arm goes through the cutoff man.
//
// Skills (Matt's decision 3, 2026-09-23): the fielder's pitch Speed (`pitchSpd`) is how hard he
// throws, his pitch Accuracy (`pitchAcc`) how close to the bag it arrives; a throw far enough off
// pulls the fielder off the base, and a wild one gets away and every runner takes a base. The
// runner's Speed (`hitSpd`) is how fast he runs. Fielders' own running speed is the league's, not a
// skill: the handoff names Speed for runners only, and a new skill effect is Matt's call to make.

import { FOUL_LINE_DEG, CAPS, LIVE_PLAY, WALL_RULE } from './settings.js';
import { carryFt, fenceFtAt, wallHeightFtAt } from './outcomes.js';

const G_FT_S2 = 32.174;
const MPH_TO_FTS = 5280 / 3600;
const BASE_FT = 90;
const HALF_DIAG = BASE_FT / Math.SQRT2; // 63.64
const DT = 0.02; // the integrator's step, seconds

/** The settings a live-play GAME plays by: its own settings with the live model's Power effect
 *  (`LIVE_PLAY.hitPowMphPerPt`, mph of exit velocity per Power point) in place of
 *  `SKILL_EFFECT.hitPow.exitVeloMphPerPt`. Measured: with the out-zone value (1.389) and the carry
 *  cut to real home run rates, a home run became an exit-velocity threshold only Power moves, and
 *  +6 Power was worth +32 points of win rate (Contact +2, the pitching skills about 0). */
export function liveSettings(settings, runSpeedV = 1) {
  let L = settings.LIVE_PLAY || LIVE_PLAY;
  let out = settings;
  // Batch 6 (Matt: "make Speed matter more"): a season that snapshotted `runSpeedV` 2 runs on
  // `LIVE_PLAY.runSpeedV2` (more feet a second per Speed point, the same speed at the league's CPU
  // roster level); an older season keeps the table it started with.
  if (runSpeedV >= 2 && L.runSpeedV2) {
    L = { ...L, ...L.runSpeedV2 };
    out = { ...out, LIVE_PLAY: L };
  }
  if (L.hitPowMphPerPt == null) return out;
  const eff = out.SKILL_EFFECT || {};
  return { ...out, SKILL_EFFECT: { ...eff, hitPow: { ...(eff.hitPow || {}), exitVeloMphPerPt: L.hitPowMphPerPt } } };
}

/** Base index k -> plan point. 0 first, 1 second, 2 third, 3 home. */
export function basePoint(k) {
  if (k === 0) return { x: HALF_DIAG, y: HALF_DIAG };
  if (k === 1) return { x: 0, y: 2 * HALF_DIAG };
  if (k === 2) return { x: -HALF_DIAG, y: HALF_DIAG };
  return { x: 0, y: 0 };
}
/** A base-path position (0..360) -> plan point. */
export function pathPoint(s) {
  const c = Math.max(0, Math.min(4 * BASE_FT, s));
  const seg = Math.min(3, Math.floor(c / BASE_FT));
  const f = (c - seg * BASE_FT) / BASE_FT;
  const a = seg === 0 ? basePoint(3) : basePoint(seg - 1);
  const b = basePoint(seg);
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}
const baseS = (k) => BASE_FT * (k + 1);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const polar = (deg, r) => { const a = (deg * Math.PI) / 180; return { x: r * Math.sin(a), y: r * Math.cos(a) }; };
const lg = (table, league) => (table[league] != null ? table[league] : table.majors);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** The nine fielders' spots for this league, fence and shift, in plan feet. `POSITIONS` order
 *  (teams.js): P, C, 1B, 2B, 3B, SS, LF, CF, RF. The seven non-battery fielders rotate with the
 *  defense's shift (`game.js` `_shiftDegFor`, the same number the out zones used to rotate by). */
export function fielderSpots(league, fenceFt, shiftDeg = 0, L = LIVE_PLAY) {
  const inf = lg(L.infieldDepthMult, league);
  const out = {};
  for (const [pos, spot] of Object.entries(L.positions)) {
    if (spot.xy) { out[pos] = { x: spot.xy[0], y: spot.xy[1] }; continue; }
    const deg = spot.deg + shiftDeg;
    const r = spot.outfield ? fenceFtAt(deg, fenceFt) * lg(L.outfieldDepthFrac, league) : spot.r * inf;
    out[pos] = polar(deg, r);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// THE BALL. Built once as a sampled path along its spray ray: `t[i]`, `s[i]` (feet from home, along
// the ray), `h[i]` (height), `air[i]` (has not touched the ground yet). Also the events a drawing
// needs: where it lands, whether it hits the wall, whether it leaves the park.

function rollOut(path, t0, s0, v0, decelAt, fence, rest) {
  // Integrates a ball on the ground from (t0, s0) at signed speed v0 (+ away from home) until it
  // stops. Bounces off the wall (`fence`) with restitution `rest`. Appends to `path`.
  let t = t0, s = s0, v = v0, wallHits = 0;
  for (let guard = 0; guard < 2000 && Math.abs(v) > 0.5; guard++) {
    const a = decelAt(s);
    const dv = a * DT;
    if (Math.abs(v) <= dv) { v = 0; break; }
    v -= Math.sign(v) * dv;
    s += v * DT;
    t += DT;
    if (s >= fence) { s = fence - 0.5; v = -Math.abs(v) * rest; wallHits += 1; path.wallT = path.wallT != null ? path.wallT : t; }
    if (s < 0) { s = 0; v = 0; }
    path.t.push(t); path.s.push(s); path.h.push(0); path.air.push(false);
  }
  path.stopT = t; path.stopS = s;
  return wallHits;
}

export function ballPath(batted, league, fenceFt, settings, L = LIVE_PLAY, wallHeight = true) {
  const spray = batted.sprayAngleDeg;
  const fence = fenceFtAt(spray, fenceFt);
  const wallH = wallHeight ? wallHeightFtAt(spray, fenceFt, settings) : 0;
  const path = { spray, fence, wallH, kind: batted.kind, t: [0], s: [0], h: [L.contactHeightFt], air: [true],
    landT: null, landS: null, wallT: null, homer: false, outT: null, distanceFt: 0, apexFt: 0, hangS: 0 };
  const decel = (s) => (s < L.dirtRadiusFt ? L.dirtDecel : L.grassDecel);
  if (batted.kind === 'ground') {
    const v0 = Math.max(10, batted.exitVeloMph * MPH_TO_FTS * L.groundSpeedFrac);
    path.air[0] = false; path.h[0] = 0;
    path.landT = 0; path.landS = 0;
    rollOut(path, 0, 0, v0, decel, fence, L.wallRestitution);
    path.distanceFt = Math.max(...path.s);
    return path;
  }
  // An AIR ball. How far it carries is outcomes.js's `carryFt` (x the live model's own per-league
  // carry multiplier); how long it hangs is what its launch gives it - the vertical speed off the
  // bat, `hangMult` for drag - but never faster over the ground than it left the bat. The apex is
  // then what gravity makes of that hang time, so a line drive is low and quick and a fly ball high
  // and slow, and batch 4b draws exactly this arc (the out-zone model's drawn apex, `battedApexFt`,
  // made a 250 ft liner hang nearly three seconds: every one of them was run down).
  const D = carryFt(batted.exitVeloMph, batted.launchAngleDeg, settings) * lg(L.carryMult, league);
  const v = batted.exitVeloMph * MPH_TO_FTS;
  const th = (Math.max(0, batted.launchAngleDeg) * Math.PI) / 180;
  const T = Math.max(0.35, L.hangMult * 2 * v * Math.sin(th) / G_FT_S2, D / Math.max(1, v * Math.cos(th) * L.maxGroundSpeedFrac));
  const H = (G_FT_S2 * T * T) / 8;
  path.apexFt = H; path.hangS = T;
  const vx = D / T;
  const hAt = (s) => { const f = s / D; return H * 4 * f * (1 - f) + L.contactHeightFt * (1 - f); };
  const sEnd = Math.min(D, fence);
  for (let t = DT; ; t += DT) {
    const s = Math.min(sEnd, vx * t);
    path.t.push(t); path.s.push(s); path.h.push(Math.max(0, hAt(s))); path.air.push(true);
    if (s >= sEnd) break;
  }
  const tEnd = path.t[path.t.length - 1];
  if (D >= fence) {
    const hF = hAt(fence);
    if (hF >= wallH) {
      // Over the wall. A fielder may still pull it back (the reach test allows a jump at the wall).
      path.homer = true; path.outT = tEnd; path.distanceFt = D;
      return path;
    }
    // Off the wall: it carooms back toward home, drops to the grass, and rolls.
    path.wallT = tEnd;
    const vBack = -vx * L.wallRestitution;
    const tDrop = Math.sqrt((2 * Math.max(0, hF)) / G_FT_S2);
    let t = tEnd, s = fence;
    for (let tt = DT; tt <= tDrop; tt += DT) {
      t = tEnd + tt; s = Math.max(0, fence + vBack * tt);
      path.t.push(t); path.s.push(s); path.h.push(Math.max(0, hF - 0.5 * G_FT_S2 * tt * tt)); path.air.push(true);
    }
    path.landT = t; path.landS = s;
    rollOut(path, t, s, vBack * L.landSpeedFrac, decel, fence, L.wallRestitution);
    path.distanceFt = fence - 2;
    return path;
  }
  path.landT = T; path.landS = D; path.distanceFt = D;
  rollOut(path, T, D, vx * L.landSpeedFrac, decel, fence, L.wallRestitution);
  return path;
}

// ---------------------------------------------------------------------------------------------
// WHO GETS TO IT. For each fielder, the first sample the ball is inside his reach by the time he can
// have run there. Airborne and low enough to reach = a catch; on the ground = fielded.

function interceptFor(path, spot, spd, react, L) {
  const sx = Math.sin((path.spray * Math.PI) / 180), sy = Math.cos((path.spray * Math.PI) / 180);
  for (let i = 1; i < path.t.length; i++) {
    const t = path.t[i];
    if (t <= react) continue;
    const air = path.air[i];
    if (air) {
      const atWall = path.s[i] >= path.fence - 4;
      if (path.h[i] > (atWall ? L.wallReachFt : L.reachHeightFt)) continue;
    }
    const bx = path.s[i] * sx, by = path.s[i] * sy;
    const reach = air ? L.catchReachFt : L.fieldReachFt;
    const need = Math.hypot(bx - spot.x, by - spot.y) - reach;
    if (need <= spd * (t - react)) {
      return { t, i, air, x: bx, y: by };
    }
  }
  if (path.homer) return null; // it left the park
  // The ball has stopped: he gets there when he gets there.
  const i = path.t.length - 1;
  const bx = path.s[i] * sx, by = path.s[i] * sy;
  const need = Math.max(0, Math.hypot(bx - spot.x, by - spot.y) - L.fieldReachFt);
  return { t: Math.max(path.t[i], react + need / spd), i, air: false, x: bx, y: by };
}

// ---------------------------------------------------------------------------------------------
/**
 * Play one ball in play out.
 * @param {object} p
 * @param {{exitVeloMph, launchAngleDeg, sprayAngleDeg, kind, q}} p.batted - swing.js's result
 * @param {string} p.league
 * @param {object} p.fenceFt - game.js `_parkFt()`
 * @param {Array} p.bases - [first, second, third], ids or null, BEFORE the play
 * @param {number} p.outs - outs BEFORE the play
 * @param {string} p.batterId
 * @param {function} p.speedOf - (runnerId) => hitSpd skill points (0 for an unknown id)
 * @param {object} p.defense - the fielding team (`players[i].pos`/`skills`)
 * @param {number} p.shiftDeg
 * @param {object} p.settings - game.js's merged settings
 * @param {function} p.rand01
 * @param {boolean} [p.wallHeight=true]
 */
export function resolveLivePlay(p) {
  const S = p.settings;
  const L = S.LIVE_PLAY || LIVE_PLAY;
  const league = p.league;
  const outsPerInning = S.MECHANICS.outsPerInning;
  const rand = p.rand01;
  const batted = p.batted;

  if (Math.abs(batted.sprayAngleDeg) > FOUL_LINE_DEG) {
    return { result: 'out', kind: 'foulout', bases: 0, isFoul: true, outsAdded: 1, runsScored: 0,
      finalBases: p.bases.slice(), runnersOut: [], distanceFt: 0, timeline: null };
  }

  const path = ballPath(batted, league, p.fenceFt, S.WALL_RULE ? S : { WALL_RULE }, L, p.wallHeight !== false);
  const spots = fielderSpots(league, p.fenceFt, p.shiftDeg || 0, L);
  const cap = lg(CAPS, league) || 26;
  const fSpd = lg(L.fielderFtS, league);
  const fReact = lg(L.reactionS, league);

  // The nine fielders, by position, with their own throwing arm.
  const fielders = {};
  for (const pos of Object.keys(spots)) {
    const pl = (p.defense.players || []).find((x) => x.pos === pos) || (p.defense.players || [])[0] || { skills: {} };
    const sk = pl.skills || {};
    const mph = lg(L.throwBaseMph, league) + L.throwMphPerPt * Math.max(0, sk.pitchSpd || 0);
    fielders[pos] = {
      pos, spot: spots[pos], spd: fSpd, react: pos === 'P' ? fReact + L.pitcherExtraReactS : fReact,
      throwFtS: mph * MPH_TO_FTS * L.throwCarry, maxThrowFt: mph * L.maxThrowFtPerMph, throwMph: mph,
      acc01: clamp01((sk.pitchAcc || 0) / cap),
    };
  }

  // --- 1. who gets to the ball first ------------------------------------------------------------
  let take = null;
  for (const pos of L.fieldOrder) {
    const f = fielders[pos];
    const hit = interceptFor(path, f.spot, f.spd, f.react, L);
    if (hit && (!take || hit.t < take.t - 1e-9)) take = { ...hit, pos };
  }
  const timeline = {
    ball: { spray: path.spray, fence: path.fence, wallH: path.wallH, kind: path.kind, apexFt: path.apexFt,
      hangS: path.hangS, landT: path.landT, landS: path.landS, wallT: path.wallT, homer: path.homer,
      stopT: path.stopT, samples: downsample(path) },
    fielders: Object.fromEntries(Object.entries(fielders).map(([k, f]) => [k, { x: f.spot.x, y: f.spot.y }])),
    possession: null, throws: [], runners: [], outs: [], endT: 0,
  };

  // Home run: the ball left the park and nobody pulled it back first.
  if (path.homer && (!take || take.t > path.outT)) {
    const runners = [];
    let runs = 0;
    for (let i = 2; i >= 0; i--) if (p.bases[i] != null) {
      runs += 1; runners.push({ id: p.bases[i], from: i, legs: [{ t0: 0, s0: baseS(i), s1: 360, spd: L.trotFtS }], scoredT: 0, outT: null });
    }
    runs += 1;
    runners.push({ id: p.batterId, from: -1, legs: [{ t0: 0, s0: 0, s1: 360, spd: L.trotFtS }], scoredT: 0, outT: null });
    timeline.runners = runners;
    timeline.endT = path.outT;
    return { result: 'hit', kind: 'homer', bases: 4, isFoul: false, outsAdded: 0, runsScored: runs,
      finalBases: [null, null, null], runnersOut: [], distanceFt: path.distanceFt, timeline };
  }

  // --- runner model ----------------------------------------------------------------------------
  const runSpeed = (id) => lg(L.runBaseFtS, league) + L.runFtSPerPt * Math.max(0, p.speedOf(id) || 0);
  // `legs`: [{t0, s0, s1, spd}] - leaves s0 at t0 and runs at spd to s1. The last leg's s1 is the
  // runner's current TARGET; `at(r, t)` is where he is.
  const runners = [];
  for (let i = 2; i >= 0; i--) if (p.bases[i] != null) runners.push({ id: p.bases[i], from: i, spd: runSpeed(p.bases[i]), legs: [], scoredT: null, outT: null });
  const batter = { id: p.batterId, from: -1, spd: runSpeed(p.batterId), legs: [], scoredT: null, outT: null, isBatter: true };
  runners.push(batter); // lead runner first, batter last
  const lastLeg = (r) => r.legs[r.legs.length - 1];
  const targetS = (r) => (r.legs.length ? lastLeg(r).s1 : baseS(r.from));
  // Batch 5: a leg can run BACKWARD (s1 < s0) - a runner the player sends back to the base he left.
  const arriveT = (r) => { const g = lastLeg(r); return g ? g.t0 + Math.abs(g.s1 - g.s0) / g.spd : 0; };
  const at = (r, t) => {
    const g = lastLeg(r);
    if (!g) return baseS(r.from);
    if (t <= g.t0) return g.s0;
    return g.s0 + Math.sign(g.s1 - g.s0) * Math.min(Math.abs(g.s1 - g.s0), g.spd * (t - g.t0));
  };
  /** Set (or extend) the runner's target to base-path position s1, deciding at time t. */
  const runTo = (r, s1, t, fromS) => {
    const g = lastLeg(r);
    if (g && at(r, t) < g.s1 - 1e-6 && s1 >= g.s1) { g.s1 = s1; return; } // still moving: keep going
    const s0 = fromS != null ? fromS : (g ? g.s1 : baseS(r.from));
    r.legs.push({ t0: g ? Math.max(t, arriveT(r)) + L.restartS : t, s0, s1, spd: r.spd });
  };
  const alive = () => runners.filter((r) => r.outT == null);

  const outs = [];     // {id, t, force, base}
  let wildOn = null;   // the runner and base a wild throw was aimed at
  let batterSBeforeWild = null;
  const recordOut = (r, t, force, base) => { r.outT = t; outs.push({ id: r.id, t, force, base, batter: !!r.isBatter }); };

  // --- how long it takes the defense to get the ball to base k --------------------------------------
  const coverFor = (k, holderPos) => {
    const order = k === 0 ? ['1B', 'P', '2B'] : k === 1 ? (path.spray < 0 ? ['2B', 'SS'] : ['SS', '2B'])
      : k === 2 ? ['3B', 'SS'] : ['C', 'P'];
    return order.find((pos) => pos !== holderPos);
  };
  const coverArrive = (pos, k) => { const f = fielders[pos]; return f.react + Math.max(0, dist(f.spot, basePoint(k)) - 1) / f.spd; };
  /** The fastest way to base k from a holder standing at `from`, ready to throw at `tReady`: run it
   *  himself, throw straight, or (past his arm) throw to the cutoff man. Returns the plan with its
   *  expected arrival time; `execute()` below plays it with the throws' accuracy. */
  const planDelivery = (holderPos, from, tReady, k) => {
    const b = basePoint(k);
    const holder = fielders[holderPos];
    const d = dist(from, b);
    const runT = tReady - L.releaseS.infield * 0.5 + d / holder.spd; // no throw to make: just go
    const cover = coverFor(k, holderPos);
    const tCover = coverArrive(cover, k);
    let best = { kind: 'run', t: runT, legs: [] };
    if (d > L.selfTagFt) best.t = Infinity;
    if (d <= holder.maxThrowFt) {
      const t = Math.max(tReady + d / holder.throwFtS, tCover);
      if (t < best.t) best = { kind: 'throw', t, legs: [{ from: holderPos, to: cover, fromPt: from, toPt: b, tRelease: tReady, dist: d }] };
    } else {
      const cutPos = (path.spray < 0 ? ['SS', '3B'] : ['2B', '1B']).find((pos) => pos !== holderPos) || 'SS';
      const cut = fielders[cutPos];
      const frac = Math.min(0.6, Math.max(0.35, 1 - (holder.maxThrowFt * 0.85) / d));
      const relay = { x: from.x + (b.x - from.x) * frac, y: from.y + (b.y - from.y) * frac };
      const d1 = dist(from, relay), d2 = dist(relay, b);
      const tCut = cut.react + dist(cut.spot, relay) / cut.spd;
      const tRelay = Math.max(tReady + d1 / holder.throwFtS, tCut) + L.releaseS.pivot;
      const t = Math.max(tRelay + d2 / cut.throwFtS, tCover);
      if (t < best.t) best = { kind: 'relay', t, legs: [
        { from: holderPos, to: cutPos, fromPt: from, toPt: relay, tRelease: tReady, dist: d1 },
        { from: cutPos, to: cover, fromPt: relay, toPt: b, tRelease: tRelay, dist: d2 }] };
    }
    best.k = k; best.cover = best.kind === 'run' ? holderPos : cover; best.tCover = tCover;
    return best;
  };
  /** Play a delivery plan: each throw draws its own accuracy (two draws, Box-Muller). A throw
   *  `cleanCatchFt` off costs time as the fielder reaches for it; past `wildFt` it gets away. */
  const execute = (plan) => {
    if (plan.kind === 'run') return { t: plan.t, wild: false, legs: [] };
    let slip = 0; const done = [];
    let wild = false, wildAt = null;
    for (const leg of plan.legs) {
      const f = fielders[leg.from];
      const sigma = lg(L.throwErrFt, league) * (1 - L.throwErrAccCut * f.acc01) * Math.sqrt(Math.max(30, leg.dist) / 100);
      const u1 = Math.max(1e-9, rand()), u2 = rand();
      const offFt = Math.abs(sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2));
      const tFly = leg.flyS != null ? leg.flyS : leg.dist / f.throwFtS; // batch 6: a long throw carries its own
      const tArr = leg.tRelease + slip + tFly;
      let extra = 0;
      if (offFt > L.wildFt) { wild = true; wildAt = tArr; } // batch 4b: runners go when it gets away
      else if (offFt > L.cleanCatchFt) extra = (offFt - L.cleanCatchFt) * L.offTargetSPerFt;
      done.push({ from: leg.from, to: leg.to, fromPt: leg.fromPt, toPt: leg.toPt, tRelease: leg.tRelease + slip,
        tArrive: tArr, offFt: Math.round(offFt * 10) / 10, wild: offFt > L.wildFt, mph: Math.round(f.throwMph) });
      slip += extra;
      if (wild) break;
    }
    return { t: plan.t + slip, wild, wildAt, legs: done };
  };

  /** Each runner (lead first) picks the furthest base he can make, deciding at `tDecide` from where
   *  he is, against the defense getting the ball there from `holder` at `tReady` (his own read has
   *  `runnerNoiseS` of misjudgement - one draw per runner per decision). Forced runners always
   *  advance at least to the forced base. `fromS(r)` is where he leaves from if he is not already
   *  moving. */
  const decideRunners = (tDecide, defenseAt, forcedMin, startFor) => {
    let aheadLimit = 4; // base index the runner ahead is heading to (4 = nobody ahead)
    for (const r of alive()) {
      const cur = r.legs.length ? targetS(r) : baseS(r.from);
      const curBase = Math.round(cur / BASE_FT) - 1;
      const noise = (rand() * 2 - 1) * L.runnerNoiseS;
      const minBase = Math.max(curBase, forcedMin(r));
      const start = startFor(r, tDecide);
      let pick = minBase;
      for (let k = minBase + 1; k <= 3; k++) {
        if (k >= aheadLimit && k !== 3) break;
        const tR = start.t + (baseS(k) - start.s) / r.spd;
        const tD = defenseAt(k) + noise;
        const forcedHere = false; // an extra base is never a force
        if (tR + L.runnerMarginS + (forcedHere ? 0 : L.tagS) < tD) pick = k; else break;
      }
      if (pick > curBase || (pick === curBase && !r.legs.length && pick > r.from)) {
        if (!r.legs.length || baseS(pick) > targetS(r)) {
          if (!r.legs.length) r.legs.push({ t0: start.t, s0: start.s, s1: baseS(pick), spd: r.spd });
          else runTo(r, baseS(pick), tDecide);
        }
      }
      if (pick !== 3) aheadLimit = pick; // the next runner back cannot pass him
    }
  };

  // --- 2. the ball's fate ---------------------------------------------------------------------------
  const holderPos = take.pos;
  const P = { x: take.x, y: take.y };
  let caught = take.air;
  // Batch 6: when the PLAYER fields (`p.field`), the fielder still runs to the ball on his own, but
  // he only catches it (or gloves it cleanly off the ground) if the player taps inside
  // `fldCatchWinS` of the moment it arrives (`p.field.catchT`, seconds from contact; `undefined`
  // means "not decided yet" and is drawn as clean). A miss is a BOBBLE: the ball drops at his feet,
  // stays live, and he picks it up `fldBobbleS` later.
  let bobble = null;
  const fieldWin = lg(L.fldCatchWinS, league);
  if (p.field && !p.control) {
    const c = p.field.catchT;
    const ok = c === undefined || (Number.isFinite(c) && Math.abs(c - take.t) <= fieldWin + 1e-9);
    if (!ok) { bobble = { t: take.t, pickT: take.t + L.fldBobbleS }; caught = false; }
  }
  timeline.possession = { pos: holderPos, t: take.t, x: P.x, y: P.y, caught,
    runFrom: { x: fielders[holderPos].spot.x, y: fielders[holderPos].spot.y }, runStartT: fielders[holderPos].react };
  if (bobble) { timeline.possession.bobble = true; timeline.possession.pickT = bobble.pickT; }
  let outsNow = p.outs;
  const occupied = (i) => p.bases[i] != null;
  const forcedBase = (r) => {
    // r.from -1 batter -> must reach first (0). A runner on base i is forced to i+1 if every base
    // behind him is occupied (the batter counts as occupying "home").
    if (r.from === -1) return 0;
    for (let j = 0; j < r.from; j++) if (!occupied(j)) return r.from;
    return r.from + 1;
  };

  let est = null; // batch 5: what a model base runner reads (sim-baseball-career.mjs); see controlPlay
  if (p.control) {
    controlPlay(p.control.orders);
  } else if (p.field) {
    fieldPlay(p.field);
  } else if (caught) {
    // A CAUGHT BALL IS ALWAYS AN OUT (Matt).
    recordOut(batter, take.t, false, -1);
    batter.legs.push({ t0: L.batterStartS, s0: 0, s1: Math.min(45, batter.spd * take.t), spd: batter.spd });
    outsNow += 1;
    if (outsNow < outsPerInning) {
      // Tag up: every runner is back on his base when it is caught, and goes if he can make it.
      const tReady = take.t + L.releaseS.catch;
      const plans = {};
      const defenseAt = (k) => (plans[k] || (plans[k] = planDelivery(holderPos, P, tReady, k))).t;
      decideRunners(take.t, defenseAt, (r) => (r.isBatter ? -1 : r.from),
        (r, t) => ({ t: t + L.tagUpS, s: baseS(r.from) }));
      defend(tReady, holderPos, P);
    }
  } else {
    // Fielded off the ground. Runners start: on a grounder, or with two out, at once; on a ball in
    // the air with fewer than two out, when it drops (from their lead, or halfway on a long fly).
    const twoOut = outsNow >= outsPerInning - 1;
    const onContact = path.kind === 'ground' || twoOut;
    const tGo = onContact ? L.runnerStartS : (path.landT != null ? path.landT : take.t);
    const offBase = onContact ? L.leadFt : (path.hangS > L.halfwayHangS ? L.halfwayFt : L.leadFt);
    const tReady = take.t + (isInfield(P) ? L.releaseS.infield : L.releaseS.outfield);
    const plans = {};
    const defenseAt = (k) => (plans[k] || (plans[k] = planDelivery(holderPos, P, tReady, k))).t;
    decideRunners(tGo, defenseAt, (r) => forcedBase(r),
      (r, t) => (r.isBatter ? { t: L.batterStartS, s: 0 } : { t, s: baseS(r.from) + offBase }));
    // A non-forced runner who holds still has his lead to give back.
    for (const r of alive()) if (!r.legs.length && !r.isBatter) r.legs.push({ t0: tGo, s0: baseS(r.from) + offBase, s1: baseS(r.from), spd: r.spd });
    defend(tReady, holderPos, P);
  }

  // --- 3. the defense throws ---------------------------------------------------------------------
  function defend(tReady, pos, from) {
    let holder = pos, at0 = from, ready = tReady;
    for (let throwN = 0; throwN < L.maxThrows; throwN++) {
      if (outsNow >= outsPerInning) break;
      // Who can we get? Every runner not yet safely at his target when the ball could get there.
      const options = [];
      for (const r of alive()) {
        const tS = targetS(r);
        const k = Math.round(tS / BASE_FT) - 1;
        if (k < 0) continue;
        const tR = arriveT(r);
        const plan = planDelivery(holder, at0, ready, k);
        const force = !caught && forcedAt(r, k);
        const need = plan.t + (force ? 0 : L.tagS);
        if (need < tR) options.push({ r, k, plan, force, tR });
      }
      let choice = null;
      for (const o of options) if (!choice || o.k > choice.k) choice = o;
      if (!choice) {
        if (throwN === 0 && !isInfield(at0)) {
          // Nobody to get: the ball comes in to the lead runner's next base, and the play ends. (An
          // infielder with nobody to get simply holds it.)
          const going = alive().filter((r) => targetS(r) < 360);
          const lead = going.length ? going[0] : null;
          const k = lead ? Math.min(3, Math.round(targetS(lead) / BASE_FT)) : 1;
          const plan = planDelivery(holder, at0, ready, k);
          const res = execute(plan);
          timeline.throws.push(...res.legs);
          timeline.endT = Math.max(timeline.endT, res.t);
          if (res.wild) wildAdvance(res.wildAt);
        }
        break;
      }
      // Trailing runners read the throw: a throw to another base is a chance for one more.
      if (throwN === 0) {
        let aheadLimit = 4;
        for (const r of alive()) {
          const k = Math.round(targetS(r) / BASE_FT) - 1;
          if (r !== choice.r && k < 3 && k + 1 < aheadLimit) {
            const nb = k + 1;
            const tCanReach = choice.plan.t + L.releaseS.pivot + dist(basePoint(choice.k), basePoint(nb)) / fielders[choice.plan.cover].throwFtS;
            const noise = (rand() * 2 - 1) * L.runnerNoiseS;
            const tR = Math.max(arriveT(r), ready) + (baseS(nb) - targetS(r)) / r.spd;
            if (tR + L.runnerMarginS + L.tagS < tCanReach + noise) runTo(r, baseS(nb), ready);
          }
          aheadLimit = Math.round(targetS(r) / BASE_FT) - 1;
          if (aheadLimit >= 3) aheadLimit = 4;
        }
      }
      const res = execute(choice.plan);
      timeline.throws.push(...res.legs);
      timeline.endT = Math.max(timeline.endT, res.t);
      if (res.wild) { wildOn = { id: choice.r.id, k: choice.k }; wildAdvance(res.wildAt); break; }
      const need = res.t + (choice.force ? 0 : L.tagS);
      if (need < choice.tR) {
        recordOut(choice.r, res.t, choice.force, choice.k);
        outsNow += 1;
      }
      holder = choice.plan.cover; at0 = basePoint(choice.k); ready = res.t + L.releaseS.pivot;
    }
  }
  // --- 3b. batch 5: THE PLAYER RUNS THE BASES --------------------------------------------------------
  // Matt: "I have to click something to send the batter to second, then again to third... I could
  // change my mind halfway to a base, so the batter would stop and run back." With `p.control` the
  // batting side's runners make no decisions of their own: the batter runs to first, a forced runner
  // to his forced base, everyone else gives his lead back - and then only the player's ORDERS move
  // anybody. An order is `{t, k}`: base k (0 first .. 3 home) tapped at t seconds from contact.
  //   - GO: the runner nearest BEHIND base k (by where he is at t) who is not already heading there or
  //     further runs to it (through any base between). Refused if another runner stands on or is
  //     heading to that base (two men cannot share a bag).
  //   - BACK: tapping the base a runner is running AWAY from (he left it or ran through it, or is
  //     about to leave it) sends him back to it. Not for a runner who is still forced off it.
  //   - When a tap reads both ways (a runner just left base k AND a runner behind could take it), the
  //     one NEARER base k is meant, except that a runner sent on this run less than `ctlBackGraceS`
  //     ago is never the one: "home, then second" sends the man on second home and the batter to
  //     second, while "home, then third" as he rounds third holds him there.
  //   - An order made while the ball is still in the air (fewer than two out) waits until it comes
  //     down: a tag-up from the catch, a start from the landing. After a wild throw, or the third
  //     out, orders are over (the throw that got away already gave every runner a base).
  // The defense is played in time, event by event, against what the runners are doing AT THAT
  // MOMENT: each decision (the first once the ball is picked up, then each time a throw arrives, or
  // an idle fielder sees a runner go) throws at the most advanced runner it can beat, a force at his
  // forced base included, and a throw already in the air cannot follow a runner who turns round. The
  // play is therefore a pure function of the orders: a later order never changes anything before
  // it (the random draws are the throws', taken in time order), which is what lets the UI re-resolve
  // the whole play on every tap and keep drawing from the same moment.
  function controlPlay(rawOrders) {
    timeline.controlled = true; // batch 5: the UI redraws this play on every tap (ui.js `_livePlayModel`)
    const onContact = !caught && (path.kind === 'ground' || outsNow >= outsPerInning - 1);
    let tGo;
    if (caught) {
      recordOut(batter, take.t, false, -1);
      batter.legs.push({ t0: L.batterStartS, s0: 0, s1: Math.min(45, batter.spd * take.t), spd: batter.spd });
      outsNow += 1;
      tGo = take.t + L.tagUpS;
    } else {
      tGo = onContact ? L.runnerStartS : (path.landT != null ? path.landT : take.t);
      const offBase = onContact ? L.leadFt : (path.hangS > L.halfwayHangS ? L.halfwayFt : L.leadFt);
      batter.legs.push({ t0: L.batterStartS, s0: 0, s1: baseS(0), spd: batter.spd });
      for (const r of runners) {
        if (r.isBatter) continue;
        // A forced runner goes; anyone else holds his lead until the ball is picked up (to see if it
        // gets through), then gives it back - unless the player has sent him first.
        const fb = forcedBase(r);
        if (fb > r.from) r.legs.push({ t0: tGo, s0: baseS(r.from) + offBase, s1: baseS(fb), spd: r.spd });
        else r.legs.push({ t0: Math.max(tGo, take.t), s0: baseS(r.from) + offBase, s1: baseS(r.from), spd: r.spd, hold: true });
      }
    }
    const tReady = take.t + (caught ? L.releaseS.catch : (isInfield(P) ? L.releaseS.infield : L.releaseS.outfield));
    const arm = Object.values(fielders);
    est = { tGo, caught, tReady, onContact,
      deliverT: [0, 1, 2, 3].map((k) => planDelivery(holderPos, P, tReady, k).t),
      armFtS: arm.reduce((a, f) => a + f.throwFtS, 0) / arm.length,
      pivotS: L.releaseS.pivot, tagS: L.tagS, turnS: L.turnS, restartS: L.restartS };
    if (outsNow >= outsPerInning) return;

    const orders = (Array.isArray(rawOrders) ? rawOrders : [])
      .filter((o) => o && Number.isFinite(o.t) && o.t >= 0 && Number.isInteger(o.k) && o.k >= 0 && o.k <= 3)
      .slice(0, L.ctlMaxOrders)
      .map((o, i) => ({ t: o.t, k: o.k, i }))
      .sort((a, b) => a.t - b.t || a.i - b.i);
    const EPS = 1e-6;
    const baseIdx = (s) => Math.round(s / BASE_FT) - 1;
    const forceOn = (r) => runners.every((x) => x === r || x.from >= r.from || x.outT == null);
    const blocked = (k, r) => k < 3 && alive().some((x) => x !== r && Math.abs(targetS(x) - baseS(k)) < EPS);
    const redirect = redirectRunner;
    const applyOrder = (k, t) => {
      const sk = baseS(k);
      // BACK: a runner running away from base k (he left it, or passed it), not forced off it.
      let back = null;
      if (k < 3) {
        for (const r of alive()) {
          const g = lastLeg(r);
          if (!g || g.s1 <= g.s0) continue;
          const pos = at(r, t);
          if (pos < sk - EPS || pos >= sk + BASE_FT || pos >= g.s1 - EPS) continue;
          if (!caught && forcedBase(r) > k && forceOn(r)) continue;
          back = r; break;
        }
      }
      // GO: the runner nearest behind base k who is not already heading there or further.
      let go = null, goPos = -Infinity;
      for (const r of alive()) {
        const pos = at(r, t);
        if (targetS(r) < sk - EPS && pos < sk - EPS && pos > goPos) { go = r; goPos = pos; }
      }
      if (go && blocked(k, go)) go = null;
      if (back && go) {
        // Both readings exist: the runner who left k goes back only if he is the nearer of the two
        // to it and was not sent on this run in the last `ctlBackGraceS` (so "home, then second"
        // sends the runner on second home and the batter to second).
        const recent = t - lastLeg(back).t0 < L.ctlBackGraceS;
        if (recent || sk - goPos < at(back, t) - sk) back = null; else go = null;
      }
      const r = back || go;
      if (!r || (back && blocked(k, back))) return false;
      redirect(r, t, sk);
      return true;
    };
    const reachT = reachTime;

    let holder = holderPos, at0 = P, ready = tReady;
    let decT = tReady, inFlight = null, done = false, throwN = 0;
    const throwTo = (plan, k, target, T) => {
      const res = execute(plan);
      timeline.throws.push(...res.legs);
      // Never before the decision itself (`planDelivery`'s run-it-himself estimate can be, for a
      // fielder already standing on the bag) - an out must not land before a tap that changed it.
      const tA = Math.max(res.t, T);
      timeline.endT = Math.max(timeline.endT, tA);
      throwN += 1;
      inFlight = { k, tA, cover: plan.cover, wild: res.wild, wildAt: res.wildAt, target };
    };
    const decide = (T) => {
      if (outsNow >= outsPerInning || throwN >= L.ctlMaxThrows) return;
      let choice = null;
      const consider = (r, k, tR, force) => {
        if (tR == null || tR <= T + EPS) return;
        const plan = planDelivery(holder, at0, T, k);
        if (plan.t + (force ? 0 : L.tagS) < tR && (!choice || k > choice.k)) choice = { r, k, plan };
      };
      for (const r of alive()) {
        if (arriveT(r) <= T + EPS) continue;                 // standing on a base: safe
        const k = baseIdx(targetS(r));
        if (k >= 0) consider(r, k, arriveT(r), !caught && forcedAt(r, k) && at(r, T) < baseS(k) - EPS);
        const fb = forcedBase(r);
        if (!caught && fb > r.from && fb < k && forceOn(r)) consider(r, fb, reachT(r, baseS(fb)), true);
      }
      if (choice) { throwTo(choice.plan, choice.k, choice.r.id, T); return; }
      if (throwN === 0 && !isInfield(at0)) {
        // Nobody to get: it comes in to the lead runner's next base.
        const going = alive().filter((r) => targetS(r) < 360);
        const k = going.length ? Math.min(3, Math.max(0, Math.round(targetS(going[0]) / BASE_FT))) : 1;
        throwTo(planDelivery(holder, at0, T, k), k, null, T);
      }
    };
    const arrive = (fl) => {
      if (fl.wild) {
        if (fl.target != null) wildOn = { id: fl.target, k: fl.k };
        wildAdvance(fl.wildAt);
        done = true;
        return;
      }
      const sk = baseS(fl.k);
      for (const r of alive()) {
        const pos = at(r, fl.tA);
        const force = !caught && forcedAt(r, fl.k) && pos < sk - EPS;
        const tag = !force && Math.abs(targetS(r) - sk) < EPS && arriveT(r) > fl.tA + L.tagS;
        if (force || tag) { recordOut(r, fl.tA, force, fl.k); outsNow += 1; break; }
      }
      holder = fl.cover; at0 = basePoint(fl.k); ready = fl.tA + L.releaseS.pivot;
      if (outsNow >= outsPerInning) done = true; else decT = ready;
    };

    let oi = 0;
    for (let guard = 0; guard < 400 && !done; guard++) {
      const tO = oi < orders.length ? Math.max(orders[oi].t, tGo) : Infinity;
      const tD = inFlight ? inFlight.tA : (decT != null ? decT : Infinity);
      if (tO === Infinity && tD === Infinity) break;
      if (tO <= tD) {
        const o = orders[oi++];
        if (applyOrder(o.k, tO) && !inFlight && decT == null) decT = Math.max(tO + L.ctlReadS, ready);
        continue;
      }
      if (inFlight) { const fl = inFlight; inFlight = null; arrive(fl); continue; }
      const T = decT; decT = null;
      decide(T);
    }
  }
  /** Send runner r toward base-path position s1, decided at t (batch 5; batch 6 turns the CPU's
   *  runners back with it). A leg not started yet is re-aimed; a runner going the same way keeps
   *  going; otherwise he stops where he is and goes again after `turnS` (or `restartS` from a bag). */
  function redirectRunner(r, t, s1) {
    const EPS = 1e-6;
    const g = lastLeg(r);
    if (!g) { r.legs.push({ t0: t, s0: at(r, t), s1, spd: r.spd }); return; }
    if (t <= g.t0 + EPS) {                                   // his next leg has not started: re-aim it
      g.s1 = s1;
      if (g.hold) { g.t0 = t; delete g.hold; }               // a held lead: he goes now
      return;
    }
    const pos = at(r, t);
    const arrived = t >= arriveT(r) - EPS;
    if (!arrived && Math.sign(g.s1 - g.s0) === Math.sign(s1 - pos)) { g.s1 = s1; return; } // keep going
    g.s1 = pos;                                              // stop where he is...
    r.legs.push({ t0: t + (arrived ? L.restartS : L.turnS), s0: pos, s1, spd: r.spd }); // ...and go
  }
  /** When runner r (on his current leg) first reaches base-path position s, or null. */
  function reachTime(r, s) {
    const EPS = 1e-6;
    const g = lastLeg(r);
    if (!g || g.s1 <= g.s0 || s > g.s1 + EPS || s < g.s0 - EPS) return null;
    return g.t0 + (s - g.s0) / g.spd;
  }

  // --- 3c. batch 6: THE PLAYER PLAYS THE FIELD --------------------------------------------------------
  // Matt: "if the ball is hit to an outfielder, I'd have to time pressing a button correctly in order
  // to catch it. If I mis-time it, I bobble it... and if the ball lands, I'd choose where to throw it
  // (cutoff man, directly to a base, all the way to home plate)." With `p.field` the fielding side is
  // the player's: its fielder still runs to the ball on his own (Matt's decision 2) and the catch is
  // the tap decided above (`bobble`). His FIRST throw is the player's `p.field.throw = {t, to}`: `to`
  // is 'cut' or a base (0 first .. 3 home), `t` the second it was tapped. He lets go at
  // max(ready, tap): a quick choice costs nothing, a slow one costs every second it takes, and the
  // CPU's runners use it - while he holds the ball past ready they look again every `fldReadS` and
  // take another base if a throw let go right then could not beat them. With no choice by
  // `fldAutoS` after ready he makes the automatic defense's own throw.
  //   - A BASE: straight there, to that base's cover man. Time is distance over his arm (pitch Speed);
  //     past his arm's reach (`maxThrowFtPerMph`) it bounces in, `fldLongSlow` slower per arm's length
  //     beyond. Accuracy is `execute`'s (pitch Accuracy), and the aim error grows with distance.
  //   - CUTOFF: to the cutoff man, lined up between the ball and the lead runner's next base: the
  //     quickest throw, and no out. He then plays on as the automatic defense does.
  // Every throw after the first is the automatic defense's (the receiver's), as in `controlPlay`. The
  // CPU runners react to every throw once it is in the air (`ctlReadS` to read it): the runner it is
  // aimed at turns back if it will beat him and he is short of halfway (not when forced), and any
  // other runner takes one more base if the ball cannot be got there in time. Every random draw
  // is taken in time order (the runners' reads, then each throw's aim as it is let go), so a later
  // input never changes anything before it - the UI re-resolves the play on each tap (game.js).
  function fieldPlay(F) {
    // (A bobble is scored like any other ball not caught - doc section 10 has no error.)
    timeline.fielded = true;
    const EPS = 1e-6;
    let holdState = null; // who has the ball next, where, and when he can throw it
    const tHave = bobble ? bobble.pickT : take.t;
    const release = caught ? L.releaseS.catch : (isInfield(P) ? L.releaseS.infield : L.releaseS.outfield);
    const tReady = tHave + release;
    const tAuto = tReady + L.fldAutoS;
    const delivery = (T) => { const m = {}; return (k) => (m[k] || (m[k] = planDelivery(holderPos, P, T, k))).t; };
    // Nothing anyone does before the ball arrives may depend on the catch (the player's tap decides
    // it at that moment, and the UI draws the play before it knows): so on a ball in the air with
    // fewer than two out every runner stands on his bag until it comes down, caught or dropped, and
    // with two out they all run on contact either way. Before a bobble they read a clean pick-up.
    const twoOut = outsNow >= outsPerInning - 1;
    const onContact = path.kind === 'ground' || twoOut;
    const cleanReady = take.t + (isInfield(P) ? L.releaseS.infield : L.releaseS.outfield);
    const firstRead = (tGo, offBase, ready, batterFrom = { t: L.batterStartS, s: 0 }) => {
      decideRunners(tGo, delivery(ready), (r) => forcedBase(r),
        (r, t) => (r.isBatter ? batterFrom : { t, s: baseS(r.from) + offBase }));
      for (const r of alive()) if (!r.legs.length && !r.isBatter) r.legs.push({ t0: tGo, s0: baseS(r.from) + offBase, s1: baseS(r.from), spd: r.spd });
    };
    if (caught) {
      if (onContact) firstRead(L.runnerStartS, L.leadFt, cleanReady); // two out: the catch ends the inning
      else batter.legs.push({ t0: L.batterStartS, s0: 0, s1: Math.max(0, Math.min(BASE_FT, batter.spd * (take.t - L.batterStartS))), spd: batter.spd });
      recordOut(batter, take.t, false, -1);
      outsNow += 1;
      if (outsNow < outsPerInning) {
        decideRunners(take.t, delivery(tReady), (r) => (r.isBatter ? -1 : r.from), (r, t) => ({ t: t + L.tagUpS, s: baseS(r.from) }));
      }
    } else {
      const tGo = onContact ? L.runnerStartS : (path.landT != null ? path.landT : take.t);
      const offBase = onContact ? L.leadFt : (path.hangS > L.halfwayHangS ? L.halfwayFt : L.leadFt);
      const early = bobble && tGo < bobble.t - EPS;
      if (bobble && take.air && !onContact) {
        // A dropped fly: they go as it drops - the runners from their bags, the batter from wherever
        // he had got to (the same run a catch would have stopped).
        const pos = Math.max(0, Math.min(BASE_FT, batter.spd * (take.t - L.batterStartS)));
        batter.legs.push({ t0: L.batterStartS, s0: 0, s1: pos, spd: batter.spd });
        firstRead(take.t, 0, tReady, { t: take.t, s: pos });
        if (batter.outT == null && targetS(batter) < BASE_FT) runTo(batter, BASE_FT, take.t);
      } else {
        firstRead(tGo, offBase, early ? cleanReady : tReady);
      }
      if (early) extraBase(bobble.t, delivery(tReady));
    }
    const throwNeeded = outsNow < outsPerInning && alive().length > 0;
    est = { field: true, takeT: take.t, air: take.air, pos: holderPos, catchWinS: fieldWin, bobbleS: L.fldBobbleS,
      caught, bobble: !!bobble, tHave, tReady, tAuto, throwNeeded, infield: isInfield(P),
      forced: Object.fromEntries(runners.map((r) => [r.id, forcedBase(r)])), tagS: L.tagS,
      throwT: (to, T) => firstThrow(to, T).t };
    if (!throwNeeded) {
      if (outsNow < outsPerInning) autoThrows(tReady, true);
      return;
    }

    // The player's throw (or the automatic one, if he has not chosen by tAuto).
    const ch = F.throw;
    const to = ch && (ch.to === 'cut' || (Number.isInteger(ch.to) && ch.to >= 0 && ch.to <= 3)) ? ch.to : null;
    const tRel = to != null && Number.isFinite(ch.t) ? Math.max(tReady, ch.t) : Infinity;
    const tFirst = Math.min(tRel, tAuto);
    for (let T = tReady + L.fldReadS; T < tFirst - EPS; T += L.fldReadS) extraBase(T, delivery(T));
    if (tRel > tAuto) { autoThrows(tAuto, true); return; }
    if (to === 'cut' && isInfield(P)) { timeline.playerThrow = { to, t: tRel }; return; } // an infield ball: HOLD it
    const plan = firstThrow(to, tRel);
    const fl = launch(plan, tRel);
    timeline.playerThrow = { to, t: tRel };
    settle(fl);
    autoThrows(null, false);

    // --- helpers -------------------------------------------------------------------------------
    /** The player's first throw as a plan `execute()` plays: a base (straight, bouncing past his
     *  arm), the cutoff, or a run to the bag himself when he is standing by it. */
    function firstThrow(dest, T) {
      const h = fielders[holderPos];
      if (dest === 'cut') {
        const going = alive().filter((r) => targetS(r) < 360);
        const kc = going.length ? Math.min(3, Math.round(targetS(going[0]) / BASE_FT)) : 1;
        const b = basePoint(kc);
        const cutPos = (path.spray < 0 ? ['SS', '3B'] : ['2B', '1B']).find((pos) => pos !== holderPos) || 'SS';
        const cut = fielders[cutPos];
        const d = dist(P, b);
        const frac = Math.min(0.6, Math.max(0.35, 1 - (h.maxThrowFt * 0.85) / d));
        const relay = { x: P.x + (b.x - P.x) * frac, y: P.y + (b.y - P.y) * frac };
        const d1 = dist(P, relay);
        const tCut = cut.react + dist(cut.spot, relay) / cut.spd;
        return { kind: 'cut', t: Math.max(T + d1 / h.throwFtS, tCut), k: -1, cover: cutPos, at: relay,
          legs: [{ from: holderPos, to: cutPos, fromPt: P, toPt: relay, tRelease: T, dist: d1 }] };
      }
      const b = basePoint(dest);
      const d = dist(P, b);
      if (d <= L.selfTagFt) return { kind: 'run', t: T + d / h.spd, k: dest, cover: holderPos, at: b, legs: [] };
      const cover = coverFor(dest, holderPos);
      const over = Math.max(0, d / h.maxThrowFt - 1);
      const flyS = (d / h.throwFtS) * (1 + L.fldLongSlow * over);
      return { kind: 'throw', t: Math.max(T + flyS, coverArrive(cover, dest)), k: dest, cover, at: b,
        legs: [{ from: holderPos, to: cover, fromPt: P, toPt: b, tRelease: T, dist: d, flyS }] };
    }
    /** Let a plan go at T: its aim is drawn now, then the runners read it. */
    function launch(pl, T) {
      const res = execute(pl);
      timeline.throws.push(...res.legs);
      const tA = Math.max(res.t, T);
      timeline.endT = Math.max(timeline.endT, tA);
      const fl = { k: pl.k, tA, cover: pl.cover, at: pl.at, wild: res.wild, wildAt: res.wildAt, cut: pl.kind === 'cut' };
      const tRead = T + L.ctlReadS;
      if (!res.wild && tRead < tA - EPS) readThrow(tRead, pl, fl);
      return fl;
    }
    /** The runners see where a throw is going (its expected arrival - never its aim). */
    function readThrow(T, pl, fl) {
      const cover = fielders[pl.cover];
      let ahead = 4;
      for (const r of alive()) {
        const tgt = targetS(r);
        const k = Math.round(tgt / BASE_FT) - 1;
        if (tgt >= 360) continue;
        const pos = at(r, T);
        if (!fl.cut && k === fl.k && arriveT(r) > T + EPS && lastLeg(r) && lastLeg(r).s1 > lastLeg(r).s0) {
          // The throw is coming to HIS base: back to the one he left if it will beat him there...
          const left = Math.floor((pos - EPS) / BASE_FT) - 1;
          const force = !caught && forcedAt(r, k);
          const noise = (rand() * 2 - 1) * L.runnerNoiseS;
          const beaten = arriveT(r) + L.runnerMarginS > pl.t + (force ? 0 : L.tagS) + noise;
          const free = left >= 0 && !alive().some((x) => x !== r && Math.abs(targetS(x) - baseS(left)) < EPS);
          // ...and only if he can get back before the ball could be relayed there from the bag.
          const tBack = T + L.turnS + (pos - baseS(Math.max(0, left))) / r.spd;
          const tRelay = pl.t + L.releaseS.pivot + (left >= 0 ? dist(fl.at, basePoint(left)) : 0) / cover.throwFtS;
          if (beaten && !force && free && tBack + L.runnerMarginS < tRelay) { redirectRunner(r, T, baseS(left)); ahead = left; continue; }
          ahead = k; continue;
        }
        const nb = k + 1;
        if (k >= 0 && nb <= 3 && (nb < ahead || nb === 3)) {
          const from = fl.at;
          const tCan = pl.t + L.releaseS.pivot + dist(from, basePoint(nb)) / cover.throwFtS;
          const tR = Math.max(T, arriveT(r)) + (arriveT(r) <= T ? L.restartS : 0) + (baseS(nb) - tgt) / r.spd;
          const noise = (rand() * 2 - 1) * L.runnerNoiseS;
          if (tR + L.runnerMarginS + L.tagS < tCan + noise) { runTo(r, baseS(nb), T); ahead = nb === 3 ? 4 : nb; continue; }
        }
        if (k >= 0) ahead = k;
      }
    }
    /** A throw arrives: a force or a tag at its base (never at the cutoff), or it got away. */
    function settle(fl) {
      if (fl.wild) {
        const aimed = fl.cut ? null : alive().find((r) => Math.abs(targetS(r) - baseS(fl.k)) < EPS && arriveT(r) > fl.tA);
        if (aimed) wildOn = { id: aimed.id, k: fl.k };
        wildAdvance(fl.wildAt);
        return false;
      }
      if (!fl.cut) {
        const sk = baseS(fl.k);
        for (const r of alive()) {
          const pos = at(r, fl.tA);
          const force = !caught && forcedAt(r, fl.k) && pos < sk - EPS;
          const tag = !force && Math.abs(targetS(r) - sk) < EPS && arriveT(r) > fl.tA + L.tagS;
          if (force || tag) { recordOut(r, fl.tA, force, fl.k); outsNow += 1; break; }
        }
      }
      holdState = { holder: fl.cover, at: fl.at, ready: fl.tA + L.releaseS.pivot };
      return true;
    }
    /** The automatic defense from here (`controlPlay`'s `decide`): throw at the most advanced runner
     *  it can beat, up to `ctlMaxThrows`; `first` = nobody has thrown yet (an outfielder with nobody
     *  to get throws it in). */
    function autoThrows(T0, first) {
      if (first) holdState = { holder: holderPos, at: P, ready: T0 };
      let throwN = first ? 0 : 1;
      for (let guard = 0; guard < L.ctlMaxThrows && holdState; guard++) {
        if (outsNow >= outsPerInning || throwN >= L.ctlMaxThrows) return;
        const { holder, at: at0, ready: T } = holdState;
        holdState = null;
        let choice = null;
        const consider = (r, k, tR, force) => {
          if (tR == null || tR <= T + EPS) return;
          const pl = planDelivery(holder, at0, T, k);
          if (pl.t + (force ? 0 : L.tagS) < tR && (!choice || k > choice.k)) choice = { r, k, plan: pl };
        };
        for (const r of alive()) {
          if (arriveT(r) <= T + EPS) continue;
          const k = Math.round(targetS(r) / BASE_FT) - 1;
          if (k >= 0) consider(r, k, arriveT(r), !caught && forcedAt(r, k) && at(r, T) < baseS(k) - EPS);
          const fb = forcedBase(r);
          const forceOn = runners.every((x) => x === r || x.from >= r.from || x.outT == null);
          if (!caught && fb > r.from && fb < k && forceOn) consider(r, fb, reachTime(r, baseS(fb)), true);
        }
        let pl = choice && choice.plan;
        if (!pl && throwN === 0 && !isInfield(at0)) {
          const going = alive().filter((r) => targetS(r) < 360);
          const k = going.length ? Math.min(3, Math.max(0, Math.round(targetS(going[0]) / BASE_FT))) : 1;
          pl = planDelivery(holder, at0, T, k);
        }
        if (!pl) return;
        pl.at = basePoint(pl.k);
        throwN += 1;
        if (!settle(launch(pl, T))) return;
      }
    }
  }
  /** A runner's second look while the fielder is not throwing (a bobble, or the ball held): one more
   *  base if the ball, let go now (`defenseAt`), could not beat him there. */
  function extraBase(T, defenseAt) {
    let ahead = 4;
    for (const r of alive()) {
      const tgt = targetS(r);
      if (tgt >= 360) continue;
      const k = Math.round(tgt / BASE_FT) - 1;
      const nb = k + 1;
      if (k >= 0 && nb <= 3 && (nb < ahead || nb === 3)) {
        const there = arriveT(r) <= T;
        const tR = (there ? T + L.restartS : arriveT(r)) + (baseS(nb) - tgt) / r.spd;
        const noise = (rand() * 2 - 1) * L.runnerNoiseS;
        if (tR + L.runnerMarginS + L.tagS < defenseAt(nb) + noise) { runTo(r, baseS(nb), T); ahead = nb === 3 ? 4 : nb; continue; }
      }
      if (k >= 0) ahead = k;
    }
  }
  function forcedAt(r, k) {
    // Forced only at his forced base, and only while every runner behind him (the batter included)
    // is still alive - an out behind him removes the force, and it becomes a tag play.
    if (k !== forcedBase(r) || forcedBase(r) <= r.from) return false;
    return runners.every((x) => x === r || x.from >= r.from || x.outT == null);
  }
  function isInfield(pt) { return Math.hypot(pt.x, pt.y) < L.infieldRadiusFt; }
  function wildAdvance(t) {
    // The throw got away: every runner still standing takes one more base, from his target.
    timeline.wildT = t;
    batterSBeforeWild = targetS(batter);
    for (const r of alive()) {
      const s = targetS(r);
      if (s < 360) runTo(r, Math.min(360, s + BASE_FT), t);
    }
  }

  // --- 4. the scorebook ----------------------------------------------------------------------------
  for (const r of runners) {
    if (r.outT == null && targetS(r) >= 360) r.scoredT = arriveT(r);
  }
  outs.sort((a, b) => a.t - b.t);
  const outsAdded = Math.min(outs.length, outsPerInning - p.outs);
  let runsScored = 0;
  const third = p.outs + outs.length >= outsPerInning ? outs[outsPerInning - p.outs - 1] : null;
  // No run scores on a play whose third out is a force out or the batter before he reaches first.
  const noRuns = third && (third.force || third.batter);
  for (const r of runners) {
    if (r.scoredT == null) continue;
    if (noRuns || (third && r.scoredT >= third.t)) { r.scoredT = null; continue; }
    runsScored += 1;
  }
  const finalBases = [null, null, null];
  if (!third) {
    for (const r of runners) {
      if (r.outT != null || r.scoredT != null) continue;
      const k = Math.round(targetS(r) / BASE_FT) - 1;
      if (k >= 0 && k <= 2) finalBases[k] = r.id;
    }
  }
  const runnersOut = outs.filter((o) => !o.batter).map((o) => o.id);
  timeline.outs = outs;
  timeline.runners = runners.map((r) => ({ id: r.id, from: r.from, legs: r.legs, spd: r.spd, scoredT: r.scoredT, outT: r.outT }));
  for (const r of runners) timeline.endT = Math.max(timeline.endT, r.legs.length ? arriveT(r) : 0);
  timeline.endT = Math.max(timeline.endT, take.t);

  // --- 5. what to call it -----------------------------------------------------------------------------
  // Scored the way a scorer would: a caught ball is an out; the batter thrown out at first is an
  // out; the batter who reached only because the throw at him got away, or because the defense
  // chose to retire another runner on an infield ball, has no hit; otherwise it is a hit of as many
  // bases as he took on his own (a base taken on a wild throw is not a hit, and a batter thrown out
  // stretching keeps the base behind him).
  const batterOutRec = outs.find((o) => o.batter);
  const batterS = batterSBeforeWild != null ? batterSBeforeWild : targetS(batter);
  const runnerOutFirst = outs.length > 0 && !outs[0].batter;
  let kind, result, hitBases = 0;
  if (caught) {
    kind = path.kind === 'popup' ? 'popout' : path.kind === 'line' ? 'lineout' : 'flyout';
    result = 'out';
  } else if (batterOutRec && batterOutRec.base <= 0) {
    kind = path.kind === 'ground' ? 'groundout' : 'thrown-out';
    result = 'out';
  } else if (wildOn && wildOn.id === batter.id && wildOn.k === 0) {
    kind = 'wild-throw'; result = 'reached';
  } else if (runnerOutFirst && path.kind === 'ground' && isInfield(P) && !batterOutRec) {
    kind = 'fielders-choice'; result = 'reached';
  } else {
    hitBases = batterOutRec ? Math.max(1, batterOutRec.base) : Math.max(1, Math.min(4, Math.round(batterS / BASE_FT)));
    result = 'hit';
    if (hitBases >= 4) kind = 'inside-park-homer';
    else if (path.wallT != null && path.kind !== 'ground') kind = hitBases >= 3 ? 'wall-triple' : hitBases === 2 ? 'wall-double' : 'wall-single';
    else if (path.kind === 'ground') kind = hitBases === 1 ? 'ground-single' : 'ground-hit';
    else if (path.kind === 'popup') kind = 'blooper';
    else kind = `${path.kind}-hit`;
  }
  const doublePlay = outsAdded >= 2;
  return {
    result, kind, bases: hitBases, isFoul: false, outsAdded, runsScored, finalBases,
    runnersOut, batterOut: !!batterOutRec, doublePlay, distanceFt: Math.round(caught ? Math.hypot(P.x, P.y) : path.distanceFt),
    fielder: holderPos, timeline, est,
  };
}

function downsample(path) {
  const out = [];
  const step = 0.1;
  let next = 0;
  for (let i = 0; i < path.t.length; i++) {
    if (path.t[i] + 1e-9 >= next || i === path.t.length - 1) {
      out.push([Math.round(path.t[i] * 100) / 100, Math.round(path.s[i] * 10) / 10, Math.round(path.h[i] * 10) / 10]);
      next = path.t[i] + step;
    }
  }
  return out;
}

export default { resolveLivePlay, ballPath, fielderSpots, basePoint, pathPoint };
