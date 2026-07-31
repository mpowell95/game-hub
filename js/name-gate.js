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
// a bare page that loads no hub chrome. Firebase is touched lazily and never blocks: offline, the
// name is accepted locally and claimed on a later sync, exactly as the hub's gate always behaved.

import { loadProfile, saveProfile, newPlayerCode, canonicalizeCode } from './profile-store.js';
import { statsOwner } from './game-stats.js';
import { usernameStatus, claimUsername, lookupCodeOwner, syncMyStats } from './stats-net.js';
import { getLang, setLang, makeT } from './i18n.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);

/** 'You' is profile-store's default for a blank name, so it is a placeholder, not an identity.
 *  Kept in step with players-agg.js's isPlaceholderName (same rule, no import: that module is
 *  headless/Node-safe and this one is DOM-only, so they stay independently loadable). */
const isPlaceholder = (n) => { const s = (typeof n === 'string' ? n : '').trim().toLowerCase(); return !s || s === 'you'; };

/** True when this device has a real profile name to record plays under. */
export function hasName() {
  try { return !isPlaceholder((loadProfile() || {}).name); } catch { return false; }
}

function ensureCss() {
  const href = new URL('../css/name-gate.css', import.meta.url).href;
  if (document.querySelector(`link[data-ng-css="1"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.setAttribute('data-ng-css', '1');
  document.head.appendChild(link);
}

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
    </div>`;
  document.body.appendChild(box);

  const q = (sel) => box.querySelector(sel);
  const nameIn = q('[data-role="ng-name"]');
  const codeIn = q('[data-role="ng-code"]');
  const msgEl = q('[data-role="ng-msg"]');
  const saveBtn = q('[data-role="ng-save"]');
  const linkBtn = q('[data-role="ng-link"]');
  const say = (s) => { msgEl.textContent = s || ''; };
  const busy = (on) => { saveBtn.disabled = on; linkBtn.disabled = on; };

  setTimeout(() => { try { nameIn.focus(); } catch { /* ignore */ } }, 60);

  const finish = () => {
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
    if (status === 'taken') { busy(false); say(t('hub_fr_msg_taken')); return; }
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
    say(t('hub_fr_msg_linking'));
    const cur = loadProfile() || {};
    // Adopt the player's existing name/emoji so this device joins as THEM. Without this the blank
    // name normalizes to 'You' and, being the newest device, would rename the whole player.
    let owner = null;
    try { owner = await lookupCodeOwner(code); } catch { owner = null; }
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
  });
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export default { requireName, hasName };
