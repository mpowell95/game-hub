// js/play-log.js - sends the play log (js/play-log-queue.js) to playLog/<CODE>/<t>-<n> (2026-10-28).
//
//   playLog/<CODE>/<t>-<n> = { t, s, g, f?, a?, e?, k?, w?, r? }
//     t  the phone's clock when it happened     s  the server's clock when it arrived
//     g  the game (stats id)                    f  the recorder (a finished game), a its arguments (JSON)
//     e  an event (Contexto: open, guess, hint, giveup, win, hidden, visible)
//     k  the puzzle (Contexto 'en-31')          w  the word guessed      r  its rank, or 'unknown'
//
// Admins read it (database.rules.json), nobody else: Contexto's guesses include the answers. Entries
// go up in batches of 200 under the player's own claimed code; a failed send stays queued and is
// retried (rule 6), a re-sent entry lands on the same key (never doubled), and an entry for another
// player code on this phone waits until that player is active again. Dev origins never send.
import { getStatsApp } from './firebase-boot.js';
import { writesAllowed } from './stats-net.js';
import { ensureAuthClaim, myCode } from './messages.js';
import { readQueue, writeQueue, onAppend } from './play-log-queue.js';

let timer = null;
let sending = false;

/** Send what is queued for the active player. Safe to call any time; one send at a time. */
export async function flushPlayLog() {
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
      for (const k of ['f', 'a', 'e', 'k', 'w', 'r', 'm']) if (x[k] != null) v[k] = x[k];
      patch[`playLog/${code}/${x.id}`] = v;
    }
    await api.update(api.ref(db), patch);
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

/** Send a few seconds after the last entry (a burst of guesses goes up together). */
export function startPlayLog() {
  onAppend(() => { if (!timer) timer = setTimeout(() => { timer = null; flushPlayLog(); }, 5000); });
  try { document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPlayLog(); }); } catch { /* no document */ }
  flushPlayLog();
}

export default { flushPlayLog, startPlayLog };
