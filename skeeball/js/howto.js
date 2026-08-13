// skeeball/js/howto.js - the How To Play sheet's content. Follows the repo-wide pattern
// (tic-tac-toe/CLAUDE.md, "How-to-play screens", the reference the root file names): one short
// bold sentence, ONE diagram carrying the genuinely non-obvious mechanic, a caption, an
// "X = Y" example, then the remaining rules as short plain sentences.
//
// What a player already knows: what skeeball is. What they genuinely do not know, and cannot see
// until they have wasted balls learning it: SWIPE POWER IS AIM IN DEPTH - the arc climbs the
// rings to the 50 and then keeps going, so harder is only better up to a point, and the 100s are
// a sideways skill shot, not a power shot. That is a picture: three arcs, side on.
//
// The diagram reads through shape and numbered markers, never colour alone (the hub's
// colourblind rule): each arc has its own dash pattern AND its own numbered circle.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The whole sheet body. `t` is ui.js's makeT instance. */
export function howToMarkup(t) {
  return `
    <p class="sk-help-lead">${esc(t('help_lead'))}</p>
    <div class="sk-help-diagram-wrap">${diagram(t)}</div>
    <p class="sk-help-caption">${esc(t('help_caption'))}</p>
    <p class="sk-help-example">${esc(t('help_ex'))}</p>
    <p class="sk-help-rule">${esc(t('help_rule1'))}</p>
    <p class="sk-help-rule">${esc(t('help_rule2'))}</p>
    <p class="sk-help-rule">${esc(t('help_rule3'))}</p>`;
}

/** Side view: the lane, the hump, the tilted ring face - and three arcs. 1 soft (dies in the
 *  pit), 2 smooth (drops into the rings), 3 hard (sails long past the 50). */
function diagram(t) {
  const key = (n, k) => `<span class="sk-help-key-item"><i>${n}</i>${esc(t(k))}</span>`;
  return `
    <svg class="sk-help-diagram" viewBox="0 0 240 120" role="img" aria-label="${esc(t('help_diagram_aria'))}">
      <!-- lane bed and hump, side on -->
      <path class="sk-dg-lane" d="M8 100 L150 100 Q168 100 172 88 L174 82"/>
      <!-- the pit -->
      <path class="sk-dg-pit" d="M174 82 L178 108 L196 108"/>
      <!-- the tilted face with the ring mouths as notches -->
      <path class="sk-dg-face" d="M196 108 L228 30"/>
      <g class="sk-dg-holes">
        <circle cx="203" cy="91" r="3"/>
        <circle cx="209" cy="76" r="3"/>
        <circle cx="215" cy="61" r="3"/>
        <circle cx="221" cy="46" r="3"/>
      </g>
      <!-- the ball at the start -->
      <circle class="sk-dg-ball" cx="26" cy="95" r="5"/>
      <!-- 1: soft, dies in the pit -->
      <path class="sk-dg-arc sk-dg-arc-1" d="M32 95 L150 95 Q170 92 176 86 Q182 92 184 104"/>
      <!-- 2: smooth, into the middle rings -->
      <path class="sk-dg-arc sk-dg-arc-2" d="M32 92 L146 92 Q176 84 190 62 Q202 48 213 58"/>
      <!-- 3: hard, long over the 50 -->
      <path class="sk-dg-arc sk-dg-arc-3" d="M32 89 L142 89 Q180 78 200 40 Q212 24 224 34"/>
      <g class="sk-dg-num">
        <circle cx="184" cy="112" r="8"/><text x="184" y="115.5">1</text>
        <circle cx="196" cy="52" r="8"/><text x="196" y="55.5">2</text>
        <circle cx="214" cy="24" r="8"/><text x="214" y="27.5">3</text>
      </g>
    </svg>
    <p class="sk-help-key">${key(1, 'help_k1')}${key(2, 'help_k2')}${key(3, 'help_k3')}</p>`;
}

export default { howToMarkup };
