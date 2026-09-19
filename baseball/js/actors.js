// actors.js - the WebGL layer (docs/BASEBALL-3D-BUILD.md section 3.5). One class, no engine
// knowledge. It owns a second canvas over the painted field and the two figures. field.js keeps
// painting the backdrop, the zone, the ball's trail and the overhead cut on the 2D canvas
// underneath (`.bb-field-canvas`, z-index 1); this canvas (`.bb-actor-canvas`) sits above it at
// z-index 2, `.bb-pop` stays at 3.
//
// STAGE 1: load/resize/place/start/pause/dispose work end to end, against the section 2.1
// SCAFFOLD asset (RobotExpressive.glb) or, once section 2.2 is filled, baseball/models/player.glb.
// setBatter/setPitcher/setBall are still stage 4 stubs - the live play screen keeps drawing the
// sprite path unchanged; this file is proven from the dev screen only (ui.js's _openFrameCheck).
import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { clone as cloneSkinned } from './vendor/SkeletonUtils.js';
import { RIG, resolveRig } from './rig.js';
import { CLIPS, buildClip } from './poses.js';
import { onViewportResize } from '../../js/viewport.js';

const TEAM = { home: { jersey: 0xf4f1ea, cap: 0x1c2a4a }, away: { jersey: 0x1c2a4a, cap: 0x1c2a4a } }; // sampled from the sprite sets, stage 3 fixes the hexes
const CROSSFADE_S = 0.15;
const DPR_CAP = 2;
// The bat, in fractions of the model's own height; tuned by eye in the dev screen (stage 3).
// STAGE 2 CORRECTION (coordinator review, round 1): the cylinder in _attachBat is built CENTERED
// on its own local origin (CylinderGeometry's default), so at pos=[0,0,0] the hand held the
// MIDDLE of the bat, with the knob sticking out past the grip - unreadable on the sheet ("the
// grip is at the bat's middle... the knob should be in the hands and the barrel far from them").
// pos[1] = length/2 shifts the whole mesh up its own (pre-rotation) local Y by half its own
// length, so the knob end (local -Y) lands back at the hand's origin and the barrel end
// (local +Y) sits a full bat-length away. This is expressed in the cylinder's OWN unrotated
// frame - if a later `rot` moves off [0,0,0], this offset must rotate along with it or the grip
// drifts off the hand again. Stage 3 owns the fine tuning; this one number is fixed now because
// the sheet was unreadable without it.
export const BAT = { length: 0.48, knobR: 0.012, barrelR: 0.028, pos: [0, 0.24, 0], rot: [0, 0, 0], color: 0xc9a06a };

// STAGE 2: the default skin, painted as shipped (section 2.2 - no team colour-key remap yet, that
// is stage 3). Loaded once and shared by every actor: `material.map` is the only per-actor thing,
// so a cloned material can hold this same texture without a second network fetch.
const DEFAULT_SKIN_URL = new URL('../models/skins/skaterMaleA.png', import.meta.url).href;
let _skinTexPromise = null;
function loadDefaultSkinTexture() {
  // three's TextureLoader default (flipY = true) is correct for this glb (section 2.1 TEXTURE
  // RULE: the UVs came through FBXLoader in three's own convention) - do not set flipY false.
  if (!_skinTexPromise) _skinTexPromise = new THREE.TextureLoader().loadAsync(DEFAULT_SKIN_URL)
    .then((tex) => { tex.colorSpace = THREE.SRGBColorSpace; return tex; });
  return _skinTexPromise;
}

// STAGE 2: the batter's facing (docs/BASEBALL-3D-BUILD.md section 3.5's `_place` facingRad). The
// sprite frames (reference/baseball/batter-home-1..8.png) show a right-handed batter seen from
// behind the plate: mostly his back and right shoulder, with the chest only partly turned toward
// the camera. rotation.y = +90deg alone (the model's +Z front pointed exactly screen-right) read
// as a flatter profile than the sprites; tuned by rendering CLIPS.Idle beside batter-home-1.png
// (render-actor.mjs --facing 90/100/105/110) - 95deg was the closest match and is barely
// distinguishable from the neighbouring angles tried, so this is a small, deliberately round
// number in that range, not a fit to the exact pixel.
export const BATTER_FACING_RAD = 95 * Math.PI / 180;

export class Actors {
  constructor(wrapEl) {
    this.wrapEl = wrapEl;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'bb-actor-canvas';
    this.canvas.style.pointerEvents = 'none';
    wrapEl.appendChild(this.canvas);
    this.renderer = null; this.scene = null; this.camera = null;
    this.actors = { batter: null, pitcher: null };   // each: { role, pivot, root, bones, restQ, mixer, actions, current, heightWorld, footY, side, mirrored, _last }
    this.ball = null;
    this.ready = false;
    this._raf = 0; this._last = 0; this._running = false;
    this._offResize = null;
    this._w = 0; this._h = 0; this._cover = null;
    this._proto = null; this._fileClips = [];
    this._preserve = !!(globalThis.__bbTest);   // the test reads pixels back; nobody else pays for it
  }

