// test-push.mjs - PUSH NOTIFICATIONS (2026-09-23). `node test-push.mjs`
//
// The decision the Cloud Function makes (functions/decide.js, pure) and the wiring that has to
// line up across four places no single file can see: the VAPID public key in the app and in the
// function, sw.js always showing what it receives, js/push.js staying network-first, and the
// database rule that lets a device store its own address.
import { readFileSync } from 'node:fs';
import { decide, decideMessage, decideBugReport, isActive, ACTIVE_WINDOW_MS } from './functions/decide.js';

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

// --- messages (2026-09-24) -----------------------------------------------------------------------
// The recipient's row messages/index/<me>/<them> carries {at, from, preview, name, emoji}, with
// name/emoji = THEM (js/messages.js indexPatch). Only a newer `at` FROM them is news.
{
  const row = (extra = {}) => ({ at: 200, from: 'KNGGG', preview: 'your move!', name: 'King', emoji: 'k', ...extra });
  let n = decideMessage({ code: 'MTTTT', other: 'KNGGG', before: row({ at: 100 }), after: row() });
  check('a new message from them notifies, titled with their name and showing the text',
    n && n.text('en').title === 'Message from King' && n.text('en').body === 'your move!' && /Mensaje de King/.test(n.text('es').title));
  check('the first message of a conversation (no row before) notifies', !!decideMessage({ code: 'MTTTT', other: 'KNGGG', before: null, after: row() }));
  check('my own send (my row, from me) is silent',
    decideMessage({ code: 'MTTTT', other: 'KNGGG', before: row({ at: 100, from: 'MTTTT' }), after: row({ from: 'MTTTT' }) }) === null);
  check('reading it (seenAt only) is silent', decideMessage({ code: 'MTTTT', other: 'KNGGG', before: row(), after: row({ seenAt: 300 }) }) === null);
  check('hiding it (hiddenAt only) is silent', decideMessage({ code: 'MTTTT', other: 'KNGGG', before: row(), after: row({ hiddenAt: 300 }) }) === null);
  check('a deleted row is silent', decideMessage({ code: 'MTTTT', other: 'KNGGG', before: row(), after: null }) === null);
}

// --- bug reports, to admins (2026-09-24) ------------------------------------------------------------
{
  const n = decideBugReport({ description: 'the  ball\nfell through', gameTitle: 'Golf', reporter: { name: 'Ana' }, environment: { big: 'x'.repeat(5000) } });
  check('a bug report says who, which game, and the start of what they wrote',
    n && n.text().title === 'Bug report: Golf' && n.text().body === 'Ana: the ball fell through');
  check('...and never the environment dump', n.text().body.length < 200);
  check('a report with no text still says who sent it', decideBugReport({ reporter: { name: 'Bo' } }).text().body === 'Bo sent a report');
}

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
  /async _openPushedGame\(id, extra = \{\}\) \{\n    if \(this\.current\) return;/.test(hub) && /searchParams\.get\('open'\)/.test(hub));
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

const fnSrc = read('./functions/index.js');
check('three triggers: hoops turns, messages, bug reports',
  /export const hoopsTurnPush/.test(fnSrc) && /ref: '\/messages\/index\/\{code\}\/\{other\}'/.test(fnSrc) && /onValueCreated\(\{ ref: '\/bugReports\/\{id\}'/.test(fnSrc));
check('bug reports go to every ADMIN, found through admins/<uid> and msgAuth/<uid> (no code hardcoded)',
  /db\.ref\('admins'\)/.test(fnSrc) && /msgAuth\/\$\{uid\}/.test(fnSrc) && !/QZCC4/.test(fnSrc));
check('a tapped message opens that conversation; a tapped report opens the bug inbox',
  /id === 'messages'/.test(hub) && /openMessages\(to \?/.test(hub) && /id === 'bugs'/.test(hub));
check('sw.js carries who the message is from through to the hub', /with: data\.with/.test(sw));
const hui = read('./hoops4/js/ui.js');
check('Hoops asks "notify me when <them> plays back?" after a SENT move, once per match, only while off',
  /this\._askPush\(mp\)/.test(hui) && /gamehub\.hoops4\.pushAsk\.v1/.test(hui) && /if \(st !== 'off'/.test(hui));
check('Messages offers "Notify me of new messages" while off', /addPushRow\(card, gen\)/.test(read('./js/messages-ui.js')));

check('opening the hub, or coming back to it, clears the notifications already showing',
  /export async function clearShownNotifications/.test(read('./js/push.js'))
  && /this\._afterPaint\(this\._clearPushes\)/.test(hub) && /addEventListener\('visibilitychange', this\._clearPushes\)/.test(hub));

// --- the app is open on that device (2026-09-24) ---------------------------------------------------
{
  const now = 1_000_000_000;
  check('a device that checked in 10 s ago is skipped (the app is open there)', isActive({ activeAt: now - 10000 }, now));
  check('...one that checked in over 75 s ago is notified (closed, or killed without a goodbye)', !isActive({ activeAt: now - ACTIVE_WINDOW_MS - 1 }, now));
  check('...one that said goodbye (0) or never checked in is notified', !isActive({ activeAt: 0 }, now) && !isActive({}, now));
  check('the function skips an active device before sending', /if \(isActive\(s\)\)/.test(read('./functions/index.js')));
  check('the hub checks in while visible and says goodbye when hidden',
    /m\.markActive\(on\)/.test(hub) && /setInterval\(\(\) => m\.markActive/.test(hub));
  check('the check-in uses the SERVER clock', /activeAt: on \? api\.serverTimestamp\(\) : 0/.test(read('./js/push.js')));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
