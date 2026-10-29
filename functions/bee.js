// SPELLING BEE FAIR PLAY, the server half (2026-10-28, docs/SPELLING-BEE-INTEGRITY-SPEC.md).
//
// Every 5 minutes (index.js beeWatch) for the puzzles of yesterday, today and tomorrow (a phone's
// "today" is its own local date):
//   1. DETECTION: each player's guess log (beeLog/<puzzle>/<CODE>) through the shared rules
//      (js/bee-fairplay.js detectCopying). A copied day is written ONCE to beeFlags/<puzzle>/<CODE>
//      and Matt gets a push. Every phone then shows that row as played, 0 (never on the player's own
//      phone), and the long-term board counts it as played with nothing.
//   2. MISSING LOG (alert only, never a void): the board row shows more words than the log has, 30+
//      minutes after its last update, and the player HAS a log for that puzzle (an older build sends
//      none). Once per player per puzzle (beeAlerts/).
// And the long-term board: boards/v1/bee = JSON string of js/bee-fairplay.js buildBeeBoard(), rebuilt
// when a board row changes (at most every 2 min), after a flag, and on Matt's undo. Since 2026-10-29
// each row counts what its LOG proves was found on the day by the server's clock (boards/v1/beeOwn,
// ownDayNumbers), not the phone's own-day fields, whenever the log holds every word or the post is late.
//
// THE LAW: nothing here changes a save, a beeDaily row or a beeLog entry. Flags and alerts are new
// nodes; the board is derived. A flag is never removed by this code (Matt's undo sits beside it).
import './shared-env.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { detectCopying, flagSummary, buildBeeBoard, ownEntry, isLatePost, zoneShifts } from './shared/js/bee-fairplay.js';
import { isHiddenName } from './shared/js/hidden-players.js';

export const PUZZLES = JSON.parse(readFileSync(new URL('./shared/bee-puzzles.json', import.meta.url), 'utf8'));
const DAY = 24 * 60 * 60 * 1000;
const LOG_QUIET_MS = 30 * 60 * 1000;
export const BEE_GAP_MS = 2 * 60 * 1000;

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
/** Board keys whose puzzle day is yesterday, today or tomorrow (UTC), every language. */
export function recentPuzzles(now = Date.now()) {
  const days = new Set([ymd(now - DAY), ymd(now), ymd(now + DAY)]);
  return Object.keys(PUZZLES).filter((k) => days.has(PUZZLES[k].day));
}

const valOf = async (db, path) => (await db.ref(path).get()).val();

/** Logging began 2026-10-27; every puzzle from then to tomorrow is checked (2026-10-29, Matt: "you
 *  SHOULD NOT SKIP ANYTHING"; only yesterday, today and tomorrow were, so a log sent late, or a day
 *  checked under an older rule, was never looked at again). */
export const LOG_SINCE = '2026-10-27';
export function loggedPuzzles(now = Date.now()) {
  const last = ymd(now + DAY);
  return Object.keys(PUZZLES).filter((k) => PUZZLES[k].day >= LOG_SINCE && PUZZLES[k].day <= last);
}

/** Detection for one player on one puzzle. `row` may be missing (a log with no board row is checked
 *  too); test accounts are checked like anyone (the push skips them). `log` = that player's log when
 *  the caller already has it. Returns the flag written (once), or null. */
export async function checkPlayer(db, bk, code, row, log) {
  if (!PUZZLES[bk]) return null;
  if (await valOf(db, `beeFlags/${bk}/${code}`)) return null;   // already flagged
  if (log === undefined) log = await valOf(db, `beeLog/${bk}/${code}`);
  if (!log) return null;
  row = row && typeof row === 'object' ? row : {};
  const d = detectCopying(log, { words: row.words | 0, puzzle: PUZZLES[bk] });
  if (!d.void) return null;
  const flag = {
    rules: [...d.strong, ...d.supporting], summary: flagSummary(d), name: String(row.name || code).slice(0, 40),
    sorted: d.sorted, burst: d.burst.n, burstAvgMs: Math.round(d.burst.avg), best: d.best, leave: d.leave,
    geniusMs: d.geniusMs == null ? -1 : Math.round(d.geniusMs), right: d.right == null ? -1 : d.right,
    wrong: d.wrong == null ? -1 : d.wrong, retyped: d.retyped == null ? -1 : d.retyped, at: Date.now(),
  };
  const res = await db.ref(`beeFlags/${bk}/${code}`).transaction((cur) => (cur ? undefined : flag));
  return res && res.committed ? flag : null;
}

