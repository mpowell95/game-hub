// tools/test-boards.mjs - the server-built leaderboard (functions/boards.js) must hand every phone
// EXACTLY the groups it used to compute itself (2026-10-22). Runs the real grouping both ways and
// deep-compares: aggregatePlayers(visible devices, corrections) on the phone vs buildBoard on the
// server -> JSON -> stats-net.js fillBoardGroup.
//
//   node tools/test-boards.mjs                    synthetic players
//   node tools/test-boards.mjs <rtdb-backup.json> also every real player in a backups/ snapshot
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { execFileSync } from 'node:child_process';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
execFileSync(process.execPath, [new URL('./sync-functions-shared.mjs', import.meta.url).pathname], { stdio: 'ignore' });
const { buildBoardParts, packBoard, encKey } = await import('../functions/boards.js');
const { aggregatePlayers } = await import('../js/players-agg.js');
const { resolveCorrections } = await import('../js/admin-config.js');
const { isHiddenDeviceId } = await import('../js/hidden-players.js');
const { fillBoardGroup, unpackBoard, boardList } = await import('../js/stats-net.js');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name); } };

async function compare(label, players, cfg) {
  const visible = Object.fromEntries(Object.entries(players).filter(([id]) => !isHiddenDeviceId(id)));
  const phone = aggregatePlayers(visible, resolveCorrections(cfg));
  const parts = buildBoardParts(players, cfg), board = parts.people;
  // Packed exactly as the server stores it, unpacked exactly as the phone does.
  const back = await unpackBoard(packBoard(parts));
  const { list, idsByKey } = boardList(back);
  const got = new Map(list.map((g) => [g.key, { group: g, ids: idsByKey.get(g.key) }]));
  let same = phone.length === got.size, bad = '';
  for (const g of phone) {
    const r = got.get(g.key);
    if (!r || !isDeepStrictEqual(r.group, g) || JSON.stringify(Object.keys(r.group.games)) !== JSON.stringify(Object.keys(g.games))) { same = false; bad = g.name || g.key; break; }
  }
  check(`${label}: every person identical to the phone's own grouping (${phone.length} people)${bad ? ' - first difference: ' + bad : ''}`, same);
  check(`${label}: people come in the same order (ties sort the same)`, JSON.stringify(list.map((g) => g.key)) === JSON.stringify(phone.map((g) => g.key)));
  const ids = [...got.values()].flatMap((r) => r.ids).sort();
  check(`${label}: every visible device belongs to exactly one person`, JSON.stringify(ids) === JSON.stringify(Object.keys(visible).sort()));
  check(`${label}: every key is a legal Firebase key`, Object.keys(board).every((k) => !/[.#$/[\]]/.test(k)));
  return { board, phone, parts };
}

console.log('Server-built leaderboard (2026-10-22)');
const T = 1_790_000_000_000;
const fake = {
  'dev-a': { profile: { name: 'Anita Bonita', emoji: '🌸', playerId: 'C5PXN' }, updatedAt: T, stats: { games: { connect4: { total: { played: 3, won: 2, lost: 1 }, byDiff: { easy: { played: 3, won: 2, lost: 1 } } } } } },
  'dev-b': { profile: { name: 'Anita Bonita', emoji: '🌼', playerId: 'C5PXN' }, updatedAt: T + 5, stats: { games: { snake: { total: { played: 1, won: 0, lost: 1 }, byDiff: {} } } } },
  'dev-c': { profile: { name: 'Matt.Jr / #1', emoji: '👑', playerId: '' }, updatedAt: T, stats: { games: {} } },
  '4392d978-hidden': { profile: { name: 'Hidden', emoji: '🙂', playerId: 'ZZZZ9' }, updatedAt: T, stats: { games: { snake: { total: { played: 9, won: 9, lost: 0 }, byDiff: {} } } } },
};
const { board } = await compare('synthetic', fake, null);
check('synthetic: a hidden test device is left out', !Object.values(board).some((s) => s.includes('ZZZZ9')));
check('a package that cannot be unpacked reads as no board (the phone falls back)', (await unpackBoard('not-gzip')) === null && (await unpackBoard('')) === null);
check('encKey keeps a name with dots and slashes legal and reversible', decodeURIComponent(encKey('name:matt.jr / #1')) === 'name:matt.jr / #1');

if (process.argv[2]) {
  let d = JSON.parse(readFileSync(process.argv[2], 'utf8')); d = d.data || d;
  const { board: real, parts } = await compare('real snapshot', d.players || {}, (d.adminConfig || {}).v1 || null);
  const kb = (x) => Math.round(JSON.stringify(x).length / 1024);
  console.log(`  size: players/ ${kb(d.players)} KB -> board package ${Math.round(packBoard(parts).length / 1024)} KB`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
