import { fileURLToPath as __toolsF2P } from 'node:url';
// Moved from the repo root to tools/ (2026-10-15): paths below resolve from the repo root.
const __ROOT_URL = new URL('../', import.meta.url).href;
const __ROOT_DIR = __toolsF2P(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
// test-challenges.mjs - the hub's Challenges screen (js/challenges.js + the four games' handoffs).
//
// The PURE halves: one row shape out of four games' index rows, and the records folded from them
// (by person, by game, finished only, an unknown result counted as played and in no column). Then the
// HANDOFF contract every challenge game's alerts module must keep for the screen to work: armOpen
// (straight into a match), armChallenge (straight onto "challenge this person"), myTurnCount (the
// launcher button's number), each taken back by the game exactly once. Plus the wiring the game UIs
// need, as text checks (the DOM half needs a browser).
//   node tools/test-challenges.mjs
import { readFileSync } from 'node:fs';

const mem = new Map();
const store = () => ({ getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) });
globalThis.localStorage = store();
const sess = new Map();
globalThis.sessionStorage = { getItem: (k) => (sess.has(k) ? sess.get(k) : null), setItem: (k, v) => sess.set(k, String(v)), removeItem: (k) => sess.delete(k) };
mem.set('gamehub.profile', JSON.stringify({ name: 'Matt', emoji: '🐙', playerId: 'MATTA' }));

const C = await import('../js/challenges.js');

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
// Chinchón and Escoba joined 2026-10-18 (turn-by-turn challenges beside their live rooms).
// Battle Arena joined 2026-10-24, Battleship 2026-10-27 (challenges beside their live rooms).
ok('every registry source is one of the eleven challenge games',
  JSON.stringify(C.CHALLENGE_GAMES.slice().sort()) === JSON.stringify(['archery', 'battle-arena', 'battleship', 'chinchon', 'cuppong', 'darts', 'eight-ball', 'escoba', 'flick-soccer', 'hoops4', 'skeeball']));

