// bug-report-ui.js - the SCREEN half of "Report a bug" (js/bug-report.js is the data half), plus
// the admin inbox that shows Matt what has come in.
//
// THE LAW (root CLAUDE.md): this file renders. It writes nothing except through js/bug-report.js,
// which touches only its own two new nodes and its own new local key. No stats, no profile, no
// players/ record is reachable from here.
//
// BUILT ON css/ui.css, deliberately: that layer has had no shipped consumer since 2026-08-01, and
// the root CLAUDE.md says a brand-new surface is the cheapest place to adopt it because there is
// nothing to migrate. Overlay, modal, buttons and fields are `.gh-*` primitives; the local `.bug-*`
// block adds only what does not exist yet (the screenshot strip, the inbox list). Dark mode, the
// focus ring and reduced motion come free with it.
//
// Three entry points, all lazily imported by js/hub.js (openBugReport and openMyReplies also by
// profile/index.html):
//   openBugReport({ gameId, gameTitle }) - the player's form
//   openBugInbox()                       - Matt's inbox; the hub renders its button for him only
//   openMyReplies()                      - the player's own side: what Matt wrote back

import {
  MAX_SHOTS, MAX_REPLY, buildBugReport, submitBugReport, prepareScreenshot, fitsShotBudget,
  queuePendingReport, pendingCount, readBugReports, readBugShots, setBugStatus, summarizeEnvironment,
  countUnread, visibleInInbox, deleteBugReport, undeleteBugReport, replyToBugReport,
  readMyReplies, markRepliesSeen, repliesSeenAt, countUnreadReplies,
} from './bug-report.js';
import { makeT, getLang } from './i18n.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);

/** When Matt last opened the inbox, so the hub button can carry an unread count. A preference,
 *  not history (rule 2's carve-out) - the reports live in Firebase and nothing here touches them. */
const SEEN_KEY = 'gamehub.bugadmin.v1';

const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// --- css ------------------------------------------------------------------------------------

