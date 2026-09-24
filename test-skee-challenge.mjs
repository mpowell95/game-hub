// test-skee-challenge.mjs - SKEEBALL CHALLENGES (2026-09-24). `node test-skee-challenge.mjs`
//
// The pure rules behind "beat my score" (skeeball/js/challenge.js), the launcher bubble
// (skeeball/js/alert.js), which machines two players can both play (challenge-ui.js), the push
// decision (functions/decide.js decideSkee), and the wiring no single file can see.
import { readFileSync } from 'node:fs';

const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

const CH = await import('./skeeball/js/challenge.js');
const { decideAlert } = await import('./skeeball/js/alert.js');
const { sharedBoards, unlockedFrom } = await import('./skeeball/js/challenge-ui.js');
const { decideSkee } = await import('./functions/decide.js');

let pass = 0; let fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name); } };
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// --- the match document ------------------------------------------------------------------------
const doc = (extra = {}) => ({
  v: 1, id: 'mabc12345xyz', by: 'MATTT', created: 1000, updated: 1000, expires: 1000 + CH.EXPIRE_MS,
  board: 'classic', boardName: 'THE CLASSIC', caption: 'beat that',
  a: { code: 'MATTT', name: 'Matt', emoji: '😎', score: 320, at: 1000 },
  b: { code: 'ANNAA', name: 'Anita', emoji: '🌸' },
  over: null, ...extra,
});
let g = CH.validateChallenge(doc());
check('a sent challenge validates, unanswered', g && g.a.score === 320 && g.b.score === null && !g.over);
check('...with nobody\'s turn but the challenged player\'s', CH.sideOf(g, 'ANNAA') === 'b' && CH.sideOf(g, 'MATTT') === 'a' && CH.sideOf(g, 'ZZZZZ') === null);
check('a challenge with no challenger score is refused', CH.validateChallenge(doc({ a: { code: 'MATTT', name: 'M' } })) === null);
check('a challenge to yourself is refused', CH.validateChallenge(doc({ b: { code: 'MATTT' } })) === null);
check('a garbage score is refused, not half-shown', CH.validateChallenge(doc({ b: { code: 'ANNAA', score: 'lots' } })) === null);
check('a missing `expires` defaults to created + 3 days (older documents stay readable)',
  CH.validateChallenge(doc({ expires: undefined })).expires === 1000 + CH.EXPIRE_MS);

// --- winning -----------------------------------------------------------------------------------
check('higher score wins, either side', CH.winnerOf(320, 280) === 'a' && CH.winnerOf(320, 340) === 'b');
check('an equal score is a tie', CH.winnerOf(300, 300) === null);
const done = CH.validateChallenge(doc({ b: { code: 'ANNAA', name: 'Anita', score: 340, at: 2000 }, over: { winner: 'b', at: 2000 }, updated: 2000 }));
check('results read from each side', CH.resultFor(done, 'b') === 'won' && CH.resultFor(done, 'a') === 'lost');
check('a tie reads as a draw from both sides',
  CH.resultFor({ over: { winner: null } }, 'a') === 'draw' && CH.resultFor({ over: { winner: null } }, 'b') === 'draw');

// --- index rows ----------------------------------------------------------------------------------
const ra = CH.rowFor(g, 'a'); const rb = CH.rowFor(g, 'b');
check('the challenger\'s row: sent, not their turn, their own score', ra.sent && !ra.yourTurn && ra.mine === 320 && ra.theirs === null && ra.with === 'ANNAA');
check('the challenged row: their turn, the score to beat as `theirs`', !rb.sent && rb.yourTurn && rb.theirs === 320 && rb.mine === null && rb.with === 'MATTT');
check('rows carry the machine name, so neither a list nor a push has to read the match', ra.boardName === 'THE CLASSIC' && rb.boardName === 'THE CLASSIC');
const da = CH.rowFor(done, 'a');
check('a finished row carries its result from that side', da.over && da.result === 'lost' && da.mine === 320 && da.theirs === 340);

const rows = CH.rowsFromIndex({
  aaaaaa11: { ...rb, updated: 5, expires: Date.now() + 1e6 }, bbbbbb22: { ...ra, updated: 9, expires: Date.now() + 1e6 }, cccccc33: { ...da, updated: 7 },
  BAD: { with: 'ANNAA' }, dddddd44: { with: 'nope' },
});
check('an index lists valid rows only', rows.length === 3);
check('waiting on you sorts first', rows[0].id === 'aaaaaa11');
const now = 1000 + CH.EXPIRE_MS + 1;
const grp = CH.groupRows(CH.rowsFromIndex({ aaaaaa11: rb, bbbbbb22: ra }), now);
check('past its 3 days an unanswered challenge is EXPIRED, for both people', grp.toPlay.length === 0 && grp.sent.length === 0 && grp.done.length === 2);
check('a finished challenge never expires', !CH.isExpired({ over: true, expires: 1 }, now));

// --- the launcher bubble -------------------------------------------------------------------------
const live = CH.rowsFromIndex({ aaaaaa11: { ...rb, updated: 5, expires: Date.now() + 100000 } });
let al = decideAlert(live, {});
check('an unseen challenge to you raises "challenged you"', al && al.kind === 'challenge' && al.name === 'Matt');
check('...and not once it has been seen', decideAlert(live, { aaaaaa11: 5 }) === null);
const sentDone = CH.rowsFromIndex({ cccccc33: { ...da, updated: 7 } });
al = decideAlert(sentDone, {});
check('an answered challenge you SENT raises a result bubble', al && al.kind === 'over' && al.result === 'lost');
const answeredByMe = CH.rowsFromIndex({ cccccc33: { ...CH.rowFor(done, 'b'), updated: 7 } });
check('one YOU answered raises nothing (you watched it end)', decideAlert(answeredByMe, {}) === null);
check('an expired challenge raises nothing', decideAlert(CH.rowsFromIndex({ aaaaaa11: { ...rb, updated: 5, expires: 10 } }), {}) === null);

