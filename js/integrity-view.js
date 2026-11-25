// js/integrity-view.js - the DISPLAY half of the integrity checks, for the admin page (2026-11-25, Matt: "proceed",
// moving every check out of what players can read). The checks themselves (every rule, every trip wire, their limits)
// live in the PRIVATE repository (mpowell95/game-hub-server, checks/integrity.js), which imports this file, so the
// server and the admin page still agree on these parts. What is left here judges nothing: game names, which games are
// voided (from stored flags and Matt's own Void / Undo), the online pairs' counts (no limits), and alert wording,
// which the SERVER publishes (integrityText/v1, admins + reader only; setIntegrityText).
// PURE: no storage, no network, no DOM.
import { isHiddenName, isHiddenDeviceId } from './hidden-players.js';

const num = (v) => (Number.isFinite(+v) ? +v : 0);
const obj = (v) => (v && typeof v === 'object' ? v : {});

/** Challenge nodes with a per-player index, and the stats id their results belong to. */
export const PAIR_NODES = {
  hoops: 'hoops4', skeeChallenges: 'skeeball', cuppong: 'cuppong', darts: 'darts', flicksoccer: 'flicksoccer',
  eightball: 'eightball', archery: 'archery', chinchon: 'chinchon', escoba: 'escoba', battlearena: 'battlearena',
  battleship: 'battleship',
};
/** Pairs Matt has CLEARED by hand: { '<A>~<B>' (codes sorted): 'why' }. No pair alert is raised for them,
 *  and the admin page hides their stored alerts (the stored rows stay, as evidence; nothing is deleted). */
export const CLEARED_PAIRS = {
  '9F7FB~QZCC4': '2026-11-16, Matt on Joe vs MattyIce: "He\'s totally fine and legit."',
};
export const isClearedPair = (key) => Object.prototype.hasOwnProperty.call(CLEARED_PAIRS, String(key || '').replace(/^pair~/, ''));
const PAIR_RESULTS = ['won', 'lost', 'draw'];
const codeOf = (v) => String(v || '').trim().toUpperCase();
/** The players/ node an h2h opponent device id names (js/mp-records.js recordForDevice, the same pick). */
function recordForDevice(all, devId, rowName) {
  const ids = Object.keys(all).filter((id) => id === devId || id.startsWith(devId + '-'));
  if (!ids.length) return null;
  const want = String(rowName || '').trim().toLowerCase();
  const byName = want && ids.find((id) => String(obj(obj(all[id]).profile).name || '').trim().toLowerCase() === want);
  return byName || (ids.includes(devId) ? devId : ids[0]);
}
/** The phone a players/ node lives on: a second code on a shared phone is `<deviceId>-<CODE>`. */
const phoneOf = (id) => String(id).slice(0, 36);

/** PURE. Each player code: { code, name, emoji, hidden, first, phones: [device ids], devices: [{ device,
 *  screen, tz }] }. `first` = the earliest of its name claims (usernames/) and first plays (activity). */
export function pairCodes(players, usernames) {
  const out = {};
  for (const [id, rec0] of Object.entries(obj(players))) {
    const rec = obj(rec0), p = obj(rec.profile), code = codeOf(p.playerId);
    if (!code) continue;
    const c = out[code] || (out[code] = { code, name: '', emoji: '', at: -1, hidden: false, first: 0, phones: [], devices: [] });
    const at = num(rec.updatedAt);
    if (at >= c.at) { c.at = at; c.name = String(p.name || '').trim(); c.emoji = String(p.emoji || ''); }
    if (isHiddenDeviceId(id)) c.hidden = true;
    if (!c.phones.includes(phoneOf(id))) c.phones.push(phoneOf(id));
    const d = obj(rec.device);
    if (d.device) {
      const s = obj(d.screen);
      c.devices.push({ device: String(d.device), screen: s.w ? `${num(s.w)}x${num(s.h)}@${num(s.dpr)}` : '', tz: String(d.tz || '') });
    }
    for (const a of Object.values(obj(rec.activity))) {
      const f = num(obj(a).first);
      if (f > 0 && (!c.first || f < c.first)) c.first = f;
    }
  }
  for (const u of Object.values(obj(usernames))) {
    const c = out[codeOf(obj(u).code)], f = num(obj(u).at);
    if (c && f > 0 && (!c.first || f < c.first)) c.first = f;
  }
  for (const c of Object.values(out)) { if (isHiddenName(c.name)) c.hidden = true; delete c.at; }
  return out;
}