function ensureCss() {
  if (!document.querySelector('link[data-gh-ui-css="1"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../css/ui.css', import.meta.url).href;
    link.setAttribute('data-gh-ui-css', '1');
    document.head.appendChild(link);
  }
  if (document.getElementById('bug-css')) return;
  const style = document.createElement('style');
  style.id = 'bug-css';
  style.textContent = `
  .bug-overlay { z-index: 300; padding: max(var(--gh-sp-4), env(safe-area-inset-top)) var(--gh-sp-4)
                 max(var(--gh-sp-4), env(safe-area-inset-bottom)); align-content: center; }
  .bug-modal { width: min(460px, 100%); }
  .bug-modal--wide { width: min(680px, 100%); max-height: 90vh; }
  .bug-lead { margin: 0 0 var(--gh-sp-4); font-size: var(--gh-fs-sm); color: var(--gh-muted); line-height: 1.5; }
  .bug-field + .bug-field { margin-top: var(--gh-sp-4); }
  /* The title used to be followed by the lead paragraph; with that gone the first label needs its
     own breathing room, or it reads as part of the heading. */
  .gh-modal__title + .bug-field { margin-top: var(--gh-sp-4); }
  .bug-text { min-height: 96px; padding: var(--gh-sp-3); line-height: 1.45; resize: vertical; font-family: var(--gh-font); }
  select.bug-select { padding: 0 var(--gh-sp-3); }
  .bug-shots { display: flex; flex-wrap: wrap; gap: var(--gh-sp-2); margin-top: var(--gh-sp-2); }
  .bug-shot { position: relative; width: 84px; height: 84px; border-radius: var(--gh-r-md);
              overflow: hidden; border: 1px solid var(--gh-border); background: var(--gh-surface-2); }
  .bug-shot img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .bug-shot button { position: absolute; top: 2px; right: 2px; width: 26px; height: 26px; border: 0;
              border-radius: 50%; background: rgba(9, 16, 28, .72); color: #fff; font-size: 15px;
              line-height: 1; cursor: pointer; }
  /* .bug-disc is the inbox's "Full report (JSON)" fold; the report form has no disclosure. */
  .bug-disc { margin-top: var(--gh-sp-4); font-size: var(--gh-fs-sm); color: var(--gh-muted); }
  .bug-disc > summary { cursor: pointer; font-weight: 700; }
  .bug-msg { margin: var(--gh-sp-3) 0 0; font-size: var(--gh-fs-sm); font-weight: 600; color: var(--gh-ink); min-height: 1.2em; }
  .bug-msg.is-err { color: var(--gh-cb-vermilion); }
  .bug-result { text-align: center; padding: var(--gh-sp-4) 0 0; }
  .bug-result-icon { font-size: 40px; line-height: 1; }
  .bug-result h3 { margin: var(--gh-sp-3) 0 var(--gh-sp-2); font-size: var(--gh-fs-lg); }
  .bug-result p { margin: 0 auto; max-width: 34ch; font-size: var(--gh-fs-sm); color: var(--gh-muted); line-height: 1.5; }
  /* --- inbox --------------------------------------------------------------------------- */
  .bug-list { list-style: none; margin: var(--gh-sp-3) 0 0; padding: 0; }
  .bug-row { display: block; width: 100%; text-align: left; padding: var(--gh-sp-3); border: 1px solid var(--gh-border);
             border-radius: var(--gh-r-md); background: var(--gh-surface); color: var(--gh-ink); cursor: pointer;
             font-family: var(--gh-font); }
  .bug-list li + li { margin-top: var(--gh-sp-2); }
  .bug-row-top { display: flex; align-items: center; gap: var(--gh-sp-2); font-size: var(--gh-fs-sm); font-weight: 700; }
  .bug-row-when { margin-left: auto; font-weight: 600; color: var(--gh-muted); font-size: var(--gh-fs-xs);
                  white-space: nowrap; }
  .bug-row-desc { margin: var(--gh-sp-1) 0 0; font-size: var(--gh-fs-sm); color: var(--gh-ink);
                  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .bug-row-meta { margin: var(--gh-sp-1) 0 0; font-size: var(--gh-fs-xs); color: var(--gh-muted); }
  .bug-detail-shots { display: flex; flex-wrap: wrap; gap: var(--gh-sp-2); margin-top: var(--gh-sp-2); }
  /* A phone screenshot is tall; bounding it by height as well keeps the rest of the report
     (the JSON, the status buttons) reachable without a long scroll past one picture. */
  .bug-detail-shots img { max-width: min(260px, 100%); max-height: 50vh; width: auto; height: auto;
              border-radius: var(--gh-r-md); border: 1px solid var(--gh-border); }
  .bug-json { font: 11px/1.5 var(--gh-font-mono); white-space: pre-wrap; word-break: break-word;
              background: var(--gh-surface-2); border-radius: var(--gh-r-md); padding: var(--gh-sp-3);
              max-height: 300px; overflow: auto; overscroll-behavior: contain; margin: var(--gh-sp-2) 0 0; }
  .bug-quote { margin: var(--gh-sp-2) 0 0; padding: var(--gh-sp-3); border-radius: var(--gh-r-md);
               background: var(--gh-surface-2); white-space: pre-wrap; word-break: break-word;
               font-size: var(--gh-fs-sm); line-height: 1.5; }
  /* --- replies -------------------------------------------------------------------------- */
  /* Matt's answer, on both sides of the conversation. The left rule is the only decoration:
     it reads as a quoted answer at a glance without needing a colour to carry the meaning. */
  .bug-reply { margin: var(--gh-sp-2) 0 0; padding: var(--gh-sp-3); border-radius: var(--gh-r-md);
               background: var(--gh-surface-2); border-left: 3px solid var(--gh-accent);
               white-space: pre-wrap; word-break: break-word; font-size: var(--gh-fs-sm); line-height: 1.5; }
  .bug-reply-who { display: block; font-size: var(--gh-fs-xs); font-weight: 700; color: var(--gh-muted);
                   margin-bottom: var(--gh-sp-1); }
  .bug-thread { list-style: none; margin: var(--gh-sp-3) 0 0; padding: 0; }
  .bug-thread li + li { margin-top: var(--gh-sp-3); padding-top: var(--gh-sp-3); border-top: 1px solid var(--gh-border); }
  /* The player's own words above Matt's answer, dimmer - the reply is what they came to read. */
  .bug-thread-mine { font-size: var(--gh-fs-xs); color: var(--gh-muted); margin: 0; }
  /* css/ui.css has no danger token, and a hard-coded dark red is unreadable on a dark surface, so
     both halves are spelled out. The WORD on the button carries the meaning either way - colour is
     secondary here, per the repo's colourblind rule. */
  .bug-danger { color: #b3261e; }
  :root.gh-dark .bug-danger { color: #ff9a90; }
  `;
  document.head.appendChild(style);
}

