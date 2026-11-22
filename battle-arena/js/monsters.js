// battle-arena/js/monsters.js - the roster, elements and unlock thresholds. Pure data, no DOM.
// Every creature, name and move here is our own (docs/BATTLE-ARENA-SPEC.md). Monster names are
// proper names, the same in every language; move names are translated in strings.js (sp_<id>).
//
// A special's numbers: dmg (to the other team), heal (own team, capped at max HP), shield,
// drain (energy taken from EACH enemy monster), rows (Scorch: clear the N rows with the most Fire
// gems), convert (N random gems become Leaf), freeze (the other side gets 1 move next turn),
// chain (energy to your other monster), curse ({ tick, turns }: tick damage at the start of each
// of their next `turns` turns), col (clear the N columns with the most of its element's gems),
// block (blast the N x N block with the most of them). Board clears charge the caster, as the
// reference's specials do (a column, a 2x2), which keeps cascades going.

export const ELEMENTS = ['fire', 'water', 'spark', 'leaf', 'shadow'];

/** Colour + shape per tile kind. Shape is the colourblind-safe signal; colour only reinforces it. */
export const ELEMENT_COLOR = {
  fire: '#E0532F', water: '#1F5FA8', spark: '#F2B705', leaf: '#2E9E44', shadow: '#7B4FC4',
  berry: '#A3203A', bomb: '#3A3F47', all: '#C9A2F0',
};

/** Rules version 4 (current, 2026-11-15): once-a-turn specials + calmer bombs (engine.js), retuned on every team vs every
 *  other (medium computer, 24 games a pairing): every monster 47-54% at every unlock stage, teams 40-66% (v3 under v4 rules:
 *  Thornpaw 26%, Hexowl 63%). Rules version 3: Version 2 (2026-11-14, Matt: "Yes rebalance them. At least reorder them weakest in the first batch, then better
 *  ones get unlocked"). Tuned on every 2-monster team against every other (8,910 medium + 5,940 hard computer matches):
 *  each monster now wins 45-55% of its matches (v1: 27-68%). Listed and unlocked weakest first; the order of the middle is
 *  within a point or two. Version 1's numbers are frozen below (V1) for every match started before. */
/** Starters cover ALL FIVE gem colours (2026-11-14, Matt: "NONE of the monsters use that other piece?"): weakest-first had left
 *  both shadow monsters locked, so a purple gem charged no starter. Hexowl (shadow) and Frostling (water) swapped places: Hexowl is
 *  a starter, Frostling opens at 10 wins. The two are within a point of each other under v3. Unlocks are not rules: no `rv`. */
/** NAMES (2026-11-15, Matt: "we might need to rename characters. Sproutle and mossback are good because they're easy to read and
 *  remember"; "do the name change"): only the shown names changed. The ids (and every stored match, save and stat) keep the first
 *  names: pebbleop = Lavapup/Lavatusk, prismote = Rainbit/Rainbeast, zapup = Sparkpup/Sparktail; Briarlord, Pyrovern, Glacielle,
 *  Thundrake, Blazelynx became Thornbear, Firedrake, Frostclaw, Thunderhorn, Blazecat. Never rename an id. */
