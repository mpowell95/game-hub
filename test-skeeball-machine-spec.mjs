// test-skeeball-machine-spec.mjs - every rule in skeeball/MACHINE-SPEC.md, over every board.
//
// Rule ids here match the headings in that document exactly. A failure names the id, so the fix
// is one search away.
//
// A rule may be broken only with an entry in that board's `specWaivers`, keyed by rule id. See
// the spec's Waivers section for what the four outcomes are. Every waiver is printed at the end
// under RULES BROKEN ON THIS MACHINE, ready to paste into a PR.
//
// Run: node test-skeeball-machine-spec.mjs   (also wired into run-all-tests.mjs)

import { BOARDS } from './skeeball/js/boards.js';
// EACH BOARD IS BUILT BY ITS OWN machine.js (skeeball/js/engines.js) - there is no shared one
// since 2026-08-23. Building every board with the classic's would check geometry no player ever
// touches, which is worse than not checking it.
import { engineFor, loadEngine } from './skeeball/js/engines.js';
import STRINGS from './skeeball/js/strings.js';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./skeeball/js/boards.js', import.meta.url), 'utf8');

/** A machine's own engine files, read as TEXT. Part 7's rules are about how a machine is WRITTEN,
 *  not what its numbers are, and every one of them is a defect that shipped on a real machine and
 *  cost Matt a playable game (2026-08-26). Board id and folder name are the same thing - the
 *  contract engines.js's "ADDING A MACHINE" note describes. A machine whose folder is missing
 *  fails loudly rather than silently passing every rule below. */
function engineSrc(id) {
  const out = {};
  for (const f of ['render', 'physics', 'machine']) {
    try {
      out[f] = readFileSync(new URL(`./skeeball/js/machines/${id}/${f}.js`, import.meta.url), 'utf8');
    } catch { out[f] = null; }
  }
  return out;
}

const MIN_REASON = 40;
const EPS = 1e-6;

let passed = 0;
const failures = [];
const waiversHit = [];

/** One rule, one board. `ok` false means broken; a waiver downgrades it to a printed note. */
function rule(board, id, ok, detail) {
  const waivers = board.specWaivers || {};
  const reason = waivers[id];
  if (ok) {
    if (reason) {
      failures.push(`${board.id} :: ${id} :: waiver names a rule that is NOT broken - delete it`);
    } else passed++;
    return;
  }
  if (!reason) {
    failures.push(`${board.id} :: ${id} :: ${detail}`);
    return;
  }
  if (String(reason).trim().length < MIN_REASON) {
    failures.push(`${board.id} :: ${id} :: waiver reason is under ${MIN_REASON} characters - say why properly`);
    return;
  }
  waiversHit.push({ board: board.id, id, detail, reason: String(reason).trim() });
  passed++;
}

const isHex = (s) => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);
const deg = (r) => (r * 180) / Math.PI;

const LOOK_KEYS = [
  'wood', 'woodDark', 'cabinet', 'cabinetEdge', 'face', 'faceEdge', 'ring', 'ringLip',
  'value', 'pocket', 'marquee', 'marqueeText', 'bulb', 'glow', 'wall', 'net',
];
const MAT_PAIRS = ['board', 'wood', 'wall', 'ring', 'dead'];

