// Pier Nine base values, DERIVED. Nothing here is a chosen number.
//
//   base = 1000 * D * R * (8 / W)   rounded to the nearest 500, floor 500
//
//   D  distance factor  = (flipper tip -> target) / 300mm      how far the shot is
//   R  risk factor      = what a MISS costs (table below)
//   W  aperture degrees = angle the entry subtends from the tip  how precise it must be
//
// 300mm and 8 deg are the two reference constants: a mid-length shot at a typical
// ramp-mouth width scores 1000 x R.
const LT = { x: 209, y: 941 };   // left flipper tip at rest
const RT = { x: 256, y: 941 };   // right flipper tip at rest
const RISK = { flipper: 1.0, centre: 1.4, outlane: 1.8 };

const SHOTS = [
  // ---- rev B ----------------------------------------------------------------
  ['Left orbit',        RT, { x:  80, y: 640 }, 34, 'outlane'],
  ['The Coaster',       RT, { x: 196, y: 742 }, 40, 'centre'],
  ['Ferris Wheel',      LT, { x: 232, y: 470 }, 46, 'centre'],
  ['The Pier',          LT, { x: 300, y: 716 }, 40, 'centre'],
  ['Fishing Dock bank', RT, { x: 150, y: 602 }, 96, 'centre'],
  ['Right orbit',       LT, { x: 410, y: 660 }, 34, 'outlane'],
  ['Ring Toss standup', LT, { x: 406, y: 545 }, 32, 'centre'],
  ['Ring Toss BULLSEYE',LT, { x: 420, y: 562 }, 26, 'outlane'],
  // ---- rev C ----------------------------------------------------------------
  // Every standup below is ANGLED to face the flipper that shoots it, so its
  // aperture is its full length. A standup left square to the table presents its
  // projected width instead, which is a different (much harder) shot - if a
  // placement stops facing its flipper, re-derive it.
  //
  // The Bait Shop is NOT here on purpose. It sits inside the right orbit lane, so
  // it is not aimed at independently: the formula's D term assumes free flight and
  // charges a guided shot for every mm the lane carries it, which derived 8,500 -
  // higher than the orbit it only PARTIALLY completes. See the note in the .md.
  ['Boathouse standup', RT, { x:  92, y: 480 }, 32, 'centre'],
  ['Ticket Booth',      LT, { x: 265, y: 550 }, 30, 'centre'],
  ['Fortune Teller',    LT, { x: 100, y: 570 }, 44, 'centre'],
];

const r500 = (v) => Math.max(500, Math.round(v / 500) * 500);
console.log('shot                  dist   D     W(deg)  R     raw     BASE');
for (const [name, tip, tgt, w, risk] of SHOTS) {
  const dist = Math.hypot(tgt.x - tip.x, tgt.y - tip.y);
  const D = dist / 300;
  const W = 2 * Math.atan((w / 2) / dist) * 180 / Math.PI;
  const R = RISK[risk];
  const raw = 1000 * D * R * (8 / W);
  console.log(
    name.padEnd(21),
    String(Math.round(dist)).padStart(4),
    D.toFixed(2).padStart(6),
    W.toFixed(1).padStart(6),
    R.toFixed(1).padStart(5),
    String(Math.round(raw)).padStart(7),
    String(r500(raw)).padStart(8));
}