// --- one overlay at a time --------------------------------------------------------------------

let _host = null;
let _onKey = null;

function closeOverlay() {
  if (_onKey) { document.removeEventListener('keydown', _onKey); _onKey = null; }
  if (_host) { _host.remove(); _host = null; }
}

/** Mount an overlay. `guardClose` decides whether a scrim tap or Escape may close it: the form
 *  says no once something is typed, so a mis-tap cannot throw away what someone just wrote (the X
 *  and Cancel always work). */
function mountOverlay({ wide, ariaLabel, guardClose }) {
  ensureCss();
  closeOverlay();
  const host = document.createElement('div');
  host.className = 'gh-overlay bug-overlay';
  host.innerHTML = `<div class="gh-modal bug-modal${wide ? ' bug-modal--wide' : ''}" role="dialog" aria-modal="true"
       aria-label="${esc(ariaLabel)}"></div>`;
  document.body.appendChild(host);
  _host = host;
  const card = host.querySelector('.gh-modal');
  const mayClose = () => !guardClose || guardClose();
  host.addEventListener('click', (e) => { if (e.target === host && mayClose()) closeOverlay(); });
  _onKey = (e) => { if (e.key === 'Escape' && mayClose()) closeOverlay(); };
  document.addEventListener('keydown', _onKey);
  return card;
}

// --- the player's form --------------------------------------------------------------------------

/**
 * Open the report form.
 * @param {{gameId?:string, gameTitle?:string}} opts - `gameId` is a HUB id ('connect-four'), which
 *        preselects the game the player was last in. All optional: the form works opened cold from
 *        the profile page.
 */
