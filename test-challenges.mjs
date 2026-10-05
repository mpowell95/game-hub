// test-challenges.mjs - the hub's Challenges screen (js/challenges.js + the four games' handoffs).
//
// The PURE halves: one row shape out of four games' index rows, and the records folded from them
// (by person, by game, finished only, an unknown result counted as played and in no column). Then the
// HANDOFF contract every challenge game's alerts module must keep for the screen to work: armOpen
// (straight into a match), armChallenge (straight onto "challenge this person"), myTurnCount (the
// launcher button's number), each taken back by the game exactly once. Plus the wiring the game UIs
// need, as text checks (the DOM half needs a browser).
//   node test-challenges.mjs
import { readFileSync } from 'node:fs';

const mem = new Map();
const store = () => ({ getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) });
globalThis.localStorage = store();
const sess = new Map();
globalThis.sessionStorage = { getItem: (k) => (sess.has(k) ? sess.get(k) : null), setItem: (k, v) => sess.set(k, String(v)), removeItem: (k) => sess.delete(k) };
mem.set('gamehub.profile', JSON.stringify({ name: 'Matt', emoji: '🐙', playerId: 'MATTA' }));

const C = await import('./js/challenges.js');

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => { if (cond) { pass++; console.log('ok  ', label); } else { fail++; console.log('FAIL', label, extra); } };

// --- normalizeRow ---------------------------------------------------------------------------------
const n = C.normalizeRow;
ok('a live row waiting on you is "yours"', n('darts', { id: 'g1', with: 'ANABB', yourTurn: true, over: false }).state === 'yours');
ok('a live row waiting on them is "theirs"', n('darts', { id: 'g1', with: 'ANABB', yourTurn: false }).state === 'theirs');
ok('a finished row is "done" with its result', (() => { const r = n('hoops4', { id: 'g', with: 'ANABB', over: true, result: 'won' }); return r.state === 'done' && r.result === 'won'; })());
ok('an expired Skeeball row is "expired", not live', n('skeeball', { id: 'g', with: 'ANABB', yourTurn: true }, true).state === 'expired');
ok('a finished row with no stored result keeps result null (never guessed)', n('hoops4', { id: 'g', with: 'ANABB', over: true }).result === null);
ok('a live row never carries a result', n('darts', { id: 'g', with: 'ANABB', result: 'won' }).result === null);
ok('a row with no opponent is dropped', n('darts', { id: 'g' }) === null);
ok('series facts come through', (() => { const r = n('cuppong', { id: 'g', with: 'X', series: 3, seriesNo: 2 }); return r.info.series === 3 && r.info.seriesNo === 2; })());
ok('a one-game row reads series 0', n('cuppong', { id: 'g', with: 'X', series: 1 }).info.series === 0);
ok('a resignation is flagged', n('darts', { id: 'g', with: 'X', over: true, result: 'lost', why: 'resign' }).resigned === true);

// --- summarize ------------------------------------------------------------------------------------
const rows = [
  n('darts', { id: 'd1', with: 'ANABB', name: 'Ana', over: true, result: 'won', updated: 10 }),
  n('darts', { id: 'd2', with: 'ANABB', name: 'Ana', over: true, result: 'lost', updated: 20 }),
  n('skeeball', { id: 's1', with: 'ANABB', name: 'Ana B', over: true, result: 'draw', updated: 30 }),
  n('hoops4', { id: 'h1', with: 'LILIC', name: 'Lili', over: true, updated: 5 }),          // old row, no result
  n('hoops4', { id: 'h2', with: 'LILIC', name: 'Lili', yourTurn: true, updated: 40 }),
  n('cuppong', { id: 'c1', with: 'UNAID', name: 'Unai', yourTurn: false, updated: 50 }),
  n('skeeball', { id: 's2', with: 'UNAID', name: 'Unai', yourTurn: true, updated: 1 }, true), // expired
];
const S = C.summarize(rows);
ok('total counts only finished rows', S.total.played === 4, JSON.stringify(S.total));
ok('total won/lost/draw', S.total.won === 1 && S.total.lost === 1 && S.total.draw === 1);
ok('an unknown result is played, in no column', S.total.other === 1);
ok('yours / theirs split', S.yours.length === 1 && S.yours[0].id === 'h2' && S.theirs.length === 1 && S.theirs[0].id === 'c1');
ok('an expired row is listed with the finished ones, not live', S.finished.some((r) => r.id === 's2') && !S.yours.some((r) => r.id === 's2'));
ok('expired is not counted in the record', S.total.played === 4);
ok('by game', S.byGame.darts.won === 1 && S.byGame.darts.lost === 1 && S.byGame.skeeball.draw === 1 && S.byGame.hoops4.other === 1);
const ana = S.opponents.find((o) => o.code === 'ANABB');
ok('grouped by CODE, not name (Ana and "Ana B" are one person)', ana && ana.played === 3 && S.opponents.filter((o) => o.code === 'ANABB').length === 1);
ok('named by their most recent row', ana.name === 'Ana B');
ok('per-person, per-game', ana.byGame.darts.won === 1 && ana.byGame.darts.lost === 1 && ana.byGame.skeeball.draw === 1);
ok('someone waiting on you sorts first', S.opponents[0].code === 'LILIC');
ok('a person with only live games is still listed', S.opponents.some((o) => o.code === 'UNAID' && o.live === 1 && o.played === 0));
ok('finished newest first', S.finished[0].updated >= S.finished[S.finished.length - 1].updated);
ok('summarize does not mutate its input', rows[0].id === 'd1' && rows.length === 7);
ok('every registry source is one of the four challenge games',
  JSON.stringify(C.CHALLENGE_GAMES.slice().sort()) === JSON.stringify(['cuppong', 'darts', 'hoops4', 'skeeball']));

