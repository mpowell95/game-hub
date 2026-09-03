// golf/js/flight.js - pure: aerodynamic force per step. No DOM, no rng. See §7.4.

export const AIR = { rho: 1.225, Cd: 0.24, ClMax: 0.25, spinDecayTau: 25 };
// (tune, Part 1): multiplier on spin ratio -> lift coefficient. 1.55, not the spec's original
// 0.62 - re-tuned after fixing physics.js's spinAxis sign bug (lift was acting as downforce).
// See DECISIONS.md#spinaxis-sign-bug.
export const CL_COEF = 1.55;
// (Part 9B, the one approved edit to frozen physics): how far the spin axis tilts out of pure
// backspin at |curve01| = 1, in degrees. physics.js rotates the axis about the TRAVEL direction
// by curve01 x SIDE_TILT, so the Magnus force gains a lateral component (a hook or slice) and
// its vertical component shrinks by cos(tilt) - a strongly curved shot flies lower and shorter.
// Tuned so a full-power driver at curve01 = 1 lands 25-45 m right of and 5-15 m short of the
// straight shot (test 3c). GOLF-PART9.md's starting value of 35 gave 48.0 m right / 26.2 m short
// (outside both bands); the sweep over its 20-50 range passes only from 20 to 26, and 22 sits
// at the centre of both bands: 35.6 m right, 10.7 m short (hook mirrors: 35.6 / 10.8). See
// DECISIONS.md#part9b-sidespin for the whole table.
export const SIDE_TILT = 22;
const A = 0.001432; // ball cross-section area, m^2
const R = 0.02134;  // ball radius, m

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function len(v) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }
function scale(v, s) { return { x: v.x * s, y: v.y * s, z: v.z * s }; }
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function normalize(v) {
  const l = len(v);
  if (l < 1e-9) return { x: 0, y: 0, z: 0 };
  return scale(v, 1 / l);
}

// v: {x,y,z} ball velocity (m/s). omega: scalar spin magnitude (rad/s). spinAxis: {x,y,z} unit.
// wind: {x,y,z} m/s at ground level, constant. Returns {x,y,z} force (N).
export function airForce(v, omega, spinAxis, wind) {
  const vr = sub(v, wind || { x: 0, y: 0, z: 0 });
  const s = len(vr);
  if (s < 1e-6) return { x: 0, y: 0, z: 0 };
  const drag = scale(vr, -0.5 * AIR.rho * AIR.Cd * A * s);
  const spinRatio = (R * omega) / s;
  const Cl = Math.min(AIR.ClMax, CL_COEF * spinRatio);
  const liftDir = normalize(cross(spinAxis, vr));
  const lift = scale(liftDir, 0.5 * AIR.rho * Cl * A * s * s);
  return add(drag, lift);
}
