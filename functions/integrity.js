// INTEGRITY CHECKS, the server half (2026-10-28, docs/INTEGRITY-CHECKS-SPEC.md, rules in js/integrity.js).
//
//   1. RECORDS: every leaderboard rebuild (index.js rebuildBoards, which already holds all of players/)
//      runs each device's stats through the shared rules. A rule broken for the first time is written
//      ONCE to integrityFlags/<statsId>/<gameId>/<ruleId> and every admin gets a push. A flag with a
//      STRONG rule voids that game on that record in the leaderboard package (activeVoids, minus
//      Matt's undo at adminConfig/v1/integrity/undo/<statsId>/<gameId>).
//   2. MATCHES: when an online challenge ends (darts, cuppong, battleship, hoops), its log is checked;
//      an alert is written ONCE to integrityAlerts/<node>~<matchId>/<ruleId>~<side> and pushed. Never a void.
//   3. ONLINE PAIRS (2026-11-02): at most hourly, inside the board rebuild (which already holds players/),
//      every pair of codes who played each other online (challenge indexes + live-room h2h) is judged by
//      js/integrity.js pairAlerts; each alert is written ONCE to integrityAlerts/pair~<A>~<B>/<rule>~<a|b|x>
//      and pushed. Never a void.
//
// THE LAW: nothing here changes players/, a match, or a stats store. Flags and alerts are new nodes,
// never removed by this code.
import './shared-env.js';
import { checkStats, checkMatch, checkContextoWin, contextoWinForRecord, hitText, gameName, PAIR_NODES, PAIR_LIMITS, pairCodes, onlinePairs, pairAlerts } from './shared/js/integrity.js';
import { isHiddenDeviceId, isHiddenName } from './shared/js/hidden-players.js';

const valOf = async (db, path) => (await db.ref(path).get()).val();

/** New record flags against what is stored. Pure. Returns [{ id, gid, rule, flag }]. */
export function newFlags(players, stored, now = Date.now()) {
  const out = [];
  for (const [id, rec] of Object.entries(players || {})) {
    if (!rec || typeof rec !== 'object' || isHiddenDeviceId(id)) continue;
    const prof = rec.profile || {};
    if (isHiddenName(prof.name)) continue;
    const hits = checkStats(rec.stats);
    for (const [gid, list] of Object.entries(hits)) {
      for (const h of list) {
        if ((((stored || {})[id] || {})[gid] || {})[h.rule]) continue;
        out.push({ id, gid, rule: h.rule, flag: {
          void: h.void === true, v: h.v, lim: h.lim, ...(h.at ? { at: String(h.at) } : {}),
          name: String(prof.name || '').slice(0, 40), code: String(prof.playerId || ''), when: now,
        } });
      }
    }
  }
  return out;
}

/** Write the new flags (each once, by transaction). Returns the ones written. */
export async function writeFlags(db, players, now = Date.now()) {
  const stored = (await valOf(db, 'integrityFlags')) || {};
  const written = [];
  for (const f of newFlags(players, stored, now)) {
    const res = await db.ref(`integrityFlags/${f.id}/${f.gid}/${f.rule}`).transaction((cur) => (cur ? undefined : f.flag));
    if (res && res.committed) { written.push(f); (((stored[f.id] = stored[f.id] || {})[f.gid] = stored[f.id][f.gid] || {})[f.rule] = f.flag); }
  }
  return { written, flags: stored };
}

/** A finished match's alerts, each written once. `node`/`id` name the match. Returns those written. */
export async function checkFinishedMatch(db, node, id, m, now = Date.now()) {
  const written = [];
  for (const h of checkMatch(node, m)) {
    const who = (m && m[h.side]) || {};
    const alert = { v: h.v, lim: h.lim, side: h.side, name: String(who.name || '').slice(0, 40), code: String(who.code || ''), when: now };
    const res = await db.ref(`integrityAlerts/${node}~${id}/${h.rule}~${h.side || 'x'}`).transaction((cur) => (cur ? undefined : alert));
    if (res && res.committed) written.push({ ...h, ...alert });
  }
  return written;
}

/** The push an admin gets. `kind` 'flag' (a record) or 'match'. */
export function integrityNote(kind, info) {
  const game = gameName(kind === 'flag' ? info.gid : info.node);
  const strong = kind === 'flag' && info.flag.void;
  const name = (kind === 'flag' ? info.flag.name : info.name) || '?';
  const what = hitText(kind === 'flag' ? { rule: info.rule, v: info.flag.v, lim: info.flag.lim } : info);
  return {
    kind: 'integrity',
    text: (lang) => ({
      title: 'Integrity check',
      body: lang === 'es'
        ? `${name}, ${game}: ${strong ? 'anulado' : 'aviso'}. ${what}`
        : `${name}, ${game}: ${strong ? 'voided' : 'alert'}. ${what}`,
    }),
  };
}

