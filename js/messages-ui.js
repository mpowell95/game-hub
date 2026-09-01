// messages-ui.js - the SCREEN half of Messages (js/messages.js is the data half, and carries the
// reasoning behind the node shape).
//
// THE LAW (root CLAUDE.md): this file renders. It writes nothing except through js/messages.js,
// which touches only its own new node and its own new local key. No stats, no profile, no players/
// record is reachable from here.
//
// BUILT ON css/ui.css's `.gh-*` primitives, like js/bug-report-ui.js and js/admin-ui.js. The local
// `.msg-*` block adds only what does not exist yet: the conversation rows and the chat bubbles.
//
// Entry points, all lazily imported (by profile/index.html, js/hub.js and js/admin-ui.js):
//   openMessages({ to })          - the player's inbox; `to` opens straight into one conversation
//   openMessages({ admin: true }) - Matt's read-only view of every conversation
//   myUnreadMessages()            - the count behind the profile pill's badge

import {
  MAX_MESSAGE, myCode, readMyThreads, readThread, watchThread, markThreadSeen, hideThread,
  readContacts, sendMessage, sendBroadcast, unreadMessageCount, readAllThreads,
  queueOutbox, normalizeText, isUnread, authId,
} from './messages.js';
import { loadProfile } from './profile-store.js';
import { loadPalette, PHRASES } from './mp-reactions.js';
import { makeT, getLang } from './i18n.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Re-export so js/hub.js and profile/index.html can paint a count without importing the data half. */
export async function myUnreadMessages() { return unreadMessageCount(); }

/**
 * "The new message badge doesn't go away after I've already read a message." (Matt, 2026-08-31.)
 *
 * The launcher painted its badge on page LOAD and on `online`, and nothing else. Reading a message
 * happens inside an overlay on top of that same page, so the count behind it stayed exactly as it
 * was until the next reload - the message was read, the badge disagreed, and the only cure was
 * closing the app.
 *
 * So the read state announces itself. `js/hub.js` and `profile/index.html` listen for this and
 * repaint; anything else that wants to can too. A CustomEvent on `window` rather than a callback
 * registry because the listeners live on two different pages and neither imports the other.
 */
export const MESSAGES_CHANGED = 'gamehub:messages';
function announceChange() {
  try { window.dispatchEvent(new CustomEvent(MESSAGES_CHANGED)); }
  catch { /* no window (or no CustomEvent): a badge is not worth throwing over */ }
}

/**
 * Stamp a thread read, SERIALISED, and announce it once the write has actually landed.
 *
 * Serialised because these fire from the live watch, which can deliver several times in a row, and
 * two overlapping writes to the same row are a race with no winner worth having. Awaited by
 * renderList before it re-reads: going Back immediately after reading used to re-list from the
 * server before the seen-stamp arrived, so the row you had just read came back still bold.
 */
let _seenWrite = Promise.resolve();
function markSeen(code, atMs) {
  _seenWrite = _seenWrite
    .then(() => markThreadSeen(code, atMs))
    .then(() => announceChange())
    .catch(() => { /* markThreadSeen already logs; never break the chain for the next caller */ });
  return _seenWrite;
}

/**
 * The profile page's Messages section, rendered in place.
 *
 * It used to be a heading reading "Messages" over a button reading "Messages", alone in a card the
 * size of every other section - the word twice and nothing else. The page already fetches this
 * player's conversations to put a count on that button, so showing the newest two costs no extra
 * read and answers "is anything waiting" without a tap.
 */
export async function renderProfileMessages(host) {
  if (!host) return;
  ensureCss();
  const me = myCode();
  const open = (row) => openMessages(row ? { to: row.code, toName: row.name, toEmoji: row.emoji } : {});
  const draw = (inner) => {
    host.innerHTML = inner;
    host.querySelectorAll('[data-code]').forEach((b) => b.addEventListener('click', () => open({
      code: b.dataset.code, name: b.dataset.name, emoji: b.dataset.emoji,
    })));
    const all = host.querySelector('[data-role="all"]');
    if (all) all.addEventListener('click', () => open(null));
  };

  draw(`<button type="button" class="gh-btn gh-btn--block" data-role="all">${esc(t('msg_btn'))}</button>`);
  if (!me) return;

  const rows = (await readMyThreads()).slice(0, 2);
  if (!rows.length) return;
  const unread = rows.filter((r) => isUnread(r, me)).length;
  draw(`<ul class="msg-list">${rows.map((r) => `
      <li><button type="button" class="msg-row${isUnread(r, me) ? ' is-unread' : ''}"
            data-code="${esc(r.code)}" data-name="${esc(r.name || r.code)}" data-emoji="${esc(r.emoji || '🙂')}">
        <span class="msg-row-emoji" aria-hidden="true">${esc(r.emoji || '🙂')}</span>
        <span class="msg-row-main">
          <span class="msg-row-name">${esc(r.name || r.code)}</span>
          <span class="msg-row-prev">${esc((r.from === me ? t('msg_you_prefix') : '') + (r.preview || ''))}</span>
        </span>
        <span class="msg-row-when">${esc(whenText(r.at))}</span>
      </button></li>`).join('')}</ul>
    <button type="button" class="gh-btn gh-btn--block msg-allbtn" data-role="all">${
      esc(unread > 0 ? t('msg_open_all_new', { n: unread }) : t('msg_open_all'))}</button>`);
}

