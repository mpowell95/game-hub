# CLAUDE.md history and rationale

This file holds the full incident narratives, Matt quotes, and measured before/after numbers
behind the rules stated plainly in the root `CLAUDE.md`. Nothing here is authoritative on its
own — every rule, fact, and decision that matters for correctness lives in `CLAUDE.md` itself;
this file exists only so that story doesn't have to be re-sent as always-loaded context on every
turn. Headings match `CLAUDE.md`'s section headings so a pointer resolves directly.

## Asking for a change means LIVE on the deployed Game Hub, not just committed to a branch

Matt (2026-08-04), after a session pushed a finished game to its feature branch and stopped
there, leaving it invisible on the real site: *"Anytime I say, commit, push, or deploy, it means
make it live on the gamehub app... Do not respond until it's fucking live."*

**THE TRIGGER IS NOT THE WORD, IT IS THE REQUEST** (Matt, 2026-09-01, after a session fixed
Skeeball's launch, pushed the branch, and asked whether to merge: *"ugh. you should know to deploy
it. we've discussed this many times"*). This rule was written down as three words - commit, push,
deploy - and a session read that as a whitelist, so "fix it" got treated as a request for a diff
rather than a request for a working app. It is not. Any instruction to change, fix, add or
remove something in this app is an instruction to make that change live, and the deploy is part of
the work, not a separate decision to bring back for approval. A fix sitting on a branch has not
fixed anything for the people playing the game.

## When Matt asks what you are doing, ANSWER HIM. Immediately.

Matt, 2026-09-08, after three messages during one long run ("any day now...", "dude what the fuck
are you doing? what could possibly be taking so long") that were each read, noted, and answered
only at the end of the work: *"Next time I message you asking what you're doing YOU MUST ANSWER
ME."*

A short honest answer costs one message; carrying on silently reads as being ignored, which is
what it was.

## Mockups are sketches, not pitches

Matt, 2026-09-12, on a Pier Nine blueprint stuffed with rationale: *"I need significantly less text.
All of the below is wasteful, adds to clutter, and makes the whole thing more frustrating to see and
use... You created this as if I'm going to pitch this in a meeting to other people. It's not a
presentation. It's you giving me a quick mockup."*

## Send the Claude.ai handoff files WITHOUT being asked

Matt, 2026-09-12: *"you must send me the stuff for Claude ai at the end of these messages. stop
makign me ask for them. Make sure he can see everything."*

## Answer about the game you were asked about

Matt, twice in one session (2026-08-11), on reports about Escoba that wandered into Chinchón and
then Battleship: *"Why the fuck are we talking about chinchon?"* and *"don't do something random and
start talking about battleship again."*

## Diagnostic: the version pill stuck at `vN → vN+1`

Until 2026-09-01 this section named only the second cause (the shell install failing), and that
cost a session twenty minutes hunting a missing file that was not missing — the real cause that
day was case 1.

**Case 1 detail, measured:** `_initVersionPill` used to run once at load and nothing subscribed to
the service worker's lifecycle, so a perfectly successful update could not reach the chip —
measured: the controller swapped at t+8s, `controllerchange` fired, and the pill read
`v551 → v552` for ever on a device running v552. **Tapping it made it worse**: the old
`_forceUpdate` read the controller immediately after `reg.update()` (which resolves BEFORE the
new worker activates), concluded "stale", and reloaded into the same screen. Only force-quitting
cleared it. Matt filmed exactly this.

**On 2026-09-01:** SHELL entries were checked live against the deployed site: 62 of 62 answered
200, which is what proved that particular incident was case 1, not case 2.

**"Much narrower since 2026-08-02"** (see "The service worker's caching strategy"): the install
used to `cache.addAll()` the ENTIRE ~8.8 MB list atomically, so one 404'd `ASSETS` entry — a
single missing card image — aborted the whole install and the previous worker kept serving the
old build offline forever. Only the ~600 KB app shell is atomic now, so a bad path in a game
folder no longer strands a deploy; it warms best-effort, logs loudly, and caches on demand
instead.

## Diagnostic: the launcher renders as raw unstyled HTML (fixed 2026-08-11)

Matt, minutes after a deploy, on mobile data: *"Whoa what the hell? I force closed and reopened and
it was normal but what is this?"* - the launcher with no CSS at all, version pill reading the new
build. Force-closing "fixed" it, which is what a transient server error always looks like.

The bug: GitHub Pages serves a redeploy by swapping the published tree, and a request landing in
that window can 404 for a moment - so opening the hub DURING a deploy could get a 404 for
`css/hub.css` and render the launcher as raw HTML. Every deploy was a window for it. The first
`[KNOWN-BUG PROBE]` in `test-sw-strategy.mjs` was born red against the unfixed worker.

## The service worker's caching strategy (rewritten 2026-08-02)

Matt: *"the gamehub is sluggish and glitchy."* Both halves of `sw.js`'s strategy were tuned for
a fast desktop connection and misbehaved on a phone with poor service.

- **Two-tier precache.** No incident behind the split itself beyond the general sluggishness
  report above; see the CACHE-bump and REST-tier bullets below for the specific measured
  regressions this shape was built to fix.
- **Network-first with a DEADLINE, not network-first forever.** The old handler only fell back to
  cache when a fetch *failed*; a weak-but-alive signal never fails, it just takes seconds per
  request.
- **Plus a `SLOW_LATCH_MS` (10s) "the network is bad right now" latch.** The deadline alone is
  charged per request, and a cold start is a serial chain (index.html → hub.js → its imports →
  theirs), so each hop re-paid it. Once one request proves the link is slower than the deadline,
  the rest of that page load goes straight to cache and revalidates in the background.
- **(2026-08-23) The warm CARRIES UNCHANGED FILES FORWARD across a CACHE bump instead of
  re-downloading them.** Matt: the launcher "became noticeably laggy where it used to be snappy."
  Measured cause: CACHE is bumped on essentially every commit (182 bumps in the 14 days before
  this landed), every bump rolled the cache name over, and `warmRest()` re-downloaded the ENTIRE
  REST tier - 347 requests / 12.6 MB per deploy, saturating the connection for the whole session
  on any device that opened the hub after a deploy, which at ~13 deploys/day meant essentially
  every open. HTTP validators cannot fix it: GitHub Pages re-stamps every file's mtime (and so
  its ETag) on every deploy, so a conditional request 200s the full body even for a file
  unchanged in weeks. The fix is the GENERATED `REST_MANIFEST` block in sw.js - a content hash
  per REST file, written by `validate-sw-assets.mjs` from the bytes on disk (that script already
  runs before every deploy; `test-sw-strategy.mjs` fails if a stale manifest is about to ship).
  Measured effect: a no-REST-change deploy fell from **12.6 MB / 387 requests to 1.5 MB / 95
  requests** (the remainder is the page's own load plus the still-atomic ~865 KB shell install),
  and the warm settles in ~0 s instead of 17-31 s.
- **(2026-09-01) The REST tier (every game's own files) is served CACHE-FIRST; the shell stays
  network-first.** Matt, on a screen recording from Anita's phone of opening Skeeball: *"Why does
  it take so long? It needs to be better than this."* Measured cause, with the whole game
  verifiably already in the cache: opening it still sent **28 requests and 2,188 KB** to the
  server. Network-first is why - `cache: 'reload'` bypasses the browser's HTTP cache on purpose,
  and the cached copy was only served if the network LOST the `NET_TIMEOUT_MS` race, so every
  module in a game's graph was re-downloaded in full on every open. The deadline and the latch
  capped how bad that got; they never stopped it. **The shell was left untouched by this change
  and split by the next one, the same day.** Measured after: **19 KB and 2 requests** to open
  Skeeball (~15s cost accepted for the first hub load after a deploy, on a game opened before the
  warm reaches its files).
- **(2026-09-01) The SHELL is split: player-data modules stay network-first, everything else is
  cache-first.** Measuring the hub's own launch showed the same bug the games had: a warm-cache
  open sent **35 requests and 225 KB gzipped to the server every single time**, because the whole
  shell was network-first. Matt's call on the trade was *"keep the stats code fresh"* rather than
  cache the lot. Measured after: **6 requests / 19 KB gzipped before the launcher appears** (was
  27 / 167), and the data modules load fresh BEHIND the painted launcher instead of in front of
  it. The same change moved `hasName()` into `js/profile-store.js` and made `js/hub.js`'s
  `stats-net.js` and `name-gate.js` imports lazy - without that, `js/admin-config.js`'s static
  edge to `game-stats.js` kept 91 KB on the critical path regardless of what the cache did.
- **(2026-09-11) A third tier: LAZY.** Matt, on Boggle's two word lists: *"Can we make the
  dictionary only download when you go to play the game? Seems like a lot for most people to
  download when they'll never use it ever."* Measured: the REST tier is **11.92 MB across 255
  files, and `boggle/data/words.txt` + `words-es.txt` are 3.23 MB of it — 27%** of everything a
  device warms, for ONE game, paid by every install whether or not anyone ever taps Boggle. The
  other two tiers both do the wrong thing here, which is why it needed a third: leaving them in
  REST downloads 3.23 MB nobody asked for, while taking them OUT of `ASSETS` entirely would stop
  the download but also drop them out of `REST_MANIFEST` and `CACHE_FIRST_PATHS` — so a player
  who DOES play Boggle would re-download 1.6 MB on their next open after **every** deploy
  (~13/day). Verified in a real browser: a full hub load + warm caches 418 entries and makes
  **zero** word-list requests; opening Boggle then fetches it exactly once (`fromSW=false`,
  1.66 MB) and caches it.
- **(2026-08-23) Old caches are deleted at the END of the warm, not at activate.** The old
  delete-at-activate behaviour opened a window on every deploy (seconds on wifi, minutes on a
  phone) where games had no cache at all and every request queued behind the warm.

Measured on a warm cache against a server injecting 8s per request (the regime the report was
about): **40.6s → 2.6s** to a rendered launcher.

## Deleting a device's history, and the rate gate (2026-09-12)

A player (TP) told Matt he had cheated. Measured from `players/`, on ONE Windows laptop:
**Tic Tac Toe 4,725 games played, 2,828 won, ONE loss, 1,896 draws** - a bot. On the same machine
he edited Hill Climb's coins in devtools to buy every upgrade. His phone looked ordinary (200
Beginner games with 5 losses and 2 draws) and his Connect Four was clean everywhere.

Matt: *"we should delete all activity that took place on his windows device, and put safeguards in
place to prevent him from doing it again. on either of these games - or any others."*

## The admin control page (2026-08-24)

Matt: *"I need an admin control page in the hub. I need to be able to make games admin only for
testing and make them live. I need to be able to release specific skeeball machines too. I need all
controls as possible from within the app."*

Both switches existed before this; both were SOURCE EDITS. Hiding a game meant `devOnly: true` in
`js/hub.js`, a `GAME_META` edit, a test-list edit, a `CACHE` bump and a deploy — Skeeball went
through that cycle three times in three days (released 08-22, pulled back 08-23, re-released
08-24). Releasing one Skeeball machine early was not possible at all: a machine is opened by
earning it, and the only bypass was the dev profile.

Matt, on the first version of the page: *"It's for me. I know what all the heading mean. I don't
need 5 paragraphs explaining what live or admin only means."*

Matt, on the first version, on why Skeeball machines needed three states: *"this doesn't allow me
to select which skeeball machines are live and can be unlocked and played vs what is not able to
be played yet."*

Matt, 2026-08-24, on why scores can be voided per player/machine: *"Worried about people getting
artificially high scores on a broken board. Which is exactly what happened to classic and
basketball skeeball."*

Matt, 2026-09-09: *"hide admin only games from the leaderboard too."*

## The profile page's structure (2026-08-31)

Matt: *"We've just kind of thrown stuff in there over time and it looks disorganized."* It had FOUR
container patterns at once — a card with a heading, a card that was itself a collapsible,
collapsibles nested inside a card, and three loose buttons in no card at all.

On why `messages/` carries real security rules while everything else is `auth != null`, Matt:
*"Only admin should be able to see every thread. Others should only see their own."*
