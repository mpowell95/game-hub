// bug-report.js - the DATA half of "Report a bug" (js/bug-report-ui.js is the screen).
//
// THE LAW (root CLAUDE.md): read-only against everything that already exists. It writes only its
// own two NEW nodes (`bugReports/`, `bugReportShots/`) and its own NEW local key
// (`gamehub.bugreports.pending.v1`, the offline outbox) - no stats key, no profile field, no
// players/ record, so no path from here can lose a player anything.
//
// WHY NOT JUST js/device-report.js. That diagnostic answers "whose history is this and did it
// sync". It says nothing about WHAT THE PLAYER IS HOLDING: the phone, the browser, installed to
// the home screen vs a tab, screen size, connection, which build the service worker is serving,
// what threw thirty seconds ago. Matt asked for "the same as the device details button, but with
// even more information", so a report carries `deviceReport` (that diagnostic, verbatim) PLUS
// `environment` (everything below). Neither is a subset of the other.
//
// Every probe is individually guarded: a browser that refuses one (Safari and the UA-Client-Hints
// high-entropy call are the usual suspects) records `null` and the report still sends. A
// diagnostic that can fail to send is worse than one with a hole in it.

import { gatherDeviceReport } from './device-report.js';
import { getStatsApp } from './firebase-boot.js';
import { loadProfile } from './profile-store.js';
import { deviceId, statsId } from './game-stats.js';
import { recentErrors } from './error-log.js';

// --- limits -------------------------------------------------------------------------------------
// Screenshots ride as base64 data URLs. RTDB is not a file store, so the caps stay conservative:
// three shots covers before/after/detail, and the byte budget keeps a report inside one
// comfortable write on a phone connection.
export const MAX_SHOTS = 3;
export const MAX_SHOT_EDGE = 1400;        // px on the long edge after downscaling
export const MAX_SHOT_BYTES = 900_000;    // per shot, base64 length
export const MAX_TOTAL_SHOT_BYTES = 2_400_000;
export const MAX_DESCRIPTION = 1200;
export const PENDING_KEY = 'gamehub.bugreports.pending.v1';
export const MAX_PENDING = 5;

// --- small pure helpers (headless-testable: test-bug-report.mjs) ---------------------------------

/** Trim + clamp what the player typed. Returns '' for anything unusable. */
export function normalizeDescription(text) {
  const s = (typeof text === 'string' ? text : '').trim();
  return s.length > MAX_DESCRIPTION ? s.slice(0, MAX_DESCRIPTION) : s;
}

/** Would adding a shot of `bytes` keep the set inside both caps? Pure, so the UI can refuse a file
 *  BEFORE it is attached rather than failing at send time with the report already written. */
export function fitsShotBudget(existing, bytes) {
  const shots = Array.isArray(existing) ? existing : [];
  if (shots.length >= MAX_SHOTS) return false;
  if (!(bytes > 0) || bytes > MAX_SHOT_BYTES) return false;
  const total = shots.reduce((n, s) => n + ((s && s.bytes) | 0), 0);
  return total + bytes <= MAX_TOTAL_SHOT_BYTES;
}

/** A timestamp as a number. NEVER `x | 0` on an epoch-ms value: bitwise ops coerce to a SIGNED
 *  32-BIT int, and epoch ms passed 2^31 in 1970, so `Date.now() | 0` is a small, wrong, sometimes
 *  negative number. It scrambled the inbox's order and unread count in this file's first draft -
 *  hence the real-epoch tests on sortReportsNewestFirst/countUnread. `| 0` stays correct for the
 *  byte counters here, which are small by construction. */
const ms = (v) => (Number.isFinite(+v) ? +v : 0);

/** Newest first. Pure, so the inbox's ordering is testable without Firebase. */
export function sortReportsNewestFirst(list) {
  return (Array.isArray(list) ? list.slice() : []).sort((a, b) => ms(b && b.createdAtMs) - ms(a && a.createdAtMs));
}

/** How many reports arrived after `sinceMs` and are still open. Pure, same reason. */
export function countUnread(reports, sinceMs) {
  const since = ms(sinceMs);
  return (Array.isArray(reports) ? reports : [])
    .filter((r) => r && ms(r.createdAtMs) > since && r.status !== 'done').length;
}

