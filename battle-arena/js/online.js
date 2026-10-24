// battle-arena/js/online.js - what BOTH online modes share (2026-10-24): turn-by-turn challenges
// (mp.js) and live rooms (live.js). Pure: no DOM, no network, no storage.
//
// A MATCH ONLINE IS A SEED, TWO TEAMS AND A LIST OF MOVES. engine.js is deterministic (its RNG lives
// in the state), so every phone that replays the same moves from the same seed gets the same board,
// the same specials and the same winner. Nothing else is ever sent: no board, no HP.
//
// THE STORED FRAME: engine side 0 is side 'a' (the challenger, or the room's host), side 1 is 'b'.
// THE SCREEN'S FRAME: the battle screen always draws ITS player on the right as side 0 (ui.js `ME`).
// So the phone of side 'b' looks at a MIRRORED copy of the state (`mirror`): the two teams swapped,
// the board untouched. Every rule still runs on the stored frame (ui.js `step`), so the mirror is a
// way of drawing, never a way of playing.
import * as E from './engine.js';
import { BY_ID } from './monsters.js';

export const SIDES = ['a', 'b'];
export const sideOfSeat = (seat) => (seat === 1 ? 'b' : 'a');
export const seatOfSide = (side) => (side === 'b' ? 1 : 0);

/** Who has NOT drafted yet still needs a team on the engine's side 1: its monsters are never READ
 *  while side 0 moves (only the mover's own monsters charge, fire or evolve), so the challenger's
 *  first turn plays out the same whatever side 'b' picks later (tools/test-battlearena-mp.mjs proves
 *  it). These two only fill the slot until side 'b' drafts. */
export const PLACEHOLDER_TEAM = ['emberkit', 'driplet'];

/** A drafted team: two DIFFERENT known monsters, or null. (Both sides may pick the same ones.) */
export function cleanTeam(t) {
  if (!Array.isArray(t) || t.length !== 2) return null;
  const [x, y] = t.map((v) => String(v || ''));
  if (!BY_ID[x] || !BY_ID[y] || x === y) return null;
  return [x, y];
}

/** A stored move ("entry"), cleaned, or null:
 *    { by: 'a'|'b', k: 's', a, b }   a swap of two adjacent cells
 *    { by, k: 'e', m }               evolve monster m (0 | 1): a move
 *    { by, k: 'p' }                  the move clock ran out (live rooms only)
 *    { by, k: 'r' }                  resigned (live rooms only; challenges store it in `over`) */
export function cleanEntry(e, { pass = false, resign = false } = {}) {
  if (!e || typeof e !== 'object' || (e.by !== 'a' && e.by !== 'b')) return null;
  if (e.k === 's') {
    const a = Number(e.a), b = Number(e.b);
    if (!E.adjacent(a, b)) return null;
    return { by: e.by, k: 's', a, b };
  }
  if (e.k === 'e') { const m = Number(e.m); return m === 0 || m === 1 ? { by: e.by, k: 'e', m } : null; }
  if (e.k === 'p' && pass) return { by: e.by, k: 'p' };
  if (e.k === 'r' && resign) return { by: e.by, k: 'r' };
  return null;
}

/** An entry as an engine move (stored frame). */
export function moveOf(e) {
  const side = seatOfSide(e.by);
  if (e.k === 's') return { type: 'swap', a: e.a, b: e.b, side };
  if (e.k === 'e') return { type: 'evolve', mon: e.m, side };
  if (e.k === 'p') return { type: 'pass', side };
  return null;
}
/** An engine move (stored frame) as an entry. */
export function entryOf(move) {
  const by = sideOfSeat(move.side);
  if (move.type === 'swap') return { by, k: 's', a: move.a, b: move.b };
  if (move.type === 'evolve') return { by, k: 'e', m: move.mon };
  if (move.type === 'pass') return { by, k: 'p' };
  return null;
}

/** The first state of a match (stored frame). `teams` = { a, b }; a missing `b` is the placeholder. */
export function startState(seed, teams, first = 0) {
  return E.newMatch({ seed: (Number(seed) >>> 0) || 1, teams: [teams.a, teams.b || PLACEHOLDER_TEAM], first: first === 1 ? 1 : 0 });
}

/** Replay `entries` from the start. { ok, state, n, error }: `n` = how many applied before any refusal. */
export function replay(seed, teams, entries, first = 0) {
  let s = startState(seed, teams, first);
  let n = 0;
  for (const e of entries) {
    if (s.winner != null) return { ok: false, state: s, n, error: 'over' };
    const mv = moveOf(e);
    if (!mv) return { ok: false, state: s, n, error: 'bad-entry' };
    const res = E.apply(s, mv);
    if (!res.ok) return { ok: false, state: s, n, error: res.error };
    s = res.state;
    n++;
  }
  return { ok: true, state: s, n };
}

// --- the mirror (side 'b' sees itself on the right) --------------------------------------------
/** The same match with the two sides swapped: teams, whose turn, who opened, who won. The board and
 *  the RNG are untouched. Its own inverse. */
export function mirror(s) {
  if (!s) return s;
  const m = JSON.parse(JSON.stringify(s));
  m.sides = [m.sides[1], m.sides[0]];
  m.turn = 1 - m.turn;
  m.first = 1 - (m.first | 0);
  if (m.winner != null) m.winner = 1 - m.winner;
  return m;
}
/** Engine events with every `side` swapped (what the mirrored screen animates). */
export function mirrorEvents(ev) {
  return (ev || []).map((e) => (e && e.side != null ? { ...e, side: 1 - e.side } : e));
}

/** FNV-1a over the state's JSON: the live room's check that both phones are on one board. */
export function stateHash(s) {
  const str = JSON.stringify(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/** A fresh 32-bit seed (never 0). */
export function freshSeed() {
  try { return (crypto.getRandomValues(new Uint32Array(1))[0] >>> 0) || 1; }
  catch { return (Math.floor(Math.random() * 4294967295) >>> 0) || 1; }
}

export default { SIDES, sideOfSeat, seatOfSide, PLACEHOLDER_TEAM, cleanTeam, cleanEntry, moveOf, entryOf, startState, replay, mirror, mirrorEvents, stateHash, freshSeed };
