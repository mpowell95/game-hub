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
    const P = this.parts3;

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
      const lift = ((b.layer | 0) === 2) ? px(95) : 0;
      m.visible = true;
      m.position.set(b.x, 9 + lift, tz(b.y));
      sh.visible = true;
      sh.position.set(b.x, 0.9 + lift, tz(b.y));
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
