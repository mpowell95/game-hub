// tools/read-play-log.mjs - READ ONLY: one player's play log (playLog/<CODE>, js/play-log.js), game by
// game (2026-10-30, Matt: "List each game, the day he played, the day the puzzle was for, and how many
// hints were used"). Needs the reader key (tools/reader-auth.mjs, env GAMEHUB_READER). Times are Eastern.
// Answer words are never printed (no spoilers); guesses print as counts and ranks.
//
//   NODE_USE_ENV_PROXY=1 node tools/read-play-log.mjs <CODE> [--game contexto] [--moves]
//
// Contexto: one line per puzzle: the puzzle, the day it was for, when it was played, result, typed guesses,
// hints (with each hint's rank), the closest rank before the answer. --moves adds every move with its time.
// Every other game: one line per finished game (the recorder and its arguments).
import { readPath } from '../backups/rtdb-backup.mjs';
import { firebaseConfig } from '../js/firebase-config.js';
import { signInForReading } from './reader-auth.mjs';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : null; };
const MOVES = flag('--moves');
const GAME = opt('--game');
const code = (args[0] || '').toUpperCase();
if (!/^[A-Z0-9]{5}$/.test(code)) { console.error('usage: node tools/read-play-log.mjs <CODE> [--game contexto] [--moves]'); process.exit(2); }

const ET = (ms) => new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const CT_EPOCH = Date.UTC(2026, 8, 28);   // contexto/js/engine.js EPOCH: puzzle 1 = Sep 28 2026
const ctDay = (n) => new Date(CT_EPOCH + (n - 1) * 86400000).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const etDate = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

const { idToken, reader } = await signInForReading();
let log;
try { log = await readPath(firebaseConfig.databaseURL, `playLog/${code}`, idToken); }
catch (err) { console.error(reader ? err.message : 'No reader key (GAMEHUB_READER): the play log is admin-only.'); process.exit(1); }
const ev = Object.values(log || {}).filter((x) => x && Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
console.log(`playLog/${code}: ${ev.length} entries${ev.length ? `, ${ET(ev[0].t)} to ${ET(ev[ev.length - 1].t)} ET` : ''}`);

if (!GAME || GAME === 'contexto') {
  const by = new Map();
  for (const x of ev) if (x.g === 'contexto' && x.k) { if (!by.has(x.k)) by.set(x.k, []); by.get(x.k).push(x); }
  if (by.size) console.log('\nCONTEXTO (one line per puzzle, Eastern time)');
  for (const [k, list] of [...by].sort((a, b) => a[1][0].t - b[1][0].t)) {
    const n = Number(k.split('-')[1]);
    const end = list.find((x) => x.e === 'win' || x.e === 'giveup');
    const guesses = list.filter((x) => x.e === 'guess');
    const hints = list.filter((x) => x.e === 'hint');
    const ranks = [...guesses, ...hints].filter((x) => end ? x.t <= end.t : true).map((x) => Number(x.r)).filter((r) => Number.isFinite(r) && r > 1);
    const first = list.find((x) => x.e === 'guess' || x.e === 'hint');
    const playedDay = first ? etDate(first.t) : null;
    const forDay = new Date(CT_EPOCH + (n - 1) * 86400000).toISOString().slice(0, 10);
    console.log(`  ${k}  for ${ctDay(n)}${playedDay && playedDay !== forDay ? ' (a PAST puzzle)' : ''}  played ${first ? ET(first.t) : '-'}`
      + `${end ? ` to ${ET(end.t)}` : ''}  ${end ? (end.e === 'win' ? 'WON' : 'GAVE UP') : 'unfinished'}`
      + `  typed ${guesses.length}  hints ${hints.length}${hints.length ? ` (ranks ${hints.map((h) => h.r).join(', ')})` : ''}`
      + `  closest before the end ${ranks.length ? Math.min(...ranks) : '-'}`);
    if (MOVES) for (const x of list) console.log(`      ${ET(x.t)}  ${x.e}${x.r != null ? ` rank ${x.r}` : ''}`);
  }
}
if (GAME !== 'contexto') {
  const done = ev.filter((x) => x.f && (!GAME || x.g === GAME));
  if (done.length) console.log('\nFINISHED GAMES (the recorder and its arguments)');
  for (const x of done) console.log(`  ${ET(x.t)}  ${x.g}  ${x.f}(${x.a || ''})`);
}
