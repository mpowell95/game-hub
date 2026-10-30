// js/contexto-history.js - sends every Contexto puzzle this phone has in its save (gamehub.contexto.save.v1)
// to ctHistory/<CODE>/<deviceId>/<lang>-<n> (2026-10-30, Matt: "I want all of it to be able to analyze
// everything"). The stored stats keep only running totals and the play log starts 2026-10-28; the phone's
// own save holds every puzzle ever played on it: each guess in order, which were hints, and the result.
//
//   ctHistory/<CODE>/<deviceId>/<lang>-<n> = { n, l, g: [{w, h?}], d?, r?, s }
//     n  puzzle number   l  'en'|'es'   g  every guess in order (h: 1 = a hint)
//     d  'won'|'gave' (absent = unfinished)   r  1 = counted in the stats   s  the server's clock when sent
//
// Admin-read only (database.rules.json; the guesses hold answers). The save has no times, so none are sent.
// The save is per PHONE, not per player: it goes up under the active player's code (a shared phone's
// puzzles land under whoever is active). Only puzzles that changed since their last verified send go up
// (gamehub.contexto.histSent.v1, a seen-list); the save itself is never touched. Dev origins never send.
import { getStatsApp } from './firebase-boot.js';
import { writesAllowed } from './stats-net.js';
import { ensureAuthClaim, myCode } from './messages.js';
import { deviceId } from './game-stats.js';

const SAVE_KEY = 'gamehub.contexto.save.v1';
const SENT_KEY = 'gamehub.contexto.histSent.v1';

function readJSON(key) {
  try { const v = JSON.parse(localStorage.getItem(key) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

/** The save's puzzles as upload rows: [{ key, val, sig }]. Pure over the parsed save. */
export function historyRows(save) {
  const games = save && save.games && typeof save.games === 'object' ? save.games : {};
  const rows = [];
  for (const [sk, e] of Object.entries(games)) {
    if (!e || typeof e !== 'object' || !Array.isArray(e.guesses) || !e.guesses.length) continue;
    const lang = String(sk).split(':')[0] === 'es' ? 'es' : 'en';
    const n = Number.isFinite(e.n) ? e.n : null;
    const key = n != null ? `${lang}-${n}` : `${lang}-x${hash(String(sk))}`;
    const g = e.guesses.filter((x) => x && typeof x.w === 'string').map((x) => (x.hint ? { w: x.w.slice(0, 40), h: 1 } : { w: x.w.slice(0, 40) }));
    if (!g.length) continue;
    const val = { n: n == null ? -1 : n, l: lang, g };
    if (e.done === 'won' || e.done === 'gave') val.d = e.done;
    if (e.recorded) val.r = 1;
    rows.push({ key, val, sig: `${g.length}:${val.d || ''}:${val.r || 0}` });
  }
  return rows;
}

let sending = false;
/** Send every puzzle that changed since its last verified send. Safe to call any time. */
export async function flushContextoHistory() {
  if (sending) return;
  const code = myCode();
  if (!code || !writesAllowed('contexto history')) return;
  const sent = readJSON(SENT_KEY);
  const todo = historyRows(readJSON(SAVE_KEY)).filter((r) => sent[`${code}|${r.key}`] !== r.sig);
  if (!todo.length) return;
  sending = true;
  try {
    const boot = await getStatsApp();
    if (!boot || !(await ensureAuthClaim(boot))) return;
    const { db, api } = boot;
    const dev = deviceId();
    const batch = todo.slice(0, 100);
    const patch = {};
    for (const r of batch) patch[`ctHistory/${code}/${dev}/${r.key}`] = { ...r.val, s: api.serverTimestamp() };
    await api.update(api.ref(db), patch);
    const last = batch[batch.length - 1];
    const snap = await api.get(api.ref(db, `ctHistory/${code}/${dev}/${last.key}/g`));
    if (!snap || !snap.exists()) { console.error('[contexto-history] send did not read back; will retry'); return; }
    const next = readJSON(SENT_KEY);
    for (const r of batch) next[`${code}|${r.key}`] = r.sig;
    try { localStorage.setItem(SENT_KEY, JSON.stringify(next)); } catch (err) { console.error('[contexto-history] seen-list', err); }
    if (todo.length > batch.length) setTimeout(() => flushContextoHistory(), 500);
  } catch (err) {
    console.error('[contexto-history] send FAILED; will retry', err);
  } finally {
    sending = false;
  }
}

export default { flushContextoHistory, historyRows };
