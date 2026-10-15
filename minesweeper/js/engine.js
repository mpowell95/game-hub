// minesweeper/js/engine.js — pure Minesweeper rules: board generation, opening, flagging,
// chording, win/loss detection and the save shape. No DOM, no timers, no localStorage, no
// imports — the same headless-testable seam as snake/js/game.js and sudoku/js/*.js, which is
// what makes test-minesweeper-engine.mjs possible without a browser.
//
// State arrays are plain JS Arrays throughout, deliberately never typed arrays (Uint8Array etc):
// the state gets JSON.stringify'd straight into a localStorage save, and a typed array survives
// that round trip as an ordinary object of numeric-string keys, not the array the UI expects back.

export const LEVELS = {
  easy:   { w: 8,  h: 10, mines: 10, tier: 1 },
  medium: { w: 10, h: 13, mines: 20, tier: 2 },
  hard:   { w: 12, h: 16, mines: 38, tier: 3 },
  expert: { w: 14, h: 18, mines: 55, tier: 4 },
};

// Cell states.
export const HIDDEN = 0, OPEN = 1, FLAGGED = 2;
// (2026-10-15) The classic "?" mark: a note to self. It is NOT a flag (no count, no chord) and
// opens like a hidden cell. Saves made before it simply never contain a 3.
export const QUESTION = 3;
const closed = (c) => c === HIDDEN || c === QUESTION;

/** Flat index for (x, y) in this board's own width. */
export function idx(state, x, y) {
  return y * state.w + x;
}

export function inBounds(state, x, y) {
  return x >= 0 && x < state.w && y >= 0 && y < state.h;
}

/** The 8 orthogonal+diagonal neighbours of index `i` that are actually on the board. */
function neighborIndices(state, i) {
  const x = i % state.w;
  const y = Math.floor(i / state.w);
  const out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx, ny = y + dy;
      if (inBounds(state, nx, ny)) out.push(idx(state, nx, ny));
    }
  }
  return out;
}

/** A fresh, ungenerated state for `levelId`. An unknown id falls back to 'medium' rather than
 *  crashing a setup screen that read a stale or hand-edited settings key. */
export function createGame(levelId, opts = {}) {
  const level = LEVELS[levelId] ? levelId : 'medium';
  const { w, h, mines } = LEVELS[level];
  const total = w * h;
  return {
    level, w, h, mines,
    mine: new Array(total).fill(false),
    num: new Array(total).fill(0),
    cell: new Array(total).fill(HIDDEN),
    generated: false,
    dead: false,
    won: false,
    boom: -1,
    opened: 0,
    flags: 0,
    elapsedMs: 0,   // owned by ui.js; the engine only carries it so a save survives a reload
    noGuess: !!opts.noGuess,   // (2026-10-15) deal only boards logic alone can clear
  };
}

/** num[i] = -1 on a mine, otherwise the count of the up-to-8 mines touching cell i. */
function computeNum(state, mine) {
  const total = state.w * state.h;
  const num = new Array(total).fill(0);
  for (let i = 0; i < total; i++) {
    if (mine[i]) { num[i] = -1; continue; }
    let n = 0;
    for (const nb of neighborIndices(state, i)) if (mine[nb]) n++;
    num[i] = n;
  }
  return num;
}

/** One candidate placement: `mines` mines scattered outside the 3x3 block centred on the safe
 *  cell. A Fisher-Yates shuffle of the eligible cells, then take the first `mines` of it, is both
 *  simpler and exactly as uniform as repeatedly picking a random remaining index. */
function attemptPlacement(state, safeX, safeY, rnd) {
  const total = state.w * state.h;
  const forbidden = new Set();
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = safeX + dx, y = safeY + dy;
      if (inBounds(state, x, y)) forbidden.add(idx(state, x, y));
    }
  }
  const candidates = [];
  for (let i = 0; i < total; i++) if (!forbidden.has(i)) candidates.push(i);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = candidates[i]; candidates[i] = candidates[j]; candidates[j] = t;
  }
  const mine = new Array(total).fill(false);
  for (let i = 0; i < state.mines; i++) mine[candidates[i]] = true;
  return { mine, num: computeNum(state, mine) };
}