/** PURE. Every pair who played each other online: [{ key: 'A~B' (codes sorted), a, b, wa, wb, d, games,
 *  last (newest challenge row's time; 0 = live rooms only, which keep no time), ra, rb (resignations),
 *  byGame: { <stats id>: { wa, wb, d } } }]. `indexes` = { <node>: that node's index }. */
export function onlinePairs(players, indexes, usernames, codes = pairCodes(players, usernames)) {
  const pairs = new Map();
  const shown = (c) => !!(c && codes[c] && !codes[c].hidden);
  const pairOf = (x, y) => {
    const [a, b] = [x, y].sort();
    const key = `${a}~${b}`;
    if (!pairs.has(key)) pairs.set(key, { key, a, b, wa: 0, wb: 0, d: 0, games: 0, last: 0, ra: 0, rb: 0, byGame: {} });
    return pairs.get(key);
  };
  const tally = (p, gid, winner, n = 1) => {
    const g = p.byGame[gid] || (p.byGame[gid] = { wa: 0, wb: 0, d: 0 });
    p.games += n;
    if (winner === p.a) { p.wa += n; g.wa += n; } else if (winner === p.b) { p.wb += n; g.wb += n; } else { p.d += n; g.d += n; }
  };
  // 1. challenges: one match, one result, from whichever player's row is read first.
  const seen = new Set();
  for (const [node, gid] of Object.entries(PAIR_NODES)) {
    for (const [me0, rows] of Object.entries(obj(obj(indexes)[node]))) {
      const me = codeOf(me0);
      for (const [id, r0] of Object.entries(obj(rows))) {
        const r = obj(r0), them = codeOf(r.with);
        if (!r.over || r.ended || !PAIR_RESULTS.includes(r.result) || !them || them === me) continue;
        if (!shown(me) || !shown(them) || seen.has(`${node}~${id}`)) continue;
        seen.add(`${node}~${id}`);
        const p = pairOf(me, them);
        const winner = r.result === 'won' ? me : r.result === 'lost' ? them : '';
        tally(p, gid, winner);
        if (r.why === 'resign' && winner) { if (winner === p.a) p.rb++; else p.ra++; }
        p.last = Math.max(p.last, num(r.updated));
      }
    }
  }
  // 2. live rooms: each side's own h2h, summed over its devices; the larger count of each result stands.
  const h2h = {};   // `${me}|${them}|${gid}` -> { w, l }
  const all = obj(players);
  for (const [id, rec0] of Object.entries(all)) {
    const rec = obj(rec0), me = codeOf(obj(rec.profile).playerId);
    if (!shown(me) || isHiddenDeviceId(id)) continue;
    for (const [gid, per] of Object.entries(obj(obj(rec.stats).h2h))) {
      for (const [dev, row0] of Object.entries(obj(per))) {
        const row = obj(row0), oid = recordForDevice(all, dev, row.name);
        const them = oid ? codeOf(obj(obj(all[oid]).profile).playerId) : '';
        if (!shown(them) || them === me) continue;
        const k = `${me}|${them}|${gid}`, h = h2h[k] || (h2h[k] = { w: 0, l: 0 });
        h.w += Math.max(0, Math.floor(num(row.w))); h.l += Math.max(0, Math.floor(num(row.l)));
      }
    }
  }
  const done = new Set();
  for (const k of Object.keys(h2h)) {
    const [me, them, gid] = k.split('|');
    const [a, b] = [me, them].sort();
    if (done.has(`${a}|${b}|${gid}`)) continue;
    done.add(`${a}|${b}|${gid}`);
    const ab = h2h[`${a}|${b}|${gid}`] || { w: 0, l: 0 }, ba = h2h[`${b}|${a}|${gid}`] || { w: 0, l: 0 };
    const wa = Math.max(ab.w, ba.l), wb = Math.max(ab.l, ba.w);
    if (!wa && !wb) continue;
    const p = pairOf(a, b);
    if (wa) tally(p, gid, a, wa);
    if (wb) tally(p, gid, b, wb);
  }
  return [...pairs.values()];
}

/** Games voided BY HAND in code, per record: { <statsId>: { <gameId>: 'why' } }. An alert Matt wants
 *  voided goes on the admin page (Void); this list is for a void a session ships. Matt's Undo still wins. */
