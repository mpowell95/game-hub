# Baseball: chat archive index (2026-10-22)

Written before Matt archived the Baseball chats. Every Baseball Claude Code session found on his
account (Sept 12 to Sept 24, 2026), its branch, and where its work lives now. Nothing below lives
only in a chat.

## Where everything is

| What | File |
|---|---|
| How the game works (current, v12) | `docs/BASEBALL-DESIGN-DOC.md` |
| Rebuild reference | `docs/BASEBALL-REFERENCE-B9.md`, `docs/BASEBALL-3D-BUILD.md` |
| Handoffs | `docs/HANDOFF-BASEBALL-AFTER-R19.md`, `docs/HANDOFF-BASEBALL-PLAYTEST-1.md`, `docs/archive/HANDOFF-BASEBALL-3B.md`, `-3C.md` |
| Rules, decisions, open items | `baseball/CLAUDE.md` |
| Full story of every batch | `baseball/CLAUDE-HISTORY.md` |
| Art and model references | `reference/baseball/` (incl. `SPEC.md`) |
| Sims and tests | `tools/sim-baseball*.mjs`, `tools/test-baseball-*.mjs`, `baseball/js/test.js` |

## Saved here because they were never merged

- `mocks-round-1-2/`: design mocks rounds 1 and 2 (branch `claude/baseball-mocks`, 7 commits,
  2026-09-14). Open with the dev server: `/docs/archive/baseball/mocks-round-1-2/career-home.html`.
- `BASEBALL-DESIGN-DOC-v9.md`: design doc v9 (branch `claude/busy-bardeen-nk4bp1`, 2026-09-13,
  per-league win-rate bands and the CPU strength rule). Superseded by v12 on `main`; kept as written.

## Sessions

Every other branch below is fully merged into `main`.

| Date | Session | Branch |
|---|---|---|
| 09-12 | Baseball Master - Fable | `claude/baseball-design-review-x2r7lk` |
| 09-12 | BB 0 phase 0 | `claude/new-session-w48igo` |
| 09-12 | Phase 2: simulator and standings | `claude/happy-einstein-yutcgu` |
| 09-13 | Phase 2a timing and power | `claude/happy-einstein-yutcgu` |
| 09-13 | Game design doc | `claude/busy-bardeen-nk4bp1` (saved above) |
| 09-13 | Phase 2d mechanisms | `claude/happy-einstein-yutcgu` |
| 09-14 | Phase 2e ladder shape | `claude/happy-einstein-yutcgu` |
| 09-14 | Phase 2f per-league weakest-slot floor | `claude/happy-einstein-yutcgu` |
| 09-14 | Design mocks, round 1 | `claude/baseball-mocks` (saved above) |
| 09-14 | Phase 3 play screen | `claude/zen-newton-vg6dn3`, `claude/baseball-phase3` |
| 09-22 | Baseball Master Fable session | `claude/bold-mendel-olrbay` |
| 09-23 | Team names list | `claude/admiring-cannon-vn97yt` |
| 09-23 | Batch 1 quick fixes | `claude/laughing-mayer-8xn800` |
| 09-23 | Bunt rework | `claude/funny-meitner-pzpojf` |
| 09-23 | Live plays engine | `claude/serene-hypatia-ykmabd` |
| 09-24 | Batch 4b: live plays drawing | `claude/blissful-goldberg-sq3yiz` |
| 09-24 | Base running controls | `claude/optimistic-ptolemy-8ibrmd` |
| 09-24 | Field play batch 6 | `claude/baseball-batch-6-field-play-8kygpf` |
| 09-24 | test-baseball-actors failures | `claude/charming-johnson-ge2nxy` (PR #814) |

Only open question from the chats: pitch Accuracy counts for almost nothing in the Majors. Logged
in `baseball/CLAUDE.md` ("Open for Matt"); the R19 handoff later gave it a real effect.

Not covered: plain Claude.ai chats (not Claude Code sessions) cannot be read from here.
