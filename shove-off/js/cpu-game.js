// shove-off/js/cpu-game.js - a match against the COMPUTER (2026-11-18, Matt: "Add computer play to the game so i
// can test it"; still admin only). The save, the game object the play screen draws, and the result.
//
// SAVE `gamehub.shoveoff.save.v1` = { v: 1, diff, look, cpuLook, seed, log: [{ by, r, aims }], cpu: { r, aims },
// started }. The player is always side 'a' (circle markers), the computer 'b' (triangles). The log has the SAME
// shape as an online match's, so the same replay and the same round animation are used. `cpu` holds the computer's
// aims for round `r`, chosen at the START of that round (before the player aims, never from them) and saved with
// it: leaving and coming back cannot make it choose again. The save is written after every resolved round and
// cleared BEFORE the result is recorded (a continued match counts once).
//
// RESULTS: `recordResult('shoveoff', diff, won|null)` through withMode (diff = easy / medium / hard; a draw =
// null). Mode { cpu: 1, look, them, sd }; detail { rounds, kos, lost, sdr, end }; the private play log gets every
// round. While the game is admin only these land in the TEST record (js/game-stats.js ADMIN_ONLY).
// QUITTING: New game over a match with a resolved round = ONE loss (end 'quit'), the save cleared first.
import * as E from './engine.js';
import * as C from './cpu.js';
import { replay } from './mp.js';
import { recordResult, withMode } from '../../js/game-stats.js';

export const SAVE_KEY = 'gamehub.shoveoff.save.v1';
export const GAME = 'shoveoff';
export const DIFFS = C.DIFFS;
export const asDiff = (d) => (DIFFS.includes(d) ? d : 'medium');

export function readSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!s || s.v !== 1 || !Array.isArray(s.log)) return null;
    const m = replay(s.log);
    if (!m) { console.error('[shoveoff] the computer save does not replay; kept, not used', s); return null; }
    return { ...s, diff: asDiff(s.diff) };
  } catch (err) { console.error('[shoveoff] computer save unreadable', err); return null; }
}
/** Write the save and re-read it (no silent write failures). */
export function writeSave(s) {
  try {
    const str = JSON.stringify(s);
    localStorage.setItem(SAVE_KEY, str);
    if (localStorage.getItem(SAVE_KEY) !== str) { console.error('[shoveoff] computer save did not stick'); return false; }
    return true;
  } catch (err) { console.error('[shoveoff] computer save failed', err); return false; }
}
export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (err) { console.error('[shoveoff] computer save not cleared', err); }
}
/** A match is "started" once a round has been played: from then on, throwing it away is a loss. */
export const started = (s) => !!s && Array.isArray(s.log) && s.log.length >= 2;

export function newSave(diff, look, seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0) {
  const s = { v: 1, diff: asDiff(diff), look, cpuLook: C.cpuLook(look), seed: seed >>> 0 || 1, log: [], cpu: null, started: Date.now() };
  ensureCpuAims(s);
  return s;
}
/** The computer's aims for the save's current round, chosen once (from the board only) and kept in the save. */
export function ensureCpuAims(s) {
  const m = replay(s.log);
  if (!m || m.winner != null) return null;
  if (s.cpu && s.cpu.r === m.round && E.parseAims(m, 'b', s.cpu.aims)) return s.cpu;
  const aims = C.chooseAims(m, 'b', s.diff, C.roundSeed(s.seed, m.round));
  s.cpu = { r: m.round, aims: E.aimsToString(aims) };
  return s.cpu;
}
/** The player launched `str` for the current round: both sides' aims go in the log. Returns the new match. */
export function playRound(s, str) {
  const m = replay(s.log);
  if (!m || m.winner != null) return null;
  const cpu = ensureCpuAims(s);
  if (!cpu || !E.parseAims(m, 'a', str)) return null;
  s.log.push({ by: 'a', r: m.round, aims: str }, { by: 'b', r: m.round, aims: cpu.aims });
  s.cpu = null;
  return replay(s.log);
}

/** The game object the play screen draws (the same fields an online match has). */
export function gameOf(s, me, cpuName) {
  const m = replay(s.log) || E.newMatch();
  const over = m.winner != null ? { winner: m.winner === E.DRAW ? 'draw' : m.winner, why: m.end || 'off' } : null;
  return {
    v: 1, id: 'cpu', cpu: true, diff: s.diff, log: s.log, over,
    owes: over ? { a: false, b: false } : { a: true, b: false },
    round: m.round, sd: m.sd, sdr: m.sdr, resolved: m.rounds.length, updated: s.log.length,
    left: { a: E.aliveCount(m, 'a'), b: E.aliveCount(m, 'b') },
    a: { code: null, name: me.name || '', emoji: me.emoji || '🙂', look: s.look },
    b: { code: null, name: cpuName, emoji: '🤖', look: s.cpuLook },
  };
}

// --- the result ------------------------------------------------------------------------------------
export function modeOf(s, m) { return { cpu: 1, look: s.look, them: s.cpuLook, sd: m && m.sd > 0 ? 1 : 0 }; }
export function detailOf(m, end) {
  const tl = E.tally(m);
  return { rounds: m.rounds.length, kos: tl.b.lost, lost: tl.a.lost, sdr: m.sdr, end: end || m.end || '' };
}
const r1 = (v) => Math.round(v);
/** Everything about the match, for the private play log only. */
export function logOf(s, m, end) {
  return {
    v: 1, cpu: s.diff, seed: s.seed, look: s.look, them: s.cpuLook, end: end || m.end || '', winner: m.winner,
    started: s.started || null, sd: m.sd, sdr: m.sdr,
    sent: s.log.map((e) => [e.by, e.r, e.aims]),
    rounds: m.rounds.map((rec) => ({
      r: rec.r, sd: rec.sd, H: r1(rec.H), H1: r1(rec.H1), steps: rec.steps,
      before: rec.before.filter((p) => p.alive).map((p) => `${p.s}${p.i}:${r1(p.x)},${r1(p.y)}`).join(' '),
      after: rec.after.filter((p) => p.alive).map((p) => `${p.s}${p.i}:${r1(p.x)},${r1(p.y)}`).join(' '),
      fell: rec.falls.map((k) => `${rec.before[k].s}${rec.before[k].i}`).join(' '),
      edge: rec.shrinkFalls.map((k) => `${rec.before[k].s}${rec.before[k].i}`).join(' '),
    })),
  };
}
/** A save whose match is already decided (closed during the last slide): record it as it ended. */
export function settle() {
  const s = readSave();
  const m = s && replay(s.log);
  if (!m || m.winner == null) return false;
  return finish(s);
}
/**
 * The match is over (or thrown away: `quit`): clear the save FIRST, then record ONE result. `won` true / false,
 * null = a draw. Returns true if it recorded.
 */
export function finish(s, quit = false) {
  const m = replay(s.log);
  if (!m) return false;
  const won = quit ? false : m.winner === 'a' ? true : m.winner === 'b' ? false : null;
  const end = quit ? 'quit' : m.end;
  clearSave();
  try {
    withMode(() => modeOf(s, m), s.diff, () => recordResult(GAME, s.diff, won),
      { detail: () => detailOf(m, end), log: () => logOf(s, m, end) });
  } catch (err) { console.error('[shoveoff] computer result not recorded', err); return false; }
  return true;
}
