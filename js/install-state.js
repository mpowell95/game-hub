// install-state.js - "is this device running the installed app, or a browser tab?"
//
// Tiny, dependency-free, and DOM-only on purpose: js/stats-net.js mirrors it to
// `players/<id>/device` on every hub load, and js/bug-report.js puts it in every report. Those two
// must not import each other (device-report.js already imports stats-net, so the graph would go
// circular), and neither should have its own copy of the answer - a second copy is a second answer.
//
// THE LAW (root CLAUDE.md): reads only. No storage key, no stats, nothing written from here.
//
// WHY IT EXISTS (2026-08-11). Matt found out that Ana had been playing in a Safari tab for two
// months: she dismissed the add-to-home-screen sheet early on and nothing ever asked again, and
// nothing anywhere recorded that she had. Every game in this hub is built for the installed route
// (full-bleed chrome, the service worker, offline play), so "which route is this person on" is a
// real diagnostic, and until now it was invisible unless somebody happened to file a bug report.

/** Standard PWA display modes, most specific first. `browser` is the ordinary tab. */
const MODES = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay', 'browser'];

const safe = (fn, fallback = null) => { try { const v = fn(); return v === undefined ? fallback : v; } catch { return fallback; } };

/** Which display mode this page is in, or null when it cannot be determined. */
export function displayMode() {
  for (const m of MODES) {
    if (safe(() => window.matchMedia(`(display-mode: ${m})`).matches, false)) return m;
  }
  return null;
}

/**
 * True when this page is the installed app.
 *
 * Both checks matter: `display-mode: standalone` is the standard, and `navigator.standalone` is
 * iOS Safari's own flag, which predates it. An iPhone added to the home screen reports the second
 * and, depending on version, not always the first - so checking only the media query would file
 * half the family's phones as "browser" and send Matt chasing a problem that isn't there.
 */
export function isInstalled() {
  return safe(() => window.matchMedia('(display-mode: standalone)').matches
    || navigator.standalone === true, null);
}

/** Browser + version, best effort: UA-Client-Hints where offered, UA-string patterns otherwise. */
export function browserLabel() {
  const uaData = safe(() => navigator.userAgentData, null);
  const brands = (uaData && (uaData.fullVersionList || uaData.brands)) || [];
  const real = brands.find((b) => b && b.brand && !/Not.?A.?Brand/i.test(b.brand) && !/Chromium/i.test(b.brand))
    || brands.find((b) => b && b.brand && !/Not.?A.?Brand/i.test(b.brand));
  if (real) return `${real.brand} ${real.version || ''}`.trim();
  const ua = safe(() => navigator.userAgent, '') || '';
  const pat = [
    [/CriOS\/([\d.]+)/, 'Chrome iOS'], [/FxiOS\/([\d.]+)/, 'Firefox iOS'], [/EdgiOS\/([\d.]+)/, 'Edge iOS'],
    [/Edg\/([\d.]+)/, 'Edge'], [/OPR\/([\d.]+)/, 'Opera'], [/SamsungBrowser\/([\d.]+)/, 'Samsung Internet'],
    [/Firefox\/([\d.]+)/, 'Firefox'], [/Chrome\/([\d.]+)/, 'Chrome'], [/Version\/([\d.]+).*Safari/, 'Safari'],
  ];
  for (const [re, name] of pat) { const m = re.exec(ua); if (m) return `${name} ${m[1]}`; }
  return null;
}

/** A short human label for the phone. UA-CH gives a real model on Android; iOS gives "iPhone",
 *  which is itself the useful answer. */
export function deviceLabel() {
  const ua = safe(() => navigator.userAgent, '') || '';
  const uaData = safe(() => navigator.userAgentData, null);
  const platform = (uaData && uaData.platform) || '';
  const m = /\((iPhone|iPad|iPod)[^)]*OS (\d+[_\d]*)/.exec(ua);
  if (m) return `${m[1]} · iOS ${m[2].replace(/_/g, '.')}`;
  const a = /\(Linux; Android ([\d.]+)(?:; ([^)]+?))?(?: Build|\))/.exec(ua);
  if (a) return `${a[2] || 'Android device'} · Android ${a[1]}`;
  return platform || null;
}

/**
 * The cache name the ACTIVE service worker is serving ('game-hub-v294'), or null when there is no
 * controller yet. Lives here rather than in js/bug-report.js (where it started) so the sync and a
 * report cannot report different builds for the same device.
 *
 * Never rejects and never hangs: a worker that does not answer within 1.5s resolves null, because
 * this rides the stats sync and a diagnostic must not be able to delay it.
 */
export function swCacheName() {
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

/** That cache name as the short build label the version pill shows ('v294'), or null. */
export async function appVersion() {
  const m = /game-hub-(v\d+)/.exec((await swCacheName()) || '');
  return m ? m[1] : null;
}

/**
 * The whole picture in one small object, safe to mirror on every sync:
 * `{ installed, mode, browser, device, a2hsDismissed }`. Never throws; unknown fields are null.
 *
 * `a2hsDismissed` is the tell for Ana's exact case: someone who was ASKED to install and said no,
 * as opposed to someone who was never asked.
 */
export function installState() {
  return {
    installed: isInstalled(),
    mode: displayMode(),
    browser: browserLabel(),
    device: deviceLabel(),
    a2hsDismissed: safe(() => localStorage.getItem('hub-a2hs-dismissed-v1') === '1', null),
  };
}

export default { installState, isInstalled, displayMode, browserLabel, deviceLabel, swCacheName, appVersion };
