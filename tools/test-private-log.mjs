// tools/test-private-log.mjs - the PRIVATE play data (2026-11-16, Matt: "ALL data from ALL games played should
// be recorded ... somewhere that only I can see and that is never pushed to the player's phone via download").
// withMode's `log` and logPlayData() reach ONLY the play log's `x` (playLog/<CODE>, admin-read); never the
// stats store (so never players/ or the board). The rules let a phone read back only an entry's `t`.
//   node tools/test-private-log.mjs
import { readFileSync } from 'node:fs';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};
localStorage.setItem('gamehub.profile', JSON.stringify({ version: 1, name: 'test1', playerId: 'DREG5' }));
const GS = await import('../js/game-stats.js');
const Q = await import('../js/play-log-queue.js');

let pass = 0, fail = 0;
const ok = (name, c, extra = '') => { if (c) { pass++; console.log('ok   ', name); } else { fail++; console.log('FAIL ', name, extra); } };
const lastOf = (g) => Q.readQueue().filter((x) => x.g === g).slice(-1)[0];

// 1. withMode's `log`: in the play log's x, with hi; never in the stats store.
const shots = Array.from({ length: 30 }, (_, i) => ({ i, x: i * 1.5, made: i % 3 === 0 }));
GS.withMode({ ai: 1 }, 'hard', () => GS.recordSnake(42, 'hard'), () => ({ hi: 42, log: () => ({ qqshots: shots, board: [[1, 0], [0, 1]], end: 'qqendqq' }) }));
const e1 = lastOf('snake');
const x1 = e1 && e1.x ? JSON.parse(e1.x) : null;
ok('withMode log -> the play log x (lists kept, hi in front)', x1 && x1.hi === 42 && x1.qqshots.length === 30 && x1.end === 'qqendqq' && Array.isArray(x1.board));
const stored = localStorage.getItem('gamehub.stats') || '';
ok('withMode log is NOT in the stats store', !stored.includes('qqshots') && !stored.includes('qqendqq'));
ok('the result itself still counts', JSON.parse(stored).games.snake.total.played === 1);

// 2. A log that throws: the result still counts, no x.
GS.withMode({ ai: 1 }, 'hard', () => GS.recordSnake(5, 'hard'), () => ({ hi: 5, log: () => { throw new Error('boom'); } }));
ok('a throwing log never blocks the result', JSON.parse(localStorage.getItem('gamehub.stats')).games.snake.total.played === 2);

// 3. logPlayData: a play that counts for nothing (pass and play).
const before = localStorage.getItem('gamehub.stats');
const id = GS.logPlayData('darts', 'pnp', { players: ['A', 'B'], darts: [[20, 3], [19, 1]], winner: 'A' }, { mode: { game: '301' }, diff: 'pnp', key: 'r1' });
const e3 = Q.readQueue().find((x) => x.id === id);
ok('logPlayData -> one play log entry with e, m, k, x', e3 && e3.g === 'darts' && e3.e === 'pnp' && e3.k === 'r1' && /game=301@pnp/.test(e3.m) && JSON.parse(e3.x).winner === 'A');
ok('logPlayData never touches the stats store', localStorage.getItem('gamehub.stats') === before);

// 4. Too long: cut and says so, never refused.
const big = GS.privateLog({ blob: 'z'.repeat(30000) }, null);
ok('a log over 20,000 chars is cut and marked', big.length <= GS.X_MAX && JSON.parse(big)._cut > 30000);

// 5. modeTag carries the log for a deferred result.
const tag = GS.modeTag({ ai: 1 }, 'easy', () => ({ hi: 1, log: () => ({ moves: [1, 2, 3] }) }));
ok('modeTag carries the log', tag && tag.s && tag.s.log && tag.s.log.moves.length === 3);

// 6. The rules: only admins and the reader read the play log; a phone reads back only `t`.
const R = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules;
ok('rules: playLog read = admins + reader only', /admins/.test(R.playLog['.read']) && /readers/.test(R.playLog['.read']) && !R.playLog.$code['.read']);
ok('rules: a phone reads back only `t` of an entry', /msgAuth/.test(R.playLog.$code.$k.t['.read']) && !R.playLog.$code.$k['.read']);
ok('rules: x allowed, up to 20,000 chars', /20000/.test(R.playLog.$code.$k.x['.validate']));
ok('rules: beeLog no longer readable by every signed-in player', !R.beeLog.$puzzle['.read'] && /msgAuth/.test(R.beeLog.$puzzle.$code['.read']));
ok('the sender copies x', readFileSync(new URL('../js/play-log.js', import.meta.url), 'utf8').includes("'d', 'x']"));

// 7. The server's Contexto copy keeps no word or rank.
const src = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
ok('ctSyncCopy copies only t, s, k, e of hint/giveup/win', /ctSyncRow\(v\)/.test(src) && /return \{ t: Number\(v\.t\) \|\| 0, s: Number\(v\.s\) \|\| 0, k: v\.k, e: v\.e \}/.test(src) && /'hint', 'giveup', 'win'/.test(src));

console.log(`\nPrivate log tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
