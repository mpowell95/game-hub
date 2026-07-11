// challenge-ui.js - the hidden "Challenge Area" mounted as an in-hub module. Same
// init(container)/destroy() contract as the games. It reads the profile and branches:
//   the challenge profile -> the Challenge Area (question gate, codes, pieces, finale)
//   the admin profile     -> Mission Control (admin; PIN gate, dashboard, selfie review)
//
// Inert for everyone else: the hub only ever mounts this when the name matches, and
// every Firebase call routes through challenge-net.js, which no-ops until the shared
// firebase-config.js holds real values. So the whole area works offline and local-first.

import { loadProfile } from '../profile-store.js';
import { ensureChallengeCss, playUnlock } from './unlock.js';
import * as S from './secrets.js';
import {
  loadChallenge, redeemSlot, unlockArea, unlockAdmin, markUnlockSeen, setSelfie,
  remoteView, mergeRemote,
} from './challenge-store.js';
import { isAdmin, progressKeyFor, checkAnswer, checkPin, codeFor, slotForCode } from './hooks.js';
import * as net from './challenge-net.js';

const WIN_SLOTS = ['connect4', 'chinchon', 'business', 'parchis'];
const PIECE_TOTAL = 5;

// Asset URLs resolve relative to THIS module, so they work in the hub and standalone.
const assetUrl = (file) => new URL('./assets/' + file, import.meta.url).href;

// Per-slot redemption celebration: the image shown big when THAT code is redeemed,
// plus a riff on the code phrase. Filenames are not secret; the code phrases are (obf).
// NOTE: keep each line from containing its code phrase verbatim (codes stay un-greppable).
const CELE = {
  connect4: { asset: 'simpsonsskeeball.gif', line: "Beginner's luck? Never heard of it." },
  chinchon: { asset: 'lovely.png', line: 'Matty is, it must be said, too lovely.' },
  business: { asset: 'franco.jpg', line: 'Franco was, historically, problematic.' },
  parchis: { asset: 'america-hell-yeah.gif', line: 'America. Forever. (Well, for the holidays.)' },
  selfie: { asset: 'chet.gif', line: 'hmmmm. Success.' },
};
// Shown the moment she answers the personal question correctly (not tied to a code).
const ANSWER_ASSET = 'sexy-potato.png';

// Escalating selfie-rejection lines, fixed order. Mission Control picks by how many
// times this agent has already been rejected (1st, 2nd, 3rd, then 4th-and-after).
const REJECT_LINES = [
  'Better luck next time!',
  '\u{1F62C} oh no....',
  'uhh.... should I have built a how-to-play section..?',
  'Come on! You got this!!',
];

// Flight-editor fields (Mission Control). These map 1:1 onto the boarding pass.
const FLIGHT_FIELDS = [
  ['airline', 'Airline'], ['fromCode', 'From (code)'], ['fromCity', 'From (city)'],
  ['toCode', 'To (code)'], ['toCity', 'To (city)'], ['name', 'Passenger'],
  ['dates', 'Dates'], ['flightNumbers', 'Flight number(s)'], ['message', 'Message from Matt'],
];

class ChallengeUI {
  constructor(container) {
    this.container = container;
    ensureChallengeCss();
    const prof = loadProfile();
    this.name = (prof && prof.name) || '';
    this._onClick = (e) => this.onClick(e);
    this._onSubmit = (e) => this.onSubmit(e);
    this._onChange = (e) => this.onChange(e);
    this.admin = isAdmin(this.name);
    this._pinOk = this.admin && loadChallenge().adminUnlocked === true;   // persisted: enter PIN once per device
    this._pendingSelfie = null;   // compressed data URL awaiting submit
    this._progressUnsub = null;   // Ana's live sync listener
    this._adminUnsubs = [];       // Mission Control listeners
    this._adminLiveStarted = false;
    this._dashAll = {};           // latest all-personas records (admin: dashboard + reject counts)
    this._destroyed = false;
    this.render();
    if (!this.admin) {
      net.setProgressKey(progressKeyFor(this.name));   // isolate this persona (recipient or tester)
      this.startSync();                                // pull + live-sync progress (no-op offline)
    }
  }