/** Places mines and fills `num`. Never puts a mine in the 3x3 block centred on (safeX, safeY) —
 *  that part is a hard guarantee, every attempt respects it. On top of that it TRIES to make the
 *  tapped cell a zero, so the very first tap opens an area instead of a single lonely number:
 *  up to 40 placements are tried and the first one that lands a zero on the safe cell is kept.
 *  40 is arbitrary but generous — a board dense enough to fail all 40 (Expert, 55/252 mines) is
 *  rare, and when it happens the zero is only ever best-effort, so the last attempt tried is used
 *  rather than looping forever or leaving the board only partially placed. */
export function generate(state, safeX, safeY, rnd = Math.random) {
  const safeIdx = idx(state, safeX, safeY);
  let chosen = null;
  let last = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const placement = attemptPlacement(state, safeX, safeY, rnd);
    last = placement;
    if (placement.num[safeIdx] === 0) { chosen = placement; break; }
  }
  const picked = chosen || last;
  state.mine = picked.mine;
  state.num = picked.num;
  state.generated = true;
  return state;
}

/** Opens `i`, assuming it is HIDDEN and not a mine (callers check both before calling this).
 *  Iterative flood fill with an explicit stack, not recursion — Expert's 252 cells make a
 *  recursive fill a needless stack-depth risk for a board this engine has to run everywhere
 *  including on a phone. A zero cell pulls in its HIDDEN neighbours (FLAGGED neighbours are
 *  skipped by construction, since only HIDDEN cells are ever pushed, so a flood never steals a
 *  flag out from under the player); a numbered cell stops the spread on that side. */
function floodOpen(state, i) {
  const changed = [];
  const stack = [i];
  while (stack.length) {
    const j = stack.pop();
    if (!closed(state.cell[j])) continue;   // opened via another path in this same fill, or flagged
    state.cell[j] = OPEN;
    state.opened++;
    changed.push(j);
    if (state.num[j] === 0) {
      for (const nb of neighborIndices(state, j)) {
        if (closed(state.cell[nb])) stack.push(nb);
      }
    }
  }
  return changed;
}

/** Opens (x, y). Generates the board first on the very first open of the game, using (x, y) as
 *  the safe cell. Opening a FLAGGED or already-OPEN cell is a no-op (you can't un-flag by tapping
 *  through it, and re-opening an open cell does nothing). A dead or already-won board is frozen —
 *  nothing left for a tap to do — which also means this can never run before generation happens,
 *  since neither state is reachable pre-generation. */
export function openCell(state, x, y, rnd) {
  if (!inBounds(state, x, y)) return { changed: [], hitMine: false };
  if (state.dead || state.won) return { changed: [], hitMine: false };
  if (!state.generated) (state.noGuess ? generateNoGuess : generate)(state, x, y, rnd);

  const i = idx(state, x, y);
  if (state.cell[i] === FLAGGED || state.cell[i] === OPEN) return { changed: [], hitMine: false };

  if (state.mine[i]) {
    state.cell[i] = OPEN;
    state.opened++;
    state.dead = true;
    state.boom = i;
    return { changed: [i], hitMine: true };
  }

  const changed = floodOpen(state, i);
  if (isWon(state)) state.won = true;
  return { changed, hitMine: false };
}

/** Flags a HIDDEN (or ?-marked) cell or clears a FLAGGED one; an OPEN cell can't be flagged (there is nothing
 *  left to protect). Never touches `won` — flagging is bookkeeping, not a way to win. */
export function toggleFlag(state, x, y) {
  if (!inBounds(state, x, y)) return { changed: [] };
  const i = idx(state, x, y);
  if (closed(state.cell[i])) {
    state.cell[i] = FLAGGED;
    state.flags++;
    return { changed: [i] };
  }
  if (state.cell[i] === FLAGGED) {
    state.cell[i] = HIDDEN;
    state.flags--;
    return { changed: [i] };
  }
  return { changed: [] };
}

