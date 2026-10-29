import { fileURLToPath as __toolsF2P } from 'node:url';
// Moved from the repo root to tools/ (2026-10-15): paths below resolve from the repo root.
const __ROOT_URL = new URL('../', import.meta.url).href;
const __ROOT_DIR = __toolsF2P(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
// test-skee-challenge.mjs - SKEEBALL CHALLENGES (2026-09-24). `node tools/test-skee-challenge.mjs`
//
// The pure rules behind "beat my score" (skeeball/js/challenge.js): series of 1/3/5 games or every
// machine, scored by most wins or by total, one attempt per game, leaving counts. Plus the launcher
// bubble (skeeball/js/alert.js), which machines two players share (challenge-ui.js), the push
// decision (functions/decide.js decideSkee), the hub's multi-game pills, and the wiring.
import { readFileSync } from 'node:fs';

const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

const CH = await import('../skeeball/js/challenge.js');
const { decideAlert } = await import('../skeeball/js/alert.js');
const { challengeBoards, unlockedFrom } = await import('../skeeball/js/challenge-ui.js');
const { decideSkee } = await import('../functions/decide.js');

let pass = 0; let fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name); } };
const read = (p) => readFileSync(new URL(p, __ROOT_URL), 'utf8');

const A = 'MTTTT'; const B = 'ANNAA';
const leg = (board = 'classic', boardName = 'THE CLASSIC') => ({ board, boardName });
const doc = (extra = {}) => ({
  v: 2, id: 'mabc12345xyz', by: A, created: 1000, updated: 1000, expires: 0,
  scoring: 'games', all: false, legs: [leg()], caption: 'beat that',
  a: { code: A, name: 'Matt', emoji: '😎', s: {} }, b: { code: B, name: 'Anita', emoji: '🌸', s: {} },
  stage: 'a', over: null, ...extra,
});
const withScores = (g, a, b) => ({ ...g, a: { ...g.a, s: { ...a } }, b: { ...g.b, s: { ...b } } });

// --- the document ----------------------------------------------------------------------------------
let g = CH.validateChallenge(doc());
check('a new challenge validates, on the challenger\'s turn, nothing played', g && g.stage === 'a' && CH.nextLeg(g, 'a') === 0 && CH.nextLeg(g, 'b') === -1);
check('a challenge to yourself is refused', CH.validateChallenge(doc({ b: { code: A } })) === null);
check('a garbage score is refused, not half-shown', CH.validateChallenge(doc({ a: { code: A, s: { 0: 'lots' } } })) === null);
check('a score for a game that does not exist is refused', CH.validateChallenge(doc({ a: { code: A, s: { 3: 10 } } })) === null);
check('Firebase turning `legs` into an object still reads', CH.validateChallenge(doc({ legs: { 0: leg(), 1: leg() } })).legs.length === 2);
const v1 = CH.validateChallenge({ v: 1, id: 'oldold1234', created: 1000, board: 'classic', boardName: 'THE CLASSIC',
  a: { code: A, score: 320 }, b: { code: B }, over: null });
check('a v1 (one game) document still reads, as a one-game challenge on the challenged player\'s turn',
  v1 && v1.legs.length === 1 && v1.stage === 'b' && CH.scoresOf(v1, 'a')[0] === 320 && v1.expires === 1000 + CH.EXPIRE_MS);

// --- building the games ------------------------------------------------------------------------
const boards = [{ id: 'classic', name: 'THE CLASSIC' }, { id: 'basketball', name: 'HOT SHOT' }, { id: 'brickcity', name: 'BRICK CITY' }];
check('3 games = three games on the chosen machine', CH.makeLegs({ count: 3, board: 'basketball', boards }).map((l) => l.board).join() === 'basketball,basketball,basketball');
check('all machines = one game on each shared machine', CH.makeLegs({ all: true, boards }).map((l) => l.board).join() === 'classic,basketball,brickcity');
check('a count that is not 1/3/5 falls back to 1', CH.makeLegs({ count: 4, board: 'classic', boards }).length === 1);

// --- most wins -----------------------------------------------------------------------------------
const bo3 = doc({ legs: [leg(), leg(), leg()], stage: 'b' });
check('best of 3: 2-0 up with one to play is decided early', (() => { const d = CH.decide(withScores(bo3, { 0: 100, 1: 100, 2: 100 }, { 0: 200, 1: 150 })); return d.done && d.winner === 'b'; })());
check('best of 3: 0-2 down is decided early the other way', (() => { const d = CH.decide(withScores(bo3, { 0: 300, 1: 300, 2: 100 }, { 0: 200, 1: 150 })); return d.done && d.winner === 'a'; })());
check('best of 3: 1-1 is not decided', !CH.decide(withScores(bo3, { 0: 300, 1: 100, 2: 100 }, { 0: 200, 1: 150 })).done);
check('a tied game counts for nobody; level on games goes to the higher total',
  (() => { const d = CH.decide(withScores(bo3, { 0: 300, 1: 100, 2: 200 }, { 0: 200, 1: 150, 2: 200 })); return d.done && d.winner === 'a'; })());
