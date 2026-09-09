// golf/js/board.js - GOLF'S OWN LEADERBOARD, the detail the hub board deliberately does not carry.
//
// HANDOFF-GOLF-LAUNCH.md job C3. Matt: *"Since the golf leaderboard is likely a lot, maybe we have
// the more specific info within the golf game itself?"* Yes, and there is precedent: Skeeball shows
// ONE number on the hub board and the full picture on the machine's own backboard.
//
// WHAT THE HUB BOARD SHOWS AND WHY IT STAYS THAT WAY. `GOLF_BOARD_COURSE` is `pinevalley3` - the
// best three-hole round on Pine Valley, as a score to par, lower wins. It is the only metric on the
// whole leaderboard where lower is better, and the sort direction, the game-list filter and the
// rank badges were all changed for it. It is well chosen because 1-3 is the first thing the ladder
// opens, so it is the one round everybody has, which is what makes it comparable. This screen is
// the OTHER half: every round, for people who want to know.
//
// IT INVENTS NO DATA AND NO AGGREGATION. The round keys are frozen and already stored and synced
// (`pinevalley3`, `pinevalley3b`..`3f`, `pinevalley9`, `pinevalley9b`, `pinevalley18`). The people
// come from `readPlayersOnce()` -> `aggregatePlayers()`, which is exactly how the hub board reads
// them, and the number comes from `golfBestAt(group, roundKey)`, which is the same extractor the
// hub board uses with a different key. A second aggregation here would be a second answer to
// "who has played what", and the two would drift.
//
// A ROUND KEY WITH NO PAR ROW SHOWS A DASH, NEVER A FABRICATED ZERO (THE LAW rule 4). `golfBestAt`
// subtracts `GOLF_COURSE_PAR[key] || 0`, so on a key the par table has never heard of it would
// quietly return raw STROKES dressed as a score to par - a number that looks like a great round.
// This screen checks the par table itself before it will print a to-par figure.
//
// LENGTHS ARE NEVER MERGED OR COMPARED. A three-hole best and an eighteen-hole best are not the
// same measurement (rule 4), which is why the round is CHOSEN rather than summarised: every list on
// this screen is one round key, and the chips above it say which.

import { COURSES, ROUNDS, courseById, roundsForCourse, modesForCourse, roundKey, roundRange, roundPar }
  from './rounds.js';
import { golfBestAt, GOLF_COURSE_PAR } from '../../js/leaderboard-rank.js';
import { aggregatePlayers, buildIdentity } from '../../js/players-agg.js';
import { isHiddenName } from '../../js/hidden-players.js';
import { loadProfile } from '../../js/profile-store.js';
import { statsId } from '../../js/game-stats.js';
import { makeT } from '../../js/i18n.js';
import { STRINGS } from './strings.js';

const t = makeT(STRINGS);
const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Is this round key one the par table actually knows? See the header: without this check a key it
 *  has never heard of prints raw strokes as if they were a score to par. */
export function hasPar(key) { return Number.isFinite(GOLF_COURSE_PAR[key]); }

/** A score to par, as golf writes it: E, -3, +5. Null (never played, or no par row) is a dash.
 *
 *  `board_even` is GOLF'S OWN key, not the hub's `lb_golf_even`. This module's `t` is built from
 *  golf/js/strings.js, so a hub key resolves to nothing and prints itself - which is exactly what
 *  it did the first time this screen was driven: every level-par row read "lb_golf_even". */
export function toParText(v) {
  if (!Number.isFinite(v)) return '–';
  if (v === 0) return t('board_even');
  return v > 0 ? `+${v}` : String(v);
}

/**
 * One round's board: everyone who has a score on `key`, best first.
 *
 * PURE, so it can be tested without a browser - the whole ranking question lives here and the DOM
 * below only prints it. `players` is the raw `players/` map; `meKey` is this viewer's identity key
 * (`buildIdentity(...).keyFor(...)`), which is how every other screen in this app answers "which of
 * these rows is me" - a group carries a device COUNT, not a list of device ids.
 */
