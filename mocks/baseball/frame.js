import { drawField } from './field.js';
import { drawRingState } from './ring.js';

function svgCircle(color) {
  return `<span class="bb-marker bb-marker--circle"><svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="6"/></svg></span>`;
}
function svgTriangle(color) {
  return `<span class="bb-marker bb-marker--triangle"><svg width="12" height="12" viewBox="0 0 12 12"><polygon points="6,0 12,12 0,12"/></svg></span>`;
}

function hud(state) {
  const pitching = state === 'pitching';
  return `
  <div class="bb-hud">
    <div class="bb-hud__slot bb-hud__score">
      ${svgCircle()}<span class="bb-team-code">YOU</span><span class="bb-team-runs">2</span>
      <span class="bb-vs-sep">-</span>
      <span class="bb-team-runs">1</span><span class="bb-team-code">CPU</span>${svgTriangle()}
    </div>
    <div class="bb-hud__slot bb-hud__inning">
      <span class="bb-inn-arrow">${pitching ? '&#9660;' : '&#9650;'}</span><span class="bb-inn-num">2</span>
    </div>
    <div class="bb-hud__slot bb-hud__count">
      <span class="bb-count-grp"><span class="bb-count-letter">B</span>
        <span class="bb-dot is-on"></span><span class="bb-dot is-on"></span><span class="bb-dot"></span></span>
      <span class="bb-count-grp"><span class="bb-count-letter">S</span>
        <span class="bb-dot is-on"></span><span class="bb-dot"></span></span>
      <span class="bb-count-grp"><span class="bb-count-letter">O</span>
        <span class="bb-dot is-out"></span><span class="bb-dot"></span><span class="bb-dot"></span></span>
    </div>
    <div class="bb-hud__slot bb-hud__bases">${basesSVG()}</div>
    <div class="bb-hud__slot bb-hud__batter">${pitching ? '#24 CF' : '#7 SS'}</div>
  </div>`;
}

function basesSVG() {
  // small diamond: 2B top, 3B left, 1B right, home bottom. First base filled.
  return `<svg class="bb-diamond-mini" viewBox="0 0 20 20">
    <rect x="7" y="0" width="6" height="6" transform="rotate(45 10 3)" fill="none" stroke="#fff" stroke-width="1.2"/>
    <rect x="0" y="7" width="6" height="6" transform="rotate(45 3 10)" fill="none" stroke="#fff" stroke-width="1.2"/>
    <rect x="14" y="7" width="6" height="6" transform="rotate(45 17 10)" fill="#178A7A" stroke="#12181f" stroke-width="1.2"/>
    <rect x="7" y="14" width="6" height="6" transform="rotate(45 10 17)" fill="none" stroke="#fff" stroke-width="1.2"/>
  </svg>`;
}

function lines(state) {
  const pitching = state === 'pitching';
  return `
  <div class="bb-lines">
    <div class="bb-line1">${pitching ? 'Nice' : 'Late &#8594; Single'}</div>
    <div class="bb-line2">${pitching ? '' : 'Fastball 87 mph'}</div>
  </div>`;
}

function stripBatting() {
  // last 8 pitches of this at-bat, 4 per row (2 rows of 44)
  const pitches = [
    { code: 'FB', mph: 86, mark: 'ball' },
    { code: 'CB', mph: 71, mark: 'strike' },
    { code: 'FB', mph: 88, mark: 'ball' },
    { code: '', mph: '', empty: true },
    { code: '', mph: '', empty: true },
    { code: '', mph: '', empty: true },
    { code: '', mph: '', empty: true },
    { code: '', mph: '', empty: true },
  ];
  return pitches.map(p => p.empty
    ? `<div class="bb-tile bb-tile--empty"></div>`
    : `<div class="bb-tile"><span class="bb-tile__mark is-${p.mark}">${p.mark === 'ball' ? 'B' : 'K'}</span>
        <span class="bb-tile__code">${p.code}</span><span class="bb-tile__sub">${p.mph} mph</span></div>`
  ).join('');
}

function stripPitching() {
  // one tile per unlocked pitch; locked pitches are empty wells with a lock glyph
  const pitches = [
    { code: 'FB', name: 'Fastball', sel: true },
    { code: 'CH', name: 'Changeup' },
    { code: 'CB', name: 'Curveball' },
    { code: 'SL', name: 'Slider' },
    { code: 'KN', name: 'Knuckle', locked: true },
    { code: 'SC', name: 'Screwball', locked: true },
    { code: 'EP', name: 'Eephus', locked: true },
    { code: 'CT', name: 'Cutter', locked: true },
  ];
  return pitches.map(p => p.locked
    ? `<div class="bb-tile bb-tile--locked"><span class="bb-lock">&#128274;</span></div>`
    : `<div class="bb-tile${p.sel ? ' bb-tile--sel' : ''}"><span class="bb-tile__code">${p.code}</span><span class="bb-tile__sub">${p.name}</span></div>`
  ).join('');
}

function actions(state) {
  if (state === 'pitching') {
    return `
    <div class="bb-actionslot"></div>
    <div class="bb-actionslot"></div>
    <div class="bb-actionslot is-live">Pickoff</div>`;
  }
  return `
    <div class="bb-actionslot is-live">Bunt</div>
    <div class="bb-actionslot is-live">Steal</div>
    <div class="bb-actionslot"></div>`;
}

export function renderFrame(root, opts) {
  const state = opts.state; // 'batting' | 'pitching'
  root.classList.add('bb-root');
  root.innerHTML = `
    ${hud(state)}
    <div class="bb-field">
      <canvas></canvas>
      ${lines(state)}
    </div>
    <div class="bb-stripwrap">
      <div class="bb-strip">${state === 'pitching' ? stripPitching() : stripBatting()}</div>
    </div>
    <div class="bb-ctrl">
      <div class="bb-pad">
        <div class="bb-pad__zone"></div>
        ${state === 'pitching' ? '<div class="bb-pad__cross"></div><div class="bb-pad__break"></div>' : '<div class="bb-pad__sweet"></div>'}
      </div>
      <div class="bb-actions">${actions(state)}</div>
      <div class="bb-ringwrap">
        <canvas></canvas>
        <div class="bb-ring-label">${state === 'pitching' ? 'THROW' : 'SWING'}</div>
      </div>
    </div>
  `;

  const fieldCv = root.querySelector('.bb-field canvas');
  drawField(fieldCv, { state, runnerFirst: true, pitchT: 0.5 });

  const ringCv = root.querySelector('.bb-ringwrap canvas');
  if (state === 'pitching') {
    drawRingState(ringCv, 'throw', 'idle', 0);
  } else {
    drawRingState(ringCv, 'swing', 'idle', 0);
  }
}
