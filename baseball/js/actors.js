// actors.js - THE WEBGL LAYER. R1, docs/BASEBALL-3D-BUILD.md section 9.
//
// One class. It owns the WebGL canvas, the scene, the three cameras (field.js's `makeCameras`),
// the stadium (field.js's `buildStadium`), the four figures, the ball and the landing marker. It
// has no engine knowledge: ui.js tells it where things are, in FEET.
//
// WHAT R1 CHANGED HERE, and it is the whole point of the stage: until v860 this class rendered
// two figures through an ORTHOGRAPHIC camera measured in CANVAS PIXELS, on top of a painted
// backdrop, with every position fed from `field.js`'s picture anchors. There is no backdrop now -
// this canvas draws the entire scene - so the camera is a real perspective one, every position is
// a world position in feet, and the 2-D canvas above it draws only the strike-zone box and the
// landing-marker label by projecting world points back through the active camera
// (`field.js`'s `projectToCanvas`). `handWorldPx` became `handWorld` and returns feet.
//
// Kept exactly as they were, because nothing about them was a camera fact: the skin colour-key
// remap (section 2.2), the authored clips and their `mark` times (poses.js), `play`/`release`/
// `toSet`/`idle`, the `holdAtMark` hold, the `isSoftGL()` render cap, and `dispose()`.
import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { clone as cloneSkinned } from './vendor/SkeletonUtils.js';
import { RIG, resolveRig } from './rig.js';
import { CLIPS, buildClip } from './poses.js';
import { onViewportResize } from '../../js/viewport.js';
import {
  makeCameras, buildStadium, CAMERAS, CHASE_LERP, BALL_RADIUS_FT, MARKER,
} from './field.js';