/** A Contexto win was logged (playLog/<code>/<id>), or (2026-10-29) its recorder entry, which names the
 *  puzzle in its extras (`k`): judge it once (checkContextoWin). Since 2026-10-29 the phone sends its win
 *  BEFORE it checks the other phones and records, so the recorder entry usually lands later: judging on
 *  it sees the hints it counted. Returns the alerts written. Each alert lives at
 *  integrityAlerts/contexto~<code>~<puzzle>/<rule>~x (written once, so judging twice is harmless). */
export async function checkContextoLogWin(db, code, id, entry, now = Date.now()) {
  if (!entry || entry.g !== 'contexto') return [];
  const isRec = entry.f === 'recordContexto';
  if (!isRec && (entry.e !== 'win' || !entry.k)) return [];
  let k = entry.k;
  if (isRec) { try { k = (JSON.parse(entry.a)[2] || {}).k; } catch { k = null; } }
  if (!k) return [];
  const pz = await db.ref(`playLog/${code}`).orderByChild('k').equalTo(String(k)).get();
  const pv = pz.val() || {};
  const puzzle = Object.keys(pv).map((key) => ({ ...pv[key], id: key }));
  const win = isRec ? contextoWinForRecord(puzzle, entry) : { ...entry, id };
  if (!win) return [];
  const t = Number(win.t) || 0;
  const nr = await db.ref(`playLog/${code}`).orderByKey().startAt(`${t - 60000}`).endAt(`${t + 60000}~`).get();
  const near = Object.values(nr.val() || {});
  if (isRec && !near.some((x) => x && x.f === 'recordContexto' && Number(x.t) === Number(entry.t))) near.push(entry);
  const name = String(((await db.ref(`directory/${code}/name`).get()).val()) || code).slice(0, 40);
  const written = [];
  for (const h of checkContextoWin(puzzle, near, win)) {
    const alert = { v: h.v, lim: h.lim, side: '', name, code, k: String(win.k), when: now };
    const key = `contexto~${code}~${String(win.k).replace(/[.#$/[\]]/g, '_')}`;
    const res = await db.ref(`integrityAlerts/${key}/${h.rule}~x`).transaction((cur) => (cur ? undefined : alert));
    if (res && res.committed) written.push({ ...h, ...alert, node: 'contexto' });
  }
  return written;
}

/** ONLINE PAIRS (2026-11-02, js/integrity.js pairAlerts). `players` = the board rebuild's own read; this
 *  reads only the challenge indexes and usernames/ (a few KB each). Each alert written once, by
 *  transaction. Returns the alerts written, each with { node: 'pair', name, code } for the push. */
export async function checkOnlinePairs(db, players, now = Date.now()) {
  const nodes = Object.keys(PAIR_NODES);
  const [usernames, ...idx] = await Promise.all([valOf(db, 'usernames'), ...nodes.map((n) => valOf(db, `${n}/index`))]);
  const indexes = Object.fromEntries(nodes.map((n, i) => [n, idx[i] || {}]));
  const codes = pairCodes(players || {}, usernames || {});
  const pairs = onlinePairs(players || {}, indexes, usernames || {}, codes);
  const nm = (c) => String(((codes[c] || {}).name) || '').slice(0, 40);
  const written = [];
  for (const h of pairAlerts(pairs, codes)) {
    const p = pairs.find((x) => x.key === h.key);
    const who = h.side === 'a' ? p.a : h.side === 'b' ? p.b : '';
    const other = h.side === 'a' ? p.b : h.side === 'b' ? p.a : '';
    const alert = {
      v: h.v, lim: h.lim, side: h.side === 'x' ? '' : h.side,
      name: who ? nm(who) : `${nm(p.a)} / ${nm(p.b)}`, code: who || h.key, with: other, games: p.games, when: now,
    };
    const res = await db.ref(`integrityAlerts/pair~${h.key}/${h.rule}~${h.side}`).transaction((cur) => (cur ? undefined : alert));
    if (res && res.committed) written.push({ ...alert, rule: h.rule, node: 'pair' });
  }
  return written;
}
/** Is the hourly pair check due? `pairsAt` = boards/v1/meta/pairsAt (the last run). */
export const pairsDue = (pairsAt, now = Date.now()) => !(+pairsAt > 0 && now - +pairsAt < PAIR_LIMITS.EVERY_MS);
