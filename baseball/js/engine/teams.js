// teams.js : deterministic team generation. Same (league, styleId) -> byte-identical team, on any
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
//
// Step 3 (phase 2): players carry no NAME (doc §9, [Locked]: "Players are shown by jersey number
// and position... No names" - phase 1's invented `nameFor()`/FIRST_NAMES/LAST_NAMES are gone) and
// `makeLeague()` builds the doc's fixed eight-team, one-style-each league (§9), ordered weakest to
// strongest (§8, [Locked]). `RULES_V` 2 -> 3 for this shape change.

import { hashSeed, mulberry32, pickWeighted } from './rng.js';
import { SKILL_IDS, CAPS, TEAM_STYLES, TEAM_STYLE_WEIGHTS, LEFTY_RATE, CPU_LEVEL_SHORTFALL,
  TEAM_LADDER_OFFSETS, LEAGUE_LADDER_STYLES } from './settings.js';

// doc §9: "9 distinct batters... lineup shaped like real baseball" - a real defensive alignment,
// slot 0 always the starting pitcher (unchanged from phase 1).
export const POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

function jerseyFor(rand01) {
  return 1 + Math.floor(rand01() * 99);
}

/** How far below the league's raw cap a CPU team is generated (doc §8). */
export function effectiveCapFor(league) {
  const cap = CAPS[league] != null ? CAPS[league] : CAPS.majors;
  const shortfall = CPU_LEVEL_SHORTFALL[league] || 0;
  return Math.max(1, cap - shortfall);
}

/** Deterministically build one player's six skill values from a style's relative weights, each
 *  bounded by `effectiveCap`. Draft [Open item 25]: the exact formula, not just the weights.
 *  `effectiveCap` can be fractional (CPU_LEVEL_SHORTFALL is per-skill and cumulative, e.g.
 *  College's 16.5) - skill VALUES stay integers regardless, so the bound is floored only for the
 *  clamp, never for the cap itself (which keeps its exact fractional value for the monotonicity
 *  check in `effectiveCapFor`). */
function allocateSkills(effectiveCap, style, rand01) {
  const skills = {};
  const capInt = Math.floor(effectiveCap);
  const meanWeight = SKILL_IDS.reduce((s, id) => s + (style[id] || 1), 0) / SKILL_IDS.length;
  for (const id of SKILL_IDS) {
    const w = (style[id] || 1) / meanWeight;
    const raw = effectiveCap * 0.5 * w * (0.7 + rand01() * 0.6);
    skills[id] = Math.max(0, Math.min(capInt, Math.round(raw)));
  }
  return skills;
}

/** Shared by `makeTeam` and `makeLeague`: build one full roster (9 players, jersey+position, a
 *  batting order) from an already-resolved styleId and an already-seeded `rand01`. `effectiveCap`
 *  is explicit (BB-2a step 5) rather than always re-derived from `effectiveCapFor(league)` - a
 *  `makeLeague` slot's own ladder-offset cap differs from the league's single "expected level"
 *  number `makeTeam` still uses for an ungraded team. */
function buildRoster(league, styleId, rand01, opts, effectiveCap) {
  const size = opts.size || 9;
  const style = TEAM_STYLES[styleId];

  const players = [];
  for (let i = 0; i < size; i++) {
    const bats = rand01() < LEFTY_RATE ? 'L' : 'R';
    const throwsArm = rand01() < LEFTY_RATE ? 'L' : 'R';
    players.push({
      id: `p${i}`,
      jersey: jerseyFor(rand01),
      pos: POSITIONS[i] || POSITIONS[POSITIONS.length - 1],
      bats,
      throws: throwsArm,
      skills: allocateSkills(effectiveCap, style, rand01),
    });
  }

  const pitcherIndex = 0; // roster slot 0 is always the starting pitcher this phase
  return {
    name: opts.name || `${league}-${styleId}`,
    league,
    styleId,
    players,
    battingOrder: players.map((p) => p.id),
    pitcherId: players[pitcherIndex].id,
  };
}

