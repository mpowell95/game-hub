# Knockout handoff (2026-11-23 to 2026-11-25)

Written by a session, not by Matt. Matt's own words are quoted; everything else is the session's record.
Game: **Knockout** (folder `shove-off/`, hub id `shove-off`, stats id `shoveoff`; first named Shove Off).
**Status: ADMIN ONLY. NOT cleared for players.** Release only on Matt's "release it" (steps: `shove-off/CLAUDE.md`, "Status").
The rules and every choice live in `shove-off/CLAUDE.md`; the story in `shove-off/CLAUDE-HISTORY.md`. This file lists what
was decided, what shipped, and what is still open, in one place.

## Matt's requests in this run, in order, and what shipped (all LIVE, admin only)

| # | Matt's words | What shipped | PR |
|---|---|---|---|
| 1 | "Do a full review/test of the knockout game ... Make it as fun as possible (include animations and stuff)" | `js/fx.js` + motion: impacts, trails, falls, shrink crumble, banners, confetti, win hop, sudden-death glow, drifting water | #1769 |
| 2 | "the bumper cars don't look like bumper cars, and the sumos don't look like sumos" | Upright figures on coloured bases; marker as a badge | #1773 |
| 3 | "do you fall off the edge of the circle? or is the platform a square?" | Square clay mound removed; round raised ring only | #1775 |
| 4 | "Should we just go with knockout?" ... "yes rename" | Shown as **Knockout**, Spanish **K.O.**; ids/keys unchanged (rule 5). Trademark NOT checked | #1781 |
| 5 | "have an agent thoroughly test the game ... and grade it" | Review graded **B-** (Gameplay C+, Graphics A-, UI/UX B, Polish B) | none |
| 6 | "Make the blue sumo more blue and the red more red" | Sumo `#D7231C` / `#1652E0` | #1792 |
| 7 | "Update the thumbnail" / "Make the arrow better" | Launcher tile redrawn (wrestlers on the round ring, bold outlined arrow) | #1793, #1795 |
| 8 | `/dropbox` "update the pieces in the screenshot. create better bumper car pieces too ... the circle around them flickers a bunch" | Power ring one steady style (glow fades in over the last 10%), no full-power shake; bumper car redrawn (rubber ring all round); setup pictures = the piece big on a plain floor | #1796 |
| 9 | "fix the computer difficulty like the review said" | `cpu.js` retuned; sudden death varies on every level; test.js section 12 | #1799 |
| 10 | "fix the other things from the review too" | Zoom-in as the circle shrinks; labels fit, never "…"; replay of a round left mid-slide + result after an unseen last round (save `shown`); clearer confirms; result card pieces left; sealed online aims (server) | #1800, #1803 |
| 11 | "the How to Play is terrible. How many words did you use?" | 43 words cut to 16: goal + picture + two lines. **Never add rule lines back** | #1801 |
| 12 | "make the image look better. that's too basic" | How to play picture drawn with the real art in the player's look (`art.js` `drawHelp`) | #1802 |

## Decisions made by the session (Matt may overrule any)

- Computer tuning numbers (`cpu.js` CFG): Medium plans against "standing still" only, top 2, noise 0.16; Hard reads the
  player's move 40% of rounds (`read`), top 2, noise 0.12/0.14, 2 passes; sudden death top 3-4 + extra noise. Measured
  with `node tools/shoveoff-cpu-bench.mjs [games]`: simple play wins ~70% Easy, 35-60% Medium, 5-30% Hard.
- "Settings" (vs the computer, menu and result card) kept as is: it opens the look + level screen.
- Faces' names under the circles: shrink to 12 px, wrap between words; a single name of 12+ letters on a 360 px phone
  keeps a last-resort "…".
- Spanish "Anyone" = "Buscar"; Spanish confirms "¿Nueva partida?", "¿Rendirse?", "¿Cancelar?", "¿Rechazar?".
- Zoom target = platform + 1.25 piece radii, never more than round 1's view (`_zoomTarget`).
- Sealed online rounds apply to NEW matches only (`sv: 1`); older matches keep the old path forever (THE LAW).

## Not verified (say so; never claim otherwise)

- **Nothing here was tested on a real phone.** All checks were headless Chromium at 393x852 and 360x640.
- **Sealed online rounds**: functions `shoveOffSealed` + `shoveOffPoke` deployed and created (Firebase deploy run for
  PR #1803, success), rules deployed with it; never run in a real match. The first real online Knockout challenge is the
  first live test. If the function fails, a round sealed by both sides waits (the phone pokes after 45 s); an older build
  opening a new sealed match cannot send in it.
- Hard's thinking time (~120 ms desktop, ~450 ms at 4x CPU slowdown) on old phones.
- "Knockout" trademark status.
- A read-only database backup was taken before the rules change (2026-11-25 17:47 UTC) in the session's container only;
  it is not kept anywhere durable. Branches the anonymous backup cannot read are listed by the script.

## Open items (none started)

- Real-phone pass on: flicker fix, new pieces, zoom, How to play picture, the result card, an online sealed match.
- Release: only on Matt's "release it".

## Tools

`node shove-off/js/test.js` (engine + computer, 70), `node tools/test-shoveoff-mp.mjs` (online, 104),
`node tools/test-shoveoff-sealed.mjs` (server half, 34), `node tools/shoveoff-cpu-bench.mjs [games]` (difficulty bench),
`node tools/shoveoff-shots.mjs [outDir]` (screenshots), `node tools/check-no-scroll.mjs shove-off`.
