---
name: skeeball-one-machine-per-session
description: Skeeball work on one machine means viewing AND editing only that machine's folder — never another machine's engine files.
metadata:
  type: feedback
---

When Matt asks for work on one Skeeball machine, stay inside
`skeeball/js/machines/<that-machine>/`. Do not open, read, diff, or report on another
machine's `physics.js` / `machine.js` / `render.js` — not even to explain unrelated dirty
files in the tree.

**Why:** Matt, 2026-08-24, on seeing the classic's physics.js mentioned during BASKET FEVER
work: *"DO NOT TOUCH the classic machine's physics file. WHY are you even looking at that
file?"* The per-machine engine split (`skeeball/CLAUDE.md`'s HARD RULE) exists because a
change made for one machine silently changed another and cost him a release. Merely surfacing
another machine's files reads as being one step from editing them.

**How to apply:** Scope every read and edit to the named machine's folder plus the genuinely
shared files that machine needs (`boards.js`, `game.js`, `goals.js`, `ui.js`). Before
committing, stage by explicit path rather than reviewing the whole tree — see
[[concurrent-sessions-game-hub]], since other sessions leave unrelated files dirty. If
`validate-sw-assets.mjs` folds another machine's uncommitted bytes into sw.js's
`REST_MANIFEST`, revert those hash lines silently; that is bookkeeping, not a finding worth
reporting.
