---
name: quarterback-2026-08-23-branches
description: Two deliberately-unmerged branches exist (archive/desk-2026-08-23, pinball-friction-wip); skeeball is per-machine engines now; see HANDOFF-QUARTERBACK-2026-08-23.md
metadata:
  type: project
---

On 2026-08-23 a quarterback session untangled the multi-session skeeball chaos.
Two branches exist ON PURPOSE and must be neither merged nor deleted:

- `archive/desk-2026-08-23`: full snapshot of the main checkout's uncommitted
  desk. (It held the parked back-wall harness; that investigation was RESOLVED
  2026-08-23 by PR #188 - never resurrect the harness or the old-layout files.)
- `pinball-friction-wip`: Matt's own unreviewed pinball friction restore
  (undoes PR #174). Waits for his review.

Skeeball's engine is per-machine since PR #186: `skeeball/js/machines/<id>/`.
The shared physics.js/machine.js/render.js are deleted; never restore them.
Full detail: `HANDOFF-QUARTERBACK-2026-08-23.md` in the repo root (untracked).
See [[concurrent-sessions-game-hub]] and [[concurrent-sessions-shared-repo]].