export async function openBugReport(opts = {}) {
  const shots = [];
  let sending = false;

  // The game list comes from js/game-stats-ui.js's TABS + the shared game_title_* keys
  // (gameChoices there), so this picker cannot drift from the names used everywhere else and a new
  // game appears automatically. It is filled AFTER the form is on screen, never awaited before it:
  // on a slow connection that import is a network round trip, and blocking on it meant tapping
  // "Try it" showed nothing at all for seconds (Matt, on train wifi). The form now paints
  // immediately with the hub options, and the games arrive into the same <select> a moment later.
  let choices = [];

  const card = mountOverlay({
    ariaLabel: t('bug_dialog_aria'),
    guardClose: () => !sending && !(card && card.querySelector('[data-role="what"]')
      && card.querySelector('[data-role="what"]').value.trim()),
  });

  const pending = pendingCount();
  card.innerHTML = `
    <button type="button" class="gh-modal__close" data-role="close" aria-label="${esc(t('bug_close'))}">&times;</button>
    <h2 class="gh-modal__title">🐞 ${esc(t('bug_title'))}</h2>
    <div class="bug-field gh-field">
      <label class="gh-field__label" for="bug-where">${esc(t('bug_where_label'))}</label>
      <select class="gh-input bug-select" id="bug-where" data-role="where">
        <option value="" selected>${esc(t('bug_where_placeholder'))}</option>
        <optgroup label="${esc(t('bug_where_hub_group'))}">
          <option value="hub">${esc(t('bug_where_hub'))}</option>
          <option value="leaderboards">${esc(t('hub_leaderboard_btn'))}</option>
          <option value="stats">${esc(t('hub_stats_btn'))}</option>
          <option value="profile">${esc(t('hub_profile_btn'))}</option>
        </optgroup>
        <optgroup label="${esc(t('bug_where_games'))}" data-role="games"></optgroup>
      </select>
    </div>
    <div class="bug-field gh-field">
      <label class="gh-field__label" for="bug-what">${esc(t('bug_what_label'))}</label>
      <textarea class="gh-input bug-text" id="bug-what" data-role="what" rows="4" maxlength="1200"
                placeholder="${esc(t('bug_what_placeholder'))}"></textarea>
    </div>
    <div class="bug-field gh-field">
      <span class="gh-field__label">${esc(t('bug_shots_label'))}</span>
      <div class="bug-shots" data-role="shots"></div>
      <input type="file" accept="image/*" multiple hidden data-role="file">
      <button type="button" class="gh-btn gh-btn--sm" data-role="addshot" style="margin-top:8px">${esc(t('bug_add_shot'))}</button>
    </div>
    <p class="bug-msg" data-role="msg" role="status" aria-live="polite">${
      pending ? esc(pending === 1 ? t('bug_pending_one') : t('bug_pending_many', { n: pending })) : ''}</p>
    <div class="gh-modal__actions">
      <button type="button" class="gh-btn gh-btn--ghost" data-role="cancel">${esc(t('bug_cancel'))}</button>
      <button type="button" class="gh-btn gh-btn--primary" data-role="send">${esc(t('bug_send'))}</button>
    </div>`;

  const q = (sel) => card.querySelector(sel);
  const whatEl = q('[data-role="what"]');
  const whereEl = q('[data-role="where"]');
  const msgEl = q('[data-role="msg"]');
  const shotsEl = q('[data-role="shots"]');
  const fileEl = q('[data-role="file"]');
  const sendBtn = q('[data-role="send"]');

  // Fill the games group as soon as it arrives. Preselecting the last-played game happens HERE,
  // not in the markup, because the option does not exist until now.
  import('./game-stats-ui.js').then((m) => {
    choices = m.gameChoices();
    const group = card.querySelector('[data-role="games"]');
    if (!group) return;
    group.innerHTML = choices.map((c) => `<option value="${esc(c.hubId)}">${esc(c.title)}</option>`).join('');
    if (opts.gameId && choices.some((c) => c.hubId === opts.gameId) && !whereEl.value) whereEl.value = opts.gameId;
  }).catch(() => { /* the hub options above are still a usable answer */ });

  const say = (text, isErr) => {
    msgEl.textContent = text || '';
    msgEl.classList.toggle('is-err', !!isErr);
  };

  // No per-field "what gets sent" list on this form (Matt, 2026-08-11): the lead line says the
  // phone and app details go with it, and that is the whole disclosure. `gatherEnvironment()` is
  // still called at send time by buildBugReport - what was dropped is the preview, not the data.

  function renderShots() {
    shotsEl.innerHTML = shots.map((s, i) => `
      <div class="bug-shot">
        <img src="${s.dataUrl}" alt="">
        <button type="button" data-remove="${i}" aria-label="${esc(t('bug_shot_remove', { n: i + 1 }))}">&times;</button>
      </div>`).join('');
  }
  shotsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    shots.splice(+btn.dataset.remove, 1);
    renderShots();
  });

  q('[data-role="addshot"]').addEventListener('click', () => fileEl.click());
  fileEl.addEventListener('change', async () => {
    const files = Array.from(fileEl.files || []);
    fileEl.value = '';   // so picking the same file twice in a row still fires 'change'
    for (const f of files) {
      if (shots.length >= MAX_SHOTS) { say(t('bug_shots_full', { n: MAX_SHOTS }), true); break; }
      try {
        const shot = await prepareScreenshot(f);
        if (!fitsShotBudget(shots, shot.bytes)) { say(t('bug_shot_too_big'), true); continue; }
        shots.push(shot);
        say('');
      } catch (err) {
        say(t('bug_shot_err', { msg: (err && err.message) || err }), true);
      }
    }
    renderShots();
  });

  const close = () => closeOverlay();
  q('[data-role="close"]').addEventListener('click', close);
  q('[data-role="cancel"]').addEventListener('click', close);

  sendBtn.addEventListener('click', async () => {
    if (sending) return;
    const description = whatEl.value.trim();
    if (!description) { say(t('bug_need_text'), true); whatEl.focus(); return; }
    sending = true;
    sendBtn.disabled = true;
    say(t('bug_sending'));
    const gameId = whereEl.value || null;
    // The hub options ('hub'/'leaderboards'/'stats'/'profile') are not games, so fall back to the
    // <option>'s own text rather than leaving the inbox with a bare id.
    const gameTitle = gameId
      ? ((choices.find((c) => c.hubId === gameId) || {}).title
         || (whereEl.selectedOptions[0] && whereEl.selectedOptions[0].textContent.trim()) || null)
      : null;
    let report;
    try {
      report = await buildBugReport({ description, gameId, gameTitle, screenshots: shots });
    } catch (err) {
      // Gathering must not be able to swallow a report: send what we do have rather than nothing.
      console.error('[bug-report] could not gather the full context; sending the description alone', err);
      report = {
        version: 1, createdAt: new Date().toISOString(), createdAtMs: Date.now(), status: 'new',
        description, game: gameId, gameTitle, gatherError: String((err && err.message) || err), _shots: shots,
      };
    }
    const res = await submitBugReport(report);
    sending = false;
    if (res.ok) {
      showResult(card, '✅', t('bug_sent_title'), res.shotsOk === false ? t('bug_sent_no_shots') : t('bug_sent_body'));
      return;
    }
    const queued = queuePendingReport(report);
    if (queued.queued) {
      showResult(card, '📥', t('bug_queued_title'),
        queued.shotsDropped ? t('bug_queued_no_shots') : t('bug_queued_body'));
    } else {
      showResult(card, '⚠️', t('bug_failed_title'), t('bug_failed_body', { reason: res.reason || queued.reason || '' }));
    }
  });

  setTimeout(() => { try { whatEl.focus(); } catch { /* ignore */ } }, 60);
}