  // --- routing -----------------------------------------------------------------
  render() {
    const st = loadChallenge();
    if (this.admin) return this.renderAdmin(st);
    if (!st.areaUnlocked) return this.renderQuestionGate();
    return this.renderArea(st);
  }

  mount(html) {
    this.container.innerHTML = `<div class="ch-root">${html}</div>`;
    const root = this.container.querySelector('.ch-root');
    root.addEventListener('click', this._onClick);
    root.addEventListener('submit', this._onSubmit);
    root.addEventListener('change', this._onChange);
    this.root = root;
  }

  // --- personal-question gate --------------------------------------------------
  renderQuestionGate() {
    this.mount(`
      <header class="ch-head"><h1 class="ch-title">Okay, prove it's you</h1></header>
      <section class="ch-card">
        <p class="ch-lead">One question only the real ${esc(this.name)} would get right.</p>
        <form data-role="answer-form" class="ch-form">
          <label class="ch-label" for="ch-answer">${esc(S.QUESTION)}</label>
          <input class="ch-input" id="ch-answer" name="answer" type="text" autocomplete="off" placeholder="Your answer">
          <button type="submit" class="ch-btn ch-btn-go">Enter</button>
          <p class="ch-msg" data-role="answer-msg" role="status" aria-live="polite"></p>
        </form>
      </section>`);
  }

  // --- the Challenge Area -------------------------------------------------------
  renderArea(st) {
    const pieces = st.order.length;
    const earned = this.earnedCodes(st);
    this.mount(`
      <header class="ch-head">
        <h1 class="ch-title">Operation ${esc(this.name)}</h1>
        <button type="button" class="ch-btn ch-btn-ghost" data-role="replay">Replay intro</button>
      </header>

      <section class="ch-card">
        <h2 class="ch-h2">Here's the deal</h2>
        <p class="ch-lead">Five codes, five pieces. Win four by beating each game under my (admittedly ridiculous)
          conditions, and earn the fifth by sending me a selfie I approve. Type each code in below. Get all five
          pieces and you can put the thing together.</p>
      </section>

      <section class="ch-card">
        <h2 class="ch-h2">Enter a code</h2>
        <form data-role="code-form" class="ch-form ch-form-row">
          <input class="ch-input" id="ch-code" name="code" type="text" autocomplete="off"
                 placeholder="Type a secret code" spellcheck="false">
          <button type="submit" class="ch-btn ch-btn-go">Redeem</button>
        </form>
        <p class="ch-msg" data-role="code-msg" role="status" aria-live="polite"></p>
      </section>

      ${this.selfieCardHTML(st)}

      <section class="ch-card">
        <h2 class="ch-h2">Your codes vault</h2>
        ${earned.length
          ? `<ul class="ch-vault">${earned.map((e) => `
              <li class="ch-vault-item ${st.redeemed[e.slot] ? 'is-redeemed' : ''}">
                <span class="ch-vault-code">${esc(e.code)}</span>
                <span class="ch-vault-tag">${e.redeemed ? 'redeemed' : 'earned, enter it above'}</span>
              </li>`).join('')}</ul>`
          : `<p class="ch-hint">Codes you earn from wins and your approved selfie show up here, so you can never
              really lose one. Nothing yet. Go win something.</p>`}
      </section>

      <section class="ch-card">
        <h2 class="ch-h2">The pass, in pieces <span class="ch-count">${pieces} / ${PIECE_TOTAL}</span></h2>
        <div class="ch-gallery" data-role="gallery">
          ${this.galleryHTML(st)}
        </div>
        <button type="button" class="ch-btn ch-btn-finale" data-role="assemble" ${pieces >= PIECE_TOTAL ? '' : 'disabled'}>
          ${pieces >= PIECE_TOTAL ? 'Assemble the pass' : `Assemble the pass (${PIECE_TOTAL - pieces} to go)`}
        </button>
      </section>`);
  }

