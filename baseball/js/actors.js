// actors.js - the WebGL layer (docs/BASEBALL-3D-BUILD.md section 3.5). One class, no engine
// knowledge. It owns a second canvas over the painted field and the two figures. field.js keeps
// painting the backdrop, the zone, the ball's trail and the overhead cut on the 2D canvas
// underneath (`.bb-field-canvas`, z-index 1); this canvas (`.bb-actor-canvas`) sits above it at
// z-index 2, `.bb-pop` stays at 3.
//
// STAGE 1: load/resize/place/start/pause/dispose work end to end, against the section 2.1
// SCAFFOLD asset (RobotExpressive.glb) or, once section 2.2 is filled, baseball/models/player.glb.
// STAGE 3: setBatter/setPitcher do the recolour half (section 2.2's colour-key remap) and place()
// when an anchor is given; the aim-shift/mirror maths that reads live game state is still stage 4
// (section 3.6) - the live play screen still draws the sprite path today, this file is proven from
// the dev screen (ui.js's _openFrameCheck) and render-actor.mjs/test-baseball-actors.mjs.
import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { clone as cloneSkinned } from './vendor/SkeletonUtils.js';
import { RIG, resolveRig } from './rig.js';
import { CLIPS, buildClip } from './poses.js';
import { onViewportResize } from '../../js/viewport.js';

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

// STAGE 3 (section 2.2): team colours are a colour-key remap of the painted skin PNG - there is no
// "Jersey" material to recolour, the uniform is painted into the texture. KEYS lists, per skin per
// side, which SOURCE colours (measured straight off the shipped PNGs, `python3 -c "PIL..."` pixel
// counts, not guessed) get replaced and with what. Two colours never appear here: skin tones (the
// #f58c6a..#f59777 AA family - every skin's face/arms shade through it) and hair. skaterMaleA's own
// exploratory palette (section 2.2's table) lists `#f59170` as part of the "shirt" - measured
// again here, it sits only (0,5,6) away from the skin anchor #f58c6a, well inside any tolerance
// used below, so keying it would also recolour a sliver of skin every time a jersey changes
// colour. Left out on purpose.
const COLOR_TOL = 6;   // default, per channel - "a few units" (section 2.2)
// Sampled from reference/baseball/batter-home-1.png (cream jersey, navy pinstripe/cap trim) and
// batter-away-1.png (navy jersey; pants grey reused here as the away trim, since criminalMaleA's
// own away needs a light colour for its green trim and the away sprite set has no third hue).
const HOME_CREAM = 0xf5ecd6;
const NAVY = 0x25395c;
const AWAY_GREY = 0xc9c9c9;
// skaterMaleA's tee is PAINTED AS A GRADIENT, not a flat fill - a vertical light falloff from
// #ea3031 (dark, the collar/hem) up to #f2654c (bright, the torso's own middle) and back down,
// measured sampling a column straight down the shirt (`python3 -c "PIL...getpixel"` every 40px).
// A single default-tolerance key at #f2654c (COLOR_TOL=6) only ever covered the mid-band - the
// first render of this clip against Pitcher-home-1.png still showed a visible red-orange collar
// and hem, uncorrected, which is what caught this. The gradient's own G channel runs 48..101 (the
// widest-swinging channel); a tolerance of 28 on EACH of the two measured endpoints closes the gap
// between them (their tolerance windows overlap at G=73..76) while staying clear of skin: skin's
// own G is 140+, a 39-unit gap from the brighter endpoint's own G=101, so no COLOR_TOL widening
// here ever risks keying skin. `#e4783e`, the shirt's separate fold-shadow colour, needs no key of
// its own - it already falls inside `#f2654c`'s widened window (measured).
const SHIRT_TOL = 28;
export const KEYS = {
  skaterMaleA: {
    home: [
      { from: [0xea, 0x30, 0x31], to: HOME_CREAM, tol: SHIRT_TOL },
      { from: [0xf2, 0x65, 0x4c], to: HOME_CREAM, tol: SHIRT_TOL },
    ],
    away: [
      { from: [0xea, 0x30, 0x31], to: NAVY, tol: SHIRT_TOL },
      { from: [0xf2, 0x65, 0x4c], to: NAVY, tol: SHIRT_TOL },
    ],
  },
  criminalMaleA: {
    // Flat fills, not a gradient (measured the same way) - the default COLOR_TOL is enough. Home
    // is "as painted" (section 2.2): the white suit is untouched, only the collar/cuff trim (its
    // main fill #009f78 and its own fold-shadow #037e60) is keyed, to the navy accent.
    home: [{ from: [0x00, 0x9f, 0x78], to: NAVY }, { from: [0x03, 0x7e, 0x60], to: NAVY }],
    // Away: the white suit (#ffffff, the skin's single biggest fill - measured 373k of 1,048,576
    // px) becomes the navy jersey; the trim keys to grey/white instead of navy so it still reads
    // as trim against a now-navy body.
    away: [{ from: [0xff, 0xff, 0xff], to: NAVY }, { from: [0x00, 0x9f, 0x78], to: AWAY_GREY }, { from: [0x03, 0x7e, 0x60], to: AWAY_GREY }],
  },
};

