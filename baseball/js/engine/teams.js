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
  TEAM_LADDER_OFFSETS, LEAGUE_LADDER_STYLES, STYLE_STRENGTH_DELTA, SIGMA_MS_PER_WINRATE_PP, CHASE_PER_WINRATE_PP,
  CPU_SIGMA_MIN_MS, CPU_SIGMA_ABSOLUTE_FLOOR_MS, SLOT_SIGMA_DESCENT,
  CPU_ROSTER_LEVEL, CPU_ROSTER_CEILING, slotsForLeague } from './settings.js';

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
function allocateSkills(scale, style, rand01, ceiling) {
  const skills = {};
  const capInt = Math.floor(ceiling);
  const meanWeight = SKILL_IDS.reduce((s, id) => s + (style[id] || 1), 0) / SKILL_IDS.length;
  for (const id of SKILL_IDS) {
    const w = (style[id] || 1) / meanWeight;
    const raw = scale * w * (0.7 + rand01() * 0.6);
    skills[id] = Math.max(0, Math.min(capInt, Math.round(raw)));
  }
  return skills;
}

// ---------------------------------------------------------------------------------------------
// R16 (docs/BASEBALL-3D-BUILD.md section 9): THE LITERAL 0.5 IS GONE.
//
// `allocateSkills` used to draw each value around `effectiveCap * 0.5` - half the level doc §8
// says a CPU team is generated at - so every CPU roster in the game sat at half its stated
// strength (measured league means 2.9 / 5.4 / 7.5 / 8.9 / 9.9 against a career player arriving
// with 5 / 10 / 14 / 18 / 22 per skill). The scale is now SOLVED from `CPU_ROSTER_LEVEL`, the
// league's own target mean, so the table in settings.js says what it means.
//
// Solved rather than assigned, because the ceiling clamp is not neutral: at the Minors nearly
// every drawn value lands on `CPU_ROSTER_CEILING`, so a roster drawn AROUND 21 realises about
// 19.4. `expectedClamped` is the closed form of E[min(m * U, C)] for the same U(0.7, 1.3) draw
// `allocateSkills` takes, and `rosterScaleFor` bisects the one league-wide scale whose realised
// mean - over all eight slots and all six of each style's own skill weights - is the table's
// number. Pure, deterministic, memoized per league; rounding is the only thing it does not model.
const SCALE_SPREAD_LO = 0.7;
const SCALE_SPREAD_HI = 1.3;

function expectedClamped(m, ceiling) {
  if (m <= 0) return 0;
  if (m * SCALE_SPREAD_HI <= ceiling) return m * (SCALE_SPREAD_LO + SCALE_SPREAD_HI) / 2;
  if (m * SCALE_SPREAD_LO >= ceiling) return ceiling;
  const uStar = ceiling / m;
  const area = m * (uStar * uStar - SCALE_SPREAD_LO * SCALE_SPREAD_LO) / 2
    + ceiling * (SCALE_SPREAD_HI - uStar);
  return area / (SCALE_SPREAD_HI - SCALE_SPREAD_LO);
}

/** The eight slots' relative skill weights, normalized to a mean of 1 - `TEAM_LADDER_OFFSETS`'
 *  own `skill` offsets, unchanged, so the ladder's shape survives the rescale exactly. */
function slotSkillWeights(league) {
  const offsets = TEAM_LADDER_OFFSETS[league] || TEAM_LADDER_OFFSETS.majors;
  const raw = offsets.map((o) => Math.max(0.05, 1 + ((o && o.skill) || 0)));
  const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
  return raw.map((r) => r / mean);
}

/** Every per-skill style weight in the league, one per (slot, skill) pair - the exact set
 *  `allocateSkills` will multiply the scale by. */
function styleWeightsFor(league) {
  const order = LEAGUE_LADDER_STYLES[league] || LEAGUE_LADDER_STYLES.majors;
  return order.map((styleId) => {
    const style = TEAM_STYLES[styleId];
    const meanWeight = SKILL_IDS.reduce((s2, id) => s2 + (style[id] || 1), 0) / SKILL_IDS.length;
    return SKILL_IDS.map((id) => (style[id] || 1) / meanWeight);
  });
}

