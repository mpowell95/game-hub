// tools/test-trip-cards.mjs - the trip wires of the card and table games (2026-11-25, js/trip-wires/): Dominoes, Uno,
// Chinchón, Escoba, Monopoly Deal ('business'), Parchís, Texas Hold'em, Baseball. Pure, no network.
//   node tools/test-trip-cards.mjs                      unit cases (one passing and one failing play per rule) and
//                                                       honest engine games (every PROVEN rule must stay silent)
//   node tools/test-trip-cards.mjs --db <playLog.json> [--input <playInput.json>]
//                                                       also replay every real result of these games: list each hit
import fs from 'node:fs';
import { runTripWires, TRIP_GAMES } from '../js/trip-wires/index.js';

let fail = 0;
const ok = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) fail++; };
const J = JSON.stringify;
const hits = (e, n = null) => runTripWires(e, n);
const has = (e, rule, proven, n = null) => hits(e, n).some((h) => h.rule === rule && h.proven === proven);
const quiet = (e, n = null) => hits(e, n).length === 0;
/** A touch log in js/play-log-queue.js's format: `downs` real taps 300 ms apart starting at epoch t0. */
const touch = (t0, downs, fakes = 0) => J({ v: 1, t0, w: 390, h: 844, pt: 'touch',
  ev: [...Array.from({ length: downs }, (_, k) => `${k ? 300 : 0}d10,10 50u10,10`), ...Array.from({ length: fakes }, () => '5!d1,1')].join(' ') });
const OURS = ['dominoes', 'uno', 'chinchon', 'escoba', 'business', 'parchis', 'holdem', 'baseball'];
for (const g of OURS) ok(`${g}: at least 3 rules, proven and suspicious both`, TRIP_GAMES[g].length >= 3 && TRIP_GAMES[g].some((r) => r.proven) && TRIP_GAMES[g].some((r) => !r.proven));
ok('every rule id is unique and starts with its game', OURS.every((g) => TRIP_GAMES[g].every((r) => r.id.startsWith(g + '-'))) && new Set(OURS.flatMap((g) => TRIP_GAMES[g].map((r) => r.id))).size === OURS.reduce((s, g) => s + TRIP_GAMES[g].length, 0));
ok('a play with no private log is never judged', OURS.every((g) => quiet({ f: 'recordResult', g, a: J([g, 'easy', true]) })));

// ---------------------------------------------------------------- DOMINOES
import { DominoesGame, HUMAN as DM_HUMAN, mulberry32 } from '../dominoes/js/game.js';
import { chooseMove as dmMove } from '../dominoes/js/ai.js';
/** An honest match through the real engine, logged exactly as dominoes/js/ui.js _playLog does. */
function dominoesMatch(seed, target = 150) {
  const rnd = mulberry32(seed);
  const g = new DominoesGame({ target, rng: rnd });
  g.startMatch();
  let guard = 0;
  while (g.phase !== 'matchOver' && guard++ < 4000) {
    if (g.phase === 'roundOver') { g.startRound(); continue; }
    const seat = g.turn, need = g.requiredAction(seat);
    if (need === 'play') { const m = dmMove(g, seat, seat ? 'hard' : 'medium', rnd); g.play(seat, m.tileId, m.side); }
    else if (need === 'draw') g.draw(seat);
    else g.pass(seat);
  }
  const mv = g.plog.flatMap((r) => r.mv);
  const x = { end: 'over', target: g.target, rounds: g.round, scores: g.scores.slice(), winner: g.matchWinner, res: 0, t0: g.plt0,
    hp: mv.filter((m) => m[0] === DM_HUMAN && m[1] !== 'x').length, bp: mv.filter((m) => m[0] !== DM_HUMAN).length, rd: g.plog };
  return { f: 'recordDominoes', g: 'dominoes', a: J(['easy', g.matchWinner == null ? null : g.matchWinner === DM_HUMAN, {}]), x: J(x), _x: x };
}
{
  let loud = 0, n = 0;
  for (let s = 1; s <= 120; s++) { const e = dominoesMatch(s); n++; if (hits(e).some((h) => h.proven)) { loud++; console.log('  dominoes honest hit', s, J(hits(e))); } }
  ok(`dominoes: ${n} honest engine matches, no proven hit`, loud === 0);
  const e = dominoesMatch(7), x = e._x;
  ok('dominoes: x.t0 and times on every move', x.t0 > 0 && x.rd.every((r) => r.mv.every((m) => Number.isFinite(m[m.length - 1]))));
  const bad = (f) => { const y = JSON.parse(J(x)); f(y); return { ...e, x: J(y) }; };
  ok('dominoes-tile-twice: a dealt tile twice is PROVEN', has(bad((y) => { y.rd[0].yard[0] = y.rd[0].h0[0]; }), 'dominoes-tile-twice', true));
  ok('dominoes-tile-twice: a tile played that was never held is PROVEN', has(bad((y) => { const r = y.rd[0], p = r.mv.find((m) => m[0] === 0 && m[1] === 'p'); p[2] = r.h1.find((id) => !r.mv.some((m) => m[2] === id)); }), 'dominoes-tile-twice', true));
  ok('dominoes-score-adds-wrong: a round score 5 higher is PROVEN', has(bad((y) => { y.rd[0].rs[0] += 5; }), 'dominoes-score-adds-wrong', true));
  ok('dominoes-score-adds-wrong: a play scoring 7 is PROVEN', has(bad((y) => { const p = y.rd[0].mv.find((m) => m[1] === 'p'); p[5] = 7; }), 'dominoes-score-adds-wrong', true));
  const won = { ...e, a: J(['easy', true, {}]) };
  const wx = JSON.parse(e.x); wx.scores = [120, 160];
  ok('dominoes-win-under-target: a win at 120 to 160 is PROVEN', has({ ...won, x: J(wx) }, 'dominoes-win-under-target', true));
  wx.scores = [170, 160];
  ok('dominoes-win-under-target: a win at 170 to 160 passes', !has({ ...won, x: J(wx) }, 'dominoes-win-under-target', true));
  const plays = x.rd.reduce((s, r) => s + r.mv.filter((m) => m[0] === 0 && m[1] !== 'x').length, 0);
  ok('dominoes-moves-without-taps: 2 taps for a whole match is PROVEN', has(e, 'dominoes-moves-without-taps', true, touch(x.t0, 2)));
  ok('dominoes-moves-without-taps: a tap per move passes', !has(e, 'dominoes-moves-without-taps', true, touch(x.t0, plays)));
  ok('dominoes-moves-without-taps: made-up taps do not count', has(e, 'dominoes-moves-without-taps', true, touch(x.t0, 1, plays)));
  ok('dominoes-moves-without-taps: a touch log that starts after the match passes', !has(e, 'dominoes-moves-without-taps', true, touch(Date.now() + 60000, 0)));
  const fast = bad((y) => { for (const r of y.rd) { let t = 0; for (const m of r.mv) { t += m[0] === 0 ? 100 : 900; m[m.length - 1] = t; } } });
  ok('dominoes-instant-plays: 0.1 s after every computer move is suspicious', has(fast, 'dominoes-instant-plays', false));
  ok('dominoes-instant-plays: engine-speed timing in a real log needs the human seat', !has(bad((y) => { for (const r of y.rd) { let t = 0; for (const m of r.mv) { t += 1500; m[m.length - 1] = t; } } }), 'dominoes-instant-plays', false));
}

