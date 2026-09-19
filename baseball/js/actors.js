// actors.js - the WebGL layer (docs/BASEBALL-3D-BUILD.md section 3.5). One class, no engine
// knowledge. It owns a second canvas over the painted field and the two figures. field.js keeps
// painting the backdrop, the zone, the ball's trail and the overhead cut on the 2D canvas
// underneath (`.bb-field-canvas`, z-index 1); this canvas (`.bb-actor-canvas`) sits above it at
// z-index 2, `.bb-pop` stays at 3.
//
// STAGE 1: load/resize/place/start/pause/dispose work end to end, against the section 2.1
// SCAFFOLD asset (RobotExpressive.glb) or, once section 2.2 is filled, baseball/models/player.glb.
// STAGE 3: setBatter/setPitcher do the recolour half (section 2.2's colour-key remap) and place()
// when an anchor is given.
// STAGE 4 (section 3.6): the live play screen now drives this class directly - ui.js computes the
// aim-shifted anchor itself (field.js's own anchorPx/BATTER_AIM_TRAVEL_FRAC, exported for exactly
// this) and calls setBatter/setPitcher on every redraw, and setBall/handWorldPx below are new. The
// dev screen (ui.js's _openFrameCheck) and render-actor.mjs/test-baseball-actors.mjs still work the
// same way they always did - nothing about this class's own surface changed shape for them.
import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { clone as cloneSkinned } from './vendor/SkeletonUtils.js';
import { RIG, resolveRig } from './rig.js';
import { CLIPS, buildClip } from './poses.js';
import { onViewportResize } from '../../js/viewport.js';

const CROSSFADE_S = 0.15;
const DPR_CAP = 2;
// STAGE 4: `start()`'s own render-rate cap, applied ONLY under software GL - see `isSoftGL()` and
// `start()`'s own header for the measured reason (R2 cadence) and why it must not reach real
// hardware.
const RENDER_FRAME_MS = 1000 / 20;

/** Is this a SOFTWARE GL context (SwiftShader, llvmpipe)? Copied from `pinball/js/render3d.js`
 *  (lines 78-95 as of this stage - that file's own header: "a software rasteriser cannot afford
 *  [the full cost]... the headless browsers the visual suite runs in are all software"). Memoised,
 *  so the probe happens once per page rather than once per Actors instance, and the probe context
 *  is handed back immediately - never throws, an unanswerable probe means "not software". */
let SOFT_GL = null;
function isSoftGL() {
  if (SOFT_GL !== null) return SOFT_GL;
  let soft = false;
  let probe = null;
  try {
    probe = document.createElement('canvas').getContext('webgl');
    const info = probe && probe.getExtension('WEBGL_debug_renderer_info');
    const name = info ? probe.getParameter(info.UNMASKED_RENDERER_WEBGL) : '';
    soft = /swiftshader|software|llvmpipe/i.test(String(name));
  } catch { soft = false; }
  try {
    const lose = probe && probe.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  } catch { /* nothing to give back */ }
  SOFT_GL = soft;
  return soft;
}
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
// Sampled from reference/baseball/batter-home-1.png (off-white shirt AND pants, navy pinstripe/
// trim/cap) and batter-away-1.png (navy shirt, light grey pants, white piping) - coordinator
// review, round 2: the round-1 palette (dull cream everywhere, navy-on-navy away) read as one flat
// team, not two, at the size these figures actually draw on screen (the pitcher is 11% of the
// field height - checked at height 90px, not only 400, this round).
const HOME_CREAM = 0xf2ead2;   // off-white shirt + pants, home
const NAVY = 0x25395c;         // trim, home; shirt, away
const AWAY_GREY = 0xc9c9c9;    // pants, away (sampled from batter-away-1.png's own pants fill)
const AWAY_TRIM = 0xf2f2f2;    // trim, away ("white trim" per the brief; a hair off pure white so it
                                // never exact-matches a key meant for something else)
