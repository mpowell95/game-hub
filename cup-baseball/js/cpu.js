// cup-baseball/js/cpu.js - THE COMPUTER. Pure: no DOM, no engine.
//
// Cup Pong's computer aims (cup-pong/js/cpu.js aimAt: the same launch, angle, gravity and drag as
// the physics) and adds Gaussian error; only the target choice and the sigmas are this game's.
// The throw goes through the same physics as the player's, so a computer hit is a real hit.
// Sigmas tuned with `node cup-baseball/js/test.js --cpu`; the rates are in cup-baseball/CLAUDE.md.

import { aimAt } from '../../cup-pong/js/cpu.js';
import { CUPS } from './field.js';

export const SKILL = {
  easy:   { sPower: 0.16, sAim: 0.068 },
  medium: { sPower: 0.10, sAim: 0.040 },
  hard:   { sPower: 0.06, sAim: 0.024 },
};

/** How often each skill goes for each cup (single, double, triple, home run). A good player swings
 *  for the fences more; nobody only ever throws at one cup. */
const AIM_MIX = {
  easy:   [0.40, 0.30, 0.20, 0.10],
  medium: [0.30, 0.30, 0.25, 0.15],
  hard:   [0.25, 0.25, 0.25, 0.25],
};

function gauss(rnd) {
  const u = Math.max(1e-9, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Pick a cup and a throw at it. `rnd` is a uniform [0, 1) source. */
export function cpuThrow(skill, rnd = Math.random) {
  const S = SKILL[skill] || SKILL.medium;
  const mix = AIM_MIX[skill] || AIM_MIX.medium;
  let r = rnd(), i = 0;
  while (i < 3 && r >= mix[i]) { r -= mix[i]; i++; }
  const target = CUPS.find((c) => c.hit === i + 1);
  const t = aimAt(target.x, target.z);
  return { power: t.power + gauss(rnd) * S.sPower, aim: t.aim + gauss(rnd) * S.sAim, target: target.id };
}

export default { SKILL, cpuThrow };
