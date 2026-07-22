# HUB-HANDOFF-1 — Profile page + storage module (Phase H1)

Status: **complete and verified** in a real browser (dev server on :8123). No game files touched,
nothing deployed, `parchis/` untouched.

Note on locations: the profile-project planning docs and this project's CLAUDE.md live in the sibling
`Game-Hub-Docs/` planning archive; the code below lives in this hub repo (`Game-Hub/` = `mpowell95/game-hub`).

## Files added / changed (all in this repo)

| File | Change |
|---|---|
| `js/profile-store.js` | **new** — the one profile reader/writer (ES module) |
| `profile/index.html` | **new** — the profile page (single file, hub-styled, autosaving) |
| `js/hub.js` | imports `loadProfile`; adds a profile entry to the top bar; toggles it with the launcher |
| `css/hub.css` | adds `.hub-profile` / `.hub-profile-empty` (the header pill) |
| `sw.js` | precache `./js/profile-store.js`, `./profile/`, `./profile/index.html`; `CACHE` bumped to `game-hub-v25` |

## Storage module API — `js/profile-store.js`

ES module, named exports (plus a default object). Games that are ES modules import it directly; the
single-file games (Business Deal) inline the read-only subset in H2.

```js
import { loadProfile, saveProfile, clearProfile } from '../js/profile-store.js';

loadProfile()      // -> normalized profile object, or null if absent/corrupt (try/catch, never throws)
saveProfile(p)     // -> normalized+persisted profile (stamps version:1 + updatedAt), or null on failure
clearProfile()     // -> true/false; removes the key
```

Validation (shared `normalize()` used by both load and save): names trimmed + clamped to 20 chars,
emoji clamped by code point (multi-codepoint emoji stay intact), `preferredColor` coerced to
`yellow|blue|red|green` or `null`, `opponents` sliced to 3 with `skill` clamped to 1-3 (default 2),
opponent name defaults to `Computer N`, opponent emoji defaults to 🤖. A malformed or missing key
reads as `null` ("no profile"), so a bad profile can never crash a game.

## Contract written (matches HUB-01, with the 3-tier decision)

```js
{ version:1, name, emoji, preferredColor:"yellow"|"blue"|"red"|"green"|null,
  opponents:[{name, emoji, skill:1|2|3}], updatedAt:"ISO" }
```

## Hub entry approach chosen — and why

A **pill in the sticky top bar** (`.hub-profile`, pushed right with `margin-left:auto`), not a grid
card. Reasons: it stays visible above the fold without competing with the game cards (the spec wants
game cards visually primary), and it doubles as the status indicator ("👤 Matt" when a profile exists,
"Set up your profile" in the accent color when not). It is a real `<a href="profile/">` (native nav,
same as the launch-out games) and is hidden while an in-hub game is mounted so the game keeps focus.
The name is rendered via `textContent`, so user-entered names cannot inject HTML.

## Deviations from the original spec (all intended)

1. **3 skill tiers** (Beginner/Intermediate/Pro), not 4 — per the user decision. Connect Four's 4th
   "Expert" solver stays selectable inside Connect Four only. `skill` is written as 1-3; the field
   still tolerates a future 4.
2. **ES module, not a `window` global.** HUB-02 said "attach to window", but the hub's actual pattern
   is ES modules (`hub.js` uses `import`/`export`). An ES module is the faithful match; single-file
   games inline the read-only subset in H2 rather than depending on a global.
3. **`sw.js` `CACHE` is `v25`.** A parallel session had already moved it to v24 (Chinchón "Anita"
   art); per the master-plan rule I took the highest and bumped once more.
4. Opponent + human names/emojis will be **profile-driven inside the games** (H2), per the second user
   decision. That is an H2 concern; H1 only writes them.

## Emoji set

32 curated emoji (faces, animals, sports, games). Includes golf ⛳ and 🏌️. There is no Unicode
pickleball emoji; 🏓 (paddle) is the closest stand-in, alongside 🎾 and 🏸. Flag for Matt if he wants a
different paddle glyph.

## Test results (dev server, real browser)

- Page loads with no console errors (ES-module import resolves over HTTP).
- Autosave writes the exact contract shape; `version`, `updatedAt` present.
- Reload -> values persist (name, opponent, color, skill, emoji all rehydrate).
- Corrupt the stored JSON -> page silently shows defaults, no error thrown, stored bytes left untouched
  (only overwritten on the next real edit).
- Hub pill: "Set up your profile" (no/invalid profile) vs "👤 Matt" (valid); links to `profile/`.
- Reset -> confirm dialog -> key removed -> page reverts to blank; hub reverts to the no-profile pill.
- Emoji picker opens (32 tiles), selecting updates the target and autosaves; color swatches show shape
  markers (circle/triangle/square/diamond) so selection never relies on hue alone.

## Resume point for H2

Reader is ready. In H2, prefill each game from `loadProfile()`:
- Connect Four (`connect-four/js/ui.js`): opponent[0] skill -> difficulty; personalize the existing
  "You"/"Computer" text labels. Import the module directly.
- Chinchón (`chinchon/js/ui.js`): un-hardcode `AI_NAMES`/`AI_AVATARS` from opponents; human name/avatar
  from profile; per-AI difficulty; respect the existing `chinchon-settings` last-used store.
- Business Deal (`../Monopoly-deal/`, separate repo): inline the read-only reader; un-hardcode the
  cycled AI roster; human display; count from opponents.length; one global difficulty from opponents[0].
- Parchís: verify only (its reader is pending its own R2-3). The hub already writes a compatible shape.

Skill mapping (1:1): 1 Beginner -> easy/facil, 2 Intermediate -> medium/normal, 3 Pro -> hard/dificil.
