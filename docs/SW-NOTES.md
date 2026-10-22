# sw.js notes

The long comments that used to sit inside `sw.js` (moved 2026-10-22, Matt: every phone downloads
`sw.js` on each open's update check, and most of its 93 KB was these notes). Each `[docs/SW-NOTES.md #N]`
pointer in `sw.js` marks where note N stood. Nothing was reworded.

## 1

sw.js — shared service worker for the Game Hub. Precaches the app shell and
every game module's assets so the whole hub works offline.

NETWORK-FIRST for code: a freshly deployed hub is always served when online
(the old cache-first strategy left clients stuck on stale builds until they
manually cleared the cache). The cache is only a fallback when offline.

Bump CACHE when any precached asset changes to roll the cache over.

## 2

Report a bug (2026-08-11) + the launcher announcement that introduces it. All five are shell
assets (they live under js/), so they install atomically with the hub itself - the report form
has to work on the exact device that is having trouble, including offline, where it queues the
report locally and sends it on the next connection.

## 3

The announcement's "here is where the button lives" pictures. Deliberately NOT under ./icons/
(which isShellAsset treats as shell): they are a one-time popup's illustrations, so they belong
in the best-effort REST tier where a bad path cannot strand an install. announce-ui.js removes
any figure whose image fails to load, so a device that has not warmed them yet still gets a
working popup.

## 4

NOTE: the challenge celebration images (js/challenge/assets/*) are deliberately NOT
precached. They are ~9 MB of one-person gift content; forcing every PWA installer to
download them would violate the "inert for everyone else" guardrail. The fetch handler
below is cache-first for images, so they cache on Ana's first online view and then
replay offline. The challenge redemption still works without them (image hidden on error).

## 5

Golf. The 3D stack it used to carry - three.js, cannon-es and the nine modules around them,
~1.1 MB of this precache - is gone; what is here is the 2D game. golf/js/test.js is the
engine suite and golf/CLAUDE.md is documentation: neither is fetched by a running client, so
neither belongs in this list.

## 6

stage 4 (docs/BASEBALL-3D-BUILD.md section 3.6): the 3D model + its four team-skin textures.
Plain REST tier, not LAZY - unlike Boggle's word lists this is the PRIMARY visual for the live
play screen (baseball/js/ui.js loads it the moment the game mounts, at the setup screen, never
waiting for a first play to justify it), so warming it with the rest of the game's files is the
right default. `validate-sw-assets.mjs`/REST_MANIFEST and the CACHE bump are the orchestrator's
job at ship time (docs/BASEBALL-3D-BUILD.md section 0), not this stage's.

## 7

NOTE: the Add-to-Home-Screen sheet's iOS step screenshots (icons/a2hs/*.png,
referenced from js/a2hs.js) are deliberately NOT precached here yet — those
files don't exist in the repo until real screenshots are supplied. The fetch
handler below is cache-first for images, so once the files land, add their
paths to ASSETS and bump CACHE (until then a missing image just fails to
load and the <img> removes itself; the sheet still works, minus the picture).

## 8

Chinchón decks.
  baraja-libre  Baraja Española — 48 faces + back (CC BY-SA 3.0, see its CREDITS.md)
  anita         Española skin — ships custom pips (all four suits, ranks 1–9) + a
                custom back (Ana's photo); the figures (10–12) fall back to
                baraja-libre at runtime. See chinchon/decks/anita/CREDITS.md.

## 9

--- two-tier precache -------------------------------------------------------------------------
`cache.addAll(ASSETS)` on the whole list was ~8.8 MB across ~272 files, downloaded ATOMICALLY on
every single deploy (CACHE is bumped essentially every commit). Two things went wrong with that:

  1. Speed. The install storm competes with the foreground page for the same connection. On a
     weak mobile signal the hub is visibly sluggish for as long as the storm lasts, because the
     launcher's own module requests are queued behind ~272 precache requests, including the
     1.6 MB Boggle dictionary and 672 KB of three.js for games the player has not opened.
  2. Fragility. `addAll` is atomic, so ONE bad path aborted the whole install and the previous
     worker kept serving the old build forever - the "version pill stuck at vN -> vN+1" failure
     documented in the root CLAUDE.md. A missing card image could strand an entire deploy.

So the list is split. SHELL is the hub itself (app shell + shared js/css + icons + profile): tiny,
atomic, and genuinely required for the hub to boot offline. Everything else is warmed AFTER
activation, best-effort, one file at a time with bounded concurrency, skipping whatever is already
cached. A game whose warm gets interrupted is not broken - the fetch handler caches it on demand
the first time it is opened online, and the next activation resumes the warm where it left off.

validate-sw-assets.mjs still checks the full ASSETS list, so a 404'd path is still caught before
deploy; it just no longer strands the build if one slips through.
The emoji picker's per-language keyword indexes are ~65 KB each and are imported only when a
player types in the search box. They live under ./js/ because they are modules, but the SHELL is
re-downloaded in full on every CACHE bump - i.e. on every deploy - so putting 130 KB of search
data in it would re-pay for them a dozen times a day for a feature used a handful of times ever.
In REST they carry a content hash and get carried forward untouched across a bump instead.

## 10

--- the LAZY tier: in ASSETS, but never downloaded until somebody opens the game (2026-09-11) --

Matt, on Boggle's two word lists: "Can we make the dictionary only download when you go to play
the game? Seems like a lot for most people to download when they'll never use it ever."

He is right about the size. Measured against this ASSETS list: the REST tier is 11.92 MB across
255 files, and `boggle/data/words.txt` + `words-es.txt` are 3.23 MB of it - 27% of everything a
device warms, for ONE game, paid by every install whether or not anyone ever taps Boggle.

A third tier is the honest fix, because the other two both do the wrong thing here. Leaving them
in REST downloads 3.23 MB nobody asked for. Taking them OUT OF ASSETS ENTIRELY would stop the
download, but it would also drop them out of `REST_MANIFEST` and `CACHE_FIRST_PATHS` - so a
player who DOES play Boggle would re-download 1.6 MB on their next open after every single
deploy (this repo deploys ~13 times a day), which is worse for them than today.

So a LAZY path stays in ASSETS and keeps everything that membership buys - validate-sw-assets.mjs
still fails a deploy if the file is missing, it still carries a content hash, it is still served
cache-first and cached on demand by the fetch handler - and loses exactly one thing: warmRest()
never FETCHES it. It still CARRIES IT FORWARD across a CACHE bump if this device already has a
copy, which is the whole point: pay once, on first play, then never again.

THE COST, AND IT IS REAL: a device that has never opened Boggle can no longer play it OFFLINE.
The first round has to be started with a connection. After that it is cached like anything else.
Boggle already renders an honest, translated "couldn't load the dictionary, check your
connection" screen (`renderLoadError` / the `load_error` string) because the fetch was always
lazy at the JS level, so the failure path this opens up is one that already existed and is
already handled - it just becomes reachable for a first-time offline player.

ONLY put a file here if it is BOTH large AND useless to anyone not playing that one game. Game
CODE must never be lazy: a game's modules are what the launcher tile opens, they are small, and
making them lazy would just move the 2026-09-01 cache-first win back off a phone.
Contexto's word models (2026-09-28) are the same case: ~3.7 MB per language, useless to anyone
not playing it. The game shows its own "couldn't load the words" screen with Retry (and retries
on `online`), so a first-time offline player gets an honest answer.

## 11

--- the shell's own split: always-fresh vs cache-first (2026-09-01) ----------------------------

Matt: "fast loads, everywhere in the app". Measured on v546, a warm-cache launch of the hub sent
35 requests and 687 KB (~223 KB gzipped) to the server EVERY TIME, because the whole shell was
network-first. Game code stopped doing that on 2026-09-01; this is the same fix for the app
itself, with one deliberate carve-out.

THE CARVE-OUT IS MATT'S CALL, not an implementation detail. Asked whether to cache the whole
shell (which would make a new build reach a phone one launch later, exactly as game code already
does) he chose to KEEP THE STATS CODE FRESH. So every module that reads or writes player data,
or gates whether it is VISIBLE (THE LAW rule 1), stays network-first and is listed here by hand.
Most of them are lazy-imported on a tap anyway, so keeping them fresh costs nothing at launch.

GUARD: THIS IS AN ALLOW-LIST DERIVED FROM `ASSETS`, AND IT MUST STAY ONE.
`sw.js` is not in ASSETS, so it can never reach the cache-first branch - by construction, not by
a rule someone has to remember. Express this as a deny-list over same-origin paths instead and
`sw.js` gets swallowed, and the breakage is live rather than theoretical: the network-first
branch's background put already writes sw.js into the cache, so a deny-list WOULD find a copy
and serve it. js/hub.js's version pill reads the deployed sw.js to learn the latest version, so
a cached answer freezes the pill on "up to date" for ever and _forceUpdate() never reloads.

GUARD: MEMBERSHIP IS PER FILE, NOT TRANSITIVE, AND THAT IS CORRECT. js/hub.js is cache-first and
statically imports js/profile-store.js, which is network-first. ES modules are fetched per URL,
so the graph is served from both places at once and each file gets the freshness it asked for.
Do not "fix" this into a transitive closure - it would drag hub.js, name-gate.js and announce.js
into the fresh list and delete the entire win. test-sw-strategy.mjs pins this.
EVERY SHELL MODULE IS CACHE-FIRST NOW (2026-10-22, Matt: "yes do 1"). The list below used to
hold ~30 player-data and screen modules (game-stats, stats-net, leaderboard-ui, messages-ui,
challenges-ui ...: Matt, 2026-08, "keep the stats code fresh"), each re-downloaded with
`cache: 'reload'` on EVERY app open: ~1 MB raw / ~330 KB on the wire per open measured on
2026-10-22, and up to NET_TIMEOUT_MS of waiting per file on a weak signal. Freshness does not
need it: every deploy bumps CACHE, the browser checks sw.js on every open, and the new worker
installs the new shell (only the files whose content hash changed, see install) and applies
itself on the launcher. So a phone runs new stats code from the first open after a deploy,
exactly as it runs new game code. Only the documents stay network-first. The full list as it
was is in git history (sw.js before 2026-10-22) and CLAUDE-HISTORY.md.

## 12

Warm the non-shell tier. Best-effort by design, but never SILENTLY best-effort (THE LAW rule 6):
whatever could not be cached is logged with its paths so a broken deploy is diagnosable from the
console instead of only showing up as a game that mysteriously fails offline.

Old caches are still alive while this runs (activate no longer deletes them - see the activate
handler): they are BOTH the copy source for unchanged files AND the fetch handler's fallback,
so a game opened mid-warm still serves from cache instead of queueing behind the warm on the
network. This function deletes them itself once the new cache is complete.

## 13

ONE-TIME FORCED REFETCH (2026-09-01). The surgical counterpart to PURGE_ALL_CACHES below: a
cached entry that is stale under its CURRENT name is invisible to every check this worker makes
(the manifest hash it is stored against is the correct one -- the BYTES are wrong), so it
survives deploys indefinitely. Anything listed here is dropped from the current cache at the
start of the warm, which then refetches it with `cache: 'reload'`. Cost is one file, not 8.4 MB.
Entries can be removed once a deploy carrying them has shipped.

## 14

A LAZY asset is never fetched by the warm - it is downloaded by the fetch handler the
first time the game that needs it actually asks for it, and cached on demand there. Note
this sits BELOW the carry-forward above on purpose: a device that already has the file
keeps it across every deploy for free. Not a failure, so it is not reported as one.

## 15

Record what this warm was built against, THEN retire every other cache. Order matters: the
old caches must survive until the new one is complete, or an interrupted warm would leave
devices with no fallback for whatever had not warmed yet - which was exactly the post-deploy
window the old delete-at-activate behaviour opened on every single deploy.

## 16

ONE GAME'S FILES, NOW (2026-10-14). A Game Hub message's Play button (js/hub.js openGameFresh)
opens a game right after a new build took over, which is exactly when warmRest() above has not
reached that game yet: until it does, the game's CHANGED files are answered from the previous
build's cache (the fetch handler's caches.match fallback). This does warmRest's job for one game
folder, first: same carry-forward by content hash, same `cache: 'reload'`, same skip of LAZY data.
Additive only - it puts files into the CURRENT cache and deletes nothing; warmRest later finds
them present and skips them. HELD_BACK files are included: the person is opening this very game.
Replies {ok, fetched, carried, failed}.

## 17

ONE-TIME FULL PURGE (2026-08-04). Normally `activate` deletes only caches whose name DIFFERS
from CACHE, which is right: it makes a deploy cheap and lets an interrupted warm resume. But it
also means a cache entry that is stale, truncated or half-written under its CURRENT name is
never re-fetched -- the worker keeps serving the bad copy forever, and a player whose hub renders
nothing has no way to clear it from inside an app that will not start.

That is the state Matt's phone reached: a blank hub in Chrome AND from the home-screen icon,
while every file on the server returned 200 and the identical build ran fine everywhere it could
be tested. So this build purges EVERY cache on activate, current name included, and rebuilds the
shell from the network.

Set back to false once a purge has shipped and the device is confirmed healthy. Leaving it on
permanently would re-download ~8.8 MB on every single deploy, which is exactly the storm the
two-tier precache exists to avoid. It is a recovery lever, not the steady state.

## 18

Only the shell blocks the install. The new build goes live as soon as the hub itself is safe
offline, instead of waiting on every card image of every game.

The shell is ALWAYS fetched with `cache: 'reload'` (2026-10-14). Without it the browser's HTTP
disk cache may answer: GitHub Pages sends `max-age=600`, so a deploy landing within ten minutes
of the last one installed the PREVIOUS build's bytes under the NEW cache name - and a
cache-first shell module then served them for the whole build. Matt's phone showed the old
Arrow Maze tile at v1132 while the server had the new one (js/game-art.js). It costs nothing:
Pages re-stamps every ETag on every deploy, so an expired copy re-downloads in full anyway.
(Same reason with the purge on: a purge that re-imports the corruption it deleted is not a
recovery.)

## 19

ONLY THE CHANGED SHELL FILES ARE DOWNLOADED (2026-10-22). A shell file whose content hash
(REST_MANIFEST, which holds the shell's hashes too) matches the one the previous deploy
stored is copied from the previous cache; everything else is fetched. Before this every
deploy re-downloaded the whole shell (~1.6 MB raw / ~500 KB on the wire), several times
a day. Still ATOMIC like cache.addAll: nothing is written until every fetch succeeded,
and one failure fails the install (the old worker keeps serving). The documents carry no
hash, so they are always fetched.

## 20

The hub header's version pill asks the ACTIVE worker which build it runs.
Reply over the provided MessageChannel port so the answer reaches the caller
even with multiple clients open.
One warm at a time: activate starts one, and a SHOWN_GAMES change queues another behind it.

## 21

--- PUSH NOTIFICATIONS (2026-09-23) ------------------------------------------------------------
Sent by functions/index.js (a Firebase Cloud Function; the only holder of the private key) to a
device that turned them on through js/push.js. The payload is JSON {title, body, tag, url}.

EVERY PUSH SHOWS A NOTIFICATION, WITHOUT EXCEPTION. Safari revokes the subscription of a site
whose push arrives and shows nothing, and Chrome shows a generic one in its place. So a payload
that will not parse still shows something honest rather than nothing.

## 22

WHICH MATCH (2026-09-24). Matt: "when i click on the connect 4 hoops notification, it takes me
to the setup screen... It should take me directly to that game." The payload never named the
match, but the Cloud Function has always TAGGED it `hoops-<gameId>` (skeeball `skee-<id>`), so
the id is read from there - no function redeploy needed. `data.match` wins if a later payload
carries it. The hub validates it before use.

## 23

APP ICON BADGE (2026-10-14). Matt: "Can we get badge notifications on the app icon when there's
a notification?" The number is how many of our notifications are showing. Set only AFTER the
notification is shown, and never throws, so a badge failure can never cost a notification.
Supported: iPhone Home Screen app (iOS 16.4+), installed desktop Chrome/Edge; elsewhere a no-op.
js/push.js clearShownNotifications() clears it when the hub opens.

## 24

Old caches are NOT deleted here any more (2026-08-23). They are warmRest()'s copy source for
unchanged files AND the fetch handler's fallback while the warm runs, so deleting them at
activate opened a window on EVERY deploy (seconds on wifi, minutes on a phone) where games
had no cache at all and every request queued behind the warm on the network. warmRest()
deletes every non-current cache itself once the new cache is complete; if it is interrupted,
the next activation's warm finishes the job. At most one extra generation (~11 MB) lingers.

## 25

Warm the heavy tier only once the worker is claimed and serving. Deliberately NOT awaited
inside this waitUntil: functional events (every fetch the page makes) wait on the activate
handler's promise, so awaiting the warm here would block the very page load the split was
meant to speed up. Fire-and-forget is correct - if the worker is killed mid-warm, the next
activation resumes it and the fetch handler covers anything still missing.

## 26

Immutable static assets (images, fonts) — served cache-first so re-created
<img> elements resolve instantly instead of waiting on a network round-trip
(that latency made card boards flash blank on every re-render). These files
are versioned by the CACHE bump on each deploy, so cache-first is always safe.

## 27

The REST tier's own paths, for the cache-first branch below.

GAME CODE IS CACHE-FIRST (2026-09-01). Matt, on a screen recording from Anita's phone of
opening Skeeball: "Why does it take so long? It needs to be better than this."

Measured cause, with the whole game verifiably sitting in this cache already: opening Skeeball
still sent 28 requests and 2,188 KB to the server. Network-first is why. `cache: 'reload'`
below deliberately bypasses the browser's HTTP cache, and the cached copy is only served if the
network LOSES the NET_TIMEOUT_MS race - so on any connection that is not outright bad, every
module in a game's graph is re-downloaded in full on every single open. The deadline and the
slow latch cap how BAD that gets; they do not stop it happening.

The REST tier is exactly the right boundary for fixing it, and the boundary already exists:
  - It is per-deploy versioned already. CACHE is bumped on essentially every commit, and
    REST_MANIFEST (generated from the bytes on disk by validate-sw-assets.mjs, with
    test-sw-strategy.mjs failing the deploy if it is stale) is what decides, file by file,
    whether a deploy carries a copy forward or re-fetches it. A content hash is a better
    freshness signal than an HTTP validator here - GitHub Pages re-stamps every ETag on every
    deploy - so re-asking the network per request buys nothing it does not already have.
  - THE SHELL WAS DELIBERATELY LEFT ALONE AT FIRST, AND IS NO LONGER (2026-09-01, same day).
    It said here that index.html, css/, js/ and profile/ stay network-first "so every shared
    module that touches player data keeps its freshness guarantee". Measuring the hub's own
    launch showed what that cost: 35 requests and 687 KB on EVERY open of a warm app. Matt's
    call was to split it rather than keep it - the data modules stay fresh by name, the rest is
    cache-first. See NETWORK_FIRST above for the list and the two guards that hold it together.
    Documents are still network-first either way, so a device still discovers a new deploy on
    the very next hub load and the version pill keeps telling the truth.
  - Navigations are excluded (see the handler), so a game's standalone index.html is still
    fetched honestly.

THE COST, ACCEPTED: on the first hub load after a deploy, a game opened before warmRest() has
reached its files runs the PREVIOUS build's code for that one visit. That was already true
offline and past the deadline; it is now briefly true online too. The warm finishes in seconds
and the next open is the new build. Two point two megabytes per open, on a phone, was the worse
bargain.

pinball2 IS THE EXCEPTION, and it is excluded by path. Matt, 2026-09-11: "It's perfect when I open
it within the Claude app. But when I open it in the chrome app it's the old one with the holes."
The Claude app has no service worker registered, so it fetched the new build; Chrome had one, and
cache-first handed it the previous build's physics from cache. The bargain above is the right one
for a RELEASED game, where the code changes rarely and the saving is 2.2 MB per open. It is the
wrong one for a tool that is being changed several times an hour and judged by how it plays: a
stale build there is not a slower open, it is the wrong answer to "is this fixed yet". It goes
back to network-first, which still falls back to the cache offline and past the deadline.

(2026-10-14) Generalised: EVERY held-back file (pinball2 is one of them) is network-first, for
the same reason - an admin-only game is the one being changed several times an hour. It is also
what lets those edits ship with NO sw.js change: a held-back file carries no REST_MANIFEST hash,
so a cache-first copy of it could never be told it was stale.

## 28

A NEW FILE IN AN UNRELEASED GAME NEEDS NO ASSETS ENTRY (2026-10-22): adding one to ASSETS changed
this file and so sent every phone an update (Archery's 3D models did, three times). The validator
lets a file under a held-back game's folder stay out of ASSETS unless something outside held-back
folders imports it, and it is network-first here like the listed ones.

## 29

"The network is bad right now" latch.

The deadline alone is charged PER REQUEST, and a hub cold start is a serial chain: index.html,
then hub.js, then the modules hub.js imports, then the modules THEY import. Every hop pays the
full deadline again, so on a genuinely bad link the deadline turned a 40s load into a 10s one -
better, but still four separate 2.5s stalls for a build already sitting complete in the cache.

Once ONE request has proven the connection is slower than the deadline, the rest of that page
load should not each re-discover it. While this latch is hot, a request WITH a cached copy is
served from cache immediately and revalidated in the background; a request with nothing cached is
unaffected and still waits for the network. The latch expires on its own, so a connection that
recovers goes straight back to network-first without needing an event to tell it so.

Freshness cost is bounded and small: the cache is a coherent one-deploy snapshot (`activate`
deletes every other cache), every latched response still revalidates in the background, and the
hub's version pill continues to show and force-fix a newer deploy on tap.

## 30

THE HOLE EDITOR IS NOT PART OF THE APP (2026-09-23). It lives under this worker's scope, so its
page and every golf engine module it imports came through the handlers below - and the golf
engine is REST tier, CACHE-FIRST. A device holding an older render.js served it to a newer
editor, which imports an export that copy does not have: "doesn't provide an export named
'TREE_FILL'", and the editor could not start. The editor is outside ASSETS, has no offline
promise to keep, and must always build holes with the golf code that is live now - so the
editor's page and everything it loads (a module import's referrer is the importing module)
go straight to the network, untouched by this worker.

## 31

Cache-first for immutable same-origin assets: images and fonts (which are versioned by the
CACHE bump, and whose network round-trip made card boards flash blank on every re-render),
every file in the REST tier - each game's own code and assets - and, since 2026-09-01, the
part of the SHELL that does not touch player data. See CACHE_FIRST_PATHS / NETWORK_FIRST above
for what is in each set and why the fresh half is hand-listed.
A navigation is never answered from here: a standalone game page is a document, and a
document is how a device finds out a new build exists.

The CURRENT cache is consulted before the global caches.match (2026-08-23): while warmRest()
runs, the previous deploy's cache is still alive as a fallback, and caches.match searches
caches in CREATION order - so without this, an entry already refreshed into the new cache
would keep being answered by the older cache's stale copy until the warm finished.

## 32

`cache: 'reload'` is LOAD-BEARING, for the same reason it is on the network-first path
below (the "fifth-playthrough fix"): the browser's own HTTP disk cache sits between this
handler and the wire, and Pages serves every file with `max-age=600`. A plain fetch()
here can be answered out of that disk cache with the PREVIOUS deploy's bytes, and this
line then writes them into the NEW cache under the new name -- where warmRest()'s
"already present, skip it" check leaves them for ever, and every later deploy CARRIES
THEM FORWARD, since the manifest hash they are stored against is the correct new one.
The result is a device whose version pill reads the new build while a game renders the
old one, with no way to clear it from inside the app. That shipped on 2026-09-01 with
the cache-first split and stranded Tic Tac Toe's board on one device.

## 33

Network-first WITH A DEADLINE, falling back to the cached copy.

Sixth-playthrough fix (the "sluggish on bad service" report): plain network-first only fell
back to cache when the fetch FAILED. A weak-but-alive mobile signal never fails - it just
takes many seconds per request, and `cache: 'reload'` below deliberately bypasses the
browser's own HTTP cache, so EVERY module in the graph paid that latency on every load. A
hub cold start is 15 blocking module requests plus index.html and hub.css; at a couple of
seconds each, serially resolved as the module graph unfolds, that is the sluggishness.

Racing a NET_TIMEOUT_MS deadline fixes the bad-network case without touching the good-network
one: on a healthy connection the network still wins every race and freshness is unchanged. On
a slow one the player gets the cached copy immediately while the network response continues in
the background and refreshes the cache for next time.

Consistency is preserved: `activate` deletes every non-current cache and `install` re-adds the
shell, so the cache this falls back to is a coherent snapshot of one deploy, not a mix. The
hub's version pill still surfaces "a newer build is deployed" and force-updates on tap.

Requests with nothing cached to fall back on skip the race entirely and just wait - a deadline
would only turn a slow load into a failed one.

Fifth-playthrough fix: `fetch(req)` alone is NOT enough - the browser's own HTTP disk
cache sits between this handler and the wire, and a GET whose response carried a
cacheable Cache-Control/expiry can be satisfied straight out of that disk cache without
ever reaching the server, even though this code path is labeled "network-first". That is
exactly how a stats/leaderboard regression (a full deploy, CACHE bumped, SW re-activated)
still showed some shared js/ files running old code while other, less-recently-fetched
files picked up the new deploy immediately: whichever files happened to already be sitting
in a given device's HTTP cache with unexpired headers kept being served stale by the
browser itself, invisibly to this SW. `cache: 'reload'` on the Request forces the browser
to bypass its HTTP cache and revalidate with the server on every fetch, while still letting
the response populate that HTTP cache normally for next time.
Kicked off first so the network is already in flight while the cache is consulted. The
background cache refresh is attached HERE rather than at the await site, so it still happens
on the slow path where the deadline fired and nobody is awaiting this promise any more.

## 34

A 404/503 IS NOT AN ANSWER when we are holding a good copy (2026-08-11).

Only a THROWN fetch counted as failure here, so an error RESPONSE was handed straight to
the page. GitHub Pages serves a redeploy by swapping the published tree, and a request
landing in that window can 404 for a moment - so opening the hub during a deploy could
hand the page a 404 for css/hub.css while a perfectly good copy sat in the cache one line
away. The result is the launcher rendered as raw unstyled HTML. Matt hit it minutes after
a deploy, on mobile data; a force-close fixed it, which is exactly what a transient
server error looks like.

Falling back to the cached copy is also the right call for a genuinely removed file: this
is an offline-first app, and the cache is a coherent snapshot of one deploy that rolls
over when CACHE is bumped. `net` has already refreshed the cache above if the response
WAS ok, so nothing goes stale by doing this.