// ---------------------------------------------------------------- UNO
import { UnoGame } from '../uno/js/game.js';
import { chooseAction as unoAction, pickWildColor, seededRng as unoRng } from '../uno/js/ai.js';
const unoCC = (c) => (c ? String(c.color || '?')[0] + (c.value != null ? c.value : c.kind) : null);
function unoGame(seed, n) {
  const ev = [], t0 = Date.now();
  let clock = 0;
  const onEvent = (type, p0) => { const p = p0 || {}; clock += 700; ev.push([type, p.playerIndex != null ? p.playerIndex : p.currentPlayer != null ? p.currentPlayer : null, unoCC(p.card || p.topCard) || p.color || p.amount || p.count || null, clock]); };
  const g = new UnoGame({ playerCount: n, startPlayer: seed % n, rng: unoRng(seed, 'deal'), onEvent });
  let guard = 0;
  while (g.phase !== 'over' && guard++ < 3000) {
    const pi = g.currentPlayer;
    if (g.phase === 'chooseColor') { g.chooseColor(g.pendingWild.playerIndex, pickWildColor(g.players[g.pendingWild.playerIndex].hand, unoRng(seed, 'w' + guard), null)); continue; }
    const act = unoAction(g, pi, ['easy', 'medium', 'hard'][(seed + pi) % 3], unoRng(seed, 'a' + guard));
    if (act.type === 'draw') g.draw(pi); else g.play(pi, act.cardId, act.color);
  }
  const x = { end: 'over', seed, n, winner: g.winner, res: 0, left: g.players.map((p) => p.hand.map(unoCC)), ev, t0 };
  return { f: 'recordResult', g: 'uno', a: J(['uno', 'easy', g.winner === 0]), x: J(x), _x: x };
}
{
  let loud = 0, plays = 0;
  for (let s = 1; s <= 200; s++) {
    const e = unoGame(s, 2 + (s % 3));
    plays += e._x.ev.filter((q) => q[0] === 'cardPlayed').length;
    if (hits(e).some((h) => h.proven)) { loud++; console.log('  uno honest hit', s, J(hits(e))); }
  }
  ok(`uno: 200 honest engine games (${plays} cards played), no proven hit`, loud === 0);
  let e = unoGame(3, 2);
  for (let s = 4; e._x.winner !== 0; s++) e = unoGame(s, 2);
  const x = e._x;
  const bad = (f) => { const y = JSON.parse(J(x)); f(y); return { ...e, x: J(y) }; };
  ok('uno-won-with-cards: a win holding 2 cards is PROVEN', has(bad((y) => { y.left[0] = ['r5', 'g7']; }), 'uno-won-with-cards', true));
  ok('uno-won-with-cards: a real win passes', !has(e, 'uno-won-with-cards', true));
  ok('uno-illegal-card: a red 5 on a green 7 is PROVEN', has({ ...e, x: J({ ...x, ev: [['gameStart', 0, 'g7', 0], ['cardPlayed', 0, 'r5', 900]] }) }, 'uno-illegal-card', true));
  ok('uno-illegal-card: a red 7 on a green 7 passes', !has({ ...e, x: J({ ...x, ev: [['gameStart', 0, 'g7', 0], ['cardPlayed', 0, 'r7', 900]] }) }, 'uno-illegal-card', true));
  ok('uno-illegal-card: a Wild +4 on a +2 stack is PROVEN', has({ ...e, x: J({ ...x, ev: [['gameStart', 0, 'g3', 0], ['cardPlayed', 0, 'gdraw2', 900], ['cardPlayed', 1, 'wwild4', 1800]] }) }, 'uno-illegal-card', true));
  ok('uno-illegal-card: a resumed list is judged only from its first play', !has({ ...e, x: J({ ...x, res: 1, ev: [['cardPlayed', 1, 'b4', 0], ['cardPlayed', 0, 'b9', 900]] }) }, 'uno-illegal-card', true));
  const mine = x.ev.filter((q) => q[0] === 'cardPlayed' && q[1] === 0).length;
  ok('uno-plays-without-taps: 1 tap for every card is PROVEN', mine >= 4 && has(e, 'uno-plays-without-taps', true, touch(x.t0, 1)));
  ok('uno-plays-without-taps: a tap per card passes', !has(e, 'uno-plays-without-taps', true, touch(x.t0, mine)));
  const fast = { ...e, x: J({ ...x, ev: Array.from({ length: 30 }, (_, k) => (k % 2 ? ['cardPlayed', 0, 'r5', k * 1000 + 120] : ['turnAdvanced', 0, null, k * 1000 + 1000])) }) };
  ok('uno-instant-plays: 0.12 s after each turn comes round is suspicious', has(fast, 'uno-instant-plays', false));
  ok('uno-instant-plays: an honest game passes', !has(e, 'uno-instant-plays', false));
}

