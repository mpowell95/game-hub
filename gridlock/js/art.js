// gridlock/js/art.js - the drawings of the blocks and cars (2026-10-14, Matt: "Make the blocks and
// the cars look cooler. They're bland"). Pure: returns SVG markup, decides nothing about the game.
//
// Every piece is drawn LYING HORIZONTALLY in a (len*100) x 100 box, front to the right, lit from
// the top. An upright piece is the same drawing turned a quarter (front up, light from the left), so
// one drawing serves both. The SVG fills its block exactly (the box has the block's own aspect), so
// nothing is stretched.
//
// `seed` picks the variety (wood tone and grain, car model and stripes) so a level always looks the
// same, and `uid` keeps each piece's gradient ids apart (ids are page-global).
//
// The red piece is told apart by SHAPE as well as colour (Matt is red/green colourblind): a white
// badge with an arrow on the wooden block, a white star badge on the red car.

export const RED = '#d8392b';
export const WOOD_TONES = ['#e2bd84', '#d3a265', '#ecd3a1', '#c38c52', '#dcae72', '#b98048', '#e7c792', '#cc9a5e'];
export const CAR_COLORS = ['#1F5FA8', '#F2B705', '#178A7A', '#7a52b3', '#eceef1', '#3f9be0', '#8fbf3a', '#f08a24', '#5d6b80', '#c94fa0', '#2aa7a0', '#a8743c', '#4d5bd1', '#2b2f36'];

/** Mix a #rrggbb colour toward white (amt > 0) or black (amt < 0). */
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt)));
  return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** A tiny deterministic random stream from a seed. */
function rand(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function star(cx, cy, r) {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
    d += (i ? 'L' : 'M') + (cx + rr * Math.cos(a)).toFixed(1) + ' ' + (cy + rr * Math.sin(a)).toFixed(1);
  }
  return d + 'Z';
}

// --- wood ------------------------------------------------------------------------------------------

