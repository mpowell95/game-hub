# RESTORE.md — recovering a lost or reset device, and backing up the mirror

Every protection in THE LAW (see `CLAUDE.md`) guards against *code* deleting data. Nothing in
the codebase guards data's *custody*: player history lives in `localStorage` on a handful of
family phones, keyed by a per-device UUID (`gamehub.deviceId`) that exists nowhere else, mirrored
to a Firebase project with no export automation and no restore path in the app itself. This file
is that missing procedure. Every claim below is verified against the actual code (`js/game-stats.js`,
`js/stats-net.js`, `js/players-agg.js`, `js/hub.js`, `profile/index.html`), not against intentions.

## What actually gets backed up, and how

`js/stats-net.js`'s `syncMyStats()` mirrors `{ profile: {name, emoji, playerId}, stats: loadStats() }`
to `players/<deviceId>` in Firebase Realtime Database, best-effort, on every hub load and on tab-hide.
**`stats` is a full copy of `gamehub.stats`** (every game's totals, byDiff, and per-game extras) —
this is the part THE LAW protects and the part worth restoring. **`profile` is only `name`, `emoji`,
and `playerId`** — `preferredColor` and the `opponents` roster are never mirrored; they exist only in
that one device's local `gamehub.profile` and have no backup anywhere.

## (a) Restoring a lost/reset device — the normal case: RE-LINK, don't hijack the device id

**Do this first, before anything below.** This repo's identity model is deliberately
display-time aggregation: `players-agg.js`'s `aggregatePlayers()`/`aggregateForViewer()` group
every device that shares a player code into one person's view of Leaderboards and "My Stats" —
stats are never merged at rest, only when read. This means a brand-new device that links to the
lost player's existing code **immediately shows that person's full combined history**, including
everything the old device ever synced, with zero risk and zero manual data entry. This exact
scenario is covered by `players-agg.test.mjs`'s "aggregateForViewer: fresh device with my code
shows my other devices' history" test.

1. Find the lost player's 5-character code (they saw it on their own Profile page under "Your
   code"; if truly nobody has it, and you have a `players/` backup — see (c) — every device's
   record is at `players/<deviceId>/profile/playerId`, findable by matching the name).
2. On the new phone, open the hub. If no profile exists yet, the first-run gate (`js/hub.js`)
   has its own "Enter a code" + Link button; otherwise open the Profile page
   (`profile/index.html`), which has the identical "Enter a code" / Link affordance under "Your
   code".
3. Enter the code and tap Link. This adopts the owner's name/emoji (via `lookupCodeOwner()`,
   which reads the most-recently-active device carrying that code) and attaches the code to
   this device's profile.
4. Open "My Stats" or the Leaderboard. The lost device's history is already there, summed with
   this device's (empty, for now) local stats. Nothing further to do — new play on this device
   accumulates additively on top from here.

This is the RECOMMENDED path for the ordinary "my phone died / I got a new phone" case. It does
not require Firebase console access, does not touch `localStorage` by hand, and cannot clobber
anything, because it never overwrites the old device's `players/<oldDeviceId>` record at all —
it just adds a new device under the same code.

## (b) Restoring the exact same device id — only if you specifically need it

There is ordinarily no reason to do this instead of (a); it exists for the rare case where you
want a SINGLE device row (e.g. after (c)'s Firebase export shows an orphaned, un-linked old
device you want to fold back into active use under its original identity).

**Ordering matters, and getting it backwards can overwrite good data.** `deviceId()`
(`js/game-stats.js`) only mints a new random id if `localStorage['gamehub.deviceId']` is empty —
once a real id is present, it's used forever. But `syncMyStats()` fires automatically the moment
`js/hub.js` loads (its constructor calls `_syncStats()` synchronously), and it uploads whatever
`gamehub.stats` is *currently in local storage* — on a brand-new device, that's empty, and a
Firebase RTDB `update()` on the `stats` key **replaces that whole subtree**, it does not merge.
If the new phone's empty stats sync BEFORE you restore the old device's data locally, they
overwrite the old device's real history in Firebase.

The safe order:

1. Get the OLD device's exact `deviceId`, `profile` JSON, and `stats` JSON from your most recent
   `players/` export (see (c)), or read them live from the Firebase console at
   `players/<oldDeviceId>`.
2. On the new phone, open the hub ONCE so the site's `localStorage` exists for this origin. It's
   fine if a throwaway sync already fired under a freshly-minted random id — that only creates a
   harmless orphan empty record under a NEW random id, not under the old device's id, so nothing
   real is at risk yet.
3. Before doing anything else (no profile setup, no gameplay), open the browser's devtools
   console on that page and run, in order:
   ```js
   localStorage.setItem('gamehub.deviceId', '<OLD_DEVICE_ID>');
   localStorage.setItem('gamehub.profile', '<OLD_PROFILE_JSON>');
   localStorage.setItem('gamehub.stats', '<OLD_STATS_JSON>');
   ```
4. Reload. The next `syncMyStats()` call now uploads the SAME data the old device already had —
   a harmless, idempotent re-write to `players/<oldDeviceId>` — instead of overwriting it with
   empty stats. From here the phone behaves as if it always was that device.

## (c) Backing up `players/` (do this monthly)

There is no export automation in this repo (deliberately out of scope — see ARCH-REVIEW.md S7-1).
The whole insurance policy is a manual, dated export, kept **outside the repo** (never commit
player names/history to a public repo):

1. Open the [Firebase console](https://console.firebase.google.com/) → project `game-hub-5b91c`
   → Realtime Database.
2. In the data tree, select the `players` node. Use its **⋮ (kebab menu) → Export JSON**. Save
   the file dated, e.g. `players-2026-07-19.json`, somewhere outside this repo (a personal
   backup folder, not OneDrive-synced into the repo directory).
3. Repeat for the `usernames` node (the soft username-reservation registry) — smaller and lower
   stakes, but cheap to include.
4. That's it. No restore step needs to run against this file directly — (a) is almost always
   sufficient on its own since the data is already live in Firebase; this export exists purely
   as insurance against a Firebase-side incident (a fat-fingered console deletion, a project
   mishap) where the LIVE mirror itself is gone, not just a phone.

## What is NOT restorable

- **Per-device local settings and in-progress saves.** Every game's own settings key
  (`gamehub.<game>.v1`, `chinchon-settings`, `escoba-settings`, `ballrun.*`, etc.), Escoba's and
  Mancala's mid-game autosave (`escoba-save`, `gamehub.mancala.game.v1`), and Ball Run's local
  per-difficulty best-tracking keys (`ballrun.bestObstacles.*`, distinct from the mirrored
  `br.bestObstacles` inside `gamehub.stats`) live ONLY in that device's `localStorage` and are
  never mirrored anywhere. A lost phone loses these permanently; only the unified play counts and
  bests inside `gamehub.stats` (via (a) or (b)) survive.
- **`preferredColor` and the `opponents` roster** from `gamehub.profile`. `stats-net.js` only
  mirrors `name`/`emoji`/`playerId` — these two fields exist solely on-device and have to be
  re-entered by hand on a new phone even after (a) or (b).
- **A device that never went online.** `syncMyStats()` is best-effort and silently no-ops
  offline; a device that only ever played offline has nothing in Firebase to restore from at all.
