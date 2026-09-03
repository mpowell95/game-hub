// golf/js/clubs.js - pure club table, lie modifiers, auto-select. No DOM.
// See §5 of GOLF-HANDOFF.md for the constants and their tuning procedure.

// speed values tuned Part 1, second pass (bisection against sweep-carry's targets, spin01=0),
// AFTER fixing the spinAxis sign bug and re-tuning CL_COEF (flight.js) to 1.55 - see
// DECISIONS.md#spinaxis-sign-bug. All land in realistic 25-80 m/s golf ball speeds; the first
// pass's >120 m/s values were the bug's symptom, not a real tuning result.
export const CLUBS = [
  { id: 'dr',  name: { en: 'Driver',  es: 'Driver' },   speed: 71.93, launch: 12, spin: 2600 },
  { id: '3w',  name: { en: '3 Wood',  es: 'Madera 3' }, speed: 60.09, launch: 14, spin: 3200 },
  { id: '5i',  name: { en: '5 Iron',  es: 'Hierro 5' }, speed: 51.07, launch: 18, spin: 5000 },
  { id: '7i',  name: { en: '7 Iron',  es: 'Hierro 7' }, speed: 45.39, launch: 21, spin: 6500 },
  { id: '9i',  name: { en: '9 Iron',  es: 'Hierro 9' }, speed: 40.37, launch: 25, spin: 8000 },
  { id: 'pw',  name: { en: 'Wedge',   es: 'Wedge' },    speed: 35.10, launch: 30, spin: 9500 },
  { id: 'sw',  name: { en: 'Sand W',  es: 'Sand W' },   speed: 29.01, launch: 38, spin: 10000 },
  { id: 'pt',  name: { en: 'Putter',  es: 'Putter' },   speed: 6.5,   launch: 0,  spin: 0 },
];

// Target carries after tuning, §5: flat ground, no wind, power 1.0, spin bar centered.
export const TARGET_CARRY_M = {
  dr: 240, '3w': 205, '5i': 170, '7i': 145, '9i': 123, pw: 100, sw: 73,
};
export const TARGET_PUTT_ROLL_M = 36; // putter 100% roll on flat green

export function clubById(id) {
  return CLUBS.find(c => c.id === id) || null;
}

export const LIE = {
  tee:     { speed: 1.00, spin: 1.00 },
  fairway: { speed: 1.00, spin: 1.00 },
  fringe:  { speed: 1.00, spin: 0.90 },
  rough:   { speed: 0.85, spin: 0.60 },
  sand:    { speed: 0.70, spin: 0.50 },   // if club is not 'sw' or 'pw', speed 0.55 instead
  green:   { speed: 1.00, spin: 1.00 },   // putter only
};

// lie modifier for a given club on a given surface (handles the sand exception)
export function lieSpeedMod(lie, clubId) {
  const l = LIE[lie] || LIE.fairway;
  if (lie === 'sand' && clubId !== 'sw' && clubId !== 'pw') return 0.55;
  return l.speed;
}
export function lieSpinMod(lie) {
  const l = LIE[lie] || LIE.fairway;
  return l.spin;
}

// Auto-select: on green -> putter. Otherwise smallest club whose target carry >= d
// (adjusted distance); if none reaches (d > driver), driver.
// headwindComponent: m/s of wind blowing FROM the pin TO the tee (positive = headwind).
export function autoSelectClub(lie, distanceToPinM, headwindComponent) {
  if (lie === 'green') return 'pt';
  const d = distanceToPinM + (headwindComponent || 0) * 1.5;
  let best = null;
  for (const c of CLUBS) {
    if (c.id === 'pt') continue;
    const carry = TARGET_CARRY_M[c.id];
    if (carry === undefined) continue;
    if (carry >= d) {
      if (best === null || carry < TARGET_CARRY_M[best]) best = c.id;
    }
  }
  return best || 'dr';
}

// Player override chip cycle: driver..sand wedge always available; putter only on green/fringe.
export function selectableClubs(lie) {
  const allowPutter = lie === 'green' || lie === 'fringe';
  return CLUBS.filter(c => c.id !== 'pt' || allowPutter).map(c => c.id);
}
