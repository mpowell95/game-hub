// test-game-conventions.mjs - the conventions a new game must follow, made MACHINE-CHECKABLE.
//
// Why this exists (2026-08-02). The root CLAUDE.md has had an "Adding a game" checklist for
// months, and games kept being built that missed parts of it. The trigger was Hill Climb: it
// shipped with `window.addEventListener('resize', ...)` on the same day that pattern was removed
// from every other game for being a mobile scroll-jank bug. That was nobody's mistake - the game
// was written in a parallel session, and the convention lived in `js/CLAUDE.md`, which only
// auto-loads for a session working inside `js/`. A session creating `newgame/` never saw it.
//
// The lesson generalises past that one rule: a convention that lives only in prose is advice, and
// advice loses to a session that never loaded the file. A convention that fails a test is a rule.
// So every check here is one a reviewer would otherwise have to remember, and every one of them
// has been violated at least once by a real session.
//
// Each check names the rule, the fix, and where the reasoning is written down - a failure should
// be actionable without going and reading three other files first.
//
// Run: node test-game-conventions.mjs   (also wired into run-all-tests.mjs)

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));

// KNOWN GAPS - pre-existing debt this suite found when it was adopted, too big to fix in the same
// change that added the check. Listed here so the RULE still applies to every new game while the
// exception stays visible: each one is printed on every run as outstanding work, never silently
// skipped. Removing an entry is the definition of done for that item.
//
// The rule for adding to this list: only real, already-shipped debt, never a new game taking a
// shortcut. If you are about to add a game you just wrote to this list, fix the game instead.
// The i18n check that first populated this list is EMPTY now: Yahtzee was the last entry and the
// last untranslated in-hub game (2026-08-11); every in-hub game routes its strings through a
// { en, es } dictionary. A stale entry fails this suite, so leaving Yahtzee listed after
// translating it would have gone red.
//
// The font-size check (added when docs/BUILDING-A-GAME.md's UX floor was written) starts with
// real pre-existing debt, named down to the exact declaration rather than excused by whole game -
// a game-level key would silently excuse every future sub-11px rule in that game too.
const KNOWN_GAPS = {
  'no CSS font-size under 11px (docs/BUILDING-A-GAME.md, "The UX floor")': {
    'boggle/css/boggle.css:106': 'score summary micro-label, pre-existing',
    'boggle/css/boggle.css:242': 'tally count micro-label, pre-existing',
    'chinchon/css/chinchon.css:646': 'stats chart axis label, pre-existing',
    'escoba/css/escoba.css:314': 'card badge, pre-existing',
    'escoba/css/escoba.css:677': 'stats chart axis label, pre-existing',
    'filler/css/filler.css:247': 'pre-existing',
    'filler/css/filler.css:290': 'pre-existing',
    'mancala/css/mancala.css:284': 'pre-existing',
    'mancala/css/mancala.css:868': 'pit-count micro-label, pre-existing',
    'mancala/css/mancala.css:876': 'pit-count micro-label, pre-existing',
    'nuts-bolts/css/nuts-bolts.css:186': 'pre-existing',
    'yahtzee/css/yahtzee.css:575': 'scorecard micro-label, pre-existing',
    'yahtzee/css/yahtzee.css:583': 'scorecard micro-label, pre-existing',
    'yahtzee/css/yahtzee.css:594': 'bonus label, pre-existing',
    'yahtzee/css/yahtzee.css:595': 'bonus value, pre-existing',
    'yahtzee/css/yahtzee.css:597': 'pre-existing',
    'yahtzee/css/yahtzee.css:623': 'pre-existing',
    'yahtzee/css/yahtzee.css:628': 'pre-existing',
    'yahtzee/css/yahtzee.css:635': 'pre-existing',
    'yahtzee/css/yahtzee.css:652': 'help-tip text, pre-existing',
    'yahtzee/css/yahtzee.css:659': 'help-tip text, pre-existing',
    'yahtzee/css/yahtzee.css:702': 'pre-existing',
  },
};

let passed = 0;
const failures = [];
const gapsHit = [];

