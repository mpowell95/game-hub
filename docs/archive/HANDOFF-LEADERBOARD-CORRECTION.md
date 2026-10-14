# Handoff: correct the Ana/Natalia leaderboard tangle in Firebase

## STOP — read this before touching Fix #2 below

Matt spent hours working through the reconstruction below with a prior Claude session. Late in
that session, Matt found a real, unresolved problem with it: the ledger assigns 8 Ball Run plays
to Ana based on timing alone (all 8 runs dated one morning, inside a window Matt himself had
defined as hers), and when pressed, neither Matt nor Claude could produce firm evidence that
attribution is actually correct. Separately, Connect Four shows exactly zero plays, ever, on every
device tied to Ana — despite the challenge system requiring several real Connect Four losses by
design (see `connect-four/js/ui.js`'s hazing/taunt mechanic, which Matt built himself) before a
qualifying win. That specific gap has a plausible explanation (Connect Four's `_statsDisqualified`
flag likely excluded those real games from ever being counted, if hints or undo were used while
walking Ana through it), but it was found only after the ledger had already been written up as if
final, and it was never reconciled against the rest of the numbers. The session ended without
resolving the Ball Run question.

**Matt is extremely unhappy with how this went** and considers it a violation of THE LAW's spirit.
To be factually precise about today's session specifically: no Firebase write happened in it —
every action, start to finish, was read-only, against `players/`, `usernames/`, `challenge/`,
`rooms/`, `deviceReports/`, and an RTDB export Matt provided directly. Nothing was deleted,
decremented, or overwritten. Today's failure was that a reconstruction this uncertain nearly got
handed off as settled, ready-to-implement fact, when it wasn't.

**But this session is not where the actual damage happened, and Opus needs that context.** Matt
separately showed a transcript of an earlier Claude session (Opus, working a "Leaderboard
overhaul" task on this same repo, before today) that self-reported a long list of confirmed
errors while building the leaderboard/rating system: broken formulas shipped and only caught after
rendering, a validation pass run against synthetic fixtures instead of real data and then reported
as verified, false claims about git commit state, and — specifically on Natalia — telling Matt "her
data never reached Firebase" and "the silent sync failure is why she vanished," both stated as
confirmed fact and both wrong (`usernames/natalia` was there in Firebase the whole time; the real
cause was the identity-merge tangle this whole investigation exists to fix). That session
apparently committed a CLAUDE.md section stating the false sync-failure cause, locally, and flagged
it for correction or revert — "whatever you decide about the rest" — without resolving Natalia's
actual situation. That thread was left open. **Today's entire multi-hour investigation exists
because that earlier session got the diagnosis wrong and never actually fixed it** — this
reconstruction is a second attempt at the same problem, not the first.

One thing worth knowing before you distrust the whole file: this session independently checked the
specific code the false claim was about (`js/stats-net.js`'s `syncMyStats()`) against what that
earlier transcript described, and the sync-health mechanism documented in `CLAUDE.md` today is
real and matches the code — loud logging on every failure path, verified by re-read, nothing
silently swallowed. So that particular false explanation, if it ever reached this file, isn't in
the copy either session has been reading. That does not mean the rest of `CLAUDE.md` is clean by
default — it means exactly one claim was checked and held up. Treat every other inherited claim
in this file, in git history, or in a prior session's summary the same way: verified against real
code or real data, or not trusted at all. That is the actual, recurring failure mode here, not a
one-time mistake — and it is exactly what THE LAW exists to prevent, whether or not a live write
ever happens.

**What this means for your work:**
- **Fix #1** (release `usernames/natalia`) is unaffected by any of this. It's a name-registry-only
  action, does not touch any player's stats or profile data, and is still correct and safe to do.
- **Do not implement the Fix #2 ledger below as given.** Every number in it needs independent
  re-verification before it's trustworthy enough to build anything on top of. Specifically:
  - Resolve the Ball Run attribution with real evidence, not timing alone, before assigning it to
    anyone — or leave it explicitly unattributed if no firmer evidence exists.
  - State plainly, wherever this ledger is used, that Ana's real lifetime total is higher than any
    counter shows, because of the Connect Four disqualification gap — don't let a total look
    complete when it structurally can't be.
  - Apply the same level of skepticism that caught the Ball Run problem to every other assignment
    in the ledger before treating any of it as reliable — never present a reconstruction as more
    certain than the evidence actually supports.
- **Update `CLAUDE.md`:** repeat THE LAW in full, verbatim, roughly every 10% of the file's total
  line count (e.g., about every 10 lines in a 100-line file, about every 100 lines in a 1000-line
  file), so no session working anywhere in that file can lose sight of it. This is a direct
  instruction from Matt.

---

Follows `HANDOFF-PROFILE-UNTANGLING.md` (Part 1: diagnose the tangle, build the Device Details
tooling). This doc picks up after Part 1's diagnosis and a long, evidence-by-evidence
reconstruction session with Matt. **Your job: turn the decisions below into an actual spec and
implementation.** Do not re-open the reconstruction itself — that work is done and Matt signed
off on it line by line. Do not start the "never happens again" architecture rework either (see
Out of Scope) — that's a separate, later task, same as Part 1 said about itself.

## The one-paragraph version

Ana and Natalia shared one physical device (player code `89N3N`, displays as "Anita Bonita") for
about a week before Natalia got her own phone. Every game either of them played on that shared
device landed in the *same* aggregate counters — there is no per-play log for any game except
Ball Run (`js/game-stats.js` only ever stores running `played`/`won`/`lost` totals per device), so
there is no way to mechanically split "whose play was whose." Matt and Claude reconstructed the
split anyway, using real evidence (per-game `humanName` settings, Ball Run's per-run timestamps,
the exact commit that made profile creation mandatory) plus Matt's own firsthand knowledge of the
timeline. That reconstruction is the table below. It is a policy decision applied to real,
unedited data — not a fabrication, and not something to second-guess without new evidence.

## Firebase project

`game-hub-5b91c-default-rtdb` (`js/firebase-config.js`). Everything below was derived from a full
RTDB JSON export Matt downloaded and shared directly in conversation. For fresh reads, follow
`read-device-reports.mjs`'s pattern: anonymous sign-in via the Identity Toolkit REST API, then
plain RTDB REST reads — no new dependency needed.

## TONIGHT — the exact target and how to reach it. Execute this, don't just spec it.

**Revised instruction from Matt, supersedes any earlier version of this section: do not touch Ana
on the leaderboard in any way. Leave `players/1f75ff86`, `players/0b0473a8`, and every other device
tied to her exactly as they currently are — untouched, unread-and-rewritten, nothing. Whatever
Ana's row currently shows on the leaderboard is correct and final. The only action is adding
Natalia back as her own, separate, correct entry.**

| Person | Plays |
|---|---|
| Matt (MattyIce) | 156 |
| King of Games | 178 |
| Bego | 48 |
| Ana (Anita Bonita) | *(unchanged — do not touch, do not compute a target number)* |
| Natalia | 8 |

**No "Test"/"Test1" row. The 15 dev/testing plays must never appear on the leaderboard at all.**

**This has to be live and correct before Matt goes to sleep tonight — do not wait for Natalia to
naturally open the app and go through the first-run flow herself. Create her profile directly.**

### Step by step

1. **Create Natalia's player record directly**, right now, by a script that writes to Firebase
   (same REST pattern as `read-device-reports.mjs` and the read-only scripts already used in this
   investigation, except this one writes). Generate a fresh player code the same shape as existing
   ones (`js/profile-store.js`'s `newPlayerCode()` — check it isn't already in use in
   `usernames/`/`players/` before writing it). Pick a key for her record the same shape every other
   `players/<id>` entry uses (she has no real device yet tonight; Matt will link her actual phone to
   this code afterward). Set `profile: { name: "Natalia", emoji: <a neutral default — not 🐙, which
   is Ana's>, playerId: <the new code> }`. Set `stats.games` to exactly the reconstructed 8: Escoba
   1 (1-0), Boggle 1 (0-1), Dots and Boxes 1 (1-0), Filler 2 (2-0), Mancala 1 (0-1), Nuts & Bolts 1
   (1-0), Parchís 1 (0-1) — **check `js/game-stats.js`'s `ensureXx()` functions for each game's
   exact stored shape before writing; don't guess the JSON structure.**
2. **Point `usernames/natalia` at her real new code**, overwriting the stale `{ code: "89N3N" }`.
   This is Fix #1, folded into this same action rather than done separately.
3. **Verify steps 1–2 landed**: fresh re-read of both records, confirm they hold exactly what was
   intended.
4. **Stop there. Do not touch Ana's side at all** — not `1f75ff86`, not `0b0473a8`, not the 3
   orphaned pre-gate devices (`19bb8f1c`, `df6d92dc`, `f024b853`) mentioned in the ledger below.
   Those were part of an earlier version of this plan that involved subtracting Natalia's share
   from Ana's counters and folding the orphaned devices into her identity — Matt explicitly reversed
   that. Her data, and her leaderboard total, stay exactly as they already are. The fact that her
   current total still includes Natalia's 8 plays blended in is a known, accepted tradeoff, not an
   error to fix tonight.
5. **Confirm the Test bucket stays invisible.** The 6 anonymous post-gate dev/test devices have no
   name, so they're already off the leaderboard — don't name them. `f8ad1b82` (the "test" device, 4
   plays) does have a name; check whether it currently shows on the leaderboard, and if it does or
   risks it, clear its `profile.name` — its 4 plays stay exactly where they are, only its visibility
   changes.
6. **The actual acceptance test:** read the leaderboard fresh and confirm Natalia now appears with
   exactly 8 plays (Escoba 1, Boggle 1, Dots and Boxes 1, Filler 2, Mancala 1, Nuts & Bolts 1,
   Parchís 1), Matt/King of Games/Bego are unchanged, Ana's row is unchanged from whatever it was
   before this task started, and no Test/dev entry appears anywhere. If any of those isn't true,
   this isn't done.

Apply the same verify-before-trusting-a-write discipline throughout as `js/stats-net.js`'s
`syncMyStats()` already models: capture the state before writing, re-read fresh after, confirm
Natalia's new record landed exactly as intended. This is a pure addition — nothing is being moved
out of any existing record, so there's no "verify nothing was lost in the move" step needed the way
an earlier version of this plan required; there's only "verify the new record is correct."

### Immediately after tonight's fix is confirmed live — the actual #1 priority

This is no longer deferred, "someday" work. The next task, right after the table above is
confirmed correct on the real leaderboard, is making this **architecturally impossible to happen
again** — key `gamehub.stats` writes to the active profile's code instead of the raw `deviceId()`,
so two people sharing one device can never blend into a single record no matter what either of them
does. Touches `js/game-stats.js`, every game's `recordX()` call site, and how `js/hub.js`'s
first-run gate hands off into it. Scope and build this immediately once tonight's data is verified
correct — not later, not as a separate "Part 2" someone gets to eventually.

---

## Fix #1 (reference — folded into step 2 above) — the username registry bug

`usernames/natalia` currently holds `{ code: "89N3N" }` — Ana's code. It is stale. It is the
literal reason Natalia's brand-new phone told her "Taken. Use that code instead." when she tried
to claim her own name for the first time ever.

**Action:** release it. `js/stats-net.js` already exports `adminReleaseUsername(name)` — it's
currently unused by any UI, built exactly for this kind of correction. Call it with `'Natalia'`.
This touches no game data, no profile, no stats — only a name-reservation courtesy record.

**Root cause, for whoever eventually builds Part 2's prevention work:** `js/hub.js`'s
`initFirstRun` "fr-save" handler calls `claimUsername(name, code, '')` — note the hardcoded empty
string for "previous name," so it can register a new name but can never release whatever name
preceded it on that device. `profile/index.html`'s own rename flow passes the real previous name
and releases correctly. The bug only fires when a device's local profile gets reset (clearing the
name) and then re-claimed through the hub's first-run gate rather than through the profile page's
rename field. That's almost certainly how "natalia" got orphaned under `89N3N`: the shared device
was named "Natalia" at some point, later reset, then renamed to "Anita Bonita" through the
first-run gate, which claimed the new name without releasing the old one.

**After the release:** Natalia opens the app on her own phone, taps Save with "Natalia," gets a
fresh code, and every play from that point on is correctly, permanently hers. No further code
needed for future correctness — this fixes forward-looking behavior completely by itself.

## Fix #2 — the reconstructed historical ledger (UNVERIFIED — see STOP section at top, do not implement as-is)

Every logged play in the database, assigned to a specific person, with rationale. Nothing left
unassigned; nothing assigned without a reason. Verified to sum to the live leaderboard's current
totals (checked against a screenshot Matt took after this ledger was built — see the cross-check
section below).

| Person | Plays | Rationale |
|---|---|---|
| Matt (MattyIce) | 156 | Devices `dc1745bc` + `2b0d7c05` (real player code `QZCC4`) + `e0e63fde` (name match, no code, an alternate browser/session of his — device IDs are per-browser-install and churn on storage clears/reinstalls, see below) |
| Test (development/testing traffic, explicitly NOT Matt's personal play) | 15 | `f8ad1b82` (device literally named "test," used to host/guest Matt's own multiplayer lockstep test rooms — 4 plays) + 6 anonymous devices whose blank-profile activity falls *after* the mandatory profile gate went live (commit `7f3812b`, 2026-07-18 01:04 AM Boston) and plays exactly the newest games in the hub (Tic Tac Toe, Dots and Boxes, Boggle) — see "Why these are dev/test, not family" below (11 plays) |
| King of Games | 178 (locked — do not add or remove anything from this figure without Matt's explicit say-so) | Real player code `3VN33`; his own device's growth since this ledger was built is genuine new play, not a reassignment |
| Bego | 48 | Real, distinct, consistently-used name; unrelated to the Ana/Natalia tangle |
| Ana | 17 | See breakdown below |
| Natalia | 8 | See breakdown below |
| **Total** | **422** | |

### Why the dev/test devices are dev/test, not family (the load-bearing reasoning — verify before trusting)

The mandatory "choose a name or link a code" gate (`js/hub.js`'s `initFirstRun`, a full-screen
blocking modal — `.hub-fr { position: fixed; inset: 0; z-index: 300 }` with a scrim, confirmed in
`css/hub.css`) shipped in commit `7f3812bdad18b0b6ad63e12c0390fa7b20620229`,
**2026-07-18, 01:04:20 AM Boston (America/New_York)**. Before that commit, a device could play
anonymously with no name at all — normal, unremarkable. After it, the *only* way to keep playing
with a blank profile is to never open the hub shell at all and instead hit a game's own standalone
URL directly (`/tic-tac-toe/`, `/dots-boxes/`, `/boggle/`, `/escoba/` etc. — every module game runs
standalone by design, see `CLAUDE.md`'s module contract). A real family member reaches games
through the installed hub icon and would hit the gate immediately. Deliberately loading a game's
own URL directly, bypassing the hub, is exactly what verifying "does it run standalone" looks like
— a developer/QA action, not organic family use.

Applying that cutoff:
- 3 devices dated *before* 2026-07-18 01:04 AM (`19bb8f1c` 7/16, `df6d92dc` 7/17, `f024b853` 7/17)
  — blank play was normal then, no bypass implied. Assigned to Ana (see below).
- 6 devices dated *after* that commit, all blank profile, all playing either Escoba (the
  household's known shared-device game) or one of the three newest games in the hub at the time
  (Tic Tac Toe, Dots and Boxes, Boggle) — assigned to Test.

**If new evidence surfaces that any specific one of these 6 was actually a family member testing
manually or a Claude Code/Claude-in-Chrome verification session, that's consistent with this
category either way — the point is they are not Ana's or Natalia's family gameplay.**

### Ana's 17, precisely (REFERENCE ONLY — not acted on tonight; see "TONIGHT" section at top, Ana is not to be touched)

- 12 are inside the leaderboard's current "Anita Bonita" row (`1f75ff86` unions with the older,
  code-less `0b0473a8` by matching profile name — that's how the two combine to the 20 plays
  currently shown): Ball Run 8 (8-0, dated 7/22 morning — hers per the agreed boundary) + Chinchón
  2 (1-1, her own `chinchonSettings.humanName: "Ana"`, and the win matches her known 7/14 challenge
  win) from `1f75ff86`, plus all of `0b0473a8`'s Business 2 (1-1) — that device's only sync predates
  Natalia's registration entirely.
- 5 more are on orphaned, currently-invisible devices (blank name, never merged into any
  leaderboard row): `19bb8f1c` (Nuts & Bolts 2), `df6d92dc` (Filler 2), `f024b853` (Escoba 1) — all
  three predate the profile gate, in the days right after Ana's own 7/14 registration, playing
  games her later named profile also plays.

### Natalia's 8, precisely

All of it is the *remainder* of `1f75ff86`'s current 18-play total once Ana's 10 (Ball Run 8 +
Chinchón 2) are set aside: Escoba 1 (1-0, her own `escobaSettings.humanName: "Natalia"`, matching
the in-progress `escoba-save` that also names her), Boggle 1 (0-1), Dots and Boxes 1 (1-0), Filler
2 (2-0), Mancala 1 (0-1), Nuts & Bolts 1 (1-0), Parchís 1 (0-1). The latter six carry no name tag of
their own — they were assigned to Natalia per Matt's explicit standing rule: any play on that
device between Natalia's registration (2026-07-18, 7:47 AM Boston — confirmed by the
`usernames/natalia` claim timestamp) and the morning of 2026-07-22 (when the device's profile
reverted to "Anita Bonita" and Ana resumed using it directly) belongs to her.

### Cross-check against the live leaderboard

Matt's screenshot after this ledger was finalized showed: Bego 48, MattyIce 156, King of Games 178,
Anita Bonita 20 (6-5, rating 17). All four match this ledger's source numbers exactly (Anita
Bonita's 20 = Ana's 12 + Natalia's 8 that are inside that merged row; King of Games grew by 1 play
since the export this ledger was built from, which is real, ordinary play, not a reassignment).

## The hard part — what you need to actually spec

**What THE LAW means, precisely, for this task — Matt's own words, not the full nine-rule list in
`CLAUDE.md`:** *"You must never delete or lose or risk deleting or losing any player data. You must
always verify this."* That is the entire constraint. It does not mean "never decrement a counter" —
it means the total number of real, recorded plays must never shrink, disappear, or become
unverifiable in the process of fixing this.

**Do not build a UI note, banner, "carried forward" line, or any other interface change.** Matt was
explicit: no user, anywhere in the app, should see any note about a reconciliation. This is not a
display problem. **This is a data problem, and it must be fixed in the data.**

**What "fix it in the data" means concretely:** `players/1f75ff86`'s counters for Escoba, Boggle,
Dots and Boxes, Filler, Mancala, Nuts & Bolts, and Parchís currently hold Natalia's 8 plays blended
into Ana's device. Once Natalia has her own live player record (after Fix #1, when she claims her
name and gets her own code on her own phone), those 8 plays need to actually move: subtract them
from `1f75ff86`'s counters for those seven games, and add them to Natalia's new record's counters
for the same seven games. Ana's device is left holding only what's actually hers (Ball Run 8,
Chinchón 2, plus `0b0473a8`'s Business 2 — 12 in total from these two devices, matching the ledger
above). Natalia's new record starts with the 8 that are actually hers. Nothing is deleted — it is
correctly re-homed. The family-wide total before and after must be identical; that's the number to
verify.

**How to verify it, per Matt's actual requirement ("you must always verify this"):** before writing
anything, record the exact total play count on every device this touches. After writing, re-read
every touched record fresh (not from a cached value — an actual new read) and confirm: (1) the sum
across all touched devices is unchanged from before the write, (2) Ana's device now shows exactly
the reduced counters you intended, (3) Natalia's new record shows exactly the added counters you
intended. If any of those three checks fails, the write has NOT succeeded — treat it as a failure
regardless of what the write call itself returned, and do not leave the data in a half-migrated
state. This is the same verify-by-fresh-re-read pattern already used by `js/stats-net.js`'s
`syncMyStats()` and `js/game-stats.js`'s `persist()` — follow that precedent, don't invent a new
one.

**Sequencing matters for the "never at risk of loss" requirement:** don't decrement Ana's device
until Natalia's corrected record has been written and verified to actually hold the 8 plays. If you
do it in the other order, there's a real window where those 8 plays exist nowhere — that is exactly
the kind of risk Matt is telling you to never create, even briefly.

**You may NOT present the split as more certain than it is** (this part of THE LAW's spirit still
applies even without a UI note): the 6 games in Natalia's share that carry no name tag of their own
are a policy decision, not a recovered fact. That doesn't change what gets written to the data — it
changes how carefully you verify before writing it, and it's why the Ball Run and Connect Four
problems flagged at the top of this doc need to be resolved with real evidence before you touch
anything, not waved through because a total needs to add up.

## Explicitly out of scope for TONIGHT (not out of scope overall — see "immediately after" above)

- **The architecture rework** (profile-code-keyed stats) is not tonight's task, but it is the very
  next one — see above. Don't start it before tonight's data fix is verified live; don't let it
  slip into "someday" either.
- **The 6 anonymous Test-bucket devices beyond `f8ad1b82`** need no action tonight — they're
  already nameless and invisible. Leave them alone.
- **`chinchonStatsLegacy` / `monopolyDealStatsLegacy`** — old pre-unification stat generations found
  on a couple of devices during this investigation. Separate, frozen-in-place per THE LAW rule 5.
  Not part of this correction.

## Relevant files

- `js/stats-net.js` — `adminReleaseUsername`, `claimUsername`, `usernameStatus`.
- `js/hub.js` — `initFirstRun` (the gate, and its release-bug).
- `js/profile-store.js` — `gamehub.profile` shape.
- `js/game-stats.js` — `recordResult`/`recordX()`/`persist()`; the counter shapes you're moving
  plays between, and the verify-by-fresh-re-read pattern to follow.
- `js/players-agg.js` / `js/leaderboard-rank.js` — the leaderboard aggregation and rating math that
  reads these counters; no UI or display change needed here, but worth confirming the corrected
  numbers flow through it the way you expect.
- `HANDOFF-PROFILE-UNTANGLING.md` — Part 1, the diagnosis this continues.
- `CLAUDE.md` — THE LAW (rules 2 and 4 are load-bearing here), the leaderboard rating model
  section, the module contract.