/** Replace the form with one plain outcome. Always dismissable, per the root CLAUDE.md's rule that
 *  a popup which concludes something gets a way out that is not "try again". */
function showResult(card, icon, title, body) {
  card.innerHTML = `
    <button type="button" class="gh-modal__close" data-role="close" aria-label="${esc(t('bug_close'))}">&times;</button>
    <div class="bug-result">
      <div class="bug-result-icon" aria-hidden="true">${icon}</div>
      <h3>${esc(title)}</h3>
      <p>${esc(body)}</p>
    </div>
    <div class="gh-modal__actions" style="justify-content:center">
      <button type="button" class="gh-btn gh-btn--primary" data-role="done">${esc(t('bug_done'))}</button>
    </div>`;
  card.querySelector('[data-role="close"]').addEventListener('click', closeOverlay);
  card.querySelector('[data-role="done"]').addEventListener('click', closeOverlay);
}

// --- the admin inbox ------------------------------------------------------------------------------

function readSeenAt() {
  // Number(), never `| 0` - see the note on ms() in js/bug-report.js: a bitwise op truncates an
  // epoch-ms timestamp to 32 bits and quietly turns "since I last looked" into nonsense.
  try { return Number((JSON.parse(localStorage.getItem(SEEN_KEY) || 'null') || {}).lastSeenMs) || 0; }
  catch { return 0; }
}
function writeSeenAt(ms) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify({ version: 1, lastSeenMs: ms })); }
  catch { /* a badge that forgets it was read is not worth an error */ }
}

/** Reports arrived since this device last opened the inbox. 0 offline, so the hub's button shows
 *  no count rather than claiming there is nothing. Admin only. */
export async function adminUnreadCount() {
  return countUnread(await readBugReports(), readSeenAt());
}

/** `short` for the list, where a wrapped two-line date pushed the reporter's name off its row. */
const whenText = (ms, short) => {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleString(getLang() === 'es' ? 'es-ES' : 'en-GB',
      { dateStyle: short ? 'short' : 'medium', timeStyle: 'short' });
  } catch { return new Date(ms).toISOString(); }
};

