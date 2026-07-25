# Mancala (`mancala/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`, which is always
> loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

Hub integration: in-hub `module:`, immersive.

## Notes

Kalah rules vs AI (3 tiers; Pro = iterative-deepening alpha-beta under a ~380ms budget) or pass-and-play. Pure engine (`mancala/js/game.js`) + `ai.js` + `ui.js`; stones are persistent DOM elements sown pit-to-pit with WAAPI arc flights (timeout-raced so a hidden tab never stalls a move; `?motion=1/0` overrides reduced-motion). Settings in `gamehub.mancala.v1`; results via `recordResult('mancala', ...)`. Reference screenshots in `mancala/reference/` (gitignored).

CSS: every rule is descendant-scoped under the root class `.mancala` (`.mancala .mc-x`) — the
scoping-discipline reference for the repo, though the root class itself predates the `.xx-root`
naming convention and stays as-is.

i18n: `mancala/js/strings.js` (`{ en, es }`), `ui.js` builds `t()` at render time. Difficulty keys
(`beginner`/`intermediate`/`pro`) and speed keys (`normal`/`slow`) stay canonical; only their
display labels translate. `AI_ROSTER` names (Lucía, Diego, …) are proper names and are not routed
through `t()`.

**Difficulty display (2026-07-24):** the setup screen's difficulty segmented control shows the
shared ski-slope shape (`diffShapeSVG`/`tierOf`, `js/difficulty-tiers.js`) before each label, same
shapes the leaderboard uses, sized ~1em via `.mancala .lb-dshape`. No prose hint existed here to
delete (unlike Boggle) — this is shapes-only.

**How-to-play overhaul (2026-07-24, HANDOFF-FB2-HOWTO2 item 1):** the old five prose `<section>`s
(board/turn/extra-turn/capture/end) are gone, replaced with the repo-wide pattern
(tic-tac-toe/CLAUDE.md): a goal line, one mini-board diagram (`_sowDiagram()` in `ui.js`) showing
the counterclockwise sow with a visible dashed hop over the opponent's mancala, a caption, an
"X = Y" example, and two rule bullets. Matt's own words: "must be completely overhauled... same
excess-prose issue."

**Trimmed further (2026-07-24, batch D/FB3-HOWTO3):** QA rated this sheet "borderline" —
a paragraph under the diagram (caption + a separate "X = Y" example line) plus a bold
line and two bullets. The caption and example are now ONE merged sentence (`help_caption`
in `strings.js`; the `help_example` key and its `<p class="mc-help-example">` render are
deleted, along with the now-unused `.mc-help-example` CSS rule in both the light and dark
blocks) — meaning preserved, not dropped: "Tap a pit to sow its stones counterclockwise,
one per pit (your mancala counts, your opponent's is skipped); land the last stone in
your own mancala to go again." The diagram itself and the two rule bullets are untouched.
