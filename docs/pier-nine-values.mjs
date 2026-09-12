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
  ['Left orbit',        RT, { x:  80, y: 640 }, 34, 'outlane'],
  ['The Coaster',       RT, { x: 196, y: 742 }, 40, 'centre'],
  ['Ferris Wheel',      LT, { x: 232, y: 470 }, 46, 'centre'],
  ['The Pier',          LT, { x: 300, y: 716 }, 40, 'centre'],
  ['Fishing Dock bank', RT, { x: 150, y: 602 }, 96, 'centre'],
  ['Right orbit',       LT, { x: 410, y: 660 }, 34, 'outlane'],
  ['Ring Toss standup', LT, { x: 406, y: 545 }, 32, 'centre'],
  ['Ring Toss BULLSEYE',LT, { x: 420, y: 562 }, 26, 'outlane'],
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
