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
// ADDING A MACHINE: copy skeeball/js/machines/classic/ to machines/<id>/, add the three files to
// sw.js's ASSETS, add one row here, and add the boards.js entry. Nothing else changes.

import * as classicPhysics from './machines/classic/physics.js';
import { buildMachine as classicBuildMachine } from './machines/classic/machine.js';
import { Renderer as ClassicRenderer } from './machines/classic/render.js';

import * as popongoPhysics from './machines/popongo/physics.js';
import { buildMachine as popongoBuildMachine } from './machines/popongo/machine.js';
import { Renderer as PopongoRenderer } from './machines/popongo/render.js';

import * as basketballPhysics from './machines/basketball/physics.js';
import { buildMachine as basketballBuildMachine } from './machines/basketball/machine.js';
import { Renderer as BasketballRenderer } from './machines/basketball/render.js';

import * as brickcityPhysics from './machines/brickcity/physics.js';
import { buildMachine as brickcityBuildMachine } from './machines/brickcity/machine.js';
import { Renderer as BrickcityRenderer } from './machines/brickcity/render.js';

// HOT SHOT: RUNAWAY - the first machine in the repo with a MOVING PART. Its copy of the three
// files is the only one that knows what a mover is; the other four are untouched by it.
import * as runawayPhysics from './machines/runaway/physics.js';
import { buildMachine as runawayBuildMachine } from './machines/runaway/machine.js';
import { Renderer as RunawayRenderer } from './machines/runaway/render.js';

const ENGINES = {
  classic: { physics: classicPhysics, buildMachine: classicBuildMachine, Renderer: ClassicRenderer },
  popongo: { physics: popongoPhysics, buildMachine: popongoBuildMachine, Renderer: PopongoRenderer },
  basketball: { physics: basketballPhysics, buildMachine: basketballBuildMachine, Renderer: BasketballRenderer },
  brickcity: { physics: brickcityPhysics, buildMachine: brickcityBuildMachine, Renderer: BrickcityRenderer },
  runaway: { physics: runawayPhysics, buildMachine: runawayBuildMachine, Renderer: RunawayRenderer },
};

/** Every machine that has an engine here. `boards.js` is the data; this is the code. */
export const ENGINE_IDS = Object.keys(ENGINES);

/**
 * The engine belonging to one board id: { physics, buildMachine, Renderer }.
 *
 * GUARD: falls back to the classic's engine for an unknown id, and says so loudly. A machine whose
 * engine folder is missing would otherwise run the classic's physics under its own name and every
 * number measured on it would be a lie - the exact failure this whole split exists to prevent.
 */
export function engineFor(boardId) {
  const e = ENGINES[boardId];
  if (e) return e;
  console.error(`[skeeball] no engine for board '${boardId}' - falling back to the classic's. `
    + `Add skeeball/js/machines/${boardId}/ and a row in skeeball/js/engines.js.`);
  return ENGINES.classic;
}

export default { engineFor, ENGINE_IDS };