export function boardRows(players, key, meKey) {
  if (!hasPar(key)) return [];
  const rows = [];
  for (const g of aggregatePlayers(players || {})) {
    if (isHiddenName(g.name)) continue;
    const v = golfBestAt(g, key);
    if (!Number.isFinite(v)) continue;                    // never played this round: not a zero
    rows.push({ name: (g.name || '').trim(), toPar: v, key: g.key });
  }
  // LOWER WINS, and a tie is a tie - the rank is the position of the first row with this score, so
  // two players on -1 are both 1st and the next is 3rd. Names settle the print order inside a tie
  // so the list does not reshuffle itself between renders.
  rows.sort((a, b) => a.toPar - b.toPar || a.name.localeCompare(b.name));
  let rank = 0; let prev = null;
  rows.forEach((r, i) => {
    if (prev === null || r.toPar !== prev) { rank = i + 1; prev = r.toPar; }
    r.rank = rank;
    r.isMe = !!(meKey && r.key === meKey);
  });
  return rows;
}

function ensureCss() {
  if (document.getElementById('gf-board-css')) return;
  const el = document.createElement('style');
  el.id = 'gf-board-css';
  el.textContent = `
  /* FULLY OPAQUE. At 94 % the setup screen behind it showed through - the hole strip, the round
     buttons and their own "Best:" figures - which on a screen that is itself a list of scores is
     not a texture, it is a second set of numbers. */
  .gf-board { position: absolute; inset: 0; z-index: 60; display: flex; flex-direction: column;
              background: #0c1207; padding: 10px 10px 0; overflow: hidden; }
  .gf-board__top { display: flex; align-items: center; gap: 8px; flex: none; }
  .gf-board__h { flex: 1; min-width: 0; font-size: 18px; font-weight: 800; color: var(--gf-ink); }
  .gf-board__picks { flex: none; display: flex; flex-direction: column; gap: 6px; margin: 8px 0; }
  .gf-board__row { display: flex; gap: 6px; overflow-x: auto; overscroll-behavior: contain;
                   scrollbar-width: none; }
  .gf-board__row::-webkit-scrollbar { display: none; }
  .gf-board__row .gf-chip { flex: 0 0 auto; min-height: 38px; padding: 4px 12px; }
  /* THE LIST IS THE ONLY THING THAT SCROLLS, and it contains its own scroll: the game may not
     scroll (root CLAUDE.md), and a flick that reached the end of an uncontained list would pan
     whatever is behind it. */
  .gf-board__list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
                    padding-bottom: max(10px, env(safe-area-inset-bottom)); }
  .gf-board__r { display: flex; align-items: center; gap: 10px; padding: 9px 10px; margin-bottom: 6px;
                 background: rgba(255, 255, 255, .07); border: 1px solid rgba(0, 0, 0, .5); }
  .gf-board__r.is-me { background: rgba(255, 206, 58, .16); border-color: #8a6a00; }
  .gf-board__n { flex: none; width: 26px; font-size: 15px; font-weight: 800; color: #b9c4a8;
                 font-variant-numeric: tabular-nums; }
  .gf-board__who { flex: 1; min-width: 0; font-size: 15px; font-weight: 700; color: var(--gf-ink);
                   overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gf-board__v { flex: none; font-size: 18px; font-weight: 900; color: #ffce3a;
                 font-variant-numeric: tabular-nums; }
  .gf-board__sub { flex: none; font-size: 12px; font-weight: 700; color: #b9c4a8; }
  .gf-board__empty { padding: 18px 6px; font-size: 15px; color: #b9c4a8; text-align: center; }
  `;
  document.head.appendChild(el);
}

/**
 * Open the board over golf's own root. `players` is passed in already read, so this module never
 * touches the network: the caller decides when to pay for that and can show its own loading state.
 * Returns a `close()`.
 */