/** Missing log, alert only. Returns the alert written (once), or null. */
export async function checkLog(db, bk, code, row, now = Date.now()) {
  if (!PUZZLES[bk] || !row || isHiddenName(row.name) || !(row.words > 0)) return null;
  if (!(Number(row.at) && now - Number(row.at) >= LOG_QUIET_MS)) return null;
  if (await valOf(db, `beeAlerts/${bk}/${code}`)) return null;
  const log = await valOf(db, `beeLog/${bk}/${code}`);
  if (!log) return null;   // no log at all: an older build, not a gap
  const logged = new Set(Object.values(log).filter((x) => x && x.e === 'guess' && (x.r === 'ok' || x.r === 'bonus')).map((x) => x.w)).size;
  if (logged >= row.words) return null;
  const alert = { words: row.words | 0, logged, name: String(row.name || code).slice(0, 40), at: now };
  const res = await db.ref(`beeAlerts/${bk}/${code}`).transaction((cur) => (cur ? undefined : alert));
  return res && res.committed ? alert : null;
}

/** The phone's time zone moved during a puzzle (js/bee-fairplay.js zoneShifts; 2026-10-29), alert only:
 *  a zone a day ahead shows Yesterday's Answers on the real today. Once per player per puzzle, at
 *  beeAlerts/<puzzle>/<CODE>~zone. Returns the alert written, or null. */
export async function checkZone(db, bk, code, row, log, now = Date.now()) {
  if (!PUZZLES[bk] || !log) return null;
  const zs = zoneShifts(log);
  if (!zs.length) return null;
  const name = String((row && row.name) || code).slice(0, 40);
  if (isHiddenName(name)) return null;
  if (await valOf(db, `beeAlerts/${bk}/${code}~zone`)) return null;
  const alert = { zone: zs.join(','), name, at: now };
  const res = await db.ref(`beeAlerts/${bk}/${code}~zone`).transaction((cur) => (cur ? undefined : alert));
  return res && res.committed ? alert : null;
}

/** The pushes Matt gets. `kind` 'flag', 'log' or 'zone'. */
export function beeNote(kind, bk, info) {
  const pz = PUZZLES[bk] || {};
  const [, m, d] = String(pz.day || '').split('-').map(Number);
  const MON = { en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] };
  return {
    kind: kind === 'flag' ? 'beeFlag' : kind === 'zone' ? 'beeZone' : 'beeLog',
    text: (lang) => {
      const date = m ? (lang === 'es' ? `${d} ${MON.es[m - 1]}` : `${MON.en[m - 1]} ${d}`) : '';
      const where = `${date} ${pz.lang === 'es' ? 'ES' : 'EN'}`.trim();
      if (kind === 'zone') {
        return { title: 'Spelling Bee', body: lang === 'es' ? `${info.name}, ${where}: cambió de zona horaria (${info.zone})` : `${info.name}, ${where}: time zone changed (${info.zone})` };
      }
      if (kind === 'flag') {
        return { title: 'Spelling Bee', body: lang === 'es' ? `${info.name}: anulado, ${where}. ${info.summary}` : `${info.name} flagged, ${where}. ${info.summary}` };
      }
      return { title: 'Spelling Bee', body: lang === 'es' ? `${info.name}, ${where}: ${info.words} palabras, ${info.logged} en el registro` : `${info.name}, ${where}: board ${info.words} words, log ${info.logged}` };
    },
  };
}

/** One pass: detection over every logged puzzle (`all`) or the recent ones, for every code with a
 *  board row OR a log; missing-log alerts for board rows. Returns {flags: [[bk, code, flag]], alerts}. */
