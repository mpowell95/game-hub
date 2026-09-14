import { trophyCup } from './icons.js';

function marker(kind) {
  if (kind === 'you') return `<span class="bb-marker bb-marker--circle"><svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="6"/></svg></span>`;
  return `<span class="bb-marker bb-marker--triangle"><svg viewBox="0 0 12 12"><polygon points="6,0 12,12 0,12"/></svg></span>`;
}

function lineScoreBox() {
  return `<div class="bb-end__box">
    <div></div><div class="bb-head">1</div><div class="bb-head">2</div><div class="bb-head">3</div><div class="bb-head">R</div><div class="bb-head">H</div>
    <div>${marker('you')} You</div><div>1</div><div>2</div><div>0</div><div class="bb-total">3</div><div class="bb-total">6</div>
    <div>${marker('cpu')} CPU</div><div>0</div><div>1</div><div>0</div><div class="bb-total">1</div><div class="bb-total">4</div>
  </div>`;
}

function closeButton() {
  return `<button class="bb-end__close" aria-label="Close"><span class="bb-end__close__dot">&times;</span></button>`;
}

export function renderVariant(host, kind) {
  const root = document.createElement('div');
  root.className = 'gh-overlay';
  root.style.position = 'absolute';
  root.style.inset = '0';
  root.style.background = 'rgba(9,16,28,0.7)';
  host.appendChild(root);

  let body = '';
  if (kind === 'win' || kind === 'loss') {
    const headline = kind === 'win' ? 'Win' : 'Loss';
    const points = kind === 'win' ? '+3 points' : '+0';
    body = `
      ${closeButton()}
      <div class="bb-end__head">${marker('you')}<h2 class="bb-end__title">${headline}</h2></div>
      ${lineScoreBox()}
      <div class="bb-end__points">${points}</div>
      <div class="bb-end__actions"><button class="gh-btn gh-btn--primary gh-btn--block">Continue</button></div>
    `;
  } else if (kind === 'quick') {
    body = `
      ${closeButton()}
      <div class="bb-end__head">${marker('you')}<h2 class="bb-end__title">Win</h2></div>
      ${lineScoreBox()}
      <div class="bb-end__actions">
        <button class="gh-btn gh-btn--primary">Play again</button>
        <button class="gh-btn gh-btn--ghost">Done</button>
      </div>
    `;
  } else if (kind === 'ceremony') {
    body = `
      ${closeButton()}
      <div class="bb-end__head">${marker('you')}<h2 class="bb-end__title">Win</h2></div>
      ${lineScoreBox()}
      <div class="bb-end__points">+8 points</div>
      <div class="bb-end__ceremony">
        ${trophyCup(3)}
        <div class="bb-end__league">Gold</div>
        <div class="bb-end__advance">Next: Minor League</div>
      </div>
      <div class="bb-end__actions"><button class="gh-btn gh-btn--primary gh-btn--block">Continue</button></div>
    `;
  }

  const modal = document.createElement('div');
  modal.className = 'gh-modal bb-end';
  modal.innerHTML = body;
  root.appendChild(modal);
}
