// announce-ui.js - draws the one-time launcher announcement js/announce.js decided to show.
//
// Built on css/ui.css's `.gh-overlay`/`.gh-modal`, like js/bug-report-ui.js, so it inherits dark
// mode, the focus ring, scroll containment and the reduced-motion pass instead of being this
// repo's fifth hand-rolled modal.
//
// Dismissal is recorded (markSeen) when the popup CLOSES by ANY route - Got it, the X, Escape, or
// the call-to-action. Someone who taps "Try it now" has plainly seen it, and showing them the same
// notice again after they acted on it is its own small bug.

import { markSeen, textFor } from './announce.js';
import { GAME_ART } from './game-art.js';
import { resolvedTheme } from './theme.js';
import { makeT, getLang } from './i18n.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function ensureCss() {
  if (!document.querySelector('link[data-gh-ui-css="1"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../css/ui.css', import.meta.url).href;
    link.setAttribute('data-gh-ui-css', '1');
    document.head.appendChild(link);
  }
  if (document.getElementById('ann-css')) return;
  const style = document.createElement('style');
  style.id = 'ann-css';
  style.textContent = `
  .ann-overlay { z-index: 290; padding: max(var(--gh-sp-4), env(safe-area-inset-top)) var(--gh-sp-4)
                 max(var(--gh-sp-4), env(safe-area-inset-bottom)); align-content: center; }
  .ann-modal { width: min(420px, 100%); text-align: center; }
  .ann-icon { font-size: 42px; line-height: 1; }
  /* The launcher's NEW pill, same gold (#f2b705, the colorblind palette's yellow) and same
     uppercase word. It spells the word out, so the colour is emphasis and never the signal. */
  .ann-badge { display: inline-block; margin-bottom: var(--gh-sp-2); padding: 3px 8px;
               border-radius: var(--gh-r-pill); background: #f2b705; color: #1a1400;
               font-size: .66rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase;
               white-space: nowrap; }
  .ann-modal h2 { margin: var(--gh-sp-2) var(--gh-sp-6) var(--gh-sp-3); font-size: var(--gh-fs-lg); font-weight: 800; }
  /* A new game's own launcher tile, drawn from the SAME js/game-art.js the launcher reads, so the
     picture in the popup and the picture the player then goes looking for cannot drift apart. The
     art is a landscape 160x90 SVG with its own full-bleed background rect, so the frame is given
     that aspect ratio and the svg simply fills it. */
  .ann-tile { margin: 0 auto var(--gh-sp-2); width: min(280px, 100%); aspect-ratio: 16 / 9;
              border-radius: var(--gh-r-md); overflow: hidden; border: 1px solid var(--gh-border);
              background: var(--gh-surface-2); }
  .ann-tile svg { width: 100%; height: 100%; display: block; }
  .ann-tilename { margin: 0 0 var(--gh-sp-4); font-size: var(--gh-fs-lg); font-weight: 800; }
  .ann-body { margin: 0 0 var(--gh-sp-3); font-size: var(--gh-fs-sm); color: var(--gh-muted); line-height: 1.55; text-align: center; }
  /* Two whole phone screens, side by side. Each column is half the modal, so the pictures stay
     tall-and-narrow (which is what they are) instead of being letterboxed. */
  .ann-shots { display: flex; gap: var(--gh-sp-2); margin: 0 0 var(--gh-sp-3); }
  .ann-shot { flex: 1 1 0; min-width: 0; margin: 0; }
  /* A whole phone screen is tall. On a short phone, cap the height and crop from the TOP
     (object-position: bottom) rather than shrinking the picture: the bottom is where the button
     and the arrow are, and it keeps Got it / Try it above the fold. */
  /* width/height attributes on the <img> give the box its aspect ratio before the bytes arrive, so
     a slow picture leaves a correctly-sized gap instead of shoving the buttons down when it lands. */
  .ann-shot img { display: block; width: 100%; height: auto; max-height: 40vh;
                  object-fit: cover; object-position: bottom; border-radius: var(--gh-r-md);
                  border: 1px solid var(--gh-border); background: var(--gh-surface-2); }
  .ann-shot figcaption { margin-top: var(--gh-sp-1); font-size: var(--gh-fs-xs); font-weight: 700; color: var(--gh-muted); }
  /* Small phones (an SE is 667 tall): crop harder still, so the buttons stay above the fold even
     with a long body. Measured against the real 375x667 layout, not guessed. */
  @media (max-height: 740px) { .ann-shot img { max-height: 30vh; } }
  /* Two buttons, one row, always. The Spanish pair ("Entendido" + "Pruébalo ahora") wrapped onto
     two lines at 393px and read as one stacked on the other; splitting the row equally means the
     labels can grow without ever wrapping the row. */
  .ann-modal .gh-modal__actions { justify-content: center; flex-wrap: nowrap; }
  .ann-modal .gh-modal__actions .gh-btn { flex: 1 1 0; min-width: 0; padding: 0 var(--gh-sp-3); }
  `;
  document.head.appendChild(style);
}

