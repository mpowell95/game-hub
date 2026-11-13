// docs/mockups/battle-arena-tile/build.mjs - the Battle Arena launcher tile mockup (2026-11-13, Matt: "Mockup new
// thumbnails for the gamehub's main screen. the current one is old and really bad"). Builds index.html from the
// game's OWN art (battle-arena/js/art.js: the monsters and gems drawn in the battle) and the launcher's real
// neighbouring tiles (js/game-art.js). Every option is a 160x90 SVG, the size js/game-art.js tiles are.
//   node docs/mockups/battle-arena-tile/build.mjs
import fs from 'node:fs';
import { monsterSVG, gemSVG } from '../../../battle-arena/js/art.js';
import { GAME_ART } from '../../../js/game-art.js';

const inner = (svg) => svg.replace(/^\s*<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
/** A monster at (x, y), `s` px square; `flip` faces it left (art faces right). */
const mon = (id, evo, x, y, s, flip = false, extra = '') =>
  `<g transform="translate(${flip ? x + s : x} ${y}) scale(${flip ? -1 : 1} 1)"${extra}><svg width="${s}" height="${s}" viewBox="0 0 120 120" overflow="visible">${inner(monsterSVG(id, evo))}</svg></g>`;
const gem = (kind, x, y, s, n) => `<svg x="${x}" y="${y}" width="${s}" height="${s}" viewBox="0 0 40 40">${inner(gemSVG(kind, n))}</svg>`;

// The Boiler Room, in tile size: brick wall, pipes, the furnace window, the hazard stripe and the floor.
function room({ furnace = true, floorY = 64, glow = true } = {}) {
  const bricks = [];
  for (let r = 0; r < 6; r++) for (let c = -1; c < 9; c++) bricks.push(`<rect x="${c * 20 + (r % 2 ? 10 : 0)}" y="${r * 11}" width="18" height="9.5" rx="1.5"/>`);
  const stripe = [];
  for (let x = -8; x < 168; x += 10) stripe.push(`<path d="M${x} ${floorY} h5 l-4 5 h-5z" fill="#1d150f"/>`);
  return `<rect width="160" height="90" fill="#4a2214"/>
    <g fill="#5e2c19" opacity=".7">${bricks.join('')}</g>
    ${glow ? `<radialGradient id="baTileGlow" cx="50%" cy="40%" r="55%"><stop offset="0" stop-color="#ff9a3a" stop-opacity=".55"/><stop offset="1" stop-color="#ff7a2a" stop-opacity="0"/></radialGradient><rect width="160" height="${floorY}" fill="url(#baTileGlow)"/>` : ''}
    ${furnace ? `<rect x="68" y="20" width="24" height="30" rx="3" fill="#2a120a"/><rect x="70.5" y="22.5" width="19" height="25" rx="2" fill="#ff9a3a"/><rect x="70.5" y="22.5" width="19" height="12" rx="2" fill="#ffd36a" opacity=".6"/><path d="M70.5 31h19M80 22.5v25" stroke="#2a120a" stroke-width="1.6"/>` : ''}
    <g fill="#5c3424" stroke="#26110a" stroke-width="1.4"><rect x="-4" y="12" width="168" height="5" rx="2.5"/><rect x="8" y="-4" width="6" height="${floorY + 4}" rx="3"/><rect x="146" y="-4" width="6" height="${floorY + 4}" rx="3"/></g>
    <rect y="${floorY}" width="160" height="5" fill="#f2b705"/>${stripe.join('')}
    <rect y="${floorY + 5}" width="160" height="${90 - floorY - 5}" fill="#2a1d16"/>
    <path d="M0 ${floorY + 12}h160M0 ${floorY + 19}h160" stroke="#3a2a20" stroke-width="1.2"/>`;
}
const tank = (cx, cy, rx) => `<ellipse cx="${cx}" cy="${cy + 3}" rx="${rx}" ry="${rx * 0.26}" fill="#000" opacity=".35"/><path d="M${cx - rx} ${cy} v5 a${rx} ${rx * 0.26} 0 0 0 ${2 * rx} 0 v-5z" fill="#8a2f18"/><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${rx * 0.26}" fill="#c4502c" stroke="#5a1c0c" stroke-width="1.2"/>`;
const burst = (cx, cy, r, fill = '#fff3b0', n = 10) => {
  const pts = [];
  for (let i = 0; i < n * 2; i++) { const a = (Math.PI * i) / n - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`); }
  return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`;
};

const OPTIONS = {
  // A: the face-off, as a match opens: Emberkit and Driplet on their tanks, a clash spark between.
  A: `<svg viewBox="0 0 160 90" aria-hidden="true">${room({ furnace: false })}
      ${tank(42, 62, 26)}${tank(118, 62, 26)}
      ${mon('emberkit', false, 12, 6, 60)}${mon('driplet', false, 88, 6, 60, true)}
      ${burst(80, 36, 13, '#ffd36a', 9)}${burst(80, 36, 7, '#fff8dc', 9)}
      ${['fire', 'water', 'spark', 'leaf', 'shadow'].map((k, i) => gem(k, 41 + i * 16, 73, 14)).join('')}
    </svg>`,
  // A2 (2026-11-13, Matt: "2 versions of A and 2 versions of C"): A readable at tile size. The monsters moved in from
  // the corners (the "New" tag top left, the heart top right), a bigger clash spark, bigger gems.
  A2: `<svg viewBox="0 0 160 90" aria-hidden="true">${room({ furnace: false, floorY: 62 })}
      ${tank(47, 59, 22)}${tank(113, 59, 22)}
      ${mon('emberkit', false, 20, 12, 50)}${mon('driplet', false, 90, 12, 50, true)}
      ${burst(80, 38, 12, '#ffd36a', 9)}${burst(80, 38, 6, '#fff8dc', 9)}
      ${['fire', 'water', 'spark', 'leaf', 'shadow'].map((k, i) => gem(k, 33 + i * 19.5, 70, 18)).join('')}
    </svg>`,
  // B: the special attack: Blazelynx (Emberkit evolved) leaps, a fire blast hits Driplet.
  B: `<svg viewBox="0 0 160 90" aria-hidden="true">${room({ furnace: false })}
      ${tank(126, 64, 22)}
      ${mon('driplet', false, 104, 12, 50, true)}
      <path d="M50 44 C 74 30, 92 32, 108 38 L 107 46 C 92 42, 76 44, 54 54 Z" fill="#ff7a2a" opacity=".92"/>
      <path d="M58 46 C 78 37, 92 38, 106 41 L 105 44 C 92 42, 80 44, 60 51 Z" fill="#ffd36a"/>
      ${burst(106, 41, 12, '#ffd36a', 10)}${burst(106, 41, 6, '#ffffff', 10)}
      ${mon('emberkit', true, 2, 6, 64)}
      <g fill="#7fc4ff"><circle cx="150" cy="22" r="2.2"/><circle cx="153" cy="36" r="1.6"/><circle cx="148" cy="50" r="1.8"/></g>
    </svg>`,
  // C: how it plays: three fire gems lined up glow, their energy flies up to Emberkit, its bar full.
  C: `<svg viewBox="0 0 160 90" aria-hidden="true">${room({ furnace: false, floorY: 44, glow: true })}
      ${tank(38, 42, 20)}${tank(122, 42, 20)}
      ${mon('emberkit', false, 14, -2, 48)}${mon('driplet', false, 98, -2, 48, true)}
      <rect x="8" y="51" width="144" height="38" rx="5" fill="#1a120d" opacity=".92"/>
      ${[['water', 'spark', 'fire', 'fire', 'fire', 'leaf', 'shadow'], ['leaf', 'shadow', 'water', 'spark', 'leaf', 'water', 'spark']].map((row, r) => row.map((k, c) => gem(k, 12 + c * 20, 53 + r * 18, 17)).join('')).join('')}
      <rect x="51" y="52.5" width="58" height="19" rx="5" fill="none" stroke="#fff3b0" stroke-width="2"/>
      <path d="M80 52 C 76 40, 62 34, 48 30" fill="none" stroke="#ffb35a" stroke-width="2" stroke-dasharray="1 4" stroke-linecap="round"/>
      <g fill="#ff9a3a" stroke="#fff3b0" stroke-width="1"><circle cx="72" cy="42" r="3.2"/><circle cx="60" cy="35" r="3.6"/></g>
    </svg>`,
  // C2 (2026-11-13, Matt leaning to C): readable at tile size. 5 gems a row instead of 7 (bigger), the monsters
  // moved in from the corners (the "New" tag top left, the heart top right), bigger energy dots.
  C2: `<svg viewBox="0 0 160 90" aria-hidden="true">${room({ furnace: false, floorY: 46, glow: true })}
      ${tank(52, 44, 18)}${tank(110, 44, 18)}
      ${mon('emberkit', false, 30, 6, 42)}${mon('driplet', false, 89, 6, 42, true)}
      ${burst(81, 26, 7, '#ffd36a', 8)}
      <rect x="18" y="52" width="124" height="38" rx="5" fill="#1a120d" opacity=".92"/>
      ${[['water', 'fire', 'fire', 'fire', 'leaf'], ['shadow', 'spark', 'water', 'leaf', 'spark']].map((row, r) => row.map((k, c) => gem(k, 21 + c * 24.4, 53.5 + r * 17.5, 18)).join('')).join('')}
      <rect x="43" y="53" width="73" height="19.5" rx="5" fill="none" stroke="#fff3b0" stroke-width="2.2"/>
      <g fill="#ff9a3a" stroke="#fff3b0" stroke-width="1.2"><circle cx="79" cy="46" r="4.2"/><circle cx="75" cy="36.5" r="4.6"/></g>
    </svg>`,
  // D: the hero: Blazelynx in a burst of fire, the five gems around it.
  D: `<svg viewBox="0 0 160 90" aria-hidden="true">${room({ furnace: false, floorY: 70 })}
      <g opacity=".85">${burst(80, 40, 46, '#c4421c', 14)}${burst(80, 40, 34, '#ff8a2a', 14)}${burst(80, 40, 20, '#ffd36a', 14)}</g>
      ${tank(80, 70, 30)}
      ${mon('emberkit', true, 44, 0, 74)}
      ${gem('water', 14, 20, 18)}${gem('leaf', 22, 46, 18)}${gem('spark', 128, 20, 18)}${gem('shadow', 120, 46, 18)}${gem('fire', 6, 70, 0)}
    </svg>`,
};
OPTIONS.NOW = GAME_ART['battle-arena'];

const ORDER = ['A', 'A2', 'C', 'C2'];
const LABEL = { A: 'A', A2: 'A2', C: 'C', C2: 'C2' };
const tile = (svg, name, tag) => `<div class="cell"><div class="art">${svg}${tag ? `<span class="pill${tag === 'New' ? ' new' : ''}">${tag}</span>` : ''}<span class="fav">♡</span></div><div class="name">${name}</div></div>`;
const row = (svg) => tile(GAME_ART['ball-run'], 'Ball Run') + tile(GAME_ART.baseball, 'Baseball', 'Test') + tile(svg, 'Battle Arena', 'New');
const sec = (k) => `<section><h2>${LABEL[k]}</h2>
  <div class="big">${OPTIONS[k]}</div>
  <div class="pair"><div class="hub dark"><div class="grid">${row(OPTIONS[k])}</div></div><div class="hub light"><div class="grid">${row(OPTIONS[k])}</div></div></div>
</section>`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Battle Arena tile</title>
<style>
  body { margin: 0; background: #0f1420; color: #f4f6fb; font: 17px/1.35 system-ui, -apple-system, sans-serif; }
  main { max-width: 860px; margin: 0 auto; padding: 16px; display: grid; gap: 28px; }
  section { display: grid; gap: 12px; }
  h2 { margin: 0; font-size: 28px; }
  .big { width: min(100%, 480px); aspect-ratio: 16/9; border-radius: 16px; overflow: hidden; border: 1px solid #2a3346; }
  .big svg, .art svg { width: 100%; height: 100%; display: block; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 640px) { .pair { grid-template-columns: 1fr; } }
  .hub { border-radius: 14px; padding: 14px 12px; }
  .hub.dark { background: #0b1220; } .hub.light { background: #eef2f8; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px 10px; }
  .cell { min-width: 0; }
  .art { position: relative; aspect-ratio: 16/9; border-radius: 10px; overflow: hidden; border: 1px solid #2a3346; }
  .light .art { border-color: #d5dce8; }
  .name { margin-top: 5px; font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dark .name { color: #f4f6fb; } .light .name { color: #1b2333; }
  .pill { position: absolute; top: 5px; left: 5px; font-size: 11px; font-weight: 700; background: #33405a; color: #fff; padding: 2px 6px; border-radius: 999px; }
  .pill.new { background: #E0532F; }
  .fav { position: absolute; top: 0; right: 4px; color: #fff; font-size: 18px; text-shadow: 0 1px 2px #000; }
</style></head><body><main>
${ORDER.map(sec).join('\n')}
</main></body></html>`;
fs.writeFileSync(new URL('./index.html', import.meta.url), html);
console.log('wrote index.html', html.length);
