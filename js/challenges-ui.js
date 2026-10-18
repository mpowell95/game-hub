// js/challenges-ui.js - the hub's MULTIPLAYER screen (was "Challenges", 2026-10-05; reworked
// 2026-10-18). js/challenges.js is the data half for turn-by-turn challenges and carries the
// reasoning; js/mp-records.js reads the live-room games' records.
//
// Matt (2026-10-05): "a button you can press where you can see all your live challenges - if it's
// your turn vs theirs, more info on your records total and against specific players, etc. You should
// also be able to send challenges and jump into games from this page."
// Matt (2026-10-18), from the mockups: one full screen. Your turn on top (Play), their turn as short
// one-line rows, Resign/Cancel/Decline behind a ⋯ button, then every multiplayer game A-Z in ONE grid
// ("I don't like the 'live' or 'anytime'"). A turn-by-turn game opens a pick-a-person sheet; a live
// game opens the game. The record chip ("12-5") opens Records, which also counts the live games.
// "It should say 'your turn' not 'Matt's turn'" - his own exception to the profile-name rule.
//
// THE LAW: this screen renders and writes nothing itself. Opening a match, starting a challenge and
// launching a game are handed back to js/hub.js (`onOpen` / `onChallenge` / `onLaunch`). Cancel /
// Decline / Resign go through js/challenges.js `endMatch` to the game's own mp.js writer, which
// verifies by re-read and deletes nothing. Records only READ (js/mp-records.js).
//
// Results are told apart by a MARK (check, cross, equals) and a WORD, never by colour alone (Matt is
// red/green colourblind). Your-turn rows carry a heavier border AND a "Play" pill with a word.
//
// Entry point (lazily imported by js/hub.js):
//   openChallenges({ games: [{id, name}], live: [{id, name}], onOpen(gameId, matchId),
//                    onChallenge(gameId, them), onLaunch(gameId), onClose() })

import { summarize, loadAll, watchAll, readOpponents, myCode, endAction, endMatch } from './challenges.js';
import { loadLiveRecords, mergeRecords } from './mp-records.js';
import { GAME_ART } from './game-art.js';
import { makeT, getLang } from './i18n.js';
import STRINGS from './challenges-strings.js';

const t = makeT(STRINGS);
const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let _host = null;
let _onKey = null;
let _unwatch = null;
let _onClose = null;
let _view = 0;                    // bumped on every render; an async render that lost the race stops

function current(gen) { return gen === _view && !!_host; }

export function closeChallenges() {
  _view += 1;
  if (_unwatch) { try { _unwatch(); } catch { /* gone */ } _unwatch = null; }
  if (_onKey) { document.removeEventListener('keydown', _onKey); _onKey = null; }
  const wasOpen = !!_host;
  if (_host) { _host.remove(); _host = null; }
  const cb = _onClose; _onClose = null;
  if (wasOpen && cb) { try { cb(); } catch { /* the hub repaints itself */ } }
}

export function isChallengesOpen() { return !!_host; }

// --- css ------------------------------------------------------------------------------------------

