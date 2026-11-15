// name-gate.js - the ONE "choose a name" gate, shared by every entry point into the hub.
//
// THE LAW applies (root CLAUDE.md): this file never deletes, moves or hides stored history. It only
// decides whether a device is allowed to start PLAYING before it has an identity to record under.
//
// Why it exists (2026-07-31): the gate used to live inline in js/hub.js (`initFirstRun`), so it only
// covered the hub. Every game also ships a standalone page (`<game>/index.html`, in sw.js's ASSETS
// and reachable by direct URL), and those had no gate at all - a device could play there for weeks,
// record real plays, and mirror them to players/<deviceId> with `profile.name: ''` (stats-net.js
// writes whatever the profile holds). That is where the "Unnamed player" rows on the leaderboard
// came from: one nameless device each, ungroupable forever (players-agg.js cannot prove two nameless
// devices are one person), and permanent. Matt: the app should not be playable without entering a
// name. So the gate moved here and every entry point calls it.
//
// Pairing (do not split these two changes): js/leaderboard-ui.js stops rendering nameless rows. That
// is only safe BECAUSE this gate covers every door - a nameless device can no longer accumulate
// plays, and the ones that already exist get named the next time their owner opens anything, at
// which point players-agg.js's identity graph relabels their existing history and it reappears on
// the board. Nothing is deleted and nothing stops syncing (a nameless record still mirrors, and its
// owner still sees every play of it on their own My Stats screen) - see THE LAW rule 1.
//
// Self-contained, like a game module: injects its own CSS, mounts into document.body, and works on
// a bare page that loads no hub chrome. A NEW name needs the registry check to SUCCEED online
// (2026-10-29): offline it used to be accepted and claimed later, so a phone with no signal could take
// "MattyIce" and merge into Matt's row. Offline, the gate says to connect and stays up (a first run
// is the only time it shows, and installing the app needs the network anyway).

import { loadProfile, saveProfile, newPlayerCode, canonicalizeCode,
  hasName, isPlaceholderName } from './profile-store.js';
import { statsOwner } from './game-stats.js';
import { usernameStatus, usernameOwner, claimUsername, lookupCodeOwner, syncMyStats } from './stats-net.js';
import { getLang, setLang, makeT } from './i18n.js';
import { liveNow, whenLive, serverNow } from './server-time.js';
import { refreshAdminConfig } from './admin-config.js';
import { thatsMeRoute, waitView } from './signin-rules.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);

// hasName()/isPlaceholderName moved to profile-store.js on 2026-09-01 and are re-exported here so
// every existing caller is unchanged. They moved because they were the ONLY reason js/hub.js
// imported this module at load, and this module's own graph pulls game-stats.js and stats-net.js -
// 100+ KB on the hub's critical path to answer a question the profile alone can answer. The gate
// itself is still imported here, dynamically, only when there is actually no name.
export { hasName, isPlaceholderName };
const isPlaceholder = isPlaceholderName;