export async function scanRecent(db, now = Date.now(), { all = false } = {}) {
  const flags = [], alerts = [];
  for (const bk of all ? loggedPuzzles(now) : recentPuzzles(now)) {
    const rows = (await valOf(db, `beeDaily/${bk}`)) || {};
    const logs = (await valOf(db, `beeLog/${bk}`)) || {};
    for (const code of new Set([...Object.keys(rows), ...Object.keys(logs)])) {
      const row = rows[code];
      const f = await checkPlayer(db, bk, code, row, logs[code] || null);
      if (f) flags.push([bk, code, f]);
      const z = await checkZone(db, bk, code, row, logs[code] || null, now);
      if (z) alerts.push([bk, `${code}~zone`, z]);
      if (!row || typeof row !== 'object') continue;
      const a = await checkLog(db, bk, code, row, now);
      if (a) alerts.push([bk, code, a]);
    }
  }
  return { flags, alerts };
}

/** Puzzles whose words can still arrive on time (the day before yesterday to tomorrow, UTC): their
 *  own-day numbers are recomputed on every rebuild, since the log keeps growing after a row's post. */
export function ownDayPuzzles(now = Date.now()) {
  const days = new Set([ymd(now - 2 * DAY), ymd(now - DAY), ymd(now), ymd(now + DAY)]);
  return new Set(Object.keys(PUZZLES).filter((k) => days.has(PUZZLES[k].day)));
}

/** boards/v1/beeOwn (2026-10-29): per row, what its log proves was found on the puzzle's day by the
 *  server's clock (js/bee-fairplay.js ownEntry). Recent puzzles every time; an older puzzle only for a
 *  LATE post (a phone set back to a past day) whose entry is missing or older than the post. Returns
 *  { own: the whole map as it should be, patch: paths that changed }. */
export async function ownDayNumbers(db, daily, current, now = Date.now()) {
  const recent = ownDayPuzzles(now);
  const own = JSON.parse(JSON.stringify(current && typeof current === 'object' ? current : {}));
  const patch = {};
  for (const [bk, rows] of Object.entries(daily && typeof daily === 'object' ? daily : {})) {
    const pz = PUZZLES[bk];
    if (!pz || !rows || typeof rows !== 'object') continue;
    for (const [code, row] of Object.entries(rows)) {
      if (!row || typeof row !== 'object') continue;
      const had = (own[bk] || {})[code] || null;
      const stale = !had || Number(had.at) !== Number(row.at);
      if (!recent.has(bk) && !(isLatePost(pz.day, row.at) && stale)) continue;
      const e = ownEntry(row, await valOf(db, `beeLog/${bk}/${code}`), pz);
      if (JSON.stringify(e) === JSON.stringify(had)) continue;
      if (!own[bk]) own[bk] = {};
      if (e) own[bk][code] = e; else delete own[bk][code];
      patch[`beeOwn/${bk}/${code}`] = e;
    }
  }
  return { own, patch };
}

/** Rebuild boards/v1/bee (a JSON string). Written only when it changed. */
export async function rebuildBee(db, now = Date.now()) {
  const [daily, flagsNode, cfg, ownNode] = await Promise.all([valOf(db, 'beeDaily'), valOf(db, 'beeFlags'), valOf(db, 'adminConfig/v1'), valOf(db, 'boards/v1/beeOwn')]);
  const { own, patch: ownPatch } = await ownDayNumbers(db, daily || {}, ownNode || {}, now);
  const board = buildBeeBoard(daily || {}, PUZZLES, flagsNode || {}, cfg || {}, own);
  const json = JSON.stringify(board);
  const sum = createHash('sha256').update(json).digest('hex').slice(0, 16);
  const meta = (await valOf(db, 'boards/v1/beeMeta')) || {};
  const patch = { 'beeMeta/builtAt': Date.now(), 'beeMeta/dirty': null, ...ownPatch };
  if (meta.sum !== sum) { patch.bee = json; patch['beeMeta/sum'] = sum; patch['beeMeta/bytes'] = json.length; }
  await db.ref('boards/v1').update(patch);
  return { changed: meta.sum !== sum, bytes: json.length, people: Object.keys(board.people).length };
}

/** A board row changed: rebuild now, or mark dirty when one ran under 2 min ago (the 5-min pass picks it up). */
export async function rebuildBeeIfDue(db, now = Date.now()) {
  const lock = await db.ref('boards/v1/beeMeta/lockUntil').transaction((cur) => (cur && cur > now ? undefined : now + BEE_GAP_MS));
  if (!lock.committed) { await db.ref('boards/v1/beeMeta/dirty').set(true); return null; }
  return rebuildBee(db);
}