// ---------------------------------------------------------------- ESCOBA (the real async engine, logged as ui.js _xnote)
import { Game as EbGame, makePlayer as ebPlayer } from '../escoba/js/game.js';
import { AIAgent as EbAI } from '../escoba/js/ai.js';
const lcg = (seed) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 0x100000000; }; };
async function escobaMatch(seed, nPlayers, deckMode) {
  const players = Array.from({ length: nPlayers }, (_, i) => ebPlayer({ id: i, name: 'P' + i, avatar: 'x', isHuman: i === 0, agent: new EbAI({ difficulty: ['easy', 'normal', 'hard'][(seed + i) % 3] }), difficulty: 'normal' }));
  const g = new EbGame({ players, config: { targetScore: 21, deckMode }, rng: lcg(seed) });
  let clock = 0;
  const x = { t0: Date.now(), rd: [], res: 0 };
  const cc = (c) => (c ? String(c.suit).slice(0, 2) + c.rank : null);
  const seat = (id) => g.players.findIndex((q) => q.id === id);
  g.onEvent = async (type, p) => {
    const cur = () => x.rd[x.rd.length - 1];
    if (type === 'roundStart') x.rd.push({ n: g.round, dealer: g.dealer, deck: (g.lastDeckOrder || []).join(','), mv: [] });
    else if (type === 'play') { clock += 1500; if (cur().mv.length < 120) cur().mv.push([seat(p.playerId), cc(p.card), (p.captured || []).map(cc).join(','), p.escoba ? 1 : 0, clock]); }
    else if (type === 'roundScored') cur().sc = g.players.map((q) => [q.roundScore | 0, q.totalScore | 0]);
  };
  await g.playMatch();
  const log = { end: 'over', rounds: g.round, target: 21, deck: deckMode, winner: g.winner ? seat(g.winner.id) : null, why: g.matchEndReason || null,
    pl: g.players.map((q) => ({ n: q.name, ai: q.isHuman ? 0 : 1, tot: q.totalScore | 0 })), me: 0, res: 0, rd: x.rd, t0: x.t0 };
  return { f: 'recordEscoba', g: 'escoba', a: J(['easy', !!(g.winner && g.winner.id === 0), {}]), x: J(log), _x: log };
}
{
  let loud = 0, n = 0, caps = 0;
  for (let s = 1; s <= 60; s++) {
    const e = await escobaMatch(s, 2 + (s % 2), s % 3 ? 'spanish' : 'american');
    n++; caps += e._x.rd.reduce((t, r) => t + r.mv.filter((m) => m[2]).length, 0);
    if (hits(e).some((h) => h.proven)) { loud++; console.log('  escoba honest hit', s, J(hits(e))); }
  }
  ok(`escoba: ${n} honest engine matches (${caps} captures), no proven hit`, loud === 0);
  let e = await escobaMatch(2, 2, 'spanish');
  for (let s = 3; e._x.winner !== 0; s++) e = await escobaMatch(s, 2, 'spanish');
  const x = e._x;
  const bad = (f) => { const y = JSON.parse(J(x)); f(y); return { ...e, x: J(y) }; };
  ok('escoba-capture-not-15: a 7 taking a 5 is PROVEN', has(bad((y) => { y.rd[0].mv[0] = [0, 'or7', 'co5', 0, 10]; }), 'escoba-capture-not-15', true));
  ok('escoba-capture-not-15: a Spanish Rey (10) taking a 5 passes', !has(bad((y) => { y.rd[0].mv = [[0, 'or12', 'co5', 0, 10]]; y.rd[0].deck = null; }), 'escoba-capture-not-15', true));
  ok('escoba-capture-not-15: the same Rey under American numbering does not exist (card-twice catches it)', has(bad((y) => { y.deck = 'american'; y.rd[0].mv = [[0, 'or12', 'co3', 0, 10]]; y.rd[0].deck = null; }), 'escoba-card-twice', true));
  ok('escoba-card-twice: the same card played twice is PROVEN', has(bad((y) => { const m = y.rd[0].mv; m.push([0, m[0][1], '', 0, 99999]); }), 'escoba-card-twice', true));
  ok('escoba-card-twice: a laid card taken later passes (real round)', !has(e, 'escoba-card-twice', true));
  ok('escoba-card-twice: a deck of 39 is PROVEN', has(bad((y) => { y.rd[0].deck = y.rd[0].deck.split(',').slice(1).join(','); }), 'escoba-card-twice', true));
  ok('escoba-win-the-scores-deny: a win with the other player named winner is PROVEN', has(bad((y) => { y.winner = 1; }), 'escoba-win-the-scores-deny', true));
  ok('escoba-win-the-scores-deny: a target win under the target is PROVEN', has(bad((y) => { y.why = 'target'; y.pl[0].tot = 12; }), 'escoba-win-the-scores-deny', true));
  ok('escoba-win-the-scores-deny: an online win is not judged', !has({ ...bad((y) => { y.winner = 1; }), a: J(['mp', true, {}]) }, 'escoba-win-the-scores-deny', true));
  const mine = x.rd.reduce((t, r) => t + r.mv.filter((m) => m[0] === 0).length, 0);
  ok('escoba-plays-without-taps: 3 taps for a whole match is PROVEN', has(e, 'escoba-plays-without-taps', true, touch(x.t0, 3)));
  ok('escoba-plays-without-taps: two taps a card pass', !has(e, 'escoba-plays-without-taps', true, touch(x.t0, mine * 2)));
  ok('escoba-instant-plays: 0.2 s after each computer card is suspicious', has(bad((y) => { for (const r of y.rd) { let t = 0; for (const m of r.mv) { t += m[0] === 0 ? 200 : 2000; m[4] = t; } } }), 'escoba-instant-plays', false));
  ok('escoba-instant-plays: 1.5 s plays pass', !has(e, 'escoba-instant-plays', false));
}