export const HAND_VOIDS = {
  // King of Games' (3VN33) Contexto was voided here 2026-10-28 on the dropped 1-guess alert; UNDONE
  // 2026-10-30 (Matt: "go in and undo the void. Just correctly classify those games"). His 11 wins count
  // by medal like anyone's (8 gold, 3 with 3+ hints = iron); none recorded its day, so All only.
};

/** Is this game on this record voided? A strong flag, Matt's Void on the admin page
 *  (adminConfig/v1/integrity/void/<statsId>/<gameId>) or HAND_VOIDS; Matt's Undo
 *  (integrity/undo/<statsId>/<gameId>) beats all three. */
export function isVoided(flags, cfg, id, gid) {
  const ic = obj(obj(cfg).integrity);
  if (obj(obj(ic.undo)[id])[gid] === true) return false;
  if (obj(obj(ic.void)[id])[gid] === true) return true;
  if (obj(HAND_VOIDS[id])[gid]) return true;
  return Object.values(obj(obj(obj(flags)[id])[gid])).some((f) => f && f.void === true);
}

/** The voids in force: { <statsId>: { <gameId>: true } } (isVoided over every flagged record, every
 *  admin Void and every HAND_VOIDS entry). */
export function activeVoids(flags, cfg) {
  const ids = new Map();
  const add = (id, gid) => { if (!ids.has(id)) ids.set(id, new Set()); ids.get(id).add(gid); };
  for (const [id, games] of Object.entries(obj(flags))) for (const gid of Object.keys(obj(games))) add(id, gid);
  for (const [id, games] of Object.entries(obj(obj(obj(cfg).integrity).void))) for (const gid of Object.keys(obj(games))) add(id, gid);
  for (const [id, games] of Object.entries(HAND_VOIDS)) for (const gid of Object.keys(games)) add(id, gid);
  const out = {};
  for (const [id, gids] of ids) for (const gid of gids) if (isVoided(flags, cfg, id, gid)) (out[id] || (out[id] = {}))[gid] = true;
  return out;
}

// THE WORDING (2026-11-25): rule id -> plain words, published by the server (functions/index.js integrityText) and
// handed in by the admin page. Without it an alert reads its rule id.
let _text = {};
export function setIntegrityText(map) { _text = map && typeof map === 'object' ? map : {}; }
/** Short words for the admin page: "a snake longer than the board (300, limit 255)". */
export function hitText(hit) {
  const text = _text[hit.rule] || hit.rule;
  const nums = hit.lim === '' || hit.lim == null ? `${hit.v}` : `${hit.v}, limit ${hit.lim}`;
  return `${text} (${nums})`;
}

/** English game names for the push and the admin page (stats id -> name). */
export const GAME_NAMES = {
  snake: 'Snake', yahtzee: 'Yahtzee', skeeball: 'Skeeball', battleship: 'Battleship', tictactoe: 'Tic Tac Toe',
  cuppong: 'Cup Pong', golf: 'Golf', hillclimb: 'Hill Climb', sudoku: 'Sudoku', minesweeper: 'Minesweeper',
  airhockey: 'Air Hockey', boggle: 'Boggle', dominoes: 'Dominoes', dotsboxes: 'Dots and Boxes', contexto: 'Contexto',
  wayout: 'Arrow Maze', holdem: "Texas Hold'em", darts: 'Darts', hoops: 'Connect 4 Hoops', hoops4: 'Connect 4 Hoops',
  ballrun: 'Ball Run', brickblitz: 'Brick Breaker', nutsbolts: 'Nuts & Bolts', connect4: 'Connect Four',
  chinchon: 'Chinchón', escoba: 'Escoba', mancala: 'Mancala', filler: 'Filler', uno: 'Uno', murdoku: 'Murdoku',
  flicksoccer: 'Flick Soccer', eightball: 'Pool', archery: 'Archery', business: 'Monopoly Deal', parchis: 'Parchís',
  spellingbee: 'Spelling Bee', gridlock: 'Gridlock', wordweaver: 'Word Weaver', baseball: 'Baseball',
  battlearena: 'Battle Arena', cupbaseball: 'Cup Baseball', tower: 'Tower Stack', wordladder: 'Word Ladder', shoveoff: 'Knockout', numbermerge: 'Number Merge', pair: 'Online play',
};
export const gameName = (id) => GAME_NAMES[id] || id;

export default { PAIR_NODES, CLEARED_PAIRS, isClearedPair, pairCodes, onlinePairs, HAND_VOIDS, isVoided, activeVoids, setIntegrityText, hitText, GAME_NAMES, gameName };
