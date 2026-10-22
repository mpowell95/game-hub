# Handoff: add the back-wall scuff to THE CLASSIC

**For the session that owns `skeeball/js/machines/classic/`.** Matt asked for this feature on THE
CLASSIC, and asked that it come to you rather than be done behind your back — you have been
committing to `classic/physics.js` all day (six commits on 2026-09-03, including one "revert
everything I changed today"), and the scuff needs one line in that file.

**This is not a request to change how THE CLASSIC plays.** Nothing here touches physics behaviour.
If it does, something has been copied wrong.

---

## What it is

When the ball hits the back wall, a soft pale scuff appears on the wall **at the point it was
struck**, and fades out over two seconds. It answers Matt's original complaint, which was that the
machine gave no feedback at all:

> "It's impossible to tell where on the back wall a ball that's overthrown bounces off. Sometimes
> I'll throw it and it doesn't look like it even touched the back wall, but based off how it lands I
> know it must have."

Live on **BRICK CITY**, **HOT SHOT** and **RUNAWAY** as of `game-hub-v593`. THE CLASSIC is the last
one (POPONGO is deliberately excluded — see the bottom).

## Why it is safe to add

- The physics half is **read-only**. It sets a boolean on the throw state and pushes an event. It
  does not move the ball, change a material, or touch scoring.
- `js/ui.js` is **already done and already live** — no edit needed. It feature-tests the renderer:

```js
case 'wall':
  if (Rr && typeof Rr.wallMarkAt === 'function' && ev.pos) Rr.wallMarkAt(ev.pos, ev.part, ev.speed);
  break;
```

That is why BRICK CITY could ship it alone while the other four ignored the event harmlessly. It
also means you can do the two halves in **either order**: physics first is a no-op until the
renderer has the method, renderer first is a no-op until the event fires.

## The four pieces

Copy them from `skeeball/js/machines/brickcity/` — that is where they were built and tuned.

### 1. `classic/physics.js` — the flag, in the `st` object in `startThrow`

```js
// Has this throw already left its scuff on the back wall? One per throw - see the 'wall'
// event below.
wallMarked: false,
```

### 2. `classic/physics.js` — the emit, in the `collide` listener right after the existing `backboard` branch

```js
if (part === 'backboard' && vn > 0.1 && !st.wallMarked) {
  st.wallMarked = true;
  const q = ball.position;
  st.events.push({ type: 'wall', part, speed: +vn.toFixed(3), pos: { x: q.x, y: q.y, z: q.z } });
}
```

Copy BRICK CITY's comment block above it too — it records why the threshold is 0.1 and why the side
rails are excluded.

### 3. `classic/render.js` — six insertions, all present verbatim in `brickcity/render.js`

| what | where |
|---|---|
| `const WALL_MARK_LIFE = 2.0;` and its comment | just above `const REDUCED = ...` |
| `this._wallMarks = [];` | in the constructor, beside `this._popups = [];` |
| the "THE WALL SCUFFS: hold, then fade out" block | in `render()`, just before the `_particles` loop |
| `_scuffTexture()` and `wallMarkAt()` | just before `burstAt(...)` |
| `this._wallMarks.length > 0` | added to the `shadowMap.needsUpdate` condition |
| one teardown line | in `dispose()`, beside the `_particles` line |

### 4. Nothing else. No geometry, no materials, no scoring.

---

## The one number you MUST re-measure, not copy

**The back wall's own brightness.** The mark is pale (`rgba(214,203,186)`) for a measured reason: a
*dark* scuff on a dark wall is invisible, and shipping one cost a whole round of Matt's time —

> "I can't tell if you've added anything. If you did, now it's too subtle. I don't see anything."

BRICK CITY's wall measures **53–68 luminance out of 255**, so a black mark at full opacity could
only move it about eight levels. A pale mark had the whole range instead.

**THE CLASSIC's wall is a different colour and its scoreboard is a different design. Measure before
you trust the pale value.** If THE CLASSIC's wall is light, invert to a dark mark — the shape, size
and timing all stay.

### How to measure it

Serve the repo, open a page that builds the renderer, drop marks on the wall, and diff the
framebuffer before and after:

```js
const gl = R.renderer.getContext(), W = cv.width, H = cv.height;
const grab = () => { const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
const lum = (px, x, y) => { const i = ((H - 1 - y) * W + x) * 4; return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; };
const before = grab();
R.wallMarkAt({ x: 0.10, y: 1.72, z: -2.89 }, 'backboard', 1.8);
R.render(game, 0);
const after = grab();
// compare lum(before, ...) with lum(after, ...) around the mark's projected centre
```

What the three shipped machines measure, as your target:

| | back wall luminance | peak change | footprint over 4 levels |
|---|---|---|---|
| BRICK CITY | 53–68 | 88–90 | 1900–2700 px |
| RUNAWAY | 53–54 | 88–90 | 1900–2670 px |
| HOT SHOT | 77 | 76–78 | 1870–2640 px |

Aim for a peak change of roughly **75–90 levels**. Below about 50, Matt could not see it at all.

---

## Three things Matt rejected — do not reintroduce them

1. **A bright ring.** The first version was a gold ring with a dark halo: *"a big, solid, neon ring
   that's super distracting... it's gotta be tampered down significantly."* It is a soft radial
   smudge with no rim.
2. **Marks on the side walls.** *"We also DO NOT need this on the side walls."* The emit is gated to
   `part === 'backboard'`. A rail runs nearly edge-on to the player, so a mark on one is a sliver.
3. **Billboarding it to face the camera.** *"To have the ring appear face on to the user as a perfect
   circle when it hits a wall that's almost perpendicular to the player is crazy. That's not the norm
   for stuff like this."* He is right, and the norm is a **decal** — a texture projected onto the
   surface so it foreshortens with it. `wallMarkAt` puts a quad in the wall's own plane, reads that
   plane from `machine.js` (never hard-coded), and uses `polygonOffset` instead of pushing the mesh
   forward. **Do not add a `lookAt`.**

Also: only the **first** wall contact of a throw is marked. A ball that rattles leaves one scuff, not
six.

## Checks before you ship

- `node --check` on both edited files.
- Throw a grid headlessly and assert the `wall` event fires **at most once per throw**. It fires on
  roughly 60% of throws on the other machines.
- Measure the contrast, as above.
- `node skeeball/js/test.js` — THE CLASSIC is `DEFAULT_BOARD`, so that suite is genuinely about your
  machine. It should be unchanged, because nothing here changes physics.
- `node validate-sw-assets.mjs`, then bump `CACHE` in `sw.js` **past whatever is on `main` at that
  moment**. Several sessions are bumping it the same day and two branches landing on the same number
  is a real failure mode — the root `CLAUDE.md` explains why.

## Reference

- `skeeball/MACHINE-BRICKCITY.md` — the three passes this took: the neon ring, the invisible dark
  one, and the pale one that worked.
- `skeeball/CLAUDE.md`, "The back-wall scuff, on three machines now" — the port checklist and the
  measured table.
- Working code: `skeeball/js/machines/brickcity/` (built here), plus `basketball/` and `runaway/`
  (ported from it, including the two extra edits RUNAWAY needed because it has a moving part).

## Not in scope

- **POPONGO.** Matt's call. Its ball is 8.1 cm against these machines' 10.9 cm, and the mark's size
  is in metres, so a verbatim copy would look a third too big. It needs a rescale first.
- **The back-wall dwell.** A separate, unshipped finding: on the three STAIRCASE machines (HOT SHOT,
  BRICK CITY, RUNAWAY) a ball can rest against the back wall for up to a second, because the treads
  lean 0.10 rad (tan 0.100) against a face friction of 0.12 — static friction wins, so a stopped ball
  cannot roll off on its own. **THE CLASSIC is not affected** (tan 1.000 against 0.62 friction).
  Noted only so you can rule it out if Matt reports sticking on your machine.
