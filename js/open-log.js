// js/open-log.js - EVERY APP OPEN, PER DEVICE (2026-11-25, Matt: "List his devices and the date/time of every login").
// Until today nothing kept when a device opened the hub: each device record holds only its LAST sync. Now each
// open of the hub (a page load) and each return to it after 5+ minutes away is a play-log entry:
//   playLog/<CODE>/<t>-<n> = { g: 'hub', e: 'open' | 'return', k: <device id>, w: 'app|tab <screen>', r: <build> }
// sent with the play log (js/play-log.js; admins and the reader key only). No new node or rule. Admin > person
// lists them (js/admin-ui.js "Opens"). A phone with no player code yet logs nothing (it has no log to go to).
import { appendPlayLog } from './play-log-queue.js';
import { deviceId } from './game-stats.js';
import { installState, appVersion } from './install-state.js';

const AWAY_MS = 5 * 60 * 1000;
let started = false;
let hiddenAt = 0;

function code() {
  try { const p = JSON.parse(localStorage.getItem('gamehub.profile') || 'null'); return String((p && p.playerId) || '').trim().toUpperCase(); } catch { return ''; }
}
async function note(e) {
  const c = code();
  if (!c) return;
  let w = '', r = '';
  try { const s = installState(); w = `${s.installed ? 'app' : 'tab'} ${s.screen ? `${s.screen.w}x${s.screen.h}` : ''}`.trim(); } catch { /* unknown */ }
  try { r = (await appVersion()) || ''; } catch { r = ''; }
  appendPlayLog(c, { g: 'hub', e, k: deviceId(), w: w.slice(0, 40), r: String(r).slice(0, 20) });
}

/** Log this open, then every return after AWAY_MS away. Safe to call more than once. */
export function startOpenLog() {
  if (started) return;
  started = true;
  note('open');
  try {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt >= AWAY_MS) note('return');
      hiddenAt = 0;
    });
  } catch { /* no document */ }
}

export default { startOpenLog };