// --- the handoff contract, per game ---------------------------------------------------------------
const them = { code: 'ANABB', name: 'Ana', emoji: '🦊' };
for (const [game, path, take] of [
  ['darts', './darts/js/alert.js', 'takeOpen'],
  ['archery', './archery/js/alert.js', 'takeOpen'],
  ['chinchon', './chinchon/js/alert.js', 'takeOpen'],
  ['escoba', './escoba/js/alert.js', 'takeOpen'],
  ['battle-arena', './battle-arena/js/alert.js', 'takeOpen'],
  ['battleship', './battleship/js/alert.js', 'takeOpen'],
  ['flick-soccer', './flick-soccer/js/alert.js', 'takeOpen'],
  ['eight-ball', './eight-ball/js/alert.js', 'takeOpen'],
  ['cuppong', './cup-pong/js/alert.js', 'takeOpen'],
  ['hoops4', './hoops4/js/alert.js', 'takeCeremony'],
  ['skeeball', './skeeball/js/alert.js', 'takeCeremony'],
]) {
  const A = await import(new URL(path, __ROOT_URL).href);
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
const src = (p) => readFileSync(new URL(p, __ROOT_URL), 'utf8');
ok('darts: a pick opens the challenge card', /o\.kind === 'pick'\) this\._openOnline\(o\.them\)/.test(src('./darts/js/ui.js')) && /UI\.challengeTo\(this, MP, pickFor\)/.test(src('./darts/js/ui.js')));
ok('darts: mp-ui exports challengeTo', /export function challengeTo\(/.test(src('./darts/js/mp-ui.js')));
ok('flick soccer: a pick opens the challenge card', /o\.kind === 'pick'\) this\._openOnline\(o\.them\)/.test(src('./flick-soccer/js/ui.js')) && /UI\.challengeTo\(this, MP, pickFor\)/.test(src('./flick-soccer/js/ui.js')));
ok('flick soccer: mp-ui exports challengeTo', /export function challengeTo\(/.test(src('./flick-soccer/js/mp-ui.js')));
ok('archery: a pick opens the challenge card', /o\.kind === 'pick'\) this\._openOnline\(o\.them\)/.test(src('./archery/js/ui.js')) && /UI\.challengeTo\(this, MP, pickFor\)/.test(src('./archery/js/ui.js')));
ok('archery: mp-ui exports challengeTo', /export function challengeTo\(/.test(src('./archery/js/mp-ui.js')));
ok('battleship: a pick opens the deploy screen for that person, a match id opens the match',
  /o\.kind === 'pick'[\s\S]{0,200}_chStartPlacement\(\{ kind: 'new', them: o\.them/.test(src('./battleship/js/ui.js')) && /if \(o\.id\) \{ this\._chHome\(\); this\._chOpen\(o\.id\); \}/.test(src('./battleship/js/ui.js')));
ok('battle arena: a pick opens the draft for that person, a match id opens the match',
  /o\.kind === 'pick'\) \{ pickTeamFor\(ui, o\.them\)/.test(src('./battle-arena/js/online-ui.js')) && /if \(o && o\.id\) \{ await openChallenge\(ui, o\.id\)/.test(src('./battle-arena/js/online-ui.js')));
ok('escoba: a pick opens the length screen with that person', /o\.kind === 'pick'\) this\._chOpenLen\(o\.them/.test(src('./escoba/js/ui.js')));
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
ok('sw: js/mp-records.js is precached and network-first', sw.split(`'./js/mp-records.js'`).length >= 3);
const data = src('./js/challenges.js') + src('./js/challenges-ui.js') + src('./js/mp-records.js');
ok('the Challenges screen writes no gamehub.* key and no Firebase node',
  !/localStorage\.setItem|sessionStorage\.setItem|api\.(set|update|push|remove)\(/.test(data));

// --- cancel, decline, resign, expire (2026-10-13, js/challenge-life.js) -----------------------------
{
  ok('a cancelled row is "cancelled": listed, no result, in no record', (() => {
    const r = n('darts', { id: 'x1', with: 'ANABB', over: true, ended: 'cancelled', sent: true });
    const T = C.summarize([r]);
    return r.state === 'cancelled' && r.result === null && T.finished.length === 1 && T.total.played === 0;
  })());
  ok('a declined row is "cancelled" too, and says it was declined', n('hoops4', { id: 'x2', with: 'ANABB', over: true, ended: 'declined' }).ended === 'declined');
  ok('an expired row from any game is "expired"', n('cuppong', { id: 'x3', with: 'ANABB', over: true, ended: 'expired' }).state === 'expired');
  ok('a live row carries open and its deadline', (() => { const r = n('flick-soccer', { id: 'x4', with: 'ANABB', yourTurn: true, open: 'got', expires: 99 }); return r.open === 'got' && r.expires === 99; })());
  ok('a finished row carries no open or deadline', (() => { const r = n('darts', { id: 'x5', with: 'ANABB', over: true, result: 'won', open: 'got', expires: 9 }); return r.open === '' && r.expires === 0; })());
  ok('a Skeeball resignation reads as resigned', n('skeeball', { id: 'x6', with: 'ANABB', over: true, result: 'won', ended: 'resign' }).resigned === true);

  // Every challenge game says what may be done to a match and does it through its own writer.
  ok('every source has action and end', C.CHALLENGE_GAMES.every((g) => typeof C.SOURCES[g].action === 'function' && typeof C.SOURCES[g].end === 'function'));

  // [KNOWN-BUG PROBE] OPEN MATCHES ARE LOADED BEFORE THE TAP (2026-10-27). Matt: "I don't want it to
  // just show the setup card forever." The match was read only after Play; now every open match on
  // the list is watched, so the game's own read is answered at once.
  {
    const real = C.SOURCES.darts;
    const watching = new Set();
    let raw = [
      { id: 'y1', with: 'ANA22', name: 'Ana', over: false, yourTurn: true, updated: 3 },
      { id: 't1', with: 'BOB33', name: 'Bob', over: false, yourTurn: false, updated: 2 },
      { id: 'd1', with: 'BOB33', name: 'Bob', over: true, result: 'won', updated: 1 },
    ];
    const M = { watchGame: async (id) => { watching.add(id); return () => watching.delete(id); } };
    C.SOURCES.darts = { ...real, load: async () => M, read: async () => raw };
    await C.loadAll(['darts']);
    await new Promise((r) => setTimeout(r, 0));
    ok('[KNOWN-BUG PROBE] your-turn and their-turn matches are watched before the tap', watching.has('y1') && watching.has('t1'), [...watching].join(','));
    ok('...a finished one is not', !watching.has('d1'));
    await C.loadAll(['darts']);
    ok('...and reading again does not stack listeners', C.heldMatches().filter((k) => k === 'darts/y1').length === 1);
    raw = raw.map((r) => (r.id === 'y1' ? { ...r, over: true, result: 'lost', yourTurn: false } : r));
    await C.loadAll(['darts']);
    await new Promise((r) => setTimeout(r, 0));
    ok('...and a match that ends is let go', !watching.has('y1') && watching.has('t1'), [...watching].join(','));
    raw = [];
    await C.loadAll(['darts']);
    await new Promise((r) => setTimeout(r, 0));
    C.SOURCES.darts = real;
  }
  for (const [g, path] of [['hoops4', './hoops4/js/mp.js'], ['cuppong', './cup-pong/js/mp.js'], ['darts', './darts/js/mp.js'], ['flick-soccer', './flick-soccer/js/mp.js'], ['archery', './archery/js/mp.js'], ['escoba', './escoba/js/mp.js'], ['battle-arena', './battle-arena/js/mp.js'], ['battleship', './battleship/js/mp.js']]) {
    const M = await import(new URL(path, __ROOT_URL).href);
    ok(`${g}: mp.js exports cancelGame, resignGame, lifeOf, recipientOf, isCalledOff, readGame, sideOf, myCode`,
      ['cancelGame', 'resignGame', 'lifeOf', 'recipientOf', 'isCalledOff', 'readGame', 'sideOf', 'myCode'].every((k) => typeof M[k] === 'function'));
  }
  const SK = await import('../skeeball/js/challenge.js');
  ok('skeeball: challenge.js exports cancelChallenge, resignChallenge, isOpen, isCalledOff',
    ['cancelChallenge', 'resignChallenge', 'isOpen', 'isCalledOff', 'readChallenge', 'isExpired'].every((k) => typeof SK[k] === 'function'));

  // End to end through Darts, against an in-memory database (the same module instance the hub loads).
  const D = await import('../darts/js/mp.js');
  const root = {};
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const parts = (p) => p.split('/').filter(Boolean);
  const getAt = (p) => { let x = root; for (const k of parts(p)) { if (!x || typeof x !== 'object') return undefined; x = x[k]; } return x; };
  const setAt = (p, v) => { const ks = parts(p); let x = root; for (const k of ks.slice(0, -1)) { if (!x[k] || typeof x[k] !== 'object') x[k] = {}; x = x[k]; } if (v == null) delete x[ks[ks.length - 1]]; else x[ks[ks.length - 1]] = clone(v); };
  const api = {
    ref: (db, path) => ({ path }),
    get: async (r) => { const v = clone(getAt(r.path)); return { exists: () => v != null, val: () => v }; },
    set: async (r, v) => setAt(r.path, v),
    update: async (r, patch) => { for (const k of Object.keys(patch)) setAt(r.path + '/' + k, patch[k]); },
  };
  D.__setBootForTest(async () => ({ db: {}, api }), { allowDev: true });
  mem.set('gamehub.adminConfig.v1', JSON.stringify({ online: { MATTA: true, ANABB: true } }));
  const asMatt = () => mem.set('gamehub.profile', JSON.stringify({ name: 'Matt', emoji: '🐙', playerId: 'MATTA' }));
  const asAna = () => mem.set('gamehub.profile', JSON.stringify({ name: 'Ana', emoji: '🦊', playerId: 'ANABB' }));
  const miss = { x: 0, y: -2 };
  asMatt();
  let r = await D.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
  const g1 = r.id;
  await D.appendLog(g1, 0, [{ by: 'a', ...miss }, { by: 'a', ...miss }, { by: 'a', ...miss }]);
  ok('the sender is offered Cancel', (await C.endAction('darts', g1)) === 'cancel');
  asAna();
  ok('the receiver is offered Decline', (await C.endAction('darts', g1)) === 'decline');
  asMatt();
  r = await C.endMatch('darts', g1, 'cancel');
  ok('Cancel through the hub calls it off', r.ok && r.cancelled && getAt(`darts/games/${g1}/over/why`) === 'cancelled');
  ok('...and then nothing more is offered', (await C.endAction('darts', g1)) === null);
  r = await D.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
  const g2 = r.id;
  await D.appendLog(g2, 0, [{ by: 'a', ...miss }, { by: 'a', ...miss }, { by: 'a', ...miss }]);
  asAna();
  await D.appendLog(g2, 3, [{ by: 'b', ...miss }]);
  asMatt();
  ok('once answered, the sender is offered Resign', (await C.endAction('darts', g2)) === 'resign');
  const before = JSON.parse(mem.get('gamehub.stats') || '{}');
  const lostBefore = (((before.games || {}).darts || {}).byDiff || {}).mp ? before.games.darts.byDiff.mp.lost || 0 : 0;
  r = await C.endMatch('darts', g2, 'resign');
  const after = JSON.parse(mem.get('gamehub.stats') || '{}');
  ok('Resign through the hub: Ana wins, and the loss is counted on this phone once', r.ok && !r.cancelled
    && getAt(`darts/games/${g2}/over/winner`) === 'b' && after.games.darts.byDiff.mp.lost === lostBefore + 1, JSON.stringify(after.games && after.games.darts));
  ok('...and is not queued as a "Game over" popup for your own resignation', !D.readUnseen().includes(g2));
  D.__setBootForTest(null);
  ok('a made-up action is refused', (await C.endMatch('darts', g2, 'explode')).ok === false);

  const ui = src('./js/challenges-ui.js');
  // Since 2026-10-18 it sits behind a ⋯ on every live row (Matt's Multiplayer screen), one word in its menu.
  ok('every live row has a ⋯ offering Cancel / Decline / Resign', /class="cx-more"/.test(ui) && /cx_end_\$\{hint\}/.test(ui)
    && (ui.match(/\$\{more\}<\/li>/g) || []).length === 2);
  ok('...and it asks before it does anything (a confirm screen that re-reads the match)', /async function renderEnd/.test(ui) && /await endAction\(game, id\)/.test(ui) && /endMatch\(game, id, action\)/.test(ui));
}

// --- the Multiplayer screen's live-room records (2026-10-18, js/mp-records.js) ------------------
{
  const R = await import('../js/mp-records.js');
  const liveIds = Object.keys(R.LIVE_GAMES).sort();
  const hubLive = (src('./js/hub.js').match(/const LIVE_MP_GAMES = new Set\(\[([^\]]*)\]/) || [, ''])[1]
    .match(/'[^']+'/g).map((x) => x.slice(1, -1)).sort();
  ok('hub LIVE_MP_GAMES matches mp-records LIVE_GAMES', JSON.stringify(liveIds) === JSON.stringify(hubLive), hubLive.join());
  // A game in both (Chinchón, Escoba): Games reads its 'mp' bucket only, never the index too.
  {
    const dual = R.mergeRecords(C.summarize([C.normalizeRow('escoba', { id: 'e1', with: 'ANA22', name: 'Ana', over: true, result: 'won', updated: 1 })]),
      { byGame: { escoba: { won: 3, lost: 1, draw: 0, other: 0, played: 4 } }, people: [] });
    ok('a game with live rooms AND challenges is counted once (its mp bucket)', dual.byGame.escoba.won === 3 && dual.total.won === 3
      && dual.people.find((p) => p.code === 'ANA22').won === 1);
  }

  const stats = (games, h2h) => ({ games, h2h });
  const mp = (played, won, lost) => ({ total: { played, won, lost }, byDiff: { mp: { played, won, lost } } });
  // Matt has two phones (MATT1 owner node + a tablet), Ana one, Bo one with no code.
  const all = {
    phone: { profile: { name: 'Matt', emoji: '🤴', playerId: 'MATT1' }, updatedAt: 5,
      stats: stats({ battleship: mp(3, 2, 1) }, { battleship: { anaDev: { name: 'Ana', w: 2, l: 1 } } }) },
    tablet: { profile: { name: 'Matt', emoji: '🤴', playerId: 'MATT1' }, updatedAt: 4,
      stats: stats({ battleship: mp(1, 1, 0), tictactoe: mp(3, 1, 1) },
        { battleship: { anaDev: { name: 'Ana', w: 1, l: 0 } }, tictactoe: { boDev: { name: 'Bo', w: 1, l: 1 }, phone: { name: 'Matt', w: 5, l: 0 } } }) },
    anaDev: { profile: { name: 'Ana', emoji: '🦁', playerId: 'ANA22' }, updatedAt: 3, stats: stats({}, {}) },
  };
  // The phone's own store is fresher than its mirror (one more Battleship win, vs Ana).
  const local = stats({ battleship: mp(4, 3, 1) }, { battleship: { anaDev: { name: 'Ana', w: 3, l: 1 } } });
  const live = R.liveRecords(all, { name: 'Matt', emoji: '🤴', playerId: 'MATT1' }, 'phone', local);
  ok('games: online plays summed over both devices, local store fresher than its mirror',
    live.byGame.battleship.won === 4 && live.byGame.battleship.lost === 1 && live.byGame.battleship.played === 5, JSON.stringify(live.byGame));
  ok('games: a draw is played minus won minus lost', live.byGame['tic-tac-toe'].draw === 1);
  const ana = live.people.find((p) => p.code === 'ANA22');
  ok('people: an opponent device folds onto their player code, both my devices summed', ana && ana.won === 4 && ana.lost === 1 && ana.byGame.battleship.won === 4, JSON.stringify(live.people));
  const bo = live.people.find((p) => p.name === 'Bo');
  ok('people: an opponent with no synced record keeps its own row, no code, never guessed', bo && !bo.code && bo.won === 1 && bo.lost === 1);
  ok('people: a row against my own device is never a person', !live.people.some((p) => p.code === 'MATT1'));
  ok('liveRecords never mutates players/', JSON.stringify(all.phone.stats.h2h) === JSON.stringify({ battleship: { anaDev: { name: 'Ana', w: 2, l: 1 } } }));

  const sum = C.summarize([
    C.normalizeRow('darts', { id: 'd1', with: 'ANA22', name: 'Ana', over: true, result: 'won', updated: 9 }),
    C.normalizeRow('darts', { id: 'd2', with: 'ANA22', name: 'Ana', yourTurn: true, updated: 8 }),
  ]);
  const m = R.mergeRecords(sum, live);
  const anaM = m.people.find((p) => p.code === 'ANA22');
  ok('merge: one person across challenge and live games', anaM && anaM.won === 5 && anaM.lost === 1 && anaM.byGame.darts.won === 1 && anaM.live === 1);
  ok('merge: the total is the sum of the games', m.total.won === 4 + 1 + 1 && m.total.lost === 1 + 1, JSON.stringify(m.total));
  ok('offline: an empty players/ still shows this device', R.liveRecords({}, { name: 'Matt', playerId: 'MATT1' }, 'phone', local).byGame.battleship.won === 3);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
