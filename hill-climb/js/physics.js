// hill-climb/js/physics.js — the vehicle simulation and the run state machine.
//
// Pure and DOM-free: it takes a spec (catalog.js tunedSpec), a terrain (terrain.js) and a
// throttle in [-1, 1], and steps a fixed 1/120 s timestep. ui.js owns the clock, render.js reads
// the state. Nothing here touches localStorage, canvas or the document, which is what lets
// hill-climb/js/test.js drive whole runs headless under node.
//
// COORDINATES: world y is UP-positive, angle is CCW-positive radians, 0 = level and facing right.
// Only render.js flips to screen space. Keep it that way — every sign in this file (throttle
// pitching the nose up, gravity, the normal force) reads naturally in y-up and would need
// rewriting under a flip.
//
// THE MODEL, in one paragraph. The chassis is a single rigid body (position, velocity, angle,
// angular velocity). Each wheel is a raycast-style contact, not a body: from its chassis-local
// anchor we look down the chassis' own "down" axis one suspension length, ask the terrain how
// deep the wheel is buried there, and turn that penetration into a spring+damper force along the
// terrain NORMAL plus a drive/friction force along the terrain TANGENT. Both are applied at the
// contact, which is below the center of mass — so the drive force pitches the nose up all by
// itself, exactly the coupling the whole game is built on. Traction is a friction cone: the
// tangential force is clamped to grip * normalForce, so a light rear wheel or an icy stage spins
// instead of climbing, and the tires upgrade is the thing that fixes it.

export const DT = 1 / 120;
export const MAX_STEPS = 5;      // catch-up cap: never spiral on a slow frame
const TAU = Math.PI * 2;

/** Fuel burn: a slow always-on drain plus a throttle-proportional one, in fuel units per second.
 *  Burn is TIME-based, so covering ground faster costs less fuel per meter — going fast is rewarded,
 *  and crawling is punished by the idle drain. Tightened 2026-09 (TP: "no risk of running out"): the
 *  old drain plus a can worth 55 every ~80 m meant fuel only ever climbed, so it was never a real
 *  resource. */
const FUEL_IDLE = 2.8;
const FUEL_THROTTLE = 2.2;
/** Coins awarded per airborne rotation LANDED CLEAN. Crash mid-rotation and it pays nothing. */
export const FLIP_BONUS = 50;

// Nitro: the HUD's blue canister count and its BOOST dial. A charge is a short, flat forward shove
// along the chassis' own forward axis, which is why using it while the nose is up launches you
// rather than accelerating you. Fuel cans top the canisters back up, so nitro is a reason to
// detour for a can you did not strictly need.
// A visually complete flip lands a hair short of a strict 2*PI of AIRBORNE rotation: the car
// launches slightly nose-up and its wheels touch down again before the chassis angle comes the
// last few degrees around. So a rotation this close to complete is credited on a clean landing —
// the head-in-dirt crash check already rejects a car that came down on its roof, so anything that
// lands clean really is upright. Without this a genuine single flip never paid (TP, 2026-09).
const FLIP_LAND_TOL = 0.6;   // radians (~34 deg)

export const NITRO_START = 2;
export const NITRO_MAX = 5;
export const BOOST_TIME = 1.3;      // seconds of thrust per charge
const BOOST_ACCEL = 15;             // m/s^2 added along forward while boosting

// Air rotation control. High damping on purpose: gas spins the nose up fast toward a terminal
// rate of airTorque/AIR_DAMP, and letting go settles it, so a player can rotate a full turn AND
// bring the wheels back down to land it. The old value (0.35) let spin run away, so a flip could
// be started but never leveled for a landing, which is why one never paid (TP, 2026-09).
const AIR_DAMP = 3.5;

