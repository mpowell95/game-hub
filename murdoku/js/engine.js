// murdoku/js/engine.js - the whole puzzle: layout, clues, solvers, generator. No DOM, no imports,
// so `node murdoku/js/test.js` drives it headless (the same seam as sudoku/js/*.js).
//
// THE RULES (our own version of the Murdoku format; see murdoku/CLAUDE.md, "Where the rules came
// from"):
//   - An N x N floor plan split into rooms. N people, one of them the victim.
//   - Exactly one person in every row and every column.
//   - Nobody stands on a blocking object (plant, shelf, piano, TV). A chair or a rug can be
//     stood/sat on.
//   - Every clue is true. Clues alone decide the board: every generated puzzle has exactly ONE
//     arrangement, proved by a solver before it is ever shown.
//   - The murderer is the one person alone in a room with the victim. That is the reveal, not a
//     rule the solver leans on; the generator only guarantees the solution has that shape.
//
// Cells are indexed r * N + c, row 0 at the top. "Beside" means orthogonally next to AND in the
// same room (a wall between two cells means they are not beside each other).

export const SAVE_V = 1;

// ---- the cast ----------------------------------------------------------------------------------
// Matt, 2026-09-30: "Make the characters names Ana, Elena, Natalia, Alba, and Sandra. Change who the
// dead person is each time. And use better emojis. And all female emojis." The first CORE_CAST are
// in EVERY case (an Easy case is exactly them); a bigger board adds from the rest. The victim is
// one of them, a different one each case (always LAST in `people`, so she ends the suspect list).
// Each woman has her own profession, so the faces tell apart at token size by the prop (hat,
// palette, goggles...). Names are not translated (they are names).
export const CAST = [
  { id: 'ana', name: 'Ana', face: '\u{1F469}\u200D\u{1F373}' },          // chef
  { id: 'elena', name: 'Elena', face: '\u{1F469}\u200D\u{1F3A8}' },      // artist
  { id: 'natalia', name: 'Natalia', face: '\u{1F469}\u200D\u{1F52C}' },  // scientist
  { id: 'alba', name: 'Alba', face: '\u{1F469}\u200D\u{1F3EB}' },        // teacher
  { id: 'sandra', name: 'Sandra', face: '\u{1F469}\u200D\u2708\uFE0F' }, // pilot
  { id: 'lucia', name: 'Lucía', face: '\u{1F469}\u200D\u{1F3A4}' },      // singer
  { id: 'carmen', name: 'Carmen', face: '\u{1F469}\u200D\u2695\uFE0F' }, // doctor
  { id: 'marta', name: 'Marta', face: '\u{1F469}\u200D\u{1F33E}' },      // farmer
];
export const CORE_CAST = 5;
/** The first cast (to 2026-09-30), kept ONLY so a case saved before the change still shows its
 *  people. Never picked for a new case. */
const LEGACY_CAST = [
  { id: 'ada', name: 'Ada', face: '\u{1F469}' }, { id: 'bruno', name: 'Bruno', face: '\u{1F9D4}' },
  { id: 'clara', name: 'Clara', face: '\u{1F475}' }, { id: 'dante', name: 'Dante', face: '\u{1F474}' },
  { id: 'felix', name: 'Felix', face: '\u{1F466}' }, { id: 'greta', name: 'Greta', face: '\u{1F478}' },
  { id: 'hugo', name: 'Hugo', face: '\u{1F934}' }, { id: 'iris', name: 'Iris', face: '\u{1F9D5}' },
  { id: 'jonas', name: 'Jonas', face: '\u{1F473}' }, { id: 'victor', name: 'Victor', face: '\u{1F480}' },
];

// ---- rooms and objects -------------------------------------------------------------------------
export const ROOMS = ['kitchen', 'library', 'hall', 'study', 'lounge', 'ballroom', 'dining', 'garden', 'bedroom', 'cellar'];
export const ROOM_ICON = {
  kitchen: '\u{1F373}', library: '\u{1F4D6}', hall: '\u{1F6AA}', study: '✒️',
  lounge: '\u{1F6CB}️', ballroom: '\u{1F483}', dining: '\u{1F377}', garden: '\u{1F333}',
  bedroom: '\u{1F6CF}️', cellar: '\u{1F56F}️',
};
// Blocking objects: nobody can be on that square.
export const BLOCKERS = ['plant', 'shelf', 'piano', 'tv'];
// Seats: somebody can be on that square, and a clue can say so.
export const SEATS = ['chair', 'rug'];
export const OBJ_ICON = {
  plant: '\u{1FAB4}', shelf: '\u{1F4DA}', piano: '\u{1F3B9}', tv: '\u{1F4FA}', chair: '\u{1FA91}', rug: '',
};
export const isBlocker = (o) => BLOCKERS.indexOf(o) >= 0;