/** One-line "what was sent" summary, used by the confirmation screen and the admin inbox list. */
export function summarizeEnvironment(env) {
  if (!env) return '';
  const bits = [];
  if (env.deviceLabel) bits.push(env.deviceLabel);
  if (env.browserLabel) bits.push(env.browserLabel);
  if (env.displayMode) bits.push(env.displayMode === 'standalone' ? 'installed app' : env.displayMode);
  if (env.screen && env.screen.viewportW) bits.push(`${env.screen.viewportW}x${env.screen.viewportH}`);
  if (env.appVersion) bits.push(env.appVersion);
  return bits.join(' · ');
}

// --- environment probes ---------------------------------------------------------------------

const safe = (fn, fallback = null) => { try { const v = fn(); return v === undefined ? fallback : v; } catch { return fallback; } };
const safeAsync = async (fn, fallback = null) => { try { const v = await fn(); return v === undefined ? fallback : v; } catch { return fallback; } };

/** Which PWA display mode the page is running in - Matt's "browser tab vs added to the home
 *  screen" question. iOS Safari predates the media query, so `navigator.standalone` is checked
 *  too and reported separately rather than merged away. */
function displayModeOf() {
  const modes = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay', 'browser'];
  for (const m of modes) {
    if (safe(() => window.matchMedia(`(display-mode: ${m})`).matches, false)) return m;
  }
  return null;
}

/** A short human label for the phone/computer, best-effort. UA-CH gives a real model string on
 *  Android; iOS gives nothing beyond "iPhone", which is itself the useful answer. */
function deviceLabelFrom(uaData, ua) {
  const model = uaData && uaData.model;
  const platform = (uaData && uaData.platform) || '';
  const pv = (uaData && uaData.platformVersion) || '';
  if (model) return [model, platform && `(${platform} ${pv})`.trim()].filter(Boolean).join(' ');
  const m = /\((iPhone|iPad|iPod)[^)]*OS (\d+[_\d]*)/.exec(ua || '');
  if (m) return `${m[1]} · iOS ${m[2].replace(/_/g, '.')}`;
  const a = /\(Linux; Android ([\d.]+)(?:; ([^)]+?))?(?: Build|\))/.exec(ua || '');
  if (a) return `${a[2] || 'Android device'} · Android ${a[1]}`;
  if (platform) return `${platform} ${pv}`.trim();
  return null;
}

/** Browser + version, from UA-CH when available (Chrome/Edge) and the UA string otherwise. */
function browserLabelFrom(uaData, ua) {
  const brands = (uaData && (uaData.fullVersionList || uaData.brands)) || [];
  const real = brands.find((b) => b && b.brand && !/Not.?A.?Brand/i.test(b.brand) && !/Chromium/i.test(b.brand))
    || brands.find((b) => b && b.brand && !/Not.?A.?Brand/i.test(b.brand));
  if (real) return `${real.brand} ${real.version || ''}`.trim();
  const s = ua || '';
  const pat = [
    [/CriOS\/([\d.]+)/, 'Chrome iOS'], [/FxiOS\/([\d.]+)/, 'Firefox iOS'], [/EdgiOS\/([\d.]+)/, 'Edge iOS'],
    [/Edg\/([\d.]+)/, 'Edge'], [/OPR\/([\d.]+)/, 'Opera'], [/SamsungBrowser\/([\d.]+)/, 'Samsung Internet'],
    [/Firefox\/([\d.]+)/, 'Firefox'], [/Chrome\/([\d.]+)/, 'Chrome'], [/Version\/([\d.]+).*Safari/, 'Safari'],
  ];
  for (const [re, name] of pat) { const m = re.exec(s); if (m) return `${name} ${m[1]}`; }
  return null;
}

/** Ask the ACTIVE service worker which build it is serving (the same GET_VERSION message the
 *  version pill uses). "Which build is this phone running" is the first question of half the bug
 *  reports this feature will get. */