export const MONSTERS = [
  { id: 'thornpaw', name: 'Thornpaw', evoName: 'Thornbear', el: 'leaf', cost: 6,
    sp: { dmg: 5, heal: 7, convert: 3 }, evo: { dmg: 8, heal: 11, convert: 4 } },
  { id: 'sproutle', name: 'Sproutle', evoName: 'Mossback', el: 'leaf', cost: 6,
    sp: { dmg: 10, heal: 5 }, evo: { dmg: 15, heal: 9 } },
  { id: 'driplet', name: 'Driplet', evoName: 'Tidefang', el: 'water', cost: 5,
    sp: { dmg: 14 }, evo: { dmg: 19 } },
  { id: 'cinderwing', name: 'Cinderwing', evoName: 'Firedrake', el: 'fire', cost: 8,
    sp: { dmg: 14, rows: 1 }, evo: { dmg: 18, rows: 2 } },
  { id: 'hexowl', name: 'Hexowl', evoName: 'Grimhoot', el: 'shadow', cost: 5,
    sp: { dmg: 6, curse: { tick: 5, turns: 2 } }, evo: { dmg: 11, curse: { tick: 5, turns: 3 } } },
  { id: 'stormhorn', name: 'Stormhorn', evoName: 'Thunderhorn', el: 'spark', cost: 5,
    sp: { dmg: 12, chain: 1 }, evo: { dmg: 18, chain: 2 } },

  { id: 'emberkit', name: 'Emberkit', evoName: 'Blazecat', el: 'fire', cost: 7, unlock: 3,
    sp: { dmg: 13, col: 1 }, evo: { dmg: 20, col: 2 } },
  { id: 'pebbleop', name: 'Lavapup', evoName: 'Lavatusk', el: 'fire', cost: 7, unlock: 6,
    sp: { dmg: 13, shield: 7 }, evo: { dmg: 18, shield: 11 } },
  { id: 'frostling', name: 'Frostling', evoName: 'Frostclaw', el: 'water', cost: 6, unlock: 10,
    sp: { dmg: 9, freeze: true }, evo: { dmg: 13, freeze: true } },
  { id: 'gloomite', name: 'Gloomite', evoName: 'Dreadmaw', el: 'shadow', cost: 6, unlock: 15,
    sp: { dmg: 10, drain: 2 }, evo: { dmg: 16, drain: 3 } },
  { id: 'zapup', name: 'Sparkpup', evoName: 'Sparktail', el: 'spark', cost: 4, unlock: 20,
    sp: { dmg: 7, block: 2 }, evo: { dmg: 11, block: 3 } },
  // ALL: every gem of any element charges it, at half rate (1 per 2 gems).
  { id: 'prismote', name: 'Rainbit', evoName: 'Rainbeast', el: 'all', cost: 16, unlock: 30,
    sp: { dmg: 17 }, evo: { dmg: 26 } },
];

export const BY_ID = Object.fromEntries(MONSTERS.map((m) => [m.id, m]));

/** RULES VERSIONS (2026-11-14, the rebalance; Matt: "Yes rebalance them"). A match carries `rv`; no `rv` = 1. Every
 *  match started before the rebalance (a vs-computer save, an open challenge, a live room) replays on its OWN numbers,
 *  so no stored match changes its result. A new match is stamped RULES_VERSION. V1 = the numbers as of 2026-11-13,
 *  frozen: never edit them. A future rebalance adds V2 here and bumps RULES_VERSION to 3. */
