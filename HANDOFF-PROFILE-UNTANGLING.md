# Handoff: untangling Anita Bonita's and Natalia's profiles (Part 1 of 2)

Written 2026-07-22 at ~75% context in the session that built the diagnostic tooling below.
Picks up mid-investigation - read this whole file before doing anything, it front-loads
everything already learned so you don't have to re-derive it from the code.

**Scope of this handoff: Part 1 only - diagnose the current tangle and manually fix the
data.** Part 2 (change the app so this can't happen again) is a deliberately separate,
later task - Matt was explicit about this ("Fixing this so it never happens again is part
2. we're on part 1"). Do not start redesigning the sync/profile system yet.

---

## The problem, in Matt's own words

Ana ("Anita Bonita") and Natalia have been playing on **each other's phones**, switching
profiles back and forth, without ever using the app's own "Sync devices / Link" feature to
do it properly. Natalia has since gotten her own device and profile too, but Matt believes
**all of Natalia's game history and Ana's game history are being combined into "Anita
Bonita,"** and Natalia doesn't appear on the Leaderboard at all. He wants every game
correctly re-attributed to whoever actually played it. **Device ID is not a viable
attribution key** - that's the whole problem, both of them have played across multiple
devices under both names.

## The architecture fact that constrains everything (verified in code this session)

`gamehub.stats` (the per-device play counters) is scoped **per device**, not per profile,
and stores only running totals (`played++`/`won++`/`lost++` per game per difficulty) -
**there is no per-play event log for any game except Ball Run.** `js/game-stats.js`'s
`recordResult()`/`recordX()` functions (e.g. line 358) never look at which profile is
"active" - they just increment `st.games[gameId]` on whatever device called them. So if
Natalia played 5 games of Chinchón on Ana's phone, those 5 plays are now indistinguishably
summed into that phone's Chinchón counters forever. **This means exact, game-by-game
reattribution is only possible for Ball Run** (see "What CAN be recovered" below) - for
every other game, the best available fix is at the level of "whose bucket does this
device's CURRENT total belong in," not "which specific game was whose."

Say this to Matt plainly if it hasn't sunk in yet: most of the history cannot be split
event-by-event. The tooling below diagnoses *identity wiring* (which devices/codes/names
are currently tangled together on the Leaderboard) and lets you *reassign whole device
buckets* to the right person - it does not let you separate two people's plays that
happened on the same device under the same code/name pairing.

## Why Natalia is invisible on the Leaderboard - the mechanism (verified in code)

The Leaderboard doesn't group by device. `js/players-agg.js`'s `buildIdentity()` (lines
41-51) builds a **union-find over every `players/<deviceId>` record currently in Firebase**,
and unions two devices together if they share **either** the same player code **or** the
same (lowercased) profile name - transitively, and based only on what's in Firebase *right
now*, not history:

```js
if (code) union(dev, 'code:' + code);
if (name) union(dev, 'name:' + name);
```

So Natalia can have her own device, her own profile, and her own separate code, and still
be invisible if **either**:

1. **Her device shares Ana's code.** Most likely cause: at some point she used "Sync
   devices → Enter a code → Link" on her own phone with Ana's code, thinking it meant
   "connect as family" rather than "become the same competitive identity." If so, her
   device and Ana's device are permanently the same person to the aggregator regardless
   of names, and whichever name synced most recently wins the display (`aggregatePlayers()`,
   lines 93-101 - "most recently active device wins").
2. **A shared device's Firebase record is currently sitting on the wrong name.** If
   `players/<some deviceId>` currently shows `name: "Natalia"`, that alone unions it with
   her real device even if the codes differ.

**As of this handoff, mechanism 2 is ruled out for Ana's device specifically** - her
report (below) shows her Firebase record's *current* name is "Anita Bonita", not
"Natalia". Mechanism 1 (a shared code) is the live leading hypothesis, but **only
Natalia's own Device Details report can confirm it** - compare her `profile.playerId`
against Ana's `89N3N`. If they match, that's the bug, full stop.

## The tool that was just built this session

**`js/device-report.js`** - gathers everything identifying on a device (profile, full
stats, every per-game setting/save, sync health, a raw dump of every localStorage key with
its byte size, and two live Firebase reads: `usernames/<their current name>` and
`players/<their own deviceId>`) into one JSON object. Wired into **`profile/index.html`**
as a "Device details" button (next to Reset profile, own row, red Reset at the bottom -
already shipped and pushed). Pressing it **automatically uploads** the report to
`deviceReports/<deviceId>/<pushId>` in Firebase (a new push per press, never overwrites) -
by design, so Ana and Natalia don't have to copy/paste/screenshot anything. See the
module's own doc comment for the full field list and why challenge-system data is
deliberately excluded (it's a hidden surprise for the family, unrelated to this).

**`read-device-reports.mjs`** (repo root, dev-only, not deployed/precached) - Matt-only
retrieval tool. No new dependency: signs in anonymously via the plain Identity Toolkit
REST API and reads RTDB over its own REST API, both with built-in `fetch`. Usage:

```
node read-device-reports.mjs                 # every device's reports, full JSON
node read-device-reports.mjs <deviceId>       # one device only
node read-device-reports.mjs --raw            # unformatted single JSON blob (script-friendly)
```

**Important Firebase gotcha, already hit once:** RTDB **drops any field whose value is
`null`** when you write it. So if you see `conflicts.registeredOwner` *absent* from a
report entirely (not `null`, just missing), that means the lookup ran and found nothing -
i.e. that name has never been claimed in the `usernames/` registry. Don't mistake an
absent key for a gathering bug.

## Reports on file as of this handoff

Fetched via `node read-device-reports.mjs --raw`. Re-run this yourself first thing - more
reports (Natalia's especially) may have landed since this was written.

| Name (as of capture) | Code | Device ID | Captured | Notes |
|---|---|---|---|---|
| MattyIce | `QZCC4` | `dc1745bc-f183-481d-8c63-d79b4727ad2d` | 2026-07-22T17:56:31Z | Healthy baseline - `syncHealth.ok:true`, local/remote play counts match exactly (110/110). Use this as your reference for "what a clean, untangled report looks like." |
| You (unconfigured device) | `MQ4Q9` | `224808a1-3bef-4eb9-90c5-779bb21e5781` | 2026-07-22T17:40:07Z | Test press, profile never named - ignore, not a real person. |
| **Anita Bonita** | **`89N3N`** | **`1f75ff86-0b81-4e37-aba9-320853359869`** | 2026-07-22T19:41:55Z | Ana's report. See findings below. |

**Natalia has not sent a report as of this writing.** Getting hers is the single highest-
priority next step - almost everything below is blocked on it.

## What Ana's report already proves

Direct, concrete evidence that both of them have played on this one device, found in the
**per-game settings**, which are separate from the shared `gamehub.profile` and each game
remembers its own last-typed name:

- `perGame.chinchonSettings.humanName` = **`"Ana"`**
- `perGame.escobaSettings.humanName` = **`"Natalia"`**
- `perGame.escobaSave` is a **mid-round, in-progress Escoba match** on this device where
  the human player (`isHuman: true`, seat 0) is explicitly named **`"Natalia"`**, avatar 🐙
  (Ana's own current profile emoji, for what it's worth - not meaningful on its own, but
  another sign of a shared, not-cleanly-separated device).

So yes - Natalia has definitely played Escoba (at least) on Ana's phone, under her own
typed name, and that game's results (win/loss counters, `es.escobas`) went straight into
this device's shared `gamehub.stats.games.escoba`, indistinguishable from Ana's own Escoba
plays on the same device. **That in-progress match is still open** - if someone finishes
it, it'll add one more contaminated result. Worth flagging to Matt, not worth blocking on.

Ana's own identity data:
- `profile`: name "Anita Bonita", code `89N3N`, emoji 🐙, on device `1f75ff86...`.
- `conflicts.remotePlayer`: Firebase's own record for this device currently agrees with
  local (same name, same code, matching stats) - this device is NOT currently sitting on
  the wrong name. Rules out mechanism 2 above for THIS device.
- `conflicts.registeredOwner`: absent (see the Firebase-drops-null gotcha above) - nobody
  has ever claimed the exact string "Anita Bonita" in the `usernames/` registry. Not
  alarming by itself (that registry is keyed by exact current name, and names change).

## Exact next steps

1. **Re-run `node read-device-reports.mjs --raw`** - check whether Natalia has sent hers
   yet. If not, that's the blocker; ask Matt to have her press the button on her own phone
   (and on ANY other device she's used, if more than one - the cloud record is per-device,
   an unreported device is a blind spot, same for Ana if she has a second device).
2. **Once Natalia's report exists**, compare `profile.playerId` against Ana's `89N3N`:
   - **Same code → confirmed mechanism 1.** She linked her device to Ana's code at some
     point. The fix is to give her device its own code back (a fresh `newPlayerCode()` from
     `js/profile-store.js`, set as her device's `gamehub.profile.playerId`, then re-sync)
     and decide, with Matt, how to split the NOW-merged Firebase stats bucket between the
     two of them (see "the hard limit" above - this is a policy decision, not a data
     recovery - probably: leave the merged historical total with whichever name/story Matt
     decides, and make sure both devices sync separately from here on, which is genuinely
     possible for anything played from this point forward since it'll be under two
     distinct, un-shared codes).
   - **Different codes → the merge must be via name.** Check what Natalia's report's
     `conflicts.remotePlayer.profile.name` currently is, and whether it, or any *other*
     device's currently-synced name, collides with hers. You may need
     `node read-device-reports.mjs` for every known device, or extend the tooling to fetch
     the full `players/` and `usernames/` trees directly (there's no existing convenience
     function for that - see `js/stats-net.js`'s `readPlayersOnce()`, which fetches the
     whole node, or write a raw `fetchRTDB(databaseURL, 'players', idToken)` call in a
     script the same way `read-device-reports.mjs` already does for `deviceReports`).
3. **Once the mechanism is confirmed**, propose a concrete fix to Matt before touching any
   live data - this is someone's real game history, treat writes to `players/`,
   `usernames/`, or anyone's `gamehub.profile`/`gamehub.stats` as high-stakes and
   explicit-permission-required, not something to script and run unilaterally. Show him
   exactly what you intend to change and why, get a yes, then do it.
4. **Do not start Part 2** (preventing recurrence - almost certainly means keying stats
   storage by active profile code instead of by device, a real architecture change
   touching `game-stats.js`, every game's `recordX()` call site, and the leaderboard
   aggregation) until Part 1 is actually resolved and Matt asks for it.

## Relevant files, for reference

- `js/device-report.js` - the report gatherer/uploader (new this session).
- `read-device-reports.mjs` - the retrieval script (new this session).
- `profile/index.html` - the Device Details button + popup UI (new this session; also has
  the pre-existing quiet `.pf-devid` short-device-id display, unrelated prior work).
- `js/players-agg.js` - the Leaderboard's identity union-find (`buildIdentity`,
  `aggregatePlayers`) - the thing actually deciding who's merged with whom.
- `js/game-stats.js` - `recordResult`/`recordX()` (the per-device counters),
  `deviceId()`, `loadStats()`.
- `js/profile-store.js` - `gamehub.profile` shape, `newPlayerCode()`, and the confirmed
  fact that **retyping a name never generates a new code** - only `ensurePlayerId()`
  (called when none exists yet) or the explicit "Link" flow ever change `playerId`.
- `js/stats-net.js` - `syncMyStats()` (mirrors a device's CURRENT profile + full stats
  blob to `players/<deviceId>`, overwriting every time - confirms there's no history kept
  server-side either, just current state), `readPlayersOnce()`, `usernameStatus()`.
- `CLAUDE.md` - "The leaderboard's rating model" section documents the identity-graph
  design as intentional (union by code ∪ name); doesn't yet document this failure mode.
  Once Part 1 lands, and definitely before Part 2, add what was learned here to CLAUDE.md
  per THE LAW rule 9 - this is exactly the kind of hard-won context that must not be
  re-lost to the next fresh session.