function ensureCss() {
  if (!document.querySelector('link[data-gh-ui-css="1"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../css/ui.css', import.meta.url).href;
    link.setAttribute('data-gh-ui-css', '1');
    document.head.appendChild(link);
  }
  if (document.getElementById('cx-css')) return;
  const style = document.createElement('style');
  style.id = 'cx-css';
  // (A JS template literal: never put a backtick in these comments.)
  style.textContent = `
  /* A full screen, not a pop-up (Matt, 2026-10-18). The page does not scroll; .cx-scroll does, so
     the title row stays put. In the compact layout it stops above the bottom tab bar and sits
     under it, so the tabs stay usable. */
  .cx-overlay { position: fixed; inset: 0; z-index: 300; display: flex; justify-content: center;
                background: var(--gh-bg); color: var(--gh-ink); overscroll-behavior: contain;
                padding: env(safe-area-inset-top, 0px) 0 env(safe-area-inset-bottom, 0px); }
  html.gh-compact .cx-overlay { z-index: 19; padding-bottom: calc(64px + max(0px, env(safe-area-inset-bottom, 0px) - 16px)); }
  .cx-page { position: relative; width: min(560px, 100%); height: 100%; display: flex; flex-direction: column;
             font-family: var(--gh-font); }
  .cx-top { flex: 0 0 auto; display: flex; align-items: center; gap: 10px;
            padding: 12px max(16px, env(safe-area-inset-right, 0px)) 10px max(16px, env(safe-area-inset-left, 0px)); }
  .cx-back { flex: 0 0 auto; width: 40px; height: 40px; border-radius: 50%; border: 0; padding: 0;
             background: var(--gh-surface-2); color: var(--gh-ink); font-size: 24px; line-height: 1; font-weight: 700;
             cursor: pointer; touch-action: manipulation; display: grid; place-items: center; }
  .cx-head-emoji { flex: 0 0 auto; font-size: 26px; line-height: 1; }
  .cx-title { flex: 1 1 auto; min-width: 0; margin: 0; font-size: var(--gh-fs-xl); font-weight: 900; line-height: 1.15;
              white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cx-rec { flex: 0 0 auto; min-height: 36px; padding: 0 12px; border-radius: var(--gh-r-pill);
            border: 1px solid var(--gh-border-strong); background: var(--gh-surface); color: var(--gh-ink);
            font-family: var(--gh-font); font-size: var(--gh-fs-sm); font-weight: 800; font-variant-numeric: tabular-nums;
            cursor: pointer; touch-action: manipulation; }
  .cx-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch;
               padding: 0 max(16px, env(safe-area-inset-right, 0px)) 20px max(16px, env(safe-area-inset-left, 0px)); }
  .cx-foot { flex: 0 0 auto; padding: 10px max(16px, env(safe-area-inset-right, 0px)) 14px max(16px, env(safe-area-inset-left, 0px)); }
  .cx-note { margin: var(--gh-sp-2) 0 var(--gh-sp-3); font-size: var(--gh-fs-sm); color: var(--gh-muted); line-height: 1.5; }
  .cx-warn { margin: 0 0 var(--gh-sp-3); font-size: var(--gh-fs-xs); color: var(--gh-muted); }
  .cx-h { display: flex; align-items: baseline; gap: 8px; margin: 18px 0 8px;
          font-size: var(--gh-fs-xs); font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
          color: var(--gh-muted); }
  .cx-scroll > .cx-h:first-child, .cx-scroll > .cx-flash + .cx-h { margin-top: 4px; }
  .cx-h-n { font-variant-numeric: tabular-nums; }
  .cx-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .cx-list.is-tight { gap: 6px; }
  .cx-thumb { flex: 0 0 auto; width: 46px; height: 29px; border-radius: 7px; overflow: hidden; background: var(--gh-surface-2); }
  .cx-thumb svg { display: block; width: 100%; height: 100%; }
  /* One live match: the row (opens it) and its ⋯ (what else you can do) side by side. */
  .cx-live { display: flex; align-items: center; gap: 8px; min-height: 58px; padding: 6px 4px 6px 10px;
             border: 1px solid var(--gh-border); border-radius: 14px; background: var(--gh-surface); }
  .cx-live.is-yours { border: 2px solid var(--gh-accent); padding: 5px 3px 5px 9px; }
  .cx-live.is-slim { min-height: 46px; padding: 4px 2px 4px 8px; border-radius: 12px; }
  .cx-open { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 10px; align-self: stretch;
             padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left;
             cursor: pointer; touch-action: manipulation; }
  .cx-main { flex: 1 1 auto; min-width: 0; }
  .cx-name { display: block; font-size: var(--gh-fs-md); font-weight: 800; line-height: 1.2;
             white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cx-name-emoji { margin-right: 4px; }
  .cx-sub { display: block; margin-top: 2px; font-size: 13px; color: var(--gh-muted);
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cx-left { flex: 0 0 auto; font-size: 13px; font-weight: 700; color: var(--gh-muted); font-variant-numeric: tabular-nums; }
  .cx-pill { flex: 0 0 auto; padding: 7px 12px; border-radius: var(--gh-r-pill); background: var(--gh-accent);
             color: var(--gh-accent-ink); font-size: var(--gh-fs-sm); font-weight: 800; white-space: nowrap; }
  .cx-more { flex: 0 0 auto; width: 36px; height: 40px; border: 0; padding: 0; border-radius: 10px; background: none;
             color: var(--gh-muted); font-size: 20px; font-weight: 900; letter-spacing: 1px; line-height: 1;
             cursor: pointer; touch-action: manipulation; }
  .cx-pop { position: absolute; z-index: 5; min-width: 150px; padding: 6px; border-radius: 14px;
            border: 1px solid var(--gh-border-strong); background: var(--gh-surface-2); box-shadow: var(--gh-sh-4); }
  .cx-pop button { display: block; width: 100%; min-height: 44px; padding: 0 12px; border: 0; border-radius: 10px;
                   background: none; color: var(--gh-ink); font-family: var(--gh-font); font-size: var(--gh-fs-md);
                   font-weight: 800; text-align: left; cursor: pointer; touch-action: manipulation; }
  /* The games: the launcher's own tile art, three across, the name under it. */
  .cx-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px 10px; }
  .cx-tile { min-width: 0; padding: 0; border: 0; background: none; color: var(--gh-ink); font-family: var(--gh-font);
             cursor: pointer; touch-action: manipulation; }
  .cx-tile-art { display: block; aspect-ratio: 16 / 9; max-width: 100%; border-radius: 12px; overflow: hidden; }
  .cx-tile-art svg { display: block; width: 100%; height: 100%; }
  .cx-tile-name { display: block; margin-top: 5px; font-size: 12px; font-weight: 700; line-height: 1.25; text-align: center;
                  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  /* Records */
  .cx-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(80px, 1fr)); gap: 10px; }
  .cx-stat { padding: 12px 8px; border-radius: 16px; background: var(--gh-surface-2); text-align: center; }
  .cx-stat-n { display: block; font-size: 30px; font-weight: 900; font-variant-numeric: tabular-nums; line-height: 1.1; }
  .cx-stat-l { display: block; margin-top: 2px; font-size: 13px; color: var(--gh-muted); font-weight: 700; }
  .cx-card { border: 1px solid var(--gh-border); border-radius: 16px; background: var(--gh-surface); padding: 0 12px; }
  .cx-lrow { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 46px; padding: 6px 0;
             border: 0; border-bottom: 1px solid var(--gh-border); background: none; color: var(--gh-ink);
             font-family: var(--gh-font); text-align: left; }
  .cx-card > .cx-lrow:last-child { border-bottom: 0; }
  button.cx-lrow { cursor: pointer; touch-action: manipulation; }
  .cx-le { flex: 0 0 auto; font-size: 22px; line-height: 1; }
  .cx-ln { flex: 1 1 auto; min-width: 0; font-size: 15px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cx-ln small { display: block; font-size: 12px; font-weight: 700; color: var(--gh-muted); }
  .cx-lr { flex: 0 0 auto; font-size: 15px; font-weight: 900; font-variant-numeric: tabular-nums; }
  .cx-lr.is-dim { font-size: 12px; font-weight: 700; color: var(--gh-muted); }
  .cx-chev { flex: 0 0 auto; color: var(--gh-muted); font-size: 20px; line-height: 1; }
  .cx-mark { flex: 0 0 auto; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center;
             font-size: 14px; font-weight: 900; border: 2px solid var(--gh-border-strong); color: var(--gh-ink); }
  .cx-mark.is-won { background: var(--gh-ink); color: var(--gh-surface); border-color: var(--gh-ink); }
  .cx-flash { margin: 0 0 var(--gh-sp-3); padding: 10px var(--gh-sp-3); border: 1px solid var(--gh-border);
              border-left: 4px solid var(--gh-accent); border-radius: var(--gh-r-md); background: var(--gh-surface-2);
              font-size: var(--gh-fs-sm); font-weight: 700; }
  .cx-confirm { font-size: var(--gh-fs-md); line-height: 1.5; margin: 0 0 var(--gh-sp-3); }
  .cx-err { font-size: var(--gh-fs-sm); font-weight: 700; margin: 0 0 var(--gh-sp-3); }
  .cx-foot .gh-btn + .gh-btn { margin-top: var(--gh-sp-2); }
  /* The pick-a-person sheet, over a dimmed screen. */
  .cx-dim { position: absolute; inset: 0; z-index: 6; background: rgba(5, 10, 20, .55); }
  .cx-sheet { position: absolute; left: 0; right: 0; bottom: 0; z-index: 7; max-height: 82%; display: flex; flex-direction: column;
              border-radius: 22px 22px 0 0; background: var(--gh-surface); box-shadow: var(--gh-sh-4);
              padding: 14px max(16px, env(safe-area-inset-right, 0px)) 14px max(16px, env(safe-area-inset-left, 0px)); }
  .cx-sh { display: flex; align-items: center; gap: 12px; }
  .cx-sh .cx-thumb { width: 58px; height: 36px; }
  .cx-sh-t { flex: 1 1 auto; min-width: 0; margin: 0; font-size: var(--gh-fs-lg); font-weight: 900;
             white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cx-openg { flex: 0 0 auto; min-height: 40px; }
  .cx-x { flex: 0 0 auto; width: 40px; height: 40px; border-radius: 50%; border: 0; background: var(--gh-surface-2);
          color: var(--gh-muted); font-size: 24px; line-height: 1; cursor: pointer; touch-action: manipulation; }
  .cx-search { width: 100%; margin: 12px 0 10px; }
  .cx-people { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 6px; }
  .cx-person { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 48px; padding: 6px 12px;
               border: 1px solid var(--gh-border); border-radius: 14px; background: none; color: var(--gh-ink);
               font-family: var(--gh-font); text-align: left; cursor: pointer; touch-action: manipulation; }
  .cx-person[aria-pressed="true"] { border: 2px solid #ffce3a; padding: 5px 11px; }
  .cx-tick { flex: 0 0 auto; width: 18px; color: #ffce3a; font-weight: 900; }
  .cx-sheet .gh-btn { margin-top: 12px; }
  `;
  document.head.appendChild(style);
}