function serviceWorkerVersion() {
  return new Promise((resolve) => {
    try {
      const ctrl = navigator.serviceWorker && navigator.serviceWorker.controller;
      if (!ctrl) { resolve(null); return; }
      const ch = new MessageChannel();
      const timer = setTimeout(() => resolve(null), 1500);
      ch.port1.onmessage = (e) => { clearTimeout(timer); resolve((e.data && e.data.cache) || null); };
      ctrl.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
    } catch { resolve(null); }
  });
}

/** The GPU string - what actually explains "the 3D games are choppy on my phone" (Ball Run, Pool
 *  and Hill Climb all render live). The context is released immediately. */
function gpuInfo() {
  return safe(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) return { supported: false };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const out = {
      supported: true,
      vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    };
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return out;
  }, { supported: false });
}

/** Device, browser, install state, screen, connection, storage and service worker: everything a
 *  bug report could plausibly need. Never throws. */
export async function gatherEnvironment() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const ua = safe(() => nav.userAgent, '') || '';
  const uaData = await safeAsync(async () => {
    if (!nav.userAgentData) return null;
    const base = { brands: nav.userAgentData.brands, mobile: nav.userAgentData.mobile, platform: nav.userAgentData.platform };
    const high = await safeAsync(() => nav.userAgentData.getHighEntropyValues(
      ['model', 'platformVersion', 'architecture', 'bitness', 'fullVersionList', 'uaFullVersion']), {});
    return Object.assign(base, high || {});
  }, null);

  const swRegs = await safeAsync(async () => {
    if (!nav.serviceWorker || !nav.serviceWorker.getRegistrations) return null;
    const regs = await nav.serviceWorker.getRegistrations();
    return regs.map((r) => ({
      scope: r.scope,
      installing: !!r.installing, waiting: !!r.waiting,
      active: r.active ? r.active.state : null,
      updateViaCache: r.updateViaCache || null,
    }));
  }, null);

  const storage = await safeAsync(async () => {
    const est = nav.storage && nav.storage.estimate ? await nav.storage.estimate() : null;
    return {
      quota: est ? est.quota : null,
      usage: est ? est.usage : null,
      persisted: nav.storage && nav.storage.persisted ? await nav.storage.persisted() : null,
      localStorageBytes: safe(() => {
        let n = 0;
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          n += (k || '').length + (localStorage.getItem(k) || '').length;
        }
        return n;
      }, null),
      localStorageWorks: safe(() => { localStorage.setItem('gamehub.__probe', '1'); localStorage.removeItem('gamehub.__probe'); return true; }, false),
    };
  }, null);

  const conn = safe(() => nav.connection || nav.mozConnection || nav.webkitConnection, null);
  const swCache = await serviceWorkerVersion();

  const env = {
    capturedAt: new Date().toISOString(),
    // --- what they are holding ---------------------------------------------------------------
    deviceLabel: deviceLabelFrom(uaData, ua),
    browserLabel: browserLabelFrom(uaData, ua),
    userAgent: ua,
    userAgentData: uaData,
    platform: safe(() => nav.platform, null),
    vendor: safe(() => nav.vendor, null),
    mobile: safe(() => (uaData && typeof uaData.mobile === 'boolean') ? uaData.mobile : /Mobi|Android|iPhone|iPad|iPod/i.test(ua), null),
    maxTouchPoints: safe(() => nav.maxTouchPoints, null),
    hardwareConcurrency: safe(() => nav.hardwareConcurrency, null),
    deviceMemoryGB: safe(() => nav.deviceMemory, null),
    // --- browser vs installed app (Matt's explicit ask) ---------------------------------------
    displayMode: displayModeOf(),
    iosStandalone: safe(() => (typeof nav.standalone === 'boolean' ? nav.standalone : null), null),
    installed: safe(() => window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true, null),
    a2hsDismissed: safe(() => localStorage.getItem('hub-a2hs-dismissed-v1') === '1', null),
    url: safe(() => location.href, null),
    referrer: safe(() => document.referrer || null, null),
    // --- screen / layout ----------------------------------------------------------------------
    screen: {
      width: safe(() => screen.width, null),
      height: safe(() => screen.height, null),
      availWidth: safe(() => screen.availWidth, null),
      availHeight: safe(() => screen.availHeight, null),
      colorDepth: safe(() => screen.colorDepth, null),
      dpr: safe(() => window.devicePixelRatio, null),
      orientation: safe(() => screen.orientation && screen.orientation.type, null),
      angle: safe(() => screen.orientation && screen.orientation.angle, null),
      viewportW: safe(() => window.innerWidth, null),
      viewportH: safe(() => window.innerHeight, null),
      visualViewportW: safe(() => window.visualViewport && Math.round(window.visualViewport.width), null),
      visualViewportH: safe(() => window.visualViewport && Math.round(window.visualViewport.height), null),
      visualViewportScale: safe(() => window.visualViewport && window.visualViewport.scale, null),
      safeAreaTop: safe(() => getComputedStyle(document.documentElement).getPropertyValue('--sat') || null, null),
    },
    // --- preferences that change what is on screen --------------------------------------------
    prefs: {
      lang: safe(() => localStorage.getItem('gamehub.lang.v1'), null),
      theme: safe(() => localStorage.getItem('gamehub.theme.v1'), null),
      darkClassOn: safe(() => document.documentElement.classList.contains('gh-dark'), null),
      prefersDark: safe(() => window.matchMedia('(prefers-color-scheme: dark)').matches, null),
      prefersReducedMotion: safe(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, null),
      browserLanguage: safe(() => nav.language, null),
      browserLanguages: safe(() => (nav.languages || []).slice(0, 5), null),
      timezone: safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone, null),
      timezoneOffsetMin: safe(() => new Date().getTimezoneOffset(), null),
      fontSizeAdjust: safe(() => parseFloat(getComputedStyle(document.documentElement).fontSize) || null, null),
    },
    // --- connection ---------------------------------------------------------------------------
    network: {
      online: safe(() => nav.onLine, null),
      effectiveType: conn ? safe(() => conn.effectiveType, null) : null,
      downlinkMbps: conn ? safe(() => conn.downlink, null) : null,
      rttMs: conn ? safe(() => conn.rtt, null) : null,
      saveData: conn ? safe(() => conn.saveData, null) : null,
      type: conn ? safe(() => conn.type, null) : null,
    },
    // --- the app itself -----------------------------------------------------------------------
    appVersion: safe(() => { const m = /game-hub-(v\d+)/.exec(swCache || ''); return m ? m[1] : null; }, null),
    serviceWorker: {
      supported: safe(() => 'serviceWorker' in nav, false),
      controlled: safe(() => !!(nav.serviceWorker && nav.serviceWorker.controller), false),
      activeCache: swCache,
      registrations: swRegs,
      cacheNames: await safeAsync(() => (typeof caches !== 'undefined' ? caches.keys() : null), null),
    },
    storage,
    gpu: gpuInfo(),
    performance: {
      jsHeapMB: safe(() => performance.memory && Math.round(performance.memory.usedJSHeapSize / 1048576), null),
      navigationType: safe(() => (performance.getEntriesByType('navigation')[0] || {}).type, null),
      pageAgeMs: safe(() => Math.round(performance.now()), null),
    },
    // --- what already went wrong on this device ------------------------------------------------
    recentErrors: safe(() => recentErrors(), []),
    syncHealth: safe(() => JSON.parse(localStorage.getItem('gamehub.syncHealth.v1') || 'null'), null),
  };
  return env;
}

