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
import { buildMachine } from './skeeball/js/machine.js';
import STRINGS from './skeeball/js/strings.js';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./skeeball/js/boards.js', import.meta.url), 'utf8');

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

  const odd = holes.filter(([, h]) => Math.abs(h.r - G.holeR) > EPS).map(([id]) => id);
  rule(board, 'holes.uniform', odd.length === 0,
    `every hole must use holeR (${(G.holeR / X).toFixed(3)}X); these differ: ${odd.join(', ')}`);

  const outside = holes.filter(([, h]) =>
    Math.abs(h.u) + G.holeR > G.boardW / 2 + EPS
    || h.v - G.holeR < -EPS
    || h.v + G.holeR > G.boardLen + EPS).map(([id]) => id);
  rule(board, 'holes.inside', outside.length === 0,
    `hole centres must sit at least holeR from every face edge; too close: ${outside.join(', ')}`);

  const tooClose = [];
  for (let i = 0; i < holes.length; i++) {
    for (let k = i + 1; k < holes.length; k++) {
      const [idA, A] = holes[i];
      const [idB, B] = holes[k];
      const d = Math.hypot(A.u - B.u, A.v - B.v) / X;
      if (d < 1.30 - 1e-3) tooClose.push(`${idA}-${idB} ${d.toFixed(3)}X`);
    }
  }
  rule(board, 'holes.spacing', tooClose.length === 0,
    `hole centres must be at least 1.30X apart: ${tooClose.join(', ')}`);

  const badValue = holes.filter(([, h]) => !(h.value >= 0)).map(([id]) => id);
  rule(board, 'holes.frozen', badValue.length === 0,
    `every hole needs a numeric value: ${badValue.join(', ')}`);

  // --- 8 rings ------------------------------------------------------------------------------
  const M = buildMachine(G);
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
