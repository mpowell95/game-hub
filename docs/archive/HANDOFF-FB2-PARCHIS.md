# HANDOFF-FB2-PARCHIS: hub language controls Parchís + rebuild its How-to-play

**Batch E of the 2026-07-24 feedback arc (see HANDOFF-FB2-INDEX.md). Sonnet execution;
effort: medium-high. Independent of the other batches. HARD REQUIREMENT: the sibling source
folder `../Parchís/` must be available (verified present on Matt's machine, with
`recombine.mjs` + `src/*.js`). Read `parchis/CLAUDE.md` FIRST and follow its build rule: NEVER
hand-edit `parchis/index.html` — edit `../Parchís/src/*.js`, run `node recombine.mjs` from
that folder, copy the generated `parchis.html` over `parchis/index.html`, bump `sw.js`.**

Matt: "The app is set to english, but parchis is still in spanish. why? what? fix this. The
toggle on the hub should control Parchis just like it controls everything else." (Why it
happens: Parchís predates the hub's i18n and keeps its own language in `parchis_r2_prefs.lang`,
which today wins outright; the hub key was deliberately deferred — this batch un-defers it.)

## 1. Language: `gamehub.lang.v1` wins

Parchís is served same-origin, so the hub's localStorage key is directly readable.

- In `../Parchís/src/game.js`, the game-level `getLang()` (built file shows the shape:
  `prefs.lang || (readProfile() && null) || "en"`) becomes: **`gamehub.lang.v1` first** (read
  raw string, accept only `'en'`/`'es'`, try/catch, malformed = absent), then `prefs.lang`,
  then `'en'`. This is a DELIBERATE reversal of the "own prefs beat hub" precedence for
  language only — Matt's explicit instruction. Update `parchis/CLAUDE.md`'s precedence
  sentence accordingly (rule 9); leave the profile-prefill precedence alone.
- Parchís's own in-game EN/ES toggle now writes BOTH `parchis_r2_prefs.lang` (as today) and
  `gamehub.lang.v1` — so toggling inside Parchís and toggling on the hub can never fight.
  (`parchis_r2_prefs` itself is a frozen key; we add no fields, we only keep writing `lang`.)
- No hub-side changes at all.

## 2. Rebuild the How-to-play (rules screen)

Matt: "HOLY shit the how to play screen for parchis is the worst one yet. delete it and build
a new one. you can't salvage that."

- Content lives in `../Parchís/src/i18n.js` (`rules(mode)` string arrays, en+es) and renders
  via `HUD.openRules` in `../Parchís/src/hud.js`. Replace the CONTENT with the hub's proven
  pattern (tic-tac-toe's sheet): one goal line, ONE inline-SVG diagram, a caption, and at
  most 3-4 short bullets. Both languages.
- Proposed shape (VERIFY every rule against `../Parchís/src/engine.js` before writing it —
  state what the engine actually implements, do not trust memory or generic Parchís rules):
  - Goal: race all four of your pawns home first.
  - Diagram: a corner of the board showing a pawn leaving home onto the start cell, a safe
    cell marked, and the home column — the one genuinely non-obvious spatial mechanic.
  - Bullets: what roll leaves home; captures and the +20 move bonus; safe cells/barriers in
    one line; +10 for reaching home (whatever set of these the engine truly has, in its
    numbers).
- If `mode` variants exist (Round 2 two-dice rules), keep the per-mode split only if the
  engine genuinely differs; otherwise one sheet.
- The em-dash check in `recombine.mjs` will fail the build on em dashes — don't use any (the
  hub's copy rule anyway).

## 3. Build + ship

1. Edit `../Parchís/src/` only. If `src/engine.test.js` runs headless, run it.
2. `node recombine.mjs` from `../Parchís/` (it verifies no external refs, strips DEV-ONLY,
   fails on em dashes). Copy `parchis.html` → hub `parchis/index.html`.
3. `sw.js` CACHE bump LAST. `node validate-sw-assets.mjs`.

## Verification

1. Hub set to English → open Parchís: English. Hub to Spanish → Spanish. Toggle inside
   Parchís → hub reflects it on return (flag knob shows the new language).
2. A device with an OLD `parchis_r2_prefs.lang: 'es'` and hub `'en'`: Parchís opens in
   ENGLISH (hub wins) — simulate by seeding localStorage in devtools.
3. New rules screen fits a phone without internal scrolling, EN and ES; every stated rule
   matches engine behavior (cite the engine lines in the commit message).
4. `node run-all-tests.mjs` green; update `parchis/CLAUDE.md` (language precedence + new
   rules screen + this batch), rule 9.
