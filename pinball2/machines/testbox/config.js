// Every tunable number this machine has. Nothing physical is written anywhere else.
// Forked per machine on purpose (pinball2/CLAUDE.md): a shared config is a shared bug.
//
// Units are real: metres, kilograms, seconds, radians. Real units are why the feel numbers can be
// taken from a real machine instead of guessed. A Williams-body playfield is about 515 x 1067 mm,
// the ball is 27 mm and 80 g, and a table stands at 6.5 degrees.

export const CONFIG = {
  // table
  TABLE_W: 0.515,
  TABLE_H: 1.067,
  TILT_DEG: 6.5,
  G: 9.81,

  // ball
  BALL_R: 0.0135,
  BALL_E: 0.42,            // bounce off painted wood and plastic
  BALL_MU: 0.10,           // sliding friction at a contact
  ROLL_DECEL: 0.035,       // m/s lost per second while riding a surface
  REST_SPEED: 0.055,       // below this closing speed a contact slides instead of bouncing
  MAX_SPEED: 8.0,          // gameplay bound only. It can be raised without losing the ball

  // flipper
  FLIP_UP_TIME: 0.020,     // seconds from rest to the top stop. Measured: 30ms was a weak shot
  FLIP_DOWN_TIME: 0.055,
  FLIP_E: 0.55,            // rubber at a dead stop
  FLIP_E_FADE: 0.16,       // restitution lost per m/s of impact speed
  FLIP_E_MIN: 0.05,        // however hard it is hit, the rubber is never a dead wall
  // Left at 0 on purpose. It was added to break the tie that glued the ball to the bat, and then
  // the contact-episode fix in physics.js turned out to be the real cause: measured, the kick
  // changed a mid bat flip by 1mm in 924. It stays as a slider because it is the honest lever for
  // "flips should feel punchier" if that is ever wanted, and it is a gameplay model, not physics.
  FLIP_KICK: 0,
  FLIP_MU: 0.28,
  CRADLE_DAMP: 6.0,        // velocity decay per second for a slow ball on a held flipper
  CRADLE_MAX: 0.6,         // and only below this speed. Above it the ball is in play, not settling

  // pop bumper: a post that hits back. The kick is a fixed speed away from its centre, not a
  // restitution, because that is what a real bumper does: it fires a solenoid ring downward and the
  // ball leaves at the coil's speed regardless of how gently it arrived.
  BUMPER_KICK: 2.6,        // m/s the ball leaves at
  BUMPER_TRIP: 0.15,       // m/s of approach needed to fire it at all, so a resting ball is not a machine gun
  BUMPER_COOL: 0.06,       // s before the same bumper can fire again

  // slingshot: the same idea on a straight face
  SLING_KICK: 3.0,
  SLING_TRIP: 0.25,
  SLING_COOL: 0.06,

  // ramps (ribbons). A ramp is a lane with a height, and a ball on one is simulated ALONG it and
  // ACROSS it rather than in playfield x/y, so entering one is a change of coordinates and not a
  // move. There is no code that can put a ball somewhere it did not travel to.
  RAMP_ENTER: 0.9,         // m/s along the lane needed at the mouth to get on at all
  RAMP_DRAG: 0.25,         // m/s per second lost to the lane, which is rougher than the playfield
  RAMP_WALL_E: 0.30,       // bounce off the lane's side walls

  // solver
  DT: 1 / 240,
  MAX_EVENTS: 64,          // contacts resolved in one tick before the ball is declared jammed
  SKIN: 2e-5,              // m of clearance left after a contact so the same one is not re-solved
  FLIP_TIP_STEP: 0.25,     // flipper tip may cross this many ball radii per micro step
};

// The Tune panel is generated from this list, so a constant without a row here is not tunable
// by hand and a row without a constant is a mistake the editor reports on load.
export const TUNABLES = [
  { key: 'TILT_DEG', label: 'Tilt', unit: 'deg', min: 3, max: 12, step: 0.1 },
  { key: 'BALL_E', label: 'Ball bounce', unit: '', min: 0, max: 0.9, step: 0.01 },
  { key: 'BALL_MU', label: 'Ball friction', unit: '', min: 0, max: 0.6, step: 0.01 },
  { key: 'ROLL_DECEL', label: 'Rolling drag', unit: 'm/s2', min: 0, max: 0.3, step: 0.005 },
  { key: 'REST_SPEED', label: 'Rest threshold', unit: 'm/s', min: 0.01, max: 0.3, step: 0.005 },
  { key: 'MAX_SPEED', label: 'Speed cap', unit: 'm/s', min: 3, max: 15, step: 0.1 },
  { key: 'FLIP_UP_TIME', label: 'Flip time up', unit: 's', min: 0.01, max: 0.12, step: 0.002 },
  { key: 'FLIP_DOWN_TIME', label: 'Flip time down', unit: 's', min: 0.01, max: 0.2, step: 0.005 },
  { key: 'FLIP_E', label: 'Rubber bounce', unit: '', min: 0, max: 0.95, step: 0.01 },
  { key: 'FLIP_E_FADE', label: 'Rubber fade', unit: '/m/s', min: 0, max: 0.4, step: 0.01 },
  { key: 'FLIP_E_MIN', label: 'Rubber floor', unit: '', min: 0, max: 0.6, step: 0.01 },
  { key: 'FLIP_KICK', label: 'Flipper kick', unit: '', min: 0, max: 1.2, step: 0.01 },
  { key: 'FLIP_MU', label: 'Rubber grip', unit: '', min: 0, max: 0.9, step: 0.01 },
  { key: 'CRADLE_DAMP', label: 'Cradle damping', unit: '/s', min: 0, max: 20, step: 0.5 },
  { key: 'CRADLE_MAX', label: 'Cradle below', unit: 'm/s', min: 0.1, max: 2, step: 0.05 },
  { key: 'BUMPER_KICK', label: 'Bumper kick', unit: 'm/s', min: 0, max: 6, step: 0.1 },
  { key: 'BUMPER_TRIP', label: 'Bumper trip', unit: 'm/s', min: 0, max: 1, step: 0.05 },
  { key: 'SLING_KICK', label: 'Slingshot kick', unit: 'm/s', min: 0, max: 6, step: 0.1 },
  { key: 'SLING_TRIP', label: 'Slingshot trip', unit: 'm/s', min: 0, max: 1, step: 0.05 },
  { key: 'RAMP_ENTER', label: 'Ramp entry speed', unit: 'm/s', min: 0.1, max: 4, step: 0.05 },
  { key: 'RAMP_DRAG', label: 'Ramp drag', unit: 'm/s2', min: 0, max: 1.5, step: 0.05 },
];

/** Playfield gravity. A tilted plane pulls at g sin(tilt), about a ninth of a free fall at 6.5
 *  degrees. Getting this wrong is what makes a table feel like a vertical wall. */
export function gravity(cfg) {
  return cfg.G * Math.sin((cfg.TILT_DEG * Math.PI) / 180);
}

export function cloneConfig(over) {
  return Object.assign({}, CONFIG, over || {});
}