// --- shell ----------------------------------------------------------------------------------------

function mountOverlay() {
  ensureCss();
  closeChallenges();
  const host = document.createElement('div');
  host.className = 'cx-overlay';
  host.innerHTML = `<div class="cx-page" role="dialog" aria-modal="true" aria-label="${esc(t('cx_title'))}"></div>`;
  document.body.appendChild(host);
  _host = host;
  return host.querySelector('.cx-page');
}

/** One screen: title row (back, optional emoji, title, optional record chip), scroll body, optional foot. */
function shell(card, { title, emoji, back, rec, body, footer }) {
  card.innerHTML = `
    <div class="cx-top">
      <button type="button" class="cx-back" data-role="back" aria-label="${esc(t('cx_back'))}">&#8249;</button>
      ${emoji ? `<span class="cx-head-emoji" aria-hidden="true">${esc(emoji)}</span>` : ''}
      <h2 class="cx-title">${esc(title)}</h2>
      ${rec ? `<button type="button" class="cx-rec" data-role="rec" aria-label="${esc(t('cx_records'))}">${esc(rec)}</button>` : ''}
    </div>
    <div class="cx-scroll">${body}</div>
    ${footer ? `<div class="cx-foot">${footer}</div>` : ''}`;
  card.querySelector('[data-role="back"]').addEventListener('click', back || closeChallenges);
}

