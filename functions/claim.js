// functions/claim.js - DEVICE KEYS: proof that a phone really belongs to a player code (2026-11-04).
//
// Matt asked for privacy and security fixes ("Yes start on 1-3", 2026-11-04). The hole: a player code
// (5 letters) is the whole identity, any signed-in visitor can read every code, and msgAuth/<uid> lets
// any visitor claim any code. Matt chose: a NEW phone joins an existing player with a PIN shown on an
// old phone (or made by Matt on the Admin page). Phones already linked keep working with nothing to do.
//
// STEP A (this file, live, invisible to players): every phone that already holds a claim
// (msgAuth/<uid> === its code) registers a random DEVICE KEY. The phone keeps the key in localStorage;
// the server keeps only its SHA-256 at codeKeys/<CODE>/<hash>. Later, a phone whose anonymous sign-in
// changed (cleared site data, a new uid) proves itself with the key and gets its claim back without a
// PIN. Nothing here changes who may claim what yet: msgAuth stays client-writable until STEP B.
//
// A request is ONE node per uid, written by the phone: claimReq/<uid> = { t, code, h | key, at }.
//   t 'reg' : register hash h for code. Only when msgAuth/<uid> already says that code.
//   t 'key' : prove a key for code. Its hash must be in codeKeys/<code>; then msgAuth/<uid> = code.
// The answer goes to claimRes/<uid> = { t, code, h, ok, why, at } (readable by that uid only).
// Nothing is ever deleted: keys are added, never removed (a lost key is just unused).

import crypto from 'node:crypto';

export const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;
export const HASH_RE = /^[0-9a-f]{64}$/;
export const KEY_RE = /^[0-9a-f]{64}$/;

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/**
 * Handle one claim request. `db` is firebase-admin's database (or the test fake). Returns the answer it
 * wrote. Never throws for a bad request: a bad request gets { ok: false, why }.
 */
export async function handleClaim(db, uid, req, now = Date.now()) {
  const t = req && req.t;
  const code = String((req && req.code) || '');
  const answer = (ok, why, h) => {
    const res = { t: String(t || ''), code, ok, why: why || '', at: now };
    if (h) res.h = h;
    return db.ref(`claimRes/${uid}`).set(res).then(() => res);
  };
  if (!uid || !CODE_RE.test(code)) return answer(false, 'bad-code');
  const claimed = (await db.ref(`msgAuth/${uid}`).get()).val();

  if (t === 'reg') {
    const h = String(req.h || '');
    if (!HASH_RE.test(h)) return answer(false, 'bad-hash');
    if (claimed !== code) return answer(false, 'not-claimed', h);
    const ref = db.ref(`codeKeys/${code}/${h}`);
    const had = (await ref.get()).val();
    if (had) {
      // Same key again (a retry, or the phone's sign-in changed): note the uid, never drop the old one.
      if (had.uid !== uid) await ref.update({ uid, uids: ((had.uids | 0) || 1) + 1, last: now });
      return answer(true, 'already', h);
    }
    await ref.set({ uid, at: now, last: now, uids: 1 });
    return answer(true, 'registered', h);
  }

  if (t === 'key') {
    const key = String(req.key || '');
    if (!KEY_RE.test(key)) return answer(false, 'bad-key');
    const h = sha256(key);
    const ref = db.ref(`codeKeys/${code}/${h}`);
    const had = (await ref.get()).val();
    if (!had) return answer(false, 'unknown-key', h);
    if (claimed !== code) await db.ref(`msgAuth/${uid}`).set(code);
    if (had.uid !== uid) await ref.update({ uid, uids: ((had.uids | 0) || 1) + 1, last: now });
    else await ref.update({ last: now });
    return answer(true, claimed === code ? 'already' : 'restored', h);
  }

  return answer(false, 'bad-type');
}
