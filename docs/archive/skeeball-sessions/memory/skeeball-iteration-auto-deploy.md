---
name: skeeball-iteration-auto-deploy
description: During Skeeball tuning, deploy every change without asking — Matt can't test unless it's live.
metadata:
  type: feedback
---

While iterating on Skeeball, DEPLOY every change immediately (bump sw.js CACHE, merge to main, verify Pages) — do not ask "want me to deploy?" each turn.

**Why:** Matt (2026-08-17), frustrated: he cannot see or test a change until it's live on his phone, so per-turn deploy confirmation just blocks him. Skeeball is `devOnly` (invisible to real players), so these deploys don't affect the real game hub for anyone — there's no risk to gate against.

**How to apply:** For Skeeball (and similar devOnly tuning loops), treat "make this change" as including "and deploy it." Ship, confirm it's live, report. No separate preview needed — devOnly already isolates it. This is the general commit/push/deploy pre-authorization ([[sessions-commit-and-push]]) applied without the per-change ask. Only pause for genuinely destructive steps (force-push, history rewrite), not ordinary merge-to-main.

If a GitHub Pages run fails on a transient `429 Too Many Requests` downloading an action (GitHub infra, not our code), re-trigger with an empty commit to main — a fresh runner usually clears it.
