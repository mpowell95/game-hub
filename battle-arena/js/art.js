// battle-arena/js/art.js - every picture in Battle Arena, as inline SVG strings. No files, no ids
// (many copies share a page), no gradients. Our own creatures: chunky, round, big-eyed, each tied
// to its element's colour. Drawn FACING RIGHT in a 120x120 box; the player's side mirrors them
// with CSS so the two teams face each other.
//
// Gems: every element has its own SHAPE and white icon (colourblind-safe: shape first, colour
// second): fire square + flame, water triangle + drop, spark circle + bolt, leaf diamond + leaf,
// shadow hexagon + swirl, berry a cluster, bomb a round bomb with its countdown.

// --- gems -------------------------------------------------------------------------------------------
const ICON = {
  flame: '<path d="M20 9c3 5 8 7 8 14a8 8 0 0 1-16 0c0-4 2-6 4-8 0 3 1 4 2 4 0-4 0-7 2-10z" fill="#fff"/>',
  drop: '<path d="M20 13c3 5 6 8 6 12a6 6 0 0 1-12 0c0-4 3-7 6-12z" fill="#fff"/>',
  bolt: '<path d="M22 8 12 22h7l-2 10 10-15h-7z" fill="#4a3300"/>',
  leaf: '<path d="M12 27c0-9 7-14 16-15 0 9-5 16-14 16z" fill="#fff"/><path d="M12 28c4-4 8-8 12-12" stroke="#2E9E44" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
  swirl: '<path d="M20 20a2.5 2.5 0 1 1 3 2.5 5 5 0 1 1-8-5 7.5 7.5 0 1 1 1 12" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round"/>',
};
const GEM_SHAPE = {
  fire: { body: '<rect x="4" y="4" width="32" height="32" rx="7" fill="#E0532F" stroke="#8e2a12" stroke-width="2"/>', shine: '<rect x="8" y="7" width="16" height="5" rx="2.5" fill="#fff" opacity=".28"/>', icon: 'flame' },
  water: { body: '<path d="M20 3.5 37 34a2.5 2.5 0 0 1-2.2 3.5H5.2A2.5 2.5 0 0 1 3 34z" fill="#1F5FA8" stroke="#0f3466" stroke-width="2" stroke-linejoin="round"/>', shine: '<path d="M18 10 12 21" stroke="#fff" stroke-width="3" opacity=".3" stroke-linecap="round"/>', icon: 'drop', dy: 3 },
  spark: { body: '<circle cx="20" cy="20" r="16.5" fill="#F2B705" stroke="#8a6400" stroke-width="2"/>', shine: '<path d="M10 14a11 11 0 0 1 8-7" stroke="#fff" stroke-width="3" opacity=".5" fill="none" stroke-linecap="round"/>', icon: 'bolt' },
  leaf: { body: '<rect x="8.2" y="8.2" width="23.6" height="23.6" rx="4" transform="rotate(45 20 20)" fill="#2E9E44" stroke="#165a24" stroke-width="2"/>', shine: '<path d="M13 15 19 9" stroke="#fff" stroke-width="3" opacity=".3" stroke-linecap="round"/>', icon: 'leaf' },
  shadow: { body: '<path d="M20 2.8 35 11.4v17.2L20 37.2 5 28.6V11.4z" fill="#7B4FC4" stroke="#40227a" stroke-width="2" stroke-linejoin="round"/>', shine: '<path d="M10 13 17 9" stroke="#fff" stroke-width="3" opacity=".3" stroke-linecap="round"/>', icon: 'swirl' },
};

/** One tile's picture. `n` is a bomb's countdown. */
export function gemSVG(kind, n) {
  if (kind === 'berry') {
    return `<svg viewBox="0 0 40 40" aria-hidden="true"><g stroke="#5a0f1f" stroke-width="1.8">
      <circle cx="14" cy="23" r="8" fill="#A3203A"/><circle cx="26" cy="23" r="8" fill="#A3203A"/><circle cx="20" cy="31" r="7.5" fill="#B8293F"/>
      <circle cx="20" cy="17" r="7" fill="#B8293F"/></g>
      <circle cx="12" cy="20" r="2" fill="#fff" opacity=".55"/><circle cx="18" cy="14" r="1.8" fill="#fff" opacity=".55"/>
      <path d="M20 10c-1-4 2-7 7-7-1 4-3 6-7 7z" fill="#2E9E44" stroke="#165a24" stroke-width="1.4"/></svg>`;
  }
  if (kind === 'bomb') {
    return `<svg viewBox="0 0 40 40" aria-hidden="true">
      <path d="M26 9c3-4 6-4 8-2" stroke="#8a7a62" stroke-width="2.4" fill="none" stroke-linecap="round"/>
      <path d="M35 4l1.5 2.5L39 7l-2.5 1.5L36 11l-1.2-2.4L32 7.6l2.6-1z" fill="#F2B705"/>
      <rect x="21" y="8" width="7" height="6" rx="1.5" transform="rotate(35 24 11)" fill="#5b6270"/>
      <circle cx="19" cy="23" r="14.5" fill="#3A3F47" stroke="#15181d" stroke-width="2"/>
      <path d="M9 18a11 11 0 0 1 7-6" stroke="#fff" stroke-width="2.6" opacity=".35" fill="none" stroke-linecap="round"/>
      <text x="19" y="29.5" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-weight="900" font-size="17" fill="#fff">${n == null ? '' : n}</text></svg>`;
  }
  const g = GEM_SHAPE[kind];
  if (!g) return '';
  const icon = g.dy ? `<g transform="translate(0 ${g.dy})">${ICON[g.icon]}</g>` : ICON[g.icon];
  return `<svg viewBox="0 0 40 40" aria-hidden="true">${g.body}${g.shine}${icon}</svg>`;
}