export function openBoard(root, opts = {}) {
  ensureCss();
  const players = opts.players || {};
  let course = courseById(opts.courseId || COURSES[0].id);
  const modes = modesForCourse(course);
  let mode = modes.includes(opts.mode) ? opts.mode : modes[0];
  let round = null;
  let meKey = '';
  try { meKey = buildIdentity(players).keyFor(loadProfile() || {}, statsId()); } catch { meKey = ''; }

  const host = document.createElement('div');
  host.className = 'gf-board';
  root.appendChild(host);
  const close = () => { host.remove(); if (opts.onClose) opts.onClose(); };

  const paint = () => {
    const rounds = roundsForCourse(course, mode);
    if (!round || !rounds.some((r) => r.id === round)) round = rounds.length ? rounds[0].id : null;
    const key = round ? roundKey(course, round) : null;
    const rows = key ? boardRows(players, key, meKey) : [];
    const r = ROUNDS.find((x) => x.id === round);
    host.innerHTML = `
      <div class="gf-board__top">
        <div class="gf-board__h">${esc(t('board_title'))}</div>
        <button type="button" class="gf-btn gf-btn--sm" data-role="b-close"><span>${esc(t('back'))}</span></button>
      </div>
      <div class="gf-board__picks">
        <div class="gf-board__row" role="group" aria-label="${esc(t('board_length'))}">
          ${modes.map((m) => `<button type="button" class="gf-btn gf-chip${m === mode ? ' is-on' : ''}"
            data-bmode="${m}"><span>${esc(t('mode_holes', { n: m }))}</span></button>`).join('')}
        </div>
        <div class="gf-board__row" role="group" aria-label="${esc(t('board_round'))}">
          ${rounds.map((x) => `<button type="button" class="gf-btn gf-chip${x.id === round ? ' is-on' : ''}"
            data-bround="${esc(x.id)}"><span>${esc(roundRange(x))}</span></button>`).join('')}
        </div>
      </div>
      <div class="gf-board__list">
        ${rows.length ? rows.map((row) => `<div class="gf-board__r${row.isMe ? ' is-me' : ''}">
          <span class="gf-board__n">${row.rank}</span>
          <span class="gf-board__who">${esc(row.name || t('board_unnamed'))}</span>
          <span class="gf-board__v">${esc(toParText(row.toPar))}</span>
        </div>`).join('')
    : `<div class="gf-board__empty">${esc(key && hasPar(key) ? t('board_empty') : t('board_nopar'))}</div>`}
      </div>`;
    // The par is named under the length chips rather than on every row: it is one number for the
    // whole list, and repeating it beside nine scores is the clutter this screen exists to avoid.
    const h = host.querySelector('.gf-board__h');
    if (h && r) h.textContent = `${t('board_title')} · ${roundRange(r)} · ${t('round_meta', { par: roundPar(course, r.id) })}`;

    host.querySelector('[data-role="b-close"]').addEventListener('click', close);
    // `data-bmode` / `data-bround`, NOT `data-mode` / `data-round`. The setup screen owns those two
    // and is still in the DOM behind this overlay, so a document-wide query for either finds ITS
    // chip - which is how the first drive of this screen ended up tapping a locked button on a
    // screen nobody could see. The handlers below are scoped to `host` and so were never wrong;
    // the names were, and a name that is only safe because of where you happen to look it up is a
    // trap for the next person to debug this.
    for (const b of host.querySelectorAll('[data-bmode]')) {
      b.addEventListener('click', () => { mode = +b.dataset.bmode; round = null; paint(); });
    }
    for (const b of host.querySelectorAll('[data-bround]')) {
      b.addEventListener('click', () => { round = b.dataset.bround; paint(); });
    }
  };
  paint();
  return close;
}

export default { openBoard, boardRows, toParText, hasPar };
