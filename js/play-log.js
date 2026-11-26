// js/play-log.js - sends the play log (js/play-log-queue.js) to playLog/<CODE>/<t>-<n> (2026-10-28).
//
//   playLog/<CODE>/<t>-<n> = { t, s, g, f?, a?, e?, k?, w?, r? }
//     t  the phone's clock when it happened     s  the server's clock when it arrived
//     g  the game (stats id)                    f  the recorder (a finished game), a its arguments (JSON)
//     e  an event (Contexto: open, guess, hint, giveup, win, hidden, visible)
//     m  the game's mode ('<key>@<diff>', '?' = recorded outside withMode)   d  the match's detail (JSON)
//     k  the puzzle (Contexto 'en-31')          w  the word guessed      r  its rank, or 'unknown'
//     x  the play's PRIVATE data, JSON (withMode's `log`, logPlayData; 2026-11-16, at most 20,000 chars)
//     u  the sending phone's sign-in id (2026-11-25; the rules allow only the writer's own), so the server knows WHO wrote it
//
// Admins (and the reader key) read it, nobody else (2026-11-16, Matt: "somewhere that only I can see"):
// a phone may read back only an entry's `t`, to confirm its send arrived. Contexto's cross-phone check
// reads ctSync/<CODE> instead (hint/giveup/win only, copied by the server, functions ctSyncCopy). Entries
// go up in batches of 200 under the player's own claimed code; a failed send stays queued and is
// retried (rule 6), a re-sent entry lands on the same key (never doubled), and an entry for another
// player code on this phone waits until that player is active again. Dev origins never send.
import { getStatsApp } from './firebase-boot.js';
import { writesAllowed } from './stats-net.js';
import { ensureAuthClaim, myCode } from './messages.js';
import { readQueue, writeQueue, readInputQueue, writeInputQueue, onAppend } from './play-log-queue.js';

let timer = null;
let sending = false;

// EVIDENCE IS WRITE-ONCE (2026-11-25): the rules refuse any write to an entry that exists, so a play could never be
// edited after it was judged. A batch re-sent after its read-back was lost would then be refused whole; this finds
// the entries of a refused batch that already landed (each one's `t` is readable by its own code) and drops only
// those from the queue, so the rest go up on the next try. Returns true when it dropped any.
async function dropLanded(api, db, node, code, batch, read, write) {
  const landed = new Set();
  for (const x of batch) {
    try { const s = await api.get(api.ref(db, `${node}/${code}/${x.id}/t`)); if (s && s.exists() && s.val() === x.t) landed.add(x.id); }
    catch { /* unknown: kept */ }
  }
  if (!landed.size) return false;
  console.warn(`[play-log] ${landed.size} ${node} entries were already sent; dropped from the queue`);
  write(read().filter((x) => !(x && x.c === code && landed.has(x.id))));
  setTimeout(() => flushPlayLog(), 500);
  return true;
}

// ONE REFUSED ENTRY NEVER HOLDS BACK THE REST (2026-11-26): a batch is all or nothing, so one entry the rules refuse
// (a touch log a few characters over its limit) failed every batch behind it, and Matt's phone sent no touch log for
// 6 hours. When a batch is refused and none of it had landed, each entry goes up on its own: the good ones land and
// leave the queue, the refused one stays queued (rule 6, said loudly) and is tried again next time. Returns how many landed.
async function sendEach(api, db, node, code, patch, read, write) {
  const sent = new Set();
  for (const [path, v] of Object.entries(patch)) {
    const id = path.slice(path.lastIndexOf('/') + 1);
    try {
      await api.update(api.ref(db), { [path]: v });
      const s = await api.get(api.ref(db, `${path}/t`));
      if (s && s.exists()) sent.add(id); else console.error(`[play-log] ${node} ${id} did not read back; kept for retry`);
    } catch (err) { console.error(`[play-log] ${node} ${id} REFUSED; kept for retry, the rest still go up`, err); }
  }
  if (sent.size) write(read().filter((x) => !(x && x.c === code && sent.has(x.id))));
  return sent.size;
}