function check(label, offenders, fix) {
  const gaps = KNOWN_GAPS[label] || {};
  const excused = [];
  const real = offenders.filter((o) => {
    const key = Object.keys(gaps).find((g) => String(o).startsWith(`${g}/`) || String(o).startsWith(`${g} `));
    if (key) { excused.push(`${o}  (known gap: ${gaps[key]})`); return false; }
    return true;
  });
  gapsHit.push(...excused);

  if (!real.length) {
    passed++;
    console.log(`ok    ${label}${excused.length ? `   [${excused.length} known gap(s), see below]` : ''}`);
    return;
  }
  failures.push(label);
  console.log(`FAIL  ${label}`);
  for (const o of real) console.log(`        ${o}`);
  console.log(`      -> ${fix}`);
}

// --- which folders are games ------------------------------------------------------------------
// Anything with an index.html AND a js/ui.js. Deliberately discovered from disk rather than
// listed here, so a NEW game is covered the day it appears - a hardcoded list would have to be
// updated by the very session most likely to forget.

const EXCLUDED = {
  // Global-JS app with its own nested service worker and its own page; it predates the module
  // contract and is a documented, bounded exception (root CLAUDE.md, "Monopoly Deal naming").
  'business-deal': 'non-ESM launch-out app with its own nested SW',
};

const GAMES = readdirSync(ROOT)
  .filter((d) => { try { return statSync(join(ROOT, d)).isDirectory(); } catch { return false; } })
  .filter((d) => existsSync(join(ROOT, d, 'index.html')) && existsSync(join(ROOT, d, 'js', 'ui.js')))
  .filter((d) => !EXCLUDED[d])
  .sort();

if (GAMES.length < 10) {
  console.log(`FAIL: only found ${GAMES.length} game folders - the discovery rule is broken`);
  process.exit(1);
}
console.log(`Checking ${GAMES.length} game folders: ${GAMES.join(', ')}`);
console.log(`(skipped: ${Object.entries(EXCLUDED).map(([k, v]) => `${k} - ${v}`).join('; ')})\n`);

/** Every .js file a game owns. */
function gameJs(game) {
  const dir = join(ROOT, game, 'js');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ path: `${game}/js/${f}`, src: readFileSync(join(dir, f), 'utf8') }));
}