// ---------------------------------------------------------------- CHINCHÓN (the real async engine, logged as ui.js _xnote)
import { Game as CcGame, makePlayer as ccPlayer } from '../chinchon/js/game.js';
import { AIAgent as CcAI } from '../chinchon/js/ai.js';
async function chinchonMatch(seed) {
  const rng = lcg(seed);
  const players = [0, 1, 2].map((i) => ccPlayer({ id: i, name: 'P' + i, isHuman: i === 0, difficulty: 'normal', agent: new CcAI({ difficulty: 'normal', rng }) }));
  const g = new CcGame({ players, config: { scoreLimit: 60, placeOnEnding: 'auto' }, rng });
  const x = { t0: Date.now(), rd: [], res: 0 };
  let clock = 0, rounds = 0;
  const seat = (id) => g.players.findIndex((q) => q.id === id);
  g.onEvent = async (type, p) => {
    const cur = () => { if (!x.rd.length) x.rd.push({ n: g.round, dealer: g.dealerIndex, deck: null, ev: [] }); return x.rd[x.rd.length - 1]; };
    clock += 800;
    if (type === 'roundStart') x.rd.push({ n: g.round, dealer: g.dealerIndex, deck: (g.lastDeckOrder || []).join(','), ev: [] });
    else if (type === 'draw') { const r = cur(); if (r.ev.length < 300) r.ev.push(['d', seat(p.playerId), p.source === 'discard' ? 'D' : 'S', p.card ? p.card.id : null, clock]); }
    else if (type === 'discard') { const r = cur(); if (r.ev.length < 300) r.ev.push(['x', seat(p.playerId), p.card ? p.card.id : null, clock]); }
    else if (type === 'close') cur().ev.push(['c', seat(p.playerId), clock]);
    else if (type === 'roundScored' && ++rounds > 300) g.abort();
  };
  await g.playMatch();
  const log = { end: 'over', rounds: g.round, winner: g.winner ? seat(g.winner.id) : null, pl: g.players.map((q) => ({ n: q.name, tot: q.totalScore | 0 })), me: 0, res: 0, rd: x.rd, t0: x.t0 };
  return { f: 'recordChinchon', g: 'chinchon', a: J(['normal', !!(g.winner && g.winner.id === 0), {}]), x: J(log), _x: log };
}
{
  let loud = 0, fromPile = 0;
  for (let s = 1; s <= 40; s++) {
    const e = await chinchonMatch(s);
    fromPile += e._x.rd.reduce((t, r) => t + r.ev.filter((q) => q[0] === 'd' && q[2] === 'D').length, 0);
    if (hits(e).some((h) => h.proven)) { loud++; console.log('  chinchon honest hit', s, J(hits(e))); }
  }
  ok(`chinchon: 40 honest engine matches (${fromPile} draws from the discard pile), no proven hit`, loud === 0 && fromPile > 20);
  const e = await chinchonMatch(5), x = e._x;
  const bad = (f) => { const y = JSON.parse(J(x)); f(y); return { ...e, x: J(y) }; };
  const r0 = x.rd.findIndex((r) => r.ev.some((q, k) => q[0] === 'd' && q[2] === 'D' && k && r.ev[k - 1][0] === 'x'));
  ok('chinchon-draw-not-the-discard: taking a card that was not on top is PROVEN', r0 >= 0 && has(bad((y) => { const ev = y.rd[r0].ev, k = ev.findIndex((q, j) => q[0] === 'd' && q[2] === 'D' && j && ev[j - 1][0] === 'x'); ev[k][3] = 'zz9'; }), 'chinchon-draw-not-the-discard', true));
  ok('chinchon-card-twice: a deck with a card twice is PROVEN', has(bad((y) => { const d = y.rd[0].deck.split(','); d[1] = d[0]; y.rd[0].deck = d.join(','); }), 'chinchon-card-twice', true));
  const mine = x.rd.reduce((t, r) => t + r.ev.filter((q) => (q[0] === 'd' || q[0] === 'x') && q[1] === 0).length, 0);
  ok('chinchon-moves-without-taps: 2 taps for a whole match is PROVEN', has(e, 'chinchon-moves-without-taps', true, touch(x.t0, 2)));
  ok('chinchon-moves-without-taps: a tap per move passes', !has(e, 'chinchon-moves-without-taps', true, touch(x.t0, mine)));
  ok('chinchon-moves-without-taps: online is not judged', !has({ ...e, a: J(['mp', true, {}]) }, 'chinchon-moves-without-taps', true, touch(x.t0, 0)));
  ok('chinchon-instant-discards: discarding 0.1 s after every draw is suspicious', has(bad((y) => { for (const r of y.rd) { let t = 0; for (const q of r.ev) { t += q[0] === 'x' && q[1] === 0 ? 100 : 2000; q[q.length - 1] = t; } } }), 'chinchon-instant-discards', false));
  ok('chinchon-instant-discards: 0.8 s discards pass', !has(e, 'chinchon-instant-discards', false));
}