/** Every report, newest first; screenshots and the full payload load on demand. */
export async function openBugInbox() {
  const card = mountOverlay({ wide: true, ariaLabel: t('bug_inbox_dialog_aria') });
  const shell = (inner) => {
    card.innerHTML = `
      <button type="button" class="gh-modal__close" data-role="close" aria-label="${esc(t('bug_close'))}">&times;</button>
      <h2 class="gh-modal__title">🐞 ${esc(t('bug_inbox_title'))}</h2>
      ${inner}`;
    card.querySelector('[data-role="close"]').addEventListener('click', closeOverlay);
  };
  shell(`<p class="bug-lead">${esc(t('bug_inbox_loading'))}</p>`);

  // Deleted reports are filtered here, not in the query: the record stays in Firebase and
  // read-bug-reports.mjs can still print it. See deleteBugReport's note.
  let reports = visibleInInbox(await readBugReports());
  // Opening the inbox IS reading it; the count resets from here even if a report is left open.
  writeSeenAt(Date.now());
  // Done reports fold away instead of sitting on top of the ones still needing an answer. This is
  // what "Mark as done" was missing: it stamped a status nothing acted on, so a handled report
  // stayed exactly where it was, just un-bolded.
  let showDone = false;

  // Replaying the announcement, for Matt only (the inbox is his). It shows the entry REGARDLESS of
  // the seen-list and of adminOnly, and touches no storage - so testing a change to the popup does
  // not mean clearing localStorage on a phone, and cannot alter what anyone else will be shown.
  const previewBtn = `<button type="button" class="gh-btn gh-btn--ghost gh-btn--sm" data-role="preview-ann"
        style="margin-top:8px">${esc(t('bug_inbox_preview'))}</button>`;
  const wirePreview = () => {
    const btn = card.querySelector('[data-role="preview-ann"]');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      closeOverlay();
      try {
        const [{ ANNOUNCEMENTS }, { showAnnouncement }] = await Promise.all([
          import('./announce.js'), import('./announce-ui.js'),
        ]);
        const a = ANNOUNCEMENTS[ANNOUNCEMENTS.length - 1];
        if (a) await showAnnouncement(a, { onAction: (action) => { if (action === 'bug-report') openBugReport(); } });
      } catch (err) { console.error('[bug-inbox] could not preview the announcement', err); }
    });
  };

  const rowHTML = (r, i) => `
      <li><button type="button" class="bug-row" data-open="${i}">
        <span class="bug-row-top">
          <span class="gh-chip${r.status === 'done' ? '' : ' gh-chip--accent'}">${esc(r.status === 'done' ? t('bug_inbox_done_tag') : t('bug_inbox_new_tag'))}</span>
          <span>${esc(r.reporter && r.reporter.name ? `${r.reporter.emoji || ''} ${r.reporter.name}` : '?')}</span>
          <span class="bug-row-when">${esc(whenText(r.createdAtMs, true))}</span>
        </span>
        <span class="bug-row-desc">${esc(r.description || '')}</span>
        <span class="bug-row-meta">${esc([r.gameTitle || r.game, r.summary || summarizeEnvironment(r.environment),
          r.shotCount ? `${r.shotCount} 📷` : '', r.reply ? t('bug_inbox_replied_tag') : ''].filter(Boolean).join(' · '))}</span>
      </button></li>`;

  const list = () => {
    if (!reports.length) {
      shell(`<p class="bug-lead">${esc(navigator.onLine === false ? t('bug_inbox_offline') : t('bug_inbox_empty'))}</p>${previewBtn}`);
      wirePreview();
      return;
    }
    // Index against the SHARED array, so a row's data-open still resolves after the done fold is
    // toggled and the two groups are rendered in a different order than `reports` holds them.
    const open = reports.map((r, i) => [r, i]).filter(([r]) => r.status !== 'done');
    const done = reports.map((r, i) => [r, i]).filter(([r]) => r.status === 'done');
    shell(`${previewBtn}
      ${open.length ? `<ul class="bug-list">${open.map(([r, i]) => rowHTML(r, i)).join('')}</ul>`
    : `<p class="bug-lead">${esc(t('bug_inbox_all_done'))}</p>`}
      ${done.length ? `
        <button type="button" class="gh-btn gh-btn--ghost gh-btn--sm" data-role="toggle-done" style="margin-top:12px">
          ${esc(showDone ? t('bug_inbox_hide_done', { n: done.length }) : t('bug_inbox_show_done', { n: done.length }))}
        </button>
        ${showDone ? `<ul class="bug-list">${done.map(([r, i]) => rowHTML(r, i)).join('')}</ul>` : ''}` : ''}`);
    wirePreview();
    const toggle = card.querySelector('[data-role="toggle-done"]');
    if (toggle) toggle.addEventListener('click', () => { showDone = !showDone; list(); });
    card.querySelectorAll('.bug-list').forEach((ul) => ul.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-open]');
      if (btn) detail(reports[+btn.dataset.open]);
    }));
  };

  const detail = async (r) => {
    shell(`
      <button type="button" class="gh-btn gh-btn--ghost gh-btn--sm" data-role="bug-back">${t('bug_inbox_back')}</button>
      <p class="bug-row-meta" style="margin-top:12px">
        ${esc([r.reporter && r.reporter.name, whenText(r.createdAtMs), r.gameTitle || r.game].filter(Boolean).join(' · '))}
      </p>
      <p class="bug-quote">${esc(r.description || '')}</p>
      <p class="bug-row-meta" style="margin-top:12px">${esc(r.summary || summarizeEnvironment(r.environment))}</p>
      <h3 style="margin:16px 0 0;font-size:15px">${esc(t('bug_inbox_shots'))}</h3>
      <div class="bug-detail-shots" data-role="shots"><span class="bug-row-meta">${esc(t('bug_inbox_loading'))}</span></div>
      ${r.reply ? `<div class="bug-reply">
        <span class="bug-reply-who">${esc(t('bug_reply_sent_at', { when: whenText(r.reply.atMs) }))}</span>${esc(r.reply.text || '')}
      </div>` : ''}
      <h3 style="margin:16px 0 0;font-size:15px">${esc(r.reply ? t('bug_reply_again') : t('bug_reply_title'))}</h3>
      <textarea class="gh-input bug-text" data-role="reply" rows="3" maxlength="${MAX_REPLY}"
        placeholder="${esc(t('bug_reply_placeholder'))}"></textarea>
      <details class="bug-disc"><summary>${esc(t('bug_inbox_details'))}</summary>
        <pre class="bug-json">${esc(JSON.stringify(r, null, 2))}</pre>
      </details>
      <p class="bug-msg" data-role="msg" role="status" aria-live="polite"></p>
      <div class="gh-modal__actions">
        <button type="button" class="gh-btn gh-btn--sm" data-role="copy">${esc(t('bug_inbox_copy'))}</button>
        <button type="button" class="gh-btn gh-btn--sm bug-danger" data-role="del">${esc(t('bug_inbox_delete'))}</button>
        <button type="button" class="gh-btn gh-btn--sm" data-role="status">${
          esc(r.status === 'done' ? t('bug_inbox_reopen') : t('bug_inbox_mark_done'))}</button>
        <button type="button" class="gh-btn gh-btn--primary gh-btn--sm" data-role="send-reply">${esc(t('bug_reply_send'))}</button>
      </div>`);
    card.querySelector('[data-role="bug-back"]').addEventListener('click', list);
    const msg = card.querySelector('[data-role="msg"]');
    card.querySelector('[data-role="copy"]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(JSON.stringify(r, null, 2)); msg.textContent = t('bug_inbox_copied'); }
      catch { msg.textContent = t('bug_inbox_copy_err'); }
    });
    card.querySelector('[data-role="status"]').addEventListener('click', async (e) => {
      const next = r.status === 'done' ? 'new' : 'done';
      e.currentTarget.disabled = true;
      const ok = await setBugStatus(r.id, next);
      if (ok) { r.status = next; detail(r); }
      else { e.currentTarget.disabled = false; msg.textContent = t('bug_inbox_offline'); }
    });

    // Replying marks the report done in the same write - answering it IS handling it, and having
    // to remember a second tap is how an inbox fills up with things already dealt with.
    card.querySelector('[data-role="send-reply"]').addEventListener('click', async (e) => {
      const box = card.querySelector('[data-role="reply"]');
      const text = (box.value || '').trim();
      if (!text) { msg.textContent = t('bug_reply_empty'); box.focus(); return; }
      e.currentTarget.disabled = true;
      msg.textContent = t('bug_reply_sending');
      const res = await replyToBugReport(r, text);
      if (!res.ok) { e.currentTarget.disabled = false; msg.textContent = t('bug_reply_failed'); return; }
      r.reply = { text, atMs: Date.now() };
      r.status = 'done';
      detail(r);
      // `delivered:false` means it saved on the report but the reporter cannot be reached, because
      // that report carries no deviceId to index it under. Saying so beats a green tick over a
      // message nobody will ever read.
      card.querySelector('[data-role="msg"]').textContent = res.delivered ? t('bug_reply_ok') : t('bug_reply_undeliverable');
    });

    // Two taps, deliberately: the confirm is the safety, not the soft delete underneath it.
    let armed = false;
    card.querySelector('[data-role="del"]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (!armed) { armed = true; btn.textContent = t('bug_inbox_delete_confirm'); msg.textContent = t('bug_inbox_delete_note'); return; }
      btn.disabled = true;
      const ok = await deleteBugReport(r.id);
      if (!ok) { btn.disabled = false; msg.textContent = t('bug_inbox_offline'); return; }
      reports = reports.filter((x) => x.id !== r.id);
      list();
      card.insertAdjacentHTML('beforeend',
        `<p class="bug-msg" data-role="undo-wrap">${esc(t('bug_inbox_deleted'))}
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--sm" data-role="undo">${esc(t('bug_inbox_undo'))}</button></p>`);
      card.querySelector('[data-role="undo"]').addEventListener('click', async (ev) => {
        ev.currentTarget.disabled = true;
        if (await undeleteBugReport(r.id)) { reports = visibleInInbox(await readBugReports()); list(); }
        else ev.currentTarget.disabled = false;
      });
    });
    const shotsHost = card.querySelector('[data-role="shots"]');
    const shots = await readBugShots(r.id);
    shotsHost.innerHTML = shots.length
      ? shots.map((s) => `<img src="${s.dataUrl}" alt="${esc(s.name || '')}">`).join('')
      : `<span class="bug-row-meta">${esc(t('bug_inbox_no_shots'))}</span>`;
  };

  list();
}