// --- the handoff contract, per game ---------------------------------------------------------------
const them = { code: 'ANABB', name: 'Ana', emoji: '🦊' };
for (const [game, path, take] of [
  ['darts', './darts/js/alert.js', 'takeOpen'],
  ['cuppong', './cup-pong/js/alert.js', 'takeOpen'],
  ['hoops4', './hoops4/js/alert.js', 'takeCeremony'],
  ['skeeball', './skeeball/js/alert.js', 'takeCeremony'],
]) {
  const A = await import(path);
  ok(`${game}: exports armOpen, armChallenge, myTurnCount`, ['armOpen', 'armChallenge', 'myTurnCount'].every((f) => typeof A[f] === 'function'));
  ok(`${game}: myTurnCount is 0 before any read`, A.myTurnCount() === 0);
  A.armOpen('match123');
  const o = A[take]();
  ok(`${game}: armOpen hands over the match id`, o && o.id === 'match123', JSON.stringify(o));
  ok(`${game}: taken once`, A[take]() === null);
  A.armChallenge(them);
  const p = A[take]();
  const code = p && (p.them ? p.them.code : p.code);
  const name = p && (p.them ? p.them.name : p.name);
  ok(`${game}: armChallenge hands over the person`, p && p.kind === 'pick' && code === 'ANABB' && name === 'Ana', JSON.stringify(p));
  ok(`${game}: pick taken once`, A[take]() === null);
  A.armChallenge({ name: 'no code' });
  ok(`${game}: a person with no code arms nothing`, A[take]() === null);
}

// --- the game side consumes it (text checks) ------------------------------------------------------
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
ok('darts: a pick opens the challenge card', /o\.kind === 'pick'\) this\._openOnline\(o\.them\)/.test(src('./darts/js/ui.js')) && /UI\.challengeTo\(this, MP, pickFor\)/.test(src('./darts/js/ui.js')));
ok('darts: mp-ui exports challengeTo', /export function challengeTo\(/.test(src('./darts/js/mp-ui.js')));
ok('cup pong: a pick opens the terms', /o\.kind === 'pick'\) this\.openMultiplayer\(o\.them\)/.test(src('./cup-pong/js/ui.js')) && /UI\.challengeTo\(this, MP, pickFor\)/.test(src('./cup-pong/js/ui.js')));
ok('cup pong: mp-ui exports challengeTo', /export function challengeTo\(/.test(src('./cup-pong/js/mp-ui.js')));
ok('hoops: a pick opens multiplayer on the terms', /armed\.kind === 'pick'/.test(src('./hoops4/js/ui.js')) && /pickFor/.test(src('./hoops4/js/mp-ui.js')));
ok('skeeball: a pick opens the challenge sheet on that person', /armed\.kind === 'pick' \? \{ pickFor: armed\.them \}/.test(src('./skeeball/js/ui.js')));

// --- the hub wires it -----------------------------------------------------------------------------
const hub = src('./js/hub.js');
ok('hub: the Challenges button exists and opens the screen', /data-role="challenges"/.test(hub) && /openChallenges\(\)/.test(hub));
ok('hub: a match opens through the game\'s armOpen', /mod\.armOpen\(matchId\)/.test(hub));
ok('hub: a new challenge goes through the game\'s armChallenge', /mod\.armChallenge\(them\)/.test(hub));
ok('hub: the count is summed from myTurnCount', /mod\.myTurnCount\(\)/.test(hub));
const sw = src('./sw.js');
ok('sw: the three new files are precached and network-first',
  ['challenges.js', 'challenges-ui.js', 'challenges-strings.js'].every((f) => sw.split(`'./js/${f}'`).length >= 3));
const data = src('./js/challenges.js') + src('./js/challenges-ui.js');
ok('the Challenges screen writes no gamehub.* key and no Firebase node',
  !/localStorage\.setItem|sessionStorage\.setItem|api\.(set|update|push|remove)\(/.test(data));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
