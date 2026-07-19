// keepsake.js - the hidden challenge's retirement (M3b). The gift is complete; the
// challenge no longer gates or interrupts anything (see hooks/challenge-ui/reveal, all
// now unimported dead weight kept in place, never deleted). What remains is this: a
// single read-only memento reusing exactly what the old reveal/finale screens rendered
// -- the earned codes, the assembled boarding-pass panels, the flight, and the selfie's
// approved code -- with no task list, no progress, no locks. Everything shows at once.
//
// Gated (by the caller, js/hub.js) to the recipient/tester profile OR Matt (isAdmin),
// the exact same identity checks the challenge already used. On the recipient's own
// device the record is local (loadChallenge()); on Matt's device it is pulled read-only
// from Firebase (no write, no local merge -- his own gamehub.challenge is not hers).

import { ensureChallengeCss } from './unlock.js';
import { loadChallenge } from './challenge-store.js';
import { isAdmin, isChallengeActive, codeFor } from './hooks.js';
import * as S from './secrets.js';
import * as net from './challenge-net.js';

const WIN_SLOTS = ['connect4', 'chinchon', 'business', 'parchis'];
const PIECE_TOTAL = 5;
const assetUrl = (file) => new URL('./assets/' + file, import.meta.url).href;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Same panel markup as challenge-ui.js's galleryHTML (kept independent on purpose --
 *  this module must keep working even if challenge-ui.js is ever deleted). */
function galleryHTML(order) {
  const n = (order || []).length;
  let out = '';
  for (let i = 0; i < PIECE_TOTAL; i++) {
    if (i >= n) {
      out += `<div class="ch-piece is-off"><span class="ch-piece-lock" aria-hidden="true">${i + 1}</span></div>`;
    } else if (i === PIECE_TOTAL - 1) {
      out += `<div class="ch-piece is-on ch-piece-5">`
        + `<img class="ch-piece-img" alt="" src="${assetUrl('reward-pt-5.png')}" onerror="this.remove()">`
        + `<img class="ch-piece-img ch-piece-5b" alt="" aria-hidden="true" src="${assetUrl('reward-pt-5b.png')}" onerror="this.remove()">`
        + `</div>`;
    } else {
      out += `<div class="ch-piece is-on"><img class="ch-piece-img" alt="" src="${assetUrl('reward-pt-' + (i + 1) + '.png')}" onerror="this.remove()"></div>`;
    }
  }
  return out;
}

/** Codes earned: one per recorded game win, plus the selfie once approved. Mirrors
 *  ChallengeUI.earnedCodes -- kept independent for the same reason as galleryHTML. */
function earnedCodes(st) {
  const out = [];
  for (const slot of WIN_SLOTS) if (st.wins && st.wins[slot]) out.push({ slot, code: codeFor(slot) });
  if (st.selfie && st.selfie.status === 'approved') out.push({ slot: 'selfie', code: codeFor('selfie') });
  return out;
}