// --- the player's own side ------------------------------------------------------------------------
// The other half of a report: what Matt wrote back. Reads bugReplies/<thisDeviceId> - one small
// node of the player's own, never the whole bugReports table - so a player can no more browse
// everyone else's reports from here than they could before.

/** Replies waiting for THIS device. Drives the profile pill's badge in js/hub.js. 0 offline. */
export async function myUnreadReplies() {
  return countUnreadReplies(await readMyReplies(), repliesSeenAt());
}

/** The player's thread: their report, and Matt's answer under it. Opening it clears the badge. */
export async function openMyReplies() {
  const card = mountOverlay({ ariaLabel: t('bug_mine_dialog_aria') });
  const shell = (inner) => {
    card.innerHTML = `
      <button type="button" class="gh-modal__close" data-role="close" aria-label="${esc(t('bug_close'))}">&times;</button>
      <h2 class="gh-modal__title">📬 ${esc(t('bug_mine_title'))}</h2>
      ${inner}`;
    card.querySelector('[data-role="close"]').addEventListener('click', closeOverlay);
  };
  shell(`<p class="bug-lead">${esc(t('bug_inbox_loading'))}</p>`);

  const replies = await readMyReplies();
  // Opening IS reading. Stamped from the newest reply's own timestamp, not from now: a reply that
  // lands while this screen is open is still unread next time, rather than being silently skipped.
  markRepliesSeen(replies.length ? replies[0].atMs : Date.now());

  if (!replies.length) {
    shell(`<p class="bug-lead">${esc(navigator.onLine === false ? t('bug_mine_offline') : t('bug_mine_empty'))}</p>
      <div class="gh-modal__actions">
        <button type="button" class="gh-btn gh-btn--primary" data-role="report">${esc(t('bug_btn'))}</button>
      </div>`);
    card.querySelector('[data-role="report"]').addEventListener('click', () => { closeOverlay(); openBugReport(); });
    return;
  }

  shell(`<ul class="bug-thread">${replies.map((r) => `
    <li>
      <p class="bug-thread-mine">${esc([whenText(r.reportCreatedAtMs, true), r.game].filter(Boolean).join(' · '))}</p>
      <p class="bug-quote">${esc(r.reportDescription || '')}</p>
      <div class="bug-reply">
        <span class="bug-reply-who">${esc(t('bug_mine_from', { when: whenText(r.atMs) }))}</span>${esc(r.text || '')}
      </div>
    </li>`).join('')}</ul>
    <div class="gh-modal__actions">
      <button type="button" class="gh-btn gh-btn--ghost" data-role="report">${esc(t('bug_btn'))}</button>
      <button type="button" class="gh-btn gh-btn--primary" data-role="done">${esc(t('bug_done'))}</button>
    </div>`);
  card.querySelector('[data-role="report"]').addEventListener('click', () => { closeOverlay(); openBugReport(); });
  card.querySelector('[data-role="done"]').addEventListener('click', closeOverlay);
}

export default { openBugReport, openBugInbox, openMyReplies, adminUnreadCount, myUnreadReplies };
