# HUB-HANDOFF-3 — Polish, QA, deploy (Phase H3)

Status: **deployed.** The Game Hub Profile feature is live. One item remains and it is not automatable:
the on-device phone check (yours), plus Parchis prefill, which waits on Parchis's own Phase R2-3.

## Copy pass (light, applied)

Reviewed the hub index copy against the no-em-dash rule and for consistency. Two fixes, both in
`js/hub.js`:
- **Business Deal blurb** removed an em dash and the awkward ". vs.": now "Cards, cash & schemes. Collect
  property sets to win vs. smart AI. 2-5 players."
- **Parchis blurb** standardized "2 to 4 players" to the "2-4 players" form the other cards use.

Connect Four and Chinchon blurbs were already clean. No other hub-level copy issues found.

## QA

Full pass in a real browser (dev server, and Business Deal on its own origin). Results are in
HUB-HANDOFF-1 (profile page: create/persist/corrupt/reset) and HUB-HANDOFF-2 (per-game acceptance
checklist). Summary: every game prefills from a full profile, behaves exactly as before with no profile,
and falls back to defaults on a corrupt profile, with no console errors anywhere.

## Deploy (done)

Two pushes to `main` (both publish via GitHub Pages):

| Repo | Range | Cache |
|---|---|---|
| `mpowell95/game-hub` (hub + Connect Four + Chinchon + profile) | `ba9f5f2..0a6ce7c` | `game-hub-v25` |
| `mpowell95/business-deal` | `f7c4672..0cb6d06` | `business-deal-v21` |

Both were clean fast-forwards (my commit sat directly on the pushed remote; the parallel Chinchon/Parchis
session's work was already on origin and untouched). Business Deal's untracked local playtest files
(`Screenshots/`, the `monopoly_feedback*.html` files) were deliberately left out of the commit.

Allow a couple of minutes for Pages to rebuild. The service workers are network-first, so an online device
gets the new build immediately; the bumped caches roll offline clients over on next load.

## Definition of Done

- [x] Profile page live in the hub: create, edit, reset, persists.
- [x] Hub index shows a profile entry (top-bar pill: "Set up your profile" / "person Matt").
- [x] Hub copy pass applied.
- [x] Three of four games prefill from the profile and degrade gracefully without it (Connect Four,
      Chinchon, Business Deal).
- [~] Parchis: the hub writes a compatible shape; its prefill lands when Parchis's own Phase R2-3 ships
      (blocked behind R2-2, a separate effort). Not a hub defect.
- [x] QA checklist passes; deployed.
- [ ] Verified on Matt's phone from the home-screen bookmark. **Your step** (cannot be automated). Open the
      hub, tap the profile pill, set yourself + opponents, then open each game and confirm the prefills.

## Follow-ups (optional, not blocking)

- When Parchis R2-3 lands, re-run the acceptance checklist for Parchis (its reader maps color EN->ES and
  clamps skill to its own AI levels itself; the hub side needs no change).
- Chinchon's name field caps at 14 chars vs the profile's 20; a longer name shows fully and truncates only
  on edit. Trivial to align if wanted.
- No Unicode pickleball emoji exists; the picker uses paddle stand-ins. Swap if Matt wants a specific glyph.
