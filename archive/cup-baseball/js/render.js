// cup-baseball/js/render.js - Cup Pong's table (cup-pong/js/render.js), plus what this game adds:
// each cup's hit painted on the felt beside it (1B, 2B, 3B, HR), at both ends of the table.
// Everything else (the room, the cups, the ball, the two camera views, the WebGL hygiene rules) is
// Cup Pong's, inherited as is.
import * as THREE from '../../skeeball/js/vendor/three.module.min.js';
import { Renderer as CupPongRenderer } from '../../cup-pong/js/render.js';
import { CUP } from '../../cup-pong/js/geom.js';
import { CUPS } from './field.js';

const LABEL = { 1: '1B', 2: '2B', 3: '3B', 4: 'HR' };

export class Renderer extends CupPongRenderer {
  constructor(canvas, opts) {
    super(canvas, opts);
    this._labels = [];
    for (const side of ['a', 'b']) {
      this.setRack(side, CUPS);
      for (const k of CUPS) this._label(side, k);
    }
  }

  /** The hit beside the cup, to the viewer's right, flat at rim height. Both camera views look down the
   *  table toward -z, so one orientation reads upright at both ends. */
  _label(side, k) {
    const W = 128, H = 64;
    const tex = this._canvasTex(W, H, (g) => {
      g.font = '900 52px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 8; g.strokeStyle = 'rgba(0,60,25,0.45)'; g.strokeText(LABEL[k.hit], W / 2, H / 2 + 3);
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillText(LABEL[k.hit], W / 2, H / 2 + 3);
    });
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const w = 0.11;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w * H / W), mat);
    mesh.rotation.set(-Math.PI / 2, 0, 0);
    const p = this.toWorld(side, k.x, k.z);
    // At RIM height, not on the felt: with the cups touching, a label on the felt lines up with the
    // cup's base, which the eye reads as the NEXT cup's rim.
    mesh.position.set(p.x + CUP.topR + 0.07, CUP.h, p.z);
    mesh.renderOrder = 1;
    this.scene.add(mesh);
    this._labels.push(mesh);
  }

  /** The cup that was hit gets the accent ring for a moment (thickness is the non-colour cue). */
  flash(side, id) { this.setMarks(side, id ? [id] : null, 'called'); }
}

export default { Renderer };