const ROSTER_SCALE_CACHE = new Map();
/** The league-wide draw scale whose realised roster mean is `CPU_ROSTER_LEVEL[league]`. */
export function rosterScaleFor(league) {
  if (ROSTER_SCALE_CACHE.has(league)) return ROSTER_SCALE_CACHE.get(league);
  const target = CPU_ROSTER_LEVEL[league] != null ? CPU_ROSTER_LEVEL[league] : CPU_ROSTER_LEVEL.majors;
  const ceiling = rosterCeilingFor(league);
  const slotW = slotSkillWeights(league);
  const styleW = styleWeightsFor(league);
  const realised = (scale) => {
    let sum = 0, n = 0;
    for (let slot = 0; slot < slotW.length; slot++) {
      const ws = styleW[slot] || styleW[0];
      for (const w of ws) { sum += expectedClamped(scale * slotW[slot] * w, ceiling); n += 1; }
    }
    return n ? sum / n : 0;
  };
  // THE BOUND MATTERS, and it is not a safety net: a target that EQUALS the ceiling (the Minors
  // row, 21.0 against a ceiling of 21) can only be realised by pinning every single drawn value
  // on the ceiling, which would flatten `TEAM_LADDER_OFFSETS` at that league entirely - the
  // champion and the weakest team identical on every skill. `ceiling / SCALE_SPREAD_LO` is the
  // scale at which a mean-weight draw is certainly at the ceiling; above it the table's number is
  // simply unreachable, and the ladder is worth more than the last half point of the mean. The
  // realised means this produces (measured, `node baseball/js/test.js`): 4.16 / 10.76 / 16.43 /
  // 20.23 / 22.30 - the Minors row is the one the bound binds.
  let lo = 0, hi = ceiling / SCALE_SPREAD_LO;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (realised(mid) < target) lo = mid; else hi = mid;
  }
  const scale = (lo + hi) / 2;
  ROSTER_SCALE_CACHE.set(league, scale);
  return scale;
}

/** The per-skill ceiling for a CPU roster (one point under the league's raw cap - see
 *  `CPU_ROSTER_CEILING`'s own comment in settings.js). */
export function rosterCeilingFor(league) {
  const c = CPU_ROSTER_CEILING[league];
  if (Number.isFinite(c) && c > 0) return c;
  const cap = CAPS[league] != null ? CAPS[league] : CAPS.majors;
  return Math.max(1, cap - 1);
}

/** Shared by `makeTeam` and `makeLeague`: build one full roster (9 players, jersey+position, a
 *  batting order) from an already-resolved styleId and an already-seeded `rand01`. `effectiveCap`
 *  is explicit (BB-2a step 5) rather than always re-derived from `effectiveCapFor(league)` - a
 *  `makeLeague` slot's own ladder-offset cap differs from the league's single "expected level"
 *  number `makeTeam` still uses for an ungraded team. */