/**
 * Build one full team.
 * @param {string} league - a LEAGUES id
 * @param {number|string} index - which team within the league/season this is (varies the seed);
 *   also accepted as a styleId string directly (see `opts.styleId`) for `makeLeague`'s own use.
 * @param {object} [opts]
 * @param {string} [opts.name] - display name; a generated placeholder if omitted
 * @param {number} [opts.size] - roster size, default 9 (no bench this phase)
 * @param {string} [opts.styleId] - force a specific TEAM_STYLES id rather than drawing one
 */
export function makeTeam(league, index, opts = {}) {
  const seed = hashSeed('bb-team', league, index);
  const rand01 = mulberry32(seed);

  let styleId = opts.styleId;
  if (!styleId) {
    const styleWeights = TEAM_STYLE_WEIGHTS[league] || TEAM_STYLE_WEIGHTS.majors;
    const styleIds = Object.keys(styleWeights);
    styleId = pickWeighted(rand01, styleIds, styleIds.map((id) => styleWeights[id]));
  }
  return buildRoster(league, styleId, rand01, opts, effectiveCapFor(league));
}

/** doc §9, [Locked]: 8 teams per league, each with a DISTINCT style, "the same players every
 *  time." Every league offers exactly the eight named `TEAM_STYLES`, one team each, ordered
 *  weakest to strongest (doc §8, [Locked]: "the 8 teams are ordered weakest to strongest, and the
 *  schedule puts harder opponents later").
 *
 *  BB-2a step 5: strength now comes from `TEAM_LADDER_OFFSETS` (eight per-slot skill-point
 *  offsets around `effectiveCapFor(league)`) applied by SLOT, never from a post-hoc sort by
 *  measured `teamStrength()` - a style's own flavor (TEAM_STYLES) no longer has to double as its
 *  strength, so the tuner (`sim-baseball.mjs --styles --tune`) can bring every style's win rate
 *  close to `balanced` without fighting the ladder order. `LEAGUE_LADDER_STYLES[league]` says
 *  which style occupies which slot; slot order IS the returned array order. Fixed forever per
 *  (league, styleId) seed - never per position in the array - so editing the ladder-style TABLE
 *  cannot silently reseed a team that keeps the same style. */
export function makeLeague(league) {
  const order = LEAGUE_LADDER_STYLES[league] || LEAGUE_LADDER_STYLES.majors;
  const baseCap = effectiveCapFor(league);
  const rawCap = CAPS[league] != null ? CAPS[league] : CAPS.majors;
  const teams = order.map((styleId, slot) => {
    const seed = hashSeed('bb-league', league, styleId);
    const slotCap = Math.max(1, Math.min(rawCap, baseCap + (TEAM_LADDER_OFFSETS[slot] || 0)));
    return buildRoster(league, styleId, mulberry32(seed), { name: `${league}-${styleId}` }, slotCap);
  });
  return teams;
}

/** doc §6, [Locked]: "One player who is all 9: always bats and always pitches." Nine copies of the
 *  same skills/hand, one per position, so the batting order and the pitcher slot both resolve to a
 *  real roster entry the same way a CPU team's do - no special-casing needed anywhere `game.js`
 *  reads `team.players`/`team.pitcherId`. */
export function makePlayerTeam({ skills, hand }) {
  const players = POSITIONS.map((pos, i) => ({
    id: `p${i}`,
    jersey: i + 1,
    pos,
    bats: hand,
    throws: hand,
    skills: { ...skills },
  }));
  return {
    name: 'You',
    league: null,
    styleId: null,
    players,
    battingOrder: players.map((p) => p.id),
    pitcherId: players[0].id,
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

export default { makeTeam, makeLeague, makePlayerTeam, teamStrength, effectiveCapFor, POSITIONS };
