// skeeball/js/howto.js - the How To Play sheet's content. Rebuilt 2026-08-13 to the repo-wide
// pattern EXACTLY as written (tic-tac-toe/CLAUDE.md, "How-to-play screens", the reference the
// root file names - the previous version of this file was thrown out on Matt's instruction):
//
//   1. One short bold sentence stating the goal.
//   2. ONE small SVG diagram of the one genuinely non-obvious mechanic. Here that mechanic is
//      SWIPE STRENGTH = LANDING HEIGHT: everyone knows what skeeball is; what they cannot know
//      until they waste balls is that the cups are aimed at in DEPTH, with power.
//   3. A caption stating the rule in plain words.
//   4. A concrete one-line example in X = Y form.
//   5. The remaining edge cases, each one plain sentence.
//
// Whole-screen rules from the same pattern: every text line fits ONE row (ui.js measures the
// rendered lines and sizes them down before locking nowrap - see _fitHelpLines), spacing is one
// flex column with a fixed gap, and the diagram reads through shape, numbers and arrows, never
// colour alone (three arcs with distinct dash patterns AND numbered markers).

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The whole sheet body. `t` is ui.js's makeT instance. */
export function howToMarkup(t) {
  return `
    <p class="sk-ht-goal sk-ht-line">${esc(t('ht_goal'))}</p>
    <div class="sk-ht-diagram-wrap">${diagram(t)}</div>
    <p class="sk-ht-caption sk-ht-line">${esc(t('ht_caption'))}</p>
    <p class="sk-ht-ex sk-ht-line">${esc(t('ht_ex'))}</p>
    <p class="sk-ht-rule sk-ht-line">${esc(t('ht_r1'))}</p>
    <p class="sk-ht-rule sk-ht-line">${esc(t('ht_r2'))}</p>
    <p class="sk-ht-rule sk-ht-line">${esc(t('ht_r3'))}</p>`;
}

/** Side view, drawn once and simply: the lane, the hump, the board as one slope carrying the
 *  cup mouths (20 low to 50 high, the 100 tube at the top), and THREE swipe arcs - 1 gentle
 *  lands low, 2 half lands in the 50, 3 full sails past everything. Dash pattern + numbered
 *  circle tell the arcs apart; the mouths are notches with their values underneath. */
function diagram(t) {
  const key = (n, k) => `<span class="sk-ht-key-item"><i>${n}</i>${esc(t(`ht_k${n}`))}</span>`;
  return `
    <svg class="sk-ht-diagram" viewBox="0 0 280 130" role="img" aria-label="${esc(t('ht_aria'))}">
      <!-- lane and hump -->
      <path class="sk-dg-lane" d="M10 112 L96 112 Q116 112 121 100"/>
      <!-- the board: one gentle slope -->
      <path class="sk-dg-board" d="M132 116 L268 44"/>
      <!-- cup mouths as notches on the slope, values under each -->
      <g class="sk-dg-mouths">
        <ellipse cx="163" cy="99" rx="9" ry="3.4"/>
        <ellipse cx="192" cy="84" rx="9" ry="3.4"/>
        <ellipse cx="220" cy="69" rx="9" ry="3.4"/>
        <ellipse cx="247" cy="55" rx="9" ry="3.4"/>
      </g>
      <g class="sk-dg-vals">
        <text x="163" y="115">20</text>
        <text x="192" y="100">30</text>
        <text x="220" y="85">40</text>
        <text x="247" y="71">50</text>
      </g>
      <!-- the ball, waiting -->
      <circle class="sk-dg-ball" cx="22" cy="106" r="6"/>
      <!-- three arcs: gentle / half / full -->
      <path class="sk-dg-arc sk-dg-arc-1" d="M30 104 Q90 96 122 96 Q146 96 158 96"/>
      <path class="sk-dg-arc sk-dg-arc-2" d="M30 100 Q130 26 210 36 Q234 40 244 50"/>
      <path class="sk-dg-arc sk-dg-arc-3" d="M30 95 Q130 18 200 20 Q240 22 262 40"/>
      <g class="sk-dg-num">
        <circle cx="150" cy="96" r="9"/><text x="150" y="100">1</text>
        <circle cx="150" cy="46" r="9"/><text x="150" y="50">2</text>
        <circle cx="205" cy="20" r="9"/><text x="205" y="24">3</text>
      </g>
    </svg>
    <p class="sk-ht-key">${key(1)}${key(2)}${key(3)}</p>`;
}

export default { howToMarkup };
