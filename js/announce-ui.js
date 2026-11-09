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
  .ann-overlay { z-index: 290; padding: max(var(--gh-sp-4), var(--gh-st, env(safe-area-inset-top))) var(--gh-sp-4)
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
  en: { title: 'New leaderboard layout<br>and point system', p1: 'Every win earns points.<br>Harder wins earn more.', diff: 'Difficulty',
    per: 'Points<br>per win', online: 'Online', p2: 'Most points wins gold.',
    p3: 'Each game is different.<br>Find this on its leaderboard:', how: 'See how scores are calculated', next: 'Next', ok: 'OK', where: 'Show me where',
    tap: 'Tap here', pick: 'Pick a game', alt: 'Example leaderboard', isNew: 'NEW', skip: 'Skip' },
  es: { title: 'Nueva clasificación<br>y sistema de puntos', p1: 'Cada victoria da puntos.<br>Las más difíciles, más.', diff: 'Dificultad',
    per: 'Puntos<br>por victoria', online: 'En línea', p2: 'El oro es para quien más puntos tiene.',
    p3: 'Cada juego es distinto.<br>Búscalo en su clasificación:', how: 'Ver cómo se calculan los puntos', next: 'Siguiente', ok: 'Vale', where: 'Muéstramelo',
    tap: 'Toca aquí', pick: 'Elige un juego', alt: 'Ejemplo de clasificación', isNew: 'NUEVO', skip: 'Saltar' },
};
const LBI_LEVEL = ['gs_diff_beginner', 'gs_diff_intermediate', 'gs_diff_pro'];
const PEOPLE_ICON = '<svg viewBox="0 0 22 20" aria-hidden="true"><circle cx="7" cy="6.5" r="3.6" fill="currentColor"/><circle cx="15" cy="6.5" r="3.6" fill="currentColor"/><path d="M0.5 19c0-3.8 2.9-6.6 6.5-6.6s6.5 2.8 6.5 6.6zM8.5 19c0-3.8 2.9-6.6 6.5-6.6s6.5 2.8 6.5 6.6z" fill="currentColor"/></svg>';
// Mockup v4 (Matt, 2026-11-03: "It feels chaotic... The title isn't a title"): a medal, NEW and a real title over a rule;
// ONE short grey line and ONE picture per page; the popup as tall as its taller page, never stretched.
function ensureLbiCss() {
  if (document.getElementById('lbi-css')) return;
  const el = document.createElement('style');
  el.id = 'lbi-css';
  el.textContent = `
.lbi-modal{text-align:center;--lbi-dim:#596170;--lbi-line:#E2E5EA;--lbi-card:#F7F8FA;--lbi-head:#EEF0F3;--lbi-gap:#E2E5EA}
:root.gh-dark .lbi-modal{--lbi-dim:#AEB5C1;--lbi-line:#2d333f;--lbi-card:#171b23;--lbi-head:#232834;--lbi-gap:#11141b}
.lbi-hero{display:flex;flex-direction:column;align-items:center;padding:2px 0 14px;margin-bottom:14px;border-bottom:1px solid var(--lbi-line)}
.lbi-medal{width:40px;height:auto;margin-bottom:8px}
.lbi-hero .ann-badge{margin:0 0 10px}
.lbi-modal .lbi-title{font-size:min(27px,6.6vw);font-weight:800;line-height:1.18;letter-spacing:-.015em;margin:0;white-space:nowrap}
.lbi-pages{display:grid}
.lbi-page{grid-area:1/1;display:flex;flex-direction:column;align-items:center;min-width:0}
.lbi-page.off{visibility:hidden;pointer-events:none}
.lbi-p{font-size:18px;font-weight:400;line-height:1.4;color:var(--lbi-dim);margin:0 0 14px;text-wrap:balance}
.lbi-ex{width:100%;border:1px solid var(--lbi-line);border-radius:14px;background:var(--lbi-card);text-align:left;overflow:hidden}
.lbi-exh{display:flex;align-items:center;gap:10px;padding:9px 0 9px 16px;background:var(--lbi-head);font-size:14px;font-weight:700;color:var(--lbi-dim)}
.lbi-exh span:first-child{flex:1}
.lbi-col{width:96px;flex:none;text-align:center;line-height:1.2}
.lbi-r{display:flex;align-items:center;gap:12px;padding:0 0 0 16px;height:58px;border-top:1px solid var(--lbi-line)}
.lbi-r.on{border-top:6px solid var(--lbi-gap)}
.lbi-r .lbi-l{flex:1;font-size:17px}
.lbi-r b{font-size:24px;font-weight:800;font-variant-numeric:tabular-nums}
.lbi-sh{display:inline-flex;width:20px;height:20px;flex:none}
.lbi-sh svg{width:100%;height:100%;display:block}
:root.gh-dark .lbi-sh{background:#fff;border-radius:4px;padding:2px;box-sizing:border-box}
:root.gh-dark .lbi-sh .lb-dshape-t3{fill:#1c2430}
.lbi-ppl{width:20px;display:flex;color:var(--lbi-dim)}
.lbi-ppl svg{width:22px;height:20px}
.lbi-img{width:88%;height:auto;border-radius:12px;display:block;margin:0 0 14px}
.lbi-fake{width:100%;min-height:50px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:600;border:1px solid #E2E5EA;color:#1F5FD1}
.lbi-foot{margin-top:auto;width:100%;padding-top:16px}
.lbi-dots{display:flex;gap:7px;justify-content:center;margin:0 0 14px}
.lbi-dots span{width:8px;height:8px;border-radius:4px;background:#c9ced6}
.lbi-dots span.on{background:#1f5fd1}
.lbi-foot .gh-modal__actions{margin-top:0}
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
.lbi-skip{position:fixed;z-index:1002;top:calc(var(--gh-st, env(safe-area-inset-top,0px)) + 10px);right:12px;min-height:40px;padding:0 16px;border-radius:20px;border:0;background:#fff;color:#111;font:inherit;font-weight:700;font-size:15px}`;
  document.head.appendChild(el);
}
function showLb2Intro(a) {
  // The example's numbers come from the points model (loaded only when this popup opens, as before).
  return Promise.all([import('./lb-points-sheet.js'), import('./difficulty-tiers.js')])
    .catch((err) => { console.warn('[announce] points example failed', err); return [null, null]; })
    .then(([S, D]) => drawLb2Intro(a, S ? S.sheetModel : () => [], D ? D.diffShapeSVG : () => ''));
}
function drawLb2Intro(a, sheetModel, diffShapeSVG) {
  return new Promise((resolve) => {
    ensureCss(); ensureLbiCss();
    const lang = getLang() === 'es' ? 'es' : 'en';
    const L = LBI[lang];
    const dark = resolvedTheme() === 'dark';
    const img = new URL(`../img/lb2-intro-board-${lang}${dark ? '-dark' : ''}.png`, import.meta.url).href;
    const dots = (n) => `<div class="lbi-dots">${[1, 2].map((i) => `<span class="${i === n ? 'on' : ''}"></span>`).join('')}</div>`;
    const medal = new URL('../icons/medal-gold.png', import.meta.url).href;
    // Page 1's example: Filler's points, read from the same model the board's points sheet uses.
    const cards = sheetModel('filler');
    const cpu = (cards.find((c) => c.kind === 'cpu') || { rows: [] }).rows;
    const onl = ((cards.find((c) => c.kind === 'online') || { rows: [] }).rows[0] || {}).pts;
    const shp = (tier) => `<span class="lbi-sh">${diffShapeSVG(tier)}</span>`;
    const rows = cpu.map((r) => `<div class="lbi-r">${shp(r.tier)}<span class="lbi-l">${esc(t(LBI_LEVEL[r.tier - 1]))}</span><b class="lbi-col">${r.pts}</b></div>`).join('')
      + (onl ? `<div class="lbi-r on"><span class="lbi-ppl">${PEOPLE_ICON}</span><span class="lbi-l">${L.online}</span><b class="lbi-col">${onl}</b></div>` : '');
    const host = document.createElement('div');
    host.className = 'gh-overlay ann-overlay';
    host.innerHTML = `
      <div class="gh-modal ann-modal lbi-modal" role="dialog" aria-modal="true" aria-label="${esc(t('ann_dialog_aria'))}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${esc(t('bug_close'))}">&times;</button>
        <div class="lbi-hero"><img class="lbi-medal" src="${esc(medal)}" alt="" width="40" height="58" decoding="async"><span class="ann-badge">${L.isNew}</span>
          <h2 class="lbi-title">${L.title}</h2></div>
        <div class="lbi-pages">
          <div class="lbi-page" data-page="1">
            <p class="lbi-p">${L.p1}</p>
            <div class="lbi-ex"><div class="lbi-exh"><span>${L.diff}</span><span class="lbi-col">${L.per}</span></div>${rows}</div>
            <div class="lbi-foot">${dots(1)}<div class="gh-modal__actions"><button type="button" class="gh-btn gh-btn--primary lbi-wide" data-role="next">${L.next}</button></div></div></div>
          <div class="lbi-page off" data-page="2" aria-hidden="true">
            <p class="lbi-p">${L.p2}</p>
            <img class="lbi-img" src="${esc(img)}" alt="${esc(L.alt)}" width="381" height="272" decoding="async">
            <p class="lbi-p">${L.p3}</p>
            <div class="lbi-fake" aria-hidden="true">${L.how}</div>
            <div class="lbi-foot">${dots(2)}<div class="gh-modal__actions"><button type="button" class="gh-btn gh-btn--ghost lbi-pill" data-role="dismiss">${L.ok}</button><button type="button" class="gh-btn gh-btn--primary lbi-wide" data-role="where">${L.where}</button></div></div></div>
        </div>
      </div>`;
    document.body.appendChild(host);
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