/** A small element badge (the gem's shape) for cards and floaters. 'all' = a prism. */
export function elementBadge(el) {
  if (el === 'all') {
    return `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 3 36 34H4z" fill="#fff" stroke="#555" stroke-width="2" stroke-linejoin="round"/>
      <path d="M20 3 4 34h10z" fill="#E0532F"/><path d="M20 3 14 34h6z" fill="#F2B705"/><path d="M20 3v31h6z" fill="#2E9E44"/><path d="M20 3l6 31h10z" fill="#1F5FA8"/>
      <path d="M20 3 36 34H4z" fill="none" stroke="#3b2b55" stroke-width="2" stroke-linejoin="round"/></svg>`;
  }
  return gemSVG(el);
}

// --- monster parts --------------------------------------------------------------------------------
const OL = (c) => `stroke="${c}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;
const shadowUnder = (cx = 60, rx = 34) => `<ellipse cx="${cx}" cy="111" rx="${rx}" ry="6" fill="#000" opacity=".18"/>`;
/** Big shiny eyes, looking right. `mood`: 'cute' | 'fierce' (a brow) | 'glow' (coloured iris). */
function eyes(x1, x2, y, r, { mood = 'cute', iris = '#1d1b2b', brow = '#1d1b2b', glow } = {}) {
  const one = (x, i) => {
    let s = `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 1.18}" fill="${glow || iris}"/>`;
    if (glow) s += `<ellipse cx="${x + r * 0.2}" cy="${y}" rx="${r * 0.38}" ry="${r * 0.75}" fill="#1d1b2b"/>`;
    s += `<circle cx="${x + r * 0.35}" cy="${y - r * 0.45}" r="${r * 0.36}" fill="#fff"/><circle cx="${x - r * 0.3}" cy="${y + r * 0.45}" r="${r * 0.16}" fill="#fff"/>`;
    if (mood === 'fierce') {
      const d = i === 0 ? `M${x - r * 1.2} ${y - r * 1.75} L${x + r * 1.1} ${y - r * 1.05}` : `M${x - r * 1.1} ${y - r * 1.05} L${x + r * 1.2} ${y - r * 1.75}`;
      s += `<path d="${d}" stroke="${brow}" stroke-width="3.4" stroke-linecap="round"/>`;
    }
    return s;
  };
  return one(x1, 0) + one(x2, 1);
}
const blush = (x1, x2, y, c = '#ff7f8f') => `<ellipse cx="${x1}" cy="${y}" rx="5" ry="3" fill="${c}" opacity=".55"/><ellipse cx="${x2}" cy="${y}" rx="5" ry="3" fill="${c}" opacity=".55"/>`;
const smile = (x, y, w, c = '#3a1d1d') => `<path d="M${x - w} ${y} q${w} ${w * 0.9} ${w * 2} 0" stroke="${c}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
const fangSmile = (x, y, w, c = '#3a1d1d') => `<path d="M${x - w} ${y} q${w} ${w} ${w * 2} 0 z" fill="#5a1f22" stroke="${c}" stroke-width="2.4" stroke-linejoin="round"/>
  <path d="M${x - w * 0.55} ${y + 0.5} l2 4 2-4z M${x + w * 0.35} ${y + 0.5} l2 4 2-4z" fill="#fff"/>`;
const flameTuft = (x, y, s, c1, c2) => `<path d="M${x} ${y} c${-6 * s} ${-6 * s} ${-2 * s} ${-14 * s} ${2 * s} ${-20 * s} c${0} ${6 * s} ${5 * s} ${7 * s} ${6 * s} ${12 * s} c${2 * s} ${-3 * s} ${2 * s} ${-6 * s} ${1 * s} ${-9 * s} c${6 * s} ${5 * s} ${7 * s} ${13 * s} ${1 * s} ${17 * s} z" fill="${c1}"/>
  <path d="M${x + 2 * s} ${y - 2 * s} c${-3 * s} ${-3 * s} ${-1 * s} ${-8 * s} ${1 * s} ${-11 * s} c${1 * s} ${4 * s} ${5 * s} ${6 * s} ${2 * s} ${11 * s} z" fill="${c2}"/>`;
const bolt = (x, y, s, fill, stroke) => `<path d="M${x} ${y} l${-8 * s} ${13 * s} h${6 * s} l${-3 * s} ${11 * s} l${11 * s} ${-15 * s} h${-6 * s} l${3 * s} ${-9 * s} z" fill="${fill}" stroke="${stroke}" stroke-width="2.4" stroke-linejoin="round"/>`;
const leafShape = (x, y, len, ang, fill, stroke) => `<g transform="rotate(${ang} ${x} ${y})"><path d="M${x} ${y} q${len * 0.5} ${-len * 0.45} ${len} 0 q${-len * 0.5} ${len * 0.45} ${-len} 0z" fill="${fill}" stroke="${stroke}" stroke-width="2.4" stroke-linejoin="round"/><path d="M${x + 2} ${y} h${len - 5}" stroke="${stroke}" stroke-width="1.5" opacity=".6"/></g>`;
const spike = (x, y, w, h, ang, fill, stroke) => `<path d="M${x - w / 2} ${y} L${x} ${y - h} L${x + w / 2} ${y} z" transform="rotate(${ang} ${x} ${y})" fill="${fill}" stroke="${stroke}" stroke-width="2.4" stroke-linejoin="round"/>`;
const crystal = (x, y, w, h, fill, stroke) => `<path d="M${x} ${y - h} L${x + w / 2} ${y - h * 0.6} L${x + w / 2} ${y} L${x - w / 2} ${y} L${x - w / 2} ${y - h * 0.6} z" fill="${fill}" stroke="${stroke}" stroke-width="2.4" stroke-linejoin="round"/><path d="M${x - w * 0.15} ${y - h * 0.75} v${h * 0.55}" stroke="#fff" stroke-width="2" opacity=".7" stroke-linecap="round"/>`;
const wrap = (inner) => `<svg viewBox="0 0 120 120" aria-hidden="true">${inner}</svg>`;

// --- the twelve -------------------------------------------------------------------------------------
const DRAW = {
  // Fire kitten: flame-tipped ears and a flame tail. Evolved: a lynx with a mane of fire.
  emberkit: (evo) => {
    const o = '#7a2410';
    if (!evo) {
      return shadowUnder(58, 30)
        + `<g ${OL(o)}><path d="M30 86c-14-4-20-18-14-30" fill="none" stroke-width="7" stroke="${o}"/><path d="M30 86c-14-4-20-18-14-30" fill="none" stroke-width="2" stroke="#F07A3A"/></g>`
        + flameTuft(14, 60, 0.9, '#F2B705', '#fff3c4')
        + `<g ${OL(o)}><ellipse cx="56" cy="86" rx="27" ry="21" fill="#F07A3A"/>
          <path d="M44 36 47 12 63 30z" fill="#F07A3A"/><path d="M74 30 90 13 92 38z" fill="#F07A3A"/>
          <circle cx="68" cy="54" r="27" fill="#F58A45"/>
          <ellipse cx="45" cy="104" rx="8" ry="5" fill="#F58A45"/><ellipse cx="68" cy="105" rx="8" ry="5" fill="#F58A45"/></g>`
        + `<path d="M48 29 49 18 58 28z" fill="#FFD27A"/><path d="M78 29 87 19 88 33z" fill="#FFD27A"/>`
        + flameTuft(46, 16, 0.42, '#F2B705', '#fff3c4') + flameTuft(88, 16, 0.42, '#F2B705', '#fff3c4')
        + `<ellipse cx="57" cy="90" rx="14" ry="11" fill="#FFE0B8"/><ellipse cx="78" cy="66" rx="13" ry="9" fill="#FFE0B8"/>`
        + eyes(64, 84, 51, 6) + blush(58, 94, 63) + `<path d="M83 61l3 2 3-2" stroke="${o}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`
        + smile(86, 67, 3.5, o);
    }
    return shadowUnder(60, 38)
      + flameTuft(18, 74, 1.4, '#E0532F', '#F2B705')
      + `<g ${OL(o)}><path d="M28 84c-12-4-18-14-14-24" fill="none" stroke-width="8"/></g>`
      + `<path d="M40 54c-10-10-6-26 4-34 2 8 6 10 10 12 0-10 6-18 14-22-2 10 4 14 8 18 4-6 10-8 16-8-4 8-2 14 2 20 6 0 10 4 12 8-8 2-10 8-10 14z" fill="#F2B705" stroke="${o}" stroke-width="3" stroke-linejoin="round"/>`
      + `<g ${OL(o)}><ellipse cx="56" cy="86" rx="32" ry="22" fill="#D9482B"/>
        <path d="M50 34 50 6 66 28z" fill="#D9482B"/><path d="M80 28 98 5 98 36z" fill="#D9482B"/>
        <circle cx="72" cy="54" r="28" fill="#E5583A"/>
        <ellipse cx="40" cy="105" rx="10" ry="6" fill="#E5583A"/><ellipse cx="70" cy="106" rx="10" ry="6" fill="#E5583A"/></g>`
      + `<path d="M50 6 47 0M98 5l3-6" stroke="${o}" stroke-width="3" stroke-linecap="round"/>`
      + `<path d="M54 27 54 14 62 26z" fill="#FFD27A"/><path d="M84 27 94 14 94 31z" fill="#FFD27A"/>`
      + `<ellipse cx="58" cy="92" rx="16" ry="11" fill="#FFD0A0"/><ellipse cx="84" cy="67" rx="14" ry="9" fill="#FFD0A0"/>`
      + eyes(68, 88, 50, 6, { mood: 'fierce', brow: o }) + `<path d="M88 61l3 2 3-2" stroke="${o}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`
      + fangSmile(91, 67, 5, o)
      + `<path d="M30 70l-6-3M32 78l-7 1M88 104l4 3" stroke="#F2B705" stroke-width="3" stroke-linecap="round"/>`;
  },

  // Leaf sprout: a round bud with two leaves on its head. Evolved: a turtle with a mossy shell and a flower.
  sproutle: (evo) => {
    const o = '#1f5a1f';
    if (!evo) {
      return shadowUnder(60, 30)
        + `<path d="M62 38c0-8 1-14 4-18" stroke="${o}" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M62 38c0-8 1-14 4-18" stroke="#5DAF4A" stroke-width="2" fill="none" stroke-linecap="round"/>`
        + leafShape(66, 20, 26, -35, '#7CCB5E', o) + leafShape(64, 22, 22, -150, '#5DAF4A', o)
        + `<g ${OL(o)}><ellipse cx="44" cy="102" rx="9" ry="6" fill="#6FBE57"/><ellipse cx="78" cy="102" rx="9" ry="6" fill="#6FBE57"/>
          <ellipse cx="60" cy="72" rx="34" ry="33" fill="#86D06A"/></g>`
        + `<ellipse cx="60" cy="86" rx="20" ry="13" fill="#D8F2C4"/><ellipse cx="46" cy="52" rx="8" ry="4" fill="#fff" opacity=".35" transform="rotate(-30 46 52)"/>`
        + eyes(62, 82, 66, 6.5) + blush(54, 90, 78) + smile(76, 80, 4, o);
    }
    return shadowUnder(58, 42)
      + `<g ${OL(o)}><ellipse cx="30" cy="102" rx="10" ry="7" fill="#7CC46A"/><ellipse cx="70" cy="103" rx="10" ry="7" fill="#7CC46A"/>
        <path d="M6 92c0-30 18-50 44-50s42 20 42 50z" fill="#4E8A3A"/>
        <path d="M10 92h80" stroke-width="6"/>
        <ellipse cx="98" cy="76" rx="19" ry="17" fill="#86D06A"/></g>`
      + `<path d="M24 60l12 8 14-12 14 10 14-8M18 80h16l10-12 14 12 16-12 10 10" stroke="#2f5f23" stroke-width="3" fill="none" stroke-linejoin="round"/>`
      + `<ellipse cx="34" cy="52" rx="12" ry="6" fill="#9AD67C"/><ellipse cx="66" cy="50" rx="10" ry="5" fill="#9AD67C"/><ellipse cx="50" cy="74" rx="9" ry="5" fill="#9AD67C"/>`
      + `<path d="M50 44c0-8 0-14 2-20" stroke="${o}" stroke-width="3" fill="none"/>`
      + `<g stroke="#8a2f55" stroke-width="2">${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="52" cy="16" rx="5" ry="8" transform="rotate(${a} 52 22)" fill="#FF9EC4"/>`).join('')}</g><circle cx="52" cy="22" r="4.5" fill="#F2B705" stroke="#8a6400" stroke-width="2"/>`
      + `<ellipse cx="106" cy="83" rx="8" ry="6" fill="#D8F2C4"/>`
      + eyes(94, 108, 70, 5, { mood: 'fierce', brow: o }) + smile(104, 84, 3, o) + blush(88, 114, 80);
  },

  // Water drop: a teardrop with a little fin. Evolved: a round shark with a wave crest.
  driplet: (evo) => {
    const o = '#103d70';
    if (!evo) {
      return shadowUnder(60, 28)
        + `<g ${OL(o)}><path d="M60 14c14 22 32 38 32 60a32 32 0 0 1-64 0c0-22 18-38 32-60z" fill="#4A90D9"/>
          <path d="M28 70c-8-2-12 4-10 10 6 0 10-4 10-10z" fill="#6AAAE8"/></g>`
        + `<path d="M48 40c-6 10-10 18-10 26" stroke="#fff" stroke-width="5" opacity=".5" fill="none" stroke-linecap="round"/>`
        + `<ellipse cx="62" cy="88" rx="18" ry="12" fill="#BFE0FF" opacity=".8"/>`
        + eyes(62, 80, 66, 6.5) + blush(54, 88, 78) + `<ellipse cx="74" cy="82" rx="4" ry="3.5" fill="#173a63"/>`
        + `<circle cx="100" cy="40" r="5" fill="none" stroke="#6AAAE8" stroke-width="2.5"/><circle cx="106" cy="26" r="3" fill="none" stroke="#6AAAE8" stroke-width="2"/>`;
    }
    return shadowUnder(58, 42)
      + `<g ${OL(o)}><path d="M20 70c-8-14-8-26-4-32 6 6 12 16 14 26 6-8 14-12 20-12" fill="#1F5FA8"/>
        <path d="M56 32c4-14 14-22 26-24-4 10-4 18 0 26z" fill="#1F5FA8"/>
        <ellipse cx="62" cy="70" rx="44" ry="34" fill="#2E73C4"/>
        <path d="M44 96c0 8 4 12 10 12-1-6 0-10 4-12z" fill="#1F5FA8"/></g>`
      + `<path d="M28 76c14 16 54 20 76 2-10 16-24 24-40 24-16 0-30-10-36-26z" fill="#E6F3FF"/>`
      + `<path d="M70 82 75 89 80 82 85 89 90 82 95 88" stroke="${o}" stroke-width="2.6" fill="#fff" stroke-linejoin="round"/>`
      + `<path d="M36 50q8-8 16 0t16 0" stroke="#8CC6FF" stroke-width="3.5" fill="none" stroke-linecap="round"/>`
      + eyes(76, 94, 58, 5.5, { mood: 'fierce', brow: o })
      + `<path d="M38 60l-6 2M40 68l-6 3" stroke="#103d70" stroke-width="2.5" stroke-linecap="round"/>`;
  },

  // Spark pup: zigzag ears and a lightning tail. Evolved: a bigger dog with a bolt mane.
  zapup: (evo) => {
    const o = '#6b4a00';
    if (!evo) {
      return shadowUnder(58, 30)
        + bolt(26, 60, 1.3, '#F2B705', o)
        + `<g ${OL(o)}><ellipse cx="56" cy="84" rx="26" ry="20" fill="#F7C531"/>
          <path d="M50 40 38 18 50 22 46 8 62 30z" fill="#F7C531"/><path d="M82 32 92 12 94 24 104 14 98 40z" fill="#F7C531"/>
          <circle cx="70" cy="56" r="26" fill="#FBD24A"/>
          <ellipse cx="44" cy="102" rx="8" ry="5" fill="#FBD24A"/><ellipse cx="66" cy="103" rx="8" ry="5" fill="#FBD24A"/></g>`
        + `<ellipse cx="88" cy="66" rx="12" ry="9" fill="#FFF1B8"/><ellipse cx="56" cy="88" rx="13" ry="10" fill="#FFF1B8"/>`
        + `<circle cx="64" cy="70" r="6" fill="#F08A2E" opacity=".8"/>`
        + eyes(68, 86, 52, 6) + `<ellipse cx="97" cy="62" rx="4" ry="3" fill="#3a2a00"/>` + smile(90, 70, 3.5, o);
    }
    return shadowUnder(58, 40)
      + bolt(26, 44, 2.1, '#F2B705', o)
      + `<path d="M44 40l-8-14 12 2-4-16 14 10 4-14 8 14 8-12 4 14 12-6-4 16z" fill="#FFE27A" stroke="${o}" stroke-width="3" stroke-linejoin="round"/>`
      + `<g ${OL(o)}><ellipse cx="54" cy="84" rx="32" ry="22" fill="#E8B21E"/>
        <path d="M54 36 40 8 56 16 54 0 70 26z" fill="#E8B21E"/><path d="M86 28 100 6 102 20 114 10 106 40z" fill="#E8B21E"/>
        <circle cx="74" cy="54" r="28" fill="#F2C230"/>
        <ellipse cx="38" cy="104" rx="10" ry="6" fill="#F2C230"/><ellipse cx="68" cy="105" rx="10" ry="6" fill="#F2C230"/></g>`
      + `<ellipse cx="94" cy="66" rx="14" ry="10" fill="#FFF1B8"/>`
      + bolt(56, 76, 0.9, '#fff', o)
      + eyes(72, 92, 50, 6, { mood: 'fierce', brow: o }) + `<ellipse cx="105" cy="62" rx="4.5" ry="3.2" fill="#3a2a00"/>` + fangSmile(96, 70, 5, o);
  },

  // Shadow mite: a wobbly ghost-blob with orb antennae. Evolved: a horned blob that is mostly mouth.
  gloomite: (evo) => {
    const o = '#33175f';
    if (!evo) {
      return shadowUnder(60, 30)
        + `<g ${OL(o)}><path d="M50 36c-4-10-10-16-16-16M70 36c4-10 10-16 16-16" fill="none"/>
          <circle cx="32" cy="20" r="6" fill="#C9A2F0"/><circle cx="88" cy="20" r="6" fill="#C9A2F0"/>
          <path d="M26 74c0-24 14-40 34-40s34 16 34 40v30l-8-6-9 6-8-6-9 6-8-6-9 6-8-6-9 6z" fill="#8E63D6"/></g>`
        + `<ellipse cx="44" cy="52" rx="8" ry="4" fill="#fff" opacity=".3" transform="rotate(-30 44 52)"/>`
        + eyes(62, 82, 64, 7, { glow: '#F2B705' }) + blush(54, 90, 78, '#e08ae0') + smile(76, 82, 4, o);
    }
    return shadowUnder(60, 42)
      + `<g ${OL(o)}><path d="M38 38c-6-14-4-26 4-32 0 10 4 18 10 24M84 36c6-14 4-26-4-32 0 10-4 18-10 24" fill="#5B3A9E"/>
        <path d="M14 78c0-30 20-48 46-48s46 18 46 48v28l-10-8-10 8-10-8-10 8-10-8-10 8-10-8-10 8-12-8z" fill="#6E46BC"/></g>`
      + `<path d="M40 74q24 30 60 0 0 24-30 26t-30-26z" fill="#2a0e46" stroke="${o}" stroke-width="3" stroke-linejoin="round"/>`
      + `<path d="M46 78l4 7 4-6 4 8 5-7 4 8 5-7 4 7 5-7 4 6 5-8" stroke="#fff" stroke-width="2.4" fill="#fff" stroke-linejoin="round"/>`
      + `<path d="M58 96q8-6 16 0" stroke="#E86A8A" stroke-width="4" fill="none" stroke-linecap="round"/>`
      + eyes(62, 88, 56, 7, { glow: '#F2B705', mood: 'fierce', brow: o })
      + `<circle cx="22" cy="46" r="3" fill="#C9A2F0"/><circle cx="104" cy="40" r="2.5" fill="#C9A2F0"/>`;
  },

  // Fire pebble: a rock with lava cracks. Evolved: a crag golem with a magma heart.
  pebbleop: (evo) => {
    const o = '#3d2f25';
    if (!evo) {
      return shadowUnder(60, 34)
        + `<g ${OL(o)}><ellipse cx="42" cy="104" rx="9" ry="5" fill="#7a6b5d"/><ellipse cx="78" cy="104" rx="9" ry="5" fill="#7a6b5d"/>
          <path d="M24 82 28 50 50 32 82 34 98 56 96 88 72 102 40 100z" fill="#9A8B7A"/></g>`
        + `<path d="M36 46l8 10-4 12M88 50l-8 6 2 10M40 90l10-6 6 8" stroke="#E0532F" stroke-width="3.5" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`
        + `<path d="M36 46l8 10-4 12M88 50l-8 6 2 10M40 90l10-6 6 8" stroke="#F2B705" stroke-width="1.4" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`
        + `<path d="M50 38 66 36 60 44z" fill="#b8ab9c"/>`
        + eyes(62, 80, 66, 6) + blush(54, 88, 78) + smile(73, 81, 4, o)
        + flameTuft(66, 34, 0.55, '#E0532F', '#F2B705');
    }
    return shadowUnder(60, 44)
      + `<g ${OL(o)}><path d="M20 70 8 58 24 50zM100 64 114 50 104 76z" fill="#6f6152"/>
        <path d="M30 42 36 18 48 36zM54 32 62 6 72 30zM78 36 92 14 94 44z" fill="#8a7a69"/>
        <path d="M30 108 36 92H52L54 108zM70 108 72 92H88L92 108z" fill="#6f6152"/>
        <path d="M16 84 22 44 48 28 86 30 106 52 104 92 76 104 34 102z" fill="#857563"/></g>`
      + `<circle cx="60" cy="78" r="13" fill="#E0532F" stroke="${o}" stroke-width="3"/><circle cx="60" cy="78" r="7" fill="#F2B705"/>`
      + `<path d="M28 52l10 8-2 12M96 56l-10 6 2 12M48 98l12-8 12 8" stroke="#E0532F" stroke-width="4" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`
      + `<path d="M28 52l10 8-2 12M96 56l-10 6 2 12M48 98l12-8 12 8" stroke="#F2B705" stroke-width="1.6" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`
      + eyes(62, 84, 52, 5.5, { glow: '#F2B705', mood: 'fierce', brow: o });
  },

  // Fire bird: round, a flame crest, a flame tail. Evolved: a wyvern with horns and wings.
  cinderwing: (evo) => {
    const o = '#6e1a0e';
    if (!evo) {
      return shadowUnder(60, 28)
        + flameTuft(22, 82, 1, '#F2B705', '#fff3c4')
        + `<g ${OL(o)}><path d="M30 80c-8-2-14-8-16-14 8 0 14 2 18 6" fill="#E5533A"/>
          <ellipse cx="62" cy="72" rx="32" ry="30" fill="#E5533A"/>
          <path d="M92 66l14 5-14 6z" fill="#F2B705"/>
          <path d="M40 74c6-14 22-16 30-6-8 12-22 14-30 6z" fill="#C43A24"/>
          <path d="M54 104v6M70 104v6" fill="none"/></g>`
        + flameTuft(62, 44, 0.8, '#F2B705', '#fff3c4')
        + `<ellipse cx="68" cy="88" rx="16" ry="10" fill="#FFC9A8"/>`
        + eyes(70, 86, 62, 6) + blush(64, 94, 74);
    }
    return shadowUnder(60, 44)
      + `<g ${OL(o)}><path d="M44 56C30 30 10 26 4 30c8 6 8 14 4 20 8-2 12 2 12 8 6-4 12-2 16 4z" fill="#C43A24"/>
        <path d="M44 56C30 30 10 26 4 30" fill="none"/>
        <path d="M30 88c-14 4-22 0-26-6 8-2 12-6 14-12" fill="#D9482B"/>
        <ellipse cx="56" cy="82" rx="28" ry="22" fill="#D9482B"/>
        <path d="M66 70c2-20 14-34 32-32 14 2 18 14 14 22-6 10-24 14-46 10z" fill="#E5583A"/>
        <path d="M80 40 76 22 88 36zM94 38 98 20 104 38z" fill="#5a2a1a"/>
        <path d="M42 104 46 92H56L58 104zM66 104 68 92H78L80 104z" fill="#C43A24"/></g>`
      + flameTuft(6, 86, 1, '#F2B705', '#fff3c4')
      + `<path d="M40 80c6 8 22 10 34 4-4 12-16 16-26 14-6-2-10-10-8-18z" fill="#FFC9A8"/>`
      + `<path d="M96 60 100 66 104 60 108 65" stroke="${o}" stroke-width="2.4" fill="#fff" stroke-linejoin="round"/>`
      + eyes(90, 104, 48, 4.5, { mood: 'fierce', brow: o })
      + `<path d="M112 58c4-2 6 0 6 2" stroke="#F2B705" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  },

  // Leaf bear cub with thorns down its back. Evolved: a big bear with branch antlers and a leaf crown.
  thornpaw: (evo) => {
    const o = '#1d4d1d';
    if (!evo) {
      return shadowUnder(58, 32)
        + spike(34, 64, 10, 14, -60, '#2E7D32', o) + spike(38, 52, 10, 14, -40, '#2E7D32', o) + spike(48, 44, 10, 14, -20, '#2E7D32', o)
        + `<g ${OL(o)}><ellipse cx="54" cy="84" rx="28" ry="22" fill="#5BAE4F"/>
          <circle cx="56" cy="34" r="9" fill="#5BAE4F"/><circle cx="88" cy="36" r="9" fill="#5BAE4F"/>
          <circle cx="72" cy="56" r="26" fill="#6CBF5C"/>
          <ellipse cx="42" cy="104" rx="9" ry="6" fill="#6CBF5C"/><ellipse cx="68" cy="105" rx="9" ry="6" fill="#6CBF5C"/></g>`
        + `<circle cx="56" cy="34" r="4" fill="#C9EBB8"/><circle cx="88" cy="36" r="4" fill="#C9EBB8"/>`
        + `<ellipse cx="88" cy="66" rx="12" ry="9" fill="#C9EBB8"/>` + `<ellipse cx="96" cy="62" rx="4" ry="3" fill="#1d3a1d"/>`
        + eyes(70, 86, 52, 5.5) + blush(64, 98, 66) + smile(90, 70, 3, o)
        + leafShape(66, 30, 16, -70, '#9AD67C', o);
    }
    return shadowUnder(58, 44)
      + `<path d="M58 30 50 8M50 8l-8-4M50 8l2-8M54 20l-10 0M86 30 94 6M94 6l8-2M94 6l-2-8M90 18l10 2" stroke="#6b4a2a" stroke-width="5" fill="none" stroke-linecap="round"/>`
      + leafShape(42, 4, 12, 200, '#7CCB5E', o) + leafShape(102, 4, 12, -20, '#7CCB5E', o) + leafShape(52, -1, 10, -90, '#5DAF4A', o)
      + spike(26, 70, 12, 18, -70, '#1f6b25', o) + spike(28, 56, 12, 18, -50, '#1f6b25', o) + spike(36, 44, 12, 18, -30, '#1f6b25', o)
      + `<g ${OL(o)}><ellipse cx="52" cy="84" rx="34" ry="24" fill="#3F8F3A"/>
        <circle cx="56" cy="34" r="9" fill="#3F8F3A"/><circle cx="92" cy="34" r="9" fill="#3F8F3A"/>
        <circle cx="74" cy="56" r="28" fill="#4FA344"/>
        <ellipse cx="36" cy="106" rx="11" ry="6" fill="#4FA344"/><ellipse cx="68" cy="107" rx="11" ry="6" fill="#4FA344"/></g>`
      + `<ellipse cx="92" cy="68" rx="14" ry="10" fill="#C9EBB8"/><ellipse cx="102" cy="63" rx="4.5" ry="3.2" fill="#1d3a1d"/>`
      + eyes(72, 90, 52, 5.5, { mood: 'fierce', brow: o }) + fangSmile(96, 72, 4.5, o)
      + leafShape(46, 80, 14, -30, '#9AD67C', o) + leafShape(56, 92, 12, 10, '#9AD67C', o);
  },

  // Ice sprite: a pale blob with a crystal on its head. Evolved: a crowned ice queen with a scarf.
  frostling: (evo) => {
    const o = '#2f5f86';
    if (!evo) {
      return shadowUnder(60, 28)
        + crystal(60, 36, 14, 26, '#DFF4FF', o) + crystal(48, 40, 9, 14, '#BFE6FF', o) + crystal(72, 40, 9, 16, '#BFE6FF', o)
        + `<g ${OL(o)}><path d="M28 96c-4-34 10-58 32-58s36 24 32 58c-10 8-54 8-64 0z" fill="#9FD3F2"/>
          <path d="M30 74c-8 2-12 8-10 14 6 0 10-6 10-14zM90 74c8 2 12 8 10 14-6 0-10-6-10-14z" fill="#BFE6FF"/></g>`
        + `<path d="M44 52c-4 6-6 12-6 18" stroke="#fff" stroke-width="5" opacity=".55" fill="none" stroke-linecap="round"/>`
        + eyes(62, 80, 68, 6, { iris: '#1b3550' }) + blush(54, 88, 80, '#ff9fc8') + smile(71, 84, 3.5, o)
        + `<g stroke="#fff" stroke-width="1.8" stroke-linecap="round"><path d="M96 30v10M91 35h10M92.5 31.5l7 7M99.5 31.5l-7 7"/></g>`;
    }
    return shadowUnder(60, 38)
      + `<g ${OL(o)}><path d="M14 100c6-24 18-40 30-46l32 0c12 6 24 22 30 46z" fill="#BFE6FF"/></g>`
      + `<g ${OL(o)}><path d="M30 94c-4-36 10-62 30-62s34 26 30 62c-10 8-50 8-60 0z" fill="#E6F6FF"/></g>`
      + crystal(60, 30, 14, 30, '#DFF4FF', o) + crystal(44, 34, 10, 20, '#BFE6FF', o) + crystal(76, 34, 10, 20, '#BFE6FF', o) + crystal(32, 42, 8, 12, '#BFE6FF', o) + crystal(88, 42, 8, 12, '#BFE6FF', o)
      + `<path d="M34 78c16 8 36 8 52 0l2 10c-18 8-38 8-56 0z" fill="#1F5FA8" stroke="${o}" stroke-width="3" stroke-linejoin="round"/>`
      + `<path d="M78 84l8 22 8-4-6-20z" fill="#1F5FA8" stroke="${o}" stroke-width="3" stroke-linejoin="round"/>`
      + eyes(62, 80, 60, 5.5, { iris: '#1b3550' }) + `<path d="M56 50l10-2M76 48l10 2" stroke="${o}" stroke-width="2.4" stroke-linecap="round"/>`
      + smile(71, 72, 3, o) + blush(54, 88, 70, '#ff9fc8')
      + `<g stroke="#9FD3F2" stroke-width="2" stroke-linecap="round"><path d="M104 22v12M98 28h12M100 24l8 8M108 24l-8 8M12 40v10M7 45h10"/></g>`;
  },

  // Spark goat kid with one bolt horn. Evolved: a storm dragon with bolt horns and a cloud mane.
  stormhorn: (evo) => {
    const o = '#6b4a00';
    if (!evo) {
      return shadowUnder(58, 30)
        + `<g ${OL(o)}><ellipse cx="52" cy="82" rx="26" ry="19" fill="#F2C230"/>
          <path d="M40 98v10M56 99v10M68 96v10" fill="none" stroke-width="7"/>
          <path d="M40 98v10M56 99v10M68 96v10" fill="none" stroke-width="2.5" stroke="#F2C230"/>
          <path d="M78 42c-12-4-20-2-22 4 6 2 14 2 22-4z" fill="#E8B21E"/>
          <ellipse cx="80" cy="58" rx="22" ry="20" fill="#FBD24A"/></g>`
        + bolt(84, 12, 1.1, '#fff7d1', o)
        + `<g fill="#D9E1EA" stroke="#7a8696" stroke-width="2.4"><circle cx="38" cy="66" r="8"/><circle cx="48" cy="62" r="9"/><circle cx="30" cy="74" r="7"/></g>`
        + `<ellipse cx="94" cy="68" rx="9" ry="7" fill="#FFF1B8"/>`
        + eyes(78, 94, 54, 5.5) + blush(72, 102, 64) + smile(96, 72, 3, o);
    }
    return shadowUnder(58, 44)
      + `<g ${OL(o)}><path d="M22 84c-14-4-18-16-14-26 6 6 10 8 16 8" fill="#E8B21E"/>
        <path d="M40 60C34 34 18 28 8 30c8 8 8 16 2 22 10-2 16 2 18 8z" fill="#D9A81A"/>
        <ellipse cx="54" cy="82" rx="32" ry="22" fill="#E8B21E"/>
        <path d="M38 102v8M60 104v6M76 100v8" stroke-width="8" fill="none"/>
        <path d="M68 66c0-18 12-32 30-30 14 2 20 12 16 22-4 10-22 14-46 8z" fill="#F2C230"/></g>`
      + `<g fill="#AEB8C4" stroke="#5f6a78" stroke-width="2.4"><circle cx="62" cy="46" r="10"/><circle cx="74" cy="36" r="10"/><circle cx="54" cy="58" r="9"/></g>`
      + bolt(92, 8, 1.15, '#fff7d1', o) + bolt(108, 12, 0.9, '#fff7d1', o)
      + `<path d="M98 60 102 66 106 60 110 65" stroke="${o}" stroke-width="2.4" fill="#fff" stroke-linejoin="round"/>`
      + eyes(90, 104, 48, 4.5, { mood: 'fierce', brow: o })
      + bolt(48, 72, 0.7, '#fff', o);
  },

  // Shadow owl with ringed eyes and a sigil. Evolved: a horned owl with glowing eyes and starry wings.
  hexowl: (evo) => {
    const o = '#2a1550';
    if (!evo) {
      return shadowUnder(60, 30)
        + `<g ${OL(o)}><path d="M36 40 32 18 50 32zM84 40 88 18 70 32z" fill="#5B3A9E"/>
          <path d="M28 70c0-24 14-38 32-38s32 14 32 38c0 22-14 36-32 36S28 92 28 70z" fill="#6E4BB8"/>
          <path d="M30 72c-6 8-6 18 0 24 6-6 8-14 6-22zM90 72c6 8 6 18 0 24-6-6-8-14-6-22z" fill="#5B3A9E"/>
          <circle cx="48" cy="58" r="12" fill="#D9CCF2"/><circle cx="74" cy="58" r="12" fill="#D9CCF2"/>
          <path d="M58 68l3 6 3-6z" fill="#F2B705"/></g>`
        + eyes(50, 76, 58, 6)
        + `<path d="M54 84l6-4 6 4v7l-6 4-6-4z" fill="none" stroke="#C9A2F0" stroke-width="2.4"/><circle cx="60" cy="87.5" r="2" fill="#C9A2F0"/>`
        + `<path d="M48 106v5M56 106v5M66 106v5M74 106v5" stroke="#F2B705" stroke-width="3" stroke-linecap="round"/>`;
    }
    return shadowUnder(60, 44)
      + `<g ${OL(o)}><path d="M36 38 24 6 50 28zM84 38 96 6 70 28z" fill="#3E2475"/>
        <path d="M24 70C4 60 0 84 6 100c8-2 14-8 18-16zM96 70c20-10 24 14 18 30-8-2-14-8-18-16z" fill="#3E2475"/>
        <path d="M24 70c0-26 16-42 36-42s36 16 36 42c0 24-16 38-36 38S24 94 24 70z" fill="#4E2F94"/>
        <circle cx="46" cy="58" r="13" fill="#2a1550"/><circle cx="76" cy="58" r="13" fill="#2a1550"/>
        <path d="M58 70l3 7 3-7z" fill="#F2B705"/></g>`
      + eyes(48, 78, 58, 6.5, { glow: '#F2B705', mood: 'fierce', brow: '#C9A2F0' })
      + `<g fill="#F2E6FF"><circle cx="10" cy="86" r="1.6"/><circle cx="16" cy="76" r="1.3"/><circle cx="108" cy="80" r="1.6"/><circle cx="104" cy="92" r="1.3"/></g>`
      + `<path d="M52 84l8-5 8 5v9l-8 5-8-5z" fill="none" stroke="#C9A2F0" stroke-width="2.6"/><path d="M56 88h8M60 84v8" stroke="#C9A2F0" stroke-width="2"/>`
      + `<path d="M46 108v5M56 108v5M66 108v5M76 108v5" stroke="#F2B705" stroke-width="3" stroke-linecap="round"/>`;
  },

  // A pearly blob striped with every element's colour, a prism on its head. Evolved: crowned in prisms.
  prismote: (evo) => {
    const o = '#3b2b55';
    const bands = (cx, cy, rx, ry) => ['#E0532F', '#F2B705', '#2E9E44', '#1F5FA8', '#7B4FC4'].map((c, i) =>
      `<path d="M${cx - rx + 6} ${cy + 8 + i * 6}q${rx - 6} ${12} ${(rx - 6) * 2} 0" stroke="${c}" stroke-width="4" fill="none" stroke-linecap="round" opacity=".85"/>`).join('');
    if (!evo) {
      return shadowUnder(60, 30)
        + crystal(60, 34, 14, 24, '#fff', o)
        + `<path d="M56 18l4-6 4 6" fill="none" stroke="#7B4FC4" stroke-width="2"/>`
        + `<g ${OL(o)}><path d="M26 80c0-26 14-46 34-46s34 20 34 46c0 18-14 26-34 26S26 98 26 80z" fill="#F6F2FF"/></g>`
        + bands(60, 70, 30, 0)
        + eyes(62, 80, 62, 6) + blush(54, 88, 72, '#ff9fc8') + smile(71, 74, 3, o)
        + `<g stroke="#C9A2F0" stroke-width="2" stroke-linecap="round"><path d="M100 30v8M96 34h8M18 44v6M15 47h6"/></g>`;
    }
    return shadowUnder(60, 44)
      + `<g ${OL(o)}><path d="M14 104c0-30 18-50 46-50s46 20 46 50z" fill="#E6DCFF"/></g>`
      + ['#E0532F', '#F2B705', '#2E9E44', '#1F5FA8', '#7B4FC4'].map((c, i) => `<path d="M${22 + i * 4} 104c0-${26 - i * 4} ${16 - i * 2}-${42 - i * 6} ${38 - i * 4}-${42 - i * 6}s${38 - i * 4} ${16 - i * 4} ${38 - i * 4} ${42 - i * 6}" stroke="${c}" stroke-width="3.5" fill="none" opacity=".75"/>`).join('')
      + `<g ${OL(o)}><path d="M30 80c0-24 12-42 30-42s30 18 30 42c0 16-12 24-30 24S30 96 30 80z" fill="#FBF9FF"/></g>`
      + crystal(60, 34, 14, 30, '#fff', o) + crystal(44, 38, 10, 18, '#FFD9CF', o) + crystal(76, 38, 10, 18, '#CFE3FF', o) + crystal(32, 46, 8, 12, '#FFF1B8', o) + crystal(88, 46, 8, 12, '#D8F2C4', o)
      + bands(60, 72, 26, 0)
      + eyes(62, 80, 62, 5.5, { mood: 'fierce', brow: o }) + smile(71, 74, 3, o)
      + `<g stroke="#C9A2F0" stroke-width="2" stroke-linecap="round"><path d="M108 24v10M103 29h10M10 30v8M6 34h8"/></g>`;
  },
};

/** A monster's picture (normal or evolved), 120x120, facing right. */
export function monsterSVG(id, evolved) {
  const d = DRAW[id];
  return d ? wrap(d(!!evolved)) : wrap('');
}

/** The hub tile's face (also used as this game's own "brand" mark). */
export const TITLE_MONSTERS = ['emberkit', 'driplet'];