const _skinImgCache = new Map();   // skinName -> loaded HTMLImageElement (raw, unrecoloured)
const _skinTexCache = new Map();   // `${skinName}:${side}` -> CanvasTexture, remapped once and reused

/** Load models/skins/<skin>.png, remap KEYS[skin][side]'s colours on a 2D canvas, cache the
 *  CanvasTexture per (skin, side) so a repeated side change never re-fetches or re-remaps. `side`
 *  outside KEYS[skin] (or missing entirely) renders the skin as painted, untouched - a real skin
 *  never asks for a side this table doesn't carry, but a caller passing one back gets the art
 *  rather than a thrown error (section 6: never a silent empty field, the same discipline as a
 *  load-error screen). three's TextureLoader default (flipY = true) is correct for this glb
 *  (section 2.1 TEXTURE RULE) - a CanvasTexture carries the same default, so nothing extra is set. */
async function skinTexture(skinName, side) {
  const cacheKey = `${skinName}:${side}`;
  const cached = _skinTexCache.get(cacheKey);
  if (cached) return cached;
  let img = _skinImgCache.get(skinName);
  if (!img) {
    const url = new URL(`../models/skins/${skinName}.png`, import.meta.url).href;
    img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error(`skinTexture: ${url} failed to load`));
      im.src = url;
    });
    _skinImgCache.set(skinName, img);
  }
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const keys = (KEYS[skinName] && KEYS[skinName][side]) || [];
  if (keys.length) {
    const targets = keys.map((k) => ({ from: k.from, to: [(k.to >> 16) & 255, (k.to >> 8) & 255, k.to & 255], tol: k.tol || COLOR_TOL }));
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;   // transparent: nothing to key
      for (const k of targets) {
        if (Math.abs(d[i] - k.from[0]) <= k.tol && Math.abs(d[i + 1] - k.from[1]) <= k.tol && Math.abs(d[i + 2] - k.from[2]) <= k.tol) {
          d[i] = k.to[0]; d[i + 1] = k.to[1]; d[i + 2] = k.to[2];
          break;   // first matching key wins; KEYS never lists two overlapping sources for one skin/side
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  _skinTexCache.set(cacheKey, tex);
  return tex;
}

/** Casting (section 2.2): home is skaterMaleA, away is criminalMaleA. Not a free choice per actor
 *  today - the human's team is always home, the CPU's is always away, so the skin follows the
 *  side. A later phase that lets a person pick a skin independent of side would take this over. */
function skinForSide(side) { return side === 'away' ? 'criminalMaleA' : 'skaterMaleA'; }

// STAGE 2: the batter's facing (docs/BASEBALL-3D-BUILD.md section 3.5's `_place` facingRad). The
// sprite frames (reference/baseball/batter-home-1..8.png) show a right-handed batter seen from
// behind the plate: mostly his back and right shoulder, with the chest only partly turned toward
// the camera. rotation.y = +90deg alone (the model's +Z front pointed exactly screen-right) read
// as a flatter profile than the sprites; tuned by rendering CLIPS.Idle beside batter-home-1.png
// (render-actor.mjs --facing 90/100/105/110) - 95deg was the closest match and is barely
// distinguishable from the neighbouring angles tried, so this is a small, deliberately round
// number in that range, not a fit to the exact pixel.
export const BATTER_FACING_RAD = 95 * Math.PI / 180;

// STAGE 3: the pitcher's facing. The brief calls for the pitcher facing the CAMERA (the plate),
// square-on rather than sideways like the batter - and rendering confirms facingRad=0 (no extra
// rotation past the model's own bind pose) already does that: a bare bind-pose sweep at
// 0/45/90/135/180/225/270/315 (render-actor.mjs --role pitcher) shows the face square at 0deg and
// the back of the head at 180deg, so 0 is not a fallback default here, it is the measured answer.
// poses.js's own header has the one fact that reading this number alone would miss: at facingRad=0
// the model's RightArm/RightUpLeg bones land on SCREEN-LEFT, not screen-right - confirmed by
// rotating upperLegR alone and rendering, since a T-pose's arms-out silhouette can't show it. That
// is what fixes CLIPS.Pitch's `handR` as the visible throwing arm at the release keyframe.
export const PITCHER_FACING_RAD = 0;

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
    // image in the file), so a render before any skin arrives would be flat grey. The home
    // skaterMaleA texture is the placeholder every actor is BUILT with (_makeActor, below) so
    // neither figure is ever untextured for a frame; load() then casts each role to its real side.
    const [gltf, placeholderTex] = await Promise.all([new GLTFLoader().loadAsync(url), skinTexture('skaterMaleA', 'home')]);
    this._proto = gltf.scene;
    this._fileClips = gltf.animations || [];
    this._placeholderTex = placeholderTex;
    for (const role of ['batter', 'pitcher']) this.actors[role] = this._makeActor(role);
    // Default casting (section 2.2): the human's team (home) is skaterMaleA, the CPU (away) is
    // criminalMaleA. A placeholder until stage 4's game-state wiring calls setBatter/setPitcher
    // with the real per-half-inning side - it is what lets the dev screen and render-actor.mjs
    // show a sensible home/away pair with no caller at all.
    await Promise.all([this.setBatter({ side: 'home' }), this.setPitcher({ side: 'away' })]);
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
    // Clone the materials this actor touches so the two figures stay independent (`setBatter`/
    // `setPitcher` swap `material.map` per actor). `material.color` stays white so the texture
    // shows true - a tint here would colour skin and hair along with the uniform, exactly what
    // section 2.2's colour-key remap exists to avoid doing the cheap way. Painted with the home
    // placeholder texture until `load()`'s own setBatter/setPitcher casts the real side below.
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      o.frustumCulled = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { m.map = this._placeholderTex; m.color.set(0xffffff); m.needsUpdate = true; }
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

  /** The recolour half of setBatter/setPitcher (section 2.2/3.5): cast `role` to `side`, remap its
   *  materials to that side's CanvasTexture (skipping the swap when the side hasn't actually
   *  changed and a texture is already applied, so a caller can pass `side` on every frame with no
   *  per-frame texture churn), then place() when an anchor is supplied - `mirrored` is passed
   *  through as given (undefined leaves the actor's current mirror state alone) so a caller that
   *  only wants a recolour can omit it. The aim-shift maths (`aimX`, `bats`/`throws` beyond the
   *  mirror flip) is stage 4's (section 3.6) - not read here yet. */
  async _setSide(role, { side, anchor, heightPx, facingRad, mirrored } = {}) {
    const actor = this.actors[role];
    if (!actor) return;
    if (side && (side !== actor.side || !actor._skinApplied)) {
      actor.side = side;
      const tex = await skinTexture(skinForSide(side), side);
      actor.root.traverse((o) => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { m.map = tex; m.color.set(0xffffff); m.needsUpdate = true; }
      });
      actor._skinApplied = true;
    }
    if (anchor && heightPx != null) {
      this.place(role, {
        anchor, heightPx,
        facingRad: facingRad != null ? facingRad : (actor._last ? actor._last.facingRad : 0),
        mirrored: mirrored != null ? mirrored : actor.mirrored,
      });
    }
  }
  setBatter({ side, bats, aimX, anchor, heightPx } = {}) {
    return this._setSide('batter', { side, anchor, heightPx, mirrored: bats != null ? bats === 'L' : undefined });
  }
  setPitcher({ side, throws, anchor, heightPx } = {}) {
    return this._setSide('pitcher', { side, anchor, heightPx, mirrored: throws != null ? throws === 'L' : undefined });
  }

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
    // Materials are cloned per actor (_makeActor) so disposing them here is safe; their `.map` is
    // NOT - skinTexture()'s CanvasTexture cache is module-level, shared by every Actors instance
    // and every (skin, side) it has ever cast, on purpose (a side change or a dev-screen reopen
    // must never re-fetch or re-remap). Disposing a shared texture here would leave every OTHER
    // instance still holding that cache entry pointed at a dead GPU resource - the very next
    // setBatter/setPitcher call (or dev-screen reopen) would render that side blank. Geometry is
    // still per-actor and still disposed; the bat's own geometry/material are covered by the same
    // traversal (they are real children of handR, section 3.5).
    for (const a of Object.values(this.actors)) if (a) { a.mixer.stopAllAction(); a.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); }); }
    if (this.renderer) { this.renderer.dispose(); this.renderer.forceContextLoss(); }
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    this.renderer = null; this.scene = null; this.ready = false;
  }
}