export const RunState = { READY: 'ready', RUNNING: 'running', OVER: 'over' };
/** Why a run ended. Shown on the game-over card, recorded nowhere else. */
export const EndReason = { CRASH: 'crash', FUEL: 'fuel' };

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export class Vehicle {
  /**
   * @param {object} spec    catalog.js tunedSpec output
   * @param {object} terrain terrain.js makeTerrain output
   */
  constructor(spec, terrain) {
    this.spec = spec;
    this.terrain = terrain;
    const startX = 0;
    this.x = startX;
    // Drop in just above the pad so the suspension settles on the first few steps instead of
    // starting inside the ground (which would fire an enormous first-frame spring force).
    this.y = terrain.y(startX) + spec.restLen + spec.radius + 0.15;
    this.vx = 0; this.vy = 0;
    this.ang = 0; this.av = 0;
    this.wheels = spec.wheels.map((w) => ({
      local: { x: w.x, y: w.y }, drive: w.drive,
      comp: 0, grounded: false, spin: 0, slip: 0,
      cx: 0, cy: 0,   // world center, filled by step() for the renderer
    }));
    this.airborne = false;
    this.airSpin = 0;      // signed radians accumulated since leaving the ground
    this.pendingFlips = 0; // full rotations completed this jump, PAID only on a clean landing
    this.flips = 0;        // rotations actually landed (banked)
    this.crashed = false;
    this.boostT = 0;       // seconds of nitro thrust left
  }

  /** Rotate a chassis-local point into world space. */
  toWorld(p) {
    const c = Math.cos(this.ang), s = Math.sin(this.ang);
    return { x: this.x + p.x * c - p.y * s, y: this.y + p.x * s + p.y * c };
  }

  /** The driver's head in world space — the crash probe (see step()). */
  headPos() { return this.toWorld(this.spec.head); }

  /** Velocity of the material point at world offset (rx, ry) from the center of mass. */
  velAt(rx, ry) { return { x: this.vx - this.av * ry, y: this.vy + this.av * rx }; }

  applyForce(fx, fy, rx, ry, dt) {
    const invM = 1 / this.spec.mass;
    this.vx += fx * invM * dt;
    this.vy += fy * invM * dt;
    this.av += (rx * fy - ry * fx) / this.spec.inertia * dt;
  }

  /**
   * Advance one fixed step.
   * @param {number} throttle -1 (brake/reverse) .. 1 (gas)
   * @param {number} dt       seconds, normally DT
   */
  step(throttle, dt) {
    const sp = this.spec, tr = this.terrain;
    const th = clamp(throttle, -1, 1);

    // gravity
    this.vy -= sp.gravity * dt;

    // Chassis "down" axis in world space, i.e. local (0,-1) rotated by `ang`.
    const c = Math.cos(this.ang), s = Math.sin(this.ang);
    const downX = s, downY = -c;

    // nitro thrust, along the chassis' own forward axis and through the center of mass (no
    // torque of its own: the launch angle is whatever the car's attitude already is)
    if (this.boostT > 0) {
      this.boostT = Math.max(0, this.boostT - dt);
      this.vx += c * BOOST_ACCEL * dt;
      this.vy += s * BOOST_ACCEL * dt;
    }

    let anyGround = false;
    for (const w of this.wheels) {
      // anchor -> fully extended wheel center
      const ax = this.x + w.local.x * c - w.local.y * s;
      const ay = this.y + w.local.x * s + w.local.y * c;
      const ex = ax + downX * sp.restLen;
      const ey = ay + downY * sp.restLen;

      const gy = tr.y(ex);
      const pen = gy - (ey - sp.radius);
      if (pen <= 0) {
        w.grounded = false;
        // relax the visual compression back to rest so a wheel doesn't hang mid-travel in the air
        w.comp += (0 - w.comp) * Math.min(1, dt * 12);
        w.slip = 0;
        w.cx = ex; w.cy = ey;
        // free-rolling wheels keep spinning, slowly bleeding off
        w.spin += (this.vx / sp.radius) * dt;
        continue;
      }
      anyGround = true;
      w.grounded = true;
      const comp = Math.min(pen, sp.travel);
      w.comp = comp;
      const cx = ex, cy = ey + comp;      // contact-corrected wheel center
      w.cx = cx; w.cy = cy;

      const n = tr.normal(ex);
      const tx = n.y, ty = -n.x;          // unit tangent, +x-ward

      const rx = cx - this.x, ry = cy - this.y;
      const v = this.velAt(rx, ry);
      const vn = v.x * n.x + v.y * n.y;
      const vt = v.x * tx + v.y * ty;

      // Spring + damper along the normal, never pulling (max 0). Beyond the suspension's travel
      // the chassis itself is in the dirt, so a much stiffer term takes over — without it a hard
      // landing sinks straight through the hill.
      let N = sp.spring * comp - sp.damp * vn;
      const over = pen - sp.travel;
      if (over > 0) N += sp.spring * 7 * over;
      N = Math.max(0, N);

      // Drive + rolling resistance along the tangent, clamped into the friction cone.
      const drive = th * sp.power * w.drive;
      const roll = -vt * 150;
      const maxF = sp.grip * N;
      const ft = clamp(drive + roll, -maxF, maxF);

      this.applyForce(n.x * N + tx * ft, n.y * N + ty * ft, rx, ry, dt);

      // Wheel spin for the renderer: rolls with the contact, plus visible slip when the cone
      // clipped the requested drive force (this is what "spinning the wheels on ice" looks like).
      const clipped = drive + roll - ft;
      w.slip = clipped / Math.max(1, sp.power);
      w.spin += (vt / sp.radius + w.slip * 9) * dt;
    }

    if (anyGround) {
      // Engine torque reaction: gas lifts the nose, brake drops it. The drive force above already
      // does most of this (it acts below the center of mass); this is the extra authority that
      // makes throttle a genuine balance control rather than a side effect.
      this.av += (th * sp.reaction / sp.inertia) * dt;
      this.av -= this.av * 3.4 * dt;
    } else {
      // Air control: the classic hill-climb midair rotation. Gas spins the nose up (backflip),
      // brake tucks it forward (frontflip). Strong torque against firm AIR_DAMP (see its comment):
      // gas spins toward a terminal rate, letting go settles it, so a rotation both completes AND
      // can be leveled to land. The old torque was so weak the best any car could turn in a ramp's
      // ~1.1 s of air was a quarter turn — a flip was impossible and the bonus never paid (TP,
      // 2026-09). The air clamp is higher than the grounded one because a full rotation in that
      // time needs the nose swinging faster than balancing ever does.
      this.av += th * sp.airTorque * dt;
      this.av -= this.av * AIR_DAMP * dt;
    }
    this.av = clamp(this.av, anyGround ? -9 : -13, anyGround ? 9 : 13);

    // Light air drag, and a hard speed cap so a long downhill can't outrun the contact solver.
    this.vx -= this.vx * 0.06 * dt;
    this.vy -= this.vy * 0.02 * dt;
    this.vx = clamp(this.vx, -28, 34);
    this.vy = clamp(this.vy, -42, 42);

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.ang += this.av * dt;

    // Flip counting: rotation accumulated while every wheel is off the ground. A completed
    // rotation is PENDING until the car lands — a flip only pays if you land it clean, exactly as
    // the player expects ("single flip, land it clean" — TP, 2026-09). Rotating your way onto the
    // driver's head loses the pending bonus, which is what makes going for the double a real gamble.
    if (!anyGround) {
      if (!this.airborne) { this.airborne = true; this.airSpin = 0; }
      this.airSpin += this.av * dt;
      while (Math.abs(this.airSpin) >= TAU) {
        this.airSpin -= Math.sign(this.airSpin) * TAU;
        this.pendingFlips++;
      }
    }

    // CRASH: the driver's head touching the dirt. The single fail condition, exactly as the real
    // game plays it — a car can land on its roof and survive for a moment, it dies when the head
    // goes in. Cheap to test (one terrain probe) and it makes flips genuinely risky.
    const h = this.headPos();
    if (h.y - 0.20 <= tr.y(h.x)) this.crashed = true;

    // Touchdown: bank any pending flips if the landing was clean, then reset for the next jump.
    let landedFlips = 0;
    if (anyGround && this.airborne) {
      this.airborne = false;
      if (!this.crashed) {
        // credit a rotation that all but came around as the wheels touched back down
        if (Math.abs(this.airSpin) >= TAU - FLIP_LAND_TOL) this.pendingFlips++;
        if (this.pendingFlips > 0) {
          landedFlips = this.pendingFlips;
          this.flips += landedFlips;
        }
      }
      this.airSpin = 0;
      this.pendingFlips = 0;
    }

    return landedFlips;
  }
}

