// test-skee-challenge.mjs - SKEEBALL CHALLENGES (2026-09-24). `node test-skee-challenge.mjs`
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

const CH = await import('./skeeball/js/challenge.js');
const { decideAlert } = await import('./skeeball/js/alert.js');
const { challengeBoards, unlockedFrom } = await import('./skeeball/js/challenge-ui.js');
const { decideSkee } = await import('./functions/decide.js');

let pass = 0; let fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name); } };
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