check('level on games AND total is a draw',
  (() => { const d = CH.decide(withScores(bo3, { 0: 300, 1: 100, 2: 200 }, { 0: 100, 1: 300, 2: 200 })); return d.done && d.winner === null; })());

// --- total score ---------------------------------------------------------------------------------
const tot = doc({ legs: [leg(), leg(), leg()], scoring: 'total', stage: 'b' });
check('total: never settled while games are left, even far ahead (turns alternate, both totals can still grow)',
  !CH.decide(withScores(tot, { 0: 100, 1: 100 }, { 0: 250, 1: 60 })).done);
check('total: all played and behind loses; equal is a draw',
  CH.decide(withScores(tot, { 0: 100, 1: 100, 2: 100 }, { 0: 100, 1: 100, 2: 90 })).winner === 'a'
  && CH.decide(withScores(tot, { 0: 100, 1: 100, 2: 100 }, { 0: 100, 1: 100, 2: 100 })).winner === null);
check('[KNOWN-BUG PROBE] total: the CHALLENGED player can win (it was stored as a tie)',
  CH.decide(withScores(tot, { 0: 290, 1: 520, 2: 440 }, { 0: 320, 1: 650, 2: 820 })).winner === 'b');
const king = CH.validateChallenge({ ...withScores(tot, { 0: 290, 1: 520, 2: 440 }, { 0: 320, 1: 650, 2: 820 }), stage: 'over', over: { at: 5 } });
check('the real King of Games match (stored with no winner) now reads as his win', CH.resultFor(king, 'b') === 'won' && CH.resultFor(king, 'a') === 'lost');
check('a finished row\'s result comes from its own numbers, not the stored "draw"',
  CH.rowsFromIndex({ muftb7ifyzn2ac6n: { with: 'KNGGG', n: 3, scoring: 'total', over: true, result: 'draw', mine: 1250, theirs: 1790 } })[0].result === 'lost');
check('...and a real draw still reads as a draw',
  CH.rowsFromIndex({ muftb7ifyzn2ac6n: { with: 'KNGGG', n: 3, scoring: 'total', over: true, result: 'draw', mine: 900, theirs: 900 } })[0].result === 'draw');
check('results read from each side', CH.resultFor({ over: { winner: 'b' } }, 'b') === 'won' && CH.resultFor({ over: { winner: 'b' } }, 'a') === 'lost'
  && CH.resultFor({ over: { winner: null } }, 'a') === 'draw');

// --- turns alternate, one game each (v3) ------------------------------------------------------------
const alt = doc({ legs: [leg(), leg(), leg()] });
check('after the challenger\'s game 1, it is the other person\'s turn', CH.nextStage(withScores(alt, { 0: 300 }, {}), 'a') === 'b');
check('after their game 1, it is the challenger\'s turn again (never two games in a row)', CH.nextStage(withScores(alt, { 0: 300 }, { 0: 200 }), 'b') === 'a');
check('the challenger\'s next game is game 2, and only on their turn',
  CH.nextLeg({ ...withScores(alt, { 0: 300 }, { 0: 200 }), stage: 'a' }, 'a') === 1 && CH.nextLeg({ ...withScores(alt, { 0: 300 }, { 0: 200 }), stage: 'b' }, 'a') === -1);
check('an old (v2) match where the challenger played everything still runs to its end',
  CH.nextStage(withScores(alt, { 0: 1, 1: 2, 2: 3 }, { 0: 5 }), 'b') === 'b');