// --- screenshots --------------------------------------------------------------------------------

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('could not read that image')); };
    img.src = url;
  });
}

/**
 * Downscale + re-encode a picked image so a 4 MB phone screenshot becomes something a report can
 * carry, stepping quality down until it fits MAX_SHOT_BYTES rather than refusing the file.
 * Returns { dataUrl, width, height, bytes, name, type, originalBytes }.
 */
export async function prepareScreenshot(file) {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_SHOT_EDGE / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  // A dark-mode screenshot re-encoded onto a transparent canvas renders black-on-black in some
  // viewers; painting the sheet white first keeps every shot readable.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  let dataUrl = '';
  for (const q of [0.78, 0.62, 0.48, 0.36]) {
    dataUrl = canvas.toDataURL('image/jpeg', q);
    if (dataUrl.length <= MAX_SHOT_BYTES) break;
  }
  if (dataUrl.length > MAX_SHOT_BYTES) throw new Error('that image is too large to send');
  return {
    dataUrl, width: w, height: h, bytes: dataUrl.length,
    name: String((file && file.name) || 'screenshot').slice(0, 80),
    type: (file && file.type) || '', originalBytes: (file && file.size) | 0,
  };
}

// --- building + sending -------------------------------------------------------------------------

/** Assemble the whole report. `shots` are prepareScreenshot() results; they ride separately on the
 *  wire (see submitBugReport) but are counted here so the record knows what belongs to it. */