// --- css ------------------------------------------------------------------------------------

function ensureCss() {
  if (!document.querySelector('link[data-gh-ui-css="1"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../css/ui.css', import.meta.url).href;
    link.setAttribute('data-gh-ui-css', '1');
    document.head.appendChild(link);
  }
  if (document.getElementById('msg-css')) return;
  const style = document.createElement('style');
  style.id = 'msg-css';
  style.textContent = `
  .msg-overlay { z-index: 300; padding: max(var(--gh-sp-4), env(safe-area-inset-top)) var(--gh-sp-4)
                 max(var(--gh-sp-4), env(safe-area-inset-bottom)); align-content: center; }
  /* The modal itself does NOT scroll: the list inside it does, so the title and the composer stay
     put and the composer can never be pushed off the bottom edge on a short phone. */
  .msg-modal { width: min(520px, 100%); max-height: 88vh; display: flex; flex-direction: column;
               overflow: hidden; }
  .msg-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
                -webkit-overflow-scrolling: touch;
                margin: 0 calc(var(--gh-sp-4) * -1); padding: 0 var(--gh-sp-4); }
  .msg-lead { margin: 0 0 var(--gh-sp-3); font-size: var(--gh-fs-sm); color: var(--gh-muted); line-height: 1.5; }
  .msg-back { margin-right: var(--gh-sp-2); }
  .gh-modal__title .msg-sub { display: block; font-size: var(--gh-fs-xs); font-weight: 600;
                              color: var(--gh-muted); margin-top: 2px; }
  /* The conversation header: back, the person (emoji + name, matching their inbox row), then Hide.
     Hide lives up here rather than under the last message, where it sat exactly where the eye
     lands after the newest thing said and read as part of the conversation. */
  /* NO padding-right here. .gh-modal__title already carries a right margin to clear the close
     button, so reserving 40px again took the row from 361px to 281px, and the name was the only
     flexible thing left to pay for it: measured, it got 94px of the 148px it needed.
     (This whole block is inside a JS template literal - never use a backtick in these comments.) */
  .msg-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
  /* Square, chevron only. nowrap because a squeezed flex item breaks the glyph onto its own line
     before it agrees to shrink. */
  .msg-back { flex: 0 0 auto; width: 34px; padding: 0; font-size: 20px; line-height: 1;
              white-space: nowrap; }
  .msg-head-emoji { font-size: 22px; line-height: 1; flex: 0 0 auto; }
  /* The name is the only thing here that may shrink, and it runs at the modal title's --gh-fs-xl
     (24px) by default, which is far too big for a row that also holds three controls: at that size
     "Alec king of games" - the longest name on the real board - clipped to "Alec ki…" on a 393px
     phone. Sized so THAT name fits whole, which means every shorter one does too. */
  .msg-head-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;
                   white-space: nowrap; font-size: var(--gh-fs-md); }
  .msg-head-hide { flex: 0 0 auto; font-size: var(--gh-fs-xs); color: var(--gh-muted);
                   padding: 0 var(--gh-sp-2); }
  /* --- conversation list ------------------------------------------------------------------ */
  .msg-list { list-style: none; margin: 0; padding: 0; }
  .msg-list li + li { margin-top: var(--gh-sp-2); }
  .msg-row { display: flex; align-items: center; gap: var(--gh-sp-3); width: 100%; text-align: left;
             padding: var(--gh-sp-3); border: 1px solid var(--gh-border); border-radius: var(--gh-r-md);
             background: var(--gh-surface); color: var(--gh-ink); cursor: pointer; font-family: var(--gh-font); }
  .msg-row-emoji { font-size: 24px; line-height: 1; flex: 0 0 auto; }
  .msg-row-main { flex: 1 1 auto; min-width: 0; }
  /* BOTH need display:block. A row's contents are spans (they sit inside a <button>, which may not
     contain block-level flow content), so without this the name and the preview run together on one
     line AND text-overflow never fires, because an inline box does not clip. */
  .msg-row-name { display: block; font-size: var(--gh-fs-sm); font-weight: 800; }
  .msg-row-prev { display: block; margin: 2px 0 0; font-size: var(--gh-fs-sm); color: var(--gh-muted);
                  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .msg-row-when { flex: 0 0 auto; font-size: var(--gh-fs-xs); color: var(--gh-muted); white-space: nowrap;
                  align-self: flex-start; }
  /* The picker's rows carry a name and nothing else, so they do not need a conversation row's
     height. At 20-odd people the full-size row turned the list into a long scroll for no content. */
  .msg-row--compact { padding: 9px var(--gh-sp-3); gap: var(--gh-sp-2); }
  .msg-row--compact .msg-row-emoji { font-size: 19px; }
  /* Unread is marked by a DOT and by bold text, never by colour alone (the repo's colourblind
     rule): the accent fills the dot, the weight carries the same meaning without it. */
  .msg-row.is-unread { border-color: var(--gh-accent); }
  .msg-row.is-unread .msg-row-name::after {
    content: ''; display: inline-block; width: 8px; height: 8px; margin-left: 6px; border-radius: 50%;
    background: var(--gh-accent); vertical-align: middle;
  }
  .msg-row.is-unread .msg-row-prev { color: var(--gh-ink); font-weight: 700; }
  /* --- one conversation -------------------------------------------------------------------- */
  .msg-thread { list-style: none; margin: 0; padding: var(--gh-sp-2) 0; display: flex;
                flex-direction: column; gap: var(--gh-sp-2); }
  .msg-bubble { max-width: 82%; padding: var(--gh-sp-3); border-radius: var(--gh-r-md);
                background: var(--gh-surface-2); font-size: var(--gh-fs-sm); line-height: 1.45;
                white-space: pre-wrap; word-break: break-word; }
  /* Mine sit right and carry the accent border; theirs sit left and plain. Position is the primary
     cue, so the two sides stay distinguishable with no colour at all. */
  .msg-bubble--mine { align-self: flex-end; border: 1px solid var(--gh-accent); }
  .msg-bubble--theirs { align-self: flex-start; border: 1px solid var(--gh-border); }
  /* A time under EVERY bubble was three stamps a minute apart repeating down the screen. The
     divider below carries it instead, only where there is a real gap. */
  .msg-daysplit { align-self: center; font-size: var(--gh-fs-xs); color: var(--gh-muted);
                  padding: var(--gh-sp-1) 0; }
  /* --- composer ---------------------------------------------------------------------------- */
  /* One row: the box grows with what is typed, Send is a round button beside it. The old stack
     (label + a 64px box + two rows of chips + a Send row) cost about 45% of a phone screen, so
     only four messages of the conversation fitted above it. */
  .msg-compose { flex: 0 0 auto; padding-top: var(--gh-sp-3); border-top: 1px solid var(--gh-border); }
  .msg-composerow { display: flex; align-items: flex-end; gap: var(--gh-sp-2); }
  .msg-text { flex: 1 1 auto; min-height: 44px; max-height: 132px; padding: 11px var(--gh-sp-3);
              line-height: 1.4; resize: none; overflow-y: auto; font-family: var(--gh-font); }
  /* 44px square: the tap-target floor, and it lines up with the box at one row. */
  .msg-send { flex: 0 0 auto; width: 44px; height: 44px; padding: 0; border-radius: 50%;
              font-size: 19px; line-height: 1; }
  /* ONE row that scrolls sideways, not two that wrap. contain, so a flick that runs out of chips
     does not start panning the conversation behind them. */
  .msg-presets { display: flex; flex-wrap: nowrap; gap: var(--gh-sp-2); margin-bottom: var(--gh-sp-2);
                 overflow-x: auto; overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch;
                 scrollbar-width: none; padding-bottom: 2px; }
  .msg-presets::-webkit-scrollbar { display: none; }
  .msg-preset { flex: 0 0 auto; font: inherit; font-size: var(--gh-fs-xs); font-weight: 700;
                padding: 7px 12px; border-radius: 999px; border: 1px solid var(--gh-border);
                background: var(--gh-surface); color: var(--gh-ink); cursor: pointer;
                touch-action: manipulation; white-space: nowrap; }
  .msg-preset:hover { background: var(--gh-surface-2); }
  /* Only near the cap. A counter reading 12/300 is noise on every message anyone ever writes. */
  .msg-count { display: block; margin-top: var(--gh-sp-1); text-align: right;
               font-size: var(--gh-fs-xs); color: var(--gh-muted); }
  .msg-count:empty { display: none; }
  .msg-msg { margin: var(--gh-sp-2) 0 0; font-size: var(--gh-fs-sm); font-weight: 600;
             color: var(--gh-ink); min-height: 1.2em; }
  .msg-msg.is-err { color: var(--gh-cb-vermilion); }
  /* A small label over a group of rows: the picker's Recent / Everyone else. */
  .msg-allbtn { margin-top: var(--gh-sp-2); }
  .msg-group { margin: var(--gh-sp-4) 0 var(--gh-sp-2); font-size: var(--gh-fs-xs); font-weight: 800;
               text-transform: uppercase; letter-spacing: .05em; color: var(--gh-muted); }
  .msg-list + .msg-group { margin-top: var(--gh-sp-4); }
  /* --- admin read-all ---------------------------------------------------------------------- */
  /* In a moderation thread both sides are somebody else, so the mine/theirs sides mean nothing on
     their own: each bubble is named. */
  .msg-admin-who { display: block; font-size: var(--gh-fs-xs); font-weight: 800; color: var(--gh-muted);
                   margin-bottom: 2px; }
  /* This device's anonymous auth id, shown when it is not on the admins allowlist. Selectable and
     wrapped: it is a long opaque string somebody has to copy into the Firebase console. */
  .msg-id { font: 12px/1.5 var(--gh-font-mono); user-select: all; word-break: break-all;
            background: var(--gh-surface-2); border-radius: var(--gh-r-md); padding: var(--gh-sp-3);
            margin: var(--gh-sp-2) 0 0; }
  `;
  document.head.appendChild(style);
}

