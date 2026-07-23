# Parchís (`parchis/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — the nine full rules are stated near the top of the root `CLAUDE.md`, which is always
> loaded alongside this file. Settings keys, saves, and stats written by this game are governed by
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
  every other game. Do not add a reader on the hub side.

## Hub notes

Parchís: launch-out `href:` — Spanish Parchís vs AI. Single-file build from the sibling `../Parchís/` project (`node recombine.mjs` → `parchis/index.html`). See the rest of this file.