// --- index rows ----------------------------------------------------------------------------------
const mid = CH.validateChallenge(withScores(doc({ legs: [leg(), leg(), leg()], stage: 'b', expires: Date.now() + 1e6 }), { 0: 300, 1: 200, 2: 100 }, { 0: 350 }));
const ra = CH.rowFor(mid, 'a'); const rb = CH.rowFor(mid, 'b');
check('the challenger\'s row: sent, waiting, totals and games from their side', ra.sent && !ra.yourTurn && ra.mine === 600 && ra.theirs === 350 && ra.theirWins === 1 && ra.n === 3);
check('the challenged row: their turn, the format and totals carried', !rb.sent && rb.yourTurn && rb.theirs === 600 && rb.played === 1 && rb.theirPlayed === 3 && rb.scoring === 'games');
const rows = CH.rowsFromIndex({ aaaaaa11: rb, bbbbbb22: { ...ra, updated: 9 }, BAD: { with: B }, dddddd44: { with: 'nope' } });
check('an index lists valid rows only, your turn first', rows.length === 2 && rows[0].id === 'aaaaaa11');
const late = Date.now() + 2e6;
const grp = CH.groupRows(CH.rowsFromIndex({ aaaaaa11: rb, bbbbbb22: ra }), late);
check('past its 3 days an unanswered challenge is EXPIRED, for both people', grp.toPlay.length === 0 && grp.done.length === 2);
check('the challenger\'s own unfinished games never expire (no clock until delivery)', !CH.isExpired({ over: false, expires: 0 }, late));

// --- one attempt, and leaving counts ---------------------------------------------------------------
check('a game is committed before its first ball', CH.beginLeg('mabc12345xyz', 'a', 0) && CH.legPlayed('mabc12345xyz', 'a', 0));
check('ONE ATTEMPT: the same game cannot be started twice', !CH.beginLeg('mabc12345xyz', 'a', 0));
check('the next game skips one already started on this device', CH.nextLeg(doc({ legs: [leg(), leg()] }), 'a', (i) => CH.legPlayed('mabc12345xyz', 'a', i)) === 1);
CH.saveLeg('mabc12345xyz', 'a', 0, 140);
check('the running score is saved after every ball', CH.readOutbox().find((x) => x.leg === 0).score === 140);
check('...and is not sent while the rack is live', !CH.readOutbox().find((x) => x.leg === 0).final);
check('a KILLED app\'s game is finalised at its last saved score on the next open (leaving counts)',
  CH.finalizeStale() === 1 && CH.readOutbox().find((x) => x.leg === 0).final && CH.readOutbox().find((x) => x.leg === 0).score === 140);
check('a finalised score is never overwritten', !CH.saveLeg('mabc12345xyz', 'a', 0, 999) && CH.readOutbox().find((x) => x.leg === 0).score === 140);
check('this device\'s unsent score shows on the match', CH.scoresOf(CH.withLocal(CH.validateChallenge(doc())), 'a')[0] === 140);
check('the outbox refuses a bad id', !CH.beginLeg('BAD', 'a', 0));
check('a SHARED phone: the other player\'s same game is not blocked by this one', !CH.legPlayed('mabc12345xyz', 'b', 0) && CH.beginLeg('mabc12345xyz', 'b', 0));

// --- the launcher bubble ---------------------------------------------------------------------------
const fresh = CH.rowsFromIndex({ aaaaaa11: { ...rb, updated: 5 } });
let al = decideAlert(fresh, {});
check('a delivered challenge to you raises "challenged you"', al && al.kind === 'challenge' && al.name === 'Matt');
check('...and not once seen', decideAlert(fresh, { aaaaaa11: 5 }) === null);
check('your OWN new challenge never raises a bubble (you just made it)', decideAlert(CH.rowsFromIndex({ bbbbbb22: { ...ra, stage: 'a', yourTurn: true, updated: 5 } }), { bbbbbb22: 5 }) === null);
al = decideAlert(CH.rowsFromIndex({ bbbbbb22: { ...ra, stage: 'a', yourTurn: true, updated: 9 } }), { bbbbbb22: 5 });
check('the turn coming BACK to the challenger raises "Your turn vs <them>"', al && al.kind === 'turn' && al.names.join() === 'Anita');
const over = CH.rowFor(CH.validateChallenge({ ...withScores(doc(), { 0: 300 }, { 0: 350 }), stage: 'over', over: { winner: 'b', at: 7 }, updated: 7 }), 'a');
al = decideAlert(CH.rowsFromIndex({ cccccc33: over }), {});
check('a finished match you have not seen raises a result bubble', al && al.kind === 'over' && al.result === 'lost');
check('an expired challenge raises nothing', decideAlert(CH.rowsFromIndex({ aaaaaa11: { ...rb, updated: 5, expires: 10 } }), {}) === null);

