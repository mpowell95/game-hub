import { ICON_SYNC, ICON_CLOUD_SLASH, ICON_BRANCH } from './icons.js';

function marker(kind) {
  if (kind === 'you') {
    return `<span class="bb-marker bb-marker--circle"><svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="6"/></svg></span>`;
  }
  return `<span class="bb-marker bb-marker--triangle"><svg viewBox="0 0 12 12"><polygon points="6,0 12,12 0,12"/></svg></span>`;
}

const STANDINGS_TOP4 = [
  { rank: 1, code: 'IRM', wl: '6-0', me: false },
  { rank: 2, code: 'BHC', wl: '5-1', me: false },
  { rank: 3, code: 'YOU', wl: '4-2', me: true },
  { rank: 4, code: 'GRV', wl: '3-3', me: false },
  { rank: 5, code: 'TPP', wl: '3-3', me: false },
];

const STANDINGS_BELOW4 = [
  { rank: 1, code: 'IRM', wl: '6-0', me: false },
  { rank: 2, code: 'BHC', wl: '5-1', me: false },
  { rank: 3, code: 'CDR', wl: '4-2', me: false },
  { rank: 4, code: 'GRV', wl: '4-2', me: false },
  { rank: 7, code: 'YOU', wl: '2-4', me: true },
];

// Every state's status row is TWO reserved lines, always - the row's height must
// never depend on how much a state has to say. A state with nothing for line 2
// still occupies the same box; the line is blank, not absent. Measured once
// (below, in renderCareerHome) and pinned in round2.css as a fixed height, not a
// min-height, so a future longer sentence overflows loudly instead of growing
// the row.
const STATUS = {
  healthy: { glyph: null, spin: false, l1: 'College, Season 2', l2: '' },
  pulling: { glyph: ICON_SYNC, spin: true, l1: 'Syncing', l2: '' },
  'pulling-stale': { glyph: ICON_SYNC, spin: true, l1: 'Syncing', l2: '' },
  offline: {
    glyph: ICON_CLOUD_SLASH, spin: false,
    l1: 'You are offline. Your career is saved on this phone.',
    l2: 'It syncs itself next time you open the hub online.',
  },
  fork: {
    glyph: ICON_BRANCH, spin: false,
    l1: 'Your career was continued on another device.',
    l2: "This phone's version has been kept.",
  },
};

function statusRow(state) {
  const s = STATUS[state];
  const clickable = state === 'fork';
  return `<div class="bb-status bb-status--${state}"${clickable ? ' data-fork-row' : ''}>
    <span class="bb-status__glyphslot">${s.glyph ? `<span class="bb-status__glyph${s.spin ? ' spin' : ''}">${s.glyph}</span>` : ''}</span>
    <span class="bb-status__lines">
      <span class="bb-status__line">${s.l1}</span>
      <span class="bb-status__line">${s.l2}</span>
    </span>
  </div>`;
}

// Per-state next-game content. `park` only ever prints for Majors (doc's own
// rule); `muted` is the "numbers that could change when the pull returns"
// treatment for a Pulling state that still has a local career to show.
const GAME = {
  healthy: { tag: 'vs', code: 'IRM', game: 'Game 7 of 12', park: null, muted: false },
  fork: { tag: 'at', code: 'BHC', game: 'World Series', park: 'Meridian Park', muted: false },
  'pulling-stale': { tag: 'vs', code: 'GRV', game: 'Championship', park: null, muted: true },
};

function nextGameCard(state) {
  const noCareer = state === 'pulling' || state === 'offline';
  const g = GAME[state];

  let action;
  if (state === 'pulling') {
    action = `<div class="bb-nextgame__syncrow">${ICON_SYNC}<span>Syncing</span></div>`;
  } else if (state === 'offline') {
    action = `<button class="gh-btn gh-btn--primary gh-btn--block">Start a career</button>`;
  } else {
    action = `<button class="gh-btn gh-btn--primary gh-btn--block">Play</button>`;
  }

  if (noCareer) {
    // No real game to show yet - a single hidden placeholder holds the
    // opponent/game-label space so the action doesn't jump when a career
    // starts, but there is nothing here to split into three shares.
    return `<div class="bb-nextgame">
      <div class="bb-nextgame__placeholder">
        <div class="bb-nextgame__opp">${marker('cpu')}<span>vs XXX</span></div>
        <div class="bb-nextgame__game">Game 0 of 0</div>
      </div>
      ${action}
    </div>`;
  }

  const muted = g.muted ? ' is-muted' : '';
  return `<div class="bb-nextgame">
    <div class="bb-nextgame__top">
      <div class="bb-nextgame__opp${muted}">${marker('cpu')}<span>${g.tag} ${g.code}</span></div>
      ${g.park ? `<div class="bb-nextgame__park${muted}">${g.park}</div>` : ''}
    </div>
    <div class="bb-nextgame__game${muted}">${g.game}</div>
    ${action}
  </div>`;
}

