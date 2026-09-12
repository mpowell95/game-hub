// teams.js : deterministic team generation. Same (league, index) -> byte-identical team, on any
// device, every run - the same "emit the documented shape from a seed and nothing else" contract
// golf/js/holegen.js's header describes for hole generation, applied here to rosters.
//
// CPU teams are generated at the league's cap MINUS its CPU_LEVEL_SHORTFALL (doc §8, [Locked]:
// "generated at the player's expected level... not at the raw league cap. Generating at the cap
// would leave the CPU 9 to 11 points above the player from College up, which contradicts
// 'difficulty comes from behavior, not bigger stats'"). The exact per-skill allocation FORMULA
// below (how a style's weights turn into six skill values under that ceiling) is not given by the
// doc at all - Draft [Open item 25], the same tag TEAM_STYLES/TEAM_STYLE_WEIGHTS carry in
// settings.js, since a style's numeric weights are equally undecided there.

import { hashSeed, mulberry32, pickWeighted } from './rng.js';
import { SKILL_IDS, CAPS, TEAM_STYLES, TEAM_STYLE_WEIGHTS, LEFTY_RATE, CPU_LEVEL_SHORTFALL } from './settings.js';

function nameFor(rand01) {
  const first = FIRST_NAMES[Math.floor(rand01() * FIRST_NAMES.length)];
  const last = LAST_NAMES[Math.floor(rand01() * LAST_NAMES.length)];
  return `${first} ${last}`;
}

const FIRST_NAMES = ['Alex', 'Sam', 'Jordan', 'Casey', 'Morgan', 'Riley', 'Drew', 'Jamie', 'Quinn',
  'Reese', 'Avery', 'Rowan', 'Blair', 'Dana', 'Kai', 'Emerson', 'Finley', 'Harper', 'Skyler', 'Toby'];
const LAST_NAMES = ['Rivera', 'Chen', 'Okafor', 'Novak', 'Hartley', 'Dubois', 'Kowalski', 'Silva',
  'Nakamura', 'Petrov', 'Fontaine', 'Delgado', 'Whitfield', 'Osei', 'Larsen', 'Mercer', 'Vance',
  'Iyer', 'Boone', 'Castellan'];

/** How far below the league's raw cap a CPU team is generated (doc §8). */
export function effectiveCapFor(league) {
  const cap = CAPS[league] != null ? CAPS[league] : CAPS.majors;
  const shortfall = CPU_LEVEL_SHORTFALL[league] || 0;
  return Math.max(1, cap - shortfall);
}

/** Deterministically build one player's six skill values from a style's relative weights, each
 *  bounded by `effectiveCap`. Draft [Open item 25]: the exact formula, not just the weights. */
function allocateSkills(effectiveCap, style, rand01) {
  const skills = {};
  const meanWeight = SKILL_IDS.reduce((s, id) => s + (style[id] || 1), 0) / SKILL_IDS.length;
  for (const id of SKILL_IDS) {
    const w = (style[id] || 1) / meanWeight;
    const raw = effectiveCap * 0.5 * w * (0.7 + rand01() * 0.6);
    skills[id] = Math.max(0, Math.min(effectiveCap, Math.round(raw)));
  }
  return skills;
}

/**
 * Build one full team: a roster of `size` players and a batting order (all `size` ids, in order).
 * @param {string} league - a LEAGUES id
 * @param {number} index - which team within the league/season this is (varies the seed)
 * @param {object} [opts]
 * @param {string} [opts.name] - display name; a generated placeholder if omitted
 * @param {number} [opts.size] - roster size, default 9 (no bench this phase)
 */
export function makeTeam(league, index, opts = {}) {
  const size = opts.size || 9;
  const seed = hashSeed('bb-team', league, index);
  const rand01 = mulberry32(seed);

  const styleWeights = TEAM_STYLE_WEIGHTS[league] || TEAM_STYLE_WEIGHTS.majors;
  const styleIds = Object.keys(styleWeights);
  const styleId = pickWeighted(rand01, styleIds, styleIds.map((id) => styleWeights[id]));
  const style = TEAM_STYLES[styleId];

  const effectiveCap = effectiveCapFor(league);

  const players = [];
  for (let i = 0; i < size; i++) {
    const bats = rand01() < LEFTY_RATE ? 'L' : 'R';
    const throwsArm = rand01() < LEFTY_RATE ? 'L' : 'R';
    players.push({
      id: `p${i}`,
      name: nameFor(rand01),
      bats,
      throws: throwsArm,
      skills: allocateSkills(effectiveCap, style, rand01),
    });
  }

  const pitcherIndex = 0; // roster slot 0 is always the starting pitcher this phase
  return {
    name: opts.name || `${league}-${index}`,
    league,
    styleId,
    players,
    battingOrder: players.map((p) => p.id),
    pitcherId: players[pitcherIndex].id,
  };
}

/** Aggregate team strength: mean of each skill across the roster, 0..effectiveCapFor(team.league).
 *  Useful as a single sortable number (e.g. seeding a season bracket) without re-deriving it
 *  elsewhere. */
export function teamStrength(team) {
  const totals = {};
  SKILL_IDS.forEach((id) => { totals[id] = 0; });
  for (const p of team.players) {
    for (const id of SKILL_IDS) totals[id] += p.skills[id] || 0;
  }
  const n = team.players.length || 1;
  const means = {};
  let sum = 0;
  for (const id of SKILL_IDS) { means[id] = totals[id] / n; sum += means[id]; }
  return { means, overall: sum / SKILL_IDS.length };
}

export default { makeTeam, teamStrength, effectiveCapFor };