/**
 * Show one announcement. `onAction(action)` fires when the player taps its call-to-action (the hub
 * passes a handler that opens the report form for `action: 'bug-report'`). Resolves once closed.
 */
export function showAnnouncement(a, { onAction } = {}) {
  if (a && a.pages === 'lb2-intro') return showLb2Intro(a);
  return new Promise((resolve) => {
    if (!a || !a.id) { resolve(); return; }
    ensureCss();
    const lang = getLang();
    const host = document.createElement('div');
    host.className = 'gh-overlay ann-overlay';
    const body = textFor(a.body, lang);
    const paras = (Array.isArray(body) ? body : [body]).filter(Boolean);
    // Dark shots when the resolved theme is dark, so a light screenshot never glares out of a dark
    // popup. Read through theme.js (never a bare matchMedia) so an explicit 'light' choice on a
    // dark phone still gets the light picture.
    const dark = resolvedTheme() === 'dark';
    const shots = Array.isArray(a.shots) ? a.shots : [];
    // The tile art is trusted repo source (js/game-art.js), the only unescaped HTML here; an id
    // with no art simply drops the picture rather than leaving an empty frame, the same way a
    // missing screenshot removes its own figure.
    const tileArt = (a.tile && GAME_ART[a.tile.art]) || '';
    const tileName = (a.tile && textFor(a.tile.name, lang)) || '';
    host.innerHTML = `
      <div class="gh-modal ann-modal" role="dialog" aria-modal="true" aria-label="${esc(t('ann_dialog_aria'))}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${esc(t('bug_close'))}">&times;</button>
        ${a.icon ? `<div class="ann-icon" aria-hidden="true">${esc(a.icon)}</div>` : ''}
        ${a.badge ? `<div><span class="ann-badge">${esc(t('hub_new_tag'))}</span></div>` : ''}
        <h2>${esc(textFor(a.title, lang))}</h2>
        ${tileArt ? `<div class="ann-tile" aria-hidden="true">${tileArt}</div>
        <p class="ann-tilename">${esc(tileName)}</p>` : ''}
        ${paras.map((p) => `<p class="ann-body">${esc(p)}</p>`).join('')}
        ${shots.length ? '<div class="ann-shots">' : ''}${shots.map((s) => {
          const cap = esc(textFor(s.caption, lang) || '');
          const path = (dark && textFor(s.imgDark, lang)) || textFor(s.img, lang);
          const src = new URL('../' + path, import.meta.url).href;
          return `<figure class="ann-shot">
            <img src="${esc(src)}" alt="${cap}" width="393" height="852" decoding="async"
                 fetchpriority="high" onerror="this.closest('.ann-shot').remove()">
            ${cap ? `<figcaption>${cap}</figcaption>` : ''}
          </figure>`;
        }).join('')}${shots.length ? '</div>' : ''}
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn gh-btn--ghost" data-role="dismiss">${esc(t('ann_dismiss'))}</button>
          ${a.cta ? `<button type="button" class="gh-btn gh-btn--primary" data-role="cta">${esc(textFor(a.cta, lang))}</button>` : ''}
        </div>
      </div>`;
    document.body.appendChild(host);

    let done = false;
    const finish = (action) => {
      if (done) return;
      done = true;
      markSeen(a.id);
      document.removeEventListener('keydown', onKey);
      host.remove();
      if (action && typeof onAction === 'function') {
        try { onAction(action); } catch (err) { console.error('[announce] action failed', err); }
      }
      resolve();
    };
    const onKey = (e) => { if (e.key === 'Escape') finish(null); };
    document.addEventListener('keydown', onKey);
    host.addEventListener('click', (e) => { if (e.target === host) finish(null); });
    host.querySelector('[data-role="close"]').addEventListener('click', () => finish(null));
    host.querySelector('[data-role="dismiss"]').addEventListener('click', () => finish(null));
    const cta = host.querySelector('[data-role="cta"]');
    if (cta) cta.addEventListener('click', () => finish(a.action || 'cta'));
  });
}

