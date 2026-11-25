// js/claim-repair.js - "CHECK YOUR OTHER PHONE" FOR A PHONE THE SERVER DID NOT RECOGNISE (2026-11-25, the lock;
// Matt: "do it. build everything"). Since the lock, only the server writes msgAuth/<uid> (functions/claim.js t 'claim'):
// a phone gets its code back with its device key, as a brand-new player, or "That's me" inside a day. A phone with
// NONE of those (its sign-in was wiped and it never registered a key) is left with its profile but no claim: its
// messages read empty and its play log waits on the phone. js/messages.js marks it (CLAIM_NEEDED_KEY); this sheet,
// opened by js/hub.js after paint, asks the code's other phone for Allow exactly as the name screen does
// (js/signin-ask.js), and reloads once the server grants it.
//
// THE LAW: nothing here touches stats, the profile, a save or players/. Waiting, cancelling or a Deny leaves the phone
// exactly as it was; its history stays on the phone and syncs (players/ never needed the claim).
import { CLAIM_NEEDED_KEY } from './messages.js';
import { loadProfile } from './profile-store.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let _open = false;

/** The code this phone needs Allow for, or ''. */
export function claimNeeded() {
  try {
    const v = JSON.parse(localStorage.getItem(CLAIM_NEEDED_KEY) || 'null');
    const p = loadProfile() || {};
    return v && v.code && String(p.playerId || '').toUpperCase() === v.code ? v.code : '';
  } catch { return ''; }
}

/** Show the sheet if this phone needs Allow (after the hub's paint). Safe to call any time. */
export async function maybeShowClaimRepair() {
  const code = claimNeeded();
  if (!code || _open || typeof document === 'undefined') return;
  _open = true;
  const si = await import('./signin-ask.js');
  if (await si.confirmClaim(code)) { try { localStorage.removeItem(CLAIM_NEEDED_KEY); } catch { /* fine */ } _open = false; return; }
  const name = (loadProfile() || {}).name || '';
  const box = document.createElement('div');
  box.className = 'gh-claimfix';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.6);overscroll-behavior:contain';
  const card = 'background:var(--gh-surface,#1c2430);color:var(--gh-text,#f4f7fb);border-radius:18px;padding:24px 20px;max-width:360px;width:100%;text-align:center;font-size:17px;line-height:1.45;box-shadow:0 12px 40px rgba(0,0,0,.4)';
  const btn = 'min-height:48px;border-radius:12px;font-size:17px;font-weight:600;padding:0 18px;border:0;cursor:pointer;touch-action:manipulation';
  const paint = (title, sub, actions) => {
    box.innerHTML = `<div style="${card}"><h2 style="margin:0 0 8px;font-size:24px;line-height:1.2;text-wrap:balance">${esc(title)}</h2>`
      + (sub ? `<p style="margin:0 0 18px;font-size:17px">${esc(sub)}</p>` : '')
      + `<div style="display:flex;flex-direction:column;gap:10px">${actions}</div></div>`;
  };
  const close = () => { _open = false; try { box.remove(); } catch { /* gone */ } };
  document.body.appendChild(box);
  // WHO SAW IT (root CLAUDE.md: any new popup reports who saw it from day one): js/tips-log.js rides the players/
  // mirror, which needs no claim (the play log would wait for the very claim this sheet is fixing).
  import('./tips-log.js').then((m) => m.noteTipShown && m.noteTipShown('hub', 'claimfix')).catch(() => {});
  const ask = async () => {
    const r = await si.createRequest(code, { name, via: 'link' });
    if (!r.ok) {
      paint(si.tx('si_try_again', "Didn't send. Try again."), '', `<button type="button" data-a="again" style="${btn};background:#ffce3a;color:#111">${esc(si.tx('si_retry', 'Try again'))}</button><button type="button" data-a="later" style="${btn};background:transparent;color:inherit;border:2px solid currentColor">${esc(si.tx('si_cancel', 'Cancel'))}</button>`);
      return;
    }
    paint(si.tx('si_check_other', 'Check your other phone'), name,
      `<button type="button" data-a="report" style="${btn};background:transparent;color:inherit;border:2px solid currentColor">${esc(si.tx('si_report', 'Report to Matt'))}</button>`
      + `<button type="button" data-a="later" style="${btn};background:transparent;color:inherit;border:0;text-decoration:underline">${esc(si.tx('si_cancel', 'Cancel'))}</button>`);
    box.dataset.req = r.id;
    const un = await si.watchMine(code, r.id, async (req) => {
      if (!req) return;
      if (req.granted === true && await si.confirmClaim(code)) {
        try { un(); } catch { /* fine */ }
        try { localStorage.removeItem(CLAIM_NEEDED_KEY); } catch { /* fine */ }
        close();
        location.reload();
      } else if (req.state === 'denied' || req.state === 'lapsed') {
        try { un(); } catch { /* fine */ }
        paint(req.state === 'denied' ? si.tx('si_not_allowed', 'Not allowed') : si.tx('si_no_answer', 'No answer'), '',
          `<button type="button" data-a="later" style="${btn};background:#ffce3a;color:#111">OK</button>`);
      }
    });
  };
  box.addEventListener('click', async (e) => {
    const a = e.target && e.target.closest && e.target.closest('[data-a]');
    if (!a) return;
    const what = a.getAttribute('data-a');
    if (what === 'again') ask();
    else if (what === 'report') { a.disabled = true; const ok = await si.reportToMatt(name, code); a.disabled = false; a.textContent = ok ? si.tx('si_sent', 'Sent to Matt') : si.tx('si_not_sent', "Didn't send. Try again."); }
    else if (what === 'later') {
      if (box.dataset.req) { try { await si.cancelRequest(code, box.dataset.req); } catch { /* lapses by itself */ } }
      close();
    }
  });
  ask();
}

export default { claimNeeded, maybeShowClaimRepair };