// ---------------------------------------------------------------- MONOPOLY DEAL ('business')
{
  const cards = (k, name = 'Card') => Array.from({ length: k }, () => name);
  // 106 cards: 40 in the deck, 10 discarded, the rest in hands, banks and properties.
  const base = () => ({ why: 'end', win: 0, deck: 40, disc: 10, t0: 1e12, hm: Array.from({ length: 20 }, (_, k) => [k * 2000, 'bank']),
    pl: [{ hand: cards(3), bank: cards(10), props: { green: [cards(3), 1, 1], pink: [cards(3), 0, 0], brown: [cards(2), 0, 0] }, sets: ['green', 'pink', 'brown'] },
      { hand: cards(5), bank: cards(13), props: { red: [cards(2), 0, 0] }, sets: [] },
      { hand: cards(4), bank: cards(4), props: { orange: [cards(5), 0, 0] }, sets: ['orange'] }] });
  const e = (x, won = true) => ({ f: 'record', g: 'business', a: J(['business', 'hard', won]), x: J(x) });
  ok('business: a real-shaped win passes every rule', quiet(e(base()), touch(1e12, 40)));
  ok('business-win-without-three-sets: a win with 2 sets is PROVEN', has(e({ ...base(), pl: [{ ...base().pl[0], sets: ['green', 'pink'] }, ...base().pl.slice(1)] }), 'business-win-without-three-sets', true));
  ok('business-win-without-three-sets: a win with a computer named winner is PROVEN', has(e({ ...base(), win: 2 }), 'business-win-without-three-sets', true));
  ok('business-win-without-three-sets: a loss is not judged', !has(e({ ...base(), win: 2 }, false), 'business-win-without-three-sets', true));
  ok('business-cards-not-106: one card more is PROVEN', has(e({ ...base(), deck: 41 }), 'business-cards-not-106', true));
  ok('business-cards-not-106: a quit game (why discard) is not judged', !has(e({ ...base(), why: 'discard', deck: 41 }), 'business-cards-not-106', true));
  ok('business-moves-without-taps: 20 moves from 3 taps is PROVEN', has(e(base()), 'business-moves-without-taps', true, touch(1e12, 3)));
  ok('business-moves-without-taps: moves before the touch log started pass', !has(e(base()), 'business-moves-without-taps', true, touch(1e12 + 100000, 1)));
  ok('business-instant-moves: moves 0.1 s apart are suspicious', has(e({ ...base(), hm: Array.from({ length: 20 }, (_, k) => [k * 100, 'bank']) }), 'business-instant-moves', false));
  ok('business-instant-moves: moves 2 s apart pass', !has(e(base()), 'business-instant-moves', false));
}