function ensureCss() {
  const href = new URL('../css/name-gate.css', import.meta.url).href;
  if (document.querySelector(`link[data-ng-css="1"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.setAttribute('data-ng-css', '1');
  document.head.appendChild(link);
}

// How recent a claim of the typed name must be for "That's me" (one day: covers adding to the Home
// Screen right after the Safari tab's first run; older names still need their code). ME_WINDOW_MS now lives in
// js/signin-rules.js (same 24 hours), with thatsMeRoute, which keeps that rule for every code.
//
// ALLOW / DENY SIGN IN (2026-11-15, js/signin-ask.js; NOT cleared for players): for a code in the ask set only
// (js/admin-config.js resolveSigninAsk, test1's DREG5 by default), Link and "That's me" on a name older than
// 24 hours do NOT link here. They send a request and wait on "Check your other phone" until the code's other
// phone (or Matt) taps Allow; only then does the SAME linkTo below run. A name claimed in the last 24 hours
// still links at once, as before (Matt, 2026-11-15: an iPhone's Home Screen app is a new phone to the Safari tab
// that made the name, and that tab cannot get notifications). Every other code: byte-for-byte today's gate.
// Nothing here is written to the profile until the link is allowed, so a refused request changes nothing.

let _pending = null;   // the in-flight gate, so concurrent callers share ONE overlay

/**
 * Resolve once this device has a name. If it already has one this is a no-op (resolved promise, no
 * DOM touched), so callers can await it unconditionally on every mount.
 *
 * The overlay is deliberately undismissable: no close button, no scrim handler, no Escape. That is
 * the whole point - "not playable without entering a name" is only true if the gate cannot be
 * walked past. Callers should still `await` it rather than rendering behind it.
 */
export function requireName() {
  if (hasName()) return Promise.resolve();
  if (_pending) return _pending;
  _pending = new Promise((resolve) => { mountGate(() => { _pending = null; resolve(); }); });
  return _pending;
}

/** The gate's own light/dark signal, as a bare localStorage read of theme.js's key.
 *  NOT `import './theme.js'`: that module stamps `.gh-dark` on <html> as a load-time side effect,
 *  which on a standalone game page would newly activate that game's in-hub dark rules - a change
 *  well outside this gate's business. So the preference is read, never applied. 'auto' (or no
 *  preference at all, e.g. a device that has only ever played standalone) returns '' and the
 *  stylesheet's prefers-color-scheme query decides. */
function themeAttr() {
  try {
    const v = localStorage.getItem('gamehub.theme.v1');
    return (v === 'dark' || v === 'light') ? v : '';
  } catch { return ''; }
}

function mountGate(done) {
  ensureCss();
  const box = document.createElement('div');
  box.className = 'ng-root';
  const th = themeAttr();
  if (th) box.setAttribute('data-ng-theme', th);
  box.innerHTML = `
    <div class="ng-scrim"></div>
    <div class="ng-card" role="dialog" aria-modal="true" aria-label="${esc(t('hub_fr_dialog_aria'))}">
      <div class="ng-step" data-role="ng-step" hidden></div>
      <div data-role="ng-main">
      <h2 class="ng-h">${esc(t('hub_fr_title'))}</h2>
      <p class="ng-lead">${esc(t('hub_fr_lead'))}</p>
      <div class="ng-row ng-langrow" role="group" aria-label="${esc(t('hub_fr_langrow_aria'))}">
        <button type="button" class="ng-btn ng-btn-ghost" data-role="ng-lang" data-lang="en">English</button>
        <button type="button" class="ng-btn ng-btn-ghost" data-role="ng-lang" data-lang="es">Español</button>
      </div>
      <div class="ng-row">
        <input class="ng-input" data-role="ng-name" type="text" maxlength="20" placeholder="${esc(t('hub_fr_name_placeholder'))}" autocomplete="off">
        <button type="button" class="ng-btn ng-btn-primary" data-role="ng-save">${esc(t('hub_fr_save'))}</button>
      </div>
      <div class="ng-or">${esc(t('hub_fr_or'))}</div>
      <div class="ng-row">
        <input class="ng-input" data-role="ng-code" type="text" maxlength="5" placeholder="${esc(t('hub_fr_code_placeholder'))}"
               autocomplete="off" spellcheck="false" style="text-transform:uppercase;letter-spacing:.16em">
        <button type="button" class="ng-btn ng-btn-ghost" data-role="ng-link">${esc(t('hub_fr_link'))}</button>
      </div>
      <p class="ng-msg" data-role="ng-msg" role="status" aria-live="polite"></p>
      <div class="ng-row ng-me" data-role="ng-me-row" hidden>
        <button type="button" class="ng-btn ng-btn-primary" data-role="ng-me">${esc(t('hub_fr_me'))}</button>
      </div>
      </div>
    </div>
    <div class="ng-toast" data-role="ng-toast" role="status" aria-live="polite" hidden></div>`;
  document.body.appendChild(box);

  const q = (sel) => box.querySelector(sel);
  const nameIn = q('[data-role="ng-name"]');
  const codeIn = q('[data-role="ng-code"]');
  const msgEl = q('[data-role="ng-msg"]');
  const saveBtn = q('[data-role="ng-save"]');
  const linkBtn = q('[data-role="ng-link"]');
  const meRow = q('[data-role="ng-me-row"]');
  const meBtn = q('[data-role="ng-me"]');
  let meCode = '';   // the code "That's me" links to; set only by a recent claim of the typed name
  const stepEl = q('[data-role="ng-step"]');
  const mainEl = q('[data-role="ng-main"]');
  const toastEl = q('[data-role="ng-toast"]');
  // The config's ask set may have changed since this phone last read it: one read now, waited on (briefly)
  // only when a gated decision needs it (js/signin-ask.js needsAllow).
  try { refreshAdminConfig().catch(() => {}); } catch { /* cached */ }
  const say = (s) => { msgEl.textContent = s || ''; meRow.hidden = true; meCode = ''; };
  const busy = (on) => { saveBtn.disabled = on; linkBtn.disabled = on; meBtn.disabled = on; };

  setTimeout(() => { try { nameIn.focus(); } catch { /* ignore */ } }, 60);

  const finish = () => {
    stopWait();
    box.remove();
    // Mirror the new identity promptly so the leaderboard picks it up without waiting for the next
    // hub open. Best-effort by design: syncMyStats never throws and logs its own failures loudly.
    try { syncMyStats(); } catch (err) { console.error('[name-gate] stats sync could not start', err); }
    done();
  };

  // Language choice takes effect immediately (the rest of first run is already in the chosen
  // language) and needs no Save - carried over from the hub's gate, where it has always lived.
  // Each button is self-labeled in its own language, so this row never needs translating.
  const langBtns = Array.from(box.querySelectorAll('[data-role="ng-lang"]'));
  const paintLang = () => langBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === getLang())));
  paintLang();
  langBtns.forEach((b) => b.addEventListener('click', () => { setLang(b.dataset.lang); paintLang(); retitle(); }));

  // Re-render the gate's own copy in the newly chosen language (it is on screen while the choice is
  // made, so it must not stay in the language the player just switched away from).
  function retitle() {
    q('.ng-h').textContent = t('hub_fr_title');
    q('.ng-lead').textContent = t('hub_fr_lead');
    q('.ng-or').textContent = t('hub_fr_or');
    nameIn.placeholder = t('hub_fr_name_placeholder');
    codeIn.placeholder = t('hub_fr_code_placeholder');
    saveBtn.textContent = t('hub_fr_save');
    linkBtn.textContent = t('hub_fr_link');
    meBtn.textContent = t('hub_fr_me');
    q('.ng-card').setAttribute('aria-label', t('hub_fr_dialog_aria'));
    say('');
  }

  saveBtn.addEventListener('click', async () => {
    const name = (nameIn.value || '').trim();
    if (!name) { say(t('hub_fr_msg_enter_name')); return; }
    // 'You' is profile-store's blank-name default, so accepting it here would put a device back in
    // exactly the state this gate exists to prevent: recording plays under a placeholder.
    if (isPlaceholder(name)) { say(t('hub_fr_msg_placeholder_name')); return; }
    const cur = loadProfile() || {};
    // Which code this device records under (see game-stats.js's "WHOSE stats these are"):
    //   - the profile's own code, if it still has one;
    //   - else the code that already OWNS this device's stats, but ONLY when the name typed matches
    //     that owner's name. That is the same person setting themselves up again after losing their
    //     profile, and minting a fresh code would fork them away from their own history for no reason;
    //   - else a brand-new code. A different name is a different person, and giving them their own
    //     code is exactly what stops two people on one phone blending into one record.
    let owner = null;
    try { owner = statsOwner(); } catch { owner = null; }
    const sameAsOwner = !!(owner && (owner.name || '').trim().toLowerCase() === name.toLowerCase());
    const code = cur.playerId || (sameAsOwner ? owner.code : null) || newPlayerCode();
    busy(true);
    say(t('hub_fr_msg_checking'));
    let status = 'offline';
    try { status = await usernameStatus(name, code); } catch { status = 'offline'; }
    // Never save a name the registry has not checked (2026-10-29): "connect to choose a name".
    if (status !== 'free' && status !== 'mine' && status !== 'taken') { busy(false); say(t('hub_fr_msg_need_net')); return; }
    if (status === 'taken') {
      // Claimed in the last day: almost always this same person's Safari tab, and an iPhone's Home
      // Screen app cannot see it (Matt, 2026-10-25: nobody understands the codes). Offer "That's me"
      // instead of asking for a code they were never shown. Older claims still need the code.
      let claim = null;
      try { claim = await usernameOwner(name); } catch { claim = null; }
      // The claim's age by the SERVER's clock (2026-10-29): the phone's own clock set back made any old
      // claim look fresh, so "That's me" handed over any name's code. No server time = no offer.
      let now = liveNow();
      if (now == null) { try { now = await whenLive(2500); } catch { now = null; } }
      const age = claim && Number(claim.at) > 0 && now != null ? now - Number(claim.at) : -1;
      // thatsMeRoute (js/signin-rules.js): under 24 h = 'link', exactly today's rule for every code. Only an
      // older name of a code in the sign-in ask set asks for Allow (NOT cleared for players).
      let route = thatsMeRoute({ gated: false, ageMs: age });
      if (route === 'none' && claim && claim.code && await gatedFor(claim.code)) route = thatsMeRoute({ gated: true, ageMs: age });
      busy(false);
      if (route === 'link') {
        say(t('hub_fr_msg_is_you'));
        meCode = claim.code;
        meRow.hidden = false;
      } else if (route === 'ask') showTaken(name, claim.code);
      else say(t('hub_fr_msg_taken'));
      return;
    }
    saveProfile(Object.assign({}, cur, { name, playerId: code }));
    // The real previous name, not '' - the hardcoded empty string in the hub's old gate is what left
    // "natalia" reserved against Ana's code (js/CLAUDE.md, "The Ana/Natalia correction").
    // claimUsername only releases a previous name it can prove this code owned, so passing a stale
    // one is safe.
    try { claimUsername(name, code, cur.name || ''); } catch { /* best-effort */ }
    finish();
  });

  nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveBtn.click(); });
  codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') linkBtn.click(); });

  linkBtn.addEventListener('click', async () => {
    const code = canonicalizeCode(codeIn.value);
    if (!code) { say(t('hub_fr_msg_invalid_code')); return; }
    busy(true);
    const gated = await gatedFor(code);
    busy(false);
    if (gated) askLink(code);
    else linkTo(code, '');
  });

  // "That's me": link to the code that claimed the typed name in the last day. The typed name IS
  // that code's registered name, so it stands in if the owner's record has not synced yet.
  meBtn.addEventListener('click', () => {
    const code = meCode, name = (nameIn.value || '').trim();
    if (!code || !name) return;
    linkTo(code, name);
  });

  async function linkTo(code, knownName) {
    busy(true);
    say(t('hub_fr_msg_linking'));
    const cur = loadProfile() || {};
    // Adopt the player's existing name/emoji so this device joins as THEM. Without this the blank
    // name normalizes to 'You' and, being the newest device, would rename the whole player.
    let owner = null;
    try { owner = await lookupCodeOwner(code); } catch { owner = null; }
    if ((!owner || !owner.name) && knownName) owner = { name: knownName, emoji: '' };
    if (!owner || !owner.name) {
      // A code that resolves to nobody would leave this device named 'You' - still nameless by every
      // rule above, and back on the board as an "Unnamed player". Refuse it instead.
      busy(false);
      say(t('hub_fr_msg_code_unknown'));
      return;
    }
    const next = Object.assign({}, cur, { playerId: code, name: owner.name });
    if (owner.emoji) next.emoji = owner.emoji;
    saveProfile(next);
    finish();
  }

  // --- ALLOW / DENY SIGN IN (gated codes only; see the note at ME_WINDOW_MS above) ----------------------------
  let _si = null;                       // js/signin-ask.js, loaded only when a gated code needs it
  const si = async () => (_si = _si || await import('./signin-ask.js'));
  async function gatedFor(code) {
    try { return await (await si()).needsAllow(code); } catch { return false; }
  }
  const tl = (k, en, p) => { const v = t(k, p); return v && v !== k ? v : String(en).replace(/\{(\w+)\}/g, (m, x) => (p && p[x] != null ? p[x] : m)); };
  function showStep(html) {
    stepEl.innerHTML = html;
    stepEl.hidden = false;
    mainEl.hidden = true;
  }
  function backToMain() {
    stopWait();
    stepEl.hidden = true;
    stepEl.innerHTML = '';
    mainEl.hidden = false;
    busy(false);
    say('');
  }
  function toast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toastEl.hidden = true; }, 2600);
  }
  const onStep = (role, fn) => { const b = stepEl.querySelector(`[data-role="${role}"]`); if (b) b.addEventListener('click', fn); };

  // Screen 2: "<name> is taken" / Pick another, That's me.
  function showTaken(name, code) {
    showStep(`<h2 class="ng-sh">${esc(tl('si_taken', '{name} is taken', { name }))}</h2>
      <div class="ng-row ng-wide"><button type="button" class="ng-btn ng-btn-ghost" data-role="ng-other">${esc(tl('si_pick_another', 'Pick another'))}</button>
      <button type="button" class="ng-btn ng-btn-primary" data-role="ng-ask-me">${esc(t('hub_fr_me'))}</button></div>`);
    onStep('ng-other', () => { backToMain(); nameIn.value = ''; try { nameIn.focus(); } catch { /* ignore */ } });
    onStep('ng-ask-me', () => ask(code, name, '', 'thatsme'));
  }

  // Link with a gated code: whose code it is (the same lookup linkTo makes), then ask.
  async function askLink(code) {
    busy(true);
    say(t('hub_fr_msg_linking'));
    let owner = null;
    try { owner = await lookupCodeOwner(code); } catch { owner = null; }
    if (!owner || !owner.name) { busy(false); say(t('hub_fr_msg_code_unknown')); return; }
    ask(code, owner.name, owner.emoji || '', 'link');
  }

  async function ask(code, name, emoji, via) {
    busy(true);
    const m = await si();
    const r = await m.createRequest(code, { name, via });
    if (!r.ok) { backToMain(); say(t('hub_fr_msg_need_net')); return; }
    const w = { code, id: r.id, name, emoji, via, t: Date.now() };
    m.saveWait(w);
    showWait(w);
  }

  // Screen 3 (+4): "Check your other phone", spinner, "No other phone? Report to Matt", Cancel.
  let _unwatch = null, _tick = null, _done = false;
  function stopWait() {
    if (_unwatch) { try { _unwatch(); } catch { /* fine */ } _unwatch = null; }
    clearInterval(_tick); _tick = null;
  }
  async function showWait(w) {
    const m = await si();
    _done = false;
    showStep(`<h2 class="ng-sh">${esc(tl('si_check_other', 'Check your other phone'))}</h2>
      <div class="ng-wait"><div class="ng-spin" aria-hidden="true"></div></div>
      <p class="ng-sl"><span class="ng-q">${esc(tl('si_no_other', 'No other phone?'))}</span> <button type="button" class="ng-lnk" data-role="ng-report">${esc(tl('si_report', 'Report to Matt'))}</button></p>
      <div class="ng-row ng-wide"><button type="button" class="ng-btn ng-btn-ghost" data-role="ng-cancel">${esc(tl('si_cancel', 'Cancel'))}</button></div>`);
    onStep('ng-cancel', async (e) => {
      e.currentTarget.disabled = true;
      _done = true;
      await m.cancelRequest(w.code, w.id);
      m.clearWait();
      backToMain();
    });
    onStep('ng-report', async (e) => {
      const b = e.currentTarget;
      if (b.disabled) return;
      b.disabled = true;
      const ok = await m.reportToMatt(w.name, w.code);
      b.disabled = false;
      toast(ok ? tl('si_sent', 'Sent to Matt') : tl('si_not_sent', "Didn't send. Try again."));
    });
    let last = null;
    const judge = async () => {
      if (_done || !last) return;
      const now = liveNow() != null ? liveNow() : serverNow();
      const v = waitView(last, now);
      if (v === 'wait') return;
      _done = true;
      if (v === 'in') {
        // THE LAW rule 6: the server's grant is proven by a fresh read of this phone's own claim first
        // (not there yet: keep watching; the 15 s tick asks again).
        if (!(await m.confirmClaim(w.code))) { _done = false; return; }
        stopWait();
        m.clearWait();
        backToMain();
        await linkTo(w.code, w.name);
        if (!box.isConnected) signedInToast(tl('si_signed_in', 'Signed in as {name}', { name: (loadProfile() || {}).name || w.name }));
        return;
      }
      stopWait();
      m.clearWait();
      if (v === 'cancelled') { backToMain(); return; }
      showEnd(v === 'denied' ? tl('si_not_allowed', 'Not allowed') : tl('si_no_answer', 'No answer'));
    };
    _unwatch = await m.watchMine(w.code, w.id, (req) => { last = req; judge(); });
    _tick = setInterval(judge, 15000);
  }

  // Screens 8: "Not allowed" (or "No answer" after 10 minutes) / OK, back to Choose a name.
  function showEnd(title) {
    showStep(`<h2 class="ng-sh">${esc(title)}</h2>
      <div class="ng-row ng-wide"><button type="button" class="ng-btn ng-btn-primary" data-role="ng-ok">OK</button></div>`);
    onStep('ng-ok', () => backToMain());
  }

  // A wait the app was closed in the middle of carries on where it was.
  si().then((m) => { const w = m.readWait(); if (w && box.isConnected) showWait(w); }).catch(() => {});
  _testHooks = { showTaken, showWait, showEnd, toast };
}

// TEST SEAM (tools only, the screens check): the open gate's screens, drawn without a network.
let _testHooks = null;
export function __gateScreensForTest() { return _testHooks; }

/** "Signed in as <name>" over the page the gate just left. */
function signedInToast(text) {
  try {
    const el = document.createElement('div');
    el.className = 'ng-root-toast';
    el.setAttribute('role', 'status');
    el.textContent = text;
    el.style.cssText = 'position:fixed;left:50%;bottom:calc(60px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:2147483000;'
      + 'padding:14px 22px;border-radius:999px;background:#f2f6fb;color:#14202f;font:800 18px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;'
      + 'white-space:nowrap;box-shadow:0 8px 30px rgba(0,0,0,.35);pointer-events:none';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  } catch { /* a nicety */ }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export default { requireName, hasName };
