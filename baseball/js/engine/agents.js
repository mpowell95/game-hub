// agents.js : the pluggable decision-makers. `game.js` awaits `agent.decidePitch(view)` for the
// team on defense and `agent.decideSwing(view)` for the team at bat; it legalizes/validates
// whatever comes back the same way Escoba's `Game.legalize()` never trusts an agent blindly (see
// escoba/js/game.js). Every agent here is synchronous under the hood but returns a Promise, so a
// future human-driven agent (resolving on a UI tap) can share the exact same call shape with no
// change to game.js.
//
// DETERMINISM: every agent below draws its randomness from `view.rand01`, the SAME seeded stream
// game.js itself advances and snapshots (see rng.js's `stepRng`). An agent that reached for
// Math.random would make two runs of an identical seed diverge the moment it acted.

import { CPU, unlockedPitchesFor } from './settings.js';
import { ZONE } from './pitch.js';

/** A CPU pitcher. Picks from whatever pitches are unlocked for its league (and, for a player's own
 *  career opponent, their World Series titles - CPU rosters never carry titles, doc §8: "CPU stats
 *  do not track or react to your stats", so `wsTitles` is always 0 for a CPU pitcher). Aims loosely
 *  at the zone's edges more often than its center. */
export class CpuPitcher {
  constructor({ league, settings }) {
    this.league = league;
    this.settings = settings;
  }
  async decidePitch(view) {
    const unlocked = unlockedPitchesFor(this.league, 0);
    const type = unlocked[Math.floor(view.rand01() * unlocked.length)];
    const zone = this.settings.ZONE || ZONE;
    const halfWidth = zone.xMax; // zone is symmetric about 0
    // Aim inside the zone about 65% of the time, clearly outside it the rest - a CPU that never
    // misses off the plate would give away every take decision for free. 1.7 puts most of that
    // uniform spread genuinely outside the zone edge (rather than merely nudging up against it).
    const inZoneBias = view.rand01() < 0.65 ? 0.55 : 1.7;
    const aimX = (view.rand01() * 2 - 1) * halfWidth * inZoneBias;
    return { type, aim: aimX };
  }
}

/** A CPU batter. Swings at strikes at its league's `swingIn` rate and chases pitches outside the
 *  zone at its `chase` rate (both doc §14, [Tested] at the college tier, copied elsewhere as a
 *  placeholder - see settings.js's CPU table). Times its swing with a Gaussian error of
 *  `timingSigmaMs`, and aims the bat near the pitch's own lateral position with some miss-read
 *  governed by `guess` (how much it leans toward a real read of your last few pitches - not yet
 *  wired to `view.pitchHistory`; the seam exists, using it is Open item 3). Sees the already-
 *  thrown pitch on `view.pitch`, same as a human agent would. */
export class CpuBatter {
  constructor({ league, skills, settings }) {
    this.league = league;
    this.skills = skills;
    this.settings = settings;
  }
  async decideSwing(view) {
    const cpu = this.settings.CPU[this.league] || CPU.college;
    const pitch = view.pitch;

    const swingChance = pitch.isStrike ? cpu.swingIn : cpu.chase;
    if (view.rand01() >= swingChance) return { action: 'take' };

    const timingErrorMs = gaussianLite(view.rand01) * cpu.timingSigmaMs;
    const readNoise = (1 - cpu.guess) * 0.3;
    const aimX = pitch.x + (view.rand01() * 2 - 1) * readNoise;
    // The CPU never charges its swing this phase - doc's charge mechanic is a held-input UI
    // concern (§12), and no CPU tuning field here says how often a CPU would choose to charge.
    return { action: 'swing', aimX, timingErrorMs, charged: false };
  }
}

/** A cheap four-draw approximation of a standard normal (Irwin-Hall(4), mean 0, sd ~= 0.577),
 *  used so CpuBatter's timing error does not need rng.js's full Box-Muller `gaussian` (which
 *  wants an rng OBJECT, not a bound rand01 callback) threaded through here. Always consumes
 *  exactly four draws from the stream, so its cost is fixed and its position in the RNG sequence
 *  is as predictable as any other draw. */
function gaussianLite(rand01) {
  return (rand01() + rand01() + rand01() + rand01() - 2) / Math.sqrt(4 / 12);
}

/** Replays a fixed, pre-recorded script of decisions - one per call, in order - for deterministic
 *  test scenarios that need to force an exact sequence of pitches/swings rather than let a CPU
 *  agent choose. Throws if asked for more decisions than the script provides, rather than
 *  silently falling back to something a test did not ask for. */
export class ScriptedAgent {
  constructor(pitchScript = [], swingScript = []) {
    this._pitches = pitchScript.slice();
    this._swings = swingScript.slice();
    this._pi = 0;
    this._si = 0;
  }
  async decidePitch() {
    if (this._pi >= this._pitches.length) throw new Error('ScriptedAgent: pitch script exhausted');
    return this._pitches[this._pi++];
  }
  async decideSwing() {
    if (this._si >= this._swings.length) throw new Error('ScriptedAgent: swing script exhausted');
    return this._swings[this._si++];
  }
}

export default { CpuPitcher, CpuBatter, ScriptedAgent };
