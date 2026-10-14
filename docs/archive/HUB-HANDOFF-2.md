# HUB-HANDOFF-2 — Game integrations (Phase H2)

Status: **complete and verified** in a real browser. Every game now prefills its setup and player
identity from `gamehub.profile`, and degrades to its original behavior when the profile is absent or
corrupt. Nothing deployed yet.

## Step 0 — source / build / deploy map

| Game | Source | Build | Deploy target |
|---|---|---|---|
| Connect Four | `connect-four/` (in this hub repo) | none (ES modules) | ships with the hub (`mpowell95/game-hub`) |
| Chinchón | `chinchon/` (in this hub repo) | none (ES modules) | ships with the hub |
| Business Deal | `../Monopoly-deal/` (**separate repo** `mpowell95/business-deal`) | none (static global-JS) | its own push, serves `/business-deal/` |
| Parchís | `../Parchís/src/` | `node recombine.mjs` -> `parchis.html` | copied to this repo's `parchis/index.html` (untouched here) |

Reader wiring: Connect Four and Chinchón are ES modules and `import { loadProfile } from
'../../js/profile-store.js'`. Business Deal cannot import modules, so the read-only path is inlined as
`readHubProfile()`. Parchís will inline its own reader in its Phase R2-3 (not our work).

## Corrected skill-tier table (verified against each game's real options)

| Tier | Label | Connect Four | Chinchón | Business Deal | Parchís |
|---|---|---|---|---|---|
| 1 | Beginner | easy | easy | easy | facil |
| 2 | Intermediate | medium | normal | normal | normal |
| 3 | Pro | hard | hard | hard | dificil |

Maps 1:1, no clamping. Connect Four's 4th level (`expert`, the perfect solver) is intentionally not a
profile tier; it stays selectable inside Connect Four's own setup.

## Per-game changes and precedence

**Connect Four** (`connect-four/js/ui.js`)
- Constructor reads `loadProfile()`. `opponents[0].skill` -> difficulty default (still editable on the
  setup segmented control). No last-used store, so profile beats built-ins.
- Identity: personalizes the existing labels only (no new avatar surface, since it uses colored discs).
  Legend and the "who goes first" option show `emoji name`; status and the end screen use the opponent
  name ("RoboLisa is thinking...", "RoboLisa's move", "RoboLisa wins"); the human stays second-person
  ("Your move", "You win"). Names escaped for innerHTML.

**Chinchón** (`chinchon/js/ui.js`)
- `_loadSetup()` reads `loadProfile()`. Precedence: `chinchon-settings` (last-used) > profile > built-in
  for humanName, humanAvatar, aiDifficulty, and player count. The AI roster (names + avatars) is read
  from the profile **fresh each load and never persisted**, so opponent edits always show; the fixed
  `AI_NAMES`/`AI_AVATARS` are the fallback. Player count defaults to `1 + opponents.length` (2-4).
- Consequence to note: once a player starts a Chinchón game, `chinchon-settings` is written, so later
  changes to the profile's human name / avatar / difficulty no longer override the saved values (by
  design, last-used wins); opponent names/avatars still follow the profile.

**Business Deal** (`../Monopoly-deal/js/ui.js`; also `APP_VERSION` -> v21 and `sw.js` cache
`business-deal-v21`)
- `readHubProfile()` inlined (kept in sync with the hub contract; strips `< >` from names as a safety
  net on top of the app's existing `esc()`).
- Setup prefill (when there is no in-session last-used): AI count = `opponents.length` (1-4), and the
  single global difficulty = `opponents[0].skill`. In-game: human avatar = profile emoji; each AI's name
  and avatar come from the roster in order, with the built-in flavor names as fallback for extra seats.
  The human keeps the id-based "You" the UI uses throughout (its name is never displayed).

**Parchís** — verified, not edited (see next section).

## Parchís verification result

Parchís does **not** read `gamehub.profile` yet, in either its source (`../Parchís/src/`) or the deployed
`parchis/index.html`. Its reader is planned in Parchís's own **Phase R2-3** (`../Parchís/14-PHASE-R2-3-
SETUP-I18N.md`), which is blocked behind R2-2 and not started. That doc specifies it will read
`{ name, emoji, preferredColor, opponents:[{name,emoji,skill}] }`, tolerate missing fields, and map
`preferredColor` (English -> Spanish `amarillo|azul|rojo|verde`) and skill to its own AI levels itself.

The hub writes exactly that shape (generic English color names, skill as 1-3, opponents in roster order),
so it is **forward-compatible**: Parchís will prefill automatically the moment its R2-3 ships. No hub-side
change is needed and Parchís was not touched. Action item lives with the parallel Parchís effort, not here.

## Acceptance checklist (all verified in-browser)

- [x] Full profile (name, emoji, color, opponents at distinct tiers): each game's setup opens prefilled
      (difficulty, count where applicable, human + opponent names/emojis).
- [x] No profile: each game behaves exactly as before (Connect Four "You"/"Computer"/Medium; Chinchón
      Lucía/Mateo/"You"/normal/3; Business Deal 3 AI/normal/NobleRep.../🧑).
- [x] Corrupt JSON in the key: no console errors, original defaults used (checked Chinchón + Business Deal;
      both readers try/catch to null).
- [x] Profile edits reflect on next load (no stale caching), except where a game's own last-used store
      legitimately wins (documented above for Chinchón).
- [x] Each game still mounts/starts and is playable after the edit; no console errors on any game.

Note on testing Business Deal: it lives in a separate repo, so it was served on its own origin (:8124)
with the profile set there to exercise the reader. On the real deployment it shares the
`mpowell95.github.io` origin with the hub, so it reads the same key with no code difference.

## Deviations / notes

- Names are the user's own input; every innerHTML site that shows a name escapes it (Connect Four adds an
  `esc()`; Chinchón and Business Deal already had one). Business Deal identifies the human by `id === 0`,
  not by name, so the profile name never breaks its logic.
- Chinchón's name input caps at 14 chars while the profile allows 20; a longer profile name displays fully
  and only truncates if the player edits the field. Low impact; flag if Matt uses long names.
- No Unicode pickleball emoji exists; the profile picker offers 🏓 (paddle) plus 🎾 / 🏸.

## Resume point for H3

All game code is done and verified locally; nothing is deployed. H3: hub copy/polish, one full QA pass
via `node server.mjs` (and the standalone Business Deal), then deploy. Deploy is **two** pushes:
`mpowell95/game-hub` (hub + Connect Four + Chinchón, `sw.js` already at `game-hub-v25`) and
`mpowell95/business-deal` (Business Deal, `business-deal-v21`). Both are outward-facing: confirm with the
user before pushing, and hand the on-device phone check to the user. Parchís prefill remains pending its
own R2-3.