  // --- selfie mission (capture -> compress -> submit -> live verdict) -----------
  selfieCardHTML(st) {
    const s = st.selfie;
    let inner;
    if (s.status === 'approved') {
      inner = `<p class="ch-msg is-ok">I approved your selfie.</p>
        <p class="ch-hint">Your selfie code is now in the vault below. Type it in above to claim your piece.</p>`;
    } else if (s.status === 'pending') {
      inner = `<p class="ch-lead">Selfie sent. I'm looking at it with great seriousness.</p>
        <p class="ch-hint" data-role="selfie-live">Waiting on me. This updates on its own.</p>`;
    } else {
      const rejected = s.status === 'rejected';
      const capture = this._pendingSelfie
        ? `<img class="ch-selfie-preview" alt="Your selfie preview" src="${esc(this._pendingSelfie)}">
           <div class="ch-selfie-actions">
             <button type="button" class="ch-btn ch-btn-go" data-role="selfie-submit">Send it to me</button>
             <label class="ch-btn ch-btn-ghost ch-file-btn">Retake
               <input class="ch-file-input" data-role="selfie-file" type="file" accept="image/*" capture="user"></label>
           </div>`
        : `<label class="ch-btn ch-btn-go ch-file-btn">Take your selfie
             <input class="ch-file-input" data-role="selfie-file" type="file" accept="image/*" capture="user"></label>`;
      inner = `${rejected ? `<p class="ch-msg is-bad">${esc(s.reason || 'Nope, again.')}</p>` : ''}
        <p class="ch-lead">Take a selfie. Front camera, maximum drama. I have to approve it before the fifth
          code is yours.</p>
        ${capture}
        <p class="ch-msg" data-role="selfie-msg" role="status" aria-live="polite"></p>`;
    }
    return `<section class="ch-card"><h2 class="ch-h2">The selfie</h2>${inner}</section>`;
  }

  galleryHTML(st) {
    // Each earned piece is a teaser fragment of the boarding-pass finale. PIECE_ORDER
    // ids without art fall back to a numbered tile (placeholders reward-pt-1..5).
    const FRAG = {
      corner: '<span class="ch-frag ch-frag-corner"></span>',
      barcode: '<span class="ch-frag ch-frag-bars"></span>',
      route: '<span class="ch-frag ch-frag-route">&middot;&middot;&middot; &#10230; ?</span>',
      seat: '<span class="ch-frag ch-frag-seat">SEAT<br>&middot;&middot;</span>',
      stamp: '<span class="ch-frag ch-frag-stamp">VISA</span>',
    };
    let out = '';
    for (let i = 0; i < PIECE_TOTAL; i++) {
      const fragment = st.order.length > i ? S.PIECE_ORDER[i] : null;
      out += fragment
        ? `<div class="ch-piece is-on" data-fragment="${esc(fragment)}">${FRAG[fragment] || `<span class="ch-piece-mark">${i + 1}</span>`}</div>`
        : `<div class="ch-piece is-off"><span class="ch-piece-lock" aria-hidden="true">?</span></div>`;
    }
    return out;
  }

  // --- Finale: the animated boarding pass -------------------------------------
  showFinale() {
    if (loadChallenge().order.length < PIECE_TOTAL) return;
    const host = document.createElement('div');
    host.className = 'ch-finale';
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-label', 'Your boarding pass');
    host.innerHTML = `
      <div class="ch-unlock-scrim"></div>
      <div class="ch-finale-inner">
        <div class="ch-finale-stage" data-role="stage"></div>
        <button type="button" class="ch-btn ch-btn-ghost ch-finale-close" data-role="fin-close">Close</button>
      </div>`;
    document.body.appendChild(host);
    requestAnimationFrame(() => host.classList.add('is-in'));
    host.querySelector('[data-role="fin-close"]').addEventListener('click', () => host.remove());
    host.querySelector('.ch-unlock-scrim').addEventListener('click', () => host.remove());
    const stage = host.querySelector('[data-role="stage"]');
    const attempt = () => {
      stage.innerHTML = '<p class="ch-finale-printing">Printing your pass<span class="ch-dots"><i>.</i><i>.</i><i>.</i></span></p>';
      this.loadFlight().then((flight) => {
        if (flight) { this.renderPass(stage, flight); return; }
        stage.innerHTML = `<p class="ch-finale-printing">The pass is printing<span class="ch-dots"><i>.</i><i>.</i><i>.</i></span></p>
          <p class="ch-hint">The airline is being dramatic (the flight details are not ready yet). Try again in a moment.</p>
          <button type="button" class="ch-btn ch-btn-go" data-role="fin-retry">Try again</button>`;
        const r = stage.querySelector('[data-role="fin-retry"]'); if (r) r.addEventListener('click', attempt);
      }).catch(() => {
        stage.innerHTML = `<p class="ch-finale-printing">The printer jammed. Very dramatic.</p>
          <button type="button" class="ch-btn ch-btn-go" data-role="fin-retry">Try again</button>`;
        const r = stage.querySelector('[data-role="fin-retry"]'); if (r) r.addEventListener('click', attempt);
      });
    };
    setTimeout(attempt, 850); // a beat of drama before it prints
  }

