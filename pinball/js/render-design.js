// pinball/js/render-design.js - the FOUNDRY board, drawn by the Claude Design model itself.
//
// THE MODEL IS NOT CONVERTED, IT IS MOUNTED. `pinball/design/board.js` exports `buildBoard(THREE)`
// returning a finished THREE.Group - 120-odd named meshes in sixteen named materials - and this
// renderer adds that group to the scene as it is. STARHUB's model had to be converted because the
// game was a 2D canvas at the time; there is no such reason here, and a conversion would be a
// second copy of the geometry that could drift from the FOOTPRINTS the physics uses.
//
// Everything else - the camera framing, the confetti thrown clear of the machine, the backglass,
// the painted contact shadow under each ball, the shake, the software-GL probe, dispose() - comes
// from render3d.js, the same way RainbowRenderer takes it.
//
// THREE FRAMES, AND THEY HAVE TO AGREE.
//   - the export: metres, y up, +x right, +z toward the player, origin at the table's centre.
//   - this engine: table units, y down-field, origin at the cabinet's top-left corner.
//   - render3d: a table point (x, y) is drawn at world (x, h, -y), inside a model group whose
//     scale.x is -1 (see pinball/CLAUDE.md, "the whole scene is MIRRORED").
// So the mount wrapper scales by (K, K, -K), INSIDE the model group: the export's +x follows table
// +x and the group's own mirror does the rest (setting -K here instead put the launch chute on the
// left), and the -z turns the export's "toward the player" into render3d's -z.

import * as THREE from './vendor/three.module.min.js';
import { Renderer } from './render3d.js';
import { buildBoard } from '../design/board.js';
import T, { W, H, AXIS, px } from './table-design.js';

const K = 666.67;
const tz = (y) => -y;

/** How far the plunger rod travels, in world units - 26 reference px of board. */
const PLUNGER_TRAVEL = 26 * 0.000527;

/**
 * WHERE THE PLAYFIELD SURFACE ACTUALLY IS, in the units the ball is positioned in.
 *
 * board.js puts the lower playfield's top face at Y1 = 0.020 m, and the mount scales the whole
 * model by K = 666.67 with the stage at y 0 - so that face lands at 13.33 units. The ball was
 * drawn at `y = 9 + lift`, which is BALL_R and nothing else, inherited from STARHUB where the
 * playfield top was y = 0. On this board that put the ball's centre 13.33 units UNDER the wood:
 * of its 18 units of diameter only the top 4.67 showed. The shadow at `y = 0.9` was worse -
 * inside the black cabinet_floor box and under the whole playfield slab, so the contact shadow
 * that tells you what the ball is over was never visible at all.
 *
 * `lift` is already correct: px(95) = 33.38 matches (Y2 - Y1) * K = 33.33. Only the BASE was
 * missing.
 */
const SURFACE_Y = 0.020 * 666.67;   // 13.33 - the lower playfield's top face

export class DesignRenderer extends Renderer {
  _build(root) {
    this.parts3 = this.parts3 || {};
    // Nearly straight down: this is a flat wooden sheet, not a cabinet with an arch to show off.
    this.tilt = 11;

    const stage = new THREE.Group();
    stage.scale.set(K, K, -K);
    stage.position.set(px(493), 0, tz(px(995)));
    stage.add(buildBoard(THREE));
    root.add(stage);
    this.parts3.stage = stage;

    // The two levels, so either can be shown alone (`parts3.upper.visible = false`).
    this.parts3.upper = [];
    stage.traverse((o) => { if (o.userData && o.userData.level === 2) this.parts3.upper.push(o); });

    // Evenly lit from above, which is what the reference is. The base class's studio is built for
    // STARHUB - one warm key raking across a near-black deck - and on wood that reads as dusk.
    for (const o of this.scene.children) {
      if (o.isHemisphereLight) { o.intensity = 1.0; o.color.setHex(0xffffff); o.groundColor.setHex(0xc9b092); }
      else if (o.isDirectionalLight) { o.color.setHex(0xfffaf2); o.intensity = o.castShadow ? 1.05 : 0.3; }
      else if (o.isPointLight) o.intensity = 0;
    }

    this._buildBackglass(root);
    this._buildBalls(root);
  }