/** Flag mode's tap: blank -> flag -> ? -> blank, the classic right-click cycle. With `marks` off
 *  it is exactly toggleFlag (blank <-> flag); a ? left over from when marks were on clears. */
export function cycleMark(state, x, y, marks) {
  if (!inBounds(state, x, y) || state.dead || state.won) return { changed: [] };
  const i = idx(state, x, y);
  const c = state.cell[i];
  if (c === HIDDEN) return toggleFlag(state, x, y);
  if (c === FLAGGED) {
    toggleFlag(state, x, y);
    if (marks) state.cell[i] = QUESTION;
    return { changed: [i] };
  }
  if (c === QUESTION) { state.cell[i] = HIDDEN; return { changed: [i] }; }
  return { changed: [] };
}

/** The classic "click a satisfied number to open the rest" shortcut. Only fires on an OPEN
 *  numbered cell whose FLAGGED-neighbour count exactly equals its number — that equality is the
 *  whole safety check, and it is exactly as trustworthy as the player's own flags. A flag on the
 *  wrong cell still satisfies the count, so chord opens the real (unflagged) mine right along with
 *  the rest of the neighbours: this is the classic, sharp-edged way a careless chord kills you,
 *  not a bug to guard against. `rnd` is accepted only so the call site can pass the same signature
 *  as openCell; chord never generates a board, so it's unused. */
export function chord(state, x, y, rnd) {
  if (!inBounds(state, x, y)) return { changed: [], hitMine: false };
  if (state.dead || state.won) return { changed: [], hitMine: false };

  const i = idx(state, x, y);
  if (state.cell[i] !== OPEN) return { changed: [], hitMine: false };
  const n = state.num[i];
  if (n <= 0) return { changed: [], hitMine: false };

  const neighbors = neighborIndices(state, i);
  let flagged = 0;
  for (const nb of neighbors) if (state.cell[nb] === FLAGGED) flagged++;
  if (flagged !== n) return { changed: [], hitMine: false };

  const changed = [];
  let hitMine = false;
  for (const nb of neighbors) {
    if (!closed(state.cell[nb])) continue;   // already open, or flagged and left alone (a ? opens)
    if (state.mine[nb]) {
      state.cell[nb] = OPEN;
      state.opened++;
      changed.push(nb);
      hitMine = true;
      // Only the FIRST mine opened by this chord owns `boom` — a chord can open more than one
      // mine in one move (several misplaced flags), and the lose screen should point at the one
      // that actually ended the game, not whichever happened to be iterated last.
      if (!state.dead) { state.dead = true; state.boom = nb; }
      continue;
    }
    changed.push(...floodOpen(state, nb));
  }
  if (!hitMine && isWon(state)) state.won = true;
  return { changed, hitMine };
}

/** True once every non-mine cell is OPEN. Flags never factor in (you can win with every mine
 *  still unflagged, or none flagged at all) — the classic rule, and it's cheap enough at up to
 *  252 cells (Expert) to just scan rather than trust a running counter that flood fill, chord and
 *  revealAll would each have to keep in perfect sync. */
export function isWon(state) {
  const total = state.w * state.h;
  for (let i = 0; i < total; i++) {
    if (!state.mine[i] && state.cell[i] !== OPEN) return false;
  }
  return true;
}

/** For the lose screen: opens every mine that is still HIDDEN. A FLAGGED cell is left exactly as
 *  it is, whether the flag is right (a flagged mine, which should still read as flagged, not as an
 *  ordinary opened cell) or wrong (a flag on a safe cell, which the UI draws struck through) —
 *  either way, overwriting FLAGGED with OPEN here would erase the one bit that tells them apart. */
export function revealAll(state) {
  const total = state.w * state.h;
  for (let i = 0; i < total; i++) {
    if (state.mine[i] && closed(state.cell[i])) {
      state.cell[i] = OPEN;
      state.opened++;
    }
  }
  return state;
}

/** The classic counter: mines minus flags planted. Allowed to go negative — over-flagging past
 *  the mine count is a real (if useless) thing a player can do, and the classic counter shows it
 *  rather than clamping it away. */