/**
 * One playable run: vehicle + fuel + coins + distance + the end conditions. ui.js constructs it,
 * calls step() once per fixed tick, and reads the plain fields for the HUD.
 */
export class Run {
  constructor(spec, terrain) {
    this.spec = spec;
    this.terrain = terrain;
    this.car = new Vehicle(spec, terrain);
    this.fuel = spec.fuel;
    this.maxFuel = spec.fuel;
    this.coins = 0;
    this.distance = 0;      // best (furthest) meters reached, never decreases
    this.flips = 0;
    this.nitro = NITRO_START;
    this.state = RunState.READY;
    this.endReason = null;
    this.events = [];       // transient {kind, x, y, text} popups drained by the renderer
  }

  start() { if (this.state === RunState.READY) this.state = RunState.RUNNING; }

  /** True while the run is live — the hub's isInProgress() answer. */
  get live() { return this.state === RunState.RUNNING; }

  /** Spend one nitro charge. No-op when the run is not live, the canisters are empty, or a boost
   *  is already burning (so a panicked double tap costs one charge, not two). */
  useNitro() {
    if (!this.live || this.nitro <= 0 || this.car.boostT > 0) return false;
    this.nitro--;
    this.car.boostT = BOOST_TIME;
    return true;
  }

  /** 0..1 for the HUD's BOOST dial. */
  boost01() { return Math.max(0, Math.min(1, this.car.boostT / BOOST_TIME)); }