  render(game, dt) {
    if (!this.ok) return;
    this.time += dt;
    this._age(dt);
    const hud = game.hud();

    // `P` IS DECLARED BEFORE ANYTHING READS IT, AND THAT IS NOT A STYLE POINT. The plunger block
    // below was added above this line, which put `P` in its temporal dead zone: every frame threw
    // `ReferenceError: Cannot access 'P' before initialization` - before the flipper loop, before
    // the ball loop, before renderer.render(). js/ui.js re-arms the animation frame at the TOP of
    // _frame and calls this unguarded, so the loop survived and the physics kept stepping while
    // the canvas stayed on its last drawn frame. The board did not render at all for five deploys.
    // Anything new in render() goes BELOW this line.
    const P = this.parts3;

    // THE PLUNGER PULLS BACK. Matt: *"fix the chute launcher thing (doesn't move when you press
    // launch so you can't tell how hard it's gunna go or how long to hold it down for)."* It
    // never moved: the rod is built once and nothing here ever touched it, so the only feedback
    // for a power that climbs over most of a second was a number. The rod now sits back by up to
    // 26 px of board, which is the whole travel, so the pull is the gauge.
    const rod = P.stage && P.stage.getObjectByName('plunger_rod');
    if (rod) {
      if (rod.userData.restZ === undefined) rod.userData.restZ = rod.position.z;
      const pull = (hud.onPlunger ? (hud.power || 0) : 0);
      // eased so the last of the travel is visibly slower, the way a real spring stiffens
      const e = pull * (2 - pull);
      rod.position.z = rod.userData.restZ + e * PLUNGER_TRAVEL;
    }

    // THE FOUR PADDLES, AND TWO THINGS THAT BOTH HAVE TO BE RIGHT.
    //
    // Matt, on the shipped build: *"none of the paddles move."* Neither half was visible headlessly.
    //
    // 1. The mesh is not called what the footprint is called. board.js builds each flipper as a
    //    pivot GROUP named `<name>_pivot`, so getObjectByName(f.id) returned undefined on every
    //    frame and this loop did nothing at all, silently.
    // 2. That group already carries the paddle's REST YAW. Assigning rotation.y throws it away
    //    and points every paddle down +x. The swing is ADDED to the group's own base angle,
    //    captured once - and it is subtracted, because a table angle t maps to rotation.y = -t:
    //    board.js's yaw() is atan2(-dz, dx) against the footprint's own atan2(dz, dx).
    for (const f of game.flippers) {
      const m = P.stage.getObjectByName(f.id + '_pivot');
      if (!m) continue;
      if (m.userData.baseYaw === undefined) m.userData.baseYaw = m.rotation.y;
      m.rotation.y = m.userData.baseYaw - (f.angle - f.rest);
    }

    let n = 0;
    for (const b of game.balls) {
      if (!b.live || n >= P.balls.length) continue;
      const m = P.balls[n++];
      const sh = P.ballShadows[n - 1];
      // A ball on the upper deck rides at the deck's height; b.layer is what the solver stepped it
      // on, so this cannot disagree with the physics.
      // `b.lift` is the ball's height between the two decks, 0 on the playfield and 1 up top. It is
      // a real number, not a flag, because a ball climbing a ramp is part way up for half a second
      // and drawing that as a jump is what made the ramp look like a teleport.
      const lift = px(95) * (b.lift !== undefined ? b.lift : (((b.layer | 0) === 2) ? 1 : 0));
      m.visible = true;
      m.position.set(b.x, SURFACE_Y + 9 + lift, tz(b.y));
      sh.visible = true;
      sh.position.set(b.x, SURFACE_Y + 0.9 + lift, tz(b.y));
      sh.scale.setScalar(1);
      sh.material.opacity = 1;
    }
    for (let i = n; i < P.balls.length; i++) { P.balls[i].visible = false; P.ballShadows[i].visible = false; }

    if (this.shake > 0.05) {
      const s = this.shake * 0.6;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }

    const sig = `${hud.score}|${hud.ball}|${hud.ramps}`;
    if (sig !== this._bbSig) {
      this._bbAge = (this._bbAge || 0) + dt;
      if (this._bbAge > 0.08) { this._bbAge = 0; this._bbSig = sig; this._bbDirty = true; }
    }
    if (this._bbDirty) { this._bbDirty = false; this._drawBackglass(hud); }
    this.renderer.render(this.scene, this.camera);
    this._drawFx(hud);
  }

  /** This board has no spinner and no drop bank of its own; ui.js is board-agnostic and calls both. */
  hitSpinner() { /* none */ }
  hitRamp() { this.rampGlow = 1; }
}

export default { DesignRenderer };
