// functions/signin.js - ALLOW / DENY SIGN IN, the server half (2026-11-15, Matt: "i like the allow/deny popup on
// the original phone"). The phone half: js/signin-ask.js (+ the pure js/signin-rules.js). Why and the release
// checklist: docs/SECURITY-DEVICE-KEYS.md, "Step B".
//
// signIns/<CODE>/<reqId> = { uid, name, device, at, via: 'link'|'thatsme', state, by?, answeredAt?, seen?, ... }
// is written by the NEW phone (state 'waiting', its own uid) and answered by one of that code's phones or an
// admin (state 'allowed' | 'denied', by = their uid). database.rules.json lets nobody else write it and nobody
// delete it. This file is the ONLY thing that grants: on an Allow from a uid whose msgAuth is that code (or an
// admin), inside the 10 minutes, it sets msgAuth/<requester uid> = CODE and stamps the request `granted`.
// Anything else gets `bad: <why>` and grants nothing (a late Allow also turns the request 'lapsed').
//
// Fields only the server writes: granted, grantedAt, bad, pushedAt. Nothing is ever deleted.
// Reads per event: msgAuth/<by uid> and admins/<by uid> (a few bytes), and pushSubs/<CODE> through sendTo.

export const LAPSE_MS = 10 * 60 * 1000;          // = js/signin-rules.js LAPSE_MS (tools/test-signin-ask.mjs checks)
export const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{5}$/;
const UID_RE = /^[A-Za-z0-9_-]{6,128}$/;

const clean = (s, n = 40) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);

/**
 * What a write to signIns/<code>/<reqId> asks of the server. PURE.
 *   { act: 'notify' }               a new request: tell the code's phones
 *   { act: 'check' }                an Allow to verify (the caller reads the answerer's claim, then grant())
 *   null                            nothing to do (a cancel, a deny, a seen stamp, the server's own stamps)
 */
export function decideSignIn({ code, before, after }) {
  if (!after || typeof after !== 'object' || !CODE_RE.test(String(code || ''))) return null;
  const was = before && typeof before === 'object' ? before : null;
  if (!was && after.state === 'waiting') return { act: 'notify' };
  // The server's own `granted`/`bad` stamp re-fires this trigger and must do nothing; a second check before
  // it lands (a seen stamp in between) grants the same claim again, harmlessly.
  if (after.state === 'allowed' && !after.granted && !after.bad) return { act: 'check' };
  return null;
}

/**
 * Is this Allow good? PURE. `byCode` = msgAuth/<after.by>, `byAdmin` = admins/<after.by> === true.
 * Returns { ok: true } or { ok: false, why, lapse? }.
 */
export function judgeAllow({ code, req, byCode, byAdmin, now }) {
  if (!req || typeof req !== 'object') return { ok: false, why: 'no-request' };
  if (req.state !== 'allowed') return { ok: false, why: 'not-allowed' };
  if (!UID_RE.test(String(req.uid || ''))) return { ok: false, why: 'bad-uid' };
  if (!UID_RE.test(String(req.by || ''))) return { ok: false, why: 'bad-by' };
  if (req.by === req.uid) return { ok: false, why: 'self' };
  if (!(byAdmin === true || byCode === code)) return { ok: false, why: 'not-theirs' };
  const at = Number(req.at);
  if (!(at > 0)) return { ok: false, why: 'no-time' };
  const answered = Number(req.answeredAt) > 0 ? Number(req.answeredAt) : now;
  if (answered - at >= LAPSE_MS || now - at >= LAPSE_MS + 2 * 60 * 1000) return { ok: false, why: 'lapsed', lapse: true };
  return { ok: true };
}

/** The notification for the code's phones. PURE. */
export function signInNote(req) {
  const name = clean(req && req.name) || 'you';
  const device = clean(req && req.device, 60) || 'A new phone';
  return {
    kind: 'signin', who: name,
    text: (lang) => (lang === 'es'
      ? { title: `Nuevo inicio de sesión de ${name}`, body: device }
      : { title: `New sign in for ${name}`, body: device }),
  };
}

/**
 * Handle one write. `db` is firebase-admin's database (or the test fake), `send(code, note, tag)` sends a push.
 * Returns what it did: 'notified' | 'granted' | 'refused:<why>' | 'none'.
 */
export async function handleSignIn(db, { code, reqId, before, after, now = Date.now(), send }) {
  const d = decideSignIn({ code, before, after });
  if (!d) return 'none';
  const ref = db.ref(`signIns/${code}/${reqId}`);
  if (d.act === 'notify') {
    if (typeof send === 'function') await send(code, signInNote(after), `signin-${reqId}`);
    await ref.update({ pushedAt: now });
    return 'notified';
  }
  const by = String(after.by || '');
  const [byCode, byAdmin] = UID_RE.test(by)
    ? await Promise.all([db.ref(`msgAuth/${by}`).get().then((s) => s.val()), db.ref(`admins/${by}`).get().then((s) => s.val())])
    : [null, null];
  const j = judgeAllow({ code, req: after, byCode, byAdmin, now });
  if (!j.ok) {
    await ref.update(j.lapse ? { bad: j.why, state: 'lapsed' } : { bad: j.why });
    return `refused:${j.why}`;
  }
  await db.ref(`msgAuth/${after.uid}`).set(code);
  // THE LAW rule 6: say granted only once the claim is really there.
  const back = (await db.ref(`msgAuth/${after.uid}`).get()).val();
  if (back !== code) { await ref.update({ bad: 'did-not-land' }); return 'refused:did-not-land'; }
  await ref.update({ granted: true, grantedAt: now });
  return 'granted';
}
