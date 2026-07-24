# HANDOFF-FB-THEME: light/dark mode hub-wide (Chinchón's, promoted)

**Batch 10 of the 2026-07-23 feedback arc — see HANDOFF-FB-INDEX.md.**
**For a Sonnet execution session. Recommended effort: high. This is the largest batch — it is
deliberately PHASED; ship Phase 1 as its own commit before starting Phase 2.**

Matt: "chinchon has light/dark mode. Make that available everywhere."

## Current state (verified)

Chinchón is the only dark mode in the repo: a `.cc-dark` class on `.cc-root` overriding the
`--cc-*` custom properties (`chinchon/js/ui.js:235-236`, `chinchon/css/chinchon.css:655`),
persisted as a `dark` boolean inside the frozen `chinchon-settings` store, toggled from its
header ☀️/🌙 button and menu. Manual only; `prefers-color-scheme` appears nowhere in the repo.

## Design (decided)

- **New shared module `js/theme.js`**, same shape as `js/i18n.js` (it is the model — storage
  key + getter/setter + change event): key **`gamehub.theme.v1`**, values `'light' | 'dark' |
  'auto'`, default `'auto'` (= follow `prefers-color-scheme`, live via `matchMedia` listener).
  `getTheme()` / `resolvedTheme()` / `setTheme()` / `onThemeChange()`; `setTheme` and the
  module-load side effect stamp **`.gh-dark` on `document.documentElement`** when the resolved
  theme is dark. A preference, not history (rule-2 carve-out, same as language).
- **Toggle**: in the hub top bar next to the language knob, ☀️/🌙 (+ Auto reachable by cycling
  light → dark → auto; show "A" badge on auto). Hidden in-game/immersive like the version pill
  and lang knob. Also add a theme row to the profile page (it is the natural settings surface;
  `data-i18n` pattern already exists there).
- **CSS mechanism**: every surface themes by overriding ITS OWN custom properties under
  `:root.gh-dark` — e.g. `:root.gh-dark .xx-root { --xx-surface: …; }` and
  `:root.gh-dark` overrides for `css/hub.css`'s shell variables. No per-element dark rules
  where a variable override will do (Chinchón's `.cc-dark` block shows how small that can be:
  ~10 lines). Games whose CSS hardcodes colors instead of using their `--xx-*` variables need
  those colors lifted into variables first — do that lift as part of each game's pass, it is
  the actual work.
- **Chinchón unification**: `js/theme.js` becomes the source of truth. Chinchón's own toggle
  now calls `setTheme()` (global), and on first load after this change, if its legacy
  `chinchon-settings.dark` is true and `gamehub.theme.v1` is unset, seed the global key from
  it (read-only migration; the legacy field stays in place untouched, rule 5). `.cc-dark`
  class application switches to following the global resolved theme.

## Phasing

**Phase 1 (own commit): the shared module + hub chrome + the three overlays.** `js/theme.js`,
the top-bar toggle, `css/hub.css` (shell, launcher cards, dialogs), `js/leaderboard-ui.js` +
`js/game-stats-ui.js` overlay surfaces (they share the hub band variables already), the
profile page, and the Chinchón unification. Everything else keeps its current light look on a
dark shell — acceptable mid-state, games own their full-bleed backgrounds.

**Phase 2 (one commit per game, any order, small sessions):** each in-hub game gets its
`:root.gh-dark .xx-root` variable override block (+ the hardcoded-color lift where needed).
Suggested order by CSS cleanliness (survey-verified): Mancala (cleanest variables) → Snake →
Boggle → Dots and Boxes → Tic Tac Toe → Nuts & Bolts → Filler → Escoba → Ball Run (canvas
games: theme the chrome, leave the canvas art alone) → Connect Four (board stays a blue board
in both themes; theme the page around it). Monopoly Deal and Parchís (launch-out, own pages)
are OUT OF SCOPE — separate tasks like their i18n.

## Rules

- Contrast: keep WCAG-ish legibility (muted text ≥ ~4.5:1 on its surface) — check the worst
  pairs, don't eyeball everything.
- The colorblind palette hues (yellow/blue/vermilion/teal + shape markers) must survive both
  themes — shift lightness, never swap hues.
- The tile ART in `js/game-art.js` keeps its per-game background fills in both themes (the
  cards are art, not surfaces); only the card chrome around them themes.
- No `prefers-color-scheme` media queries in game CSS — the ONE source of truth is the
  `.gh-dark` class from `js/theme.js` (auto mode is resolved in JS so the toggle always wins).

## Verification (per commit)

1. `node run-all-tests.mjs` green; `node test-i18n-strings.mjs` green (toggle strings EN+ES).
2. Browser: cycle light/dark/auto — hub, both overlays, profile follow instantly; reload
   persists; `resize_window` colorScheme dark with 'auto' follows the OS. Preview quirk
   memory applies (overlay screenshots can time out — verify via computed styles).
3. Chinchón: legacy dark=true device resolves dark on first load; its in-game toggle flips
   the whole hub.
4. Phase 2 per game: play one full round in dark; no unreadable text, no white flash panels.
5. `sw.js` CACHE bump LAST each commit; `js/CLAUDE.md` gets a "Theme" section modeled on the
   "Language support" one (rule 9).