function woodSVG(L, color, isRed, R, u) {
  const c = color;
  const x0 = 5, y0 = 5, w = L - 10, h = 90, r = 17;
  const dark = shade(c, isRed ? -0.45 : -0.42);
  let g = `<defs>
    <linearGradient id="${u}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(c, 0.22)}"/><stop offset=".42" stop-color="${c}"/><stop offset="1" stop-color="${shade(c, -0.2)}"/></linearGradient>
    <clipPath id="${u}c"><rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="${r}"/></clipPath>
  </defs>`;
  g += `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="${r}" fill="url(#${u}b)"/>`;
  // Grain: long wavy lines along the block, a few fine ones between, sometimes a knot.
  let grain = '';
  const lines = 6 + Math.floor(R() * 3);
  for (let k = 0; k < lines; k++) {
    const y = 12 + (k + R() * 0.6) * (76 / lines);
    const a = 3 + R() * 5, b = (R() - 0.5) * 8;
    const op = (isRed ? 0.12 : 0.2) + R() * 0.18;
    const sw = 1.2 + R() * 2.2;
    grain += `<path d="M${x0 - 4} ${y.toFixed(1)}C${(L * 0.28).toFixed(0)} ${(y - a).toFixed(1)} ${(L * 0.55).toFixed(0)} ${(y + a + b).toFixed(1)} ${L + 4} ${(y + b * 0.5).toFixed(1)}" stroke="${dark}" stroke-opacity="${op.toFixed(2)}" stroke-width="${sw.toFixed(1)}" fill="none"/>`;
  }
  if (!isRed && R() < 0.55) {
    const kx = 30 + R() * (L - 60), ky = 30 + R() * 40;
    grain += `<ellipse cx="${kx.toFixed(0)}" cy="${ky.toFixed(0)}" rx="11" ry="4.5" fill="${dark}" fill-opacity=".22"/>`
      + `<ellipse cx="${kx.toFixed(0)}" cy="${ky.toFixed(0)}" rx="18" ry="8" stroke="${dark}" stroke-opacity=".2" stroke-width="1.6" fill="none"/>`
      + `<ellipse cx="${kx.toFixed(0)}" cy="${ky.toFixed(0)}" rx="25" ry="11" stroke="${dark}" stroke-opacity=".12" stroke-width="1.4" fill="none"/>`;
  }
  g += `<g clip-path="url(#${u}c)">${grain}`;
  // Bevel: a lit top edge, a shaded bottom edge, and a soft shine.
  g += `<rect x="${x0}" y="${y0}" width="${w}" height="12" fill="#fff" fill-opacity="${isRed ? 0.28 : 0.3}"/>`;
  g += `<rect x="${x0}" y="${y0 + h - 11}" width="${w}" height="11" fill="#000" fill-opacity=".16"/>`;
  g += `<rect x="${x0 + 10}" y="${y0 + 16}" width="${w * 0.55}" height="9" rx="4.5" fill="#fff" fill-opacity="${isRed ? 0.32 : 0.16}"/>`;
  g += `</g>`;
  g += `<rect x="${x0 + 1}" y="${y0 + 1}" width="${w - 2}" height="${h - 2}" rx="${r - 1}" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="2"/>`;
  g += `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="${r}" fill="none" stroke="${shade(c, -0.5)}" stroke-opacity=".7" stroke-width="2.2"/>`;
  if (isRed) {
    const cx = L / 2, cy = 50;
    g += `<circle cx="${cx}" cy="${cy + 2.5}" r="27" fill="#000" fill-opacity=".25"/>`
      + `<circle cx="${cx}" cy="${cy}" r="27" fill="#fff"/>`
      + `<circle cx="${cx}" cy="${cy}" r="22" fill="none" stroke="${RED}" stroke-opacity=".25" stroke-width="2"/>`
      + `<path d="M${cx - 13} ${cy}h22M${cx + 1} ${cy - 12}l12 12-12 12" stroke="${RED}" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  return g;
}

// --- cars ------------------------------------------------------------------------------------------

function glassDefs(u) {
  return `<linearGradient id="${u}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5d7d99"/><stop offset=".55" stop-color="#22313f"/><stop offset="1" stop-color="#16202b"/></linearGradient>`;
}
function bodyGrad(u, c) {
  return `<linearGradient id="${u}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(c, -0.32)}"/><stop offset=".16" stop-color="${shade(c, 0.1)}"/><stop offset=".5" stop-color="${shade(c, 0.26)}"/><stop offset=".84" stop-color="${shade(c, 0.04)}"/><stop offset="1" stop-color="${shade(c, -0.36)}"/></linearGradient>`;
}
const tire = (x, y, w = 22, h = 13) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="#111419"/>`;

/** A car, two cells long. Models: sedan, sports (stripes), hatch, taxi. */
function carBody(L, c, model, isRed, u) {
  let g = `<defs>${bodyGrad(u, c)}${glassDefs(u)}</defs>`;
  g += tire(28, 4) + tire(28, 83) + tire(L - 54, 4) + tire(L - 54, 83);
  g += `<rect x="6" y="11" width="${L - 12}" height="78" rx="30" fill="url(#${u}b)" stroke="${shade(c, -0.45)}" stroke-width="2"/>`;
  // Racing stripes (the red car always, the sports model too), under the glass.
  if (isRed || model === 'sports') {
    const sc = c === '#eceef1' ? '#1F5FA8' : '#fff';
    g += `<rect x="8" y="38" width="${L - 16}" height="7" fill="${sc}" fill-opacity=".9"/><rect x="8" y="55" width="${L - 16}" height="7" fill="${sc}" fill-opacity=".9"/>`;
  }
  // Hood creases, front bumper.
  g += `<path d="M${L - 34} 26Q${L - 16} 50 ${L - 34} 74" stroke="${shade(c, -0.3)}" stroke-opacity=".5" stroke-width="2" fill="none"/>`;
  // Windscreen, roof, rear window.
  const front = model === 'hatch' ? L - 66 : L - 74;
  g += `<path d="M${front} 21L${front + 20} 26Q${front + 26} 50 ${front + 20} 74L${front} 79Z" fill="url(#${u}g)"/>`;
  g += `<path d="M${front + 4} 27L${front + 12} 29" stroke="#fff" stroke-opacity=".55" stroke-width="3" stroke-linecap="round"/>`;
  const back = model === 'hatch' ? 18 : 26;
  g += `<rect x="${back + 16}" y="24" width="${front - back - 18}" height="52" rx="10" fill="${shade(c, 0.12)}" stroke="${shade(c, -0.25)}" stroke-opacity=".6" stroke-width="1.5"/>`;
  g += `<path d="M${back} 26L${back + 14} 23L${back + 14} 77L${back} 74Z" fill="url(#${u}g)" fill-opacity=".9"/>`;
  // Mirrors, lights.
  g += `<ellipse cx="${front + 6}" cy="9" rx="7" ry="4" fill="${shade(c, -0.25)}"/><ellipse cx="${front + 6}" cy="91" rx="7" ry="4" fill="${shade(c, -0.25)}"/>`;
  g += `<rect x="${L - 15}" y="17" width="8" height="15" rx="3.5" fill="#fff6c2"/><rect x="${L - 15}" y="68" width="8" height="15" rx="3.5" fill="#fff6c2"/>`;
  g += `<rect x="7" y="18" width="6" height="14" rx="2.5" fill="#ff3b30"/><rect x="7" y="68" width="6" height="14" rx="2.5" fill="#ff3b30"/>`;
  if (model === 'taxi') {
    g += `<rect x="${(back + front) / 2 - 6}" y="38" width="22" height="24" rx="4" fill="#fff8d6" stroke="#2b2f36" stroke-width="2"/>`
      + `<rect x="${(back + front) / 2 - 2}" y="44" width="14" height="4" fill="#2b2f36"/><rect x="${(back + front) / 2 - 2}" y="52" width="14" height="4" fill="#2b2f36"/>`;
  } else if (model === 'sunroof') {
    g += `<rect x="${(back + front) / 2 - 6}" y="36" width="26" height="28" rx="6" fill="url(#${u}g)" fill-opacity=".85"/>`;
  }
  if (isRed) {
    const cx = (back + front) / 2 + 7;
    g += `<circle cx="${cx}" cy="52" r="21" fill="#000" fill-opacity=".25"/><circle cx="${cx}" cy="50" r="21" fill="#fff"/>`
      + `<path d="${star(cx, 51, 15)}" fill="${RED}"/>`;
  }
  return g;
}

/** A truck or bus, three cells long. Models: box truck, bus, tanker. */
function truckBody(L, c, model, u) {
  let g = `<defs>${bodyGrad(u, c)}${glassDefs(u)}<linearGradient id="${u}x" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9ced6"/><stop offset=".5" stop-color="#f2f4f7"/><stop offset="1" stop-color="#a9b0ba"/></linearGradient></defs>`;
  if (model === 'bus') {
    g += tire(36, 3) + tire(36, 84) + tire(L - 66, 3) + tire(L - 66, 84);
    g += `<rect x="6" y="9" width="${L - 12}" height="82" rx="18" fill="url(#${u}b)" stroke="${shade(c, -0.45)}" stroke-width="2"/>`;
    // Side windows along both edges, then the roof hatches and the windscreen.
    for (let x = 22; x < L - 60; x += 34) {
      g += `<rect x="${x}" y="12" width="28" height="11" rx="3" fill="url(#${u}g)"/><rect x="${x}" y="77" width="28" height="11" rx="3" fill="url(#${u}g)"/>`;
    }
    g += `<rect x="${L / 2 - 50}" y="36" width="34" height="28" rx="5" fill="${shade(c, -0.15)}" stroke="${shade(c, -0.35)}" stroke-width="1.5"/>`;
    g += `<rect x="${L / 2 + 16}" y="36" width="34" height="28" rx="5" fill="${shade(c, -0.15)}" stroke="${shade(c, -0.35)}" stroke-width="1.5"/>`;
    g += `<path d="M${L - 30} 16Q${L - 12} 50 ${L - 30} 84L${L - 40} 84L${L - 40} 16Z" fill="url(#${u}g)"/>`;
  } else {
    // Cab at the front, load behind it.
    g += tire(28, 3) + tire(28, 84) + tire(96, 3) + tire(96, 84) + tire(L - 60, 3) + tire(L - 60, 84);
    const cab = L - 92;
    if (model === 'tanker') {
      g += `<rect x="8" y="12" width="${cab - 14}" height="76" rx="36" fill="url(#${u}x)" stroke="#7c8490" stroke-width="2"/>`;
      for (let x = 40; x < cab - 20; x += 46) g += `<rect x="${x}" y="12" width="5" height="76" fill="#8f97a3" fill-opacity=".7"/>`;
      // A band in the cab's colour, so the tank and the cab read as ONE truck.
      g += `<rect x="16" y="43" width="${cab - 30}" height="14" rx="3" fill="${c}"/>`;
      g += `<circle cx="${cab / 2}" cy="50" r="10" fill="#9aa2ad" stroke="#6f7782" stroke-width="2"/>`;
    } else {
      g += `<rect x="6" y="8" width="${cab - 10}" height="84" rx="8" fill="url(#${u}x)" stroke="#7c8490" stroke-width="2"/>`;
      for (let x = 26; x < cab - 12; x += 22) g += `<path d="M${x} 10V90" stroke="#9aa2ad" stroke-width="2"/>`;
      g += `<rect x="18" y="38" width="${cab - 34}" height="24" rx="4" fill="${c}" fill-opacity=".9"/>`;
    }
    g += `<rect x="${cab - 4}" y="40" width="14" height="20" rx="3" fill="#2b2f36"/>`;
    g += `<rect x="${cab + 6}" y="11" width="${L - cab - 12}" height="78" rx="20" fill="url(#${u}b)" stroke="${shade(c, -0.45)}" stroke-width="2"/>`;
    g += `<rect x="${cab + 14}" y="22" width="34" height="56" rx="8" fill="${shade(c, 0.12)}" stroke="${shade(c, -0.25)}" stroke-opacity=".6" stroke-width="1.5"/>`;
    g += `<path d="M${L - 40} 20L${L - 24} 25Q${L - 16} 50 ${L - 24} 75L${L - 40} 80Z" fill="url(#${u}g)"/>`;
    g += `<path d="M${L - 36} 26L${L - 29} 28" stroke="#fff" stroke-opacity=".55" stroke-width="3" stroke-linecap="round"/>`;
    g += `<ellipse cx="${L - 34}" cy="8" rx="7" ry="4" fill="${shade(c, -0.25)}"/><ellipse cx="${L - 34}" cy="92" rx="7" ry="4" fill="${shade(c, -0.25)}"/>`;
  }
  g += `<rect x="${L - 14}" y="16" width="7" height="15" rx="3" fill="#fff6c2"/><rect x="${L - 14}" y="69" width="7" height="15" rx="3" fill="#fff6c2"/>`;
  g += `<rect x="7" y="16" width="5" height="14" rx="2" fill="#ff3b30"/><rect x="7" y="70" width="5" height="14" rx="2" fill="#ff3b30"/>`;
  return g;
}

/** One piece's SVG. `p` = { len, h } from the engine; `color` from the palette for its look. */
export function pieceArt(p, look, color, isRed, seed, uid) {
  const R = rand(seed + 1);
  const L = p.len * 100;
  let inner;
  if (look === 'cars') {
    if (p.len === 3) inner = truckBody(L, color, ['box', 'bus', 'tanker'][Math.floor(R() * 3)], uid);
    else {
      const models = ['sedan', 'sports', 'hatch', 'sunroof'];
      if (color === '#F2B705') models.push('taxi', 'taxi');
      inner = carBody(L, color, isRed ? 'sports' : models[Math.floor(R() * models.length)], isRed, uid);
    }
  } else {
    inner = woodSVG(L, color, isRed, R, uid);
  }
  if (p.h) return `<svg class="gl-art" viewBox="0 0 ${L} 100" aria-hidden="true">${inner}</svg>`;
  // Upright: the same drawing turned a quarter, front up and light from the left.
  return `<svg class="gl-art" viewBox="0 0 100 ${L}" aria-hidden="true"><g transform="translate(0 ${L}) rotate(-90)">${inner}</g></svg>`;
}