export function minesLeft(state) {
  return state.mines - state.flags;
}

/** 0-100, how much of the board is cleared. Clamped at the top: a chord that opens several
 *  misplaced-flag mines in one move can (rarely) push the raw ratio past 100%, and this is a
 *  percentage, not a raw count, so the display value stays in the range its name promises. */
export function clearedPct(state) {
  const total = state.w * state.h - state.mines;
  if (total <= 0) return 100;   // degenerate board (mines >= cells); nothing to clear
  return Math.min(100, Math.round((state.opened / total) * 100));
}

/** How many of the player's flags actually sit on a mine. */
export function correctFlags(state) {
  let n = 0;
  const total = state.w * state.h;
  for (let i = 0; i < total; i++) if (state.cell[i] === FLAGGED && state.mine[i]) n++;
  return n;
}

/** How many of the player's flags sit on a SAFE cell: the ones a loss shows struck through. */
export function wrongFlags(state) {
  let n = 0;
  const total = state.w * state.h;
  for (let i = 0; i < total; i++) if (state.cell[i] === FLAGGED && !state.mine[i]) n++;
  return n;
}

/* ---------------------------------------------------------------------------------------------
 * LOGIC (2026-10-15): what can be PROVED from the open numbers alone. Two uses:
 *   - no-guess boards: deal a board only if logic, from the first tap, clears it with no guess;
 *   - why a board was lost: was the square that killed you provably a mine, a forced guess, a guess
 *     while a safe square was on offer, or a provable mine right beside a provable safe square
 *     (which reads as a finger slip)?
 * It sees ONLY what a player sees (open cells and their numbers, the mine count) and never the
 * player's flags, which may be wrong. Exact: every mine layout each group of numbers allows is
 * counted, so "provably safe" means safe in every layout. A node cap keeps a phone responsive;
 * hitting it returns `capped`, never a wrong answer.
 * ------------------------------------------------------------------------------------------- */
const NODE_CAP = 200000;

/** `open[i]` true = a number the player can see. Returns { safe:Set, mine:Set, capped }. */
function deduce(w, h, mines, num, open) {
  const total = w * h;
  const nb = (i) => { const x = i % w, y = (i / w) | 0, o = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const a = x + dx, b = y + dy; if ((dx || dy) && a >= 0 && b >= 0 && a < w && b < h) o.push(b * w + a); } return o; };
  const known = new Set();      // proved mines
  const safe = new Set();
  let capped = false;
  for (let round = 0; round < total; round++) {
    let changed = false;
    const cons = [];
    for (let i = 0; i < total; i++) {
      if (!open[i] || num[i] <= 0) continue;
      const vars = [], around = nb(i); let need = num[i];
      for (const j of around) { if (open[j]) continue; if (known.has(j)) need--; else if (!safe.has(j)) vars.push(j); }
      if (vars.length) cons.push({ vars, need });
    }
    // the cheap rules first
    for (const c of cons) {
      if (c.need === 0) for (const v of c.vars) { if (!safe.has(v)) { safe.add(v); changed = true; } }
      else if (c.need === c.vars.length) for (const v of c.vars) { if (!known.has(v)) { known.add(v); changed = true; } }
    }
    if (changed) continue;
    // exact count, one connected group of numbers at a time
    const front = [...new Set(cons.flatMap((c) => c.vars))];
    const comp = new Map(); let k = 0;
    for (const v of front) {
      if (comp.has(v)) continue;
      const st = [v]; comp.set(v, k);
      while (st.length) { const u = st.pop(); for (const c of cons) if (c.vars.includes(u)) for (const x of c.vars) if (!comp.has(x)) { comp.set(x, k); st.push(x); } }
      k++;
    }
    for (let q = 0; q < k; q++) {
      const vars = front.filter((v) => comp.get(v) === q);
      const cs = cons.filter((c) => comp.get(c.vars[0]) === q);
      const at = new Map(vars.map((v, i) => [v, i]));
      const a = new Int8Array(vars.length).fill(-1), cnt = new Float64Array(vars.length);
      let tot = 0, nodes = 0;
      const ok = () => { for (const c of cs) { let m = 0, u = 0; for (const v of c.vars) { const x = a[at.get(v)]; if (x === 1) m++; else if (x === -1) u++; } if (m > c.need || m + u < c.need) return false; } return true; };
      const rec = (d) => { if (++nodes > NODE_CAP) return; if (d === vars.length) { tot++; for (let i = 0; i < vars.length; i++) if (a[i] === 1) cnt[i]++; return; } for (const val of [0, 1]) { a[d] = val; if (ok()) rec(d + 1); } a[d] = -1; };
      rec(0);
      if (nodes > NODE_CAP) { capped = true; continue; }
      if (!tot) continue;
      for (let i = 0; i < vars.length; i++) {
        if (cnt[i] === 0 && !safe.has(vars[i])) { safe.add(vars[i]); changed = true; }
        else if (cnt[i] === tot && !known.has(vars[i])) { known.add(vars[i]); changed = true; }
      }
    }
    if (changed) continue;
    // the mine count: every mine proved means every other closed square is safe, and vice versa
    let closedLeft = 0; const rest = [];
    for (let i = 0; i < total; i++) if (!open[i] && !known.has(i) && !safe.has(i)) { closedLeft++; rest.push(i); }
    const minesLeft = mines - known.size;
    if (rest.length && minesLeft === 0) { for (const i of rest) safe.add(i); changed = true; }
    else if (rest.length && minesLeft === closedLeft) { for (const i of rest) known.add(i); changed = true; }
    if (!changed) break;
  }
  return { safe, mine: known, capped };
}