// --- which machines two players share ------------------------------------------------------------
const Bd0 = [{ id: 'classic' }, { id: 'basketball' }, { id: 'brickcity' }, { id: 'runaway' }, { id: 'popongo', adminOnly: true }];
const Bd = Bd0;
const opts = (released = [], testing = ['popongo']) => ({ boards: Bd, released: (b) => released.includes(b.id), testing: (b) => testing.includes(b.id) });
const ids = (l) => l.map((b) => b.id).join(',');
check('THE CLASSIC is always offered', ids(challengeBoards(new Set(), opts())) === 'classic');
check('every machine the CHALLENGER has earned is offered (the other person need not have it)',
  ids(challengeBoards(new Set(['basketball', 'brickcity']), opts())) === 'classic,basketball,brickcity');
check('a machine opened to everyone is offered', ids(challengeBoards(new Set(), opts(['runaway']))) === 'classic,runaway');
check('a machine in TESTING is never offered', !challengeBoards(new Set(['popongo']), opts()).some((b) => b.id === 'popongo'));
check('a challenge never writes an unlock', !/unlockSkeeballBoard|sk\.unlocked\s*=/.test(read('./skeeball/js/challenge-ui.js') + read('./skeeball/js/challenge.js')));
const all = {
  d1: { profile: { playerId: B }, stats: { games: { skeeball: { sk: { unlocked: { basketball: true } } } } } },
  d2: { profile: { playerId: B }, stats: { games: { skeeball: { sk: { unlocked: { brickcity: true } } } } } },
  d3: { profile: { playerId: A }, stats: { games: { skeeball: { sk: { unlocked: { runaway: true } } } } } },
};
check('a player\'s unlocks are the UNION of every device they play on', [...unlockedFrom(all, B)].join() === 'basketball,brickcity');

// --- the notification ----------------------------------------------------------------------------
const body = (n) => n && n.text('en').body;
const one = CH.validateChallenge(withScores(doc({ stage: 'b', expires: 1 }), { 0: 320 }, {}));
let n = decideSkee({ code: B, id: 'x', before: null, after: CH.rowFor(one, 'b') });
check('delivery of a one-game challenge: "Beat 320!"', n && n.kind === 'challenge' && body(n) === 'Matt challenged you on THE CLASSIC. Beat 320!');
check('...in Spanish when their phone is', /te ha retado en THE CLASSIC/.test(n.text('es').body));
n = decideSkee({ code: B, id: 'x', before: null, after: rb });
check('delivery of a series says how many games', body(n) === 'Matt challenged you: 3 games on THE CLASSIC.');
n = decideSkee({ code: B, id: 'x', before: null, after: { ...rb, all: true } });
check('delivery of an all-machines challenge says so', body(n) === 'Matt challenged you on every machine.');
check('the challenger\'s own row never notifies them', decideSkee({ code: A, id: 'x', before: null, after: ra }) === null);
n = decideSkee({ code: A, id: 'x', before: { ...ra, yourTurn: false }, after: { ...ra, over: true, result: 'lost', yourTurn: false } });
check('the result notifies the challenger', n && n.kind === 'over' && body(n) === 'Anita beat your challenge.');
check('whoever played the LAST game is not told (they ended it)', decideSkee({ code: B, id: 'x', before: rb, after: { ...rb, over: true, result: 'won', yourTurn: false } }) === null);
n = decideSkee({ code: A, id: 'x', before: { ...ra, yourTurn: false }, after: { ...ra, yourTurn: true, theirPlayed: 1 } });
check('the turn coming back notifies: "<them> played game 1 of 3. Your turn!"', n && n.kind === 'turn' && body(n) === 'Anita played game 1 of 3. Your turn!');
check('a write that does not hand you the turn notifies nobody', decideSkee({ code: A, id: 'x', before: { ...ra, yourTurn: false }, after: { ...ra, yourTurn: false, played: 3 } }) === null);