// ---------------------------------------------------------------- PARCHÍS
import { parchisBadLine } from '../js/trip-wires/parchis.js';
{
  const mv = ['Zr32@0', 'Z1>t22+5@500', 'Rr26@3000', 'R-@3200', 'Vr55@5000', 'V1>t56+5@5600', 'V2>t56+5@6000', 'Vr21@8000', 'V2>t57+1@8400', 'V2>t59+2@8800',
    'Ar61@10000', 'A-@10200', 'Zr43@12000', 'Z1>t26+4@12500', 'Z1>t29+3@13000', 'Vr63@14000', 'V2>t7+3xA1@14400', 'V2>t27+20@14800', 'V2>m+6@15200', 'V3>t56+10@15600'];
  const x = { why: 'end', mode: 'american', vs: 'cpu', me: 'azul', humans: ['azul'], moves: mv, t0: 1e12 };
  const e = (y, won = false) => ({ f: 'record', g: 'parchis', a: J(['parchis', 'pro', won]), x: J(y) });
  ok('parchis: a real-shaped game passes', quiet(e(x), touch(1e12, 10)));
  ok('parchis: lines with no time (before 2026-11-25) still read', parchisBadLine({ ...x, moves: mv.map((s) => s.split('@')[0]) }) === null);
  ok('parchis-move-not-on-dice: 4 steps on a 3 and a 2 is PROVEN', has(e({ ...x, moves: ['Zr32@0', 'Z1>t22+4@500'] }), 'parchis-move-not-on-dice', true));
  ok('parchis-move-not-on-dice: a die of 7 is PROVEN', has(e({ ...x, moves: ['Zr72@0'] }), 'parchis-move-not-on-dice', true));
  ok('parchis-move-not-on-dice: one die in American is PROVEN', has(e({ ...x, moves: ['Zr5@0'] }), 'parchis-move-not-on-dice', true));
  ok('parchis-move-not-on-dice: a Spanish 6 as 7 passes', !has(e({ ...x, mode: 'spanish', moves: ['Zr6@0', 'Z1>t30+7@400'] }), 'parchis-move-not-on-dice', true));
  ok('parchis-move-not-on-dice: moving on someone else\'s roll is PROVEN', has(e({ ...x, moves: ['Rr32@0', 'Z1>t22+3@500'] }), 'parchis-move-not-on-dice', true));
  ok('parchis-rolls-without-taps: 4 rolls, 0 taps is PROVEN', has(e({ ...x, moves: ['Zr32@0', 'Zr11@4000', 'Zr44@8000', 'Zr12@12000'] }), 'parchis-rolls-without-taps', true, touch(1e12, 0)));
  ok('parchis-rolls-without-taps: pass and play is not judged', !has(e({ ...x, vs: 'local', moves: ['Zr32@0', 'Zr11@4000', 'Zr44@8000', 'Zr12@12000'] }), 'parchis-rolls-without-taps', true, touch(1e12, 0)));
  const quick = Array.from({ length: 25 }, (_, k) => [`Rr21@${k * 2000}`, `R-@${k * 2000 + 300}`, `Zr32@${k * 2000 + 400}`, `Z-@${k * 2000 + 600}`]).flat();
  ok('parchis-instant-rolls: rolling 0.1 s after each turn comes round is suspicious', has(e({ ...x, moves: quick }), 'parchis-instant-rolls', false));
  ok('parchis-instant-rolls: a real-paced game passes', !has(e(x), 'parchis-instant-rolls', false));
}

