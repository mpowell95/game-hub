// agents.js : the pluggable decision-makers. `game.js` awaits `agent.decidePitch(view)` for the
// team on defense and `agent.decideSwing(view)` for the team at bat; it legalizes/validates
// whatever comes back the same way Escoba's `Game.legalize()` never trusts an agent blindly (see
// escoba/js/game.js). Every agent here is synchronous under the hood but returns a Promise, so a
// future human-driven agent (resolving on a UI tap) can share the exact same call shape with no
// change to game.js.
//
// DETERMINISM: every agent below draws its randomness from `view.rand01`, the SAME seeded stream
// game.js itself advances and snapshots (see rng.js's `stepRng`). An agent that reached for
// Math.random would make two runs of an identical seed diverge the moment it acted - which is
// exactly the "seeded RNG only" constraint this phase is built to satisfy structurally, not just
// by convention.

import { CPU } from './settings.js';
import { ZONE } from './pitch.js';

/** A CPU pitcher. Picks from whatever pitches are unlocked for its league, aiming loosely at the
 *  zone's edges more often than its center (a CPU that always aims dead center would be trivially
 *  easy to read). */
export class CpuPitcher {
  constructor({ league, settings }) {
    this.league = league;
    this.settings = settings;
  }
  async decidePitch(view) {
    const unlocked = this.settings.PITCH_UNLOCKS[this.league] || this.settings.PITCH_UNLOCKS.majors;
    const type = unlocked[Math.floor(view.rand01() * unlocked.length)];
    const zone = this.settings.ZONE || ZONE;
    const cx = (zone.xMin + zone.xMax) / 2;
    const cz = (zone.zMin + zone.zMax) / 2;
    const spreadX = (zone.xMax - zone.xMin) / 2;
    const spreadZ = (zone.zMax - zone.zMin) / 2;
    // Aim inside the zone about 65% of the time, clearly outside it the rest - a CPU that never
    // misses off the plate would give away every take decision for free. 1.7 puts most of that
    // uniform spread genuinely outside the zone edges (rather than merely nudging up against
    // them), which is what makes "take" a real decision rather than a near-certain strike anyway.
    const inZoneBias = view.rand01() < 0.65 ? 0.55 : 1.7;
    const aim = {
      x: cx + (view.rand01() * 2 - 1) * spreadX * inZoneBias,
      z: cz + (view.rand01() * 2 - 1) * spreadZ * inZoneBias,
    };
    return { type, aim };
  }
}

/** A CPU batter. Swings more often at pitches it reads as strikes, and more often as its league's
 *  swing discipline rises; times its swing with an error that shrinks as its own contact skill
 *  rises. Sees the already-thrown pitch on `view.pitch`, same as a human agent would. */
export class CpuBatter {
  constructor({ league, skills, settings }) {
    this.league = league;
    this.skills = skills;
    this.settings = settings;
  }
  async decideSwing(view) {
    const cpu = this.settings.CPU[this.league] || CPU.majors;
    const pitch = view.pitch;
    const zone = this.settings.ZONE || ZONE;
    const inZone = pitch.x >= zone.xMin && pitch.x <= zone.xMax && pitch.z >= zone.zMin && pitch.z <= zone.zMax;
    const swingChance = inZone
      ? 0.55 + cpu.swingDiscipline * 0.35
      : 0.10 + (1 - cpu.swingDiscipline) * 0.20;
    if (view.rand01() >= swingChance) return { action: 'take' };

    const contactPts = Math.max(0, Math.min(this.settings.CAPS.perSkill, this.skills.contact || 0));
    const skillFrac = contactPts / this.settings.CAPS.perSkill;
    const timingSpreadMs = 160 * (1 - cpu.contactSkill * 0.5) * (1 - skillFrac * 0.3);
    const timingErrorMs = (view.rand01() * 2 - 1) * timingSpreadMs;
    const power = 0.45 + view.rand01() * 0.35;
    return { action: 'swing', timingErrorMs, power };
  }
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