export async function buildBugReport({ description, gameId, gameTitle, screenshots }) {
  const prof = loadProfile() || {};
  const shots = Array.isArray(screenshots) ? screenshots.slice(0, MAX_SHOTS) : [];
  const [environment, deviceReport] = await Promise.all([
    gatherEnvironment(),
    // The Device Details payload, verbatim: identity, every localStorage key this app has written,
    // sync health, the two Firebase conflict reads. Guarded - a failure here (offline, say) must
    // not stop the report, so the reason is recorded in its place.
    safeAsync(() => gatherDeviceReport(), null),
  ]);
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    createdAtMs: Date.now(),
    status: 'new',
    description: normalizeDescription(description),
    game: gameId || null,
    gameTitle: gameTitle || null,
    reporter: {
      name: (prof.name || '').trim(),
      emoji: prof.emoji || '',
      playerCode: prof.playerId || '',
      deviceId: safe(() => deviceId(), null),
      statsId: safe(() => statsId(), null),
    },
    appVersion: (environment && environment.appVersion) || null,
    summary: summarizeEnvironment(environment),
    shotCount: shots.length,
    shotBytes: shots.reduce((n, s) => n + ((s && s.bytes) | 0), 0),
    environment,
    deviceReport,
    deviceReportError: deviceReport ? null : 'could not be gathered on this device',
    _shots: shots,   // stripped before the write; see submitBugReport
  };
}

/**
 * Send it. The record goes to `bugReports/<pushId>`, the screenshots to `bugReportShots/<pushId>` -
 * a separate node so the inbox (and read-bug-reports.mjs) can list everything without pulling
 * megabytes of base64 it is not showing yet.
 *
 * Verified by a fresh re-read before claiming success, the same habit as stats-net.js: a resolved
 * promise is not proof the data landed, and a report that silently evaporates is the one bug
 * nobody can report. Returns { ok:true, id } or { ok:false, reason, retryable }.
 */
export async function submitBugReport(report) {
  const shots = (report && report._shots) || [];
  const record = Object.assign({}, report);
  delete record._shots;
  try {
    const boot = await getStatsApp();
    if (!boot) return { ok: false, reason: 'offline or Firebase unavailable', retryable: true };
    const { db, api } = boot;
    const ref = api.push(api.ref(db, 'bugReports'));
    const id = ref.key;
    record.id = id;
    await api.set(ref, record);
    const snap = await api.get(api.ref(db, 'bugReports/' + id + '/createdAtMs'));
    if (!snap || !snap.exists()) {
      console.error('[bug-report] write VERIFY FAILED for bugReports/' + id + ' - nothing landed.');
      return { ok: false, reason: 'the report did not land', retryable: true };
    }
    let shotsOk = true;
    if (shots.length) {
      try {
        const obj = {};
        shots.forEach((s, i) => {
          obj['s' + i] = { dataUrl: s.dataUrl, width: s.width, height: s.height, bytes: s.bytes, name: s.name };
        });
        await api.set(api.ref(db, 'bugReportShots/' + id), obj);
      } catch (err) {
        // The words are the report; the pictures are extra. Landing one without the other is worth
        // recording ON the report rather than failing the whole send or pretending it worked.
        shotsOk = false;
        console.error('[bug-report] screenshots failed to upload for ' + id, err);
        try { await api.update(api.ref(db, 'bugReports/' + id), { shotError: String((err && err.message) || err), shotCount: 0 }); }
        catch { /* already logged */ }
      }
    }
    return { ok: true, id, shotsOk };
  } catch (err) {
    console.error('[bug-report] send failed', err);
    return { ok: false, reason: String((err && err.message) || err), retryable: true };
  }
}