export const RULES_VERSION = 5;   // 3 (2026-11-14): two monsters of one element SHARE the gems (engine.js charge), retuned
// 4 (2026-11-15): a special fires at most once a turn per monster; calmer bombs (engine.js v4)
// 5 (2026-11-22, Matt: "Fix everything"): numbers only, v4's rules. Tuned on Medium AND the new Hard: Driplet cost 5 dmg 14
//   (evo 19), Frostling cost 6 (dmg 9 / 13 as before), Cinderwing dmg 14; evolved only: Thornbear heal 11, Thunderhorn 18,
//   Blazecat 20, Dreadmaw 16.
const V1 = {
  emberkit: { cost: 6, sp: { dmg: 12, col: 1 }, evo: { dmg: 18, col: 2 } },
  sproutle: { cost: 6, sp: { dmg: 10, heal: 10 }, evo: { dmg: 15, heal: 15 } },
  driplet: { cost: 4, sp: { dmg: 8 }, evo: { dmg: 14 } },
  zapup: { cost: 4, sp: { dmg: 5, block: 2 }, evo: { dmg: 10, block: 3 } },
  gloomite: { cost: 6, sp: { dmg: 10, drain: 2 }, evo: { dmg: 15, drain: 3 } },
  pebbleop: { cost: 8, sp: { dmg: 10, shield: 8 }, evo: { dmg: 15, shield: 12 } },
  cinderwing: { cost: 8, sp: { dmg: 10, rows: 1 }, evo: { dmg: 15, rows: 2 } },
  thornpaw: { cost: 6, sp: { convert: 3, heal: 5 }, evo: { convert: 5, heal: 10 } },
  frostling: { cost: 5, sp: { dmg: 8, freeze: true }, evo: { dmg: 12, freeze: true } },
  stormhorn: { cost: 5, sp: { dmg: 10, chain: 1 }, evo: { dmg: 15, chain: 2 } },
  hexowl: { cost: 5, sp: { dmg: 5, curse: { tick: 5, turns: 2 } }, evo: { dmg: 10, curse: { tick: 5, turns: 3 } } },
  prismote: { cost: 14, sp: { dmg: 20 }, evo: { dmg: 30 } },
};
/** Version 2 (2026-11-14 morning, the first rebalance), FROZEN: its matches keep these numbers AND its rule (each monster of
 *  the matched element got every gem). Never edit. */
const V2 = {
  thornpaw: { cost: 5, sp: { convert: 4, heal: 7 }, evo: { convert: 5, heal: 10 } },
  sproutle: { cost: 6, sp: { dmg: 9, heal: 6 }, evo: { dmg: 14, heal: 10 } },
  driplet: { cost: 4, sp: { dmg: 12 }, evo: { dmg: 18 } },
  cinderwing: { cost: 8, sp: { dmg: 11, rows: 1 }, evo: { dmg: 16, rows: 2 } },
  frostling: { cost: 5, sp: { dmg: 7, freeze: true }, evo: { dmg: 11, freeze: true } },
  stormhorn: { cost: 5, sp: { dmg: 12, chain: 1 }, evo: { dmg: 17, chain: 2 } },
  emberkit: { cost: 7, sp: { dmg: 11, col: 1 }, evo: { dmg: 17, col: 2 } },
  pebbleop: { cost: 7, sp: { dmg: 12, shield: 9 }, evo: { dmg: 17, shield: 13 } },
  hexowl: { cost: 5, sp: { dmg: 8, curse: { tick: 5, turns: 2 } }, evo: { dmg: 13, curse: { tick: 5, turns: 3 } } },
  gloomite: { cost: 6, sp: { dmg: 12, drain: 2 }, evo: { dmg: 17, drain: 3 } },
  zapup: { cost: 4, sp: { dmg: 4, block: 2 }, evo: { dmg: 8, block: 3 } },
  prismote: { cost: 16, sp: { dmg: 18 }, evo: { dmg: 27 } },
};
/** Version 3 (2026-11-14 afternoon), FROZEN: its matches keep these numbers AND its rules (a special could fire again and
 *  again in one turn; bombs as before). Never edit. */
