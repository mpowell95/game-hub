// tools/test-restored-records.mjs - Matt's two deleted records, restored at READ TIME (js/stats-corrections.js
// RESTORED_RECORDS, 2026-11-03, Matt: "Restore mine yes. Admin only still").
//
// Pins, with no network and no browser:
//   1. withRestoredRecords adds a restored record only when its id is missing, and never replaces a live one
//      (a device that comes back and syncs must not be counted twice).
//   2. The server-board path (withRestoredBoard) gives Matt's row EXACTLY what aggregating players/ plus the
//      restored records gives - every game, comp, totalPlays, devices - and leaves every other row alone.
//   3. A restored id already on the board adds nothing; an owner with no row gets no invented row.
//   4. Structural: both leaderboards apply it only behind isAdminDevice(), and functions/boards.js (the board
//      everyone else reads) does not use it - "admin only still".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregatePlayers, buildIdentity } from '../js/players-agg.js';
import { RESTORED_RECORDS, withRestoredRecords, withRestoredBoard } from '../js/stats-corrections.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); if (!cond) fail++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const game = (played, won, diff) => ({ total: { played, won, lost: played - won }, byDiff: { [diff]: { played, won, lost: played - won } } });
const live = {
  'dc1745bc-f183-481d-8c63-d79b4727ad2d': { profile: { name: 'MattyIce', playerId: 'QZCC4' }, updatedAt: 1793000000000,
    stats: { games: { boggle: { ...game(5, 2, 'beginner'), bg: { bestScore: 41, longestWord: { len: 6, word: 'PLANET' }, played: 5, won: 2, lost: 3, tied: 0, words: 90 } },
      mancala: game(19, 10, 'intermediate'), ballrun: { ...game(81, 81, 'medium'), br: { bestObstacles: 40, bestObstaclesByDiff: { easy: 0, hard: 0, medium: 40 }, runs: 81 } } } } },
  'aaaa0000-0000-0000-0000-000000000001': { profile: { name: 'Lili', playerId: 'S2BEP' }, updatedAt: 1793000000000,
    stats: { games: { mancala: game(4, 1, 'intermediate') } } },
};
const boardOf = (all) => {
  const ident = buildIdentity(all), idsByKey = new Map();
  for (const id of Object.keys(all)) { const k = ident.keyFor(all[id].profile || {}, id); idsByKey.set(k, [...(idsByKey.get(k) || []), id]); }
  return { list: aggregatePlayers(all), idsByKey };
};
const strip = (r) => ({ games: r.games, comp: r.comp, solo: r.solo, totalPlays: r.totalPlays, devices: r.devices });

// 1
const withR = withRestoredRecords(live);
ok('both restored records are added when missing', Object.keys(RESTORED_RECORDS).every((id) => withR[id] === RESTORED_RECORDS[id]));
ok('live records are untouched', withR['dc1745bc-f183-481d-8c63-d79b4727ad2d'] === live['dc1745bc-f183-481d-8c63-d79b4727ad2d']);
const back = { ...live, '2b0d7c05-e4c2-4a2f-8317-dac42424338a': { profile: { name: 'MattyIce', playerId: 'QZCC4' }, stats: { games: {} } } };
ok('a live record with a restored id wins (never counted twice)', withRestoredRecords(back)['2b0d7c05-e4c2-4a2f-8317-dac42424338a'] === back['2b0d7c05-e4c2-4a2f-8317-dac42424338a']);
ok('the input object is not changed', !('2b0d7c05-e4c2-4a2f-8317-dac42424338a' in live));

// 2
const full = aggregatePlayers(withR);
const over = withRestoredBoard(boardOf(live), { aggregatePlayers, buildIdentity });
const fm = full.find((r) => r.playerId === 'QZCC4'), om = over.list.find((r) => r.playerId === 'QZCC4');
ok('one MattyIce row either way', full.filter((r) => r.playerId === 'QZCC4').length === 1 && over.list.filter((r) => r.playerId === 'QZCC4').length === 1);
ok('board path == players path for Matt (every game, comp, solo, totalPlays, devices)', same(strip(fm), strip(om)), JSON.stringify(strip(om)).slice(0, 300));
ok('restored plays counted: Boggle 5+3, Mancala 19+1, Ball Run 81+1',
  om.games.boggle.total.played === 8 && om.games.mancala.total.played === 20 && om.games.ballrun.total.played === 82);
ok('a best keeps the larger value (Boggle best 41, not 41+30)', om.games.boggle.bg.bestScore === 41);
ok('board ids now include both restored records', Object.keys(RESTORED_RECORDS).every((id) => over.idsByKey.get(om.key).includes(id)));
const lb = (b) => b.list.find((r) => r.playerId === 'S2BEP');
ok('every other row is unchanged', same(lb(over), lb(boardOf(live))));

// 3
const already = boardOf(withR);
ok('restored ids already on the board: nothing added again', withRestoredBoard(already, { aggregatePlayers, buildIdentity }) === already);
const noOwner = boardOf({ 'aaaa0000-0000-0000-0000-000000000001': live['aaaa0000-0000-0000-0000-000000000001'] });
const no = withRestoredBoard(noOwner, { aggregatePlayers, buildIdentity });
ok('no owner row: no row invented', no.list.length === noOwner.list.length && !no.list.some((r) => r.playerId === 'QZCC4'));

// 4
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
for (const f of ['js/leaderboard-ui.js', 'js/leaderboard2-ui.js']) {
  const lines = src(f).split(/\r?\n/).filter((l) => /withRestored(Records|Board)\(/.test(l));
  ok(`${f}: applied on the board AND the players path`, lines.some((l) => l.includes('withRestoredBoard(')) && lines.some((l) => l.includes('withRestoredRecords(')));
  ok(`${f}: every use is behind isAdminDevice()`, lines.length > 0 && lines.every((l) => /isAdminDevice\(\)\s*\?\s*withRestored/.test(l)), lines.join(' | '));
}
ok('functions/boards.js (everyone\'s board) does not use it', !/withRestored|RESTORED_RECORDS/.test(src('functions/boards.js')));

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
