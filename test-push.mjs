// test-push.mjs - PUSH NOTIFICATIONS (2026-09-23). `node test-push.mjs`
//
// The decision the Cloud Function makes (functions/decide.js, pure) and the wiring that has to
// line up across four places no single file can see: the VAPID public key in the app and in the
// function, sw.js always showing what it receives, js/push.js staying network-first, and the
// database rule that lets a device store its own address.
import { readFileSync } from 'node:fs';
import { decide } from './functions/decide.js';

let pass = 0; let fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name); } };
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// --- the decision -----------------------------------------------------------------------------
const game = (extra = {}) => ({
  a: { code: 'KNGGG', name: 'King' }, b: { code: 'MTTTT', name: 'Matt' }, turn: 'b', by: 'KNGGG',
  moves: { '0000': { by: 'a', col: 3, shots: 1 } }, over: null, ...extra,
});
const row = (extra = {}) => ({ with: 'KNGGG', name: 'King', yourTurn: true, over: false, series: 1, seriesNo: 1, ...extra });
const body = (n) => n && n.text('en').body;

// Matt's row appearing, with the King's first shot already in it: that is the challenge arriving.
let n = decide({ code: 'MTTTT', gameId: 'g1', before: null, after: row(), game: game() });
check('a new row with a shot in it tells the other person they were challenged', n && n.kind === 'challenge' && /King challenged you/.test(body(n)));
check('...in Spanish when their phone is', /te ha retado/.test(n.text('es').body));

// The King's OWN row appearing when he creates the match: never news to him.
n = decide({ code: 'KNGGG', gameId: 'g1', before: null,
  after: row({ with: 'MTTTT', name: 'Matt' }), game: game({ moves: null, turn: 'a' }) });
check('the creator is never notified about the match they just made', n === null);
// ...nor on a match made before `by` existed (side a, no shot yet).
n = decide({ code: 'KNGGG', gameId: 'g1', before: null,
  after: row({ with: 'MTTTT', name: 'Matt' }), game: game({ moves: null, turn: 'a', by: undefined }) });
check('...including one made before the `by` field existed', n === null);

// The turn coming back.
n = decide({ code: 'KNGGG', gameId: 'g1', before: row({ yourTurn: false, with: 'MTTTT', name: 'Matt' }),
  after: row({ with: 'MTTTT', name: 'Matt' }), game: game({ turn: 'a' }) });
check('the turn flipping to you says "Your turn vs <them>"', n && n.kind === 'turn' && body(n) === 'Your turn vs Matt');

// Your own move flips your row AWAY from you: silent.
n = decide({ code: 'KNGGG', gameId: 'g1', before: row(), after: row({ yourTurn: false }), game: game() });
check('your own move never notifies you', n === null);
// A rewrite of a row that was already your turn (an index update with nothing new): silent.
n = decide({ code: 'KNGGG', gameId: 'g1', before: row(), after: row(), game: game() });
check('a row that was already your turn does not notify again', n === null);

// A series game the OTHER person started, where you shoot first.
n = decide({ code: 'MTTTT', gameId: 'g2', before: null, after: row({ series: 3, seriesNo: 2 }),
  game: game({ moves: null, turn: 'b', by: 'KNGGG', a: { code: 'MTTTT' }, b: { code: 'KNGGG' } }) });
check('a series game they started, with you first, says so', n && n.kind === 'series' && /game 2 of 3/.test(body(n)));

// Finishing.
const done = (over, lastBy) => game({ over, moves: { '0000': { by: lastBy, col: 1, shots: 1 } } });
n = decide({ code: 'MTTTT', gameId: 'g1', before: row({ yourTurn: false }), after: row({ yourTurn: false, over: true }),
  game: done({ winner: 'a', why: 'four' }, 'a') });
check('they win with their move: you are told', n && /King won/.test(body(n)));
n = decide({ code: 'KNGGG', gameId: 'g1', before: row({ yourTurn: true }), after: row({ yourTurn: false, over: true }),
  game: done({ winner: 'a', why: 'four' }, 'a') });
check('you win with your own move: silent', n === null);
n = decide({ code: 'MTTTT', gameId: 'g1', before: row(), after: row({ yourTurn: false, over: true }),
  game: game({ over: { winner: 'b', why: 'resign' } }) });
check('they resign: you are told you won', n && /resigned/.test(body(n)));
n = decide({ code: 'KNGGG', gameId: 'g1', before: row(), after: row({ yourTurn: false, over: true }),
  game: game({ over: { winner: 'b', why: 'resign' } }) });
check('you resign: silent', n === null);
n = decide({ code: 'KNGGG', gameId: 'g1', before: row(), after: null, game: game() });
check('a deleted row says nothing', n === null);

// --- the wiring -------------------------------------------------------------------------------
const keyOf = (src) => (src.match(/VAPID_PUBLIC_KEY = '([A-Za-z0-9_-]+)'/) || [])[1];
const appKey = keyOf(read('./js/push.js'));
const fnKey = keyOf(read('./functions/index.js'));
check('the app and the function carry the SAME VAPID public key', !!appKey && appKey === fnKey);
check('no private key is in the repo', !/VAPID_PRIVATE_KEY\s*=\s*['"]/.test(read('./functions/index.js')));

const sw = read('./sw.js');
const pushHandler = sw.slice(sw.indexOf("addEventListener('push'"), sw.indexOf("addEventListener('notificationclick'"));
check('sw.js shows a notification for every push (iOS revokes a silent one)',
  /event\.waitUntil\(self\.registration\.showNotification\(/.test(pushHandler) && !/return;/.test(pushHandler));
check('sw.js opens or focuses the hub on a tap', /addEventListener\('notificationclick'/.test(sw) && /openWindow\(url\)/.test(sw) && /type: 'OPEN_GAME'/.test(sw));
const nf = sw.slice(sw.indexOf('const NETWORK_FIRST = ['), sw.indexOf('const SHELL_CACHE_FIRST'));
check('js/push.js is network-first (it writes a gamehub.* key)', nf.includes("'./js/push.js'"));

const hub = read('./js/hub.js');
check('the hub takes a tapped notification to its game, and never from inside another game',
  /_openPushedGame\(id\)/.test(hub) && /if \(!g \|\| this\.current\) return;/.test(hub) && /searchParams\.get\('open'\)/.test(hub));
check('the hub refreshes this device\'s address on load', /import\('\.\/push\.js'\)\.then\(\(m\) => m\.refreshPush\(\)\)/.test(hub));

const rules = JSON.parse(read('./database.rules.json'));
const ps = rules.rules.pushSubs && rules.rules.pushSubs.$code;
check('pushSubs/<code> is writable only by the device that claimed that code',
  !!ps && /\$code === root\.child\('msgAuth'\)\.child\(auth\.uid\)\.val\(\)/.test(ps['.write']));
check('pushSubs is in the backup list', /'pushSubs'/.test(read('./backups/rtdb-backup.mjs')));
const push = read('./js/push.js');
check('enablePush asks permission before anything else can await (iOS needs the tap)',
  push.indexOf('Notification.requestPermission()') < push.indexOf('await registration()', push.indexOf('export async function enablePush')));
check('createGame stamps who made the match (`by`), so the function never notifies its maker',
  /by: me,/.test(read('./hoops4/js/mp.js')));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