// ---------------------------------------------------------------- TEXAS HOLD'EM
import { bestFive, categoryOf, scoreRanks } from '../holdem/js/engine.js';
{
  // 2,000 honest hands: seven random cards, the best five exactly as ui.js _handEnd builds them.
  const rnd = lcg(99);
  let loud = 0;
  for (let k = 0; k < 2000; k++) {
    const deck = Array.from({ length: 52 }, (_, i) => i);
    for (let i = 51; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    const bf = bestFive(deck.slice(0, 7));
    let cat = categoryOf(bf.score);
    if (cat === 8 && scoreRanks(bf.score)[0] === 12) cat = 9;
    const amt = k % 3 ? 0 : 40 + k;
    const e = { f: 'recordHoldemHand', g: 'holdem', a: J([{ won: amt > 0, amt, score: bf.score, cat, cards: bf.cards }]) };
    if (hits(e).length) { loud++; if (loud < 4) console.log('  holdem honest hit', J(hits(e))); }
  }
  ok('holdem: 2,000 honest hands, no hit', loud === 0);
  const hand = (o) => ({ f: 'recordHoldemHand', g: 'holdem', a: J([o]) });
  const royal = [48, 44, 40, 36, 32];     // A K Q J T of spades
  const sc = bestFive(royal).score;
  ok('holdem-hand-not-the-cards: a royal flush recorded from its cards passes', quiet(hand({ won: true, amt: 500, score: sc, cat: 9, cards: royal })));
  ok('holdem-hand-not-the-cards: a royal flush score on a pair is PROVEN', has(hand({ won: true, amt: 500, score: sc, cat: 9, cards: [0, 1, 8, 13, 22] }), 'holdem-hand-not-the-cards', true));
  ok('holdem-hand-not-the-cards: the same card twice is PROVEN', has(hand({ won: true, amt: 5, score: sc, cat: 9, cards: [48, 48, 40, 36, 32] }), 'holdem-hand-not-the-cards', true));
  ok('holdem-hand-not-the-cards: a folded hand (no cards) is not judged', quiet(hand({ won: false, amt: 0, score: 0, cat: -1, cards: [] })));
  ok('holdem-hand-won-without-chips: won with 0 chips is PROVEN', has(hand({ won: true, amt: 0, score: 0, cat: -1, cards: [] }), 'holdem-hand-won-without-chips', true));
  const seats = (c) => c.map((v, i) => ({ n: 'P' + i, b: i ? 1 : 0, c: v }));
  const match = (won, x) => ({ f: 'recordResult', g: 'holdem', a: J(['holdem', 'easy', won]), x: J({ why: won ? 'won' : 'out', my: 0, hands: 40, cfg: { chips: 100 }, solo: 1, ...x }) });
  ok('holdem: a real win (one seat holds every chip) passes', quiet(match(true, { winner: 0, seats: seats([800, 0, 0, 0, 0, 0, 0, 0]) })));
  ok('holdem-win-not-last: a win with another seat holding chips is PROVEN', has(match(true, { winner: 0, seats: seats([700, 100, 0, 0, 0, 0, 0, 0]) }), 'holdem-win-not-last', true));
  ok('holdem-win-not-last: a win the log gives to seat 3 is PROVEN', has(match(true, { winner: 3, seats: seats([800, 0, 0, 0, 0, 0, 0, 0]) }), 'holdem-win-not-last', true));
  ok('holdem-chips-from-nowhere: 900 chips at an 8 x 100 table is PROVEN', has(match(false, { winner: -1, seats: seats([0, 900, 0, 0, 0, 0, 0, 0]) }), 'holdem-chips-from-nowhere', true));
  ok('holdem-chips-from-nowhere: a give-up mid-tournament is not judged', !has(match(false, { why: 'giveup', seats: seats([0, 900, 0, 0, 0, 0, 0, 0]) }), 'holdem-chips-from-nowhere', true));
  const acts = (lat, auto = 0) => Array.from({ length: 30 }, (_, k) => [k * 3000, 'call', auto, lat]);
  ok('holdem-instant-decisions: 30 decisions 0.1 s after the turn is suspicious', has(match(false, { seats: seats([0, 800, 0, 0, 0, 0, 0, 0]), acts: acts(100) }), 'holdem-instant-decisions', false));
  ok('holdem-instant-decisions: the ticked Check / Fold is not counted', !has(match(false, { seats: seats([0, 800, 0, 0, 0, 0, 0, 0]), acts: acts(100, 1) }), 'holdem-instant-decisions', false));
  ok('holdem-instant-decisions: 1.5 s decisions pass', !has(match(false, { seats: seats([0, 800, 0, 0, 0, 0, 0, 0]), acts: acts(1500) }), 'holdem-instant-decisions', false));
}

// ---------------------------------------------------------------- BASEBALL
{
  const sw = (n, gap, word, jitter = 1) => Array.from({ length: n }, (_, k) => [k * gap + (k % 3) * jitter * 400, 0, word(k)]);
  const base = (o) => ({ why: 'end', side: 'away', you: 5, them: 3, score: { away: 5, home: 3 }, ev: ['H1t', 'Ss-', 'G5-3:away:scheduled'], t0: 1e12, sw: sw(30, 4000, (k) => (k % 3 ? 'early' : 'perfect')), ...o });
  const e = (x, won = true) => ({ f: 'recordBaseball', g: 'baseball', a: J(['majors', won, {}]), x: J(x) });
  ok('baseball: a real-shaped win passes', quiet(e(base()), touch(1e12, 40)));
  ok('baseball-won-but-behind: a win at 3 to 5 is PROVEN', has(e(base({ you: 3, them: 5, score: { away: 3, home: 5 }, ev: ['G3-5:home:scheduled'] })), 'baseball-won-but-behind', true));
  ok('baseball-won-but-behind: a tie recorded as a loss passes', !has(e(base({ you: 4, them: 4, score: { away: 4, home: 4 }, ev: ['G4-4:tie:extra-innings-cap'] }), false), 'baseball-won-but-behind', true));
  ok('baseball-won-but-behind: a forfeit is not judged', !has(e(base({ why: 'forfeitSaved', you: 0, them: 0 }), false), 'baseball-won-but-behind', true));
  ok('baseball-score-mismatch: runs that are not the game\'s score are PROVEN', has(e(base({ you: 9 })), 'baseball-score-mismatch', true));
  ok('baseball-score-mismatch: an end event with another score is PROVEN', has(e(base({ ev: ['G2-3:home:scheduled'] })), 'baseball-score-mismatch', true));
  ok('baseball-swings-without-taps: 30 swings from 2 taps is PROVEN', has(e(base()), 'baseball-swings-without-taps', true, touch(1e12, 2)));
  ok('baseball-swings-without-taps: a tap per swing passes', !has(e(base()), 'baseball-swings-without-taps', true, touch(1e12, 30)));
  ok('baseball-perfect-timing: 30 perfect swings of 30 is suspicious', has(e(base({ sw: sw(30, 4000, () => 'perfect') })), 'baseball-perfect-timing', false));
  ok('baseball-machine-rhythm: swings exactly 4 s apart are suspicious', has(e(base({ sw: sw(30, 4000, () => 'late', 0) })), 'baseball-machine-rhythm', false));
  ok('baseball-machine-rhythm: uneven swings pass', !has(e(base()), 'baseball-machine-rhythm', false));
}

// ---------------------------------------------------------------- what each game logs (source checks)
const src = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
ok('dominoes logs each move\'s time and t0', /r\.mv\.push\(\[\.\.\.m, Date\.now\(\) - this\.plt0\]\)/.test(src('dominoes/js/game.js')) && /t0: g\.plt0/.test(src('dominoes/js/ui.js')));
ok('uno logs t0, the deal and play counts', /t0: this\._plogAt/.test(src('uno/js/ui.js')) && /this\._plogDeal = /.test(src('uno/js/ui.js')));
ok('escoba and chinchon log t0 and play counts', ['escoba/js/ui.js', 'chinchon/js/ui.js'].every((f) => /t0: x\.t0 \|\| null, \.\.\.this\._xCounts/.test(src(f))));
ok('monopoly deal logs every move of the player\'s with its time', /this\._hm\.push\(\[Date\.now\(\)/.test(src('business-deal/js/ui.js')) && /hm: sv \? undefined/.test(src('business-deal/js/ui.js')));
ok('parchis times every line and logs t0', /G\.pl\.mv\.push\(s \+ "@"/.test(src('parchis/index.html')) && /t0: pl\.t0 \|\| null/.test(src('parchis/index.html')));
ok('hold\'em logs each decision with its think time', /_noteAct\(mv, auto\)/.test(src('holdem/js/ui.js')) && /\.\.\.acts \}\) \}\); \}/.test(src('holdem/js/ui.js')));
ok('baseball logs the player\'s swings with times', /sw: this\._careerSwings\(\)/.test(src('baseball/js/ui.js')));

// ---------------------------------------------------------------- real data
const di = process.argv.indexOf('--db');
if (di > 0) {
  const log = JSON.parse(fs.readFileSync(process.argv[di + 1], 'utf8'));
  const ii = process.argv.indexOf('--input');
  const inputLog = ii > 0 && fs.existsSync(process.argv[ii + 1]) ? JSON.parse(fs.readFileSync(process.argv[ii + 1], 'utf8')) : null;
  const per = {};
  let total = 0;
  for (const [code, rows] of Object.entries(log || {})) for (const [id, e] of Object.entries(rows || {})) {
    if (!e || !OURS.includes(e.g) || !/^record/.test(String(e.f || ''))) continue;
    per[e.g] = (per[e.g] || 0) + 1;
    const nRaw = inputLog && inputLog[code] && inputLog[code][id] ? inputLog[code][id].n : null;
    for (const h of hits(e, nRaw)) { total++; console.log(`HIT ${h.proven ? 'PROVEN ' : ''}${code} ${id} ${e.g} ${h.rule}: ${h.v}`); }
  }
  console.log(`replayed ${Object.entries(per).map(([g, k]) => `${g} ${k}`).join(', ')}: ${total} hits`);
}
process.exit(fail ? 1 : 0);
