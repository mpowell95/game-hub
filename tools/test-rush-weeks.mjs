// test-rush-weeks.mjs - Arrow Maze Rush weeks on each player's LOCAL calendar (2026-11-02, Matt's
// "option B"; they were UTC weeks, so "This week" emptied Sunday 7 PM in New York).
//
//   TZ=America/New_York node tools/test-rush-weeks.mjs
//   TZ=Europe/Madrid    node tools/test-rush-weeks.mjs
//   node tools/test-rush-weeks.mjs                      (any other zone: the zone-free checks only)
//
// THE LAW, rule 7: the OLD writer (js/ at OLD_REF, the last UTC-week build, extracted from git) records
// real runs; the CURRENT code then reads that store, records more, and must keep every old run, its
// UTC-Monday key and its best, untouched and counted. Nothing is ever re-keyed.
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const OLD_REF = '0abbb83';   // origin/main before the local-week change
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('ok    ' + name); } else { fail++; console.log('FAIL  ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); } };

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};
globalThis.document = globalThis.document || { documentElement: { lang: 'en' } };

const T = await import('../js/arrow-maze-time.js');
const L = (...a) => new Date(...a).getTime();   // a LOCAL wall-clock moment in this run's TZ

// --- zone-free: the local Monday, whatever the TZ ---------------------------------------------------
ok('local Sunday 21:00 belongs to the Monday six days before', T.woWeekKey(L(2026, 10, 1, 21)) === '2026-10-26');
ok('local Monday 00:30 starts the new week', T.woWeekKey(L(2026, 10, 2, 0, 30)) === '2026-11-02');
ok('local Sunday 23:59:59 is still the old week', T.woWeekKey(L(2026, 10, 1, 23, 59, 59)) === '2026-10-26');
ok('week end = next local Monday 00:00', T.woWeekEnd(L(2026, 10, 1, 21)) === L(2026, 10, 2) && T.woWeekEnd(L(2026, 10, 2, 0, 30)) === L(2026, 10, 9));
ok('week end across the US/EU fall-back weeks is local midnight', T.woWeekEnd(L(2026, 9, 26, 12)) === L(2026, 10, 2) && T.woWeekEnd(L(2026, 9, 19, 12)) === L(2026, 9, 26));
ok('the key keeps its format', /^\d{4}-\d{2}-\d{2}$/.test(T.woWeekKey(L(2026, 0, 1, 5))) && T.woWeekKey(L(2026, 0, 1, 5)) === '2025-12-29');

// --- the two zones that play ------------------------------------------------------------------------
if (TZ === 'America/New_York') {
  ok('NY: Sunday 2026-11-01 21:00 local = week 2026-10-26 (UTC said 2026-11-02)', T.woWeekKey(Date.UTC(2026, 10, 2, 2)) === '2026-10-26');
  ok('NY: the week ends Monday 00:00 EST = 05:00 UTC', T.woWeekEnd(Date.UTC(2026, 10, 2, 2)) === Date.UTC(2026, 10, 2, 5));
} else if (TZ === 'Europe/Madrid') {
  ok('Madrid: Monday 2026-11-02 00:30 local = week 2026-11-02 (UTC said 2026-10-26)', T.woWeekKey(Date.UTC(2026, 10, 1, 23, 30)) === '2026-11-02');
  ok('Madrid: the week ended Sunday 23:00 UTC', T.woWeekEnd(Date.UTC(2026, 10, 1, 22, 59)) === Date.UTC(2026, 10, 1, 23));
} else console.log(`note  TZ=${TZ}: run with TZ=America/New_York and TZ=Europe/Madrid for the zone checks`);

// --- rule 7: the OLD writer's real runs still read and count ----------------------------------------
let dir = null, oldG = null;
try {
  dir = mkdtempSync(join(tmpdir(), 'rush-old-'));
  execSync(`git archive ${OLD_REF} js | tar -x -C "${dir}"`, { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], shell: true });
  oldG = await import(pathToFileURL(join(dir, 'js', 'game-stats.js')).href);
} catch (err) { console.log('FAIL  could not load the old writer from git ' + OLD_REF + ': ' + err.message); fail++; }