/** True if, from opening `start`, logic alone opens every safe square. */
function clearsWithoutGuessing(w, h, mines, mine, num, start) {
  const total = w * h;
  const open = new Uint8Array(total);
  const nb = (i) => { const x = i % w, y = (i / w) | 0, o = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const a = x + dx, b = y + dy; if ((dx || dy) && a >= 0 && b >= 0 && a < w && b < h) o.push(b * w + a); } return o; };
  let opened = 0;
  const flood = (s) => { const st = [s]; while (st.length) { const j = st.pop(); if (open[j] || mine[j]) continue; open[j] = 1; opened++; if (num[j] === 0) for (const n of nb(j)) if (!open[n]) st.push(n); } };
  flood(start);
  const safeTotal = total - mines;
  for (let guard = 0; guard < total; guard++) {
    if (opened >= safeTotal) return true;
    const r = deduce(w, h, mines, num, open);
    if (r.capped) return false;
    let moved = false;
    for (const s of r.safe) if (!open[s]) { flood(s); moved = true; }
    if (!moved) return false;
  }
  return opened >= safeTotal;
}

/** Like generate(), but only keeps a board logic clears from the first tap with no guess. Tries
 *  until a board passes or `budgetMs` runs out; then keeps the last one and marks it, so a slow
 *  phone is never left hanging (`state.noGuessOk` says which). */
export function generateNoGuess(state, safeX, safeY, rnd = Math.random, budgetMs = 2500) {
  const start = idx(state, safeX, safeY);
  const t0 = Date.now();
  let picked = null, ok = false;
  for (let attempt = 0; attempt < 2000; attempt++) {
    const p = attemptPlacement(state, safeX, safeY, rnd);
    picked = p;
    if (clearsWithoutGuessing(state.w, state.h, state.mines, p.mine, p.num, start)) { ok = true; break; }
    if (Date.now() - t0 > budgetMs) break;
  }
  state.mine = picked.mine;
  state.num = picked.num;
  state.generated = true;
  state.noGuessOk = ok;
  return state;
}

/** Why a lost board was lost, from what the player could see just before the fatal tap.
 *  `how` is 'chord' when a chord opened the mine. Returns one of:
 *  'chord'   - a chord, so a flag was wrong;
 *  'slip'    - the square was provably a mine and a provably safe square was right beside it;
 *  'misread' - the square was provably a mine, with no safe square beside it;
 *  'rushed'  - a guess, while a provably safe square was on the board somewhere;
 *  'forced'  - a guess with no provably safe square anywhere (the board demanded it);
 *  'unknown' - the logic ran out of time (a very tangled board). */