  /** Flight data source: a test injection (window.__chFlight), else the Firebase
   *  flight node via challenge-net (null when unconfigured -> the printing fallback). */
  async loadFlight() {
    try {
      if (window.__chFlight) return window.__chFlight;
      return await net.fetchFlight();
    } catch { return null; }
  }

  renderPass(stage, f) {
    const g = (v, fb) => esc(v != null && v !== '' ? v : fb);
    stage.innerHTML = `
      <div class="ch-pass">
        <div class="ch-pass-head">
          <span class="ch-pass-airline">&#9992; ${g(f.airline, 'Anita Air')}</span>
          <span class="ch-pass-tag">Boarding Pass</span>
        </div>
        <div class="ch-pass-route ch-anim" style="--d:1">
          <div class="ch-pass-end"><span class="ch-pass-code">${g(f.fromCode, 'MAD')}</span><span class="ch-pass-city">${g(f.fromCity, 'Madrid')}</span></div>
          <span class="ch-pass-plane" aria-hidden="true">&#9992;</span>
          <div class="ch-pass-end"><span class="ch-pass-code">${g(f.toCode, '???')}</span><span class="ch-pass-city">${g(f.toCity, 'Somewhere')}</span></div>
        </div>
        <div class="ch-pass-grid">
          <div class="ch-pass-cell ch-anim" style="--d:2"><label>Passenger</label><span>${g(f.name, this.name || 'Passenger')}</span></div>
          <div class="ch-pass-cell ch-anim" style="--d:3"><label>Dates</label><span>${g(f.dates, 'To be revealed')}</span></div>
          <div class="ch-pass-cell ch-anim" style="--d:4"><label>Flight</label><span>${g(f.flightNumbers, '--')}</span></div>
        </div>
        <div class="ch-pass-msg ch-anim" style="--d:5">${g(f.message, 'See you very soon.')}</div>
        <div class="ch-pass-barcode ch-anim" style="--d:6" aria-hidden="true"></div>
      </div>
      <p class="ch-finale-tada ch-anim" style="--d:7">He is coming to Spain.</p>`;
  }

  /** Codes to show in the vault: one per recorded win, plus the selfie code if approved. */
  earnedCodes(st) {
    const out = [];
    for (const slot of WIN_SLOTS) if (st.wins[slot]) out.push({ slot, code: codeFor(slot), redeemed: !!st.redeemed[slot] });
    if (st.selfie.status === 'approved') out.push({ slot: 'selfie', code: codeFor('selfie'), redeemed: !!st.redeemed.selfie });
    return out;
  }

