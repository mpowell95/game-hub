// skeeball/js/engines.js - ONE ENGINE PER MACHINE, and the map from a board id to its own.
//
// GUARD: A MACHINE OWNS ITS ENGINE. THERE IS NO SHARED ONE, ON PURPOSE.
//
// Until 2026-08-23 all three machines ran one `physics.js`, one `machine.js` and one `render.js`
// - 2,330 lines - with per-machine behaviour expressed as branches (`cupBoard`, `collarH`,
// `cups`). Every one of those branches was a place a change made for one machine reached another,
// and one of them shipped: 28299ac, written for HOT SHOT, rewrote the capture rule "on every
// machine" and changed 456 of 861 throws on THE CLASSIC three days after it went live. Matt pulled
// Skeeball from the hub over it, and his instruction was exact: each machine starts as a COPY of
// the classic's files, and an edit for one machine applies only to that machine.
//
// So the isolation is the FILESYSTEM, not a flag and not a test you have to remember to run.
// Editing skeeball/js/machines/popongo/physics.js cannot reach the classic, because the classic
// does not load that file. There is nothing to gate and nothing to get wrong.
//
// THE COST, ACCEPTED: a genuine engine bug is fixed once per machine that has it, and the copies
// drift. The drift is the point - these are different machines. When you fix something real,
// say in the commit which machines you applied it to and which you deliberately did not.
//
// --- LOADED ON DEMAND, NOT UP FRONT (2026-09-01) ------------------------------------------------
//
// THE BUG THIS FIXES. This file used to `import` all five machines' three files STATICALLY, so
// tapping the Skeeball tile pulled the whole lot down before the gallery could paint: 41 module
// files, 2,318 KB, against 988 KB for the next heaviest game in the hub and ~328 KB for the
// median one. Anita's screen recording (2026-09-01) is what it looks like on a phone - a launch
// that renders the gallery as raw unstyled HTML for half a second, and the app relaunching itself
// underneath her a few seconds later.
//
// Almost none of it was needed. The gallery draws ONE machine picture at a time (ui.js's
// renderMachineImage), so it needs one machine's `render.js` + `machine.js` + three.js. It does
// not need the other four machines (~640 KB), and it does not need cannon-es (338 KB) until a
// ball is actually thrown. Measured with the same module-graph walk:
//
//     as shipped                                  41 files, 2318 KB
//     only the machine being shown                29 files, 1677 KB
//     ... and physics deferred until Play         27 files, 1309 KB
//
// So: `loadEngine(id)` is the way in, and it is async. `engineFor(id)` stays synchronous for the
// hot paths that cannot await (game.js's per-step physics calls, ui.js's renderer construction)
// and THROWS if that machine has not been loaded yet.
//
// GUARD: A MISSING ENGINE THROWS, IT DOES NOT FALL BACK. `engineFor` still substitutes THE
// CLASSIC for an UNKNOWN board id (a machine whose folder was never added) exactly as it always
// did - but "known machine, not loaded yet" is a caller bug, and answering it with the classic's
// physics would run one machine's numbers under another machine's name. That is the precise
// failure this whole split exists to prevent, so it is loud instead.
//
// ADDING A MACHINE: copy skeeball/js/machines/classic/ to machines/<id>/, add the three files to
// sw.js's ASSETS, add one row to LOADERS below, and add the boards.js entry. Nothing else changes.

/** The three files of each machine, as thunks.
 *
 *  GUARD: EVERY PATH IS A LITERAL. A computed `import(`./machines/${id}/render.js`)` would work in
 *  this repo (no build step, raw ES modules over HTTP) but it would make these files invisible to
 *  a grep for who loads them - and `sw.js`'s ASSETS list, `validate-sw-assets.mjs` and every
 *  machine test are all maintained by hand from exactly that kind of search. */