export function lossCause(state, how) {
  if (!state || !state.dead || state.boom < 0) return 'unknown';
  if (how === 'chord') return 'chord';
  const total = state.w * state.h;
  const open = new Uint8Array(total);
  for (let i = 0; i < total; i++) if (state.cell[i] === OPEN && !state.mine[i]) open[i] = 1;
  const r = deduce(state.w, state.h, state.mines, state.num, open);
  if (r.capped) return 'unknown';
  const f = state.boom;
  if (r.mine.has(f)) return neighborIndices(state, f).some((j) => r.safe.has(j) && !open[j]) ? 'slip' : 'misread';
  for (const s of r.safe) if (!open[s]) return 'rushed';
  return 'forced';
}

/** A plain, JSON-safe snapshot. The state object is already built entirely from plain values, so
 *  this just copies the arrays (never hand the live arrays out — a caller mutating the "snapshot"
 *  must not mutate the real game). */
export function serialize(state) {
  return {
    level: state.level, w: state.w, h: state.h, mines: state.mines,
    mine: state.mine.slice(),
    num: state.num.slice(),
    cell: state.cell.slice(),
    generated: state.generated,
    dead: state.dead,
    won: state.won,
    boom: state.boom,
    opened: state.opened,
    flags: state.flags,
    elapsedMs: state.elapsedMs,
    noGuess: !!state.noGuess,
  };
}

function isPlainObject(o) {
  return o !== null && typeof o === 'object' && !Array.isArray(o);
}

/** The inverse of serialize(), and the one function here that MUST NEVER THROW: a save is
 *  arbitrary localStorage content by the time it comes back, and a corrupt or hand-edited save
 *  has to read as "no save" and quietly start a fresh game, never crash the game on load. Every
 *  check below is a reason to return null rather than guess: wrong type, unknown level, a
 *  level/w/h/mines mismatch (this engine only ever produces the LEVELS-matching combination, so a
 *  mismatch means the save was tampered with or is from code this engine no longer recognises),
 *  wrong array lengths, or a cell value outside the three known states. */
export function deserialize(obj) {
  try {
    if (!isPlainObject(obj)) return null;
    const { level, w, h, mines, mine, num, cell, generated, dead, won, boom, opened, flags, elapsedMs, noGuess } = obj;

    if (typeof level !== 'string' || !LEVELS[level]) return null;
    const L = LEVELS[level];
    if (w !== L.w || h !== L.h || mines !== L.mines) return null;

    const total = w * h;
    if (!Array.isArray(mine) || mine.length !== total) return null;
    if (!Array.isArray(num) || num.length !== total) return null;
    if (!Array.isArray(cell) || cell.length !== total) return null;
    for (let i = 0; i < total; i++) {
      if (cell[i] !== HIDDEN && cell[i] !== OPEN && cell[i] !== FLAGGED && cell[i] !== QUESTION) return null;
    }

    return {
      level, w, h, mines,
      mine: mine.map((v) => !!v),
      num: num.map((v) => (Number.isFinite(v) ? v : 0)),
      cell: cell.slice(),
      generated: !!generated,
      dead: !!dead,
      won: !!won,
      boom: Number.isFinite(boom) ? boom : -1,
      opened: Number.isFinite(opened) ? opened : 0,
      flags: Number.isFinite(flags) ? flags : 0,
      elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : 0,
      noGuess: noGuess === true,   // a save from before 2026-10-15 has none: an ordinary board
    };
  } catch {
    return null;
  }
}

export default {
  LEVELS, HIDDEN, OPEN, FLAGGED, QUESTION,
  idx, inBounds,
  createGame, generate, openCell, toggleFlag, chord,
  isWon, revealAll, minesLeft, clearedPct, correctFlags, wrongFlags, cycleMark,
  generateNoGuess, lossCause,
  serialize, deserialize,
};