// --- the outbox ----------------------------------------------------------------------------------
check('an answer queues', CH.queueAnswer('mabc12345xyz', 275) && CH.isQueued('mabc12345xyz'));
check('one rack, one answer: a second score for the same challenge is not queued',
  !CH.queueAnswer('mabc12345xyz', 999) && CH.readOutbox().find((x) => x.id === 'mabc12345xyz').score === 275);
check('the outbox refuses a bad id or score', !CH.queueAnswer('BAD', 5) && !CH.queueAnswer('okokok12', -3));

// --- which machines two players share ------------------------------------------------------------
const B = [{ id: 'classic' }, { id: 'basketball' }, { id: 'brickcity' }, { id: 'runaway' }, { id: 'popongo', adminOnly: true }];
const opts = (released = [], testing = ['popongo']) => ({ boards: B, released: (b) => released.includes(b.id), testing: (b) => testing.includes(b.id) });
const ids = (l) => l.map((b) => b.id).join(',');
check('THE CLASSIC is always shared', ids(sharedBoards(new Set(), new Set(), opts())) === 'classic');
check('a machine only ONE of them has earned is not offered',
  ids(sharedBoards(new Set(['basketball']), new Set(), opts())) === 'classic');
check('a machine BOTH earned is offered', ids(sharedBoards(new Set(['basketball']), new Set(['basketball']), opts())) === 'classic,basketball');
check('a machine opened to everyone is offered to both', ids(sharedBoards(new Set(), new Set(), opts(['runaway']))) === 'classic,runaway');
check('a machine in TESTING is never offered, even if both hold it (practice counts for nothing)',
  !sharedBoards(new Set(['popongo']), new Set(['popongo']), opts()).some((b) => b.id === 'popongo'));
const all = {
  d1: { profile: { playerId: 'ANNAA' }, stats: { games: { skeeball: { sk: { unlocked: { basketball: true } } } } } },
  d2: { profile: { playerId: 'ANNAA' }, stats: { games: { skeeball: { sk: { unlocked: { brickcity: true } } } } } },
  d3: { profile: { playerId: 'MATTT' }, stats: { games: { skeeball: { sk: { unlocked: { runaway: true } } } } } },
};
check('a player\'s unlocks are the UNION of every device they play on', ids([...unlockedFrom(all, 'ANNAA')].map((id) => ({ id }))) === 'basketball,brickcity');

// --- the notification ----------------------------------------------------------------------------
const body = (n) => n && n.text('en').body;
let n = decideSkee({ code: 'ANNAA', id: 'x', before: null, after: rb });
check('a new challenge row notifies the challenged player', n && n.kind === 'challenge' && body(n) === 'Matt challenged you on THE CLASSIC. Beat 320!');
check('...in Spanish when their phone is', /te ha retado en THE CLASSIC/.test(n.text('es').body));
check('the challenger\'s own new row never notifies them', decideSkee({ code: 'MATTT', id: 'x', before: null, after: ra }) === null);
n = decideSkee({ code: 'MATTT', id: 'x', before: ra, after: da });
check('the answer notifies the challenger with the result', n && n.kind === 'over' && body(n) === 'Anita scored 340 on THE CLASSIC and beat you.');
check('the challenged player\'s own answer never notifies them',
  decideSkee({ code: 'ANNAA', id: 'x', before: rb, after: CH.rowFor(done, 'b') }) === null);
check('a rewrite of an already-finished row notifies nobody', decideSkee({ code: 'MATTT', id: 'x', before: da, after: da }) === null);

// --- wiring ------------------------------------------------------------------------------------
const rules = JSON.parse(read('./database.rules.json')).rules;
check('`skeeChallenges` is enumerated in database.rules.json (the root is deny-by-default)', !!rules.skeeChallenges);
check('...and in the backup\'s branch list', /'skeeChallenges'/.test(read('./backups/rtdb-backup.mjs')));
const fn = read('./functions/index.js');
check('the Cloud Function watches the per-player index', /ref: '\/skeeChallenges\/index\/\{code\}\/\{id\}'/.test(fn) && /decideSkee/.test(fn));
check('a tap opens Skeeball', /\{ game: 'skeeball' \}/.test(fn));
check('the hub registers Skeeball\'s alerts module', /alerts: \(\) => import\('\.\.\/skeeball\/js\/alert\.js'\)/.test(read('./js/hub.js')));
const sw = read('./sw.js');
check('the three new files are in sw.js ASSETS', ['challenge.js', 'challenge-ui.js', 'alert.js'].every((f) => sw.includes(`'./skeeball/js/${f}',`)));
const ui = read('./skeeball/js/ui.js');
check('an answer is queued BEFORE the network, on a finished rack AND a walked-out one',
  (ui.match(/this\._queueChallengeAnswer\(/g) || []).length >= 2 && /CH\.queueAnswer\(ch\.id/.test(ui));
check('the ordinary Play button drops any challenge', /data-role="play"\]'\)\.addEventListener\('click', \(\) => \{\s*this\.challenge = null;/.test(ui));
check('a challenge rack is recorded like any other (the recorder call is untouched)',
  (ui.match(/recordSkeeball\(board\.id, \{ \.\.\./g) || []).length === 2);

check('the rack start token is still initialised (an edit here once dropped it and no rack could start)',
  /this\._startToken = 0;/.test(ui));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
