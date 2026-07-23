# Monopoly Deal (`business-deal/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`, which is always
> loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

Hub integration: launch-out `href:` (in-repo `business-deal/`, own nested service worker).

## Naming (settled — do not change)

The game is called **Monopoly Deal**. Every user-visible string says "Monopoly Deal":
hub card title, page title, PWA manifest name/short_name, iOS home-screen title,
watermark, setup dialog, in-game menus, My Stats label, leaderboard label.

The folder is `business-deal/` and several internal identifiers use `business` / `bd`.
**This is intentional and must never be "fixed."** A directory name is not a display
name. These identifiers are load-bearing:

- `business-deal/` is the live URL path. Renaming it breaks every installed PWA on
  every family device (PWA scope and start_url are path-based) and every bookmark.
- The stats game id `'business'` is the key inside every player's `gamehub.stats` and
  inside Firebase RTDB at `players/<deviceId>/games/business`. Renaming it orphans
  every Monopoly Deal record anyone has ever accumulated. THE LAW #1.
- `bd-stats` is folded in ONCE by foldLegacy. Rename it and the old data can never be
  recovered.
- `gamehub.bd.pendingStats.v1` is the offline retry queue. Rename it and queued plays
  are stranded on players' devices permanently.

If a future audit or review calls the folder-name/display-name split "contradictory,"
that review is mistaken. It is not a contradiction and requires no action.
Do not rename the game to "Business Deal." Do not rename the folder. Do not rename
the stats ids. This is closed.

## Notes

Full-screen PWA that lives **in this repo** (`business-deal/`), launched like Parchís; `window.*` globals + its own nested service worker, not ESM. A precedent, not the preferred pattern. The standalone "Just Say No?" prompt (2026-07-22) is now bypassed for the case that has a known cash amount (rent/Debt Collector/Birthday) and the human is the one who'd pay: `HumanAgent.respondToAction` routes that case through `promptPayment(view, ctx, {jsn:true})` instead, adding Just Say No as one more choice alongside Pay/Clear on the normal pay screen (bank + properties + amount already visible). Declining it caches the chosen payment (keyed by creditorId+amount+reason) so the immediately-following `choosePayment()` call reuses it rather than prompting twice - the cache is only ever set for a real (>=1 card) payment, since `_charge()`'s `required<=0` early return never calls `choosePayment` for a "nothing to pay" case and would otherwise leave a stale entry. The property-steal actions (Sly Deal/Forced Deal/Deal Breaker, no cash amount) and the "counter their cancellation of YOUR action" attacker-side case still use the original standalone prompt.

The three must-stay-synced duplicates this game carries (profile reader, challenge crypto
mirror, stats recorder) are documented in the root `CLAUDE.md` under "Monopoly Deal's
must-stay-synced duplicates" — the canonical halves live in root `js/`, so that list stays
root-side.
