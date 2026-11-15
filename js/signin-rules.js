// js/signin-rules.js - ALLOW / DENY SIGN IN, the pure half (2026-11-15, Matt: "i like the allow/deny popup on
// the original phone", then "cool yeah build"). Network half: js/signin-ask.js. Server half: functions/signin.js.
// Story and release checklist: docs/SECURITY-DEVICE-KEYS.md, "Step B".
//
// A phone joining an EXISTING player (Link with a code, or "That's me" on a name in use) writes a request,
// signIns/<CODE>/<reqId> = { uid, name, device, at, via, state }, and waits. The code's other phones get a
// popup (app open) or a notification (app closed) with Deny / Allow; Matt can answer from Admin > Now. Only
// the SERVER grants (msgAuth/<uid> = code). NOT CLEARED FOR PLAYERS: only codes in the ask set (js/admin-config.js
// resolveSigninAsk: test1's DREG5 by default) take this path; every other code links exactly as before.
//
// Dependency-free and PURE (no DOM, no network, no storage): tools/test-signin-ask.mjs runs it in Node.

/** A request waits this long, then lapses (decided on the SERVER's clock: js/server-time.js, functions/signin.js). */
export const LAPSE_MS = 10 * 60 * 1000;
/** "That's me" on a name claimed this recently links at once, as before (js/name-gate.js, 2026-10-25). */
export const ME_WINDOW_MS = 24 * 60 * 60 * 1000;

export const STATES = ['waiting', 'allowed', 'denied', 'cancelled', 'lapsed'];
export const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{5}$/;

/** Has this waiting request run out? `now` is server time; null (no server clock) = not decided yet = false. */
export function isLapsed(req, now) {
  if (!req || typeof req !== 'object') return false;
  if (req.state === 'lapsed') return true;
  const at = Number(req.at);
  if (now == null || !Number.isFinite(+now) || !(at > 0)) return false;
  return +now - at >= LAPSE_MS;
}

/** Still waiting for an answer, by the server's clock. */
export function isWaiting(req, now) {
  return !!(req && req.state === 'waiting' && !req.granted && !isLapsed(req, now));
}

/**
 * What the waiting phone shows for its own request: 'wait' | 'in' (granted: finish the link) | 'denied' |
 * 'lapsed' | 'cancelled'. Allowed but not yet granted by the server = still 'wait'.
 */
export function waitView(req, now) {
  if (!req || typeof req !== 'object') return 'wait';
  if (req.granted === true) return 'in';
  if (req.state === 'denied') return 'denied';
  if (req.state === 'cancelled') return 'cancelled';
  if (req.state === 'lapsed' || (req.state === 'waiting' && isLapsed(req, now))) return 'lapsed';
  if (req.state === 'allowed' && req.bad) return 'lapsed';   // the server refused the Allow (too late, say)
  return 'wait';
}

/**
 * "That's me" on a taken name (Matt, 2026-11-15). `gated`: the name's code is in the ask set. `ageMs`: how old
 * its claim is on the server's clock (-1 = unknown).
 *   'link' - link at once, as before: a claim under 24 h old, gated or not (an iPhone's Home Screen app shares no
 *            storage with the Safari tab that just made the name, and that tab cannot get notifications)
 *   'ask'  - a gated code's older name: That's me sends a request and waits for Allow
 *   'none' - today's "Taken. Use that code instead." (a non-gated code's older name, or no server time)
 */
export function thatsMeRoute({ gated, ageMs }) {
  const age = Number(ageMs);
  if (Number.isFinite(age) && age >= 0 && age < ME_WINDOW_MS) return 'link';
  if (gated) return 'ask';
  return 'none';
}

/** "Android · Chrome", "iPhone · Safari", ... from a user agent. Short, no version numbers. */
export function deviceLine(ua) {
  const s = String(ua || '');
  let dev = 'Phone';
  if (/iPad/.test(s) || (/Macintosh/.test(s) && /Mobile/.test(s))) dev = 'iPad';
  else if (/iPhone|iPod/.test(s)) dev = 'iPhone';
  else if (/Android/.test(s)) dev = /Mobile/.test(s) ? 'Android' : 'Android tablet';
  else if (/Windows/.test(s)) dev = 'Windows';
  else if (/Macintosh|Mac OS X/.test(s)) dev = 'Mac';
  else if (/CrOS/.test(s)) dev = 'Chromebook';
  else if (/Linux/.test(s)) dev = 'Linux';
  let br = '';
  if (/EdgA?\/|Edg\//.test(s)) br = 'Edge';
  else if (/SamsungBrowser/.test(s)) br = 'Samsung Internet';
  else if (/Firefox|FxiOS/.test(s)) br = 'Firefox';
  else if (/OPR\/|Opera/.test(s)) br = 'Opera';
  else if (/CriOS|Chrome\//.test(s)) br = 'Chrome';
  else if (/Safari\//.test(s)) br = 'Safari';
  return br ? `${dev} · ${br}` : dev;
}

/** The next `seen/<uid>` stamp for a popup really on screen (first, last, how often) and, once, what was tapped. */
export function nextSeen(prev, now, tap) {
  const p = prev && typeof prev === 'object' ? prev : {};
  const first = Number(p.first) > 0 ? Number(p.first) : now;
  const out = { first, last: now, n: (Number(p.n) | 0) + (tap ? 0 : 1) };
  if (out.n < 1) out.n = 1;
  const t = tap || p.tap;
  if (t === 'allow' || t === 'deny') out.tap = t;
  if (tap) out.tapAt = now; else if (Number(p.tapAt) > 0) out.tapAt = Number(p.tapAt);
  return out;
}

/** The waiting requests in a signIns/<CODE> snapshot, newest first: [{id, ...req}]. */
export function waitingList(node, now) {
  const out = [];
  for (const [id, r] of Object.entries(node && typeof node === 'object' ? node : {})) {
    if (isWaiting(r, now)) out.push(Object.assign({ id }, r));
  }
  return out.sort((a, b) => (+b.at || 0) - (+a.at || 0));
}

export default { LAPSE_MS, ME_WINDOW_MS, STATES, CODE_RE, isLapsed, isWaiting, waitView, thatsMeRoute, deviceLine, nextSeen, waitingList };