// ---- difficulty --------------------------------------------------------------------------------
export const TIERS = ['easy', 'medium', 'hard', 'expert'];
export const TIER_N = { easy: 5, medium: 6, hard: 7, expert: 8 };
const TIER_ROOMS = { easy: [4, 4], medium: [4, 5], hard: [5, 6], expert: [6, 7] };
// How likely each clue kind is to be picked. Easy leans on "where" clues; the harder tiers lean
// on clues that only mean something once somebody else is placed.
const WEIGHTS = {
  easy:   { in: 6, on: 4, by: 3, row: 3, corner: 2, above: 1, left: 1, with: 1, alone: 1 },
  medium: { in: 3, on: 3, by: 3, row: 2, corner: 1, above: 2, left: 2, diag: 1, with: 2, alone: 2, notin: 1 },
  hard:   { in: 1, on: 2, by: 3, row: 1, corner: 1, above: 3, left: 3, diag: 3, with: 3, alone: 2, notin: 2, north: 1, west: 1 },
  expert: { in: 1, on: 2, by: 2, row: 1, above: 3, left: 3, diag: 3, with: 3, alone: 2, notin: 3, north: 2, west: 2, notwith: 1 },
};
// Which deductions a tier's puzzle must be solvable by (see humanSolve), and the level it must
// NOT be solvable by (so a hard puzzle is really harder than a medium one). No tier ever needs a
// guess: every puzzle is finished by the human solver before it is shown.
const TIER_LEVEL = { easy: 1, medium: 2, hard: 3, expert: 3 };
const TIER_FLOOR = { medium: 1, hard: 1, expert: 1 };

