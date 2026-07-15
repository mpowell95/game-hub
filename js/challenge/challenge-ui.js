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
  loadChallenge, redeemSlot, unlockArea, unlockAdmin, markUnlockSeen, markHowToSeen, setSelfie,
  remoteView, mergeRemote,
} from './challenge-store.js';
import { isAdmin, progressKeyFor, checkAnswer, checkPin, codeFor, slotForCode, TAUNTS } from './hooks.js';
import * as net from './challenge-net.js';
import { watchPlayers } from '../stats-net.js';

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
// Ordinal words for the "Your <nth> Clue has been unlocked!" celebration (1..5).
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'];

// Selfie rejections reuse Matt's shared escalating taunt lines (hooks.TAUNTS), picked by
// how many times this selfie has already been rejected (1st, 2nd, 3rd, then 4th-and-after).
const REJECT_LINES = TAUNTS;

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
    document.body.classList.add('ch-active');   // commit the whole hub shell to the dark route
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
      <section class="ch-card">
        <form data-role="answer-form" class="ch-form">
          <label class="ch-label" for="ch-answer">${esc(S.QUESTION)}</label>
          <input class="ch-input" id="ch-answer" name="answer" type="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Answer">
          <button type="submit" class="ch-btn ch-btn-go">Enter</button>
          <p class="ch-msg" data-role="answer-msg" role="status" aria-live="polite"></p>
        </form>
      </section>`);
  }

  // --- the Challenge Area -------------------------------------------------------
  renderArea(st) {
    const pieces = st.order.length;
    const earned = this.earnedCodes(st);
    // How to Win: auto-expanded only the FIRST time it renders on this device, collapsed
    // after. Guard on a per-instance "rendered once" flag, not just howToSeen, so later
    // re-renders in the same session (e.g. after redeeming a code) do not pop it open again.
    const openHowTo = !this._howToRendered && !st.howToSeen;
    if (!this._howToRendered) { this._howToRendered = true; if (!st.howToSeen) markHowToSeen(); }
    this.mount(`
      <header class="ch-head">
        <h1 class="ch-title">Challenge Mode</h1>
        ${progressKeyFor(this.name) !== S.PROGRESS_KEY
          ? '<button type="button" class="ch-btn ch-btn-ghost" data-role="reset-test">Reset (test)</button>' : ''}
      </header>

      <section class="ch-card ch-howto">
        <details ${openHowTo ? 'open' : ''}>
          <summary class="ch-h2">How to Win</summary>
          <div class="ch-howto-body">
            <div class="ch-steps" data-role="steps">
              <div class="ch-step is-active" data-step="0">
                <div class="ch-step-icon" aria-hidden="true">&#127942;</div>
                <p class="ch-lead">There are 5 parts to this challenge. You must complete the following tasks:</p>
                <p class="ch-label">Win a game of:</p>
                <ol class="ch-list">
                  <li>Connect 4</li>
                  <li>Chinch&oacute;n</li>
                  <li>Monopoly Deal</li>
                  <li>Parch&iacute;s</li>
                </ol>
                <p class="ch-label">And submit:</p>
                <ul class="ch-list ch-list-selfie">
                  <li>A selfie taken in the moment</li>
                </ul>
              </div>
              <div class="ch-step" data-step="1">
                <div class="ch-step-icon" aria-hidden="true">&#127903;</div>
                <p class="ch-lead">For each task you complete, you will receive a code or phrase.</p>
              </div>
              <div class="ch-step" data-step="2">
                <div class="ch-step-icon" aria-hidden="true">&#128273;</div>
                <p class="ch-lead">When you receive a code, come back to the Challenge area, enter your code, and click Redeem.</p>
                <p class="ch-lead">Each code unlocks a clue.</p>
              </div>
              <div class="ch-step" data-step="3">
                <div class="ch-step-icon" aria-hidden="true">&#127873;</div>
                <p class="ch-lead">Once you have unlocked all 5 clues, you can assemble the image.</p>
                <p class="ch-lead">The image, and the information displayed within it, is the prize.</p>
              </div>
            </div>
            <div class="ch-steps-nav">
              <button type="button" class="ch-btn ch-btn-ghost" data-role="step-prev" disabled>Back</button>
              <span class="ch-dots" data-role="dots" aria-hidden="true"><i class="is-on"></i><i></i><i></i><i></i></span>
              <button type="button" class="ch-btn ch-btn-go" data-role="step-next">Next</button>
            </div>
          </div>
        </details>
      </section>

      <section class="ch-card">
        <h2 class="ch-h2">Enter a code</h2>
        <form data-role="code-form" class="ch-form ch-form-row">
          <input class="ch-input" id="ch-code" name="code" type="text" autocomplete="off"
                 autocapitalize="none" autocorrect="off" spellcheck="false"
                 placeholder="Type a secret code">
          <button type="submit" class="ch-btn ch-btn-go">Redeem</button>
        </form>
        <p class="ch-msg" data-role="code-msg" role="status" aria-live="polite"></p>
      </section>

      ${this.selfieCardHTML(st)}

      ${earned.length ? `<section class="ch-card ch-collapse">
        <details>
          <summary class="ch-h2">Your codes vault</summary>
          <div class="ch-howto-body">
            <ul class="ch-vault">${earned.map((e) => `
              <li class="ch-vault-item ${st.redeemed[e.slot] ? 'is-redeemed' : ''}">
                <span class="ch-vault-code">${esc(e.code)}</span>
                <span class="ch-vault-tag">${e.redeemed ? 'redeemed' : 'earned, enter it above'}</span>
              </li>`).join('')}</ul>
          </div>
        </details>
      </section>` : ''}

      <section class="ch-card">
        <h2 class="ch-h2">Clues <span class="ch-count">${pieces} / ${PIECE_TOTAL}</span></h2>
        <div class="ch-gallery" data-role="gallery">
          ${this.galleryHTML(st)}
        </div>
        ${pieces ? '<p class="ch-hint ch-gallery-hint">Tap a clue to see it full screen.</p>' : ''}
        <button type="button" class="ch-btn ch-btn-finale" data-role="assemble">Assemble the image</button>
      </section>`);
  }

  // --- selfie mission (capture -> compress -> submit -> live verdict) -----------
  selfieCardHTML(st) {
    const s = st.selfie;
    let inner;
    if (s.status === 'approved') {
      // Approved: surface the selfie code right here so it is unmissable (the games reveal
      // their code on the win screen; the selfie's only reveal is this card + the vault).
      inner = st.redeemed.selfie
        ? `<p class="ch-msg is-ok">Approved. Code redeemed.</p>`
        : `<p class="ch-msg is-ok">Approved! Here is your code:</p>
           <div class="ch-vault-item">
             <span class="ch-vault-code">${esc(codeFor('selfie'))}</span>
             <span class="ch-vault-tag">enter it above</span>
           </div>`;
    } else if (s.status === 'pending') {
      inner = `<p class="ch-hint" data-role="selfie-live">Submitted. Waiting for approval.</p>`;
    } else {
      const rejected = s.status === 'rejected';
      const capture = this._pendingSelfie
        ? `<img class="ch-selfie-preview" alt="Your selfie preview" src="${esc(this._pendingSelfie)}">
           <div class="ch-selfie-actions">
             <button type="button" class="ch-btn ch-btn-go" data-role="selfie-submit">Submit</button>
             <label class="ch-btn ch-btn-ghost ch-file-btn">Retake
               <input class="ch-file-input" data-role="selfie-file" type="file" accept="image/*" capture="user"></label>
           </div>`
        : `<label class="ch-btn ch-btn-go ch-file-btn ch-selfie-btn">
             <span class="ch-selfie-cta"><span class="ch-selfie-cam" aria-hidden="true">&#128247;</span> Take a selfie</span>
             <span class="ch-selfie-sub">Opens the camera</span>
             <input class="ch-file-input" data-role="selfie-file" type="file" accept="image/*" capture="user"></label>`;
      inner = `${rejected ? `<p class="ch-msg is-bad">${esc(s.reason || 'Not approved.')}</p>` : ''}
        ${capture}
        <p class="ch-msg" data-role="selfie-msg" role="status" aria-live="polite"></p>`;
    }
    return `<section class="ch-card"><h2 class="ch-h2">Selfie</h2>${inner}</section>`;
  }

  /** The boarding pass, five separate ticket panels that fill in order as codes are redeemed.
   *  An earned piece shows its panel image (reward-pt-1..5.png); an unearned one is an opaque
   *  numbered placeholder. The .ch-gallery columns are the panels' aspect ratios, so at a shared
   *  height they assemble seamlessly. Panel 5 has two versions (reward-pt-5 + reward-pt-5b) that
   *  slowly crossfade. Each <img> self-removes on error, so a missing panel never breaks the pass. */
  galleryHTML(st) {
    const n = st.order.length;
    let out = '';
    for (let i = 0; i < PIECE_TOTAL; i++) {
      if (i >= n) {
        out += `<div class="ch-piece is-off"><span class="ch-piece-lock" aria-hidden="true">${i + 1}</span></div>`;
      } else if (i === PIECE_TOTAL - 1) {
        // Panel 5: two versions stacked; reward-pt-5 (v1) under reward-pt-5b (v2), which crossfades.
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

  // --- Finale: the assembled boarding-pass image (sliced into the 5 collected pieces) --
  /** Opens the finale. Before 5/5 it shows the pieces assembled so far; at 5/5 it reveals
   *  the full boarding-pass image (a local asset, so it always works) with a tap-to-enlarge
   *  view plus a best-effort "Add to Google Calendar" built from the Firebase flight. */
  async showFinale() {
    const st = loadChallenge();
    const n = st.order.length;
    const complete = n >= PIECE_TOTAL;
    const host = document.createElement('div');
    host.className = 'ch-finale' + (complete ? ' ch-finale-photo' : '');
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-label', 'Boarding pass');
    host.innerHTML = `
      <div class="ch-unlock-scrim"></div>
      <div class="ch-finale-inner">
        <div class="ch-finale-stage" data-role="stage"><p class="ch-finale-printing">Assembling&hellip;</p></div>
        <button type="button" class="ch-btn ch-btn-ghost ch-finale-close" data-role="fin-close">Close</button>
      </div>`;
    document.body.appendChild(host);
    requestAnimationFrame(() => host.classList.add('is-in'));
    host.querySelector('[data-role="fin-close"]').addEventListener('click', () => host.remove());
    host.querySelector('.ch-unlock-scrim').addEventListener('click', () => host.remove());

    // Hold the "assembling" beat for a moment of drama.
    await new Promise((r) => setTimeout(r, 700));
    if (this._destroyed || !host.isConnected) return;
    const stage = host.querySelector('[data-role="stage"]');
    if (!stage) return;

    if (!complete) {
      stage.innerHTML =
        `<div class="ch-gallery ch-finale-strip">${this.galleryHTML(st)}</div>
         <p class="ch-finale-hint">${n} / ${PIECE_TOTAL} pieces assembled. Collect all five clues to reveal your boarding pass.</p>`;
      return;
    }

    // Complete: reveal the full assembled boarding pass (the five panels, reunited).
    stage.innerHTML =
      `<p class="ch-finale-tada">Your boarding pass is complete!</p>
       <div class="ch-gallery ch-finale-strip ch-finale-pass" data-role="finale-pass">${this.galleryHTML(st)}</div>
       <p class="ch-finale-hint">Tap the pass to view it larger.</p>`;
    const pass = stage.querySelector('[data-role="finale-pass"]');
    if (pass) pass.addEventListener('click', () => this.zoomPass());

    // Best-effort "Add to Google Calendar" from the Firebase flight (destination stays out of
    // the public repo; the button just does not appear when Firebase is unreachable).
    net.fetchFlight().then((flight) => {
      if (!flight || this._destroyed || !stage.isConnected) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ch-btn ch-btn-go ch-finale-cal';
      btn.textContent = 'Add to Google Calendar';
      btn.addEventListener('click', () => window.open(this.calendarUrl(flight), '_blank', 'noopener'));
      stage.appendChild(btn);
    }).catch(() => {});
  }

  /** Full-screen lightbox for the finished pass (the assembled panels). Tap anywhere to close.
   *  On portrait phones the wide pass is rotated to fill the screen so every detail is legible. */
  zoomPass() {
    const z = document.createElement('div');
    z.className = 'ch-zoom';
    z.setAttribute('role', 'dialog');
    z.setAttribute('aria-label', 'Boarding pass, enlarged');
    z.innerHTML = `<div class="ch-gallery ch-zoom-pass">${this.galleryHTML(loadChallenge())}</div>`;
    z.addEventListener('click', () => z.remove());
    document.body.appendChild(z);
    requestAnimationFrame(() => z.classList.add('is-in'));
  }

  /** Full-screen view of a single unlocked piece, so each can be enjoyed as it is earned.
   *  Panels are portrait, so (unlike the finished pass) this one is not rotated. Tap to close. */
  zoomPanel(pieceEl) {
    const img = pieceEl.querySelector('.ch-piece-img');
    if (!img || !img.getAttribute('src')) return;
    const z = document.createElement('div');
    z.className = 'ch-zoom';
    z.setAttribute('role', 'dialog');
    z.setAttribute('aria-label', 'Clue, enlarged');
    const big = document.createElement('img');
    big.className = 'ch-zoom-panel-img';
    big.alt = '';
    big.src = img.getAttribute('src');
    z.appendChild(big);
    z.addEventListener('click', () => z.remove());
    document.body.appendChild(z);
    requestAnimationFrame(() => z.classList.add('is-in'));
  }

  /** Google Calendar template link for the visit (all-day span; the recipient can adjust it
   *  before saving). Parses the free-text "M/D - M/D" dates best-effort. */
  calendarUrl(flight) {
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
      const endExcl = new Date(endYear, +m[3] - 1, +m[4] + 1);   // Google's end date is exclusive
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

  /** Codes shown in the vault: one per recorded game win, plus the selfie code once it is
   *  approved. Each is tagged redeemed or "earned, enter it above". This is what makes a
   *  code recoverable if it was lost (plan decision 6) AND is the ONLY path by which the
   *  selfie code reaches her (games reveal their code in-play; the selfie has no in-game
   *  reveal, so hiding un-redeemed codes here left the selfie task impossible to complete). */
  earnedCodes(st) {
    const out = [];
    for (const slot of WIN_SLOTS) if (st.wins[slot]) out.push({ slot, code: codeFor(slot), redeemed: !!st.redeemed[slot] });
    if (st.selfie.status === 'approved') out.push({ slot: 'selfie', code: codeFor('selfie'), redeemed: !!st.redeemed.selfie });
    return out;
  }

  // --- celebration overlay (asset image) --------------------------------------
  /** Full-screen celebration. Two phases: a brief "Verifying" screen (word + pulsing dots)
   *  while the asset preloads, then the reveal (word + image + button) fades in TOGETHER, so
   *  the headline never shows on a half-loaded screen. Optional fireworks for the big moment.
   *  Params: { kicker, title, phrase, asset, note, fireworks, button, minVerifyMs }. */
  showCelebration({ kicker, title, phrase, asset, note, fireworks = false, button = 'Continue', minVerifyMs = 700 }) {
    const host = document.createElement('div');
    host.className = 'ch-cele';
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-label', title || 'Celebration');
    host.innerHTML = `
      <div class="ch-unlock-scrim"></div>
      <div class="ch-cele-card">
        <div class="ch-cele-verify" data-role="verify">
          <p class="ch-cele-verify-text">Verifying</p>
          <span class="ch-cele-wait" aria-hidden="true"><i></i><i></i><i></i></span>
        </div>
        <div class="ch-cele-reveal" data-role="reveal" hidden>
          ${fireworks ? '<span class="ch-fw" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>' : ''}
          ${kicker ? `<p class="ch-unlock-kicker">${esc(kicker)}</p>` : ''}
          ${title ? `<h2 class="ch-cele-title">${esc(title)}</h2>` : ''}
          ${phrase ? `<p class="ch-cele-phrase">&ldquo;${esc(phrase)}&rdquo;</p>` : ''}
          <div class="ch-cele-media"><img class="ch-cele-img" alt=""></div>
          ${note ? `<p class="ch-cele-note">${esc(note)}</p>` : ''}
          <button type="button" class="ch-btn ch-btn-go" data-role="cele-close">${esc(button)}</button>
        </div>
      </div>`;
    document.body.appendChild(host);
    const verify = host.querySelector('[data-role="verify"]');
    const reveal = host.querySelector('[data-role="reveal"]');
    const img = host.querySelector('.ch-cele-img');
    let dismissable = false;   // scrim can't dismiss until the reveal is up
    const close = () => host.remove();
    host.querySelector('[data-role="cele-close"]').addEventListener('click', close);
    host.querySelector('.ch-unlock-scrim').addEventListener('click', () => { if (dismissable) close(); });

    // Preload the asset, then swap Verifying -> reveal only once BOTH the image is ready
    // (loaded or failed) AND a short minimum beat has passed, so word + image land together.
    let imgReady = false, imgOk = true, beat = false, revealed = false;
    const doReveal = () => {
      if (revealed || !imgReady || !beat) return;
      revealed = true;
      if (imgOk) img.classList.add('is-loaded'); else img.style.display = 'none';
      verify.remove();
      reveal.hidden = false;
      requestAnimationFrame(() => { reveal.classList.add('is-in'); dismissable = true; });
    };
    const onImg = (ok) => { imgReady = true; imgOk = ok; doReveal(); };
    img.addEventListener('load', () => onImg(true));
    img.addEventListener('error', () => onImg(false));
    img.src = asset;
    if (img.complete) onImg(!!img.naturalWidth);
    setTimeout(() => { beat = true; doReveal(); }, minVerifyMs);
    setTimeout(() => { if (!revealed) { imgReady = true; beat = true; doReveal(); } }, 4000);   // safety

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
        <header class="ch-head"><h1 class="ch-title">Challenge Control</h1></header>
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
      <header class="ch-head"><h1 class="ch-title">Challenge Control</h1></header>

      <section class="ch-card">
        <h2 class="ch-h2">Status</h2>
        <div data-role="adm-status"><p class="ch-hint">Connecting...</p></div>
      </section>

      <section class="ch-card">
        <h2 class="ch-h2">Players (live)</h2>
        <div data-role="adm-dash"><p class="ch-hint">Connecting...</p></div>
      </section>

      <section class="ch-card">
        <h2 class="ch-h2">Player Insights</h2>
        <p class="ch-hint">Every device that has opened the hub (all profiles, not just the challenge).</p>
        <div data-role="adm-players"><p class="ch-hint">Connecting...</p></div>
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
      const pl = q('[data-role="adm-players"]'); if (pl) pl.innerHTML = `<p class="ch-hint">Offline: player insights unavailable.</p>`;
      return;
    }
    if (statusEl) statusEl.innerHTML = `<p class="ch-msg is-ok">Connected. Challenge Control is live.</p>`;

    // Any signed-in visitor can read/write (rules are auth-only now), so the PIN is the
    // only gate and there is no per-device enrollment. Watch every persona + all selfies.
    const u1 = await net.watchAllProgress((all) => { this._dashAll = all || {}; this.renderDash(all); });
    if (this._destroyed) { if (typeof u1 === 'function') u1(); return; }
    this._adminUnsubs.push(u1);
    const u2 = await net.watchSelfies((all) => { this._selfies = all || {}; this.renderSelfies(all); });
    if (this._destroyed) { if (typeof u2 === 'function') u2(); return; }
    this._adminUnsubs.push(u2);
    const u3 = await watchPlayers((all) => { this._players = all || {}; this.renderPlayers(all); });
    if (this._destroyed) { if (typeof u3 === 'function') u3(); return; }
    this._adminUnsubs.push(u3);
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
    const TASKS = [['connect4', 'Connect 4'], ['chinchon', 'Chinch&oacute;n'], ['business', 'Monopoly Deal'], ['parchis', 'Parch&iacute;s'], ['selfie', 'Selfie']];
    el.innerHTML = keys.map((k) => {
      const rec = all[k] || {};
      const redeemed = rec.redeemed || {};
      const wins = rec.wins || {};
      const sel = rec.selfie || {};
      const pieces = Array.isArray(rec.order) ? rec.order.length : Object.keys(rec.order || {}).length;
      const rows = TASKS.map(([slot, label]) => {
        const isRedeemed = !!redeemed[slot];
        const isWon = slot === 'selfie' ? sel.status === 'approved' : !!wins[slot];
        const state = isRedeemed ? 'is-done' : (isWon ? 'is-earned' : 'is-todo');
        const glyph = isRedeemed ? '&#10003;' : (isWon ? '&#9679;' : '');
        let sub = '';
        if (slot === 'connect4') sub = `${(rec.cf && rec.cf.completed) | 0} plays`;
        else if (slot === 'selfie' && sel.status && sel.status !== 'none') sub = esc(sel.status) + (sel.rejects ? ` (${sel.rejects | 0} rejected)` : '');
        else if (isRedeemed) sub = 'redeemed';
        else if (isWon) sub = 'code out';
        return `<li class="${state}"><span class="ch-dash-ic" aria-hidden="true">${glyph}</span><span class="ch-dash-task">${label}</span>${sub ? `<span class="ch-dash-sub">${sub}</span>` : ''}</li>`;
      }).join('');
      return `<div class="ch-dash-player">
        <div class="ch-dash-head">
          <span class="ch-dash-name">${esc(this.personaLabel(k))}</span>
          <span class="ch-dash-count"><b>${pieces}</b> / ${PIECE_TOTAL}</span>
        </div>
        <div class="ch-dash-bar"><span style="width:${Math.round((pieces / PIECE_TOTAL) * 100)}%"></span></div>
        <ul class="ch-dash-tasks">${rows}</ul>
      </div>`;
    }).join('');
  }

  /** Admin Insights: every device that has synced (all profiles across the family), newest first,
   *  with per-game played/won/lost. Reads the players/ node (game-stats sync), separate from the
   *  challenge personas above. */
  renderPlayers(all) {
    const el = this.root && this.root.querySelector('[data-role="adm-players"]');
    if (!el) return;
    const ids = Object.keys(all || {});
    if (!ids.length) { el.innerHTML = `<p class="ch-hint">No players yet. A device appears here after it opens the hub online.</p>`; return; }
    const GN = { connect4: 'Connect 4', chinchon: 'Chinchón', business: 'Monopoly Deal', parchis: 'Parchís' };
    ids.sort((a, b) => ((all[b] && all[b].updatedAt | 0) - (all[a] && all[a].updatedAt | 0)));
    el.innerHTML = ids.map((id) => {
      const rec = all[id] || {};
      const prof = rec.profile || {};
      const name = esc((prof.name || '').trim() || 'Unnamed');
      const emoji = esc(prof.emoji || '\u{1F3AE}');
      const games = (rec.stats && rec.stats.games) || {};
      const rows = ['connect4', 'chinchon', 'business', 'parchis'].map((g) => {
        const t = (games[g] && games[g].total) || {};
        if (!(t.played | 0)) return '';
        return `<li>${GN[g]}: <b>${t.played | 0}</b> played &middot; ${t.won | 0}W ${t.lost | 0}L</li>`;
      }).filter(Boolean).join('');
      return `<div class="ch-ins-player">
        <p class="ch-ins-name">${emoji} ${name}</p>
        ${rows ? `<ul class="ch-list">${rows}</ul>` : '<p class="ch-hint">No games played yet.</p>'}
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

  /** Save a selfie (Matt keeps it). iOS Safari ignores <a download> for data URLs, so instead open
   *  the full-size photo in a tap-to-close overlay with a Blob-backed Save link (works on desktop)
   *  plus a "press and hold -> Save to Photos" hint (the reliable iPhone path). */
  downloadSelfie(id) {
    const rec = (this._selfies && this._selfies[id]) || {};
    const thumb = this.root && this.root.querySelector(`.ch-adm-thumb[data-id="${id}"]`);
    const src = rec.image || (thumb && thumb.src);
    if (!src) return;
    let href = src, blobUrl = null;
    try { blobUrl = URL.createObjectURL(dataUrlToBlob(src)); href = blobUrl; } catch { /* fall back to the data URL */ }
    const z = document.createElement('div');
    z.className = 'ch-zoom ch-selfie-save';
    z.setAttribute('role', 'dialog');
    z.setAttribute('aria-label', 'Selfie, full size');
    z.innerHTML =
      `<img class="ch-zoom-panel-img" alt="Selfie" src="${esc(src)}">
       <div class="ch-selfie-save-bar">
         <a class="ch-btn ch-btn-go ch-selfie-dl" href="${esc(href)}" download="ana-selfie-${esc(id)}.jpg">Save / Download</a>
         <button type="button" class="ch-btn ch-btn-ghost" data-role="selfie-save-close">Close</button>
         <p class="ch-hint">On iPhone: press and hold the photo, then &ldquo;Save to Photos&rdquo;.</p>
       </div>`;
    const close = () => { if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch { /* ignore */ } } z.remove(); };
    z.addEventListener('click', (e) => { if (e.target === z || e.target.closest('[data-role="selfie-save-close"]')) close(); });
    document.body.appendChild(z);
    requestAnimationFrame(() => z.classList.add('is-in'));
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
        this.showCelebration({ title: 'Correct!', asset: assetUrl(ANSWER_ASSET), fireworks: true });
      } else {
        this.setMsg('[data-role="answer-msg"]', 'Try again.', false);
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
      if (!slot) return this.setMsg('[data-role="code-msg"]', 'Not a valid code.', false);
      if (st.redeemed[slot]) return this.setMsg('[data-role="code-msg"]', 'Already redeemed.', true);
      redeemSlot(slot);
      this.pushSync();
      const layerN = loadChallenge().order.length;   // 1st redemption -> layer 1, etc.
      this.render();
      const c = CELE[slot];
      if (c) this.showCelebration({
        title: `Your ${ORDINALS[layerN - 1] || layerN} Clue has been unlocked!`,
        phrase: codeFor(slot),
        asset: assetUrl(c.asset),
      });
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
    // Tap an unlocked clue to see that single panel full screen (savor each as it lands).
    const piece = e.target.closest('.ch-piece.is-on');
    if (piece) { this.zoomPanel(piece); return; }
    const btn = e.target.closest('button');
    if (!btn) return;
    const role = btn.dataset.role;
    if (role === 'reset-test') { this.resetTest(); return; }
    if (role === 'assemble') { this.showFinale(); return; }
    if (role === 'step-prev') { this.stepHowTo(-1); return; }
    if (role === 'step-next') { this.stepHowTo(1); return; }
    if (role === 'selfie-submit') { this.submitSelfie(); return; }
    if (role === 'download-selfie') { this.downloadSelfie(btn.dataset.id); return; }
    if (role === 'approve') { this.decideSelfie(btn.dataset.id, true); return; }
    if (role === 'reject') { this.decideSelfie(btn.dataset.id, false); return; }
  }

  /** How-to-Win slideshow: advance/retreat one step; on the last step, "Next" (Got it)
   *  collapses the card. Self-contained (reads/writes the live DOM, no re-render). */
  stepHowTo(dir) {
    const wrap = this.root && this.root.querySelector('[data-role="steps"]');
    if (!wrap) return;
    const slides = [...wrap.querySelectorAll('.ch-step')];
    let i = slides.findIndex((s) => s.classList.contains('is-active'));
    if (dir > 0 && i === slides.length - 1) {   // "Got it" on the last step closes How to Win
      const d = this.root.querySelector('.ch-howto details');
      if (d) d.open = false;
      return;
    }
    i = Math.max(0, Math.min(slides.length - 1, i + dir));
    slides.forEach((s, k) => s.classList.toggle('is-active', k === i));
    this.root.querySelectorAll('[data-role="dots"] i').forEach((d, k) => d.classList.toggle('is-on', k === i));
    const prev = this.root.querySelector('[data-role="step-prev"]');
    const next = this.root.querySelector('[data-role="step-next"]');
    if (prev) prev.disabled = i === 0;
    if (next) next.textContent = i === slides.length - 1 ? 'Got it' : 'Next';
  }

  async submitSelfie() {
    if (!this._pendingSelfie) return;
    this.setMsg('[data-role="selfie-msg"]', 'Sending...', true);
    const id = await net.submitSelfie(this._pendingSelfie);
    if (this._destroyed) return;
    if (!id) {
      this.setMsg('[data-role="selfie-msg"]', "Couldn't send. Try again.", false);
      return;
    }
    setSelfie({ status: 'pending', submissionId: id });
    this._pendingSelfie = null;
    this.pushSync();
    this.render();
  }

  /** Tester-only: wipe local + remote progress and reload, so the intro, question gate,
   *  and everything replay from scratch. Never shown for the real recipient. */
  async resetTest() {
    try { localStorage.removeItem('gamehub.challenge'); } catch { /* ignore */ }
    try { await net.resetProgress(); } catch { /* ignore */ }
    location.reload();
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
    document.body.classList.remove('ch-active');   // revert the hub shell to its light theme
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

/** data:image/...;base64,XXXX -> Blob, so a selfie can be saved via an object URL (more reliable
 *  than a giant data: URL in an <a download>, especially on iOS). */
function dataUrlToBlob(dataUrl) {
  const parts = String(dataUrl).split(',');
  const mime = (parts[0].match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
  const bin = atob(parts[1] || '');
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

let instance = null;
export function init(container) { if (instance) instance.destroy(); instance = new ChallengeUI(container); return instance; }
export function destroy() { if (instance) { instance.destroy(); instance = null; } }
export default { init, destroy };