  // --- celebration overlay (asset image) --------------------------------------
  /** Full-screen celebration with a big image. Used on answer-correct and on each
   *  code redemption. The image degrades gracefully (hidden) if not yet cached offline. */
  showCelebration({ kicker, title, asset, note }) {
    const host = document.createElement('div');
    host.className = 'ch-cele';
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-label', title || 'Celebration');
    host.innerHTML = `
      <div class="ch-unlock-scrim"></div>
      <div class="ch-cele-card">
        ${kicker ? `<p class="ch-unlock-kicker">${esc(kicker)}</p>` : ''}
        <h2 class="ch-cele-title">${esc(title || '')}</h2>
        <div class="ch-cele-media"><img class="ch-cele-img" alt="" src="${esc(asset)}"></div>
        ${note ? `<p class="ch-cele-note">${esc(note)}</p>` : ''}
        <button type="button" class="ch-btn ch-btn-go" data-role="cele-close">Nice</button>
      </div>`;
    document.body.appendChild(host);
    const img = host.querySelector('.ch-cele-img');
    img.addEventListener('error', () => { img.style.display = 'none'; });
    const close = () => host.remove();
    host.querySelector('[data-role="cele-close"]').addEventListener('click', close);
    host.querySelector('.ch-unlock-scrim').addEventListener('click', close);
    requestAnimationFrame(() => host.classList.add('is-in'));
    return close;
  }

  // --- selfie compression ------------------------------------------------------
  _len(dataUrl) { return typeof dataUrl === 'string' ? dataUrl.length : Infinity; }