// skaterMaleA's tee AND its jeans are each painted as their OWN vertical gradient (a light falloff
// top to bottom), not a flat fill - measured sampling a column straight down each
// (`python3 -c "PIL...getpixel"` every 20-40px). A single default-tolerance key at one shade only
// ever covered that shade's own mid-band; the first render of this clip against Pitcher-home-1.png
// still showed an uncorrected red-orange collar/hem before the shirt got its second endpoint, which
// is what caught the shape of the problem. Two measured endpoints each, at a wider tolerance that
// closes the gap between them, fixes both: the shirt's G channel runs 48..101 (tol 28 overlaps at
// G=73..76); the jeans' G channel runs 65..90 (tol 20 overlaps at G=75..85, and R alone - jeans
// R 18..24 against the shirt's R 234..245 - keeps the two gradients from ever cross-matching each
// other even before G/B are checked). Both stay clear of skin (G 140+, at least 39 units past
// either gradient's own brighter endpoint) at these tolerances.
const SHIRT_TOL = 28;
const PANTS_TOL = 20;
// criminalMaleA's suit and its trousers are painted with the IDENTICAL colour (#ffffff, verified
// by direct pixel sampling - not a near-white shade that a tighter tolerance could still tell
// apart) - one flat fill covers the whole lower body, the shirt and the pants share one source
// pixel value. Colour alone cannot key them to two different away colours, which is what "away
// shirt navy, away pants light grey" needs. `rect` (fractions of the texture, [x0,y0,x1,y1])
// restricts a key to a region of the PAINTED IMAGE, not the 3D mesh - found by rendering the real
// body with a labelled test-grid texture in place of the skin (a scratchpad-only tool, not
// shipped) to see which image region lands on which body part, then tightened to the navy pixels'
// own measured bounding box (a Python bbox scan restricted to blue-ish pixels, skaterMaleA's own
// jeans - both skins share one UV layout, so the same box applies to criminalMaleA's trousers).
// The pants key is listed BEFORE the shirt key for both skins/both sides so a white pixel inside
// the box is claimed by the pants rule first; every other white pixel (the shirt, sleeves, cuffs)
// falls through to the shirt rule, which carries no rect and matches everywhere else.
const PANTS_RECT = [0.59, 0.74, 1.0, 1.0];
export const KEYS = {
  skaterMaleA: {
    home: [
      { from: [0x12, 0x41, 0x63], to: HOME_CREAM, tol: PANTS_TOL, part: 'pants' },
      { from: [0x18, 0x5a, 0x84], to: HOME_CREAM, tol: PANTS_TOL, part: 'pants' },
      { from: [0xea, 0x30, 0x31], to: HOME_CREAM, tol: SHIRT_TOL, part: 'shirt' },
      { from: [0xf2, 0x65, 0x4c], to: HOME_CREAM, tol: SHIRT_TOL, part: 'shirt' },
    ],
    away: [
      { from: [0x12, 0x41, 0x63], to: AWAY_GREY, tol: PANTS_TOL, part: 'pants' },
      { from: [0x18, 0x5a, 0x84], to: AWAY_GREY, tol: PANTS_TOL, part: 'pants' },
      { from: [0xea, 0x30, 0x31], to: NAVY, tol: SHIRT_TOL, part: 'shirt' },
      { from: [0xf2, 0x65, 0x4c], to: NAVY, tol: SHIRT_TOL, part: 'shirt' },
    ],
  },
  criminalMaleA: {
    // Trim (collar/cuff, its main fill #009f78 and its own fold-shadow #037e60) keys to the navy
    // accent on both sides, same as round 1. The suit's white (#ffffff) is split by PANTS_RECT:
    // home sends BOTH halves to the same off-white (so shirt and pants still read as one uniform,
    // matching skaterMaleA's own home treatment); away sends the boxed pants pixels to light grey
    // and every other white pixel (the shirt) to navy - two different colours from one source
    // shade, which is the whole reason PANTS_RECT exists for this skin.
    home: [
      { from: [0xff, 0xff, 0xff], to: HOME_CREAM, rect: PANTS_RECT, part: 'pants' },
      { from: [0x00, 0x9f, 0x78], to: NAVY, part: 'trim' }, { from: [0x03, 0x7e, 0x60], to: NAVY, part: 'trim' },
      { from: [0xff, 0xff, 0xff], to: HOME_CREAM, part: 'shirt' },
    ],
    away: [
      { from: [0xff, 0xff, 0xff], to: AWAY_GREY, rect: PANTS_RECT, part: 'pants' },
      { from: [0x00, 0x9f, 0x78], to: AWAY_TRIM, part: 'trim' }, { from: [0x03, 0x7e, 0x60], to: AWAY_TRIM, part: 'trim' },
      { from: [0xff, 0xff, 0xff], to: NAVY, part: 'shirt' },
    ],
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
    const w = canvas.width, h = canvas.height;
    const targets = keys.map((k) => ({
      from: k.from, to: [(k.to >> 16) & 255, (k.to >> 8) & 255, k.to & 255], tol: k.tol || COLOR_TOL,
      // rect (image fractions) -> pixel bounds, once, so the per-pixel loop below is a plain
      // integer compare rather than four multiplies every pixel.
      px: k.rect ? [Math.floor(k.rect[0] * w), Math.floor(k.rect[1] * h), Math.ceil(k.rect[2] * w), Math.ceil(k.rect[3] * h)] : null,
    }));
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;   // transparent: nothing to key
      const px = (i / 4) % w, py = Math.floor((i / 4) / w);
      for (const k of targets) {
        if (k.px && (px < k.px[0] || px >= k.px[2] || py < k.px[1] || py >= k.px[3])) continue;   // outside this key's rect
        if (Math.abs(d[i] - k.from[0]) <= k.tol && Math.abs(d[i + 1] - k.from[1]) <= k.tol && Math.abs(d[i + 2] - k.from[2]) <= k.tol) {
          d[i] = k.to[0]; d[i + 1] = k.to[1]; d[i + 2] = k.to[2];
          break;   // first matching key wins - this is what lets a rect-restricted key claim its
                   // box before a same-coloured, rect-free key further down matches everywhere else
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
  // STAGE 4 FIX: `facingRad` was accepted by `_setSide` (its own destructure, above) but never
  // forwarded here, so a caller passing it - including `render-actor.mjs`'s own
  // `setter.call(actors, {..., facingRad})` and the dev screen's `_open3DCheck` - silently lost it,
  // and every actor placed through `setBatter`/`setPitcher` (never a bare `place()`) rendered at
  // `facingRad=0` on its first placement (`actor._last` starts null, so `_setSide`'s own fallback
  // took over). Harmless for the pitcher (`PITCHER_FACING_RAD` already is 0) but wrong for the
  // batter (`BATTER_FACING_RAD`, 95deg) on every path that goes through this wrapper rather than a
  // direct `place()` call. Fixed by forwarding it, same as `mirrored` already was.
  setBatter({ side, bats, aimX, anchor, heightPx, facingRad } = {}) {
    return this._setSide('batter', { side, anchor, heightPx, facingRad, mirrored: bats != null ? bats === 'L' : undefined });
  }
  setPitcher({ side, throws, anchor, heightPx, facingRad } = {}) {
    return this._setSide('pitcher', { side, anchor, heightPx, facingRad, mirrored: throws != null ? throws === 'L' : undefined });
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

  /** The pitch, in the same canvas-px space every anchor here already uses (world (x, -y) is
   *  screen (x, y) - the ortho camera's own convention, section 3.5's header). `b` is `{x, y, r}` -
   *  `r` a screen-px radius, straight from `field.js`'s `plateBallPos` the way the 2D trail already
   *  reads it, so the 3D ball is exactly the size and position the 2D flight curve draws, never a
   *  second, driftable copy of that math. `null` hides it (the crossing, and the overhead cut -
   *  ui.js calls this with `null` at both). Built lazily on first use so a batter-only dev-screen
   *  session (never a pitch) pays nothing for a sphere it never shows. */
  setBall(b) {
    if (!this.scene) return;
    if (!b) { if (this._ball) this._ball.visible = false; return; }
    if (!this._ball) {
      const geo = new THREE.SphereGeometry(1, 12, 8);
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
      this._ball = new THREE.Mesh(geo, mat);
      this._ball.frustumCulled = false;
      this.scene.add(this._ball);
    }
    this._ball.visible = true;
    this._ball.scale.setScalar(Math.max(0.5, b.r));
    // z=20: in front of the batter's own pivot (z=10, `_place`) and the pitcher's (z=0), so the
    // ball is never clipped behind either figure at any point of its flight between them.
    this._ball.position.set(b.x, -b.y, 20);
  }

  /** The pitcher's throwing hand (`handR`), in the same canvas-px space `setBall` uses - stage 4's
   *  pitch flight starts here instead of `field.js`'s fixed `PLATE_ANCHORS.release` (a flat point
   *  measured off the picture), so the ball leaves the hand this specific pose actually has. `role`
   *  defaults to 'pitcher' since nothing else ever throws; returns null before that actor/bone
   *  exists (load() not finished, or a role with no `handR` some day). */
  handWorldPx(role = 'pitcher') {
    const actor = this.actors[role];
    if (!actor || !actor.bones.handR) return null;
    const v = new THREE.Vector3();
    actor.bones.handR.getWorldPosition(v);
    return { x: v.x, y: -v.y };
  }

  // STAGE 4 FIX, corrected after coordinator review: `render()` is the one properly expensive call
  // in this loop (two skinned actors, ~4800 verts each, plus the bat/shadows/ball) - measured
  // against the REAL live play screen (`test-baseball-device.mjs`'s r2-cadence, mounted through
  // the real hub), rendering it at every requestAnimationFrame pushed the verdict-to-next-release
  // gap from its pre-3D ~6220ms to ~6300-6350ms under this sandbox's SOFTWARE renderer
  // (SwiftShader): real main-thread contention between this loop's own synchronous render() calls
  // and `_stepWindup`'s setTimeout-based sleeps, not a change to any awaited duration (R1/R2's own
  // numbers are untouched - see _stepWindup, _onEngineEvent, _settleAtBat).
  //
  // The first cut of this fix capped the render rate EVERYWHERE, unconditionally - which pays for
  // a sandbox artifact with every real player's frame rate. A real phone renders this scene on a
  // real GPU, where the contention this fix exists for does not arise (the render call returns to
  // the driver almost immediately instead of blocking the main thread while software-rasterising
  // two figures), so a permanent 20fps cap would cost 7 of the ~21 rendered frames a real device
  // gets through the fastest motion in the game (Swing, ~350ms) for a problem that is not there on
  // that device. The cap is gated on `isSoftGL()` now: capped under software rendering (this
  // sandbox, and any headless test), uncapped on real hardware (`requestAnimationFrame`'s own
  // display-rate cap is the only limit there). `mixer.update(dt)` runs at whichever rate `render()`
  // does either way, and `dt` is measured from `this._last`, which only advances on a frame that
  // actually did work - so a clip's mark lands at the right REAL time regardless of how many rAF
  // ticks were skipped in between (a lower tick rate, not dropped time), on both paths.
  // `_lastRender = 0` (not `now`) so the very first tick always renders immediately - no blank
  // frame while the cap's own window fills for the first time.
  start() {
    if (this._running) return;
    this._running = true;
    this._last = performance.now();
    this._lastRender = 0;
    const soft = isSoftGL();
    const tick = (now) => {
      if (!this._running) return;
      if (!soft || now - this._lastRender >= RENDER_FRAME_MS) {
        const dt = Math.min(0.05, (now - this._last) / 1000);
        this._last = now;
        this._lastRender = now;
        for (const a of Object.values(this.actors)) if (a) a.mixer.update(dt);
        this.renderer.render(this.scene, this.camera);
      }
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }
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
    // The ball is a plain Mesh, not shared across instances the way the skin CanvasTexture cache
    // is (setBall's own header) - safe to dispose here every time.
    if (this._ball) { this._ball.geometry.dispose(); this._ball.material.dispose(); this._ball = null; }
    if (this.renderer) { this.renderer.dispose(); this.renderer.forceContextLoss(); }
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    this.renderer = null; this.scene = null; this.ready = false;
  }
}
