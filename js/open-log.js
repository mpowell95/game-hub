// js/open-log.js - EVERY OPEN, VISIT, GAME AND ACCOUNT CHANGE, PER DEVICE (2026-11-25, Matt: "List his devices and
// the date/time of every login", then "We need to collect more data on his logins. And track everything more closely").
// Until today nothing kept when a device opened the hub (a record holds only its LAST sync). Every event below is a
// play-log entry (sent with the play log, js/play-log.js; admins and the reader key only; no new node or rule):
//   playLog/<CODE>/<t>-<n> = { g: 'hub', e, k: <device id>, w: 'app|tab <screen>', r: <build>, x: <details JSON> }
// e = 'open'    the hub loaded                    x: the whole device picture (deviceInfo below)
//     'return'  back after 5+ minutes away         x: { away: seconds away, ... the device picture }
//     'hide'    left the app or switched tab       x: { secs: seconds on screen since it showed }
//     'game'    a game opened                      x: { id: hub id }
//     'leave'   back to the launcher from a game   x: { id, secs }
//     'account' a name or code change              x: { what: 'name'|'link'|'thatsme'|'reset', from, to, code }
// The device picture: browser and system, app or tab, screen and window, time zone, languages, touch, the storage
// quota (a private window gets a far smaller one; a HINT, not proof), how wide the window's frame is (docked developer
// tools make it wide on a computer; a HINT), whether this browser's device id is new, and how long ago it was made.
// THE LAW: a report only, never read back by the phone. A phone with no player code yet logs nothing.
// reportAddress (2026-11-25): each open and return is also sent to the server (functions-ip). Best effort.
import { appendPlayLog } from './play-log-queue.js';
import { deviceId } from './game-stats.js';
import { installState, appVersion } from './install-state.js';

const AWAY_MS = 5 * 60 * 1000;
export const IP_URL = 'https://us-central1-game-hub-5b91c.cloudfunctions.net/ipSeen';
const BORN_KEY = 'gamehub.deviceBorn.v1';     // when this browser first ran the open log (its device id's first sighting)
let started = false;
let hiddenAt = 0;
let shownAt = Date.now();
let game = null;                              // { id, at } while a game is open

function code() {
  try { const p = JSON.parse(localStorage.getItem('gamehub.profile') || 'null'); return String((p && p.playerId) || '').trim().toUpperCase(); } catch { return ''; }
}
const safe = (fn, d = null) => { try { const v = fn(); return v === undefined ? d : v; } catch { return d; } };

/** How new this browser is: { born, isNew }. The first open on a browser stamps it; a cleared or private browser
 *  starts again (a new device id AND a new stamp). */
function birth() {
  let born = Number(safe(() => localStorage.getItem(BORN_KEY), 0)) || 0;
  const isNew = !born;
  if (!born) { born = Date.now(); try { localStorage.setItem(BORN_KEY, String(born)); } catch { /* a private window may refuse */ } }
  return { born, isNew };
}

async function deviceInfo(extra) {
  const s = safe(() => installState(), {}) || {};
  let quotaMB = null;
  try { const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; if (est && est.quota) quotaMB = Math.round(est.quota / 1048576); } catch { /* none */ }
  const b = birth();
  return Object.assign({
    ua: String(safe(() => navigator.userAgent, '') || '').slice(0, 300),
    dev: s.device || null, br: s.browser || null, app: !!s.installed, mode: s.mode || null,
    sw: safe(() => screen.width), sh: safe(() => screen.height), dpr: safe(() => window.devicePixelRatio),
    vw: safe(() => window.innerWidth), vh: safe(() => window.innerHeight),
    ow: safe(() => window.outerWidth), oh: safe(() => window.outerHeight),
    tz: safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone), lang: safe(() => (navigator.languages || [navigator.language]).slice(0, 4).join(',')),
    touch: safe(() => navigator.maxTouchPoints, 0), cores: safe(() => navigator.hardwareConcurrency), mem: safe(() => navigator.deviceMemory),
    net: safe(() => (navigator.connection && navigator.connection.effectiveType) || null),
    quotaMB, newDevice: b.isNew, bornAgoS: Math.round((Date.now() - b.born) / 1000),
    ref: String(safe(() => document.referrer, '') || '').slice(0, 120), path: String(safe(() => location.pathname + location.search, '') || '').slice(0, 120),
    wd: safe(() => navigator.webdriver === true, false),
  }, extra || {});
}

async function note(e, x, opts = {}) {
  const c = opts.code || code();
  if (!c) return;
  let w = '', r = '';
  try { const s = installState(); w = `${s.installed ? 'app' : 'tab'} ${s.screen ? `${s.screen.w}x${s.screen.h}` : ''}`.trim(); } catch { /* unknown */ }
  try { r = (await appVersion()) || ''; } catch { r = ''; }
  let xs = null;
  try { xs = x ? JSON.stringify(x).slice(0, 4000) : null; } catch { xs = null; }
  appendPlayLog(c, { g: 'hub', e, k: deviceId(), w: w.slice(0, 40), r: String(r).slice(0, 20), x: xs });
}

/** Send this open (or return) to the server, which records the internet address it came from. Never throws. */
export async function reportAddress(e) {
  try {
    const { writesAllowed } = await import('./stats-net.js');
    if (!writesAllowed('ipSeen')) return false;            // test automation and localhost never send
    const { getStatsApp } = await import('./firebase-boot.js');
    const boot = await getStatsApp();
    if (!boot || typeof boot.idToken !== 'function') return false;
    const tok = await boot.idToken();
    if (!tok) return false;
    const res = await fetch(IP_URL, {
      method: 'POST', mode: 'cors', credentials: 'omit', keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ k: deviceId(), e: e === 'return' ? 'return' : 'open', c: code() }),
    });
    if (!res.ok) console.warn('[open-log] address not recorded', res.status);
    return res.ok;
  } catch (err) { console.warn('[open-log] address not recorded', String(err)); return false; }
}

/** Log this open, then every hide, return, and (from the hub) game opened and left. Safe to call more than once. */
export function startOpenLog() {
  if (started) return;
  started = true;
  shownAt = Date.now();
  deviceInfo().then((x) => note('open', x)).catch(() => note('open', null));
  reportAddress('open');
  try {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        note('hide', { secs: Math.round((hiddenAt - shownAt) / 1000), game: game ? game.id : null });
        return;
      }
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      shownAt = Date.now();
      if (away >= AWAY_MS) { deviceInfo({ away: Math.round(away / 1000) }).then((x) => note('return', x)).catch(() => {}); reportAddress('return'); }
      hiddenAt = 0;
    });
  } catch { /* no document */ }
}

/** The hub opened a game (js/hub.js launch). */
export function noteGameOpen(id) {
  game = { id: String(id || '').slice(0, 40), at: Date.now() };
  note('game', { id: game.id });
}
/** The hub is back on the launcher (js/hub.js showLauncher). */
export function noteGameLeave() {
  if (!game) return;
  const g = game; game = null;
  note('leave', { id: g.id, secs: Math.round((Date.now() - g.at) / 1000) });
}
/** A name or code change (the name gate, the profile page). `code` = the code it belongs to (after a link, the new one). */
export function noteAccount(what, data, codeOverride) {
  deviceInfo(Object.assign({ what: String(what || '').slice(0, 20) }, data || {}))
    .then((x) => note('account', x, { code: codeOverride }))
    .catch(() => note('account', { what }, { code: codeOverride }));
}

export default { startOpenLog, noteGameOpen, noteGameLeave, noteAccount, reportAddress };