/** Strip // and /* *\/ comments so a rule NAMED in a comment can't trip its own check. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// --- 1. viewport ------------------------------------------------------------------------------

check(
  'no game subscribes to resize/orientationchange directly (js/viewport.js owns that)',
  GAMES.flatMap((g) => gameJs(g)
    .filter(({ src }) => /addEventListener\(\s*['"](?:resize|orientationchange)['"]/.test(stripComments(src)))
    .map(({ path }) => path)),
  'use `onViewportResize(cb)` from js/viewport.js and call its unsubscribe in destroy(). A raw '
  + 'listener re-lays-out the board several times per FRAME while a mobile URL bar animates, '
  + 'because the browser fires resize continuously during that. See js/viewport.js\'s header.'
);

check(
  'no game subscribes to visualViewport directly (onViewportResize already folds it in)',
  GAMES.flatMap((g) => gameJs(g)
    .filter(({ src }) => /visualViewport\s*(?:\.|\?\.)\s*addEventListener/.test(stripComments(src)))
    .map(({ path }) => path)),
  'onViewportResize already subscribes to visualViewport and coalesces it with the other two '
  + 'sources into one per-frame callback.'
);

// --- 2. touch ---------------------------------------------------------------------------------

check(
  'no game puts a touchmove listener on document or window',
  GAMES.flatMap((g) => gameJs(g)
    .filter(({ src }) => /(?:document|window)\.addEventListener\(\s*['"]touchmove['"]/.test(stripComments(src)))
    .map(({ path }) => path)),
  'bind it to the game\'s own root element. A non-passive touchmove on document tells the browser '
  + 'ANY touch scroll might be cancelled, so compositor-thread scrolling is off for the whole page '
  + 'for as long as the game is mounted. A touchmove is dispatched at the element the touch STARTED '
  + 'on and bubbles, so root-scoping loses no coverage. See snake/CLAUDE.md.'
);

// --- 3. scroll containment --------------------------------------------------------------------
// A position:fixed element that scrolls, sitting over the scrollable hub, chains its scroll into
// the page behind it unless it says otherwise. Checked across real .css files AND the CSS that
// leaderboard-ui.js / game-stats-ui.js inject as strings.

function fixedScrollersMissingContainment(src, label) {
  const out = [];
  // Rule bodies: `<selector> { ... }`. Good enough for this codebase's flat, hand-written CSS.
  for (const m of src.matchAll(/([.#][\w-][^{}]{0,120}?)\{([^{}]*)\}/g)) {
    const [, selector, body] = m;
    const flat = body.replace(/\s+/g, '');
    const isFixed = /position:fixed/.test(flat);
    const scrolls = /overflow(-y)?:(auto|scroll)/.test(flat);
    const contained = /overscroll-behavior(-y)?:(contain|none)/.test(flat);
    if (isFixed && scrolls && !contained) out.push(`${label}  ${selector.trim().slice(0, 60)}`);
  }
  return out;
}

const cssOffenders = [];
for (const g of GAMES) {
  const cssDir = join(ROOT, g, 'css');
  if (!existsSync(cssDir)) continue;
  for (const f of readdirSync(cssDir).filter((x) => x.endsWith('.css'))) {
    cssOffenders.push(...fixedScrollersMissingContainment(readFileSync(join(cssDir, f), 'utf8'), `${g}/css/${f}`));
  }
}
for (const f of ['css/hub.css', 'css/ui.css', 'css/name-gate.css', 'css/challenge.css',
                 'js/leaderboard-ui.js', 'js/game-stats-ui.js',
                 // The two overlays added with Report a bug (2026-08-11). They build on css/ui.css's
                 // .gh-overlay/.gh-modal, which are already contained, but their own injected blocks
                 // add scrolling regions of their own (the inbox's JSON pane) and are checked here
                 // for the same reason the other two injected sheets are.
                 'js/bug-report-ui.js', 'js/announce-ui.js']) {
  cssOffenders.push(...fixedScrollersMissingContainment(readFileSync(join(ROOT, f), 'utf8'), f));
}

check(
  'every full-screen scrolling overlay contains its scroll',
  cssOffenders,
  'add `overscroll-behavior: contain`. Without it a flick that reaches the end of the overlay '
  + 'keeps going and scrolls the launcher underneath it, so closing the overlay lands the player '
  + 'somewhere they never chose. See js/CLAUDE.md, "Overlay scrolling".'
);

// --- 4. the standalone page is a door into the hub --------------------------------------------

check(
  'every standalone game page gates on the name before it mounts',
  GAMES.filter((g) => !/requireName/.test(readFileSync(join(ROOT, g, 'index.html'), 'utf8')))
    .map((g) => `${g}/index.html`),
  'add the `import { requireName } from \'../js/name-gate.js\'; await requireName();` block BEFORE '
  + 'init() - copy it from any existing game. Ungated standalone pages are exactly where the '
  + 'leaderboard\'s ~20 permanent "Unnamed player" rows came from (js/CLAUDE.md, "Nameless devices").'
);

// --- 5. the module contract --------------------------------------------------------------------

check(
  'every game module exports init / destroy / isInProgress',
  GAMES.flatMap((g) => {
    const src = readFileSync(join(ROOT, g, 'js', 'ui.js'), 'utf8');
    return ['init', 'destroy', 'isInProgress']
      .filter((fn) => !new RegExp(`export\\s+(?:async\\s+)?function\\s+${fn}\\b`).test(src)
                   && !new RegExp(`export\\s*\\{[^}]*\\b${fn}\\b`).test(src))
      .map((fn) => `${g}/js/ui.js  missing export: ${fn}`);
  }),
  'the hub mounts with init(el) and tears down with destroy(); isInProgress() gates the '
  + '"leave game?" confirm. See "The module contract" in the root CLAUDE.md.'
);

check(
  'every game cleans up the document/window listeners it adds',
  GAMES.filter((g) => {
    const src = stripComments(readFileSync(join(ROOT, g, 'js', 'ui.js'), 'utf8'));
    const added = (src.match(/(?:document|window)\.addEventListener/g) || []).length;
    const removed = (src.match(/(?:document|window)\.removeEventListener/g) || []).length;
    return added > removed;
  }).map((g) => `${g}/js/ui.js`),
  'destroy() must remove every document/window listener - the hub reuses the same container for '
  + 'the next game, so a leaked listener keeps firing over an unrelated game.'
);

// --- 6. every game is documented ---------------------------------------------------------------

check(
  'every game folder has its own CLAUDE.md',
  GAMES.filter((g) => !existsSync(join(ROOT, g, 'CLAUDE.md'))).map((g) => `${g}/CLAUDE.md`),
  'THE LAW rule 9: a milestone is not done until CLAUDE.md reflects it. Game-specific detail goes '
  + 'in the game\'s own file (auto-loaded when a session works in that folder), not the root.'
);

check(
  'every game routes its strings through a { en, es } dictionary',
  GAMES.filter((g) => existsSync(join(ROOT, g, 'js', 'strings.js'))
    ? false
    : !/from '\.\.\/\.\.\/[\w-]+\/js\/strings\.js'|from '\.\/strings\.js'/.test(readFileSync(join(ROOT, g, 'js', 'ui.js'), 'utf8')))
    .map((g) => `${g}/js/strings.js`),
  'the hub is bilingual (js/i18n.js). Export { en, es }, build `const t = makeT(STRINGS)`, and call '
  + 't() at RENDER time, never at module scope. snake/js/strings.js is the reference.'
);

// --- a decoration class must never share a name with a structural one ---------------------------
//
// Battleship shipped a `.bs-shell` that was the game's ROOT LAYOUT CONTAINER (max-width, display:
// grid - every screen renders into it) and, 150 lines later, a SECOND `.bs-shell` meaning the
// flying artillery shell, with a travel animation whose last keyframe is `opacity: 0` and a
// `@media (prefers-reduced-motion: reduce)` rule setting `display: none !important`.
//
// Both rules applied to the layout container. The game faded its entire UI to nothing on the first
// shot, and for anyone with Reduce Motion turned on it was `display: none` from the very first
// paint: a blank screen with no error, no failing test, and a DOM full of perfectly correct HTML.
// It reached the live site twice. Every existing check here passed the whole time, because nothing
// in this suite - or in any node suite - looks at whether a game is VISIBLE.
//
// This is the cheap, headless half of that lesson: a class that decoration hides or fades must not
// also be a class that lays the game out. It would have caught the bug at the moment it was typed.

// `margin` alone is too weak - a toast that fades in from opacity 0 has margins and is meant to
// be hidden. A LAYOUT CONTAINER is the combination: a width constraint AND a layout display.
const LAYOUT_PROPS = /max-width\s*:/;
const LAYOUT_DISPLAY = /display\s*:\s*(?:grid|flex)/;
const HIDDEN_PROPS = /(?:display\s*:\s*none|opacity\s*:\s*0(?:\.0+)?\s*(?:!important)?\s*[;}])/;

/** Classes on the rule's SUBJECT - the last compound in each comma-separated selector - not on its
 *  ancestors. `.cc-root [hidden]` hides the [hidden] element, and saying it hides `.cc-root` would
 *  flag every game in the repo; `.dm-root .dm-mat::before` is about `.dm-mat`, not `.dm-root`. */
