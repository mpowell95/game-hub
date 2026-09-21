// hoops4/js/cpu.js - the computer opponent.
//
// ITS DIFFICULTY IS SHOT ACCURACY, NOT SEARCH DEPTH, and that is the whole idea. Connect Four
// already ships a real bitboard solver, so knowing which column to play is free; what makes an
// opponent easy or hard HERE is whether it can hit the hoop it picked. A Beginner knows the
// right column and bricks it.
//
// It shoots through THE SAME PHYSICS the player does - it is handed an aim and a power and the
// ball goes where it goes, including into the wrong hoop. Nothing places a CPU disc directly.
import { AI, Difficulty } from '../../connect-four/js/ai.js';
import { RED, YELLOW } from './game.js';

// WHERE TO AIM FOR EACH COLUMN. Measured, not derived: these are the mean aim values each column's
// baskets actually came from over a full sweep of the real engine. Re-measure if the cabinet
// width, the hoop pitch, the shelf geometry or aimMax move - these were re-measured once already,
// when the machine went from a reused three-tread staircase to its own one-step cabinet.
// Gaps between neighbours are 0.13 to 0.25 against spreads of 0.04 to 0.14, so a column IS
// separable by aim - which is the whole reason the game works.
export const COLUMN_AIM = [-0.53, -0.30, -0.15, 0.00, 0.16, 0.29, 0.54];

// Per skill: how far off the CPU's aim lands, and how strong its column choice is. The spread is
// in the same units as COLUMN_AIM, and the gaps between neighbouring columns are 0.08 to 0.20 -
// so a Beginner's 0.30 genuinely lands it in the wrong column a lot of the time.
const SKILL = {
  1: { spread: 0.26, power: 0.16, level: Difficulty.EASY },
  2: { spread: 0.13, power: 0.10, level: Difficulty.MEDIUM },
  3: { spread: 0.055, power: 0.06, level: Difficulty.HARD },
};

export class Cpu {
  constructor(skill = 2, rng = Math.random) {
    this.skill = SKILL[skill] ? skill : 2;
    this.rng = rng;
    this.ai = new AI(SKILL[this.skill].level, { rng });
  }

  /** The column it WANTS. Wanting and hitting are different questions. */
  pickColumn(match) {
    const duck = {
      board: match.board,
      currentPlayer: YELLOW,
      isOver: () => match.over,
    };
    try {
      const col = this.ai.chooseMove(duck);
      if (match.board.canPlay(col)) return col;
    } catch { /* fall through to the honest fallback below */ }
    const open = match.openColumns();
    return open.length ? open[Math.floor(this.rng() * open.length)] : 0;
  }

  /** The swipe it actually takes at that column. */
  aimFor(col) {
    const s = SKILL[this.skill];
    const bell = () => (this.rng() + this.rng() - 1);        // same shape as the engine's scatter
    return {
      aim: Math.max(-1, Math.min(1, COLUMN_AIM[col] + bell() * s.spread)),
      power: 0.45 + bell() * s.power,
    };
  }
}

export default { Cpu, COLUMN_AIM };