// --- offline outbox -------------------------------------------------------------------------------
// A bug is usually reported from the phone that was just having trouble, which is the phone most
// likely to be offline. So a failed send is KEPT and retried on the next hub load or reconnect
// (js/hub.js), rather than lost with an apology.

function readPending() {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed && parsed.reports) ? parsed.reports : [];
  } catch { return []; }
}
function writePending(reports) {
  localStorage.setItem(PENDING_KEY, JSON.stringify({ version: 1, reports: reports.slice(-MAX_PENDING) }));
}

/** How many reports are waiting to be sent from this device. */
export function pendingCount() { return readPending().length; }

/**
 * Keep a report that could not be sent. Screenshots are big and localStorage is small, so if the
 * whole thing will not fit, the TEXT is saved without them and `shotsDropped` is set - the UI says
 * so out loud rather than quietly dropping the pictures.
 * Returns { queued:true, shotsDropped } or { queued:false, reason }.
 */
export function queuePendingReport(report) {
  const list = readPending();
  const full = Object.assign({}, report);
  try {
    writePending(list.concat([full]));
    return { queued: true, shotsDropped: false };
  } catch { /* quota: fall through to the text-only attempt */ }
  const lean = Object.assign({}, report, { _shots: [], shotCount: 0, shotsDropped: true });
  try {
    writePending(list.concat([lean]));
    return { queued: true, shotsDropped: true };
  } catch (err) {
    console.error('[bug-report] could not save the report for later', err);
    return { queued: false, reason: String((err && err.message) || err) };
  }
}

/** Try every queued report. Sent ones are dropped from the queue; the rest stay for next time.
 *  Never throws; returns the number actually sent. */
export async function drainPendingReports() {
  const list = readPending();
  if (!list.length) return 0;
  const left = [];
  let sent = 0;
  for (const r of list) {
    const res = await submitBugReport(r);
    if (res.ok) sent++;
    else left.push(r);
  }
  try { writePending(left); }
  catch (err) { console.error('[bug-report] could not update the pending queue', err); }
  if (sent) console.info(`[bug-report] sent ${sent} report(s) that were waiting on this device.`);
  return sent;
}

// --- admin reads ----------------------------------------------------------------------------------

/** Every report, newest first. `{}`/[] when offline - never throws. Admin inbox only. */
export async function readBugReports() {
  try {
    const boot = await getStatsApp();
    if (!boot) return [];
    const { db, api } = boot;
    const snap = await api.get(api.ref(db, 'bugReports'));
    const val = (snap && snap.exists()) ? snap.val() : null;
    if (!val) return [];
    return sortReportsNewestFirst(Object.keys(val).map((k) => Object.assign({ id: k }, val[k])));
  } catch (err) {
    console.error('[bug-report] could not read the inbox', err);
    return [];
  }
}

/** The screenshots for one report, `[]` if it has none or they cannot be read. */
export async function readBugShots(id) {
  try {
    const boot = await getStatsApp();
    if (!boot || !id) return [];
    const { db, api } = boot;
    const snap = await api.get(api.ref(db, 'bugReportShots/' + id));
    const val = (snap && snap.exists()) ? snap.val() : null;
    if (!val) return [];
    return Object.keys(val).sort().map((k) => val[k]).filter(Boolean);
  } catch { return []; }
}

/** Admin triage: mark a report handled. Additive - it stamps a status, it never removes a report
 *  (a report Matt has read is still the only record of what that player saw). */
export async function setBugStatus(id, status) {
  try {
    const boot = await getStatsApp();
    if (!boot || !id) return false;
    const { db, api } = boot;
    await api.update(api.ref(db, 'bugReports/' + id), { status, statusAt: Date.now() });
    return true;
  } catch (err) { console.error('[bug-report] could not update status', err); return false; }
}

export default {
  gatherEnvironment, prepareScreenshot, buildBugReport, submitBugReport,
  queuePendingReport, drainPendingReports, pendingCount,
  readBugReports, readBugShots, setBugStatus,
  normalizeDescription, fitsShotBudget, summarizeEnvironment,
  sortReportsNewestFirst, countUnread,
};