  /** Create the renderer. Separate from the constructor so a missing WebGL context is a value the
   *  caller can branch on, not a throw during mount. Returns false when WebGL is unavailable. */
  initGL() {
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true,
        powerPreference: 'low-power', preserveDrawingBuffer: this._preserve });
    } catch { this.renderer = null; return false; }
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(DPR_CAP, window.devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x5a7a3a, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(-300, 500, 400); this.scene.add(sun);
    // Orthographic, in CANVAS PIXELS: world (x, -y) is screen (x, y). Every position below is fed
    // straight from field.js's anchor fractions, so the figures cannot drift from the painted picture.
    this.camera = new THREE.OrthographicCamera(0, 1, 0, -1, -2000, 2000);
    this.camera.position.set(0, 0, 1000);
    this.camera.lookAt(0, 0, 0);
    this._offResize = onViewportResize(() => { /* ui.js calls resize() with the real size */ });
    return true;
  }

  async load(url) {
    // Loaded together: the model has no embedded texture (section 2.1 - one "Skin" material, no
    // image in the file), so a render before the skin arrives would be flat grey. Stage 3 replaces
    // this with the colour-keyed, per-team remap (section 2.2); stage 2 only needs it readable.
    const [gltf, skinTex] = await Promise.all([new GLTFLoader().loadAsync(url), loadDefaultSkinTexture()]);
    this._proto = gltf.scene;
    this._fileClips = gltf.animations || [];
    this._defaultSkinTex = skinTex;
    for (const role of ['batter', 'pitcher']) this.actors[role] = this._makeActor(role);
    this.ready = true;
  }

  _makeActor(role) {
    const root = cloneSkinned(this._proto);
    const bones = resolveRig(root);
    const restQ = {}; for (const k of Object.keys(bones)) if (bones[k]) restQ[k] = bones[k].quaternion.clone();
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const heightWorld = box.max.y - box.min.y;
    const footY = box.min.y;   // so the feet, not the origin, sit on the anchor
    // Recolour by team: clone the materials this actor touches so the two figures stay independent.
    // STAGE 2: the skin PNG as painted, `material.color` left white so the texture shows true (a
    // tint here would colour skin and hair along with the uniform - section 3.5's own note, and
    // exactly what stage 3's colour-key remap exists to avoid doing the cheap way).
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      o.frustumCulled = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { m.map = this._defaultSkinTex; m.color.set(0xffffff); m.needsUpdate = true; }
    });
    const mixer = new THREE.AnimationMixer(root);
    const actions = {};
    // Every clip the FILE itself carries, playable by its own name (e.g. the scaffold's 'Idle',
    // 'Dance', 'Wave') - this is what lets play() and the dev screen work before any pose is
    // authored. A CLIPS entry with the same name supplies loop/clamp; an unknown file clip loops.
    for (const fileClip of this._fileClips) {
      const def = CLIPS[fileClip.name];
      const a = mixer.clipAction(fileClip, root);
      a.setLoop(def && !def.loop ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      a.clampWhenFinished = !!(def && !def.loop);
      actions[fileClip.name] = a;
    }
    // Authored clips (poses.js) override a same-named file clip once they carry real keys.
    for (const [name, def] of Object.entries(CLIPS)) {
      if (!def.keys.length) continue;
      const clip = buildClip(name, def.keys, bones, restQ);
      const a = mixer.clipAction(clip);
      a.setLoop(def.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = !def.loop;
      actions[name] = a;
    }
    const pivot = new THREE.Group();       // pivot carries position/scale/mirror; root carries facing
    pivot.add(root);
    this.scene.add(pivot);
    const actor = { role, pivot, root, bones, restQ, mixer, actions, current: null, heightWorld, footY, side: 'home', mirrored: false, shadow: null, _last: null };
    actor.shadow = this._makeShadow(); pivot.add(actor.shadow);
    if (role === 'batter') this._attachBat(actor);
    return actor;
  }

  _makeShadow() {
    const m = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; return m;   // scaled per actor in _place
  }

  _attachBat(actor) {
    const h = actor.heightWorld;
    // The bat is a plain rigid Mesh, not a skinned one, so unlike the body it does NOT travel
    // through the skinning matrices that keep the mesh's WORLD size independent of any individual
    // bone's own scale. It is a real child of the hand bone, so its geometry must be authored in
    // that bone's LOCAL space: divide the intended world-unit size by the hand bone's own world
    // scale (usually 1, but this scaffold's Palm2R bakes in ~100x, an FBX cm->m correction, and a
    // bat sized as if that scale were 1 fills the whole camera - found rendering the stage 1 dev
    // screen against RobotExpressive.glb, not assumed).
    const handScale = new THREE.Vector3(); actor.bones.handR.getWorldScale(handScale);
    const sx = handScale.x || 1, sy = handScale.y || 1;
    const g = new THREE.CylinderGeometry((BAT.barrelR * h) / sx, (BAT.knobR * h) / sx, (BAT.length * h) / sy, 12);
    const bat = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: BAT.color, roughness: 0.6 }));
    bat.position.set((BAT.pos[0] * h) / sx, (BAT.pos[1] * h) / sy, (BAT.pos[2] * h) / sx);
    bat.rotation.set(BAT.rot[0] * Math.PI / 180, BAT.rot[1] * Math.PI / 180, BAT.rot[2] * Math.PI / 180);
    actor.bones.handR.add(bat); actor.bat = bat;
  }

  /** Called by ui.js from _sizeCanvas with the 2D canvas's CSS size and field.js's plateCover(). */
  resize(w, h, cover) {
    if (!this.renderer) return;
    this._w = w; this._h = h; this._cover = cover;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.camera.left = 0; this.camera.right = w; this.camera.top = 0; this.camera.bottom = -h;
    this.camera.updateProjectionMatrix();
    this._placeAll();
  }

  /** anchor {x,y} in canvas px (feet), heightPx the figure's on-screen height. */
  _place(actor, anchor, heightPx, facingRad) {
    const s = heightPx / actor.heightWorld;
    actor.pivot.position.set(anchor.x, -anchor.y, actor.role === 'batter' ? 10 : 0);
    actor.pivot.scale.set(actor.mirrored ? -s : s, s, s);
    actor.root.position.y = -actor.footY;
    actor.root.rotation.y = facingRad;
    actor.shadow.scale.set(actor.heightWorld * 0.22, actor.heightWorld * 0.10, 1);
    actor.shadow.position.y = 0.5;
  }

  /** Place one actor now, and remember it so a later resize (a rotate, a keyboard opening) can
   *  reflow it without the caller having to re-supply the anchor. setBatter/setPitcher (stage 4)
   *  are expected to call this once they know the real per-frame anchor/aim math; stage 1's dev
   *  screen (3.7) calls it directly with field.js's own PLATE_ANCHORS fractions, since those are
   *  the "real anchors" the stage 1 check asks for. */
  place(role, { anchor, heightPx, facingRad = 0, mirrored = false }) {
    const actor = this.actors[role];
    if (!actor) return;
    actor.mirrored = mirrored;
    actor._last = { anchor, heightPx, facingRad };
    this._place(actor, anchor, heightPx, facingRad);
  }
  _placeAll() {
    for (const actor of Object.values(this.actors)) {
      if (actor && actor._last) this._place(actor, actor._last.anchor, actor._last.heightPx, actor._last.facingRad);
    }
  }

  setBatter({ side, bats, aimX, anchor, heightPx }) { /* stage 4: recolour, mirror on 'L', place at anchor + aim shift, facing */ }
  setPitcher({ side, throws, anchor, heightPx }) { /* stage 4 */ }

  /** Play `name` on `role` so that the clip's mark lands `markAtMs` from now (0 = seek straight to the mark). */
  play(role, name, { markAtMs = null } = {}) {
    const actor = this.actors[role]; const a = actor && actor.actions[name];
    if (!a) return;
    const def = CLIPS[name];
    a.reset(); a.enabled = true; a.setEffectiveWeight(1);
    if (def && def.mark != null && markAtMs != null) {
      if (markAtMs <= 0) { a.time = def.mark; a.timeScale = 1; }
      else a.timeScale = def.mark / (markAtMs / 1000);
    } else a.timeScale = 1;
    if (actor.current && actor.current !== a) actor.current.crossFadeTo(a, CROSSFADE_S, false);
    a.play(); actor.current = a;
  }
  idle(role) { this.play(role, role === 'pitcher' ? 'Set' : 'Idle'); }

  setBall(b) { /* stage 4: {x, y, r} in canvas px from field.js plateBallPos, or null to hide */ }

  start() { if (this._running) return; this._running = true; this._last = performance.now(); const tick = (now) => { if (!this._running) return; const dt = Math.min(0.05, (now - this._last) / 1000); this._last = now; for (const a of Object.values(this.actors)) if (a) a.mixer.update(dt); this.renderer.render(this.scene, this.camera); this._raf = requestAnimationFrame(tick); }; this._raf = requestAnimationFrame(tick); }
  pause() { this._running = false; if (this._raf) cancelAnimationFrame(this._raf); this._raf = 0; }
  resume() { if (this.ready) this.start(); }

  dispose() {
    this.pause();
    if (this._offResize) this._offResize();
    for (const a of Object.values(this.actors)) if (a) { a.mixer.stopAllAction(); a.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); }); }
    if (this.renderer) { this.renderer.dispose(); this.renderer.forceContextLoss(); }
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    this.renderer = null; this.scene = null; this.ready = false;
  }
}
