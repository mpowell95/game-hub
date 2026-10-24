// battle-arena/js/monsters.js - the roster, elements and unlock thresholds. Pure data, no DOM.
// Every creature, name and move here is our own (docs/BATTLE-ARENA-SPEC.md). Monster names are
// proper names, the same in every language; move names are translated in strings.js (sp_<id>).
//
// A special's numbers: dmg (to the other team), heal (own team, capped at max HP), shield,
// drain (energy taken from EACH enemy monster), rows (Scorch: clear the N rows with the most Fire
// gems), convert (N random gems become Leaf), freeze (the other side gets 1 move next turn),
// chain (energy to your other monster), curse ({ tick, turns }: tick damage at the start of each
// of their next `turns` turns).

export const ELEMENTS = ['fire', 'water', 'spark', 'leaf', 'shadow'];

/** Colour + shape per tile kind. Shape is the colourblind-safe signal; colour only reinforces it. */
export const ELEMENT_COLOR = {
  fire: '#E0532F', water: '#1F5FA8', spark: '#F2B705', leaf: '#2E9E44', shadow: '#7B4FC4',
  berry: '#A3203A', bomb: '#3A3F47', all: '#C9A2F0',
};

export const MONSTERS = [
  { id: 'emberkit', name: 'Emberkit', evoName: 'Blazelynx', el: 'fire', cost: 6,
    sp: { dmg: 10 }, evo: { dmg: 18 } },
  { id: 'sproutle', name: 'Sproutle', evoName: 'Mossback', el: 'leaf', cost: 6,
    sp: { heal: 10 }, evo: { heal: 15, dmg: 15 } },
  { id: 'driplet', name: 'Driplet', evoName: 'Tidefang', el: 'water', cost: 4,
    sp: { dmg: 8 }, evo: { dmg: 14 } },
  { id: 'zapup', name: 'Zapup', evoName: 'Voltail', el: 'spark', cost: 4,
    sp: { dmg: 10 }, evo: { dmg: 20 } },
  { id: 'gloomite', name: 'Gloomite', evoName: 'Dreadmaw', el: 'shadow', cost: 6,
    sp: { dmg: 10, drain: 2 }, evo: { dmg: 15, drain: 3 } },
  { id: 'pebbleop', name: 'Pebbleop', evoName: 'Cragoon', el: 'fire', cost: 8,
    sp: { dmg: 10, shield: 8 }, evo: { dmg: 15, shield: 12 } },

  { id: 'cinderwing', name: 'Cinderwing', evoName: 'Pyrovern', el: 'fire', cost: 8, unlock: 3,
    sp: { dmg: 10, rows: 1 }, evo: { dmg: 15, rows: 2 } },
  { id: 'thornpaw', name: 'Thornpaw', evoName: 'Briarlord', el: 'leaf', cost: 6, unlock: 6,
    sp: { convert: 3, heal: 5 }, evo: { convert: 5, heal: 10 } },
  { id: 'frostling', name: 'Frostling', evoName: 'Glacielle', el: 'water', cost: 5, unlock: 10,
    sp: { dmg: 8, freeze: true }, evo: { dmg: 12, freeze: true } },
  { id: 'stormhorn', name: 'Stormhorn', evoName: 'Thundrake', el: 'spark', cost: 5, unlock: 15,
    sp: { dmg: 10, chain: 1 }, evo: { dmg: 15, chain: 2 } },
  { id: 'hexowl', name: 'Hexowl', evoName: 'Grimhoot', el: 'shadow', cost: 5, unlock: 20,
    sp: { dmg: 5, curse: { tick: 5, turns: 2 } }, evo: { dmg: 10, curse: { tick: 5, turns: 3 } } },
  // ALL: every gem of any element charges it, at half rate (1 per 2 gems).
  { id: 'prismote', name: 'Prismote', evoName: 'Prismaraja', el: 'all', cost: 14, unlock: 30,
    sp: { dmg: 20 }, evo: { dmg: 30 } },
];

export const BY_ID = Object.fromEntries(MONSTERS.map((m) => [m.id, m]));
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
export const specialOf = (id, evolved) => {
  const m = BY_ID[id];
  return m ? (evolved ? m.evo : m.sp) : {};
};

export const BERRIES_TO_EVOLVE = 4;
/** Every team starts at 80 and can never go above it (Matt, 2026-10-24: like the real game). */
export const TEAM_HP = 80;
export const EVOLVE_HP = 5;
export const BOMB_DAMAGE = 10;
export const MAX_BOMBS = 2;