function buildRoster(league, styleId, rand01, opts, scale, ceiling) {
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
      skills: allocateSkills(scale, style, rand01, ceiling),
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
  // R16: an ungraded team sits at the league's own roster level with no slot offset at all.
  return buildRoster(league, styleId, rand01, opts, rosterScaleFor(league), rosterCeilingFor(league));
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
// BB-2d commit 5: slots 0-4 keep the existing per-league CPU_SIGMA_MIN_MS floor; slots 5-7 descend
// linearly toward CPU_SIGMA_ABSOLUTE_FLOOR_MS (never below it) - see SLOT_SIGMA_DESCENT's own
// comment in settings.js. Resolved to an absolute ms number HERE, at roster-build time (this
// function already knows the slot and league), and attached onto `team.ladderOffset.sigmaFloorMs`
// so agents.js's `cpuSigmaFloorMs` can read one number without re-deriving the interpolation.
function slotSigmaFloorMs(league, slot) {
  const leagueMin = CPU_SIGMA_MIN_MS[league] != null ? CPU_SIGMA_MIN_MS[league] : CPU_SIGMA_ABSOLUTE_FLOOR_MS;
  const { bindThroughSlot, descentToSlot } = SLOT_SIGMA_DESCENT;
  if (slot <= bindThroughSlot) return leagueMin;
  const t = Math.min(1, (slot - bindThroughSlot) / (descentToSlot - bindThroughSlot));
  return leagueMin + (CPU_SIGMA_ABSOLUTE_FLOOR_MS - leagueMin) * t;
}

export function makeLeague(league) {
  const order = LEAGUE_LADDER_STYLES[league] || LEAGUE_LADDER_STYLES.majors;
  // R16: the ladder's own relative shape, and the league level it is scaled onto.
  const baseScale = rosterScaleFor(league);
  const ceiling = rosterCeilingFor(league);
  const slotW = slotSkillWeights(league);
  const teams = order.map((styleId, slot) => {
    const seed = hashSeed('bb-league', league, styleId);
    // BB-2b commit 3: TEAM_LADDER_OFFSETS entries are now `{ skill, timingSigmaMs, chase }` (BB-2d
    // commit 5 adds `behaviorMul`/`changeupShare`) - only `skill` feeds roster generation here,
    // exactly as the old bare-number offset did; the rest are attached directly onto the returned
    // team for `agents.js`'s `CpuBatter`/`CpuPitcher` to read (`ladderOffset`), since they are
    // BEHAVIOR knobs, not skill points.
    // BB-2e commit 2: TEAM_LADDER_OFFSETS is now PER-LEAGUE (generated from that league's own
    // LADDER_SHAPE) - indexed [league][slot], never a bare [slot].
    const leagueOffsets = TEAM_LADDER_OFFSETS[league] || TEAM_LADDER_OFFSETS.majors;
    const offsets = leagueOffsets[slot] || { skill: 0, timingSigmaMs: 0, chase: 0, behaviorMul: 1, changeupShare: 0 };
    // BB-2d commit 6: STYLE_STRENGTH_DELTA (measured by `sim-baseball.mjs --styles`, now against
    // the median HUMAN model per commit 2) no longer touches the skill cap at all - see this
    // constant's own settings.js comment for why. Converted instead through SIGMA_MS_PER_WINRATE_PP/
    // CHASE_PER_WINRATE_PP into ADDITIVE timingSigmaMs/chase offsets, stacked on TOP of the slot's
    // own TEAM_LADDER_OFFSETS values - a style's own measured behavioral edge (Shifters' shift,
    // Patient's chaseMul) is now paid for on the SAME axis TEAM_LADDER_OFFSETS itself uses, not by
    // weakening the roster. `LEAGUE_LADDER_STYLES`' own confirmed order still stays exactly as
    // Matt set it - a style keeps its slot, and its own measured delta pays for whatever
    // behavioral edge it carries, just on a different axis than before this commit.
    const styleDelta = STYLE_STRENGTH_DELTA[styleId] || 0;
    // R16: the slot's own share of the league's level (`slotSkillWeights` is TEAM_LADDER_OFFSETS'
    // `skill` column normalized to mean 1), and the ceiling that bounds every drawn value.
    const slotScale = Math.max(0.1, baseScale * (slotW[slot] != null ? slotW[slot] : 1));
    const team = buildRoster(league, styleId, mulberry32(seed), { name: `${league}-${styleId}` }, slotScale, ceiling);
    team.ladderSlot = slot;
    const styleDeltaPp = styleDelta * 100;
    team.ladderOffset = {
      timingSigmaMs: offsets.timingSigmaMs + styleDeltaPp * SIGMA_MS_PER_WINRATE_PP,
      chase: offsets.chase + styleDeltaPp * CHASE_PER_WINRATE_PP,
      behaviorMul: offsets.behaviorMul != null ? offsets.behaviorMul : 1,
      changeupShare: offsets.changeupShare || 0,
      sigmaFloorMs: slotSigmaFloorMs(league, slot),
    };
    return team;
  });
  return teams;
}

/** R16: the CPU teams a SEASON in `league` is actually played against - `makeLeague`'s eight
 *  filtered to `SEASON.leagueSlots[league]`, in the same weakest-to-strongest order (so the last
 *  entry is still the champion, which is what every "the championship opponent is the toughest
 *  team" rule in this engine indexes). All eight everywhere but Little League, which is a 4-team
 *  league (the player plus slots 1, 4 and 7). `makeLeague(league)` itself still returns eight and
 *  is untouched - a caller that wants the whole ladder (the tuner, the style sweeps) keeps it.
 *  `slots` may be passed explicitly, which is what `career.js` does with a season's own frozen
 *  snapshot so a deploy never reshapes a season in progress (THE LAW). */
export function leagueTeamsFor(league, slots) {
  const teams = makeLeague(league);
  const pick = Array.isArray(slots) && slots.length ? slots : slotsForLeague(league);
  const out = [];
  for (const i of pick) {
    const t = teams[i];
    if (t) out.push(t);
  }
  return out.length ? out : teams;
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

export default { makeTeam, makeLeague, leagueTeamsFor, makePlayerTeam, teamStrength, effectiveCapFor,
  rosterScaleFor, rosterCeilingFor, POSITIONS };
