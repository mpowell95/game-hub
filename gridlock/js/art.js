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
// Bright cartoon colours, none dark (a dark car vanished into the asphalt).
export const CAR_COLORS = ['#2f7de1', '#ffc61a', '#19b39b', '#8c5ce0', '#f4f5f7', '#4cc3ff', '#7ed321', '#ff8a1f', '#ff6fb5', '#3dd6c6', '#5b6cff', '#c8a2ff'];
const TAXI = '#ffc61a';

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
// CARTOON (2026-10-28, Matt: the realistic cars were "difficult to understand at a glance ... tough to
// identify cars as single objects"). Each vehicle is ONE flat, bright shape with a thick dark outline
// (a sticker), a clear gap to its neighbours, big round headlights at the front and a few chunky
// details. No gradients on the body, no fine lines, nothing poking far outside the outline.

const INK = '#1d2230';
const GLASS = '#9fdcfb';
const glint = (x1, y1, x2, y2) => `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="#fff" stroke-opacity=".85" stroke-width="5" stroke-linecap="round"/>`;
const wheel = (x, y) => `<rect x="${x}" y="${y}" width="30" height="16" rx="6" fill="${INK}"/>`;
const lamps = (L) => `<circle cx="${L - 27}" cy="31" r="7.5" fill="#fff4a8" stroke="${INK}" stroke-width="4"/><circle cx="${L - 27}" cy="69" r="7.5" fill="#fff4a8" stroke="${INK}" stroke-width="4"/>`
  + `<rect x="15" y="30" width="8" height="12" rx="3" fill="#ff5a4e" stroke="${INK}" stroke-width="3"/><rect x="15" y="58" width="8" height="12" rx="3" fill="#ff5a4e" stroke="${INK}" stroke-width="3"/>`;
/** A soft light band along the top and a shade band along the bottom, clipped to the body. */
function bodyLight(u, c) {
  return `<g clip-path="url(#${u}c)"><rect x="0" y="0" width="1000" height="30" fill="#fff" fill-opacity=".22"/><rect x="0" y="70" width="1000" height="30" fill="#000" fill-opacity=".13"/></g>`;
}

/** A car, two cells long. Models: sedan, sports (stripes), hatch, sunroof, taxi. */
function carBody(L, c, model, isRed, u) {
  const bx = 10, by = 15, bw = L - 20, bh = 70, br = 30;
  let g = `<defs><clipPath id="${u}c"><rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${br}"/></clipPath></defs>`;
  g += wheel(34, 7) + wheel(34, 77) + wheel(L - 66, 7) + wheel(L - 66, 77);
  g += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${br}" fill="${c}"/>`;
  g += bodyLight(u, c);
  if (isRed || model === 'sports') {
    const sc = c === '#f4f5f7' ? '#2f7de1' : '#fff';
    g += `<g clip-path="url(#${u}c)"><rect x="0" y="39" width="${L}" height="8" fill="${sc}"/><rect x="0" y="53" width="${L}" height="8" fill="${sc}"/></g>`;
  }
  const front = model === 'hatch' ? L - 70 : L - 78;
  const back = model === 'hatch' ? 26 : 32;
  // Roof between the windows, a shade lighter.
  g += `<rect x="${back + 14}" y="27" width="${front - back - 18}" height="46" rx="12" fill="${shade(c, 0.18)}"/>`;
  // Windscreen (big, curved, at the front) and rear window.
  g += `<path d="M${front} 24L${front + 20} 28Q${front + 30} 50 ${front + 20} 72L${front} 76Q${front - 6} 50 ${front} 24Z" fill="${GLASS}" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>`;
  g += glint(front + 6, 32, front + 13, 34);
  g += `<path d="M${back} 28L${back + 12} 26Q${back + 16} 50 ${back + 12} 74L${back} 72Q${back - 4} 50 ${back} 28Z" fill="${GLASS}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`;
  if (model === 'taxi') {
    const x = (back + front) / 2 - 5;
    g += `<rect x="${x}" y="38" width="24" height="24" rx="5" fill="#fff" stroke="${INK}" stroke-width="4"/><path d="M${x + 7} 44V56M${x + 17} 44V56" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`;
  } else if (model === 'sunroof') {
    g += `<rect x="${(back + front) / 2 - 6}" y="37" width="28" height="26" rx="7" fill="${GLASS}" stroke="${INK}" stroke-width="4"/>`;
  }
  g += lamps(L);
  g += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${br}" fill="none" stroke="${INK}" stroke-width="6"/>`;
  if (isRed) {
    const cx = (back + front) / 2 + 7;
    g += `<circle cx="${cx}" cy="50" r="22" fill="#fff" stroke="${INK}" stroke-width="4.5"/><path d="${star(cx, 51, 15)}" fill="${RED}" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`;
  }
  return g;
}