  /** 0..1 for the HUD's RPM dial: mostly road speed, with a kick from raw throttle so the needle
   *  answers the pedal even while the wheels are still spinning up. */
  rpm01(throttle) {
    const speed = Math.min(1, Math.abs(this.car.vx) / 24);
    return Math.max(0, Math.min(1, speed * 0.72 + Math.abs(throttle || 0) * 0.28));
  }

  step(throttle, dt) {
    if (this.state !== RunState.RUNNING) return;
    const d = dt == null ? DT : dt;
    const th = clamp(throttle, -1, 1);
    const landedFlips = this.car.step(th, d);   // rotations banked by a clean landing this step

    this.fuel = Math.max(0, this.fuel - (FUEL_IDLE + FUEL_THROTTLE * Math.abs(th)) * d);
    this.distance = Math.max(this.distance, this.car.x);

    if (landedFlips > 0) {
      this.flips += landedFlips;
      this.coins += FLIP_BONUS * landedFlips;
      this.events.push({ kind: 'flip', x: this.car.x, y: this.car.y + 1.6, n: landedFlips, value: FLIP_BONUS * landedFlips });
    }

    // pickups: anything within a wheel-ish radius of the chassis center
    const items = this.terrain.itemsIn(this.car.x - 3, this.car.x + 3);
    for (const it of items) {
      if (it.taken) continue;
      const dx = it.x - this.car.x, dy = it.y - this.car.y;
      if (dx * dx + dy * dy > 2.4 * 2.4) continue;
      it.taken = true;
      if (it.kind === 'coin') {
        this.coins += it.value;
        this.events.push({ kind: 'coin', x: it.x, y: it.y, value: it.value });
      } else {
        this.fuel = Math.min(this.maxFuel, this.fuel + it.amount);
        this.nitro = Math.min(NITRO_MAX, this.nitro + 1);
        this.events.push({ kind: 'fuel', x: it.x, y: it.y, value: it.amount });
      }
    }

    if (this.car.crashed) this.end(EndReason.CRASH);
    else if (this.fuel <= 0) this.end(EndReason.FUEL);
  }

  end(reason) {
    if (this.state === RunState.OVER) return;
    this.state = RunState.OVER;
    this.endReason = reason;
  }

  /** The numbers the caller records and shows. Distance is floored to whole meters. */
  result() {
    return {
      distance: Math.max(0, Math.floor(this.distance)),
      coins: this.coins | 0,
      flips: this.flips | 0,
      reason: this.endReason,
    };
  }
}

export default { Run, Vehicle, RunState, EndReason, DT, MAX_STEPS, FLIP_BONUS, NITRO_START, NITRO_MAX };