const LOADERS = {
  classic: {
    physics: () => import('./machines/classic/physics.js'),
    machine: () => import('./machines/classic/machine.js'),
    render: () => import('./machines/classic/render.js'),
  },
  popongo: {
    physics: () => import('./machines/popongo/physics.js'),
    machine: () => import('./machines/popongo/machine.js'),
    render: () => import('./machines/popongo/render.js'),
  },
  basketball: {
    physics: () => import('./machines/basketball/physics.js'),
    machine: () => import('./machines/basketball/machine.js'),
    render: () => import('./machines/basketball/render.js'),
  },
  brickcity: {
    physics: () => import('./machines/brickcity/physics.js'),
    machine: () => import('./machines/brickcity/machine.js'),
    render: () => import('./machines/brickcity/render.js'),
  },
  // THE TUNING TWIN (2026-09-05) shares BRICK CITY's engine on purpose - see boards.js. It is the
  // same machine with one control-curve number changed, so giving it its own folder would be a
  // second copy of an engine to keep in step, which is the exact drift the HARD RULE is about.
  // A board id with no row here falls back to THE CLASSIC's engine, which would silently be the
  // wrong machine; this row is what stops that.
  'brickcity-tune': {
    physics: () => import('./machines/brickcity/physics.js'),
    machine: () => import('./machines/brickcity/machine.js'),
    render: () => import('./machines/brickcity/render.js'),
  },
  runaway: {
    physics: () => import('./machines/runaway/physics.js'),
    machine: () => import('./machines/runaway/machine.js'),
    render: () => import('./machines/runaway/render.js'),
  },
};

/** Every machine that has an engine here. `boards.js` is the data; this is the code. */
export const ENGINE_IDS = Object.keys(LOADERS);

/** id -> { physics|null, buildMachine, Renderer }. One entry per machine, built once. */
const LOADED = new Map();
/** id + tier -> the in-flight promise, so two carousel cards asking at once share one download. */
const INFLIGHT = new Map();

/** The board id whose engine we will actually use: itself, or THE CLASSIC's if it has no folder. */
function resolveId(boardId) {
  if (Object.prototype.hasOwnProperty.call(LOADERS, boardId)) return boardId;
  console.error(`[skeeball] no engine for board '${boardId}' - falling back to the classic's. `
    + `Add skeeball/js/machines/${boardId}/ and a row in skeeball/js/engines.js.`);
  return 'classic';
}

async function build(id, wantPhysics) {
  const L = LOADERS[id];
  // render.js imports machine.js itself, so the two arrive together; physics.js is the separable
  // half and is the whole reason cannon-es exists in the graph.
  const [render, machine, physics] = await Promise.all([
    L.render(), L.machine(), wantPhysics ? L.physics() : null,
  ]);
  const prev = LOADED.get(id);
  const engine = {
    buildMachine: machine.buildMachine,
    Renderer: render.Renderer,
    // Never DROP a physics module we already have: a later render-only load of the same machine
    // must not un-load the half a live rack is stepping through.
    physics: physics || (prev && prev.physics) || null,
  };
  LOADED.set(id, engine);
  return engine;
}

/**
 * Load one machine's engine, and resolve to it. Idempotent and safe to call on every render.
 *
 * `{ physics: false }` loads only what DRAWS the machine (its `render.js` + `machine.js`), which
 * is all the gallery's picture and the how-to card need. The default loads physics too, and is
 * what a rack needs - `game.js` steps it every frame.
 */
export async function loadEngine(boardId, { physics = true } = {}) {
  const id = resolveId(boardId);
  const have = LOADED.get(id);
  if (have && (!physics || have.physics)) return have;
  const key = `${id}:${physics ? 'p' : 'r'}`;
  let job = INFLIGHT.get(key);
  if (!job) {
    job = build(id, physics);
    INFLIGHT.set(key, job);
    job.catch(() => { /* surfaced at the caller's await; this only clears the slot */ })
      .then(() => INFLIGHT.delete(key));
  }
  return job;
}

/** True once `loadEngine(boardId)` has finished for that machine. */
export function engineReady(boardId, { physics = true } = {}) {
  const e = LOADED.get(resolveId(boardId));
  return !!e && (!physics || !!e.physics);
}

/**
 * The engine belonging to one board id: { physics, buildMachine, Renderer }.
 *
 * SYNCHRONOUS on purpose - game.js calls it inside the physics step and ui.js inside a rAF, and
 * neither can await. THROWS if that machine has not been loaded yet; see the guard at the top of
 * this file for why that is not a fallback.
 *
 * `{ physics: true }` additionally asserts that the SIMULATION half is loaded, not just the
 * drawing half. Worth spelling out at the call site: a render-only engine's `.physics` is null,
 * and `null.startThrow` in the middle of a rack is a much worse error message than this one.
 */
export function engineFor(boardId, { physics = false } = {}) {
  const id = resolveId(boardId);
  const e = LOADED.get(id);
  if (!e) {
    throw new Error(`[skeeball] engine '${id}' is not loaded - await loadEngine('${id}') first.`);
  }
  if (physics && !e.physics) {
    throw new Error(`[skeeball] engine '${id}' was loaded without physics - `
      + `await loadEngine('${id}') (the default) before throwing a ball.`);
  }
  return e;
}

export default { engineFor, loadEngine, engineReady, ENGINE_IDS };