  /** Downscale to ~720px longest side, JPEG, shrinking quality then dimensions until
   *  the data URL fits under the 200000-char rules cap. Returns a data URL or null. */
  async compressSelfie(file) {
    const TARGET = 140000, HARD = 195000;   // char length of the full data URL
    const dataUrl = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(new Error('read'));
      fr.readAsDataURL(file);
    });
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('decode'));
      i.src = dataUrl;
    });
    let side = 720;
    for (let attempt = 0; attempt < 4; attempt++) {
      const scale = Math.min(1, side / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      let q = 0.6, out = c.toDataURL('image/jpeg', q);
      while (this._len(out) > TARGET && q > 0.3) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
      if (this._len(out) <= HARD) return out;
      side = Math.round(side * 0.8);
    }
    return null;
  }

  // --- Ana: cross-device progress sync (no-op until Firebase is configured) -----
  async startSync() {
    try {
      const remote = await net.pull();
      if (this._destroyed) return;
      if (remote) { mergeRemote(remote); this.render(); }
      net.syncUp(remoteView(loadChallenge()));   // push local-only progress up
      const unsub = await net.watchProgress((rec) => {
        if (!rec || this._destroyed) return;
        const before = JSON.stringify(remoteView(loadChallenge()));
        mergeRemote(rec);
        if (JSON.stringify(remoteView(loadChallenge())) !== before) this.render();
      });
      if (this._destroyed) { if (typeof unsub === 'function') unsub(); return; }
      this._progressUnsub = unsub;
    } catch { /* offline / unconfigured: stay purely local */ }
  }

  /** Mirror the current local record up (called after every local mutation). */
  pushSync() { try { net.syncUp(remoteView(loadChallenge())); } catch { /* no-op */ } }

  // --- Mission Control (admin) -------------------------------------------------
  renderAdmin(st) {
    if (!this._pinOk) {
      this.mount(`
        <header class="ch-head"><h1 class="ch-title">Mission Control</h1></header>
        <section class="ch-card">
          <p class="ch-lead">Enter your PIN.</p>
          <form data-role="pin-form" class="ch-form">
            <input class="ch-input" id="ch-pin" name="pin" type="password" inputmode="numeric"
                   autocomplete="off" placeholder="PIN">
            <button type="submit" class="ch-btn ch-btn-go">Unlock</button>
            <p class="ch-msg" data-role="pin-msg" role="status" aria-live="polite"></p>
          </form>
        </section>`);
      return;
    }
    this.mount(`
      <header class="ch-head"><h1 class="ch-title">Mission Control</h1></header>

      <section class="ch-card">
        <h2 class="ch-h2">Status</h2>
        <div data-role="adm-status"><p class="ch-hint">Connecting...</p></div>
      </section>

      <section class="ch-card">
        <h2 class="ch-h2">Players (live)</h2>
        <div data-role="adm-dash"><p class="ch-hint">Connecting...</p></div>
      </section>

      <section class="ch-card">
        <h2 class="ch-h2">Selfie review</h2>
        <div data-role="adm-selfies"><p class="ch-hint">Loading...</p></div>
      </section>

      <section class="ch-card">
        <h2 class="ch-h2">Flight editor</h2>
        <p class="ch-hint">The ONLY place the real flight lives (never in the repo). The finale fetches it at reveal.</p>
        <form data-role="flight-form" class="ch-form">
          ${FLIGHT_FIELDS.map(([k, label]) => k === 'message'
            ? `<label class="ch-label" for="ch-f-${k}">${label}</label><textarea class="ch-input" id="ch-f-${k}" name="${k}" rows="3"></textarea>`
            : `<label class="ch-label" for="ch-f-${k}">${label}</label><input class="ch-input" id="ch-f-${k}" name="${k}" type="text" autocomplete="off">`).join('')}
          <button type="submit" class="ch-btn ch-btn-go">Save flight</button>
          <p class="ch-msg" data-role="flight-msg" role="status" aria-live="polite"></p>
        </form>
      </section>`);
    this.initAdminLive();
  }

  async initAdminLive() {
    if (this._adminLiveStarted) return;
    this._adminLiveStarted = true;
    const q = (sel) => this.root && this.root.querySelector(sel);
    const ok = await net.init();
    if (this._destroyed) return;
    const statusEl = q('[data-role="adm-status"]');
    if (!ok) {
      if (statusEl) statusEl.innerHTML = `<p class="ch-msg is-bad">Offline (or Firebase not configured).</p>
        <p class="ch-hint">The players dashboard, selfie review, and flight editor need a connection. They light up when you are online.</p>`;
      const dash = q('[data-role="adm-dash"]'); if (dash) dash.innerHTML = `<p class="ch-hint">Offline: no synced data.</p>`;
      const sel = q('[data-role="adm-selfies"]'); if (sel) sel.innerHTML = `<p class="ch-hint">Offline: selfie review unavailable.</p>`;
      return;
    }
    if (statusEl) statusEl.innerHTML = `<p class="ch-msg is-ok">Connected. Mission Control is live.</p>`;

    // Any signed-in visitor can read/write (rules are auth-only now), so the PIN is the
    // only gate and there is no per-device enrollment. Watch every persona + all selfies.
    const u1 = await net.watchAllProgress((all) => { this._dashAll = all || {}; this.renderDash(all); });
    if (this._destroyed) { if (typeof u1 === 'function') u1(); return; }
    this._adminUnsubs.push(u1);
    const u2 = await net.watchSelfies((all) => { this._selfies = all || {}; this.renderSelfies(all); });
    if (this._destroyed) { if (typeof u2 === 'function') u2(); return; }
    this._adminUnsubs.push(u2);
    this.loadFlightForm();
  }

  /** Human label for a progress key (admin view only; no real name in the label). */
  personaLabel(key) {
    if (key === S.PROGRESS_KEY) return 'Recipient';
    return 'Tester (' + key + ')';
  }

  renderDash(all) {
    const el = this.root && this.root.querySelector('[data-role="adm-dash"]');
    if (!el) return;
    const keys = Object.keys(all || {});
    if (!keys.length) { el.innerHTML = `<p class="ch-hint">No players yet. A record appears here once someone plays online.</p>`; return; }
    el.innerHTML = keys.map((k) => {
      const rec = all[k] || {};
      const wins = WIN_SLOTS.filter((s) => rec.wins && rec.wins[s]);
      const pieces = Array.isArray(rec.order) ? rec.order.length : (rec.order ? Object.keys(rec.order).length : 0);
      const sel = rec.selfie || {};
      return `<div class="ch-dash-player">
        <p class="ch-label">${esc(this.personaLabel(k))}</p>
        <ul class="ch-list">
          <li>Wins: ${wins.length ? esc(wins.join(', ')) : 'none yet'}</li>
          <li>Pieces: ${pieces} / ${PIECE_TOTAL}</li>
          <li>Selfie: ${esc(sel.status || 'none')}${sel.rejects ? ` (rejections: ${sel.rejects | 0})` : ''}</li>
        </ul>
      </div>`;
    }).join('');
  }

  renderSelfies(all) {
    const el = this.root && this.root.querySelector('[data-role="adm-selfies"]');
    if (!el) return;
    // Show every selfie that still has an image, newest first; decide only on pending ones.
    const entries = Object.entries(all || {}).filter(([, v]) => v && v.image);
    if (!entries.length) { el.innerHTML = `<p class="ch-hint">No selfies yet.</p>`; return; }
    el.innerHTML = entries.map(([id, v]) => {
      const pending = v.status === 'pending';
      const tag = pending ? 'awaiting review' : (v.status || 'unknown');
      return `<div class="ch-adm-selfie">
        <img class="ch-adm-thumb" alt="Selfie" src="${esc(v.image)}" data-id="${esc(id)}">
        <div class="ch-adm-selfie-actions">
          <span class="ch-vault-tag">${esc(tag)}</span>
          <button type="button" class="ch-btn ch-btn-ghost" data-role="download-selfie" data-id="${esc(id)}">Download</button>
          ${pending ? `<button type="button" class="ch-btn ch-btn-go" data-role="approve" data-id="${esc(id)}">Approve</button>
          <button type="button" class="ch-btn ch-btn-ghost" data-role="reject" data-id="${esc(id)}">Reject (snark)</button>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  async decideSelfie(id, approved) {
    const selfie = (this._selfies && this._selfies[id]) || {};
    const key = selfie.key || S.PROGRESS_KEY;   // credit the submitter's own record
    let patch;
    if (approved) {
      patch = { status: 'approved', reason: null, submissionId: id };
    } else {
      const cur = (this._dashAll && this._dashAll[key] && this._dashAll[key].selfie && this._dashAll[key].selfie.rejects) | 0;
      const n = cur + 1;
      patch = { status: 'rejected', reason: REJECT_LINES[Math.min(n - 1, REJECT_LINES.length - 1)], submissionId: id, rejects: n };
    }
    const ok = await net.decideSelfie(id, key, patch);
    if (!ok) {
      const el = this.root && this.root.querySelector('[data-role="adm-selfies"]');
      if (el) { const p = document.createElement('p'); p.className = 'ch-msg is-bad'; p.textContent = 'Decision failed (offline?).'; el.appendChild(p); }
    }
    // watchSelfies + watchAllProgress refresh the panel automatically.
  }

  /** Download a selfie image (Matt keeps it). Reads the data URL straight off the thumbnail. */
  downloadSelfie(id) {
    const img = this.root && this.root.querySelector(`.ch-adm-thumb[data-id="${id}"]`);
    if (!img || !img.src) return;
    const a = document.createElement('a');
    a.href = img.src;
    a.download = 'selfie-' + id + '.jpg';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async loadFlightForm() {
    const flight = await net.fetchFlight();
    if (this._destroyed || !this.root) return;
    if (!flight) return;
    for (const [k] of FLIGHT_FIELDS) {
      const input = this.root.querySelector(`[name="${k}"]`);
      if (input && flight[k] != null) input.value = flight[k];
    }
  }

  // --- events ------------------------------------------------------------------
  onSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const role = form.dataset.role;

    if (role === 'answer-form') {
      const val = form.querySelector('#ch-answer').value;
      if (checkAnswer(val)) {
        unlockArea();
        this.pushSync();
        this.render();
        this.showCelebration({
          kicker: 'Correct',
          title: "That's the one.",
          asset: assetUrl(ANSWER_ASSET),
          note: 'Behold: the sexiest starchy vegetable. Obviously. Off we go.',
        });
      } else {
        this.setMsg('[data-role="answer-msg"]', 'Nope. Try again.', false);
      }
      return;
    }

    if (role === 'pin-form') {
      const val = form.querySelector('#ch-pin').value;
      if (checkPin(val)) { unlockAdmin(); this._pinOk = true; this.render(); }   // persist: no re-prompt on this device
      else this.setMsg('[data-role="pin-msg"]', "That's not it.", false);
      return;
    }

    if (role === 'code-form') {
      const val = form.querySelector('#ch-code').value;
      const slot = slotForCode(val);
      const st = loadChallenge();
      if (!slot) return this.setMsg('[data-role="code-msg"]', 'That is not one of the five codes.', false);
      if (st.redeemed[slot]) return this.setMsg('[data-role="code-msg"]', 'Already redeemed. Nice try, completist.', true);
      redeemSlot(slot);
      this.pushSync();
      const pieceNo = loadChallenge().order.length;
      this.render();
      const c = CELE[slot];
      if (c) {
        this.showCelebration({
          kicker: 'Code redeemed',
          title: c.line,
          asset: assetUrl(c.asset),
          note: `Piece ${pieceNo} of ${PIECE_TOTAL} secured.`,
        });
      }
      return;
    }

    if (role === 'flight-form') {
      const flight = {};
      for (const [k] of FLIGHT_FIELDS) {
        const input = form.querySelector(`[name="${k}"]`);
        flight[k] = input ? input.value.trim() : '';
      }
      this.setMsg('[data-role="flight-msg"]', 'Saving...', true);
      net.saveFlight(flight).then((ok) => {
        this.setMsg('[data-role="flight-msg"]', ok ? 'Flight saved.' : 'Save failed (Firebase not ready or not an admin).', ok);
      });
      return;
    }
  }

  async onChange(e) {
    const input = e.target;
    if (!input || input.dataset.role !== 'selfie-file') return;
    const file = input.files && input.files[0];
    if (!file) return;
    this.setMsg('[data-role="selfie-msg"]', 'Processing your selfie...', true);
    try {
      const data = await this.compressSelfie(file);
      if (this._destroyed) return;
      if (!data) { this.setMsg('[data-role="selfie-msg"]', 'That image would not compress small enough. Try another.', false); return; }
      this._pendingSelfie = data;
      this.render();   // re-render with preview + Submit
    } catch {
      this.setMsg('[data-role="selfie-msg"]', 'Could not read that image. Try again.', false);
    }
  }

  onClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const role = btn.dataset.role;
    if (role === 'replay') { markUnlockSeen(); playUnlock(); return; }
    if (role === 'assemble') { this.showFinale(); return; }
    if (role === 'selfie-submit') { this.submitSelfie(); return; }
    if (role === 'download-selfie') { this.downloadSelfie(btn.dataset.id); return; }
    if (role === 'approve') { this.decideSelfie(btn.dataset.id, true); return; }
    if (role === 'reject') { this.decideSelfie(btn.dataset.id, false); return; }
  }

  async submitSelfie() {
    if (!this._pendingSelfie) return;
    this.setMsg('[data-role="selfie-msg"]', 'Sending...', true);
    const id = await net.submitSelfie(this._pendingSelfie);
    if (this._destroyed) return;
    if (!id) {
      this.setMsg('[data-role="selfie-msg"]', "Couldn't send it (are you offline?). Try again in a bit.", false);
      return;
    }
    setSelfie({ status: 'pending', submissionId: id });
    this._pendingSelfie = null;
    this.pushSync();
    this.render();
  }

  setMsg(sel, text, ok) {
    const el = sel && this.root ? this.root.querySelector(sel) : null;
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('is-ok', !!ok);
    el.classList.toggle('is-bad', !ok);
  }

  destroy() {
    this._destroyed = true;
    if (this.root) {
      this.root.removeEventListener('click', this._onClick);
      this.root.removeEventListener('submit', this._onSubmit);
      this.root.removeEventListener('change', this._onChange);
    }
    if (typeof this._progressUnsub === 'function') { try { this._progressUnsub(); } catch { /* ignore */ } }
    for (const u of this._adminUnsubs) { if (typeof u === 'function') { try { u(); } catch { /* ignore */ } } }
    this._adminUnsubs = [];
    // Remove any modal overlays this instance may have left on the body.
    document.querySelectorAll('.ch-cele, .ch-finale').forEach((n) => n.remove());
    this.container.innerHTML = '';
  }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

let instance = null;
export function init(container) { if (instance) instance.destroy(); instance = new ChallengeUI(container); return instance; }
export function destroy() { if (instance) { instance.destroy(); instance = null; } }
export default { init, destroy };