const V3 = {
  thornpaw: { cost: 5, sp: { convert: 4, heal: 8 }, evo: { convert: 5, heal: 11 } },
  sproutle: { cost: 6, sp: { dmg: 9, heal: 6 }, evo: { dmg: 14, heal: 10 } },
  driplet: { cost: 4, sp: { dmg: 12 }, evo: { dmg: 18 } },
  cinderwing: { cost: 8, sp: { dmg: 12, rows: 1 }, evo: { dmg: 17, rows: 2 } },
  hexowl: { cost: 5, sp: { dmg: 8, curse: { tick: 5, turns: 2 } }, evo: { dmg: 13, curse: { tick: 5, turns: 3 } } },
  stormhorn: { cost: 5, sp: { dmg: 12, chain: 1 }, evo: { dmg: 17, chain: 2 } },
  emberkit: { cost: 7, sp: { dmg: 12, col: 1 }, evo: { dmg: 18, col: 2 } },
  pebbleop: { cost: 7, sp: { dmg: 13, shield: 9 }, evo: { dmg: 18, shield: 13 } },
  frostling: { cost: 5, sp: { dmg: 7, freeze: true }, evo: { dmg: 11, freeze: true } },
  gloomite: { cost: 6, sp: { dmg: 12, drain: 2 }, evo: { dmg: 17, drain: 3 } },
  zapup: { cost: 4, sp: { dmg: 4, block: 2 }, evo: { dmg: 8, block: 3 } },
  prismote: { cost: 17, sp: { dmg: 17 }, evo: { dmg: 26 } },
};
/** Version 4 (2026-11-15, once a turn + calmer bombs), FROZEN: its numbers (its rules = v5's, engine.js `v4`). Never edit. */
const V4 = {
  thornpaw: { cost: 6, sp: { dmg: 5, heal: 7, convert: 3 }, evo: { dmg: 8, heal: 10, convert: 4 } },
  sproutle: { cost: 6, sp: { dmg: 10, heal: 5 }, evo: { dmg: 15, heal: 9 } },
  driplet: { cost: 4, sp: { dmg: 12 }, evo: { dmg: 18 } },
  cinderwing: { cost: 8, sp: { dmg: 13, rows: 1 }, evo: { dmg: 18, rows: 2 } },
  hexowl: { cost: 5, sp: { dmg: 6, curse: { tick: 5, turns: 2 } }, evo: { dmg: 11, curse: { tick: 5, turns: 3 } } },
  stormhorn: { cost: 5, sp: { dmg: 12, chain: 1 }, evo: { dmg: 17, chain: 2 } },
  emberkit: { cost: 7, sp: { dmg: 13, col: 1 }, evo: { dmg: 19, col: 2 } },
  pebbleop: { cost: 7, sp: { dmg: 13, shield: 7 }, evo: { dmg: 18, shield: 11 } },
  frostling: { cost: 5, sp: { dmg: 9, freeze: true }, evo: { dmg: 13, freeze: true } },
  gloomite: { cost: 6, sp: { dmg: 10, drain: 2 }, evo: { dmg: 15, drain: 3 } },
  zapup: { cost: 4, sp: { dmg: 7, block: 2 }, evo: { dmg: 11, block: 3 } },
  prismote: { cost: 16, sp: { dmg: 17 }, evo: { dmg: 26 } },
};
const OLD = { 1: V1, 2: V2, 3: V3, 4: V4 };
/** The numbers a match of rules version `rv` uses (absent = 1). The current version reads MONSTERS. */
const defOf = (id, rv) => { const v = OLD[rv || 1]; return (v && v[id]) || BY_ID[id]; };
export const costOf = (id, rv = RULES_VERSION) => { const d = defOf(id, rv); return d ? d.cost : 1; };
export const STARTERS = MONSTERS.filter((m) => !m.unlock).map((m) => m.id);

/** Unlocked monster ids for a total-wins count. DERIVED at read time, never stored (THE LAW: there
 *  is nothing new to lose). */
export function unlockedIds(wins) {
  const w = Number(wins) || 0;
  return MONSTERS.filter((m) => !m.unlock || w >= m.unlock).map((m) => m.id);
}

export const monName = (id, evolved) => {
  const m = BY_ID[id];
  return m ? (evolved ? m.evoName : m.name) : '';
};
/** A special's numbers. `rv` = the match's rules version (engine and computer pass it); screens outside a match
 *  show the current numbers. */
export const specialOf = (id, evolved, rv = RULES_VERSION) => {
  const m = defOf(id, rv);
  return m ? (evolved ? m.evo : m.sp) : {};
};

export const BERRIES_TO_EVOLVE = 4;
/** Every team starts at 80 and can never go above it (Matt, 2026-10-24: like the real game). */
export const TEAM_HP = 80;
export const BOMB_DAMAGE = 10;
export const MAX_BOMBS = 2;