/** Google Calendar template link, mirrors ChallengeUI.calendarUrl. */
function calendarUrl(flight) {
  const f = flight || {};
  const params = new URLSearchParams({ action: 'TEMPLATE' });
  params.set('text', [f.name, f.toCity].filter(Boolean).join(' in ') || 'Trip');
  const m = String(f.dates || '').match(/(\d{1,2})\s*\/\s*(\d{1,2})\D+?(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (m) {
    const now = new Date();
    let year = now.getFullYear();
    let start = new Date(year, +m[1] - 1, +m[2]);
    if (start.getTime() < now.getTime() - 2 * 864e5) { year += 1; start = new Date(year, +m[1] - 1, +m[2]); }
    const endYear = (+m[3] < +m[1]) ? year + 1 : year;
    const endExcl = new Date(endYear, +m[3] - 1, +m[4] + 1);
    const fmt = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    params.set('dates', `${fmt(start)}/${fmt(endExcl)}`);
  }
  if (f.toCity) params.set('location', f.toCity);
  const details = [
    [f.airline, f.flightNumbers].filter(Boolean).join(' '),
    (f.fromCity && f.toCity) ? `${f.fromCity} (${f.fromCode || ''}) to ${f.toCity} (${f.toCode || ''})` : '',
    f.dates ? `Dates: ${f.dates}` : '',
  ].filter(Boolean).join('\n');
  if (details) params.set('details', details);
  return 'https://calendar.google.com/calendar/render?' + params.toString();
}

/** The record to show: the recipient/tester's own local device record, or (for Matt,
 *  whose own device has no record of his own) a read-only pull of the real recipient's
 *  synced record. Never written back, never merged into local storage. */
async function resolveRecord(name) {
  if (isAdmin(name)) {
    net.setProgressKey(S.PROGRESS_KEY);
    const remote = await net.pull();
    return remote || null;
  }
  if (isChallengeActive(name)) return loadChallenge();
  return null;
}

function bodyHTML(st) {
  if (!st) {
    return `<p class="ch-hint">No record yet (offline, or nothing to show).</p>`;
  }
  const codes = earnedCodes(st);
  const order = st.order || [];
  const n = order.length;
  const complete = n >= PIECE_TOTAL;
  const codesHTML = codes.length
    ? `<ul class="ch-vault">${codes.map((c) => `<li class="ch-vault-item is-redeemed"><span class="ch-vault-code">${esc(c.code)}</span></li>`).join('')}</ul>`
    : `<p class="ch-hint">No codes recorded.</p>`;
  return `
    <section class="ch-card">
      <h2 class="ch-h2">Codes</h2>
      ${codesHTML}
    </section>
    <section class="ch-card">
      <h2 class="ch-h2">Boarding pass</h2>
      <div class="ch-gallery ch-finale-strip${complete ? ' ch-finale-pass' : ''}" data-role="pass">${galleryHTML(order)}</div>
      <p class="ch-finale-hint">${complete ? 'Complete.' : `${n} / ${PIECE_TOTAL} pieces.`}</p>
      <div data-role="cal-slot"></div>
    </section>`;
}

/** Open the keepsake overlay. `name` is the CURRENT profile's name (the caller already
 *  gated on isChallengeActive(name) || isAdmin(name) before offering the button). */
export async function showKeepsake(name) {
  ensureChallengeCss();
  const prev = document.querySelector('.ch-finale');
  if (prev) prev.remove();

  const host = document.createElement('div');
  host.className = 'ch-finale ch-finale-photo';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.setAttribute('aria-label', 'Challenge keepsake');
  host.innerHTML = `
    <div class="ch-unlock-scrim"></div>
    <div class="ch-finale-inner">
      <div class="ch-finale-stage" data-role="stage"><p class="ch-finale-printing">Loading&hellip;</p></div>
      <button type="button" class="ch-btn ch-btn-ghost ch-finale-close" data-role="fin-close">Close</button>
    </div>`;
  document.body.appendChild(host);
  requestAnimationFrame(() => host.classList.add('is-in'));
  const close = () => host.remove();
  host.querySelector('[data-role="fin-close"]').addEventListener('click', close);
  host.querySelector('.ch-unlock-scrim').addEventListener('click', close);

  const st = await resolveRecord(name);
  if (!host.isConnected) return;
  const stage = host.querySelector('[data-role="stage"]');
  if (!stage) return;
  stage.innerHTML = bodyHTML(st);

  const pass = stage.querySelector('[data-role="pass"]');
  if (pass) pass.addEventListener('click', () => zoomPass(st && st.order));

  // Best-effort "Add to Google Calendar" -- absent when Firebase is unreachable.
  if (st) {
    net.fetchFlight().then((flight) => {
      if (!flight || !stage.isConnected) return;
      const slot = stage.querySelector('[data-role="cal-slot"]');
      if (!slot) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ch-btn ch-btn-go ch-finale-cal';
      btn.textContent = 'Add to Google Calendar';
      btn.addEventListener('click', () => window.open(calendarUrl(flight), '_blank', 'noopener'));
      slot.appendChild(btn);
    }).catch(() => {});
  }
}

function zoomPass(order) {
  const z = document.createElement('div');
  z.className = 'ch-zoom';
  z.setAttribute('role', 'dialog');
  z.setAttribute('aria-label', 'Boarding pass, enlarged');
  z.innerHTML = `<div class="ch-gallery ch-zoom-pass">${galleryHTML(order)}</div>`;
  z.addEventListener('click', () => z.remove());
  document.body.appendChild(z);
  requestAnimationFrame(() => z.classList.add('is-in'));
}

export default { showKeepsake };
