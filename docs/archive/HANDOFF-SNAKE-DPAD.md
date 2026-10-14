# Handoff: add Snake's on-screen arrow buttons (the D-pad)

**Audience: a Sonnet 5 session. Recommended effort: low.** Every decision is made below; this is
paste-and-verify. Don't refactor anything, don't touch the engine, don't reword strings beyond the
enumerated replacements. If something looks ambiguous beyond this doc, stop and ask Matt.

## The problem (Matt's report, 2026-07-23)

Snake's ready overlay says "Swipe or press an arrow key to start" ("Desliza o pulsa una flecha
para empezar") — but on a phone there are no keys, and no on-screen buttons exist. Only swiping
works. Matt wants the buttons the text implies: an on-screen D-pad.

## Decisions (made — do not reopen)

- **A 2-row cross below the board**: row 1 = ▲ centered; row 2 = ◀ ▼ ▶. Compact enough to keep
  board + pad on one phone screen; matches the physical-buttons feel of the original phone Snake.
- **Always visible on the game screen** (not the setup screen), desktop included. Hover-capable
  detection is unreliable on hybrid devices, and a visible pad costs nothing on desktop where the
  window is a narrow centered column anyway.
- **One input path**: the pad calls the existing `_steer(dir)` — the same method swipes and keys
  use. It already starts the run on first input, queues turns, and resumes from pause. Do NOT
  add a second code path.
- **`pointerdown`, not `click`**: fires immediately (no 300ms tap delay), once per press, unified
  across mouse/touch. Do not also register `click` (a ghost click after touch would double-turn).
- **Button faces are glyphs (▲▼◀▶), language-neutral** — only the aria-labels are translated.
- **The canvas must shrink to fit**: today `_sizeCanvas()` sizes cells from width only; with the
  pad below, a short viewport would push it off-screen. Height-cap the cell size (exact code
  below).

## Edits

### 1. `snake/js/strings.js` — replace two values, add four keys (both languages)

Replace:
- en `tap_to_start`: `'Swipe or tap an arrow to start'`
- es `tap_to_start`: `'Desliza o toca una flecha para empezar'`
- en `help_controls`: `'Steer with a swipe anywhere on the board, the on-screen arrows, or the arrow keys.'`
- es `help_controls`: `'Gira deslizando el dedo por el tablero, con las flechas en pantalla, o con las flechas del teclado.'`

Add (used for aria-labels only):
- en: `aria_up: 'Up'`, `aria_down: 'Down'`, `aria_left: 'Left'`, `aria_right: 'Right'`
- es: `aria_up: 'Arriba'`, `aria_down: 'Abajo'`, `aria_left: 'Izquierda'`, `aria_right: 'Derecha'`

Leave every other string untouched (including `resume_hint`, which is currently unused — do not
"clean it up").

### 2. `snake/js/ui.js` — pad markup + handler in `startRun()`, height cap in `_sizeCanvas()`

In `startRun()`'s template, directly AFTER the closing `</div>` of `.sn-boardwrap` (still inside
`.sn-game`), insert:

```html
          <div class="sn-pad" data-role="pad" aria-label="${t('aria_board')}">
            <button type="button" class="sn-padbtn sn-pad-up" data-dir="up" aria-label="${t('aria_up')}">▲</button>
            <button type="button" class="sn-padbtn sn-pad-left" data-dir="left" aria-label="${t('aria_left')}">◀</button>
            <button type="button" class="sn-padbtn sn-pad-down" data-dir="down" aria-label="${t('aria_down')}">▼</button>
            <button type="button" class="sn-padbtn sn-pad-right" data-dir="right" aria-label="${t('aria_right')}">▶</button>
          </div>
```

After the existing `wrap.addEventListener('click', ...)` line in `startRun()`, add:

```js
    this.root.querySelector('[data-role="pad"]').addEventListener('pointerdown', (e) => {
      const b = e.target.closest('[data-dir]');
      if (!b) return;
      e.preventDefault();                    // keep focus/scroll side effects off the board
      this._steer(b.dataset.dir);
    });
```

In `_sizeCanvas()`, replace the two lines that compute `cw` and `this.cell` with:

```js
    const wrap = this.canvas.parentElement;
    const cw = wrap.clientWidth || 320;
    // Height budget: the pad + HUD + margins below the board need ~190px; never let the board
    // push the pad off a short viewport. Width stays the cap on ordinary phones.
    const availH = Math.max(200, (window.innerHeight || 640) - wrap.getBoundingClientRect().top - 190);
    this.cell = Math.max(10, Math.min(Math.floor(cw / COLS), Math.floor(availH / ROWS)));
```

(The rest of `_sizeCanvas()` — dpr scaling etc. — is untouched.)

### 3. `snake/css/snake.css` — append, all descendant-scoped under `.sn-root` like every rule there

```css
/* --- on-screen D-pad (2026-07-23: the buttons the ready overlay always promised) ----------- */
.sn-root .sn-pad {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
  width: min(240px, 70vw); margin: 2px auto 0;
  grid-template-areas: ". up ." "left down right";
}
.sn-root .sn-pad-up { grid-area: up; }
.sn-root .sn-pad-left { grid-area: left; }
.sn-root .sn-pad-down { grid-area: down; }
.sn-root .sn-pad-right { grid-area: right; }
.sn-root .sn-padbtn {
  font: inherit; font-size: 1.15rem; line-height: 1; padding: 13px 0; border-radius: 12px;
  border: 2px solid var(--sn-pixel); background: var(--sn-card); color: var(--sn-pixel);
  cursor: pointer; touch-action: manipulation; user-select: none; -webkit-user-select: none;
}
.sn-root .sn-padbtn:active { background: var(--sn-lcd); transform: translateY(1px); }
```

### 4. `sw.js` — bump `CACHE` from `game-hub-v163` to `game-hub-v164`

The three edited files are already in `ASSETS`; only the version bump is needed.

### 5. `snake/CLAUDE.md` — one UI-notes bullet

Add under "UI notes": on-screen D-pad (▲ / ◀ ▼ ▶) below the board, `pointerdown`-driven, wired
through the same `_steer()` path as swipes and keys; `_sizeCanvas()` height-caps the cell size so
board + pad always fit the viewport. Do not rewrite the rest of the file.

## Verify (all of it)

1. `node snake/js/test.js` (engine untouched — must stay 38/38) and `node run-all-tests.mjs`
   (17 suites green), `node validate-sw-assets.mjs` clean.
2. Browser (`preview_start` name "connect-four" serves the repo; or `node server.mjs`), at
   `http://localhost:8123/` → Snake, and standalone `http://localhost:8123/snake/`:
   - Setup screen has NO pad; game screen has the pad below the board, ▲ centered over ◀ ▼ ▶.
   - Tapping ▲ from the ready overlay STARTS the run (overlay hides). NOTE: the preview pane
     throttles background `setInterval` — a run that seems frozen mid-probe is that artifact,
     not a bug (documented in snake/CLAUDE.md); assert state after a longer wait rather than
     re-diagnosing it.
   - Pad presses steer (queue a turn mid-run), and a press while paused resumes.
   - The updated overlay text shows in both languages (flip the hub toggle: "Swipe or tap an
     arrow to start" / "Desliza o toca una flecha para empezar").
   - The pad buttons carry translated aria-labels; zero console errors.
   - Board + HUD + pad all fit a phone viewport (resize_window to mobile 375x812 and confirm no
     page scroll on the game screen).
3. Commit (message naming this handoff). **Do not push** — Matt reviews first, as always.

## Out of scope

Everything else: no engine changes, no other strings, no setup-screen changes, no hold-to-repeat,
no haptics, no other games, no push.