// --- one overlay at a time --------------------------------------------------------------------

let _host = null;
let _onKey = null;
let _unwatch = null;

/**
 * Which screen is on show. Bumped by every render; anything async that started under an older
 * number must not paint.
 *
 * Found by testing the badge fix (2026-08-31): tapping Back left you in the conversation. A
 * conversation subscribes to its thread, and every delivery calls draw(), which rebuilds the WHOLE
 * card. Back renders the list into that same card - and the list's own "Loading…" line satisfied
 * the watch callback's "is a conversation still on screen" guard, so the next delivery redrew the
 * conversation straight over the list, and every delivery after that kept it there.
 *
 * `watchThread` is also awaited, so a Back tapped before it resolved got a subscription assigned
 * AFTER the teardown that was meant to cancel it - a live watch nothing held a handle to.
 */
let _view = 0;
/** True while `gen` is still the screen the player is looking at. */
const current = (gen) => _host !== null && gen === _view;

function closeOverlay() {
  _view += 1;                                   // orphan every in-flight render
  if (_unwatch) { try { _unwatch(); } catch { /* already gone */ } _unwatch = null; }
  if (_onKey) { document.removeEventListener('keydown', _onKey); _onKey = null; }
  if (_host) { _host.remove(); _host = null; }
}

/** `guardClose` refuses a scrim tap or Escape once something is typed, so a mis-tap cannot throw
 *  away what somebody just wrote. The X and Back always work. */
