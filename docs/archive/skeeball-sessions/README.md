# Skeeball: the Claude Code sessions (archived 2026-10-22)

Matt archived every Skeeball session on 2026-10-22. Before that, every transcript was read and
every branch checked against `main`: **all Skeeball code from these sessions is on `main`.**
Everything that lived only in a chat, an artifact page, or a file never committed is saved here.
Matt's uploaded photos and videos cannot be recovered (transcripts keep only a placeholder);
reference media retired 2026-08-26 is still in git history.

## What is saved here

| File | What it is | Session |
|---|---|---|
| `PROMPT-2026-08-13-rebuild-from-scratch.txt` | Matt's opening prompt for the from-scratch rebuild | Skeeball arcade game |
| `REVIEW-2026-08-14-vs-commercial-app.txt` | review against the commercial Skee-Ball app (overtaken) | Skeeball game review |
| `PROMPTS-2026-08-14-docs-review-howto.txt` | docs-reorg, harsh-review and how-to prompts | Skeeball reference folder |
| `HANDOFF-LEADERBOARD-DESIGN-SPEC-2026-08-25.md` | content-only spec for Claude Design (final) | Skeeball leaderboard UI |
| `HANDOFF-SKEEBALL-LB-DESIGN-2026-08-25-rejected.md`, `artifact-skeeball-lb-brief-rejected.html` | first brief, rejected by Matt | same |
| `artifact-brick-city-marquee.html`, `hot-shot-brick-city-sign.html` | the BRICK CITY marquee Matt picked | Skeeball classic board measurements |
| `artifact-unlock-ceremony-preview.html` | unlock ceremony preview page | Machine 3: Hot Shot Brick City |
| `artifact-blueprint.html` | machine blueprint, 4 plates, lettered parts (`other/gen-blueprint.mjs.txt` drew it) | Skeeball - remove wedge |
| `artifact-goals.html`, `artifact-crosssection.html` | goals-in-the-gutter mockup; the two invisible bodies (resolved) | Skeeball throw distance bug |
| `artifact-screens.html` | batch G screen mockups | Skeeball project status |
| `MATT-2026-08-24-hotshot-brickcity-asks.txt` | Matt's batch of HOT SHOT / BRICK CITY asks; two still open, in `TODO.md` | Machine 3: Hot Shot Brick City |
| `PROMPT-2026-09-22-finish-connect4-hoops.txt` | Hoops, not Skeeball; written in a Skeeball-named session | Skee-ball machine board designs |
| `handoffs/` | 8 handoff docs written but never committed (08-16 has the board geometry and the flick-test numbers 0.65 / 3.00 / 4.95 / 16.62) | board layout, Batch G, corner 100, scuff, conflict resolution |
| `memory/` | 5 auto-memory notes from Matt's PC (tuning rules: deploy every tweak, no slow tests for tweaks, one machine per session) | various |
| `mockups/` | 4 scoreboard / screen mockups | board layout redesign |
| `other/` | app-speed plan v1-v6 (Batch 2 and 3 never built, in `TODO.md`), per-game load table, launch diagnosis, playtest brief, geometry blank, a corner-basket probe (`.mjs.txt`: known hole, see its header) | launch performance, others |

Branches kept on purpose (unmerged, do not delete): `claude/brickcity-funnel`,
`claude/brickcity-collar-split` (measured corner-100 experiments in their commit messages),
`archive/desk-2026-08-23`, `pinball-friction-wip`.

## The sessions

Open when archived (cloud): Skee-ball machine board designs (09-22, mostly Hoops), objectives
visibility (08-27), POPONGO board review (08-27), leaderboard UI (08-25, code superseded by the
design handoff), Machine 3: Hot Shot Brick City (08-25), classic board measurements (08-24),
Remove skeeball_old and snake v2 (08-18), How To Play screen (08-15), game review (08-14),
arcade game (08-14), game revision (08-12), reference folder (08-15). All merged or chat-only. Not fully read: "Skee-ball machine board designs" before 2026-09-22 19:09
(thousands of events, mostly autonomous Hoops work; its commits are on `main`).

Already archived (mostly Remote Control on Matt's PC): physics issues investigation, Brick City
corner 100 (three sessions), ramp end pieces, Leaderboard Hot Shot board review, launch
performance, 100 basket enlargement, arcade cabinet design, sessions conflict resolution,
Basketball or beer pong, throw distance bug (two), Batch G review bullets (two), remove comments,
project status, remove wedge, board layout redesign (four), game review. All code on `main`.
