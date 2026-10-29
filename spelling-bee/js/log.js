// spelling-bee/js/log.js - EVERY GUESS AND EVERY ACTION, with its time (Matt, 2026-10-27: "Record every
// guess he makes. Correct or not. The time each guess was made. Everything.").
//
// beeLog/<puzzle>/<CODE>/<t>-<n> = { t, e, w?, r?, s }
//   t  the phone's clock (ms) when it happened      e  what: guess, open, close, hidden, visible,
//   w  the typed letters (guesses only)                hints, yesterday, past, board, rankings, help,
//   r  the result: ok, bonus, or the refusal           win, list, shuffle, lang, del (Delete pressed;
//                                                      w = what was left), shut (a sheet closed; r = which)
//   s  the server's clock when it arrived (a phone clock set wrong shows up against it)
//   k  guesses only: ms from the first letter typed to Enter (2026-10-29)
//   z  the phone's time-zone offset in minutes (getTimezoneOffset; 2026-10-29): the server decides which
//      day a guess fell on with it (js/bee-fairplay.js countsOnDay)
//
// Nothing in the game reads it back (no download for anyone); `node tools/read-bee-times.mjs --log`
// does. Entries queue in localStorage (gamehub.spellingbee.log.v1) and go up in batches; a failed
// send stays queued and is retried (rule 6), so an offline session arrives later, not never. Nothing is
// ever dropped from the queue (2026-10-29, Matt: "you SHOULD NOT SKIP ANYTHING"; it used to keep only the
// newest 3,000). A re-sent
// entry lands on the same key, so a retry never doubles it. Dev origins never send (writesAllowed).
import { getStatsApp } from '../../js/firebase-boot.js';
import { writesAllowed } from '../../js/stats-net.js';
import { ensureAuthClaim, myCode } from '../../js/messages.js';
import { boardKey } from './board.js';

const QUEUE_KEY = 'gamehub.spellingbee.log.v1';
let seq = 0;
let timer = null;
let sending = false;

function readQueue() {
  try { const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); return Array.isArray(q) ? q : []; } catch { return []; }
}
function writeQueue(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (err) { console.error('[spelling-bee] log queue not saved', err); }
}

/** Note one action on the puzzle `puzzleKey`. Cheap: a localStorage append, sent a few seconds later. */
export function logAction(puzzleKey, e, extra) {
  const k = boardKey(puzzleKey);
  if (!/^(es-)?[a-z0]-[a-z0]{6}$/.test(k)) return;
  const t = Date.now();
  const entry = { p: k, id: `${t}-${seq++ % 10000}`, t, e };
  try { const z = new Date(t).getTimezoneOffset(); if (Number.isFinite(z)) entry.z = z; } catch { /* no zone */ }
  if (extra && typeof extra.w === 'string') entry.w = extra.w.slice(0, 30);
  if (extra && typeof extra.r === 'string') entry.r = extra.r.slice(0, 20);
  if (extra && Number.isFinite(extra.k) && extra.k >= 0) entry.k = Math.round(extra.k);
  const q = readQueue();
  q.push(entry);
  writeQueue(q);
  if (!timer) timer = setTimeout(() => { timer = null; flushLog(); }, 4000);
}

/** Send what is queued. Safe to call any time; one send at a time. */
export async function flushLog() {
  if (sending) return;
  const code = myCode();
  const q = readQueue();
  if (!code || !q.length || !writesAllowed('Spelling Bee log')) return;
  sending = true;
  try {
    const boot = await getStatsApp();
    if (!boot || !(await ensureAuthClaim(boot))) return;
    const { db, api } = boot;
    const batch = q.slice(0, 200);
    const patch = {};
    for (const x of batch) {
      const v = { t: x.t, e: x.e, s: api.serverTimestamp() };
      if (x.w != null) v.w = x.w;
      if (x.r != null) v.r = x.r;
      if (Number.isFinite(x.z)) v.z = x.z;
      if (Number.isFinite(x.k)) v.k = x.k;
      patch[`beeLog/${x.p}/${code}/${x.id}`] = v;
    }
    await api.update(api.ref(db), patch);
    const last = batch[batch.length - 1];
    const snap = await api.get(api.ref(db, `beeLog/${last.p}/${code}/${last.id}`));
    if (!snap || !snap.exists()) { console.error('[spelling-bee] log send did not read back; kept for retry'); return; }
    const sent = new Set(batch.map((x) => x.id));
    writeQueue(readQueue().filter((x) => !sent.has(x.id)));
    if (readQueue().length) setTimeout(() => flushLog(), 500);
  } catch (err) {
    console.error('[spelling-bee] log send FAILED; kept for retry', err);
  } finally {
    sending = false;
  }
}
