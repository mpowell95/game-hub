// teams.js : deterministic team generation. Same (league, index) -> byte-identical team, on any
// device, every run - the same "emit the documented shape from a seed and nothing else" contract
// golf/js/holegen.js's header describes for hole generation, applied here to rosters.

import { hashSeed, mulberry32, pickWeighted } from './rng.js';
import { SKILL_IDS, CAPS, TEAM_STYLES, TEAM_STYLE_WEIGHTS, LEFTY_RATE, POINTS } from './settings.js';

const FIRST_NAMES = ['Alex', 'Sam', 'Jordan', 'Casey', 'Morgan', 'Riley', 'Drew', 'Jamie', 'Quinn',
  'Reese', 'Avery', 'Rowan', 'Blair', 'Dana', 'Kai', 'Emerson', 'Finley', 'Harper', 'Skyler', 'Toby'];
const LAST_NAMES = ['Rivera', 'Chen', 'Okafor', 'Novak', 'Hartley', 'Dubois', 'Kowalski', 'Silva',
  'Nakamura', 'Petrov', 'Fontaine', 'Delgado', 'Whitfield', 'Osei', 'Larsen', 'Mercer', 'Vance',
  'Iyer', 'Boone', 'Castellan'];

function nameFor(rand01) {
  const first = FIRST_NAMES[Math.floor(rand01() * FIRST_NAMES.length)];
  const last = LAST_NAMES[Math.floor(rand01() * LAST_NAMES.length)];
  return `${first} ${last}`;
}

/** Deterministically build one player's skill points from a style's relative weights, spending a
 *  fixed total point budget. Not exactly the budget by construction (rounding), always <= CAPS. */
function allocateSkills(budget, style, rand01) {
  const weights = SKILL_IDS.map((id) => (style[id] || 1) * (0.8 + rand01() * 0.4));
  const total = weights.reduce((a, b) => a + b, 0);
  const skills = {};
  let spent = 0;
  SKILL_IDS.forEach((id, i) => {
    const raw = Math.round((weights[i] / total) * budget);
    const val = Math.max(0, Math.min(CAPS.perSkill, raw));
    skills[id] = val;
    spent += val;
  });
  void spent;
  return skills;
}

/**
 * Build one full team: a roster of `size` players and a batting order (all `size` ids, in order).
 * @param {string} league - a LEAGUES id
 * @param {number} index - which team within the league/season this is (varies the seed)
 * @param {object} [opts]
 * @param {string} [opts.name] - display name; a generated placeholder if omitted
 * @param {number} [opts.size] - roster size, default 9 (no bench this phase)
 * @param {object} [settingsIn] - override settings module (tests only)
 */
export function makeTeam(league, index, opts = {}) {
  const size = opts.size || 9;
  const seed = hashSeed('bb-team', league, index);
  const rand01 = mulberry32(seed);

  const styleWeights = TEAM_STYLE_WEIGHTS[league] || TEAM_STYLE_WEIGHTS.majors;
  const styleIds = Object.keys(styleWeights);
  const styleId = pickWeighted(rand01, styleIds, styleIds.map((id) => styleWeights[id]));
  const style = TEAM_STYLES[styleId];

  const budget = POINTS[league] != null ? POINTS[league] : POINTS.majors;

  const players = [];
  for (let i = 0; i < size; i++) {
    const bats = rand01() < LEFTY_RATE ? 'L' : 'R';
    const throwsArm = rand01() < LEFTY_RATE ? 'L' : 'R';
    players.push({
      id: `p${i}`,
      name: nameFor(rand01),
      bats,
      throws: throwsArm,
      skills: allocateSkills(budget, style, rand01),
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

/** Aggregate team strength: mean of each skill across the roster, 0..CAPS.perSkill. Useful as a
 *  single sortable number (e.g. seeding a season bracket) without re-deriving it ad hoc elsewhere. */
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

export default { makeTeam, teamStrength };