const CROSSFADE_S = 0.15;
// STAGE 7 (docs/BASEBALL-3D-BUILD.md section 7, row 3): the SET RETURN's own cross-fade, named so
// every caller of `toSet()` shares one number rather than each choosing its own. Distinct from
// CROSSFADE_S (the general default `play()` falls back to) - the set return is deliberately a
// touch slower, a settling motion rather than a snap.
const SET_RETURN_FADE_MS = 0.4;
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
const UMP_DARK = 0x23262b;     // R1: the umpire's suit, dark enough to read as "not a player"

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
    // R1 (docs/BASEBALL-3D-BUILD.md section 9): the umpire, "in dark clothes". The same skin and
    // the same two source colours as the away kit, sent somewhere else: the suit to near-black and
    // the collar/cuff trim to the same near-black, so he reads as one dark figure at the 38 px he
    // actually draws at on the pitching camera rather than as a third team.
    umpire: [
      { from: [0xff, 0xff, 0xff], to: UMP_DARK, rect: PANTS_RECT, part: 'pants' },
      { from: [0x00, 0x9f, 0x78], to: UMP_DARK, part: 'trim' }, { from: [0x03, 0x7e, 0x60], to: UMP_DARK, part: 'trim' },
      { from: [0xff, 0xff, 0xff], to: UMP_DARK, part: 'shirt' },
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
function skinForSide(side) { return (side === 'away' || side === 'umpire') ? 'criminalMaleA' : 'skaterMaleA'; }

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

// R1: the two new static figures. The model's own front is +Z at facingRad 0 (the measured fact
// above), and in R1's world -z runs toward the mound - so a figure who must look AT the mound is
// turned 180 degrees. Both the catcher (crouched at z = 5.5) and the umpire (standing at z = 8)
// face that way; the batter's own 95 degrees is unchanged, and it still means the same thing it
// did, because the batting camera still stands behind the plate looking out.
export const CATCHER_FACING_RAD = Math.PI;
export const UMPIRE_FACING_RAD = Math.PI;
/** Every role this class builds. Order matters only in that the batter is the one with a bat. */
export const ROLES = ['batter', 'pitcher', 'catcher', 'umpire'];

export class Actors {
  constructor(wrapEl) {
    this.wrapEl = wrapEl;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'bb-actor-canvas';
    this.canvas.style.pointerEvents = 'none';
    wrapEl.appendChild(this.canvas);
    this.renderer = null; this.scene = null;
    this.cameras = null; this.camera = null; this.cameraName = 'batter';
    this.actors = { batter: null, pitcher: null, catcher: null, umpire: null };
    this.stadium = null;
    this.ready = false;
    this._raf = 0; this._last = 0; this._running = false;
    this._offResize = null;
    this._w = 0; this._h = 0;
    this._proto = null; this._fileClips = [];
    this._lastBall = null;
    this._chaseTarget = null;
    this._firstFrameResolve = null;
    this._firstFramePromise = new Promise((res) => { this._firstFrameResolve = res; });
    this._preserve = !!(globalThis.__bbTest);   // the test reads pixels back; nobody else pays for it
  }

  /** Create the renderer, the scene, the lights and the three cameras. Separate from the
   *  constructor so a missing WebGL context is a value the caller can branch on, not a throw
   *  during mount. Returns false when WebGL is unavailable. */
  initGL() {
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true,
        powerPreference: 'low-power', preserveDrawingBuffer: this._preserve });
    } catch { this.renderer = null; return false; }
    // R1: this canvas draws the WHOLE scene now, not two figures over a picture, so the clear is
    // opaque - the sky sphere covers every direction, and an alpha-0 clear would only ever show
    // through as a bug.
    this.renderer.setClearColor(0x7fb7e6, 1);
    // R1, measured: the pixel ratio is capped at 1 under a SOFTWARE rasteriser, and at DPR_CAP on
    // real hardware. Before R1 this canvas drew two figures over a painted backdrop; it draws the
    // whole stadium now, so its fill cost went up fourfold and the cost is paid in the GPU process,
    // where a software rasteriser starves the main thread's own timers. Measured on this container
    // at 393x429 CSS: with the render loop running at dpr 2, a chain of setTimeouts totalling 6.2 s
    // (the R2 verdict-to-next-release beat) came back 497 ms late; at dpr 1, 95 ms late; with the
    // loop paused, 1 ms. `renderer.render` itself returns in 1.2 ms either way, so this is fill
    // rate and nothing else. A real phone GPU does not have the problem, which is why this is
    // gated - exactly the same reasoning, and the same probe, as RENDER_FRAME_MS above.
    this.renderer.setPixelRatio(isSoftGL() ? 1 : Math.min(DPR_CAP, window.devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    // Stadium daylight: one hemisphere fill (sky above, grass bounce below) and one sun. No shadow
    // maps (R1's own scope line) - the blob shadow under each figure is what grounds it.
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x5a7a3a, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(-300, 500, 400); this.scene.add(sun);
    this.cameras = makeCameras(1);
    this.camera = this.cameras.batter;
    this._offResize = onViewportResize(() => { /* ui.js calls resize() with the real size */ });
    return true;
  }

  /** The stadium, for one league's fence shape. Called once per play screen (ui.js's _renderPlay),
   *  never per frame; a second call replaces the first, which is what a league change would need. */
  buildField(fenceFt) {
    if (!this.scene || !fenceFt) return;
    if (this.stadium) { this.stadium.dispose(); this.stadium = null; }
    this.stadium = buildStadium(this.scene, { fenceFt });
  }

  async load(url) {
    // Loaded together: the model has no embedded texture (section 2.1 - one "Skin" material, no
    // image in the file), so a render before any skin arrives would be flat grey. The home
    // skaterMaleA texture is the placeholder every actor is BUILT with (_makeActor, below) so
    // no figure is ever untextured for a frame; load() then casts each role to its real side.
    const [gltf, placeholderTex] = await Promise.all([new GLTFLoader().loadAsync(url), skinTexture('skaterMaleA', 'home')]);
    this._proto = gltf.scene;
    this._fileClips = gltf.animations || [];
    this._placeholderTex = placeholderTex;
    for (const role of ROLES) this.actors[role] = this._makeActor(role);
    // Default casting (section 2.2): the human's team (home) is skaterMaleA, the CPU (away) is
    // criminalMaleA, the umpire is criminalMaleA in near-black. A placeholder until ui.js calls
    // setBatter/setPitcher with the real per-half-inning side - it is what lets the dev screen and
    // render-actor.mjs show a sensible pair with no caller at all.
    await Promise.all([
      this.setBatter({ side: 'home' }), this.setPitcher({ side: 'away' }),
      this._setSide('catcher', { side: 'away' }), this._setSide('umpire', { side: 'umpire' }),
    ]);
    this.ready = true;
  }

  _makeActor(role) {
    const root = cloneSkinned(this._proto);
    const bones = resolveRig(root);
    const restQ = {}; for (const k of Object.keys(bones)) if (bones[k]) restQ[k] = bones[k].quaternion.clone();
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const heightWorld = box.max.y - box.min.y;
    const footY = box.min.y;   // so the feet, not the origin, sit on the ground
    // Clone the materials this actor touches so the figures stay independent (`setBatter`/
    // `setPitcher` swap `material.map` per actor). `material.color` stays white so the texture
    // shows true - a tint here would colour skin and hair along with the uniform, exactly what
    // section 2.2's colour-key remap exists to avoid doing the cheap way.
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      o.frustumCulled = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { m.map = this._placeholderTex; m.color.set(0xffffff); m.needsUpdate = true; }
    });
    const mixer = new THREE.AnimationMixer(root);
    const actions = {};
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
    // that bone's LOCAL space: divide the intended size by the hand bone's own world scale.
    const handScale = new THREE.Vector3(); actor.bones.handR.getWorldScale(handScale);
    const sx = handScale.x || 1, sy = handScale.y || 1;
    const g = new THREE.CylinderGeometry((BAT.barrelR * h) / sx, (BAT.knobR * h) / sx, (BAT.length * h) / sy, 12);
    const bat = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: BAT.color, roughness: 0.6 }));
    bat.position.set((BAT.pos[0] * h) / sx, (BAT.pos[1] * h) / sy, (BAT.pos[2] * h) / sx);
    bat.rotation.set(BAT.rot[0] * Math.PI / 180, BAT.rot[1] * Math.PI / 180, BAT.rot[2] * Math.PI / 180);
    actor.bones.handR.add(bat); actor.bat = bat;
  }

  /** Called by ui.js from _sizeCanvas with the field canvas's own CSS size. R1: there is no
   *  `cover` any more - a perspective camera needs the canvas's ASPECT, nothing else. */
  resize(w, h) {
    if (!this.renderer || !w || !h) return;
    this._w = w; this._h = h;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.cameras.setAspect(w / h);
  }

  /** Put one figure at a WORLD position (feet), feet on the ground, scaled so it stands
   *  `heightFt` tall. `facingRad` turns it about the world Y axis; `mirrored` flips it for a
   *  left-handed player exactly as it always did (a negative pivot scale.x - three.js flips face
   *  winding itself off the world matrix determinant, so no material change is needed). */
  _place(actor, pos, heightFt, facingRad) {
    const s = heightFt / actor.heightWorld;
    actor.pivot.position.set(pos.x, pos.y || 0, pos.z);
    actor.pivot.scale.set(actor.mirrored ? -s : s, s, s);
    actor.root.position.y = -actor.footY;
    actor.root.rotation.y = facingRad;
    actor.shadow.scale.set(actor.heightWorld * 0.22, actor.heightWorld * 0.10, 1);
    actor.shadow.position.y = actor.heightWorld * 0.004;   // a hair above the ground, never inside it
  }

  /** Place one actor now and remember it, so a later resize can reflow without the caller having
   *  to re-supply the position. `{ pos, heightFt, facingRad, mirrored }`, all world feet. */
  place(role, { pos, heightFt, facingRad = 0, mirrored = false }) {
    const actor = this.actors[role];
    if (!actor || !pos) return;
    actor.mirrored = mirrored;
    actor._last = { pos, heightFt, facingRad };
    this._place(actor, pos, heightFt, facingRad);
  }

  /** The recolour half of setBatter/setPitcher (section 2.2): cast `role` to `side`, remap its
   *  materials to that side's CanvasTexture (skipping the swap when the side hasn't changed, so a
   *  caller can pass `side` on every frame with no per-frame texture churn), then place() when a
   *  position is supplied. */
  async _setSide(role, { side, pos, heightFt, facingRad, mirrored } = {}) {
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
    if (pos && heightFt != null) {
      this.place(role, {
        pos, heightFt,
        facingRad: facingRad != null ? facingRad : (actor._last ? actor._last.facingRad : 0),
        mirrored: mirrored != null ? mirrored : actor.mirrored,
      });
    }
  }
  setBatter({ side, bats, pos, heightFt, facingRad } = {}) {
    return this._setSide('batter', { side, pos, heightFt, facingRad, mirrored: bats != null ? bats === 'L' : undefined });
  }
  setPitcher({ side, throws, pos, heightFt, facingRad } = {}) {
    return this._setSide('pitcher', { side, pos, heightFt, facingRad, mirrored: throws != null ? throws === 'L' : undefined });
  }
  /** R1's two static figures. The catcher takes the DEFENCE's side, so he swaps with the
   *  half-inning; the umpire is cast once, at load, and only ever needs placing. */
  setCatcher({ side, pos, heightFt, facingRad } = {}) {
    return this._setSide('catcher', { side, pos, heightFt, facingRad });
  }
  setUmpire({ pos, heightFt, facingRad } = {}) {
    return this._setSide('umpire', { pos, heightFt, facingRad });
  }

  // ------------------------------------------------------------------ cameras ----
  /** Switch the live camera: 'batter', 'pitcher' or 'chase'. R1 replaces the old "cut the 2-D
   *  canvas to a different painting" with this one call, and it is what `_cutawayUp` now guards:
   *  while a ball is in play the chase camera is live and no input path may switch it back. */
  setCamera(name) {
    if (!this.cameras) return;
    const cam = this.cameras[name];
    if (!cam) return;
    this.cameraName = name;
    this.camera = cam;
    this._applyCameraVisibility();
  }
  /** The umpire is not drawn from the batting camera - he stands 5 ft in front of its lens and
   *  would fill the frame. See field.js's CAMERAS comment for why no camera position avoids it at
   *  fov 50, and why "the camera stands where the umpire's head is" is the honest reading. */
  _applyCameraVisibility() {
    const ump = this.actors.umpire;
    if (ump) ump.pivot.visible = this.cameraName !== 'batter';
  }
  /** Aim the chase camera at a world point (the ball). `immediate` snaps it there instead of
   *  easing, which is what the first frame of a cutaway wants so the chase does not fly in from
   *  wherever the previous ball ended. The ease itself runs in the render loop, once per rendered
   *  frame, so it is the same motion at 20 fps under software GL as at 60 on a phone. */
  chaseAt(pos, immediate = false) {
    this._chaseTarget = { x: pos.x, y: pos.y, z: pos.z };
    if (immediate) this._stepChase(1);
  }
  _stepChase(alpha) {
    const t = this._chaseTarget;
    const cam = this.cameras && this.cameras.chase;
    if (!t || !cam) return;
    const off = CAMERAS.chase.offset;
    const wantX = t.x + off[0], wantY = t.y + off[1], wantZ = t.z + off[2];
    cam.position.x += (wantX - cam.position.x) * alpha;
    cam.position.y += (wantY - cam.position.y) * alpha;
    cam.position.z += (wantZ - cam.position.z) * alpha;
    cam.lookAt(t.x, t.y, t.z);
  }

  /** Play `name` on `role` so that the clip's mark lands `markAtMs` from now (0 = seek straight to
   *  the mark). `fade` (seconds) is the cross-fade duration FROM whatever is currently playing -
   *  default `CROSSFADE_S`. STAGE 7 (section 7, row 4): Swing/Miss are played with `fade: 0`
   *  everywhere a real swing happens, so the contact pose is visible on the very frame it starts.
   *  STAGE 8 (section 8, row 2): `holdAtMark` - the delivery reaches its `mark` keyframe and STOPS
   *  there instead of playing through, so the human pitcher's own wind-up can be tied to their
   *  SECOND tap. `actor.holdAt` is read every frame by `start()`'s tick loop below. */
  play(role, name, { markAtMs = null, fade, holdAtMark = false } = {}) {
    const actor = this.actors[role]; const a = actor && actor.actions[name];
    if (!a) return;
    const def = CLIPS[name];
    a.reset(); a.enabled = true; a.setEffectiveWeight(1);
    a.paused = false;
    if (def && def.mark != null && markAtMs != null) {
      if (markAtMs <= 0) { a.time = def.mark; a.timeScale = 1; }
      else a.timeScale = def.mark / (markAtMs / 1000);
    } else a.timeScale = 1;
    actor.holdAt = (holdAtMark && def && def.mark != null) ? def.mark : null;
    const fadeS = fade != null ? fade : CROSSFADE_S;
    if (actor.current && actor.current !== a) actor.current.crossFadeTo(a, fadeS, false);
    a.play(); actor.current = a;
  }
  /** Each role's resting loop. R1 adds the two static figures: the catcher crouches, the umpire
   *  stands (poses.js has no umpire clip of its own and inventing one is a feature not discussed). */
  idle(role) {
    const name = role === 'pitcher' ? 'Set' : (role === 'catcher' ? 'Crouch' : 'Idle');
    this.play(role, name);
  }
  /** STAGE 8 row 2: the human's own tap-to-release, paired with `play()`'s `holdAtMark`. The
   *  wind-up may already be PAUSED at `actor.holdAt` (the ordinary case) or still travelling
   *  toward it (an early tap); either way the ball leaves the hand AT the release pose. */
  release(role) {
    const actor = this.actors[role];
    const a = actor && actor.current;
    if (!a || !actor || actor.holdAt == null) return;
    a.time = actor.holdAt;
    a.paused = false;
    a.timeScale = 1;
    actor.holdAt = null;
  }
  /** STAGE 7 (section 7, row 3): the pitcher's return-to-set beat, after a delivery's
   *  follow-through has played out. A named helper so SET_RETURN_FADE_MS lives in one place. */
  toSet() { this.play('pitcher', 'Set', { fade: SET_RETURN_FADE_MS }); }

  // ------------------------------------------------------------------ ball and marker ----
  /** The ball, in WORLD FEET (R1). `{x, y, z}`, or `null` to hide it. Radius is fixed at
   *  `BALL_RADIUS_FT` - about five times a real baseball, on purpose, because the reference draws
   *  it large and a true 1.45 inch sphere at 60 ft is a pixel. Built lazily on first use. */
  setBall(b) {
    if (!this.scene) return;
    // `_lastBall` is kept even while hidden (a `null` call only sets `visible = false`) - it is
    // THE CONTACT HOLD's own starting point (ui.js's `_contactHold`), the ball's last real
    // position rather than a second, driftable guess at where contact happened.
    if (!b) { if (this._ball) this._ball.visible = false; if (this._ballShadow) this._ballShadow.visible = false; return; }
    if (!this._ball) {
      const geo = new THREE.SphereGeometry(BALL_RADIUS_FT, 12, 8);
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
      this._ball = new THREE.Mesh(geo, mat);
      this._ball.frustumCulled = false;
      this.scene.add(this._ball);
      // The ball's own ground shadow. Stage 8 learned this on the 2-D overhead and it carries over
      // unchanged: "what actually sells the ball as airborne is the gap between this and the ball
      // itself, not the ball's own shape." Hidden while the ball is near the ground, where a
      // shadow directly under it says nothing and only doubles the dot.
      const sgeo = new THREE.CircleGeometry(BALL_RADIUS_FT, 16);
      sgeo.rotateX(-Math.PI / 2);
      this._ballShadow = new THREE.Mesh(sgeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
      this._ballShadow.frustumCulled = false;
      this.scene.add(this._ballShadow);
    }
    this._ball.visible = true;
    this._ball.position.set(b.x, b.y, b.z);
    const high = b.y > 2.5;
    this._ballShadow.visible = high;
    if (high) {
      this._ballShadow.position.set(b.x, 0.07, b.z);
      // Wider and softer the higher it is, the way a real shadow spreads. The numbers are set by
      // what the chase camera can actually SEE: at a 115 ft apex the shadow is ~113 ft from the
      // lens, so it needs to be about 6 ft across to read at all, and an opacity that fades to
      // nothing takes the cue away exactly when the height is worth showing.
      const k = Math.min(8, 1 + b.y / 15);
      this._ballShadow.scale.set(k, 1, k);
      this._ballShadow.material.opacity = Math.max(0.12, 0.32 - b.y / 500);
    }
    this._lastBall = { x: b.x, y: b.y, z: b.z };
  }
  /** The ball's last SET position (world feet), whether or not it is currently visible. `null`
   *  before anything has ever been set. */
  lastBallPos() { return this._lastBall || null; }

  /** The landing marker: a flat disc on the ground at the world point where the ball came down,
   *  in the stage 8 colours (green 1B/2B/3B, gold HR, red out), with the pulse ring stage 8 added.
   *  `pulseT` is 0..1 across the hold; ui.js withholds it under reduced motion, exactly as the 2-D
   *  marker did, and draws the label itself by projecting this same point. */
  setMarker({ x, z, kind }) {
    if (!this.scene) return;
    if (!this._marker) {
      const discGeo = new THREE.CircleGeometry(MARKER.radiusFt, 28);
      discGeo.rotateX(-Math.PI / 2);
      const discMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false });
      this._marker = new THREE.Mesh(discGeo, discMat);
      this._marker.renderOrder = 2;
      const ringGeo = new THREE.RingGeometry(1, 1.14, 28);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
      this._markerRing = new THREE.Mesh(ringGeo, ringMat);
      this._markerRing.renderOrder = 2;
      this.scene.add(this._marker); this.scene.add(this._markerRing);
    }
    const color = kind === 'out' ? MARKER.out : (kind === 'hr' ? MARKER.hr : MARKER.hit);
    this._marker.material.color.setHex(color);
    this._markerRing.material.color.setHex(color);
    this._marker.position.set(x, 0.08, z);
    this._markerRing.position.set(x, 0.09, z);
    this._marker.visible = true;
    this._markerRing.visible = false;
  }
  markerPulse(pulseT) {
    if (!this._markerRing) return;
    if (pulseT == null) { this._markerRing.visible = false; return; }
    const t = (pulseT * 2) % 1;                       // two pulses across the hold, as stage 8 drew
    const r = MARKER.radiusFt * (1 + 2.2 * t);
    this._markerRing.visible = true;
    this._markerRing.scale.set(r, 1, r);
    this._markerRing.material.opacity = 0.6 * (1 - t);
  }
  clearMarker() {
    if (this._marker) this._marker.visible = false;
    if (this._markerRing) this._markerRing.visible = false;
  }

  /** The pitcher's throwing hand (`handR`), in WORLD FEET (R1 renamed this from `handWorldPx`).
   *  The pitch flight starts here, so the ball leaves the hand this specific pose actually has.
   *  `null` before that actor/bone exists. */
  handWorld(role = 'pitcher') {
    const actor = this.actors[role];
    if (!actor || !actor.bones.handR) return null;
    const v = new THREE.Vector3();
    actor.bones.handR.getWorldPosition(v);
    return { x: v.x, y: v.y, z: v.z };
  }

  /** Compile the shaders and upload the textures BEFORE the play screen needs them. Measured on
   *  this container: the very first `renderer.render` of a built stadium costs 227 ms (program
   *  compilation and texture upload under a software rasteriser), which landed squarely between the
   *  Play tap and the first wind-up and blew the 300 ms budget the `first-frame` probe holds. Doing
   *  it at MOUNT, into a 32x32 buffer, is the same trick stage 7 played with `plate.webp`: a player
   *  picking a league pays for it instead. Deliberately does NOT resolve `firstFrame()` - that
   *  promise means "the scene has been drawn AT ITS REAL SIZE by the render loop", which is what a
   *  wind-up must not start before. */
  warm() {
    if (!this.renderer || !this.scene || !this.cameras) return;
    const w = this._w, h = this._h;
    this.renderer.setSize(32, 32, false);
    this.renderer.render(this.scene, this.cameras.batter);
    if (w && h) this.renderer.setSize(w, h, false);
  }

  /** Resolves once the scene has actually RENDERED a frame. R1 replaces `field.js`'s old
   *  `plateReady()` (which waited on plate.webp decoding) with this: the first wind-up of a game
   *  waits for the stadium to have been drawn at least once, so a delivery never runs under an
   *  empty field. Already-resolved on every later call, so it only ever costs time once. */
  firstFrame() { return this._firstFramePromise; }

  /** What the scene costs, for the report and for the R1 triangle/draw-call budget. Read after a
   *  render; `renderer.info.render` is per-frame and resets on the next one. */
  renderStats() {
    if (!this.renderer) return null;
    const r = this.renderer.info.render;
    return { triangles: r.triangles, calls: r.calls, points: r.points, lines: r.lines };
  }

  // The render-rate cap (stage 4, kept): rendering at every rAF under a SOFTWARE rasteriser put
  // real main-thread contention between this loop's synchronous render() calls and _stepWindup's
  // setTimeout sleeps, and pushed the measured R2 cadence out of range. It is gated on isSoftGL()
  // so a real phone GPU is never capped. `dt` is measured from `this._last`, which only advances on
  // a frame that did work, so a clip's mark still lands at the right REAL time either way.
  start() {
    if (this._running) return;
    this._running = true;
    this._last = performance.now();
    this._lastRender = 0;
    const soft = isSoftGL();
    const tick = (now) => {
      if (!this._running) return;
      if (!soft || now - this._lastRender >= RENDER_FRAME_MS) {
        // R1 FIX, measured: this clamp used to be 0.05 s, which is exactly the render cap's own
        // frame time - so on any device where one frame takes LONGER than the cap (this container's
        // software rasteriser renders the whole stadium in about 100 ms) every clip ran at half
        // real speed and a `markAtMs` landed at twice the time it was asked for. The tap-tap-pitch
        // probe caught it: the delivery reached its release keyframe 2000 ms after a 1100 ms meter.
        // The clamp exists only to stop a tab that was hidden from fast-forwarding a clip past its
        // own mark on the first frame back, and `visibilitychange` already pauses the loop for that
        // case, so 0.25 s is far above any real frame and still well under a backgrounded gap.
        const dt = Math.min(0.25, (now - this._last) / 1000);
        this._last = now;
        this._lastRender = now;
        for (const actor of Object.values(this.actors)) {
          if (!actor) continue;
          actor.mixer.update(dt);
          // STAGE 8 row 2's HOLD: the instant `a.time` reaches `actor.holdAt`, freeze it there.
          // `release()` is the only thing that clears `actor.holdAt` once set.
          const a = actor.current;
          if (a && actor.holdAt != null && a.time >= actor.holdAt) {
            a.paused = true;
            a.time = actor.holdAt;
          }
        }
        if (this.cameraName === 'chase') this._stepChase(CHASE_LERP);
        this.renderer.render(this.scene, this.camera);
        if (this._firstFrameResolve) { const r = this._firstFrameResolve; this._firstFrameResolve = null; r(); }
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
    // NOT - skinTexture()'s CanvasTexture cache is module-level and shared by every Actors instance
    // and every (skin, side) it has ever cast, on purpose. Disposing a shared texture here would
    // leave every OTHER instance holding a cache entry pointed at a dead GPU resource.
    for (const a of Object.values(this.actors)) if (a) { a.mixer.stopAllAction(); a.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); }); }
    if (this.stadium) { this.stadium.dispose(); this.stadium = null; }
    if (this._ball) { this._ball.geometry.dispose(); this._ball.material.dispose(); this._ball = null; }
    if (this._ballShadow) { this._ballShadow.geometry.dispose(); this._ballShadow.material.dispose(); this._ballShadow = null; }
    if (this._marker) { this._marker.geometry.dispose(); this._marker.material.dispose(); this._marker = null; }
    if (this._markerRing) { this._markerRing.geometry.dispose(); this._markerRing.material.dispose(); this._markerRing = null; }
    if (this.renderer) { this.renderer.dispose(); this.renderer.forceContextLoss(); }
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    this.renderer = null; this.scene = null; this.cameras = null; this.camera = null; this.ready = false;
  }
}
