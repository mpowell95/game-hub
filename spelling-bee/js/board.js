// spelling-bee/js/board.js - the DAILY BOARD (Matt, 2026-10-26: "see how many words other people who
// have played that day have gotten").
//
// beeDaily/<puzzle>/<CODE> = { name, emoji, words, points, rank, at }. <puzzle> is the puzzle's letters
// with '-' for ':' ("a-chlnrt"), so a retired puzzle keeps its own board. Written by the player's own
// device (rules: `$code` must be this device's msgAuth claim), and `words` can only go UP (rule 2, in the
// rules too): a second phone on the same code with fewer words is refused, which is right.
//
// This is a REPORT of the local save, never the save itself: gamehub.spellingbee.save.v1 stays the
// record. A failed post logs loudly (rule 6) and is retried on the next word or the next open.
import { getStatsApp } from '../../js/firebase-boot.js';
import { writesAllowed } from '../../js/stats-net.js';
import { ensureAuthClaim, myCode } from '../../js/messages.js';
import { loadProfile } from '../../js/profile-store.js';
import { isHiddenName } from '../../js/hidden-players.js';
import { watchPath } from '../../js/live-read.js';

const POSTED_KEY = 'gamehub.spellingbee.posted.v1';   // { "<puzzle>": words last verified on the board }

// 'es:a:bcdefñ' -> 'es-a-bcdef0': ASCII for the database key and its rule (Ñ is written 0).
export const boardKey = (puzzleKey) => String(puzzleKey || '').replace(/:/g, '-').replace(/ñ/g, '0');

function loadPosted() {
  try { const v = JSON.parse(localStorage.getItem(POSTED_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; }
  catch { return {}; }
}

/** Has this count already reached the board? (Saves a write per open.) */
export function needsPost(puzzleKey, words) {
  return words > 0 && (loadPosted()[boardKey(puzzleKey)] || 0) < words;
}

/** Post this player's progress on one puzzle. Resolves true once it is verified by a re-read. */
export async function postProgress(puzzleKey, { words, points, rank }) {
  const code = myCode();
  const k = boardKey(puzzleKey);
  if (!code || !/^(es-)?[a-z0]-[a-z0]{6}$/.test(k) || !needsPost(puzzleKey, words)) return false;
  if (!writesAllowed('Spelling Bee board')) return false;
  const boot = await getStatsApp();
  if (!boot) return false;
  if (!(await ensureAuthClaim(boot))) return false;
  const p = (() => { try { return loadProfile() || {}; } catch { return {}; } })();
  const { db, api } = boot;
  const ref = api.ref(db, `beeDaily/${k}/${code}`);
  try {
    await api.set(ref, {
      name: String(p.name || '').slice(0, 40), emoji: String(p.emoji || '').slice(0, 16),
      words, points, rank, at: api.serverTimestamp(),
    });
    const snap = await api.get(ref);
    const v = snap && snap.exists() ? snap.val() : null;
    if (!v || v.words < words) { console.error('[spelling-bee] board post did not read back', v); return false; }
    try { const m = loadPosted(); m[k] = Math.max(m[k] || 0, v.words); localStorage.setItem(POSTED_KEY, JSON.stringify(m)); } catch { /* next open re-posts */ }
    return true;
  } catch (err) {
    // PERMISSION_DENIED with a higher count already there (another phone on this code) is expected.
    console.error('[spelling-bee] board post FAILED; will retry on the next word or open', err);
    return false;
  }
}

/** Watch one puzzle's board. cb(rows): [{ code, name, emoji, words, points, rank }], most words first.
 *  Returns an unsubscribe that is always safe to call. */
export function watchDaily(puzzleKey, cb) {
  let stop = null, dead = false;
  getStatsApp().then((boot) => {
    if (!boot || dead) return;
    stop = watchPath(boot, `beeDaily/${boardKey(puzzleKey)}`, (v) => cb(rowsOf(v)));
  }).catch(() => {});
  return () => { dead = true; if (stop) stop(); };
}

/** Pure: the stored node -> sorted rows, test accounts out. */
export function rowsOf(v) {
  const rows = [];
  for (const [code, r] of Object.entries(v && typeof v === 'object' ? v : {})) {
    if (!r || typeof r !== 'object' || !(r.words > 0) || isHiddenName(r.name)) continue;
    rows.push({ code, name: String(r.name || code), emoji: String(r.emoji || ''), words: r.words | 0, points: r.points | 0, rank: r.rank | 0 });
  }
  return rows.sort((a, b) => b.words - a.words || b.points - a.points || a.name.localeCompare(b.name));
}
