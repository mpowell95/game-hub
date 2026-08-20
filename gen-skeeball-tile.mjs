// gen-skeeball-tile.mjs - regenerates the skeeball hub tile in js/game-art.js FROM boards.js.
//
//   node gen-skeeball-tile.mjs
//
// WHY THIS EXISTS. The tile was drawn by eye three times and was wrong three times, most
// recently with the 10, 20 and 30 as a vertical column of ovals. They are not: their rings
// share a centre - a bullseye - and only the 40 and 50 stack above it. Positions, radii and
// centres all come out of G.holes now, so the tile cannot drift from the machine.
//
// Two things that are easy to get wrong and are handled here: u is scaled by the board width
// AT THAT HEIGHT (without it the 100s, at u = +/-0.4, fall outside the board and the rail clips
// them), and the 10 is an ARC - sweep-flag 0, the half BELOW its centre. Flag 1 arcs it over
// the top like a rainbow.
//
// A NEW MACHINE: add a face({...}) call for its trapezoid and rerun.
import fs from 'node:fs';
import { BOARDS } from './skeeball/js/boards.js';

const G = BOARDS[0].geom;
const n = (x) => +Number(x).toFixed(2);

/** One machine's board, drawn into a trapezoid. topHalf/botHalf are its half-widths on screen,
 *  so u is scaled by the board's REAL width at that height - without it the 100s, which sit at
 *  u = +/-0.4, land outside the board and get clipped by the rail. */
function face({ cx, topY, botY, topHalf, botHalf, id, detail }) {
  const H = botY - topY;
  const yOf = (v) => topY + H * (1 - v / G.boardLen);
  const halfAt = (y) => topHalf + (botHalf - topHalf) * ((y - topY) / H);
  const xOf = (u, y) => cx + u * 2 * halfAt(y);
  const rxOf = (r, y) => r * 2 * halfAt(y);
  const ryOf = (r) => r * (H / G.boardLen);
  const WALL = n(G.ringH * (H / G.boardLen));

  const parts = [];
  const rings = [];
  for (const hid of Object.keys(G.holes)) {
    const h = G.holes[hid];
    if (!h.ringD) continue;
    const R = h.ringD / 2 + G.ringThick / 2;
    const cv = h.v - h.r + h.ringD / 2;
    const y = yOf(cv);
    rings.push({ hid, h, y, x: xOf(h.u, y), rx: rxOf(R, y), ry: ryOf(R), open: !!h.ringOpen,
      big: R > 0.25 });
  }
  // DRAW ORDER, and it is not depth. The two big rings go down FIRST, outermost first, then
  // every cup on top of them. Sorting purely by depth puts the 20 after the 40 and 50 - its
  // centre is lower down the board than theirs - and its band then paints straight over their
  // rims at the tangent point. On the machine the cups STAND IN FRONT of the big rings, which is
  // what the 3D render shows, so the cups have to be painted last.
  rings.sort((a, b) => {
    const bigA = a.big || a.open, bigB = b.big || b.open;
    if (bigA !== bigB) return bigA ? -1 : 1;      // rings under cups
    if (bigA) return b.rx - a.rx;                 // widest ring first: the 10, then the 20
    return a.y - b.y;                             // cups far first, so the nearest sits on top
  });

  for (const r of rings) {
    const x = n(r.x), y = n(r.y), rx = n(r.rx), ry = n(r.ry);
    if (r.open) {
      // The 10 is an ARC - only the half below its centre exists. sweep-flag 0 is the one that
      // goes DOWN from the left-hand end; sweep 1 arcs it over the top like a rainbow.
      parts.push(`<path d="M${n(x - rx)} ${y} A ${rx} ${ry} 0 0 0 ${n(x + rx)} ${y}" fill="none" stroke="#f7f2e8" stroke-width="${WALL}"/>`);
      parts.push(`<path d="M${n(x - rx)} ${n(y - WALL / 2)} A ${rx} ${ry} 0 0 0 ${n(x + rx)} ${n(y - WALL / 2)}" fill="none" stroke="#2b5ea7" stroke-width="0.6"/>`);
    } else if (r.big) {
      parts.push(`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="none" stroke="#f7f2e8" stroke-width="${WALL}"/>`);
      parts.push(`<ellipse cx="${x}" cy="${n(y - WALL / 2)}" rx="${rx}" ry="${ry}" fill="none" stroke="#2b5ea7" stroke-width="0.6"/>`);
    } else if (detail) {
      const hh = n(WALL * 0.92);
      parts.push(`<ellipse cx="${x}" cy="${n(y + hh)}" rx="${rx}" ry="${ry}" fill="#ded7ca"/>`);
      parts.push(`<rect x="${n(x - rx)}" y="${y}" width="${n(rx * 2)}" height="${hh}" fill="#efe9dd"/>`);
      parts.push(`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#f7f2e8" stroke="#2b5ea7" stroke-width="0.6"/>`);
      parts.push(`<ellipse cx="${x}" cy="${y}" rx="${n(rx * 0.58)}" ry="${n(ry * 0.58)}" fill="#1a120c"/>`);
    } else {
      parts.push(`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="none" stroke="#f7f2e8" stroke-width="${n(WALL * 0.8)}"/>`);
    }
  }
  const tl = n(cx - topHalf), tr = n(cx + topHalf), bl = n(cx - botHalf), br = n(cx + botHalf);
  const trap = `M${tl} ${topY} L${tr} ${topY} L${br} ${botY} L${bl} ${botY} Z`;
  return { trap, rings: parts.join('\n                 '), id };
}