function classesIn(selectorText) {
  const out = [];
  for (const part of selectorText.split(',')) {
    const compound = part.trim().split(/[\s>+~]+/).pop() || '';
    for (const m of compound.matchAll(/\.([a-zA-Z][\w-]*)/g)) out.push(m[1]);
  }
  return out;
}
/** Every rule in `css` as { sel, body }, flat (nested @media bodies included). */
function rules(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sel = m[1].trim();
    if (sel.startsWith('@') || /^\d/.test(sel) || /^(from|to)$/.test(sel)) continue;  // at-rules, keyframe stops
    out.push({ sel, body: m[2] });
  }
  return out;
}

const collisions = [];
for (const game of GAMES) {
  const dir = join(ROOT, game, 'css');
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.css'))) {
    const css = readFileSync(join(dir, file), 'utf8');
    const structural = new Set();
    const hidden = new Map();
    for (const { sel, body } of rules(css)) {
      const cls = classesIn(sel);
      // An absolutely/fixed positioned element is out of flow by definition, so it is never the
      // thing screens render INTO. That is what separates a toast (max-width, display:flex,
      // opacity:0 by design, position:absolute) from a real layout container.
      const inFlow = !/position\s*:\s*(?:absolute|fixed)/.test(body);
      if (inFlow && LAYOUT_PROPS.test(body) && LAYOUT_DISPLAY.test(body)) for (const c of cls) structural.add(c);
      if (HIDDEN_PROPS.test(body)) for (const c of cls) if (!hidden.has(c)) hidden.set(c, sel);
    }
    for (const [c, sel] of hidden) {
      if (structural.has(c)) collisions.push(`${game}/css/${file}: .${c} is a layout class AND is hidden by "${sel}"`);
    }
  }
}
check(
  'no class is both a layout container and something decoration hides',
  collisions,
  'a decoration rule (display:none, opacity:0, a fade-out animation) landing on the element every '
  + 'screen renders into makes the whole game invisible with no error and no failing test - exactly '
  + 'how Battleship shipped a blank screen twice. Give the ornament its own name (.xx-ordnance, not '
  + '.xx-shell) and keep decoration and layout in separate namespaces.'
);

