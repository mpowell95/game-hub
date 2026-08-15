// skeeball/js/howto.js - the How To Play sheet's content. Rebuilt 2026-08-15 on Matt's
// instruction: almost no words, the pictures carry everything, and nothing anyone already
// knows about skeeball gets explained. Exactly four panels:
//
//   1. Swipe to roll        - a hand, an upward swipe arrow, the ball, the lane.
//   2. Holes score amounts  - the board face with its values in the holes, an up arrow with
//                             a plus sign saying higher is worth more. No caption at all.
//   3. Nine balls per game  - the tray holding exactly nine balls.
//   4. The unlock chain     - beat the score shown on machine 1 and the padlock on machine 2
//                             opens. Picture only, per the instruction: the score is IN the
//                             image (a starburst, repeated on the padlock tag so the pairing
//                             reads by shape), never a sentence.
//
// The whole-screen rules (tic-tac-toe/CLAUDE.md, "How-to-play screens") still bind: the two
// captions are .sk-ht-line so ui.js's _fitHelpLines measures and locks them to one row, the
// sheet body is one flex column with a fixed gap, and every meaning in the SVGs is carried by
// shape, outline, numbers and arrows - the one accent colour is always paired with a shape
// (the thick arrowheaded swipe stroke, the plus-topped value arrow), never colour alone.

import { BOARDS } from './boards.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** A five point star as a points string, for the "score needed" badge (shape + number,
 *  never colour alone). */
function star(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 ? r * 0.45 : r;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(1)},${(cy + rad * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

/** The whole sheet body. `t` is ui.js's makeT instance. */
export function howToMarkup(t) {
  // The real unlock target, read off the machine list so the picture stays true when the
  // second machine ships. Until one exists, the 450 from boards.js's own template comment.
  const next = BOARDS.find((b) => b && b.unlock);
  const score = next ? next.unlock.score : 450;
  return `
    <figure class="sk-ht-fig">
      ${svgSwipe(t)}
      <figcaption class="sk-ht-caption sk-ht-line">${esc(t('ht_swipe'))}</figcaption>
    </figure>
    <figure class="sk-ht-fig">${svgHoles(t)}</figure>
    <figure class="sk-ht-fig">
      ${svgBalls(t)}
      <figcaption class="sk-ht-caption sk-ht-line">${esc(t('ht_balls'))}</figcaption>
    </figure>
    <figure class="sk-ht-fig">${svgUnlock(t, score)}</figure>`;
}

/* Panel 1: the lane in perspective, the ball, a fingertip, one thick upward arrow with
 * motion dashes either side. */
function svgSwipe(t) {
  return `
    <svg class="sk-ht-img" viewBox="0 0 280 104" role="img" aria-label="${esc(t('ht_a_swipe'))}">
      <path class="sk-hd-line" d="M92 100 L118 8"/>
      <path class="sk-hd-line" d="M188 100 L162 8"/>
      <path class="sk-hd-soft" d="M118 8 L162 8"/>
      <circle class="sk-hd-line" cx="140" cy="72" r="10"/>
      <path class="sk-hd-swipe" d="M140 58 L140 20"/>
      <path class="sk-hd-swipe" d="M128 31 L140 19 L152 31"/>
      <path class="sk-hd-dash" d="M122 54 L122 34"/>
      <path class="sk-hd-dash" d="M158 54 L158 34"/>
      <circle class="sk-hd-fill" cx="140" cy="90" r="5"/>
      <path class="sk-hd-line" d="M130 100 Q140 90 150 100"/>
    </svg>`;
}

/* Panel 2: the board face, values sitting in their own holes, an up arrow capped with a plus
 * outside the frame edge. The two 100s wear a double ring (shape marks the special holes). */
function svgHoles(t) {
  return `
    <svg class="sk-ht-img" viewBox="0 0 280 122" role="img" aria-label="${esc(t('ht_a_holes'))}">
      <path class="sk-hd-line" d="M84 116 L84 42 Q84 12 140 12 Q196 12 196 42 L196 116 Z"/>
      <circle class="sk-hd-line" cx="140" cy="94" r="15"/>
      <circle class="sk-hd-line" cx="140" cy="66" r="12.5"/>
      <circle class="sk-hd-line" cx="140" cy="42" r="10.5"/>
      <circle class="sk-hd-line" cx="140" cy="22" r="9"/>
      <circle class="sk-hd-line" cx="106" cy="30" r="8.5"/>
      <circle class="sk-hd-line" cx="106" cy="30" r="5.2"/>
      <circle class="sk-hd-line" cx="174" cy="30" r="8.5"/>
      <circle class="sk-hd-line" cx="174" cy="30" r="5.2"/>
      <g class="sk-hd-num">
        <text x="140" y="97">20</text>
        <text x="140" y="69">30</text>
        <text x="140" y="45">40</text>
        <text x="140" y="25">50</text>
        <text class="sk-hd-num-sm" x="106" y="32.5">100</text>
        <text class="sk-hd-num-sm" x="174" y="32.5">100</text>
      </g>
      <path class="sk-hd-swipe" d="M218 104 L218 34"/>
      <path class="sk-hd-swipe" d="M209 43 L218 33 L227 43"/>
      <path class="sk-hd-line" d="M212 18 L224 18 M218 12 L218 24"/>
    </svg>`;
}

/* Panel 3: the ball tray holding exactly nine balls. The caption carries the "per game". */
function svgBalls(t) {
  const balls = Array.from({ length: 9 }, (_, i) =>
    `<circle class="sk-hd-line" cx="${32 + i * 27}" cy="36" r="11"/>`).join('');
  return `
    <svg class="sk-ht-img" viewBox="0 0 280 62" role="img" aria-label="${esc(t('ht_a_balls'))}">
      <path class="sk-hd-soft" d="M14 16 L14 52 L266 52 L266 16"/>
      ${balls}
    </svg>`;
}

/* Panel 4: machine 1 (solid) shows a starred score on its backglass; an arrow leads to
 * machine 2 drawn dashed under a padlock wearing the same starred score as its tag. */
function svgUnlock(t, score) {
  const cab = (x, cls) => `
    <path class="${cls}" d="M${x} 100 L${x} 46 Q${x} 28 ${x + 40} 28 Q${x + 80} 28 ${x + 80} 46 L${x + 80} 100 Z"/>`;
  return `
    <svg class="sk-ht-img" viewBox="0 0 280 108" role="img" aria-label="${esc(t('ht_a_unlock', { score }))}">
      ${cab(22, 'sk-hd-line')}
      <polygon class="sk-hd-line" points="${star(62, 52, 11)}"/>
      <text class="sk-hd-score" x="62" y="84">${score}</text>
      <path class="sk-hd-swipe" d="M112 64 L164 64"/>
      <path class="sk-hd-swipe" d="M154 54 L166 64 L154 74"/>
      ${cab(178, 'sk-hd-locked')}
      <path class="sk-hd-lock" d="M204 56 L204 46 Q204 34 218 34 Q232 34 232 46 L232 56"/>
      <rect class="sk-hd-lockbody" x="198" y="56" width="40" height="30" rx="5"/>
      <circle class="sk-hd-fill" cx="218" cy="67" r="3.5"/>
      <path class="sk-hd-line" d="M218 70 L218 77"/>
      <polygon class="sk-hd-line" points="${star(203, 97, 6)}"/>
      <text class="sk-hd-score" x="226" y="101">${score}</text>
    </svg>`;
}

export default { howToMarkup };
