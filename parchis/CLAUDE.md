# Parchís (`parchis/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`, which is always
> loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

Hub integration: launch-out `href:` (built from sibling `../Parchís/`).

## Parchís (`parchis/`)

Spanish Parchís (Parcheesi family) vs AI, a **launch-out** single-file game. Its source is **not in this
repo**: it lives in the sibling project `../Parchís/` as `src/*.js` (engine, board, ai, hud, i18n, theme,
game), combined by `node recombine.mjs` into one `parchis.html` that is copied here as
`parchis/index.html` and precached in `sw.js`. **Do not hand-edit `parchis/index.html`;** edit the source
and rebuild.

- Spanish ruleset (seguros, barreras, bonos of 20 and 10). Round 2 adds two dice and an English/Spanish
  i18n toggle. AI tiers are `facil|normal|dificil`; internal colors are `amarillo|azul|rojo|verde`.
- **Profile:** Parchís prefills from `gamehub.profile` via its own inlined reader (`readProfile()`/`prefill()`
  in the built `index.html`; source in `../Parchís/src/`): human name from `profile.name`, opponent names
  and skills from `profile.opponents`. Its own last-used prefs (`parchis_r2_prefs`) take precedence, same as
  every other game (rule 9 below is the ONE deliberate exception, for language only). Do not add a reader
  on the hub side.
- **Language (2026-07-24, batch E, HANDOFF-FB2-PARCHIS.md), rule 9: the hub's `gamehub.lang.v1` wins.**
  `game.js`'s `getLang()` reads the hub key first (raw string, `'en'`/`'es'` only, malformed/missing =
  absent), then falls back to `parchis_r2_prefs.lang`, then `'en'` - a DELIBERATE reversal of "own prefs
  beat hub" for language only (Matt: the hub toggle should control every game, including this one).
  Parchís's own in-game language toggle (Settings) now writes BOTH `parchis_r2_prefs.lang` (as before)
  and `gamehub.lang.v1`, so switching from either place can never leave the two disagreeing.
  `parchis_r2_prefs` itself is unchanged otherwise (frozen key, THE LAW rule 5).
- **How-to-play (rules) screen, rebuilt 2026-07-24** (Matt: the old per-mode wall of 7 section headings
  x paragraphs "was the worst one yet"). Now ONE short sheet, both languages, no per-mode tabs: a goal
  line, one inline-SVG diagram (nest to a marked start square, to a diamond-marked safe square sharing an
  opponent peacefully, to the home column and center), a caption, and 4 bullets (how to leave the nest,
  capturing plus the bonus of 20, safe squares, and the bonus of 10 for reaching center) - the repo-wide
  How-to-play pattern from `tic-tac-toe/CLAUDE.md`. The one genuine mode difference (leaving the nest needs
  a lone 5 in Spanish rules vs any two dice summing to 5 in American rules) is folded into a single bullet
  rather than kept as separate tabs, since every other bullet is identical across modes. `i18n.js`'s old
  per-mode `RULES` table and `rules(mode)` function are gone; `hud.js`'s `HUD.openRules(back)` no longer
  takes a `mode` argument.

## Hub notes

Parchís: launch-out `href:` — Spanish Parchís vs AI. Single-file build from the sibling `../Parchís/` project (`node recombine.mjs` → `parchis/index.html`). See the rest of this file.