// ---- rng ---------------------------------------------------------------------------------------
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ri = (r, n) => Math.floor(r() * n);
function shuffle(r, a) { for (let i = a.length - 1; i > 0; i--) { const j = ri(r, i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function pickWeighted(r, items, w) {
  let tot = 0; for (const it of items) tot += w(it);
  if (tot <= 0) return null;
  let x = r() * tot;
  for (const it of items) { x -= w(it); if (x < 0) return it; }
  return items[items.length - 1];
}
/** Pick a clue KIND by weight first, then one clue of that kind. Weighting clues one by one would
 *  let a kind with many true instances ("not in the X", one per room) drown out the rest. */
function pickClue(r, opts, W) {
  const kinds = [...new Set(opts.map((cl) => weightKey(cl.k)))].filter((k) => (W[k] | 0) > 0);
  const k = pickWeighted(r, kinds, (kk) => W[kk] | 0);
  if (!k) return null;
  const of = opts.filter((cl) => weightKey(cl.k) === k);
  return of[ri(r, of.length)];
}

// ---- geometry ----------------------------------------------------------------------------------
const rowOf = (n, s) => (s / n) | 0;
const colOf = (n, s) => s % n;
function neighbours(n, s) {
  const r = rowOf(n, s), c = colOf(n, s), out = [];
  if (r > 0) out.push(s - n);
  if (r < n - 1) out.push(s + n);
  if (c > 0) out.push(s - 1);
  if (c < n - 1) out.push(s + 1);
  return out;
}

// ---- clue evaluation ---------------------------------------------------------------------------
// A clue: { p, k, a?, b? } - p the person it is about, k the kind, a a room/object/edge, b another
// person. `holds` answers true / false / null (not decidable yet) against a PARTIAL placement
// `pos` (cell per person, -1 = not placed). Only `false` prunes; the full check is at a leaf.
export function holds(puz, cl, pos) {
  const n = puz.n, s = pos[cl.p];
  if (s < 0) return null;
  const r = rowOf(n, s), c = colOf(n, s);
  switch (cl.k) {
    case 'in': return puz.rooms[s] === cl.a;
    case 'notin': return puz.rooms[s] !== cl.a;
    case 'on': return puz.objects[s] === cl.a;
    case 'by': return neighbours(n, s).some((t) => puz.rooms[t] === puz.rooms[s] && puz.objects[t] === cl.a);
    case 'row':
      if (cl.a === 'top') return r === 0;
      if (cl.a === 'bottom') return r === n - 1;
      if (cl.a === 'left') return c === 0;
      return c === n - 1;
    case 'corner': return (r === 0 || r === n - 1) && (c === 0 || c === n - 1);
    case 'alone': {
      let undecided = false;
      for (let q = 0; q < pos.length; q++) {
        if (q === cl.p) continue;
        if (pos[q] < 0) { undecided = true; continue; }
        if (puz.rooms[pos[q]] === puz.rooms[s]) return false;
      }
      return undecided ? null : true;
    }
    default: break;
  }
  const t = pos[cl.b];
  if (t < 0) return null;
  const r2 = rowOf(n, t), c2 = colOf(n, t);
  switch (cl.k) {
    case 'above': return r === r2 - 1;          // exactly one row above b
    case 'below': return r === r2 + 1;
    case 'left': return c === c2 - 1;           // in the column just left of b
    case 'right': return c === c2 + 1;
    case 'diag': return Math.abs(r - r2) === 1 && Math.abs(c - c2) === 1;
    case 'north': return r < r2;                // somewhere above b
    case 'west': return c < c2;                 // somewhere left of b
    case 'with': return puz.rooms[s] === puz.rooms[t];
    case 'notwith': return puz.rooms[s] !== puz.rooms[t];
    default: return false;
  }
}
const UNARY = new Set(['in', 'notin', 'on', 'by', 'row', 'corner']);
const BINARY = new Set(['above', 'below', 'left', 'right', 'diag', 'north', 'west', 'with', 'notwith']);
export const isUnary = (cl) => UNARY.has(cl.k);

/** Every true statement the generator could make about person p in the solution. */
function cluePool(puz, sol, p, victim) {
  const n = puz.n, s = sol[p], out = [];
  const r = rowOf(n, s), c = colOf(n, s), room = puz.rooms[s];
  out.push({ p, k: 'in', a: room });
  for (const rm of puz.roomIds) if (rm !== room) out.push({ p, k: 'notin', a: rm });
  if (puz.objects[s] && !isBlocker(puz.objects[s])) out.push({ p, k: 'on', a: puz.objects[s] });
  const seen = new Set();
  for (const t of neighbours(n, s)) {
    const o = puz.objects[t];
    if (o && puz.rooms[t] === room && !seen.has(o)) { seen.add(o); out.push({ p, k: 'by', a: o }); }
  }
  if (r === 0) out.push({ p, k: 'row', a: 'top' });
  if (r === n - 1) out.push({ p, k: 'row', a: 'bottom' });
  if (c === 0) out.push({ p, k: 'row', a: 'left' });
  if (c === n - 1) out.push({ p, k: 'row', a: 'right' });
  if ((r === 0 || r === n - 1) && (c === 0 || c === n - 1)) out.push({ p, k: 'corner' });
  let alone = true;
  for (let q = 0; q < sol.length; q++) {
    if (q === p) continue;
    const t = sol[q], r2 = rowOf(n, t), c2 = colOf(n, t);
    const sameRoom = puz.rooms[t] === room;
    if (sameRoom) alone = false;
    if (r === r2 - 1) out.push({ p, k: 'above', b: q });
    if (r === r2 + 1) out.push({ p, k: 'below', b: q });
    if (c === c2 - 1) out.push({ p, k: 'left', b: q });
    if (c === c2 + 1) out.push({ p, k: 'right', b: q });
    if (Math.abs(r - r2) === 1 && Math.abs(c - c2) === 1) out.push({ p, k: 'diag', b: q });
    if (r < r2 && r !== r2 - 1) out.push({ p, k: 'north', b: q });
    if (c < c2 && c !== c2 - 1) out.push({ p, k: 'west', b: q });
    // "Same room as" between the victim and anyone would hand over the answer without the board.
    if (p !== victim && q !== victim) {
      if (sameRoom) out.push({ p, k: 'with', b: q });
      else out.push({ p, k: 'notwith', b: q });
    }
  }
  if (alone) out.push({ p, k: 'alone' });
  return out;
}
const weightKey = (k) => (k === 'below' ? 'above' : k === 'right' ? 'left' : k);

// ---- the search solver (proves uniqueness) -----------------------------------------------------
/** Static per-person domains from the unary clues and the blockers. */
function staticDomains(puz, clues) {
  const n = puz.n, P = puz.people.length, doms = [];
  const pos = new Array(P).fill(-1);
  for (let p = 0; p < P; p++) {
    const mine = clues.filter((cl) => cl.p === p && UNARY.has(cl.k));
    const d = [];
    for (let s = 0; s < n * n; s++) {
      if (isBlocker(puz.objects[s])) continue;
      pos[p] = s;
      if (mine.every((cl) => holds(puz, cl, pos) !== false)) d.push(s);
    }
    pos[p] = -1;
    doms.push(d);
  }
  return doms;
}

/** Count arrangements consistent with `clues`, stopping at `limit`. Returns { count, sols }. */
export function countSolutions(puz, clues, limit = 2) {
  const n = puz.n, P = puz.people.length;
  const doms = staticDomains(puz, clues);
  const nonUnary = clues.filter((cl) => !UNARY.has(cl.k));
  const involving = Array.from({ length: P }, () => []);
  const alones = nonUnary.filter((cl) => cl.k === 'alone');
  for (const cl of nonUnary) {
    if (cl.k === 'alone') continue;
    involving[cl.p].push(cl);
    if (cl.b !== undefined) involving[cl.b].push(cl);
  }
  for (const cl of alones) involving[cl.p].push(cl);
  const pos = new Array(P).fill(-1);
  let rowUsed = 0, colUsed = 0, count = 0;
  const sols = [];
  function ok(p) {
    for (const cl of involving[p]) if (holds(puz, cl, pos) === false) return false;
    for (const cl of alones) if (cl.p !== p && pos[cl.p] >= 0 && holds(puz, cl, pos) === false) return false;
    return true;
  }
  function cands(p) {
    const out = [];
    for (const s of doms[p]) {
      if (rowUsed & (1 << rowOf(n, s)) || colUsed & (1 << colOf(n, s))) continue;
      pos[p] = s;
      if (ok(p)) out.push(s);
      pos[p] = -1;
    }
    return out;
  }
  function rec(placed) {
    if (count >= limit) return;
    if (placed === P) {
      if (clues.every((cl) => holds(puz, cl, pos) === true)) { count++; sols.push(pos.slice()); }
      return;
    }
    let best = -1, bestC = null;
    for (let p = 0; p < P; p++) {
      if (pos[p] >= 0) continue;
      const c = cands(p);
      if (!c.length) return;
      if (!bestC || c.length < bestC.length) { best = p; bestC = c; if (c.length === 1) break; }
    }
    for (const s of bestC) {
      pos[best] = s; rowUsed |= 1 << rowOf(n, s); colUsed |= 1 << colOf(n, s);
      rec(placed + 1);
      pos[best] = -1; rowUsed &= ~(1 << rowOf(n, s)); colUsed &= ~(1 << colOf(n, s));
      if (count >= limit) return;
    }
  }
  rec(0);
  return { count, sols };
}

// ---- the human solver (grades easy / medium) ---------------------------------------------------
/** Solve by deductions a person would make, never by guessing. level 1: singles (a person with
 *  one possible square; a row or column only one person can reach) plus the consequences of
 *  each placement. level 2: adds clue-chain reasoning (arc consistency on two-person clues).
 *  Returns { solved, pos, steps }. Sound, so `solved` also proves the answer is unique. */
export function humanSolve(puz, clues, level, given) {
  const n = puz.n, P = puz.people.length;
  const doms = staticDomains(puz, clues).map((d) => new Set(d));
  const pos = new Array(P).fill(-1);
  const binary = clues.filter((cl) => BINARY.has(cl.k));
  const alones = clues.filter((cl) => cl.k === 'alone');
  const order = [];   // who was placed, in the order the deductions placed them
  let steps = 0;
  function place(p, s) {
    pos[p] = s; doms[p] = new Set([s]); steps++; order.push(p);
    const r = rowOf(n, s), c = colOf(n, s);
    for (let q = 0; q < P; q++) {
      if (q === p || pos[q] >= 0) continue;
      for (const t of [...doms[q]]) {
        if (rowOf(n, t) === r || colOf(n, t) === c) { doms[q].delete(t); continue; }
        pos[q] = t;
        let bad = false;
        for (const cl of binary) if ((cl.p === q && cl.b === p) || (cl.b === q && cl.p === p)) if (holds(puz, cl, pos) === false) { bad = true; break; }
        if (!bad) for (const cl of alones) if ((cl.p === p || cl.p === q) && holds(puz, cl, pos) === false) { bad = true; break; }
        pos[q] = -1;
        if (bad) doms[q].delete(t);
      }
    }
  }
  // Placements the player has already made (and got right) are taken as known.
  if (given) given.forEach((s, p) => { if (s >= 0 && doms[p].has(s)) place(p, s); });
  for (let guard = 0; guard < 500; guard++) {
    let progress = false;
    // naked single
    for (let p = 0; p < P; p++) {
      if (pos[p] < 0 && doms[p].size === 1) { place(p, [...doms[p]][0]); progress = true; }
    }
    if (progress) continue;
    // hidden single in a row / column: only one person can still reach that line
    for (let line = 0; line < n && !progress; line++) {
      for (const byRow of [true, false]) {
        const who = [];
        for (let p = 0; p < P; p++) {
          if ([...doms[p]].some((s) => (byRow ? rowOf(n, s) : colOf(n, s)) === line)) who.push(p);
        }
        if (who.length === 1 && pos[who[0]] < 0) {
          const p = who[0];
          const keep = [...doms[p]].filter((s) => (byRow ? rowOf(n, s) : colOf(n, s)) === line);
          if (keep.length < doms[p].size) { doms[p] = new Set(keep); progress = true; break; }
        }
      }
    }
    if (progress) continue;
    if (level >= 2) {
      // A person stuck on one line owns it (level 2), two people stuck on the same two lines
      // own both (level 3): nobody else can stand there.
      for (const byRow of [true, false]) {
        const line = (s) => (byRow ? rowOf(n, s) : colOf(n, s));
        const lines = doms.map((d) => new Set([...d].map(line)));
        const groups = [];
        for (let p = 0; p < P; p++) if (pos[p] < 0 && lines[p].size === 1) groups.push([p]);
        if (level >= 3) {
          for (let p = 0; p < P; p++) for (let q = p + 1; q < P; q++) {
            if (pos[p] >= 0 || pos[q] >= 0) continue;
            const u = new Set([...lines[p], ...lines[q]]);
            if (u.size === 2) groups.push([p, q]);
          }
        }
        for (const g of groups) {
          const owned = new Set(g.flatMap((p) => [...lines[p]]));
          for (let q = 0; q < P; q++) {
            if (g.indexOf(q) >= 0 || pos[q] >= 0) continue;
            for (const s of [...doms[q]]) if (owned.has(line(s))) { doms[q].delete(s); progress = true; }
          }
        }
      }
      if (progress) continue;
      // arc consistency: keep a square only if the other person in each clue still has a
      // square that makes the clue true. "Alone" is checked against every other person.
      const pairs = binary.map((cl) => [cl, cl.p, cl.b]);
      for (const cl of alones) for (let q = 0; q < P; q++) if (q !== cl.p) pairs.push([cl, cl.p, q]);
      for (const [cl, a, b] of pairs) {
        for (const [x, y] of [[a, b], [b, a]]) {
          if (pos[x] >= 0) continue;
          for (const s of [...doms[x]]) {
            let support = false;
            pos[x] = s;
            for (const t of doms[y]) {
              if (t !== pos[y] && (rowOf(n, t) === rowOf(n, s) || colOf(n, t) === colOf(n, s))) continue;
              if (t === s) continue;
              const was = pos[y]; pos[y] = t;
              const h = holds(puz, cl, pos);
              pos[y] = was;
              if (h !== false) { support = true; break; }
            }
            pos[x] = -1;
            if (!support) { doms[x].delete(s); progress = true; }
          }
        }
      }
    }
    if (!progress) break;
  }
  const solved = pos.every((s) => s >= 0) && clues.every((cl) => holds(puz, cl, pos) === true);
  return { solved, pos, steps, order };
}

// ---- layout ------------------------------------------------------------------------------------
function makeRooms(r, n, k) {
  const rooms = new Array(n * n).fill(-1);
  const seeds = shuffle(r, Array.from({ length: n * n }, (_, i) => i)).slice(0, k);
  const size = new Array(k).fill(1);
  seeds.forEach((s, i) => { rooms[s] = i; });
  let left = n * n - k;
  while (left > 0) {
    // grow the smallest-ish room that still has a free neighbour, so sizes stay comparable
    const order = shuffle(r, Array.from({ length: k }, (_, i) => i)).sort((a, b) => size[a] - size[b] + (r() - 0.5) * 3);
    let grew = false;
    for (const i of order) {
      const frontier = [];
      for (let s = 0; s < n * n; s++) {
        if (rooms[s] !== i) continue;
        for (const t of neighbours(n, s)) if (rooms[t] === -1) frontier.push(t);
      }
      if (!frontier.length) continue;
      const t = frontier[ri(r, frontier.length)];
      rooms[t] = i; size[i]++; left--; grew = true;
      break;
    }
    if (!grew) break;
  }
  return size.every((z) => z >= 3) ? rooms : null;
}

// ---- generator ---------------------------------------------------------------------------------
/** Build one puzzle. Deterministic for (tier, seed). Returns the plain, JSON-safe puzzle:
 *  { v, tier, seed, n, rooms[], roomIds[], roomNames{id: key}, objects[], people[], victim,
 *    killer, solution[], clues[] }. */
export function generate(tier, seed) {
  if (TIERS.indexOf(tier) < 0) tier = 'easy';
  const r = rng(seed);
  for (let attempt = 0; attempt < 200; attempt++) {
    const puz = tryGenerate(r, tier, seed);
    if (puz) return puz;
  }
  throw new Error('murdoku: could not generate a puzzle');
}

function tryGenerate(r, tier, seed) {
  const n = TIER_N[tier];
  const [kLo, kHi] = TIER_ROOMS[tier];
  const k = kLo + ri(r, kHi - kLo + 1);
  const rooms = makeRooms(r, n, k);
  if (!rooms) return null;

  // Solution: a random permutation (row -> column); people shuffled onto rows.
  const cols = shuffle(r, Array.from({ length: n }, (_, i) => i));
  // The core five always, the rest topped up at random; the shuffle then decides who is the
  // victim (the last one).
  const cast = shuffle(r, [...CAST.slice(0, CORE_CAST), ...shuffle(r, CAST.slice(CORE_CAST)).slice(0, n - CORE_CAST)]);
  const people = cast.map((c) => c.id);
  const victim = n - 1;
  const rowsFor = shuffle(r, Array.from({ length: n }, (_, i) => i));
  const solution = people.map((_, p) => rowsFor[p] * n + cols[rowsFor[p]]);

  // The victim's room must hold exactly one other person: that person is the murderer.
  const vRoom = rooms[solution[victim]];
  const inVRoom = solution.map((s, p) => (rooms[s] === vRoom && p !== victim ? p : -1)).filter((p) => p >= 0);
  if (inVRoom.length !== 1) return null;
  const killer = inVRoom[0];

  // Furniture: blockers on empty squares, seats sometimes under people and sometimes not.
  const objects = new Array(n * n).fill(null);
  const occupied = new Set(solution);
  const blockRate = 0.22 + r() * 0.08, seatRate = 0.1;
  for (let s = 0; s < n * n; s++) {
    if (occupied.has(s)) { if (r() < 0.35) objects[s] = SEATS[ri(r, SEATS.length)]; continue; }
    const x = r();
    if (x < blockRate) objects[s] = BLOCKERS[ri(r, BLOCKERS.length)];
    else if (x < blockRate + seatRate) objects[s] = SEATS[ri(r, SEATS.length)];
  }

  const roomKeys = shuffle(r, ROOMS.slice()).slice(0, k);
  const roomIds = Array.from({ length: k }, (_, i) => i);
  const puz = {
    v: SAVE_V, tier, seed, n, rooms, roomIds,
    roomNames: roomKeys, objects, people, victim, killer, solution, clues: [],
  };

  const W = WEIGHTS[tier];
  const pools = people.map((_, p) => cluePool(puz, solution, p, victim).filter((cl) => (W[weightKey(cl.k)] | 0) > 0));
  const clues = [];
  const perPerson = new Array(n).fill(0);
  const key = (cl) => `${cl.p}|${cl.k}|${cl.a}|${cl.b}`;
  const have = new Set();
  function add(cl) { clues.push(cl); have.add(key(cl)); perPerson[cl.p]++; }
  for (let p = 0; p < n; p++) {
    const c = pickClue(r, pools[p], W);
    if (!c) return null;
    add(c);
  }
  const level = TIER_LEVEL[tier];
  const MAX_PER = tier === 'medium' ? 2 : 3;

  // Add clues until the human solver finishes it at this tier's level.
  for (let guard = 0; ; guard++) {
    if (guard >= 40) return null;
    const hs = humanSolve(puz, clues, level);
    if (hs.solved) break;
    const open = [];
    for (let p = 0; p < n; p++) if (hs.pos[p] < 0 && perPerson[p] < MAX_PER) open.push(p);
    if (!open.length) return null;
    const p = open[ri(r, open.length)];
    const c = pickClue(r, pools[p].filter((cl) => !have.has(key(cl))), W);
    if (!c) return null;
    add(c);
  }
  minimise(r, puz, clues, (cs) => humanSolve(puz, cs, level).solved);
  // Too easy for the tier? A puzzle the tier below could finish is not this tier's.
  const floor = TIER_FLOOR[tier];
  if (floor && humanSolve(puz, clues, floor).solved) return null;
  puz.clues = clues.map((cl) => {
    const o = { p: cl.p, k: cl.k };
    if (cl.a !== undefined) o.a = cl.a;
    if (cl.b !== undefined) o.b = cl.b;
    return o;
  });
  return puz;
}

/** Drop clues one at a time (random order) while the puzzle stays solvable by `stillOk`. Every
 *  person keeps at least one clue, so nobody's card is ever blank. */
function minimise(r, puz, clues, stillOk) {
  const order = shuffle(r, clues.slice());
  for (const cl of order) {
    const i = clues.indexOf(cl);
    if (clues.filter((c) => c.p === cl.p).length <= 1) continue;
    clues.splice(i, 1);
    if (!stillOk(clues)) clues.splice(i, 0, cl);
  }
}

// ---- checking a player's board -----------------------------------------------------------------
/** Which clues the player's full or partial board breaks (indices into puz.clues), plus the
 *  placement-rule breaks: two people in one row/column, somebody on a blocker. */
export function checkBoard(puz, pos) {
  const n = puz.n;
  const broken = [];
  puz.clues.forEach((cl, i) => { if (holds(puz, cl, pos) === false) broken.push(i); });
  const rows = new Map(), cols = new Map(), clash = new Set(), blocked = [];
  pos.forEach((s, p) => {
    if (s < 0) return;
    if (isBlocker(puz.objects[s])) blocked.push(p);
    const r = rowOf(n, s), c = colOf(n, s);
    if (rows.has(r)) { clash.add(p); clash.add(rows.get(r)); } else rows.set(r, p);
    if (cols.has(c)) { clash.add(p); clash.add(cols.get(c)); } else cols.set(c, p);
  });
  const full = pos.every((s) => s >= 0);
  const solved = full && pos.every((s, p) => s === puz.solution[p]);
  return { broken, clash: [...clash], blocked, full, solved };
}

/** Everyone in the same room as the victim, by the player's (or the true) placement. */
export function roomMates(puz, pos, p) {
  const s = pos[p];
  if (s < 0) return [];
  return pos.map((t, q) => (q !== p && t >= 0 && puz.rooms[t] === puz.rooms[s] ? q : -1)).filter((q) => q >= 0);
}

export function personInfo(puz, p) {
  const id = puz.people[p];
  const who = CAST.find((c) => c.id === id) || LEGACY_CAST.find((c) => c.id === id) || { id, name: id, face: '?' };
  return { ...who, victim: p === puz.victim };
}

/** A puzzle from a save must be structurally whole before the UI touches it. */
export function validPuzzle(puz) {
  try {
    if (!puz || puz.v !== SAVE_V || TIERS.indexOf(puz.tier) < 0) return false;
    const n = puz.n;
    if (n !== TIER_N[puz.tier]) return false;
    if (!Array.isArray(puz.rooms) || puz.rooms.length !== n * n) return false;
    if (!Array.isArray(puz.objects) || puz.objects.length !== n * n) return false;
    if (!Array.isArray(puz.people) || puz.people.length !== n) return false;
    if (!Array.isArray(puz.solution) || puz.solution.length !== n) return false;
    if (!Array.isArray(puz.clues) || !puz.clues.length) return false;
    return true;
  } catch { return false; }
}

// ---- hints -------------------------------------------------------------------------------------
/** The squares each unplaced person could still take, judged only by what is VISIBLE on the board
 *  right now: their own clues, the blockers, the rows and columns already used, and every clue
 *  that links them to somebody already placed. This is what a player can check by eye. */
export function visibleDomains(puz, placed) {
  const n = puz.n, P = puz.people.length;
  const doms = staticDomains(puz, puz.clues);
  const rows = new Set(), cols = new Set(), cells = new Set();
  placed.forEach((s) => { if (s >= 0) { rows.add(rowOf(n, s)); cols.add(colOf(n, s)); cells.add(s); } });
  const linked = puz.clues.filter((cl) => !UNARY.has(cl.k));
  const pos = placed.slice();
  return doms.map((d, p) => {
    if (placed[p] >= 0) return [placed[p]];
    const out = [];
    for (const s of d) {
      if (cells.has(s) || rows.has(rowOf(n, s)) || cols.has(colOf(n, s))) continue;
      pos[p] = s;
      const ok = linked.every((cl) => (cl.p !== p && cl.b !== p && cl.k !== 'alone') || holds(puz, cl, pos) !== false);
      pos[p] = -1;
      if (ok) out.push(s);
    }
    return out;
  });
}

/** The next step a player could take from `pos` (their board), as plainly as it can be put:
 *    { k: 'wrong', p }            somebody is on a square that is not theirs (fix that first);
 *    { k: 'only', p, cells:[s] }  only one square left fits this person;
 *    { k: 'row'|'col', p, cells } this row/column still needs someone and only p can go there;
 *    { k: 'look', p, cells }      p is the next person logic pins down: these are their
 *                                 possible squares, and the other clues decide between them.
 *  null when the board is already solved. Every hint names ONE person, so the UI can select them. */
export function nextHint(puz, pos) {
  const n = puz.n, P = puz.people.length;
  for (let p = 0; p < P; p++) if (pos[p] >= 0 && pos[p] !== puz.solution[p]) return { k: 'wrong', p, cells: [pos[p]] };
  if (pos.every((s) => s >= 0)) return null;
  const doms = visibleDomains(puz, pos);
  for (let p = 0; p < P; p++) if (pos[p] < 0 && doms[p].length === 1) return { k: 'only', p, cells: doms[p] };
  for (const byRow of [true, false]) {
    const line = (s) => (byRow ? rowOf(n, s) : colOf(n, s));
    const used = new Set(pos.filter((s) => s >= 0).map(line));
    for (let i = 0; i < n; i++) {
      if (used.has(i)) continue;
      const who = [];
      for (let p = 0; p < P; p++) if (pos[p] < 0 && doms[p].some((s) => line(s) === i)) who.push(p);
      if (who.length === 1) {
        const p = who[0];
        return { k: byRow ? 'row' : 'col', p, cells: doms[p].filter((s) => line(s) === i) };
      }
    }
  }
  // Nothing is forced by sight alone: point at the person with the FEWEST squares left (the easiest
  // to test one by one), ties going to whoever the logic pins down first.
  const hs = humanSolve(puz, puz.clues, 3, pos);
  const rank = (q) => { const i = hs.order.indexOf(q); return i < 0 ? P : i; };
  let p = -1;
  for (let q = 0; q < P; q++) {
    if (pos[q] >= 0) continue;
    if (p < 0 || doms[q].length < doms[p].length || (doms[q].length === doms[p].length && rank(q) < rank(p))) p = q;
  }
  return { k: 'look', p, cells: doms[p].length ? doms[p] : [puz.solution[p]] };
}

export default { generate, countSolutions, humanSolve, checkBoard, holds, personInfo, validPuzzle };