// --- small render helpers -------------------------------------------------------------------------

const art = (id) => GAME_ART[id] || '';
const thumb = (id) => `<span class="cx-thumb" aria-hidden="true">${art(id)}</span>`;

function whenText(atMs) {
  const n = Number(atMs) || 0;
  if (!n) return '';
  return new Date(n).toLocaleDateString(getLang() === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short' });
}

/** "4–2", "4–2–1" with draws. */
function wl(o) {
  const d = (o.draw | 0) > 0 ? `–${o.draw | 0}` : '';
  return `${o.won | 0}–${o.lost | 0}${d}`;
}

/** The few game-specific words under a row: which game, and its format. */
function subLine(r, gameName) {
  const i = r.info || {};
  const bits = [gameName(r.game)];
  if (r.game === 'darts' && i.kind) bits.push(i.kind === 'cricket' ? t('cx_cricket') : i.kind === 'cricket-order' ? t('cx_cricket_order') : i.kind);
  if (r.game === 'skeeball') {
    if (i.all) bits.push(t('cx_all_machines'));
    else if (i.n > 1) bits.push(t('cx_n_games', { n: i.n }));
    else if (i.boardName) bits.push(i.boardName);
  }
  if (i.su) bits.push(t('cx_straight_up'));
  if (i.series > 1) bits.push(t('cx_game_of', { n: i.seriesNo, m: i.series }));
  const left = untilText(r.expires);
  if (left) bits.push(left);
  return bits.filter(Boolean).join(' · ');
}

/** "2d" / "5h" until a live match stops waiting (js/challenge-life.js), or '' when it never will. */
function untilText(at, now = Date.now()) {
  const left = (Number(at) || 0) - now;
  if (!(Number(at) > 0) || left <= 0) return '';
  const h = Math.ceil(left / 3600000);
  return h >= 24 ? t('cx_d', { n: Math.ceil(h / 24) }) : t('cx_h', { n: h });
}

/** What the ⋯ on a live row offers, from the row (the confirm screen re-reads the match): you sent
 *  it and they have not answered -> cancel; sent to you, unplayed -> decline; else resign. */
const endHint = (r) => (r.open === 'sent' ? 'cancel' : r.open === 'got' ? 'decline' : 'resign');

/** A live match. Your turn: two lines and a Play pill. Their turn: ONE short line (Matt: "They're too
 *  tall"), the time left at the end. `showName: false` (a person's own page) names the game instead. */
function liveRowHTML(r, gameName, { showName = true } = {}) {
  const yours = r.state === 'yours';
  const who = r.name || t('cx_someone');
  const label = showName
    ? `<span class="cx-name-emoji" aria-hidden="true">${esc(r.emoji)}</span>${esc(who)}`
    : esc(gameName(r.game));
  const more = `<button type="button" class="cx-more" data-end-game="${esc(r.game)}" data-end-id="${esc(r.id)}"
      data-hint="${endHint(r)}" aria-label="${esc(t(`cx_end_${endHint(r)}_aria`, { name: who }))}">⋯</button>`;
  if (yours) {
    const sub = showName ? subLine(r, gameName) : subLine(r, () => '');
    return `<li class="cx-live is-yours"><button type="button" class="cx-open" data-game="${esc(r.game)}" data-id="${esc(r.id)}">
        ${thumb(r.game)}
        <span class="cx-main"><span class="cx-name">${label}</span>${sub ? `<span class="cx-sub">${esc(sub)}</span>` : ''}</span>
        <span class="cx-pill">${esc(t('cx_play'))}</span>
      </button>${more}</li>`;
  }
  return `<li class="cx-live is-slim"><button type="button" class="cx-open" data-game="${esc(r.game)}" data-id="${esc(r.id)}">
      ${thumb(r.game)}
      <span class="cx-main"><span class="cx-name">${label}</span></span>
      <span class="cx-left">${esc(untilText(r.expires))}</span>
    </button>${more}</li>`;
}

function resultRowHTML(r, gameName, { showName = true } = {}) {
  const name = r.name || t('cx_someone');
  // Called off or expired (2026-10-13): say who did it. A cancel is always the sender's and a
  // decline always the receiver's, so `sent` says whether it was you. An expired row from before
  // that date carries no `sent`, and keeps its old words.
  const mine = (sent) => (sent ? 'me' : 'them');
  const ended = r.ended === 'cancelled' ? `cx_res_cancelled_${mine(r.sent)}`
    : r.ended === 'declined' ? `cx_res_declined_${mine(!r.sent)}`
      : r.state === 'expired' ? (r.game === 'skeeball' ? 'cx_res_expired' : `cx_res_expired_${r.sent ? 'them' : 'me'}`)
        : '';
  const mark = r.result === 'won' ? '✓' : r.result === 'lost' ? '✗' : r.result === 'draw' ? '=' : '·';
  const quit = r.resigned && (r.result === 'won' || r.result === 'lost')
    ? t(r.result === 'won' ? 'cx_quit_them' : 'cx_quit_me') : '';
  const main = showName ? `<span class="cx-name-emoji" aria-hidden="true">${esc(r.emoji)}</span>${esc(name)}` : esc(gameName(r.game));
  const small = [ended ? t(ended, { name }) : '', showName ? gameName(r.game) : '', quit].filter(Boolean).join(' · ');
  return `<button type="button" class="cx-lrow" data-game="${esc(r.game)}" data-id="${esc(r.id)}">
      <span class="cx-mark${r.result === 'won' ? ' is-won' : ''}" aria-label="${esc(t(r.result === 'won' ? 'cx_won' : r.result === 'lost' ? 'cx_lost' : r.result === 'draw' ? 'cx_drawn' : 'cx_ended'))}">${mark}</span>
      <span class="cx-ln">${main}${small ? `<small>${esc(small)}</small>` : ''}</span>
      <span class="cx-lr is-dim">${esc(whenText(r.updated))}</span>
    </button>`;
}

function statsHTML(o) {
  return `<div class="cx-stats">
      <div class="cx-stat"><span class="cx-stat-n">${o.won | 0}</span><span class="cx-stat-l">✓ ${esc(t('cx_won'))}</span></div>
      <div class="cx-stat"><span class="cx-stat-n">${o.lost | 0}</span><span class="cx-stat-l">✗ ${esc(t('cx_lost'))}</span></div>
      ${(o.draw | 0) > 0 ? `<div class="cx-stat"><span class="cx-stat-n">${o.draw | 0}</span><span class="cx-stat-l">= ${esc(t('cx_drawn'))}</span></div>` : ''}
    </div>`;
}

/** Games with a record, most played first. */
function byGameHTML(byGame, nameOf) {
  const ids = Object.keys(byGame || {}).filter((g) => (byGame[g].played | 0) > 0)
    .sort((a, b) => (byGame[b].played - byGame[a].played) || nameOf(a).localeCompare(nameOf(b), getLang()));
  if (!ids.length) return '';
  return `<h3 class="cx-h">${esc(t('cx_games'))}</h3><div class="cx-card">${ids.map((g) => `<div class="cx-lrow">
      ${thumb(g)}<span class="cx-ln">${esc(nameOf(g))}</span><span class="cx-lr">${esc(wl(byGame[g]))}</span></div>`).join('')}</div>`;
}

// --- entry point ----------------------------------------------------------------------------------

/**
 * Open the Multiplayer screen.
 * @param {{games: {id,name}[], live: {id,name}[], onOpen:(game,id)=>void,
 *          onChallenge:(game,them:{code,name,emoji})=>void, onLaunch:(game)=>void, onClose:()=>void}} opts
 */
export async function openChallenges(opts = {}) {
  const games = Array.isArray(opts.games) ? opts.games.filter((g) => g && g.id) : [];
  const liveGames = Array.isArray(opts.live) ? opts.live.filter((g) => g && g.id && !games.some((c) => c.id === g.id)) : [];
  const ids = games.map((g) => g.id);
  const challengeable = new Set(ids);
  const allGames = games.concat(liveGames);
  const nameOf = (id) => (allGames.find((g) => g.id === id) || {}).name || id;
  const card = mountOverlay();
  _onClose = typeof opts.onClose === 'function' ? opts.onClose : null;
  const gen0 = _view;
  const S = { rows: null, failed: [], live: null, view: 'home', opp: null, people: null, flash: '' };

  const open = (game, id) => { closeChallenges(); if (opts.onOpen) opts.onOpen(game, id); };
  const challenge = (game, them) => { closeChallenges(); if (opts.onChallenge) opts.onChallenge(game, them); };
  const launch = (game) => { closeChallenges(); if (opts.onLaunch) opts.onLaunch(game); };
  const backTo = () => (S.view === 'opp' && S.opp ? () => renderOpponent(S.opp)
    : S.view === 'records' ? () => renderRecords() : () => renderHome());

  // Escape closes the topmost thing: a menu or sheet, else the screen.
  _onKey = (e) => {
    if (e.key !== 'Escape') return;
    if (dropLayers()) return;
    closeChallenges();
  };
  document.addEventListener('keydown', _onKey);
  function dropLayers() {
    const layers = card.querySelectorAll('.cx-pop, .cx-dim, .cx-sheet');
    for (const el of layers) el.remove();
    return layers.length > 0;
  }

  /** The ⋯ menu: one word, the one thing this match allows. Tapping it goes to the confirm screen. */
  function openMenu(btn) {
    dropLayers();
    const hint = btn.dataset.hint;
    const pop = document.createElement('div');
    pop.className = 'cx-pop';
    pop.innerHTML = `<button type="button">${esc(t(`cx_end_${hint}`))}</button>`;
    const host = card.getBoundingClientRect();
    const r = btn.getBoundingClientRect();
    pop.style.right = `${Math.max(8, host.right - r.right)}px`;
    card.appendChild(pop);
    const h = pop.offsetHeight;
    const below = r.bottom - host.top + 4;
    pop.style.top = `${below + h > card.clientHeight - 8 ? Math.max(8, r.top - host.top - h - 4) : below}px`;
    const back = backTo();
    pop.querySelector('button').addEventListener('click', () => renderEnd(btn.dataset.endGame, btn.dataset.endId, back));
    // Any other tap puts it away.
    setTimeout(() => card.addEventListener('pointerdown', (e) => { if (!pop.contains(e.target)) pop.remove(); }, { once: true }), 0);
  }

  const bindRows = (root) => {
    for (const b of root.querySelectorAll('[data-game][data-id]')) b.addEventListener('click', () => open(b.dataset.game, b.dataset.id));
    for (const b of root.querySelectorAll('.cx-more')) b.addEventListener('click', (e) => { e.stopPropagation(); openMenu(b); });
  };
  /** One line at the top of the screen saying what just happened (a cancel, a resignation), once. */
  const flashHTML = () => {
    if (!S.flash) return '';
    const html = `<p class="cx-flash" role="status">${esc(S.flash)}</p>`;
    S.flash = '';
    return html;
  };
  const records = () => mergeRecords(summarize(S.rows || []), S.live || { byGame: {}, people: [] });

  shell(card, { title: t('cx_title'), body: `<p class="cx-note">${esc(t('cx_loading'))}</p>` });
  if (!(await myCode())) {
    // No player code: the live games still open; challenges and records need a code.
    if (current(gen0)) renderHome(true);
    return;
  }

  // --- home ---
  function renderHome(noCode = false) {
    const gen = ++_view;
    S.view = 'home';
    const sum = summarize(S.rows || []);
    const warn = S.failed.length ? `<p class="cx-warn">${esc(t('cx_failed', { games: S.failed.map(nameOf).join(', ') }))}</p>` : '';
    let body = '';
    if (noCode) body = `<p class="cx-note">${esc(t('cx_no_code'))}</p>`;
    else if (S.rows === null) body = `<p class="cx-note">${esc(t('cx_loading'))}</p>`;
    else {
      body = (sum.yours.length ? `<h3 class="cx-h">${esc(t('cx_your_turn'))} <span class="cx-h-n">${sum.yours.length}</span></h3>
          <ul class="cx-list">${sum.yours.map((r) => liveRowHTML(r, nameOf)).join('')}</ul>` : '')
        + (sum.theirs.length ? `<h3 class="cx-h">${esc(t('cx_their_turn'))} <span class="cx-h-n">${sum.theirs.length}</span></h3>
          <ul class="cx-list is-tight">${sum.theirs.map((r) => liveRowHTML(r, nameOf)).join('')}</ul>` : '');
    }
    const lang = getLang();
    const tiles = allGames.slice().sort((a, b) => a.name.localeCompare(b.name, lang));
    body += tiles.length ? `<h3 class="cx-h">${esc(t('cx_games'))}</h3>
      <div class="cx-tiles">${tiles.map((g) => `<button type="button" class="cx-tile" data-tile="${esc(g.id)}">
          <span class="cx-tile-art" aria-hidden="true">${art(g.id)}</span><span class="cx-tile-name">${esc(g.name)}</span>
        </button>`).join('')}</div>` : '';
    const tot = records().total;
    shell(card, { title: t('cx_title'), rec: noCode ? '' : `${tot.won}–${tot.lost}`, body: flashHTML() + warn + body });
    if (!current(gen)) return;
    const recBtn = card.querySelector('[data-role="rec"]');
    if (recBtn) recBtn.addEventListener('click', () => renderRecords());
    for (const b of card.querySelectorAll('[data-tile]')) {
      b.addEventListener('click', () => {
        const id = b.dataset.tile;
        if (challengeable.has(id) && !noCode) renderPickPerson(id);
        else launch(id);
      });
    }
    bindRows(card);
  }

  // --- a turn-by-turn game: who to challenge (the game's own screen takes it from there) ---
  async function renderPickPerson(game) {
    dropLayers();
    const sheetGen = _view;
    const dim = document.createElement('div');
    dim.className = 'cx-dim';
    const sheet = document.createElement('div');
    sheet.className = 'cx-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', nameOf(game));
    sheet.innerHTML = `<div class="cx-sh">${thumb(game)}<h3 class="cx-sh-t">${esc(nameOf(game))}</h3>
        <button type="button" class="gh-btn gh-btn--ghost gh-btn--sm cx-openg" data-role="opengame">${esc(t('cx_open'))}</button>
        <button type="button" class="cx-x" data-role="x" aria-label="${esc(t('cx_close'))}">&times;</button></div>
      <input type="search" class="gh-input cx-search" placeholder="${esc(t('cx_search'))}" aria-label="${esc(t('cx_search'))}" autocomplete="off">
      <div class="cx-people" data-role="people"><p class="cx-note">${esc(t('cx_loading'))}</p></div>
      <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="go" disabled>${esc(t('cx_challenge'))}</button>`;
    card.appendChild(dim);
    card.appendChild(sheet);
    const shut = () => { dim.remove(); sheet.remove(); };
    dim.addEventListener('click', shut);
    sheet.querySelector('[data-role="x"]').addEventListener('click', shut);
    // The game itself (vs the computer, live rooms): the same as its launcher tile.
    sheet.querySelector('[data-role="opengame"]').addEventListener('click', () => launch(game));
    if (!S.people) S.people = await readOpponents();
    if (sheetGen !== _view || !sheet.isConnected) return;
    // Your record against each person in THIS game, beside their name.
    const vs = new Map(records().people.filter((p) => p.code).map((p) => [p.code, p.byGame[game]]));
    const people = S.people;
    let picked = null;
    const list = sheet.querySelector('[data-role="people"]');
    const go = sheet.querySelector('[data-role="go"]');
    const paint = (q) => {
      const k = String(q || '').trim().toLowerCase();
      const show = people.filter((p) => !k || String(p.name).toLowerCase().includes(k));
      list.innerHTML = show.length ? show.map((p) => {
        const r = vs.get(p.code);
        return `<button type="button" class="cx-person" data-code="${esc(p.code)}" aria-pressed="${picked && picked.code === p.code}">
          <span class="cx-le" aria-hidden="true">${esc(p.emoji)}</span><span class="cx-ln">${esc(p.name)}</span>
          ${r && r.played ? `<span class="cx-lr is-dim">${esc(wl(r))}</span>` : ''}
          <span class="cx-tick" aria-hidden="true">${picked && picked.code === p.code ? '✓' : ''}</span></button>`;
      }).join('') : `<p class="cx-note">${esc(t('cx_no_people'))}</p>`;
    };
    paint('');
    const search = sheet.querySelector('.cx-search');
    search.addEventListener('input', (e) => paint(e.target.value));
    list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-code]');
      const p = b && people.find((x) => x.code === b.dataset.code);
      if (!p) return;
      picked = p;
      go.disabled = false;
      go.textContent = t('cx_challenge_them', { name: p.name || t('cx_someone') });
      paint(search.value);
    });
    go.addEventListener('click', () => { if (picked) challenge(game, { code: picked.code, name: picked.name, emoji: picked.emoji }); });
  }

  // --- records: everything, by person and by game ---
  function renderRecords() {
    const gen = ++_view;
    S.view = 'records';
    const all = records();
    const sum = summarize(S.rows || []);
    const people = all.people;
    const body = !all.total.played && !people.length && !sum.finished.length
      ? (S.live ? `<p class="cx-note">${esc(t('cx_no_records'))}</p>` : `<p class="cx-note">${esc(t('cx_loading'))}</p>`)
      : `${statsHTML(all.total)}
        ${people.length ? `<h3 class="cx-h">${esc(t('cx_people'))}</h3><div class="cx-card">${people.map((o) => `<button type="button" class="cx-lrow" data-opp="${esc(o.key)}">
            <span class="cx-le" aria-hidden="true">${esc(o.emoji)}</span><span class="cx-ln">${esc(o.name || t('cx_someone'))}</span>
            <span class="cx-lr">${esc(wl(o))}</span><span class="cx-chev" aria-hidden="true">&rsaquo;</span></button>`).join('')}</div>` : ''}
        ${byGameHTML(all.byGame, nameOf)}
        ${sum.finished.length ? `<h3 class="cx-h">${esc(t('cx_recent'))}</h3>
          <div class="cx-card">${sum.finished.slice(0, 10).map((r) => resultRowHTML(r, nameOf)).join('')}</div>` : ''}`;
    shell(card, { title: t('cx_records'), back: () => renderHome(), body: flashHTML() + body });
    if (!current(gen)) return;
    for (const b of card.querySelectorAll('[data-opp]')) b.addEventListener('click', () => renderOpponent(b.dataset.opp));
    bindRows(card);
  }

  // --- one person: record vs them, by game, live matches with them, results, and Challenge ---
  function renderOpponent(key) {
    const gen = ++_view;
    S.view = 'opp'; S.opp = key;
    const o = records().people.find((p) => p.key === key)
      || { key, code: key.startsWith('code:') ? key.slice(5) : '', name: '', emoji: '🙂', won: 0, lost: 0, draw: 0, played: 0, byGame: {} };
    const name = o.name || t('cx_someone');
    const mine = o.code ? (S.rows || []).filter((r) => r.with === o.code) : [];
    const sum = summarize(mine);
    const live = sum.yours.concat(sum.theirs);
    const canChallenge = !!o.code && games.length > 0;
    shell(card, {
      title: name, emoji: o.emoji, back: () => renderRecords(),
      body: `${flashHTML()}${statsHTML(o)}
        ${byGameHTML(o.byGame, nameOf)}
        ${live.length ? `<h3 class="cx-h">${esc(t('cx_now'))} <span class="cx-h-n">${live.length}</span></h3>
          <ul class="cx-list is-tight">${live.map((r) => liveRowHTML(r, nameOf, { showName: false })).join('')}</ul>` : ''}
        ${sum.finished.length ? `<h3 class="cx-h">${esc(t('cx_recent'))}</h3>
          <div class="cx-card">${sum.finished.slice(0, 10).map((r) => resultRowHTML(r, nameOf, { showName: false })).join('')}</div>` : ''}`,
      footer: canChallenge ? `<button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="ch">${esc(t('cx_challenge_them', { name }))}</button>` : '',
    });
    if (!current(gen)) return;
    bindRows(card);
    const ch = card.querySelector('[data-role="ch"]');
    if (ch) ch.addEventListener('click', () => renderPickGame({ code: o.code, name: o.name, emoji: o.emoji }, () => renderOpponent(key)));
  }

  // --- challenge one person: which game (the game's own screen takes it from there) ---
  function renderPickGame(them, back) {
    const gen = ++_view;
    S.view = 'game';
    const name = them.name || t('cx_someone');
    const lang = getLang();
    const list = games.slice().sort((a, b) => a.name.localeCompare(b.name, lang));
    shell(card, {
      title: name, emoji: them.emoji, back,
      body: `<div class="cx-tiles">${list.map((g) => `<button type="button" class="cx-tile" data-g="${esc(g.id)}">
          <span class="cx-tile-art" aria-hidden="true">${art(g.id)}</span><span class="cx-tile-name">${esc(g.name)}</span>
        </button>`).join('')}</div>`,
    });
    if (!current(gen)) return;
    for (const b of card.querySelectorAll('[data-g]')) {
      b.addEventListener('click', () => challenge(b.dataset.g, { code: them.code, name: them.name, emoji: them.emoji }));
    }
  }

  // --- cancel / decline / resign one live match (2026-10-13) ---
  // The ⋯ menu says what it expects; this screen RE-READS the match, because the row can be a turn
  // behind (they may have just played, so a cancel has become a resignation). Nothing happens until
  // the second tap, and the button says what that tap does.
  async function renderEnd(game, id, back) {
    const gen = ++_view;
    S.view = 'end';
    const row = (S.rows || []).find((r) => r.game === game && r.id === id) || { name: '', emoji: '🙂' };
    const name = row.name || t('cx_someone');
    shell(card, { title: name, emoji: row.emoji, back, body: `<p class="cx-note">${esc(t('cx_loading'))}</p>` });
    const action = await endAction(game, id);
    if (!current(gen)) return;
    if (!action) {
      shell(card, { title: name, emoji: row.emoji, back, body: `<p class="cx-note">${esc(t('cx_end_gone'))}</p>` });
      return;
    }
    const paint = (err = '') => {
      shell(card, {
        title: name, emoji: row.emoji, back,
        body: `<p class="cx-confirm"><strong>${esc(t(`cx_end_q_${action}`))}</strong></p>
          <p class="cx-confirm">${esc(t(`cx_end_b_${action}`, { game: nameOf(game), name }))}</p>
          ${err ? `<p class="cx-err" role="alert">${esc(err)}</p>` : ''}`,
        footer: `<button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="yes">${esc(t(`cx_end_yes_${action}`))}</button>
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="no">${esc(t(action === 'resign' ? 'cx_end_keep_playing' : 'cx_end_keep'))}</button>`,
      });
      if (!current(gen)) return;
      card.querySelector('[data-role="no"]').addEventListener('click', back);
      const yes = card.querySelector('[data-role="yes"]');
      yes.addEventListener('click', async () => {
        yes.disabled = true;
        const res = await endMatch(game, id, action);
        if (!current(gen)) return;
        if (res && res.ok) {
          // A resign on a match that turned out to be unanswered was called off instead (mp.js).
          const why = res.cancelled ? String((res.game && res.game.over && res.game.over.why) || (action === 'decline' ? 'declined' : 'cancelled')) : '';
          S.flash = why ? t(why === 'declined' ? 'cx_end_done_decline' : 'cx_end_done_cancel') : t('cx_end_done_resign', { name });
          // The list catches up from the game's own watch; until then, show it as ended here.
          S.rows = (S.rows || []).map((r) => (r.game === game && r.id === id
            ? { ...r, state: why ? 'cancelled' : 'done', ended: why, result: why ? null : 'lost', resigned: !why,
              sent: why === 'cancelled' ? true : why === 'declined' ? false : r.sent, open: '', expires: 0, updated: Date.now() }
            : r));
          back();
          return;
        }
        const reason = res && res.reason;
        paint(reason === 'accepted' ? t('cx_end_err_accepted', { name })
          : reason === 'offline' ? t('cx_end_err_offline')
            : reason === 'already-over' ? t('cx_end_gone') : t('cx_end_err'));
      });
    };
    paint();
  }

  // A live change repaints the screen that shows challenges; pickers, confirm screens and an open
  // sheet are left alone. The list keeps its scroll position, so a turn arriving does not throw the
  // reader to the top.
  const repaint = () => {
    if (!_host) return;
    if (card.querySelector('.cx-sheet, .cx-pop')) return;
    const sc = card.querySelector('.cx-scroll');
    const top = sc ? sc.scrollTop : 0;
    if (S.view === 'home') renderHome();
    else if (S.view === 'records') renderRecords();
    else if (S.view === 'opp') renderOpponent(S.opp);
    else return;
    const after = card.querySelector('.cx-scroll');
    if (after && top) after.scrollTop = top;
  };

  renderHome();
  // The live-room records come from players/ (one read); they only feed the record chip and Records.
  loadLiveRecords().then((live) => { if (!_host) return; S.live = live; repaint(); });
  const { rows, failed } = await loadAll(ids);
  if (!_host) return;
  S.rows = rows; S.failed = failed;
  repaint();
  const stop = await watchAll(ids.filter((g) => !failed.includes(g)), (live, heard) => {
    // Replace only the games this update speaks for; the rest keep what was read.
    const covered = new Set(heard);
    S.rows = (S.rows || []).filter((r) => !covered.has(r.game)).concat(live);
    repaint();
  });
  if (!_host) { try { stop(); } catch { /* fine */ } } else _unwatch = stop;
}