/** A truck or bus, three cells long. Models: box truck, bus, tanker. Cab and load share the colour
 *  and one outline, so it reads as ONE vehicle. */
function truckBody(L, c, model, u) {
  let g = '';
  if (model === 'bus') {
    const bx = 10, by = 13, bw = L - 20, bh = 74;
    g += `<defs><clipPath id="${u}c"><rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="20"/></clipPath></defs>`;
    g += wheel(40, 5) + wheel(40, 79) + wheel(L - 74, 5) + wheel(L - 74, 79);
    g += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="20" fill="${c}"/>`;
    g += bodyLight(u, c);
    // One long window strip down each side, the roof hatches, the big windscreen.
    g += `<rect x="28" y="21" width="${L - 92}" height="11" rx="5" fill="${GLASS}" stroke="${INK}" stroke-width="3.5"/><rect x="28" y="68" width="${L - 92}" height="11" rx="5" fill="${GLASS}" stroke="${INK}" stroke-width="3.5"/>`;
    g += `<rect x="${L / 2 - 52}" y="39" width="34" height="22" rx="6" fill="${shade(c, 0.22)}" stroke="${INK}" stroke-width="3.5"/><rect x="${L / 2 + 6}" y="39" width="34" height="22" rx="6" fill="${shade(c, 0.22)}" stroke="${INK}" stroke-width="3.5"/>`;
    g += `<path d="M${L - 52} 22L${L - 34} 24Q${L - 22} 50 ${L - 34} 76L${L - 52} 78Q${L - 58} 50 ${L - 52} 22Z" fill="${GLASS}" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>`;
    g += glint(L - 46, 30, L - 39, 32);
    g += lamps(L);
    g += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="20" fill="none" stroke="${INK}" stroke-width="6"/>`;
    return g;
  }
  // One rounded body for the whole truck: the load at the back (paler), the cab at the front (the
  // colour), a line between them. The single outline is what makes it read as one vehicle.
  const cab = L - 86, bx = 10, by = 12, bw = L - 20, bh = 76;
  g += `<defs><clipPath id="${u}c"><rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="22"/></clipPath></defs>`;
  g += wheel(32, 4) + wheel(32, 80) + wheel(104, 4) + wheel(104, 80) + wheel(L - 66, 4) + wheel(L - 66, 80);
  g += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="22" fill="${c}"/>`;
  g += `<g clip-path="url(#${u}c)"><rect x="0" y="0" width="${cab}" height="100" fill="${shade(c, model === 'tanker' ? 0.5 : 0.38)}"/></g>`;
  g += bodyLight(u, c);
  if (model === 'tanker') {
    for (let x = 58; x < cab - 30; x += 56) g += `<path d="M${x} 14V86" stroke="${INK}" stroke-opacity=".3" stroke-width="5"/>`;
    g += `<circle cx="${cab / 2 + 5}" cy="50" r="11" fill="${shade(c, 0.7)}" stroke="${INK}" stroke-width="4"/>`;
  } else {
    g += `<rect x="26" y="38" width="${cab - 46}" height="24" rx="6" fill="${c}" stroke="${INK}" stroke-width="3.5"/>`;
  }
  g += `<path d="M${cab} ${by}V${by + bh}" stroke="${INK}" stroke-width="5"/>`;
  g += `<path d="M${L - 54} 24L${L - 36} 27Q${L - 26} 50 ${L - 36} 73L${L - 54} 76Q${L - 60} 50 ${L - 54} 24Z" fill="${GLASS}" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>`;
  g += glint(L - 48, 31, L - 41, 33);
  g += lamps(L);
  g += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="22" fill="none" stroke="${INK}" stroke-width="6"/>`;
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
      if (color === TAXI) models.push('taxi', 'taxi');
      inner = carBody(L, color, isRed ? 'sports' : models[Math.floor(R() * models.length)], isRed, uid);
    }
  } else {
    inner = woodSVG(L, color, isRed, R, uid);
  }
  if (p.h) return `<svg class="gl-art" viewBox="0 0 ${L} 100" aria-hidden="true">${inner}</svg>`;
  // Upright: the same drawing turned a quarter, front up and light from the left.
  return `<svg class="gl-art" viewBox="0 0 100 ${L}" aria-hidden="true"><g transform="translate(0 ${L}) rotate(-90)">${inner}</g></svg>`;
}