// --- text stays readable: no CSS font-size under 11px -------------------------------------------
// docs/BUILDING-A-GAME.md, "Part 0 - The UX floor" - born from the 2026-08-21 Skeeball playtest.

function gameCss(game) {
  const dir = join(ROOT, game, 'css');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => ({ path: `${game}/css/${f}`, src: readFileSync(join(dir, f), 'utf8') }));
}

check(
  'no CSS font-size under 11px (docs/BUILDING-A-GAME.md, "The UX floor")',
  GAMES.flatMap((g) => gameCss(g).flatMap(({ path, src }) => {
    const offenders = [];
    src.split('\n').forEach((line, i) => {
      const decls = line.match(/font-size:\s*[\d.]+px/g) || [];
      for (const decl of decls) {
        if (parseFloat(decl.match(/[\d.]+/)[0]) < 11) offenders.push(`${path}:${i + 1} ${decl.trim()}`);
      }
    });
    return offenders;
  })),
  'text under 11px is not comfortably readable on a phone. Raise it, or if this is a genuinely '
  + 'decorative micro-label with no reading purpose, say so and add it to KNOWN_GAPS by the exact '
  + 'file:line, not by whole game (a game-level exemption excuses every future violation too).'
);

// --- summary ------------------------------------------------------------------------------------

console.log(`\nGame convention checks: ${passed} passed, ${failures.length} failed.`);

if (gapsHit.length) {
  console.log(`\nKnown gaps still outstanding (${gapsHit.length}) - these do NOT fail the suite, but they are real work:`);
  for (const g of gapsHit) console.log(`  - ${g}`);
}

// A stale excuse is worse than no excuse: it silently exempts a game that was fixed years ago.
const stale = [];
for (const [label, gaps] of Object.entries(KNOWN_GAPS)) {
  for (const game of Object.keys(gaps)) {
    if (!gapsHit.some((g) => g.startsWith(`${game}/`) || g.startsWith(`${game} `))) {
      stale.push(`${game} is listed under "${label}" but no longer violates it - delete the entry`);
    }
  }
}
if (stale.length) {
  console.log('\nFAIL  KNOWN_GAPS is out of date:');
  for (const s of stale) console.log(`        ${s}`);
  failures.push('KNOWN_GAPS is out of date');
}

if (failures.length) { console.log('\nFailed:'); for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