if (oldG) {
  store.clear();
  // Real moments: a New-York Sunday evening (old: next UTC week), a Madrid Monday 00:30 (old: last UTC
  // week), a mid-week run, a left run (kept, never counted), Hard.
  const sunEve = Date.UTC(2026, 10, 2, 2), madMon = Date.UTC(2026, 10, 1, 23, 30), midWk = Date.UTC(2026, 9, 28, 15);
  oldG.recordWayOutRush('easy', { arrows: 40, boards: 3, ms: 60000, mistakes: 1, seed: 11, at: sunEve });
  oldG.recordWayOutRush('easy', { arrows: 22, boards: 2, ms: 40000, mistakes: 0, seed: 12, at: madMon });
  oldG.recordWayOutRush('easy', { arrows: 31, boards: 2, ms: 50000, mistakes: 2, seed: 13, at: midWk });
  oldG.recordWayOutRush('easy', { arrows: 90, boards: 5, ms: 90000, mistakes: 0, seed: 14, at: midWk + 1000, left: true });
  oldG.recordWayOutRush('hard', { arrows: 9, boards: 0, ms: 20000, mistakes: 0, seed: 15, at: sunEve + 1000 });
  const key = [...store.keys()].find((k) => k === 'gamehub.stats');
  const before = JSON.parse(store.get(key));
  const oldRush = before.games.wayout.wo.rush;
  ok('old writer: runs carry UTC Mondays', oldRush.runs.easy.map((r) => r.w).join() === '2026-11-02,2026-10-26,2026-10-26,2026-10-26', oldRush.runs.easy.map((r) => r.w));
  ok('old writer: bests per UTC week', JSON.stringify(oldRush.best.easy) === '{"2026-11-02":40,"2026-10-26":31}', oldRush.best.easy);

  // The current code reads the same store, then records one more run.
  const G = await import('../js/game-stats.js');
  const nowRun = L(2026, 10, 2, 12);   // local Monday noon
  G.recordWayOutRush('easy', { arrows: 35, boards: 3, ms: 55000, mistakes: 0, seed: 16, at: nowRun });
  const after = G.loadStats().games.wayout;
  const runs = T.woRushRuns(after.wo.rush.runs.easy);
  ok('every old run is still there, byte for byte in its fields', JSON.stringify(runs.slice(0, 4).map(({ s, d, w, left }) => ({ s, d, w, left })))
    === JSON.stringify(T.woRushRuns(oldRush.runs.easy).map(({ s, d, w, left }) => ({ s, d, w, left }))));
  ok('old runs keep their UTC keys (never re-keyed)', runs.slice(0, 4).map((r) => r.w).join() === '2026-11-02,2026-10-26,2026-10-26,2026-10-26');
  ok('the new run is keyed by the LOCAL Monday', runs[4].w === '2026-11-02');
  ok('old bests unchanged; the new run only raises (Math.max)', T.woRushBestMap(after.wo.rush.best.easy)['2026-10-26'] === 31
    && T.woRushBestMap(after.wo.rush.best.easy)['2026-11-02'] === 40);
  ok('the left run still never counts', !Object.values(T.woRushBestMap(after.wo.rush.best.easy)).includes(90));
  ok('hard keeps its old week', T.woRushBest(after, 'hard', '2026-11-02') === 9);
  ok('woRushWeeks lists both kinds of key', T.woRushWeeks(after).join() === '2026-11-02,2026-10-26');

  // The boards (the same functions the old board and v2 call): old keys count in "this week" and in
  // the finished weeks, on the viewer's own week.
  const LB = await import('../js/leaderboard-ui.js');
  const person = (name, wayout) => ({ key: 'n:' + name, name, emoji: '', games: { wayout } });
  const other = { wo: { rush: { best: { easy: { '2026-10-26': 50, '2026-10-19': 12 } } } } };
  const list = [person('Alpha', after), person('Bravo', other)];
  const realNow = Date.now;
  Date.now = () => nowRun;   // the viewer: local Monday 2026-11-02 noon
  try {
    const wk = LB.lb2Rush(list, 'easy', 'week');
    ok('This week = the viewer\'s local week; the old-UTC-keyed Sunday-evening run counts there', wk.rows.length === 1 && wk.rows[0].val === 40, wk.rows.map((r) => r.val));
    const past = LB.lb2Rush(list, 'easy', 'past');
    ok('Past weeks: last week (old keys) is finished and won by its best', past.rows.map((r) => `${r.g.name}:${r.val}`).join() === 'Bravo:50,Bravo:12', past.rows.map((r) => `${r.g.name}:${r.val}`));
    const won = LB.lb2Rush(list, 'easy', 'won');
    ok('Weeks won counts finished weeks only', won.rows.length === 1 && won.rows[0].val === 2);
    Date.now = () => L(2026, 10, 1, 21);   // the viewer: local Sunday 21:00, still last week
    const sun = LB.lb2Rush(list, 'easy', 'week');
    ok('Sunday evening: this week is still last week (no early empty board)', sun.rows.map((r) => r.val).join() === '50,31', sun.rows.map((r) => r.val));
    const pastSun = LB.lb2Rush(list, 'easy', 'past');
    ok('a week the viewer has not reached yet is not "finished"', !pastSun.rows.some((r) => r.val === 40));
  } finally { Date.now = realNow; }

  // Merged across a person's phones (players-agg), the week keys pass through unchanged.
  const PA = await import('../js/players-agg.js');
  const merged = PA.aggregatePlayers({
    d1: { profile: { playerId: 'TSTAA', name: 'Alpha' }, updatedAt: 100, stats: { games: { wayout: after } } },
    d2: { profile: { playerId: 'TSTAA', name: 'Alpha' }, updatedAt: 200, stats: { games: { wayout: { total: { played: 0, won: 0, lost: 0 }, byDiff: {},
      wo: { timed: {}, mistakes: 0, hints: 0, log: {}, rush: { runs: {}, best: { easy: { '2026-11-02': 44 } } } } } } } },
  });
  const p = merged.find((x) => x && x.playerId === 'TSTAA');
  const mb = p ? T.woRushBestMap(p.games.wayout.wo.rush.best.easy) : {};
  ok('players-agg keeps every week key and takes the best', mb['2026-10-26'] === 31 && mb['2026-11-02'] === 44, mb);
}
if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ } }

console.log(`\nRush weeks tests (TZ=${TZ}): ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