// --- wiring ------------------------------------------------------------------------------------
const rules = JSON.parse(read('./database.rules.json')).rules;
check('`skeeChallenges` is enumerated in database.rules.json (the root is deny-by-default)', !!rules.skeeChallenges);
check('...and in the backup\'s branch list', /'skeeChallenges'/.test(read('./backups/rtdb-backup.mjs')));
const fn = read('./functions/index.js');
check('the Cloud Function watches the per-player index', /ref: '\/skeeChallenges\/index\/\{code\}\/\{id\}'/.test(fn) && /decideSkee/.test(fn));
const hub = read('./js/hub.js');
check('the hub registers Skeeball\'s alerts module', /alerts: \(\) => import\('\.\.\/skeeball\/js\/alert\.js'\)/.test(hub));
check('the hub collects EVERY game\'s alert, not the first', /found\.push\(\{ game: g\.id, alert, mod \}\)/.test(hub) && !/one bubble at a time/.test(hub));
check('two or more alerts draw a small pill per tile', /list\.length > 1/.test(hub) && /hub-alert is-mini/.test(hub) && /\.hub-alert\.is-mini/.test(read('./css/hub.css')));
check('a pill opens ITS OWN game', /this\._openAlertGame\(bubble\.dataset\.game\)/.test(hub));
const sw = read('./sw.js');
check('the three challenge files are in sw.js ASSETS', ['challenge.js', 'challenge-ui.js', 'alert.js'].every((f) => sw.includes(`'./skeeball/js/${f}',`)));
const ui = read('./skeeball/js/ui.js');
check('a challenge game is committed before its first ball', /CH\.beginLeg\(ch\.id, ch\.side, ch\.leg\)/.test(ui) && /_startGameInner\(snap, board\) \{\n\s*if \(this\.challenge && !this\._commitChallengeLeg\(\)\) return;/.test(ui));
check('the score is saved after every ball', /this\._paintHud\(\);\n\s*this\._saveChallengeProgress\(\);/.test(ui));
check('finishing AND walking out both finalise the score', (ui.match(/this\._finishChallengeLeg\(/g) || []).length >= 2);
check('walking out counts even with nothing thrown (it runs before the nothing-thrown return)',
  /_abandonRack\(\) \{\n\s*if \(!this\.game \|\| this\.game\.over \|\| this\.recorded\) return;[\s\S]{0,300}this\._finishChallengeLeg\(this\.game\.score\);[\s\S]{0,300}if \(!this\.game\.thrown\)/.test(ui));
check('a killed app\'s game is finalised on the next open', /CH\.finalizeStale\(\)/.test(ui));
check('no "try again" anywhere in a challenge', !/ch_try_again/.test(read('./skeeball/js/challenge-ui.js')));
check('ONE GAME PER TURN: the card after a game never offers the next one',
  !/data-act="next"/.test(read('./skeeball/js/challenge-ui.js').slice(read('./skeeball/js/challenge-ui.js').indexOf('export function showChallengeOver'))));
check('the pause card offers no New game during a challenge', /\$\{this\.challenge \? '' : `<button[^`]*data-role="new"/.test(ui));
check('the ordinary Play button drops any challenge', /data-role="play"\]'\)\.addEventListener\('click', \(\) => \{\s*this\.challenge = null;/.test(ui));
check('challenge games are recorded like any other (the recorder call is untouched)', (ui.match(/recordSkeeball\(board\.id, \{ \.\.\./g) || []).length === 2);
check('the rack start token is still initialised', /this\._startToken = 0;/.test(ui));

// --- cancel, decline, resign (2026-10-13) ----------------------------------------------------------
{
  // Pure: the document and the rows.
  const off = CH.validateChallenge(doc({ a: { code: A, name: 'Matt', emoji: '😎', s: { 0: 120 } }, stage: 'b', over: { winner: 'none', why: 'cancelled', at: 5 } }));
  check('cancel: a called-off challenge is over with winner none, nobody\'s result',
    off && off.over.winner === 'none' && CH.isCalledOff(off) && CH.resultFor(off, 'a') === null && CH.resultFor(off, 'b') === null);
  check('cancel: an unknown reason is refused', CH.validateChallenge(doc({ over: { winner: 'none', why: 'meh' } })) === null);
  const raced = CH.validateChallenge(doc({ legs: [leg(), leg(), leg()], a: { code: A, s: { 0: 120 } }, b: { code: B, s: { 0: 90 } }, stage: 'a', over: { winner: 'none', why: 'declined' } }));
  check('cancel: one that raced the first answer is void, the challenge plays on', raced && !raced.over);
  const rs = CH.validateChallenge(doc({ legs: [leg(), leg(), leg()], a: { code: A, s: { 0: 50 } }, b: { code: B, s: { 0: 300 } }, stage: 'a', over: { winner: 'b', why: 'resign' } }));
  check('resign: the named winner stands even when the scores say otherwise', rs && rs.over.winner === 'b' && rs.over.why === 'resign');
  const wouldFlip = CH.validateChallenge(doc({ legs: [leg(), leg(), leg()], a: { code: A, s: { 0: 500, 1: 500 } }, b: { code: B, s: { 0: 1, 1: 1 } }, stage: 'over', over: { winner: 'b', why: 'resign' } }));
  check('resign: never re-derived from the scores', wouldFlip && wouldFlip.over.winner === 'b');
  const open0 = CH.validateChallenge(doc({ a: { code: A, s: { 0: 120 } }, stage: 'b' }));
  check('isOpen until the challenged player has a score in', CH.isOpen(open0) && !CH.isOpen(raced));
  const rowB = CH.rowFor(off, 'b');
  check('a called-off row is stored over:false (no push), with ended', rowB.over === false && rowB.yourTurn === false && rowB.ended === 'cancelled' && !('result' in rowB));
  check('...the push function stays silent for it', decideSkee({ code: B, id: 'x', before: { yourTurn: true, over: false }, after: rowB }) === null);
  const rows = CH.rowsFromIndex({ mabc12345xyz: rowB });
  check('...and it reads back finished, no result', rows[0].over && rows[0].ended === 'cancelled' && rows[0].result === null && !rows[0].yourTurn);
  check('...and raises no launcher bubble', decideAlert(rows, {}) === null);
  const rowA = CH.rowFor(rs, 'a');
  const rr = CH.rowsFromIndex({ mabc12345xyz: rowA });
  check('a resigned row reads back with the stored result, not the scores', rowA.over === false && rr[0].over && rr[0].result === 'lost' && rr[0].ended === 'resign');
  check('the open row says sent / got', CH.rowFor(open0, 'a').open === 'sent' && CH.rowFor(open0, 'b').open === 'got' && CH.rowFor(raced, 'b').open === '');

  // The writes, against an in-memory database.
  const root = {};
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const parts = (p) => p.split('/').filter(Boolean);
  const getAt = (p) => { let n = root; for (const k of parts(p)) { if (!n || typeof n !== 'object') return undefined; n = n[k]; } return n; };
  const setAt = (p, v) => {
    const ks = parts(p); let n = root;
    for (const k of ks.slice(0, -1)) { if (!n[k] || typeof n[k] !== 'object') n[k] = {}; n = n[k]; }
    if (v === null || v === undefined) delete n[ks[ks.length - 1]]; else n[ks[ks.length - 1]] = clone(v);
  };
  const api = {
    ref: (db, path) => ({ path }),
    get: async (r) => { const v = clone(getAt(r.path)); return { exists: () => v !== undefined && v !== null, val: () => v }; },
    set: async (r, v) => setAt(r.path, v),
    update: async (r, patch) => { for (const k of Object.keys(patch)) setAt(r.path + '/' + k, patch[k]); },
  };
  CH.__setBootForTest(async () => ({ db: {}, api }));
  const as = (code, name) => { store['gamehub.profile'] = JSON.stringify({ name, emoji: '🙂', playerId: code }); };
  store['gamehub.adminConfig.v1'] = JSON.stringify({ online: { [A]: true, [B]: true } });
  as(A, 'Matt');
  let r = await CH.createChallenge({ them: { code: B, name: 'Anita' }, legs: [leg(), leg(), leg()] });
  const id1 = r.game && r.game.id;
  check('write: a challenge is made', r.ok && id1);
  await CH.postLeg(id1, 'a', 0, 120);
  check('write: game 1 in, delivered', !!getAt(`skeeChallenges/index/${B}/${id1}`) && getAt(`skeeChallenges/index/${B}/${id1}`).open === 'got');
  r = await CH.cancelChallenge(id1);
  check('write: the challenger cancels it', r.ok && r.cancelled && r.game.over.why === 'cancelled'
    && getAt(`skeeChallenges/index/${B}/${id1}`).ended === 'cancelled' && getAt(`skeeChallenges/index/${A}/${id1}`).ended === 'cancelled');
  as(B, 'Anita');
  check('write: no score gets in after', (await CH.postLeg(id1, 'b', 0, 90)).reason === 'already-over');

  as(A, 'Matt');
  r = await CH.createChallenge({ them: { code: B, name: 'Anita' }, legs: [leg(), leg(), leg()] });
  const id2 = r.game.id;
  await CH.postLeg(id2, 'a', 0, 120);
  as(B, 'Anita');
  r = await CH.resignChallenge(id2);
  check('write: giving up an unanswered challenge DECLINES it', r.ok && r.cancelled && r.game.over.why === 'declined');

  as(A, 'Matt');
  r = await CH.createChallenge({ them: { code: B, name: 'Anita' }, legs: [leg(), leg(), leg()] });
  const id3 = r.game.id;
  await CH.postLeg(id3, 'a', 0, 120);
  as(B, 'Anita');
  await CH.postLeg(id3, 'b', 0, 300);
  as(A, 'Matt');
  check('write: once answered it cannot be cancelled', (await CH.cancelChallenge(id3)).reason === 'accepted');
  r = await CH.resignChallenge(id3);
  check('write: Matt resigns, Anita wins', r.ok && !r.cancelled && r.game.over.winner === 'b' && r.game.over.why === 'resign');
  as(B, 'Anita');
  const mine = (await CH.readMyChallenges()).find((x) => x.id === id3);
  check('write: her list says she won, finished', mine && mine.over && mine.result === 'won' && mine.ended === 'resign');
  check('write: the scores stay on the match', getAt(`skeeChallenges/games/${id3}/a/s/0`) === 120 && getAt(`skeeChallenges/games/${id3}/b/s/0`) === 300);

  // --- ONE ATTEMPT ACROSS STORAGES (2026-10-29): the server start marker -----------------------------
  // The rule: write-once, as in database.rules.json (skeeChallenges/games/$id/$side/started/$leg).
  api.serverTimestamp = () => ({ '.sv': 'timestamp' });
  const plainSet = api.set;
  api.set = async (r, v) => {
    if (/\/started\/\d+$/.test(r.path)) {
      if (getAt(r.path) !== undefined) throw Object.assign(new Error('PERMISSION_DENIED'), { code: 'PERMISSION_DENIED' });
      return plainSet(r, { ...v, at: Date.now() });
    }
    return plainSet(r, v);
  };
  const SAFARI = 'safari00key1'; const HOMEAPP = 'homeapp0key2';
  const storage = (k) => { store[CH.LEG_KEY] = k; };
  as(A, 'Matt');
  r = await CH.createChallenge({ them: { code: B, name: 'Anita' }, legs: [leg(), leg(), leg()] });
  const id4 = r.game.id;
  await CH.postLeg(id4, 'a', 0, 120);
  as(B, 'Anita');
  storage(SAFARI);
  const c1 = await CH.claimLeg(id4, 'b', 0);
  check('claim: the first storage claims the game on the server', c1.ok && getAt(`skeeChallenges/games/${id4}/b/started/0`).k === SAFARI);
  check('claim: a retry from the same storage is still ok', (await CH.claimLeg(id4, 'b', 0)).ok);
  storage(HOMEAPP);
  const c2 = await CH.claimLeg(id4, 'b', 0);
  check('claim: the Home Screen app (other storage) cannot start the same game', !c2.ok && c2.reason === 'started-elsewhere');
  const g4 = await CH.readChallenge(id4);
  check('claim: the other storage sees it as started elsewhere', CH.startedElsewhere(g4, 'b', 0));
  storage(SAFARI);
  check('claim: the storage that started it is not blocked by its own marker', !CH.startedElsewhere(g4, 'b', 0));
  check('claim: the marker is not a score (the game is still to be sent)', CH.scoresOf(g4, 'b')[0] === null);
  const sent = await CH.postLeg(id4, 'b', 0, 200);
  check('claim: the started game\'s score is sent as usual', sent.ok && getAt(`skeeChallenges/games/${id4}/b/s/0`) === 200);
  check('claim: a game already scored cannot be claimed', (await CH.claimLeg(id4, 'b', 0)).reason === 'not-your-turn'
    || (await CH.claimLeg(id4, 'b', 0)).reason === 'already-played');

  // Offline: never started (a write queued offline would land later).
  const nav = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true, writable: true });
  as(A, 'Matt');
  const off1 = await CH.claimLeg(id4, 'a', 1);
  check('offline: a challenge game is refused before anything is written', !off1.ok && off1.reason === 'offline' && getAt(`skeeChallenges/games/${id4}/a/started/1`) === undefined);
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
  CH.__setBootForTest(async () => null);
  check('offline: no database at all, refused too', (await CH.claimLeg(id4, 'a', 1)).reason === 'offline');
  CH.__setBootForTest(async () => ({ db: {}, api }));

  // Started and never sent: 0 after 30 minutes, on every phone, and the turn moves on.
  storage(SAFARI);
  check('timeout: Matt claims game 2', (await CH.claimLeg(id4, 'a', 1)).ok);
  const startedAt = getAt(`skeeChallenges/games/${id4}/a/started/1`).at;
  const rawG = getAt(`skeeChallenges/games/${id4}`);
  const early = CH.validateChallenge(rawG, startedAt + CH.START_GRACE_MS - 1000);
  check('timeout: 29 minutes on, still his turn, no score', early.stage === 'a' && CH.scoresOf(early, 'a')[1] === null && !early.timedOut.length);
  const late = CH.validateChallenge(rawG, startedAt + CH.START_GRACE_MS + 1000);
  check('timeout: 30 minutes on, it counts 0 and it is her turn (derived, nothing written)', late.stage === 'b'
    && CH.scoresOf(late, 'a')[1] === 0 && late.timedOut.length === 1 && getAt(`skeeChallenges/games/${id4}/a/s/1`) === undefined
    && late.expires === startedAt + CH.START_GRACE_MS + CH.EXPIRE_MS);
  const best1 = CH.validateChallenge(doc({ legs: [leg()], a: { code: A, s: { 0: 100 } }, b: { code: B, s: {}, started: { 0: { at: 1000, k: 'x' } } }, stage: 'b' }), 1000 + CH.START_GRACE_MS);
  check('timeout: the last game timing out decides the match', best1.over && best1.over.winner === 'a' && best1.stage === 'over');
  check('timeout: Firebase\'s array form of the markers reads too', CH.validateChallenge(doc({ legs: [leg()], a: { code: A, s: {}, started: [{ at: 1000, k: 'x' }] } }), 1000 + CH.START_GRACE_MS).a.s[0] === 0);
  // Her phone (the clock past the grace) answers: the derived 0 is stored with her score.
  const realNow = Date.now;
  Date.now = () => startedAt + CH.START_GRACE_MS + 60 * 1000;
  try {
    // validateChallenge's default clock is the server-time helper's best guess = the phone clock here.
    as(B, 'Anita');
    storage(HOMEAPP);
    const herClaim = await CH.claimLeg(id4, 'b', 1);
    check('timeout: her turn after his timed-out game; she can start game 2', herClaim.ok);
    const hers = await CH.postLeg(id4, 'b', 1, 150);
    check('timeout: her score lands and his 0 is stored beside it', hers.ok && getAt(`skeeChallenges/games/${id4}/a/s/1`) === 0 && getAt(`skeeChallenges/games/${id4}/b/s/1`) === 150);
    as(A, 'Matt');
    const lateSend = await CH.postLeg(id4, 'a', 1, 400);
    check('timeout: his late score is refused for good (her 2 games took the match)', !lateSend.ok && ['already-played', 'already-over'].includes(lateSend.reason) && getAt(`skeeChallenges/games/${id4}/a/s/1`) === 0);
  } finally { Date.now = realNow; }
  const rules = JSON.parse(read('database.rules.json')).rules;
  const sr = rules.skeeChallenges && rules.skeeChallenges.games && rules.skeeChallenges.games.$id.$side.started.$leg['.validate'];
  check('rules: the start marker is write-once, server time, by that side\'s claimed code', !!sr && /!data\.exists\(\)/.test(sr) && /=== now/.test(sr) && /msgAuth/.test(sr) && /child\(\$side\)\.child\('code'\)/.test(sr));
  const cui = read('skeeball/js/challenge-ui.js');
  check('wiring: both Play paths claim the game on the server first', (cui.match(/CH\.claimLeg\(/g) || []).length >= 2);
  check('wiring: a game started elsewhere blocks the turn (no later game offered past it)', /firstOpen >= 0 && elsewhere\(firstOpen\)/.test(cui));
  CH.__setBootForTest(null);
}

// --- B3 (2026-10-29): a challenge rack never unlocks a machine ----------------------------------------
{
  const GS = await import('../js/game-stats.js');
  store['gamehub.profile'] = JSON.stringify({ name: 'test1', emoji: '🙂', playerId: 'DREG5' });
  const unlocked = () => { const sk = (GS.loadStats().games.skeeball || {}).sk || {}; return sk.unlocked || {}; };
  const before = GS.loadStats().games.skeeball.sk ? GS.loadStats().games.skeeball.sk.played | 0 : 0;
  GS.recordSkeeball('brickcity', { score: 310, balls: 9, at: Date.UTC(2026, 9, 29, 12), challenge: true });
  const after = GS.loadStats().games.skeeball.sk;
  check('B3: a challenge rack on a locked machine is recorded', after.played === before + 1 && after.boards && after.boards.brickcity);
  check('B3: ...and does NOT unlock that machine', !unlocked().brickcity);
  GS.recordSkeeball('runaway', { score: 200, balls: 9, at: Date.UTC(2026, 9, 29, 12, 5) });
  check('B3: an ordinary rack still unlocks what it was played on (as before)', !!unlocked().runaway);
  const ui = read('skeeball/js/ui.js');
  check('B3: both record sites pass the challenge flag', (ui.match(/challenge: !!this\.challenge \}\)/g) || []).length === 2);
  check('B3: a challenge rack earns no objective unlock', (ui.match(/if \(!this\.challenge\) for \(const id of this\._earnedUnlocks/g) || []).length === 2);
  check('B3: objectives open the next machine only from a machine the player owns', /if \(!this\._ownsMachine\(boardId\)\) continue;/.test(ui) && /if \(!this\._ownsMachine\(b\.unlock\.board, sk\)\) continue;/.test(ui));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