// --- The new leaderboard's intro (2026-11-03, Matt's approved mockup) ------------------------------------
// Two pages of one height (the buttons never move), then "Show me where": the screen dims around the
// Leaderboard button, then a game, then "See how scores are calculated", and the player taps each one.
// Strings below are constants (the only HTML here, with <br> where Matt wanted the line broken).
const LBI = {
  en: { title: 'New leaderboard layout<br>and point system', p1: 'Points are now awarded<br>for every win', comp: 'Computer', and: 'and', online: 'Online',
    eqL: '<span>Harder</span><br><span>difficulties/modes</span>', eqR: '<span>more points</span>', p2: 'Medals go to the players<br>with the most points.',
    p3: 'Each game is different.<br>Find this on its leaderboard:', how: 'See how scores are calculated', next: 'Next', ok: 'OK', where: 'Show me where',
    tap: 'Tap here', pick: 'Pick a game', alt: 'Example leaderboard', isNew: 'NEW', skip: 'Skip' },
  es: { title: 'Nueva clasificación<br>y sistema de puntos', p1: 'Ahora cada victoria<br>da puntos', comp: 'Ordenador', and: 'y', online: 'En línea',
    eqL: '<span>Niveles/modos</span><br><span>más difíciles</span>', eqR: '<span>más puntos</span>', p2: 'Las medallas son para<br>quien tenga más puntos.',
    p3: 'Cada juego es distinto.<br>Búscalo en su clasificación:', how: 'Ver cómo se calculan los puntos', next: 'Siguiente', ok: 'Vale', where: 'Muéstramelo',
    tap: 'Toca aquí', pick: 'Elige un juego', alt: 'Ejemplo de clasificación', isNew: 'NUEVO', skip: 'Saltar' },
};
const MP_ICON = '<svg class="lbi-mp" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 19a6 6 0 0 1 12 0"/><circle cx="16.5" cy="9" r="2.6"/><path d="M15.5 13.6A5 5 0 0 1 21 18.5"/></svg>';
function ensureLbiCss() {
  if (document.getElementById('lbi-css')) return;
  const el = document.createElement('style');
  el.id = 'lbi-css';
  el.textContent = `
.lbi-modal{text-align:center}
.lbi-title{font-size:min(25px,6.1vw);font-weight:800;line-height:1.2;letter-spacing:-.01em;margin:6px 0 14px;white-space:nowrap}
.lbi-pages{display:grid}
.lbi-page{grid-area:1/1;display:flex;flex-direction:column;min-width:0}
.lbi-page.off{visibility:hidden;pointer-events:none}
.lbi-mid{flex:1;display:flex;flex-direction:column;justify-content:space-evenly}
.lbi-p{font-size:20px;font-weight:600;line-height:1.3;margin:6px 0;text-wrap:balance}
.lbi-emo{font-size:1.25em;vertical-align:-.12em}
.lbi-mp{width:1.25em;height:1.25em;vertical-align:-.25em}
.lbi-eq{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;column-gap:8px;margin:6px -12px;font-size:20px;font-weight:600;line-height:1.25}
.lbi-eq span{white-space:nowrap}
.lbi-eq-m{font-size:1.5em;line-height:1}
.lbi-cards{text-align:left;margin:8px -12px 0}
.lbi-cards .lbps-lb{white-space:nowrap}
.lbi-img{width:100%;height:auto;border-radius:12px;display:block;margin:2px 0 10px}
.lbi-fake{min-height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:600;border:1px solid #E2E5EA;color:#1F5FD1;margin:0 0 4px}
.lbi-foot{margin-top:auto}
.lbi-dots{display:flex;gap:7px;justify-content:center;margin:14px 0 0}
.lbi-dots span{width:8px;height:8px;border-radius:4px;background:#c9ced6}
.lbi-dots span.on{background:#1f5fd1}
.lbi-foot .gh-btn{font-size:17px;white-space:nowrap}
.lbi-wide{flex:1}
.lbi-pill{border:1.5px solid #c9ced6;border-radius:999px}
:root.gh-dark .lbi-fake{color:#7AA7FF;border-color:#3a4150}
:root.gh-dark .lbi-dots span{background:#4a5160}
:root.gh-dark .lbi-dots span.on{background:#7AA7FF}
:root.gh-dark .lbi-pill{border-color:#4a5160}
.lbi-hole{position:fixed;z-index:1000;border-radius:12px;box-shadow:0 0 0 3px #ffce3a,0 0 0 9999px rgba(5,10,20,.55);pointer-events:none;transition:left .15s,top .15s,width .15s,height .15s}
.lbi-tip{z-index:1001!important}
.lbi-tip.up::after{top:-10px;bottom:auto;transform:rotate(225deg)}
.lbi-skip{position:fixed;z-index:1002;top:calc(env(safe-area-inset-top,0px) + 10px);right:12px;min-height:40px;padding:0 16px;border-radius:20px;border:0;background:#fff;color:#111;font:inherit;font-weight:700;font-size:15px}`;
  document.head.appendChild(el);
}
function showLb2Intro(a) {
  return new Promise((resolve) => {
    ensureCss(); ensureLbiCss();
    const lang = getLang() === 'es' ? 'es' : 'en';
    const L = LBI[lang];
    const dark = resolvedTheme() === 'dark';
    const img = new URL(`../img/lb2-intro-board-${lang}${dark ? '-dark' : ''}.png`, import.meta.url).href;
    const dots = (n) => `<div class="lbi-dots">${[1, 2].map((i) => `<span class="${i === n ? 'on' : ''}"></span>`).join('')}</div>`;
    const host = document.createElement('div');
    host.className = 'gh-overlay ann-overlay';
    host.innerHTML = `
      <div class="gh-modal ann-modal lbi-modal" role="dialog" aria-modal="true" aria-label="${esc(t('ann_dialog_aria'))}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${esc(t('bug_close'))}">&times;</button>
        <div><span class="ann-badge">${L.isNew}</span></div>
        <h2 class="lbi-title">${L.title}</h2>
        <div class="lbi-pages">
          <div class="lbi-page" data-page="1"><div class="lbi-mid">
            <p class="lbi-p">${L.p1}</p>
            <p class="lbi-p">${L.comp} <span class="lbi-emo" aria-hidden="true">🤖</span> ${L.and} ${MP_ICON} ${L.online}</p>
            <div class="lbi-eq"><div class="lbi-eq-l">${L.eqL}</div><div class="lbi-eq-m">=</div><div class="lbi-eq-r">${L.eqR}</div></div>
            <div class="lbps lbi-cards" data-role="cards"></div>
          </div><div class="lbi-foot">${dots(1)}<div class="gh-modal__actions"><button type="button" class="gh-btn gh-btn--primary lbi-wide" data-role="next">${L.next}</button></div></div></div>
          <div class="lbi-page off" data-page="2" aria-hidden="true"><div class="lbi-mid">
            <p class="lbi-p">${L.p2}</p>
            <img class="lbi-img" src="${esc(img)}" alt="${esc(L.alt)}" width="381" height="272" decoding="async">
            <p class="lbi-p">${L.p3}</p>
            <div class="lbi-fake" aria-hidden="true">${L.how}</div>
          </div><div class="lbi-foot">${dots(2)}<div class="gh-modal__actions"><button type="button" class="gh-btn gh-btn--ghost lbi-pill" data-role="dismiss">${L.ok}</button><button type="button" class="gh-btn gh-btn--primary lbi-wide" data-role="where">${L.where}</button></div></div></div>
        </div>
      </div>`;
    document.body.appendChild(host);
    // Page 1's example: Filler's own points cards (Vs computer, Online), from the same sheet the board's (i) shows.
    import('./lb-points-sheet.js').then((S) => {
      S.ensurePointsSheetCss();
      const tmp = document.createElement('div');
      tmp.innerHTML = S.pointsSheetHTML('filler');
      const cards = [...tmp.querySelectorAll('.lbps-card')].filter((c) => !c.classList.contains('lbps-cap')).slice(0, 2);
      const box = host.querySelector('[data-role="cards"]');
      if (box) cards.forEach((c) => box.appendChild(c));
    }).catch((err) => console.warn('[announce] points example failed', err));
    // The "=" stays in the middle of the screen: both sides are equal halves, so the words shrink (never wrap) to fit.
    // Fitted again once the popup is laid out (its stylesheet can land a moment after it opens).
    const eq = host.querySelector('.lbi-eq');
    const fitEq = () => {
      if (!eq || !eq.isConnected) return;
      for (let f = 20; f >= 13; f -= 0.5) {
        eq.style.fontSize = f + 'px';
        const spans = [...eq.querySelectorAll('.lbi-eq-l span, .lbi-eq-r span')];
        const sides = [...eq.querySelectorAll('.lbi-eq-l, .lbi-eq-r')];
        const room = Math.min(...sides.map((x) => x.getBoundingClientRect().width));
        if (room > 0 && spans.every((x) => x.getBoundingClientRect().width <= room + 0.5)) break;
      }
    };
    fitEq();
    requestAnimationFrame(fitEq);
    [150, 500, 1500].forEach((ms) => setTimeout(fitEq, ms));
    let done = false;
    const finish = (guide) => {
      if (done) return;
      done = true;
      markSeen(a.id);
      document.removeEventListener('keydown', onKey);
      host.remove();
      if (guide) runLbGuide(L);
      resolve();
    };
    const onKey = (e) => { if (e.key === 'Escape') finish(false); };
    document.addEventListener('keydown', onKey);
    const page = (n) => host.querySelectorAll('.lbi-page').forEach((el) => {
      const on = el.dataset.page === String(n);
      el.classList.toggle('off', !on);
      el.setAttribute('aria-hidden', on ? 'false' : 'true');
    });
    host.addEventListener('click', (e) => {
      if (e.target === host) { finish(false); return; }
      const r = e.target.closest('[data-role]');
      if (!r) return;
      if (r.dataset.role === 'close' || r.dataset.role === 'dismiss') finish(false);
      else if (r.dataset.role === 'next') page(2);
      else if (r.dataset.role === 'where') finish(true);
    });
  });
}
/** "Show me where": dim everything but one control, a bubble on it, the player taps it; three steps. Ends on the
 *  points sheet, on Skip, when the leaderboard is closed mid-way, or after 3 minutes. Never taps anything itself. */