function standingsBlock(state, short) {
  const empty = state === 'pulling' || state === 'offline';
  const rows = empty ? null : (state === 'fork' ? STANDINGS_BELOW4 : STANDINGS_TOP4);
  const maxRows = short ? 4 : 5;

  if (empty) {
    const blanks = Array.from({ length: maxRows }, () => `
      <div class="bb-srow">
        <span class="bb-srow__rank">&mdash;</span>
        <span class="bb-srow__code">&mdash;</span>
        <span class="bb-srow__wl">&mdash;</span>
      </div>`).join('');
    return `<div class="bb-standings"><div class="bb-standings__head">Standings</div><div class="bb-standings__rows">${blanks}</div></div>`;
  }

  function rowHtml(r) {
    return `<div class="bb-srow${r.me ? ' is-me' : ''}">
      <span class="bb-srow__rank">${r.rank}</span>
      <span class="bb-srow__code">${marker(r.me ? 'you' : 'cpu')}${r.code}</span>
      <span class="bb-srow__wl">${r.wl}</span>
    </div>`;
  }

  const visible = rows.slice(0, 4);
  let fifthHtml = '';
  if (!short) {
    const inTop4 = rows[4].rank === 5;
    if (inTop4) {
      fifthHtml = rowHtml(rows[4]);
    } else {
      const you = rows[4];
      fifthHtml = `<div class="bb-srow" style="height:36px;flex-direction:column;gap:0;align-items:stretch;padding:1px 0 0;">
        <div class="bb-srow__divider">&middot;&middot;&middot;</div>
        <div class="bb-srow bb-srow--compact is-me" style="border-top:0;">
          <span class="bb-srow__rank">${you.rank}</span>
          <span class="bb-srow__code">${marker('you')}${you.code}</span>
          <span class="bb-srow__wl">${you.wl}</span>
        </div>
      </div>`;
    }
  }

  return `<div class="bb-standings">
    <div class="bb-standings__head">Standings</div>
    <div class="bb-standings__rows">
      ${visible.map(rowHtml).join('')}
      ${fifthHtml}
    </div>
  </div>`;
}

function seasonStrip(state) {
  const empty = state === 'pulling' || state === 'offline';
  const results = empty ? Array(12).fill('unplayed') : ['win', 'win', 'loss', 'win', 'win', 'loss', 'current', 'unplayed', 'unplayed', 'unplayed', 'unplayed', 'unplayed'];
  const marks = results.map((r) => {
    if (r === 'current') return `<span class="bb-mark bb-mark--unplayed bb-mark--current"></span>`;
    return `<span class="bb-mark bb-mark--${r}"></span>`;
  }).join('');
  const points = empty ? '&mdash;' : '4';
  return `<div class="bb-strip">
    <div class="bb-strip__marks">${marks}</div>
    <div class="bb-strip__side">
      <span class="gh-chip">Points ${points}</span>
      <button class="gh-btn gh-btn--ghost gh-btn--icon" aria-label="Skills" title="Skills">&#9733;</button>
    </div>
  </div>`;
}

function footerRow() {
  return `<div class="bb-footer">
    <button class="gh-btn gh-btn--ghost">Quick Play</button>
    <button class="gh-btn gh-btn--ghost">How to play</button>
    <button class="gh-btn gh-btn--ghost bb-footer__retire">Retire</button>
  </div>`;
}

export function renderCareerHome(root, { state, height }) {
  const short = height === 'short';
  root.classList.add('gh-dark');
  root.innerHTML = `<div class="bb-home">
    ${statusRow(state)}
    ${nextGameCard(state)}
    ${standingsBlock(state, short)}
    ${seasonStrip(state)}
    ${footerRow()}
  </div>`;

  const forkRow = root.querySelector('[data-fork-row]');
  if (forkRow) {
    forkRow.addEventListener('click', () => {
      forkRow.outerHTML = statusRow('healthy');
    }, { once: true });
  }
}