for (const board of BOARDS) {
  const G = board.geom;
  const X = G.boardW / 6.875;

  // --- 1 unit.holes -------------------------------------------------------------------------
  // Source text, not values: any number is arithmetically 'a multiple of X'. What matters is
  // that hole geometry is WRITTEN in X, so it moves when the board is resized.
  const HOLE_LINE = /^\s*'?[A-Za-z0-9]+'?:\s*\{\s*u:/;
  const rawHole = SRC.split(/\r?\n/).filter((l) => HOLE_LINE.test(l)).filter((l) => {
    const body = l.slice(l.indexOf('{'));
    for (const key of ['u', 'v', 'r', 'ringD']) {
      const m = new RegExp(`${key}:\\s*(-?[^,}]+)`).exec(body);
      if (!m) continue;
      const val = m[1].trim();
      if (val === '0' || /X\s*\*/.test(val)) continue;
      return true;
    }
    return false;
  }).map((l) => l.trim().split(':')[0].replace(/'/g, ''));
  rule(board, 'unit.holes', rawHole.length === 0,
    `u, v, r and ringD must be written as X * n so they scale with the board: ${rawHole.join(', ')}`);

  // --- 2 ball.ratio -------------------------------------------------------------------------
  rule(board, 'ball.ratio', Math.abs(G.ballR / X - 0.35) < 1e-3,
    `ballR is ${(G.ballR / X).toFixed(4)}X, must be 0.350X`);

  // --- 3 board.dims -------------------------------------------------------------------------
  const tilt = deg(G.boardTilt);
  const lenX = G.boardLen / X;
  rule(board, 'board.dims', tilt >= 40 && tilt <= 50 && lenX >= 8.5 && lenX <= 10.5,
    `boardTilt ${tilt.toFixed(1)} deg (want 40-50), boardLen ${lenX.toFixed(3)}X (want 8.5-10.5)`);

  // --- 4 lane.dims --------------------------------------------------------------------------
  rule(board, 'lane.dims', G.laneW < G.boardW,
    `laneW ${(G.laneW / X).toFixed(3)}X is not narrower than boardW ${(G.boardW / X).toFixed(3)}X`);

  // --- 5 ramp.angles ------------------------------------------------------------------------
  const a = G.humpAngles || [];
  const rising = a.length === 6 && a.every((v, i) => i === 0 || v > a[i - 1]);
  const launch = a.length ? deg(a[a.length - 1]) : 0;
  rule(board, 'ramp.angles', rising && launch >= 55 && launch <= 70,
    `humpAngles must be 6, strictly increasing, last 55-70 deg; got ${a.length}, last ${launch.toFixed(1)} deg`);

  // --- 6 trough.dims ------------------------------------------------------------------------
  rule(board, 'trough.dims', G.troughLen > 0 && G.troughDepth > 0,
    'troughLen and troughDepth must both be positive');

  // --- 7 holes ------------------------------------------------------------------------------
  const holes = Object.entries(G.holes || {});

  // A MOVING HOLE IS TESTED OVER ITS WHOLE TRAVEL, NOT AT ITS RESTING u.
  //
  // HOT SHOT: RUNAWAY's top row is two 100s (its `geom.mover.holes`). They start still on their
  // own marks; land in one and it CLOSES, and the survivor sweeps the full width - so a written
  // `u` up there is a MARK, not a position, and it is a position that basket holds only until the
  // first 100 of the rack drops. Testing that number would let a machine pass `holes.inside` and
  // `holes.spacing` at the one place the basket spends the least time, while it spent the rest of
  // the rack hanging over a rail.
  //
  // GUARD: THE TRAVEL IS ABSOLUTE, NOT RELATIVE TO THE MARK. machine.js sweeps the survivor as
  // `dir * amp * cos(...)`, so it runs between -amp and +amp WHEREVER it started - it does not
  // run `u +/- amp` around its own mark. Getting that wrong doubles the envelope and the rule
  // would fail a machine that is fine (or pass one that is not, if the marks ever move inward).
  //
  // A fixed hole contributes its single u, which is what every board with no mover has always
  // been checked against.
  const mover = G.mover || null;
  // Every group of baskets that plays "last one standing": the top row, plus each `rows` entry.
  // Any member can end up the survivor, so any member can move.
  const groups = mover
    ? [...(Array.isArray(mover.holes) ? [mover.holes] : []), ...(Array.isArray(mover.rows) ? mover.rows : [])]
    : [];
  const groupOf = (id) => groups.find((g) => g.includes(id)) || null;
  const canRun = (id) => !!groupOf(id);
  const uSpan = (id, h) => (canRun(id) ? [-mover.amp, h.u, mover.amp] : [h.u]);

  const odd = holes.filter(([, h]) => Math.abs(h.r - G.holeR) > EPS).map(([id]) => id);
  rule(board, 'holes.uniform', odd.length === 0,
    `every hole must use holeR (${(G.holeR / X).toFixed(3)}X); these differ: ${odd.join(', ')}`);

  const outside = holes.filter(([id, h]) =>
    uSpan(id, h).some((u) => Math.abs(u) + G.holeR > G.boardW / 2 + EPS)
    || h.v - G.holeR < -EPS
    || h.v + G.holeR > G.boardLen + EPS).map(([id]) => id);
  rule(board, 'holes.inside', outside.length === 0,
    `hole centres must sit at least holeR from every face edge (a mover: at BOTH ends of its `
    + `travel); too close: ${outside.join(', ')}`);

  const tooClose = [];
  for (let i = 0; i < holes.length; i++) {
    for (let k = i + 1; k < holes.length; k++) {
      const [idA, A] = holes[i];
      const [idB, B] = holes[k];
      // TWO BASKETS IN THE SAME GROUP CAN NEVER BOTH BE OPEN AND MOVING, so their travels are
      // not a spacing problem. A group plays "last one standing": the survivor only starts
      // sweeping once every other member has CLOSED, and a closed basket has no collar in the
      // world at all (machine.js's capFor, physics.js's buildWorld). Measuring the distance
      // between a moving collar and a wall that no longer exists would fail a face that is
      // correct. They are still checked against each other on their STATIC marks, below, which is
      // the configuration a rack actually opens in.
      //
      // GUARD: SAME GROUP, NOT "BOTH CAN MOVE". Once every basket on a machine can move, the
      // looser test exempts every pair and silently stops checking travel envelopes at all.
      // Baskets in DIFFERENT groups can be moving simultaneously - RUNAWAY ends a good rack with
      // three of them - so those pairs get the full envelope.
      const gA = groupOf(idA);
      const pairRuns = !!gA && gA === groupOf(idB);
      let d = Infinity;
      if (pairRuns) {
        d = Math.hypot(A.u - B.u, A.v - B.v) / X;
      } else {
        // WORST CASE ACROSS BOTH TRAVELS. With a mover in the pair this is the closest the two
        // centres ever come during a rack, which is the only distance that means anything - a
        // basket that clears its neighbour at the centre of its sweep and drives through it at
        // the end is not a spaced face, it is a collision nobody measured.
        for (const ua of uSpan(idA, A)) {
          for (const ub of uSpan(idB, B)) d = Math.min(d, Math.hypot(ua - ub, A.v - B.v) / X);
        }
      }
      if (d < 1.30 - 1e-3) tooClose.push(`${idA}-${idB} ${d.toFixed(3)}X`);
    }
  }
  rule(board, 'holes.spacing', tooClose.length === 0,
    `hole centres must be at least 1.30X apart, at the CLOSEST point of any travel: `
    + `${tooClose.join(', ')}`);

  // A NEGATIVE VALUE IS A REAL VALUE (BRICK CITY's penalty row, 2026-08-24). This used to test
  // `h.value >= 0`, which read as "has a numeric value" but silently also banned penalty baskets,
  // so the first machine with one failed a rule it was not breaking. What the rule actually
  // guards is that every hole HAS a value - an undefined one means the arrangement layer never
  // stamped it, and that hole would score as 0 with nothing to say so.
  const badValue = holes.filter(([, h]) => !Number.isFinite(h.value)).map(([id]) => id);
  rule(board, 'holes.frozen', badValue.length === 0,
    `every hole needs a numeric value: ${badValue.join(', ')}`);

  // --- 8 rings ------------------------------------------------------------------------------
  // engines.js loads a machine's three files ON DEMAND since 2026-09-01 (the launch-weight
  // fix): engineFor() is synchronous and throws unless that machine has been loaded first.
  await loadEngine(board.id);
  const M = engineFor(board.id).buildMachine(G);
  const notDerived = [];
  const clipped = [];
  for (const [id, H] of holes) {
    if (!H.ringD) continue;
    // ringD is the INSIDE diameter, and the ring is tangent at the hole's bottom.
    if (H.ringD / 2 < H.r - EPS) notDerived.push(`${id} ringD/2 is inside the hole radius`);
    const Rwall = H.ringD / 2 + G.ringThick / 2;
    const N = Math.max(20, Math.ceil((2 * Math.PI * Rwall) / 0.04));
    const built = M.solids.filter((s) => s.part === 'ringSeg' && s.ring === id).length;
    if (!H.ringOpen && built !== N) clipped.push(`${id} built ${built} of ${N}`);
  }
  rule(board, 'rings.derived', notDerived.length === 0, notDerived.join('; '));
  rule(board, 'rings.clipped', clipped.length === 0,
    `a closed ring must lose no segments to the face edges - widen the board or shrink ringD: ${clipped.join(', ')}`);

  // --- 9 mat.single -------------------------------------------------------------------------
  // Source text, not values: a second `mat: {` inside ONE board's entry silently replaces the
  // first, and by the time the object is parsed there is nothing left to detect. Each mat line
  // is attributed to the nearest preceding `id: '...'` line, so two boards' single blocks are
  // never mistaken for a duplicate of each other (they were, when this counted by indent alone -
  // the day the second machine landed).
  const MAT_LINE = new RegExp('^\\s*mat:\\s*\\{');
  const ID_LINE = /^\s*id:\s*'([^']+)'/;
  const perBoard = {};
  let curId = null;
  SRC.split(/\r?\n/).forEach((l, i) => {
    const idm = ID_LINE.exec(l);
    if (idm) { curId = idm[1]; return; }
    if (MAT_LINE.test(l) && curId) (perBoard[curId] = perBoard[curId] || []).push(i + 1);
  });
  const mine = perBoard[board.id] || [];
  rule(board, 'mat.single', mine.length <= 1,
    'geom may hold exactly ONE mat block; a later one at the same level silently replaces the '
    + 'earlier and every value in it is lost. Duplicates at lines: ' + mine.join(' and '));

  // --- 9 mat.complete -----------------------------------------------------------------------
  const mat = G.mat || {};
  const matBad = [];
  for (const p of MAT_PAIRS) {
    const f = mat[`${p}Fric`], r = mat[`${p}Rest`];
    if (typeof f !== 'number' || f < 0 || f > 1) matBad.push(`${p}Fric`);
    if (typeof r !== 'number' || r < 0 || r > 0.6) matBad.push(`${p}Rest`);
  }
  rule(board, 'mat.complete', matBad.length === 0,
    `missing or out of range (fric 0-1, rest 0-0.6): ${matBad.join(', ')}`);

  // --- 10 throw.range -----------------------------------------------------------------------
  rule(board, 'throw.range',
    G.minSpeed < G.maxSpeed && G.aimMax >= 0.30 && G.aimMax <= 0.60,
    `minSpeed ${G.minSpeed} must be under maxSpeed ${G.maxSpeed}; aimMax ${G.aimMax} must be 0.30-0.60`);

  // --- 13 look.complete ---------------------------------------------------------------------
  const lookBad = LOOK_KEYS.filter((k) => !isHex((board.look || {})[k]));
  rule(board, 'look.complete', lookBad.length === 0,
    `missing or not #rrggbb: ${lookBad.join(', ')}`);

  // --- 14 entry.complete --------------------------------------------------------------------
  const en = (STRINGS.en || STRINGS.default?.en || {});
  const es = (STRINGS.es || STRINGS.default?.es || {});
  const entryBad = [];
  if (!board.id) entryBad.push('id');
  if (!board.name) entryBad.push('name');
  if (!board.taglineKey) entryBad.push('taglineKey');
  else {
    if (!en[board.taglineKey]) entryBad.push(`en.${board.taglineKey}`);
    if (!es[board.taglineKey]) entryBad.push(`es.${board.taglineKey}`);
  }
  // Two unlock shapes exist: { board, score } (reach that score in one game) and
  // { board, goals: true } (complete all three of that board's objectives - js/goals.js,
  // applied by ui.js's _earnedUnlocks/_ensureGoalUnlocks). POPONGO is the first goals unlock.
  if (board.unlock !== null && !(board.unlock && board.unlock.board
    && (board.unlock.score > 0 || board.unlock.goals === true))) {
    entryBad.push('unlock must be null, { board, score } or { board, goals: true }');
  }
  rule(board, 'entry.complete', entryBad.length === 0, `missing or wrong: ${entryBad.join(', ')}`);

  // === PART 7 - THE MACHINE MUST NOT MAKE THE HUB SLUGGISH ===================================
  //
  // Every rule below is a defect that SHIPPED, on a real machine, and cost Matt a playable game.
  // A machine can satisfy every other rule in this file - perfect geometry, perfect materials,
  // perfect colour - and still drag the whole hub down, because each machine owns its own
  // render.js and physics.js and every new one is a fresh chance to reintroduce all of it.
  // Full history: skeeball/MACHINE-SPEC.md Part 7.
  const src = engineSrc(board.id);

  // --- 21 perf.files ---------------------------------------------------------------------
  const missing = ['render', 'physics', 'machine'].filter((f) => src[f] === null);
  rule(board, 'perf.files', missing.length === 0,
    `skeeball/js/machines/${board.id}/ is missing ${missing.join('.js, ')}.js - `
    + 'board id and engine folder name must match (engines.js, "ADDING A MACHINE")');
  const R = src.render || '';
  const PH = src.physics || '';

  // --- 22 perf.context -------------------------------------------------------------------
  // THE CONTRACT ui.js's releaseRenderer() DEPENDS ON. dispose() frees three.js's buffers and
  // LEAVES THE WEBGL CONTEXT ALIVE; only forceContextLoss() hands it back, and ui.js reaches in
  // via `r.renderer.forceContextLoss()` to do it. A machine that keeps its THREE.WebGLRenderer
  // under a different field name leaks one context per rack, silently, and the browser starts
  // throttling from about the sixteenth - which is what pinned BRICK CITY at a flat 10fps.
  rule(board, 'perf.context', /this\.renderer\s*=\s*new THREE\.WebGLRenderer/.test(R),
    'render.js must keep its THREE.WebGLRenderer as `this.renderer` - ui.js releaseRenderer() '
    + 'calls this.renderer.forceContextLoss() by that exact name to give the context back');

  // --- 23 perf.probe ---------------------------------------------------------------------
  // A throwaway getContext('webgl') costs a context out of the same small global budget. The
  // software-GL check used to take one per Renderer ever constructed and never give it back:
  // five for the gallery's machine pictures alone, before a ball was thrown.
  const probes = (R.match(/getContext\(\s*['"]webgl/g) || []).length;
  rule(board, 'perf.probe', probes === 0 || /WEBGL_lose_context/.test(R),
    `render.js opens ${probes} throwaway WebGL context(s) and never releases one - memoise the `
    + 'answer per module and release the probe through WEBGL_lose_context (see isSoftGL)');

  // --- 24 perf.shadow --------------------------------------------------------------------
  // three.js redraws the whole shadow map EVERY FRAME by default, drawing every caster a second
  // time - and a skeeball machine is a still life for most of a rack while the player lines up.
  // Measured on BRICK CITY: 172 draw calls per frame with the pass on, 138 with it on demand.
  // On THE CLASSIC, whose rings are 192 separate bodies: 2046 against 1246.
  rule(board, 'perf.shadow',
    /shadowMap\.autoUpdate\s*=\s*false/.test(R) && /shadowMap\.needsUpdate\s*=/.test(R),
    'render.js must set shadowMap.autoUpdate = false and assign shadowMap.needsUpdate in '
    + 'render() only when a caster moved - otherwise the shadow pass runs on every still frame');

  // --- 25 perf.textures ------------------------------------------------------------------
  // Material.dispose() does NOT dispose the material's textures. Every scoring popup builds a
  // CanvasTexture, and without an explicit .map.dispose() each one sits on the GPU for the life
  // of the page - about a megabyte a rack, never freed. This is the one that makes a long
  // session worse than a fresh one.
  const popupLine = (R.match(/^.*_popups\.splice.*$/m) || [''])[0];
  rule(board, 'perf.textures', /map\.dispose|disposeMat/.test(popupLine),
    'render.js retires a score popup without disposing its texture - dispose .map BEFORE the '
    + 'material (or route both through a disposeMat helper). Material.dispose() does not do it');

  // --- 26 perf.broadphase ----------------------------------------------------------------
  // A throw's world holds ONE dynamic body - the ball - among ~200 static ones. NaiveBroadphase
  // tests every pair and discards all but the ball's, because needBroadphaseCollision rejects
  // static-against-static: tens of thousands of pointless tests per step, at 240 steps a second.
  // Replacing it is worth 29-32% of physics time and is provably invisible to play - each
  // machine that has done it proved 861 of 861 throws identical first.
  rule(board, 'perf.broadphase', !/new CANNON\.NaiveBroadphase\(\)/.test(PH),
    'physics.js uses NaiveBroadphase. Its world has one dynamic body among ~200 static ones, so '
    + 'this is O(n^2) for nothing - port BallBroadphase and PROVE the 41x21 grid is unchanged');
}

// --- board ids are unique and none is empty -------------------------------------------------
const ids = BOARDS.map((b) => b.id);
if (new Set(ids).size !== ids.length) failures.push(`BOARDS :: duplicate board id in ${ids.join(', ')}`);
else passed++;

// --- report ---------------------------------------------------------------------------------
console.log(`Checked ${BOARDS.length} board(s): ${ids.join(', ')}\n`);

for (const f of failures) console.log(`FAIL  ${f}`);

if (waiversHit.length) {
  console.log(`\n${'='.repeat(74)}`);
  console.log('RULES BROKEN ON THIS MACHINE');
  console.log('Quote this block in the PR body and in the message to Matt.');
  console.log('='.repeat(74));
  for (const w of waiversHit) {
    console.log(`\n  ${w.board} breaks ${w.id}`);
    console.log(`    what:  ${w.detail}`);
    console.log(`    why:   ${w.reason}`);
  }
  console.log(`\n${'='.repeat(74)}`);
}

console.log(`\nMachine spec: ${passed} passed, ${failures.length} failed`
  + (waiversHit.length ? `, ${waiversHit.length} rule(s) broken under waiver` : ''));

process.exit(failures.length ? 1 : 0);