function runLbGuide(L) {
  const vis = (sel) => [...document.querySelectorAll(sel)].find((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) || null;
  const steps = [
    { find: () => vis('.hub-tabs [data-tab="leaderboard"]') || vis('[data-role="leaderboard"]'), text: L.tap },
    { find: () => vis('.lb2 .lb2-scroll [data-act="game"]'), text: L.pick },
    { find: () => vis('.lb2 .lb2-more[data-act="info"]'), text: L.tap },
  ];
  const hole = document.createElement('div'); hole.className = 'lbi-hole';
  const tip = document.createElement('div'); tip.className = 'hub-tip lbi-tip is-in'; tip.setAttribute('role', 'status');
  const skip = document.createElement('button'); skip.type = 'button'; skip.className = 'lbi-skip'; skip.textContent = L.skip;
  document.body.append(hole, tip, skip);
  let i = 0, shownFor = -1, timer = 0;
  const started = Date.now();
  const end = () => { clearInterval(timer); hole.remove(); tip.remove(); skip.remove(); };
  skip.addEventListener('click', end);
  const tick = () => {
    if (Date.now() - started > 180000) { end(); return; }
    if (i >= 1 && !document.querySelector('.lb2')) { end(); return; }        // the leaderboard was closed
    if (i === 2 && document.querySelector('.lb2 .lb2-sheet')) { end(); return; }   // the points sheet is open
    if (i < 2 && steps[i + 1].find()) i++;                                    // they tapped the lit control
    const el = steps[i].find();
    if (!el) { hole.style.opacity = '0'; tip.style.opacity = '0'; return; }
    if (shownFor !== i) { shownFor = i; if (i > 0) el.scrollIntoView({ block: 'center' }); }
    const r = el.getBoundingClientRect();
    hole.style.opacity = '1'; tip.style.opacity = '1';
    Object.assign(hole.style, { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
    tip.innerHTML = `<span class="hub-tip-head">${steps[i].text}</span><span class="hub-tip-step">${i + 1}/3</span>`;
    const w = tip.getBoundingClientRect().width, h = tip.getBoundingClientRect().height;
    const left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2));
    tip.style.left = `${left}px`;
    tip.style.bottom = 'auto';
    tip.style.setProperty('--tail', `${r.left + r.width / 2 - left - 8}px`);
    const below = r.top < window.innerHeight / 2;
    tip.classList.toggle('up', below);
    tip.style.top = below ? `${r.bottom + 18}px` : `${r.top - h - 18}px`;
  };
  timer = setInterval(tick, 150);
  tick();
}

export default { showAnnouncement };
