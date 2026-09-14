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

function statusRow(state) {
  if (state === 'healthy') {
    return `<div class="bb-status bb-status--healthy"><span class="bb-status__text">College, Season 2</span></div>`;
  }
  if (state === 'pulling') {
    return `<div class="bb-status bb-status--pulling">
      <span class="bb-status__glyph spin">${ICON_SYNC}</span>
      <span class="bb-status__text">Syncing</span>
    </div>`;
  }
  if (state === 'offline') {
    return `<div class="bb-status bb-status--offline">
      <span class="bb-status__glyph">${ICON_CLOUD_SLASH}</span>
      <span class="bb-status__text">You are offline. Your career is saved on this phone. It syncs itself next time you open the hub online.</span>
    </div>`;
  }
  // fork - clickable, reverts to healthy text once tapped
  return `<div class="bb-status bb-status--fork" data-fork-row>
      <span class="bb-status__glyph">${ICON_BRANCH}</span>
      <span class="bb-status__text">Your career was continued on another device. This phone's version has been kept.</span>
    </div>`;
}

function nextGameCard(state) {
  const noCareer = state === 'pulling' || state === 'offline';
  const opp = state === 'fork' ? { tag: 'at', code: 'BHC', game: 'Semifinal' } : { tag: 'vs', code: 'IRM', game: 'Game 7 of 12' };
  const info = `<div class="bb-nextgame__info${noCareer ? ' is-empty' : ''}">
      <div class="bb-nextgame__opp">${marker('cpu')}<span>${opp.tag} ${opp.code}</span></div>
      <div class="bb-nextgame__game">${opp.game}</div>
    </div>`;
  let action;
  if (state === 'pulling') {
    action = `<div class="bb-nextgame__syncrow">${ICON_SYNC}<span>Syncing</span></div>`;
  } else if (state === 'offline') {
    action = `<button class="gh-btn gh-btn--primary gh-btn--block">Start a career</button>`;
  } else {
    action = `<button class="gh-btn gh-btn--primary gh-btn--block">Play</button>`;
  }
  return `<div class="bb-nextgame">${info}${action}</div>`;
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
    return `<div class="bb-standings"><div class="bb-standings__head">Standings</div>${blanks}</div>`;
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

  function rowHtml(r) {
    return `<div class="bb-srow${r.me ? ' is-me' : ''}">
      <span class="bb-srow__rank">${r.rank}</span>
      <span class="bb-srow__code">${marker(r.me ? 'you' : 'cpu')}${r.code}</span>
      <span class="bb-srow__wl">${r.wl}</span>
    </div>`;
  }

  return `<div class="bb-standings">
    <div class="bb-standings__head">Standings</div>
    ${visible.map(rowHtml).join('')}
    ${fifthHtml}
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
    <button class="gh-btn gh-btn--danger">Retire</button>
  </div>`;
}

export function renderCareerHome(root, { state, height }) {
  const short = height === 'short';
  const H = short ? 530 : 714;
  const nextGameH = Math.round(H * 0.28);
  root.classList.add('gh-dark');
  root.innerHTML = `<div class="bb-home">
    ${statusRow(state)}
    ${nextGameCard(state)}
    ${standingsBlock(state, short)}
    ${seasonStrip(state)}
    ${footerRow()}
  </div>`;

  root.querySelector('.bb-nextgame').style.height = `${nextGameH}px`;

  const forkRow = root.querySelector('[data-fork-row]');
  if (forkRow) {
    forkRow.addEventListener('click', () => {
      forkRow.outerHTML = statusRow('healthy');
    }, { once: true });
  }
}