const main = face({ cx: 80, topY: 22, botY: 56, topHalf: 21, botHalf: 28, id: 'skb-face', detail: true });
const left = face({ cx: 12.5, topY: 23, botY: 54, topHalf: 17.5, botHalf: 24.5, id: 'skb-l', detail: false });
const right = face({ cx: 147.5, topY: 23, botY: 54, topHalf: 17.5, botHalf: 24.5, id: 'skb-r', detail: false });

const svg = `  skeeball: \`<svg viewBox="0 0 160 90" aria-hidden="true">
             <defs>
               <clipPath id="skb-face"><path d="${main.trap}"/></clipPath>
               <clipPath id="skb-l"><path d="${left.trap}"/></clipPath>
               <clipPath id="skb-r"><path d="${right.trap}"/></clipPath>
             </defs>
             <rect width="160" height="90" fill="#140d0a"/>
             <g opacity="0.32">
               <rect x="-8" y="7" width="41" height="6" rx="2" fill="#3a2416"/>
               <rect x="-6" y="13" width="37" height="10" fill="#241610"/>
               <path d="${left.trap}" fill="#7a4520"/>
               <g clip-path="url(#skb-l)" opacity="0.75">
                 ${left.rings}
               </g>
               <path d="M-12 54 L37 54 L47 90 L-24 90 Z" fill="#5e3d1f"/>
               <rect x="127" y="7" width="41" height="6" rx="2" fill="#3a2416"/>
               <rect x="129" y="13" width="37" height="10" fill="#241610"/>
               <path d="${right.trap}" fill="#7a4520"/>
               <g clip-path="url(#skb-r)" opacity="0.75">
                 ${right.rings}
               </g>
               <path d="M123 54 L172 54 L184 90 L113 90 Z" fill="#5e3d1f"/>
             </g>
             <rect x="54" y="3" width="52" height="8" rx="2" fill="#28150b" stroke="#6b4526" stroke-width="1"/>
             <g fill="#ffd977">
               <circle cx="61" cy="7" r="1"/><circle cx="70" cy="7" r="1"/><circle cx="80" cy="7" r="1"/>
               <circle cx="90" cy="7" r="1"/><circle cx="99" cy="7" r="1"/>
             </g>
             <rect x="56" y="11" width="48" height="11" fill="#2a1c14" stroke="#54301a" stroke-width="0.8"/>
             <g opacity="0.55">
               <path d="M80 13 L80 21 M58 17 L102 17" stroke="#54301a" stroke-width="0.6"/>
               <g fill="#ffd977">
                 <rect x="66" y="14.4" width="5" height="1.2"/><rect x="89" y="14.4" width="5" height="1.2"/>
                 <rect x="66" y="18.6" width="5" height="1.2"/><rect x="89" y="18.6" width="5" height="1.2"/>
               </g>
             </g>
             <path d="${main.trap}" fill="#c96f2e" stroke="#8f4c1d" stroke-width="1"/>
             <g clip-path="url(#skb-face)">
                 ${main.rings}
             </g>
             <path d="M52 56 L108 56 L114 90 L46 90 Z" fill="#a86f38"/>
             <path d="M52 56 L46 90 L39 90 L47 56 Z" fill="#54301a"/>
             <path d="M108 56 L114 90 L121 90 L113 56 Z" fill="#54301a"/>
             <path d="M54 57 L106 57 L107 60 L53 60 Z" fill="#c98a49"/>
             <circle cx="80" cy="76" r="5.2" fill="#f6ecda"/>
             <circle cx="78.3" cy="74.3" r="1.7" fill="#fffdf5"/>
           </svg>\`,`;

const f = 'js/game-art.js';
const NL = '\r\n';
let text = fs.readFileSync(f, 'utf8');
const startTok = '  skeeball: `<svg viewBox="0 0 160 90" aria-hidden="true">';
const start = text.indexOf(startTok.replace(/\n/g, NL));
if (start < 0) throw new Error('art not found');
const endTok = '</svg>`,';
const end = text.indexOf(endTok, start);
if (end < 0) throw new Error('end not found');
text = text.slice(0, start) + svg.replace(/\n/g, NL) + text.slice(end + endTok.length);
fs.writeFileSync(f, text);
console.log('tile generated from boards.js');
