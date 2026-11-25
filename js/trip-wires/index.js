// js/trip-wires/index.js - EVERY GAME'S OWN TRIP WIRES (2026-11-25, Matt: "Yes, build specific trip wires for EVERY SINGLE
// game. Every game should have multiple checks."). PURE and SHARED with the server (js/integrity.js imports this; the
// server copy is made by tools/sync-functions-shared.mjs, which follows imports). One file per game, keyed by stats id.
//
// THE CONTRACT for a rule (in js/trip-wires/<game>.js, `export default [rule, ...]`):
//   id      '<game>-<what>', unique hub-wide
//   text    plain words for the push and the admin page ("more flicks than finger drags")
//   proven  true = no person can do this through the game's own screen (derived from the game's CODE, replayed over
//           every real play with zero hits on anyone not shown to cheat): Option A voids the play at once.
//           false = suspicious: an alert with a Void button.
//   check(e, ctx) => null | { v, lim }    e = the play-log RESULT entry; ctx (all parsed, all possibly null):
//           a  the recorder's arguments (array)     x  the play's private log (withMode `log`, object)
//           d  the play's detail (object)           i  the input counts { t, p, u } (2026-11-24 on)
//           n  the play's touch log, parsed by parseInputLog (2026-11-24 on; null when judged before it arrived)
//           score  a[0] when a number
//   A rule must return null when the data it needs is missing (older plays, or n not arrived): never guess.
// Rules run twice: when the play-log entry lands (n null) and when its touch log lands (functions playInputArrived);
// an alert is written once, so a rule that fires both times alerts once.
import snake from './snake.js';
import ballrun from './ballrun.js';
import tower from './tower.js';
import brickblitz from './brickblitz.js';
import hillclimb from './hillclimb.js';
import skeeball from './skeeball.js';
import golf from './golf.js';
import archery from './archery.js';
import airhockey from './airhockey.js';
import flicksoccer from './flicksoccer.js';
import eightball from './eightball.js';
import cuppong from './cuppong.js';
import darts from './darts.js';
import shoveoff from './shoveoff.js';
import wayout from './wayout.js';
import gridlock from './gridlock.js';
import wordladder from './wordladder.js';
import wordweaver from './wordweaver.js';
import sudoku from './sudoku.js';
import murdoku from './murdoku.js';
import minesweeper from './minesweeper.js';
import nutsbolts from './nutsbolts.js';
import contexto from './contexto.js';
import spellingbee from './spellingbee.js';
import boggle from './boggle.js';
import yahtzee from './yahtzee.js';
import dotsboxes from './dotsboxes.js';
import filler from './filler.js';
import connect4 from './connect4.js';
import hoops4 from './hoops4.js';
import tictactoe from './tictactoe.js';
import mancala from './mancala.js';
import battleship from './battleship.js';
import battlearena from './battlearena.js';
import dominoes from './dominoes.js';
import uno from './uno.js';
import chinchon from './chinchon.js';
import escoba from './escoba.js';
import business from './business.js';
import parchis from './parchis.js';
import holdem from './holdem.js';
import baseball from './baseball.js';

export const TRIP_GAMES = { snake, ballrun, tower, brickblitz, hillclimb, skeeball, golf, archery, airhockey, flicksoccer, eightball, cuppong, darts, shoveoff, wayout, gridlock, wordladder, wordweaver, sudoku, murdoku, minesweeper, nutsbolts, contexto, spellingbee, boggle, yahtzee, dotsboxes, filler, connect4, hoops4, tictactoe, mancala, battleship, battlearena, dominoes, uno, chinchon, escoba, business, parchis, holdem, baseball };

/** The touch log (js/play-log-queue.js `n`) as events: { t0, w, h, pt, cut, ev: [{ t, kind, x, y, key, fake }],
 *  downs, ups, moves, keys, fakes, span } (t = ms since t0). null when absent or unreadable. */
export function parseInputLog(raw) {
  let o = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch { return null; } }
  if (!o || typeof o !== 'object' || typeof o.ev !== 'string') return null;
  const ev = [];
  let t = 0, downs = 0, ups = 0, moves = 0, keys = 0, fakes = 0;
  for (const tok of o.ev.split(' ')) {
    const m = /^(\d+)(!?)([dmuck])(.*)$/.exec(tok);
    if (!m) continue;
    t += Number(m[1]) || 0;
    const fake = m[2] === '!', kind = m[3], rest = m[4];
    const e = { t, kind, fake };
    if (kind === 'k') { e.key = rest; keys++; } else { const [x, y] = rest.split(','); e.x = Number(x); e.y = Number(y); }
    if (kind === 'd') downs++; else if (kind === 'u' || kind === 'c') ups++; else if (kind === 'm') moves++;
    if (fake) fakes++;
    ev.push(e);
  }
  return { t0: Number(o.t0) || 0, w: Number(o.w) || 0, h: Number(o.h) || 0, pt: String(o.pt || ''), cut: Number(o.cut) || 0, ev, downs, ups, moves, keys, fakes, span: t };
}

const jsonOf = (v) => { if (v && typeof v === 'object') return v; try { return v ? JSON.parse(v) : null; } catch { return null; } };
/** Every rule of the entry's game: [{ rule, proven, v, lim }]. `nRaw` = the play's touch log (string or object) or null. */
export function runTripWires(e, nRaw = null) {
  if (!e || typeof e !== 'object') return [];
  const rules = TRIP_GAMES[String(e.g || '')];
  if (!Array.isArray(rules) || !rules.length) return [];
  const a = jsonOf(e.a);
  const ctx = { a: Array.isArray(a) ? a : null, x: jsonOf(e.x), d: jsonOf(e.d), i: jsonOf(e.i), n: nRaw ? parseInputLog(nRaw) : null,
    score: Array.isArray(a) && Number.isFinite(Number(a[0])) ? Number(a[0]) : null };
  const out = [];
  for (const r of rules) {
    let h = null;
    try { h = r.check(e, ctx); } catch { h = null; }
    if (h) out.push({ rule: r.id, proven: r.proven === true, v: h.v ?? '', lim: h.lim ?? '' });
  }
  return out;
}
/** Every rule's text, for the push and the admin page. */
export const TRIP_TEXT = () => Object.fromEntries(Object.values(TRIP_GAMES).flat().map((r) => [r.id, r.text]));
/** Every proven rule id. */
export const TRIP_PROVEN = () => new Set(Object.values(TRIP_GAMES).flat().filter((r) => r.proven === true).map((r) => r.id));

export default { TRIP_GAMES, parseInputLog, runTripWires, TRIP_TEXT, TRIP_PROVEN };