/** Send what is queued for the active player. Safe to call any time; one send at a time. */
export async function flushPlayLog() {
  try { await flushLogEntries(); } finally { await flushPlayInput(); }
}
async function flushLogEntries() {
  if (sending) return;
  const code = myCode();
  const mine = readQueue().filter((x) => x && x.c === code);
  if (!code || !mine.length || !writesAllowed('play log')) return;
  sending = true;
  try {
    const boot = await getStatsApp();
    if (!boot || !(await ensureAuthClaim(boot))) return;
    const { db, api } = boot;
    const batch = mine.slice(0, 200);
    const patch = {};
    for (const x of batch) {
      const v = { t: x.t, g: x.g, s: api.serverTimestamp() };
      for (const k of ['f', 'a', 'e', 'k', 'w', 'r', 'm', 'd', 'x', 'i']) if (x[k] != null) v[k] = x[k];
      if (boot.uid) v.u = boot.uid;
      // A result queued by a build older than the touch count (2026-11-24) says so honestly: the rules now refuse a
      // result without `i`, and one refused entry would hold back every play behind it (THE LAW).
      if (v.f && v.i == null) v.i = '{"none":1}';
      patch[`playLog/${code}/${x.id}`] = v;
    }
    try { await api.update(api.ref(db), patch); }
    catch (err) {
      if (await dropLanded(api, db, 'playLog', code, batch, readQueue, writeQueue)) return;
      if (batch.length < 2) throw err;
      console.error('[play-log] batch refused; sending one at a time', err);
      if (await sendEach(api, db, 'playLog', code, patch, readQueue, writeQueue) && mine.length > batch.length) setTimeout(() => flushPlayLog(), 500);
      return;
    }
    const last = batch[batch.length - 1];
    const snap = await api.get(api.ref(db, `playLog/${code}/${last.id}/t`));
    if (!snap || !snap.exists()) { console.error('[play-log] send did not read back; kept for retry'); return; }
    const sent = new Set(batch.map((x) => x.id));
    writeQueue(readQueue().filter((x) => !(x && x.c === code && sent.has(x.id))));
    if (readQueue().some((x) => x && x.c === code)) setTimeout(() => flushPlayLog(), 500);
  } catch (err) {
    console.error('[play-log] send FAILED; kept for retry', err);
  } finally {
    sending = false;
  }
}

// EVERY TOUCH AND KEY (2026-11-24, js/play-log-queue.js INPUT_KEY): each play's input log goes to
// playInput/<CODE>/<entry id> = { t, n, s } (admins and the reader key only), apart from playLog so the
// admin page's play list stays small. Same rules as above: claimed code, verified by re-read, kept on failure.
let sendingIn = false;
export async function flushPlayInput() {
  if (sendingIn) return;
  const code = myCode();
  const mine = readInputQueue().filter((x) => x && x.c === code && x.n);
  if (!code || !mine.length || !writesAllowed('play input')) return;
  sendingIn = true;
  try {
    const boot = await getStatsApp();
    if (!boot || !(await ensureAuthClaim(boot))) return;
    const { db, api } = boot;
    const batch = mine.slice(0, 20);
    const patch = {};
    for (const x of batch) patch[`playInput/${code}/${x.id}`] = { t: x.t, n: x.n, s: api.serverTimestamp(), ...(boot.uid ? { u: boot.uid } : {}) };
    try { await api.update(api.ref(db), patch); }
    catch (err) {
      if (await dropLanded(api, db, 'playInput', code, batch, readInputQueue, writeInputQueue)) return;
      if (batch.length < 2) throw err;
      console.error('[play-log] input batch refused; sending one at a time', err);
      if (await sendEach(api, db, 'playInput', code, patch, readInputQueue, writeInputQueue) && mine.length > batch.length) setTimeout(() => flushPlayInput(), 500);
      return;
    }
    const last = batch[batch.length - 1];
    const snap = await api.get(api.ref(db, `playInput/${code}/${last.id}/t`));
    if (!snap || !snap.exists()) { console.error('[play-log] input send did not read back; kept for retry'); return; }
    const sent = new Set(batch.map((x) => x.id));
    writeInputQueue(readInputQueue().filter((x) => !(x && x.c === code && sent.has(x.id))));
    if (readInputQueue().some((x) => x && x.c === code)) setTimeout(() => flushPlayInput(), 500);
  } catch (err) {
    console.error('[play-log] input send FAILED; kept for retry', err);
  } finally {
    sendingIn = false;
  }
}

/** Send a few seconds after the last entry (a burst of guesses goes up together). */
export function startPlayLog() {
  onAppend(() => { if (!timer) timer = setTimeout(() => { timer = null; flushPlayLog(); }, 5000); });
  try { document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPlayLog(); }); } catch { /* no document */ }
  flushPlayLog();
}

export default { flushPlayLog, flushPlayInput, startPlayLog };