let _guardClose = null;
function mountOverlay(ariaLabel) {
  ensureCss();
  closeOverlay();
  const host = document.createElement('div');
  host.className = 'gh-overlay msg-overlay';
  host.innerHTML = `<div class="gh-modal msg-modal" role="dialog" aria-modal="true"
       aria-label="${esc(ariaLabel)}"></div>`;
  document.body.appendChild(host);
  _host = host;
  const mayClose = () => !_guardClose || _guardClose();
  host.addEventListener('click', (e) => { if (e.target === host && mayClose()) closeOverlay(); });
  _onKey = (e) => { if (e.key === 'Escape' && mayClose()) closeOverlay(); };
  document.addEventListener('keydown', _onKey);
  return host.querySelector('.gh-modal');
}

// --- small render helpers ----------------------------------------------------------------------

/** "3m", "2h", "Tue", "12 Aug" - short enough for a list row on a narrow phone. */
function whenText(atMs) {
  const n = Number(atMs) || 0;
  if (!n) return '';
  const d = new Date(n), diff = Date.now() - n;
  if (diff < 60_000) return t('msg_now');
  if (diff < 3_600_000) return t('msg_min', { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t('msg_hr', { n: Math.floor(diff / 3_600_000) });
  return d.toLocaleDateString(getLang() === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short' });
}

function shellHTML(card, { title, sub, backable, body, footer, emoji, hide }) {
  // Back is a CHEVRON, not "‹ Back". With the word, four things competed for a 393px row - back,
  // emoji, name, Hide - and the loser was the name: "King of Games" truncated to "Kin…" while the
  // back button itself wrapped onto two lines. The word costs about 45px and says nothing the
  // chevron does not; the label is on the button for a screen reader.
  const heading = backable
    ? `<span class="msg-head">
         <button type="button" class="gh-btn gh-btn--ghost gh-btn--sm msg-back" data-role="back"
                 aria-label="${esc(t('msg_back'))}" title="${esc(t('msg_back'))}">&#8249;</button>
         ${emoji ? `<span class="msg-head-emoji" aria-hidden="true">${esc(emoji)}</span>` : ''}
         <span class="msg-head-name">${esc(title)}</span>
         ${hide ? `<button type="button" class="gh-btn gh-btn--ghost gh-btn--sm msg-head-hide" data-role="hide">${esc(t('msg_hide'))}</button>` : ''}
       </span>`
    : `📬 ${esc(title)}`;
  card.innerHTML = `
    <button type="button" class="gh-modal__close" data-role="close" aria-label="${esc(t('msg_close'))}">&times;</button>
    <h2 class="gh-modal__title">${heading}${sub ? `<span class="msg-sub">${esc(sub)}</span>` : ''}</h2>
    <div class="msg-scroll">${body}</div>
    ${footer || ''}
    <p class="msg-msg" data-role="msg" role="status" aria-live="polite"></p>`;
  card.querySelector('[data-role="close"]').addEventListener('click', closeOverlay);
}

/** Should a divider go BEFORE this message? A new day, or more than an hour of silence. Anything
 *  tighter than that and the stamp says nothing the order of the bubbles did not already say. */
function splitBefore(msg, prev) {
  if (!prev) return true;
  const a = new Date(Number(prev.atMs) || 0), b = new Date(Number(msg.atMs) || 0);
  return a.toDateString() !== b.toDateString() || (b - a) > 3_600_000;
}

/** The divider's own label: a time today, a date and time before that. */
function splitText(atMs) {
  const n = Number(atMs) || 0;
  if (!n) return '';
  const d = new Date(n), loc = getLang() === 'es' ? 'es-ES' : 'en-GB';
  const time = d.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${d.toLocaleDateString(loc, { day: 'numeric', month: 'short' })} · ${time}`;
}

function say(card, text, kind) {
  const el = card.querySelector('[data-role="msg"]');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('is-err', kind === 'err');
}

// --- entry point -------------------------------------------------------------------------------

/**
 * Open Messages.
 * @param {{to?:string, toName?:string, toEmoji?:string, admin?:boolean}} opts
 */
export async function openMessages(opts = {}) {
  const card = mountOverlay(t(opts.admin ? 'msg_admin_title' : 'msg_title'));
  _guardClose = null;
  if (opts.admin) return renderAdmin(card);
  if (!myCode()) {
    shellHTML(card, { title: t('msg_title'), body: `<p class="msg-lead">${esc(t('msg_no_code'))}</p>` });
    return;
  }
  if (opts.to) return renderThread(card, { code: opts.to, name: opts.toName || '', emoji: opts.toEmoji || '🙂' });
  return renderList(card);
}

// --- the conversation list ----------------------------------------------------------------------

/** Matt's two admin entry points on the Messages screen: the bug inbox and the read-every-thread
 *  view. Both were launcher-footer buttons; both are about reading what players have written, so
 *  they belong with the messages rather than under the game grid (Matt, 2026-09-01: the admin
 *  button "should be moved into my profile or something instead of all the way down there", and
 *  "the bug reports should be part of my messages area").
 *
 *  Everything here is awaited AFTER the list has painted and re-checks `current(gen)` before
 *  touching the DOM: a slow or offline read must not hold up the conversation list, and must not
 *  graft buttons onto a screen the reader has already navigated away from. */
async function addAdminButtons(card, gen) {
  if (!(await amIAdmin((loadProfile() || {}).name))) return;
  if (!current(gen)) return;
  const acts = card.querySelector('[data-role="acts"]');
  if (!acts) return;
  acts.insertAdjacentHTML('afterbegin',
    `<button type="button" class="gh-btn" data-role="buginbox">${esc(t('bug_inbox_btn'))}</button>`
    + `<button type="button" class="gh-btn" data-role="alladmin">${esc(t('msg_admin_btn'))}</button>`);
  const inbox = acts.querySelector('[data-role="buginbox"]');
  inbox.addEventListener('click', async () => {
    try { (await import('./bug-report-ui.js')).openBugInbox(); }
    catch (err) { console.error('[messages] bug inbox failed to load', err); }
  });
  acts.querySelector('[data-role="alladmin"]').addEventListener('click', () => renderAdmin(card));
  // The count is a second await, and a stale label is better than a late list.
  try {
    const n = await (await import('./bug-report-ui.js')).adminUnreadCount();
    if (current(gen) && n > 0) inbox.textContent = t('bug_inbox_btn_new', { n });
  } catch { /* offline: the plain label is already correct */ }
}

async function renderList(card) {
  const gen = ++_view;
  if (_unwatch) { try { _unwatch(); } catch { /* already gone */ } _unwatch = null; }
  _guardClose = null;
  shellHTML(card, { title: t('msg_title'), body: `<p class="msg-lead">${esc(t('msg_loading'))}</p>` });

  const me = myCode();
  // Wait for any read-stamp still in flight. Tapping Back straight after reading used to re-list
  // from the server before that write arrived, so the row just read came back bold.
  await _seenWrite;
  const rows = await readMyThreads();
  if (!current(gen)) return;

  const body = rows.length
    ? `<ul class="msg-list">${rows.map((r) => `
        <li><button type="button" class="msg-row${isUnread(r, me) ? ' is-unread' : ''}"
              data-code="${esc(r.code)}" data-name="${esc(r.name || r.code)}" data-emoji="${esc(r.emoji || '🙂')}">
          <span class="msg-row-emoji" aria-hidden="true">${esc(r.emoji || '🙂')}</span>
          <span class="msg-row-main">
            <span class="msg-row-name">${esc(r.name || r.code)}</span>
            <span class="msg-row-prev">${esc((r.from === me ? t('msg_you_prefix') : '') + (r.preview || ''))}</span>
          </span>
          <span class="msg-row-when">${esc(whenText(r.at))}</span>
        </button></li>`).join('')}</ul>`
    : `<p class="msg-lead">${esc(navigator.onLine === false ? t('msg_offline') : t('msg_empty'))}</p>`;

  // BUG REPORTS LIVE HERE NOW (2026-09-01). Matt: "the bug reports should be part of my messages
  // area." A bug report IS a message from a player that he answers in a thread - it only ever sat
  // in the launcher footer because it shipped before Messages existed. Admin-only, and appended
  // after the render so the list never waits on the isAdmin() import or the unread read.
  shellHTML(card, {
    title: t('msg_title'),
    body,
    footer: `<div class="gh-modal__actions" data-role="acts">
      <button type="button" class="gh-btn gh-btn--primary" data-role="new">${esc(t('msg_new_btn'))}</button>
    </div>`,
  });
  card.querySelector('[data-role="new"]').addEventListener('click', () => renderPicker(card));
  addAdminButtons(card, gen);
  card.querySelectorAll('.msg-row').forEach((b) => b.addEventListener('click', () => renderThread(card, {
    code: b.dataset.code, name: b.dataset.name, emoji: b.dataset.emoji,
  })));
}

// --- pick somebody to write to -------------------------------------------------------------------

async function renderPicker(card) {
  const gen = ++_view;
  _guardClose = null;
  shellHTML(card, { title: t('msg_new_title'), backable: true, body: `<p class="msg-lead">${esc(t('msg_loading'))}</p>` });
  card.querySelector('[data-role="back"]').addEventListener('click', () => renderList(card));

  const [contacts, threads] = await Promise.all([readContacts(), readMyThreads()]);
  if (!current(gen)) return;

  const prof = loadProfile() || {};
  const isMatt = await amIAdmin(prof.name);
  // People already talked to come first, in the order they last wrote. The full list is 20-odd
  // names and alphabetical order buries whoever you actually message, at the bottom, every time.
  const recentCodes = threads.map((r) => r.code);
  const recent = recentCodes.map((c) => contacts.find((x) => x.code === c)).filter(Boolean);
  const rest = contacts.filter((c) => !recentCodes.includes(c.code));

  const personRow = (c) => `<li><button type="button" class="msg-row msg-row--compact"
      data-code="${esc(c.code)}" data-name="${esc(c.name)}" data-emoji="${esc(c.emoji)}">
    <span class="msg-row-emoji" aria-hidden="true">${esc(c.emoji)}</span>
    <span class="msg-row-main"><span class="msg-row-name">${esc(c.name)}</span></span>
  </button></li>`;
  const group = (label, list) => (list.length
    ? `<p class="msg-group">${esc(label)}</p><ul class="msg-list">${list.map(personRow).join('')}</ul>` : '');

  const body = contacts.length
    ? `${isMatt ? `<ul class="msg-list"><li><button type="button" class="msg-row" data-all="1">
          <span class="msg-row-emoji" aria-hidden="true">📣</span>
          <span class="msg-row-main"><span class="msg-row-name">${esc(t('msg_everyone'))}</span>
          <span class="msg-row-prev">${esc(t('msg_everyone_sub', { n: contacts.length }))}</span></span>
        </button></li></ul>` : ''}
       ${recent.length ? group(t('msg_recent'), recent) : ''}
       ${recent.length ? group(t('msg_everyone_else'), rest) : `<ul class="msg-list">${rest.map(personRow).join('')}</ul>`}`
    : `<p class="msg-lead">${esc(navigator.onLine === false ? t('msg_offline') : t('msg_nobody'))}</p>`;

  shellHTML(card, { title: t('msg_new_title'), backable: true, body });
  card.querySelector('[data-role="back"]').addEventListener('click', () => renderList(card));
  card.querySelectorAll('.msg-row').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.all) return renderBroadcast(card, contacts);
    renderThread(card, { code: b.dataset.code, name: b.dataset.name, emoji: b.dataset.emoji });
  }));
}

/** Matt only, and looked up the same way js/hub.js gates the Admin button. */
async function amIAdmin(name) {
  try { const m = await import('./challenge/hooks.js'); return !!(name && m.isAdmin(name)); }
  catch { return false; }
}

// --- one conversation ------------------------------------------------------------------------------

function composerHTML(placeholder) {
  const palette = loadPalette();
  const lang = getLang();
  const presets = (palette.phrases || []).slice(0, 8)
    .map((id) => (PHRASES[id] ? { id, text: PHRASES[id][lang] || PHRASES[id].en } : null)).filter(Boolean);
  return `<div class="msg-compose">
    ${presets.length ? `<div class="msg-presets">${presets
      .map((p) => `<button type="button" class="msg-preset" data-preset="${esc(p.text)}">${esc(p.text)}</button>`)
      .join('')}</div>` : ''}
    <div class="msg-composerow">
      <textarea class="gh-input msg-text" id="msg-text" rows="1" maxlength="${MAX_MESSAGE}"
                aria-label="${esc(t('msg_write_label'))}" placeholder="${esc(placeholder)}"></textarea>
      <button type="button" class="gh-btn gh-btn--primary msg-send" data-role="send"
              aria-label="${esc(t('msg_send'))}" title="${esc(t('msg_send'))}">&#8593;</button>
    </div>
    <span class="msg-count" data-role="count" aria-live="polite"></span>
  </div>`;
}

/** Wire the composer. `onSend(text)` returns a promise of true when it went. */
function wireComposer(card, onSend) {
  const box = card.querySelector('#msg-text');
  const count = card.querySelector('[data-role="count"]');
  const send = card.querySelector('[data-role="send"]');
  if (!box || !send) return;
  _guardClose = () => !normalizeText(box.value);
  // The box grows with what is typed, up to the CSS max-height, then scrolls. Reset to `auto`
  // first or scrollHeight only ever reports the height it already has, so it can never shrink back.
  const paint = () => {
    box.style.height = 'auto';
    box.style.height = Math.min(box.scrollHeight, 132) + 'px';
    // The counter appears only in the last stretch. On every ordinary message it says nothing.
    const left = MAX_MESSAGE - box.value.length;
    if (count) count.textContent = left <= 60 ? String(left) : '';
  };
  box.addEventListener('input', paint);
  paint();
  card.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    box.value = (box.value ? box.value.replace(/\s*$/, ' ') : '') + b.dataset.preset;
    box.focus(); paint();
  }));
  send.addEventListener('click', async () => {
    const text = normalizeText(box.value);
    if (!text) { say(card, t('msg_type_something'), 'err'); return; }
    send.disabled = true;
    say(card, t('msg_sending'), '');

    // CLEAR NOW, not after the await. Matt: "Why doesn't my message leave the typing area after I
    // send it? I have to manually delete it if I want to send two messages back to back."
    //
    // The message lands in Firebase, watchThread fires, and draw() rebuilds this whole card -
    // carrying the box's CURRENT value across to the new textarea so a half-typed draft is not
    // lost by an arriving message. All of that happens BEFORE `await onSend` resolves, so the old
    // code then cleared a textarea that had already been replaced and was no longer on screen.
    //
    // Clearing first is also what stops a fast second tap re-sending the same words: the button is
    // re-enabled by that same re-render, so `disabled` alone was never the guard it looked like.
    box.value = '';
    paint();
    _guardClose = null;

    const ok = await onSend(text);
    if (!_host) return;
    // `box` and `send` may both be detached by now, so re-read them from the card.
    const nowBox = card.querySelector('#msg-text') || box;
    const nowSend = card.querySelector('[data-role="send"]') || send;
    nowSend.disabled = false;
    if (!ok) {
      // Put the words back where they were typed. Nothing anyone wrote is thrown away because a
      // send failed - they can fix the connection and press send again.
      nowBox.value = text;
      nowBox.dispatchEvent(new Event('input'));
      _guardClose = () => !normalizeText(nowBox.value);
    }
  });
}

async function renderThread(card, who) {
  const gen = ++_view;
  _guardClose = null;
  const me = myCode();
  const title = who.name || who.code;
  // Leaving KILLS the subscription on the click itself, before renderList does any of its own
  // async work. Tearing it down inside renderList was not enough: the thread's watch could still
  // deliver in the gap and redraw the conversation over the list, and then keep it there.
  const leave = () => {
    _view += 1;
    if (_unwatch) { try { _unwatch(); } catch { /* already gone */ } _unwatch = null; }
    renderList(card);
  };
  const draw = (msgs) => {
    const body = msgs.length
      ? `<ul class="msg-thread">${msgs.map((m, i) => `
          ${splitBefore(m, msgs[i - 1]) ? `<li class="msg-daysplit">${esc(splitText(m.atMs))}</li>` : ''}
          <li class="msg-bubble msg-bubble--${m.from === me ? 'mine' : 'theirs'}">${esc(m.text || '')}</li>`).join('')}</ul>`
      : `<p class="msg-lead">${esc(t('msg_thread_empty', { name: title }))}</p>`;
    const box = card.querySelector('#msg-text');
    const draft = box ? box.value : '';
    shellHTML(card, {
      title, emoji: who.emoji, backable: true, body,
      // Hiding is reversible by anything newer (js/messages.js's hideThread), so it needs no
      // confirmation step. Not offered on an EMPTY thread: there is nothing there to hide.
      hide: msgs.length > 0,
      footer: composerHTML(t('msg_placeholder', { name: title })),
    });
    card.querySelector('[data-role="back"]').addEventListener('click', leave);
    const scroll = card.querySelector('.msg-scroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
    const fresh = card.querySelector('#msg-text');
    if (fresh && draft) fresh.value = draft;
    wireComposer(card, async (text) => {
      const res = await sendMessage({ toCode: who.code, toName: who.name, toEmoji: who.emoji, text });
      if (res.ok) { say(card, '', ''); announceChange(); return true; }
      if (res.retryable && queueOutbox({ toCode: who.code, toName: who.name, toEmoji: who.emoji, text })) {
        say(card, t('msg_queued'), '');
        return true;
      }
      say(card, t('msg_send_failed'), 'err');
      return false;
    });
    const hide = card.querySelector('[data-role="hide"]');
    if (hide) hide.addEventListener('click', async () => { await hideThread(who.code); announceChange(); renderList(card); });
  };

  shellHTML(card, { title, backable: true, body: `<p class="msg-lead">${esc(t('msg_loading'))}</p>` });
  card.querySelector('[data-role="back"]').addEventListener('click', leave);

  const first = await readThread(who.code);
  if (!current(gen)) return;
  draw(first);
  if (first.length) markSeen(who.code, first[first.length - 1].atMs);

  // Live while the screen is open, so a reply lands in front of the person waiting for it.
  if (_unwatch) { try { _unwatch(); } catch { /* already gone */ } _unwatch = null; }
  const stop = await watchThread(who.code, (msgs) => {
    // The GENERATION, not "does the card still look like a conversation". The list's own loading
    // line satisfied that older test, so a delivery arriving just after Back redrew this thread
    // straight over the list.
    if (!current(gen)) return;
    draw(msgs);
    if (msgs.length) markSeen(who.code, msgs[msgs.length - 1].atMs);
  });
  // Back may have been tapped while that await was in flight, in which case the teardown has
  // already run and this subscription is an orphan nothing holds a handle to. Stop it here.
  if (!current(gen)) { try { stop(); } catch { /* already gone */ } return; }
  _unwatch = stop;
}

// --- broadcast (Matt only) --------------------------------------------------------------------

function renderBroadcast(card, contacts) {
  _view += 1;
  shellHTML(card, {
    title: t('msg_everyone'), sub: t('msg_everyone_sub', { n: contacts.length }), backable: true,
    body: `<p class="msg-lead">${esc(t('msg_everyone_hint'))}</p>`,
    footer: composerHTML(t('msg_placeholder', { name: t('msg_everyone') })),
  });
  card.querySelector('[data-role="back"]').addEventListener('click', () => renderPicker(card));
  wireComposer(card, async (text) => {
    const res = await sendBroadcast(contacts, text);
    if (!_host) return false;
    if (res.failed.length) { say(card, t('msg_bc_partial', { n: res.sent, f: res.failed.length }), 'err'); return res.sent > 0; }
    say(card, t('msg_bc_sent', { n: res.sent }), '');
    return true;
  });
}

// --- admin read-all ------------------------------------------------------------------------------
// Read-only, deliberately: js/messages.js has no admin write path at all, so nothing here can edit
// or remove anything anybody said.

async function renderAdmin(card) {
  const gen = ++_view;
  shellHTML(card, { title: t('msg_admin_title'), body: `<p class="msg-lead">${esc(t('msg_loading'))}</p>` });
  const [all, contacts] = await Promise.all([readAllThreads(), readContacts()]);
  if (!current(gen)) return;
  const threads = all.threads;

  // Not on the allowlist is NOT the same screen as "nobody has written anything". This device's
  // auth id changes whenever its site data is cleared, so the fix is to paste the id below into
  // `admins/` in the Firebase console - which the screen has to actually say.
  if (all.denied) {
    const uid = await authId();
    if (!current(gen)) return;
    // WITH A COPY BUTTON (2026-09-01). The id is 28 opaque characters that have to reach a
    // Firebase console on another machine, and `user-select: all` is not a way to get it there
    // from a phone. Nothing in the app can shortcut this: `admins` is the ONE node in
    // database.rules.json with `".write": false`, so the allowlist is deliberately unreachable
    // from any client - which is the whole reason it is worth anything as a gate.
    shellHTML(card, {
      title: t('msg_admin_title'),
      body: `<p class="msg-lead">${esc(t('msg_admin_denied'))}</p>
        <p class="msg-id">${esc(uid || '?')}</p>
        <div class="gh-modal__actions"><button type="button" class="gh-btn gh-btn--sm"
          data-role="copyuid">${esc(t('adm_copy_id'))}</button></div>`,
    });
    const copy = card.querySelector('[data-role="copyuid"]');
    if (copy) {
      copy.addEventListener('click', async () => {
        // On failure the id is already on screen above, selectable - the same fallback the admin
        // page's own Copy button uses, rather than a second failure string to translate.
        try { await navigator.clipboard.writeText(uid || ''); copy.textContent = t('adm_copied'); }
        catch { /* the id stays visible in .msg-id */ }
      });
    }
    return;
  }

  const mine = myCode();
  const byCode = new Map(contacts.map((c) => [c.code, c.name]));
  const prof = loadProfile() || {};
  if (mine) byCode.set(mine, prof.name || mine);
  const nameOf = (code) => byCode.get(code) || code;

  // A LIST, then one conversation - the same shape a player's own inbox uses. The first version
  // printed every thread's last twelve lines one after another, which on a phone is a wall of
  // other people's half-conversations with no way to follow any single one of them.
  const list = () => {
    const body = threads.length
      ? `<ul class="msg-list">${threads.map((th, i) => `
          <li><button type="button" class="msg-row" data-th="${i}">
            <span class="msg-row-emoji" aria-hidden="true">💬</span>
            <span class="msg-row-main">
              <span class="msg-row-name">${esc(nameOf(th.a))} &harr; ${esc(nameOf(th.b))}</span>
              <span class="msg-row-prev">${esc(previewLine(th))}</span>
            </span>
            <span class="msg-row-when">${esc(whenText(th.at))}<br>${th.count}</span>
          </button></li>`).join('')}</ul>`
      : `<p class="msg-lead">${esc(navigator.onLine === false ? t('msg_offline') : t('msg_admin_empty'))}</p>`;
    shellHTML(card, { title: t('msg_admin_title'), sub: t('msg_admin_sub'), body });
    card.querySelectorAll('[data-th]').forEach((b) =>
      b.addEventListener('click', () => one(threads[+b.dataset.th])));
  };

  const one = (th) => {
    shellHTML(card, {
      title: `${nameOf(th.a)} ↔ ${nameOf(th.b)}`, sub: t('msg_admin_sub'), backable: true,
      body: `<ul class="msg-thread">${th.msgs.map((m, i) => `
        ${splitBefore(m, th.msgs[i - 1]) ? `<li class="msg-daysplit">${esc(splitText(m.atMs))}</li>` : ''}
        <li class="msg-bubble msg-bubble--${m.from === th.a ? 'theirs' : 'mine'}">
          <span class="msg-admin-who">${esc(nameOf(m.from))}</span>${esc(m.text || '')}</li>`).join('')}</ul>`,
    });
    card.querySelector('[data-role="back"]').addEventListener('click', list);
  };

  const previewLine = (th) => {
    const last = th.msgs[th.msgs.length - 1];
    return last ? `${nameOf(last.from)}: ${last.text || ''}` : '';
  };

  list();
}

export default { openMessages, myUnreadMessages };
