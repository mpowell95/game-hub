---
name: game-ui
description: Use when creating a new game folder in this Game Hub repo, or when changing any existing game's UI, CSS, styling, animation, layout, or touch/input/viewport handling — including bug fixes and playtest follow-ups on already-shipped games, not just new builds. Triggers on requests like "add a new game", "build a game", "fix the layout in <game>", "the buttons are too small", "make this animate", "fix scrolling/touch on <game>", or any CSS/UI change inside a `<game>/` folder.
---

# Game UI conventions

Read `docs/BUILDING-A-GAME.md`, "Part 0 — The UX floor," in full before making the change. It is
short and it exists because a 2026-08-21 playtest of an already-shipped game (Skeeball) found real
defects — sub-44px tap targets, sub-11px text, missing `safe-area-inset-bottom` handling, elements
left invisible in the DOM — that had each already been independently discovered and fixed inside a
*different* game's own folder doc, with no shared place either session would have found the other's
fix. This skill's only job is to make sure that stops happening: the trigger above is deliberately
broader than "building a new game," because the incident that motivated this file was a bug fix on
a shipped one, not a new build.

**If you are creating a new game folder** (not just editing an existing one), also read
`docs/BUILDING-A-GAME.md`'s Parts 1-2 in full — the module contract, the "Adding a game" checklist,
and the screen patterns (how-to-play screens, setup-screen defaults, the MP save-key convention) —
plus root `CLAUDE.md`'s "Before you build: USE WHAT EXISTS" table, which stays in the always-loaded
root file on purpose.

Do not summarize the UX floor here instead of reading it — a summary is a second copy that drifts
from the source. This file is a pointer, nothing more.
