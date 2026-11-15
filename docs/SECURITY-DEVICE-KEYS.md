# Privacy and security: device keys and PINs (2026-11-04)

Matt: "Yes start on 1-3" (lock `players/`, stop anyone claiming any code, stop exposing codes), and chose
"PIN from old phone" for how a new phone joins an existing player.

## The holes (rules as of v1464)
- Every visitor is signed in anonymously; most nodes only check `auth != null`.
- `players/` is readable by anyone and holds every code (`profile.playerId`); `usernames/` maps name to code.
- `msgAuth/<uid>` is client-writable with ANY code, so anyone can become anyone (Messages, daily boards, push subs).
- `players/<id>` is writable by anyone (overwrite any record).
- name-gate "That's me" links to a code by typed name alone.

## Step A (v1465, LIVE, invisible to players)
- `js/device-key.js`: a phone holding its claim makes a random key (kept in `gamehub.deviceKey.v1`) and sends
  its SHA-256 to `claimReq/<uid>` (t `reg`). `functions/claim.js` (`claimOnRequest`) stores it at
  `codeKeys/<CODE>/<hash>` = `{uid, at, last, uids}` only if `msgAuth/<uid>` already says that code.
  t `key` (prove a key) restores `msgAuth` for a new sign-in; nothing calls it yet.
- `js/stats-net.js` stamps `own: <uid>` on `players/<id>` (additive report).
- Rules: `claimReq/<uid>` own write, `claimRes/<uid>` own read, `codeKeys` admin read. Nothing else changed.
- `tools/test-device-key.mjs`.

## Design change (2026-11-04, Matt: "Can we make it a popup? Like if trying to log into another device, you get a notification from the game hub asking to confirm?")
No PIN. The new phone asks; the player's other phones get a popup (app open) or a push (app closed) with Allow / Deny;
Matt can Allow from Admin > Now (a lost only phone). Mockup: `docs/mockups/new-phone-approval.html` (NOT approved yet).
The PIN items below are replaced by this once Matt approves the mockup.

## Design change 2 (2026-11-04, Matt: "Let them play. Make them a full player. idk why i'd every not approve someone. bu i could remove them after the fact")
A new device that links with a code plays at once as a full player. The player's other devices get a notification /
popup "New sign in" with Remove / OK; Matt can Remove from Admin > Now. Remove signs that device out (its local data
stays on it, nothing deleted). Limit, said plainly: the code alone gets someone in again; this only tells the owner and
lets them remove it after. Mockup v3: `docs/mockups/new-phone-approval.html` (Matt, 2026-11-04: "looks good"; not yet "build it").
**KEEP "That's me"** (Matt, same day: "Don't overwrite the change ... that allows someone to use the same username for a
specified amount of time"; people named themselves, saved the app to the Home Screen, and were forced to make a new name).
It stays exactly as is (a name claimed in the last 24 h links to its code); it counts as a sign in like Link, so the other
devices get the New sign in notice. Step B's "Remove 'That's me'" item below is CANCELLED.

## Design change 3 (2026-11-15, Matt: "i like the allow/deny popup on the original phone")
Replaces Design change 2. A phone linking to an existing code waits ("Check your other phone", Cancel) and plays nothing as
that code until the code's other phone taps Allow (popup if open, notification if closed), or Matt taps Allow on Admin > Now.
Deny = "Not allowed", back to Choose a name. A phone that has played before keeps its sign in and needs nothing; only a wiped
phone asks again. A name in use says "<name> is taken" with Pick another / That's me; That's me asks for Allow the same way
(Matt, 2026-11-15). "No other phone? Report to Matt" files a bug report to Matt ("Sent to Matt"). Mockup v5:
`docs/mockups/new-phone-approval.html` (Matt, 2026-11-15: "cool yeah build"). A request waits 10 minutes (server time), then
lapses ("No answer"). Every popup and notification reports who saw it and what they tapped.
**A name claimed in the last 24 hours still links at once, with NO Allow, for every code** (Matt, 2026-11-15: "it works without
an approval if someone makes a new account, then saves the gamehub to their home screen, and logs in from there again, right?").
On an iPhone the Safari tab and the Home Screen app keep separate storage, so the Home Screen app looks like a new phone, and
the Safari tab cannot get notifications to Allow it. So only That's me on an OLDER name, and Link with a code, ask for Allow.
A brand-new player with a new name needs nothing (Matt confirmed).

## Step B: Allow / Deny sign in (BUILT 2026-11-15, NOT cleared for players: gated)
**Gated.** Only codes in the ask set take the new path: `js/admin-config.js` `resolveSigninAsk` = `SIGNIN_ASK_DEFAULT`
(`DREG5`, test1) + `adminConfig/v1/signin/ask/<CODE>: true` (Admin > People > a person > **Ask to sign in**) + the release
switch `adminConfig/v1/signin/everyone: true` (absent = off). `signin/ask/<CODE>: false` takes a code out. Every other code
links exactly as before (Link, and That's me under the 24-hour rule); its phones load nothing new.

- **New phone** (`js/name-gate.js` + `js/signin-ask.js`, pure rules `js/signin-rules.js`): Link with a gated code, or That's me
  on a gated code's name older than 24 h, writes `signIns/<CODE>/<reqId>` = `{uid, name, device, at: serverTimestamp, via:
  'link'|'thatsme', state: 'waiting'}` and shows "Check your other phone" (spinner, "No other phone? Report to Matt", Cancel).
  Nothing is saved to the profile while it waits, so a refused, cancelled or lapsed request changes nothing on the phone.
  The wait survives a reload (`gamehub.signinWait.v1`, a convenience). On the server's `granted` it re-reads its own
  `msgAuth/<uid>` (must equal the code), then runs the gate's own `linkTo` (the existing link path) and shows "Signed in as
  <name>". Denied: "Not allowed" / OK. 10 minutes: "No answer" / OK. Cancel: `state: 'cancelled'`. Report to Matt:
  `submitBugReport` with "Sign in help: <name> <code>" (admin-read), "Sent to Matt".
- **The code's other phones** (`js/hub.js` `_startSigninWatch`, only when the phone's own code is in the ask set and its
  `msgAuth` is that code): a query on `signIns/<CODE>` `state == waiting` (`.indexOn: state`), "New sign in" (device line,
  time in the phone's local time) with Deny / Allow, over a game too (the game is told it is covered). Closed app: the push
  "New sign in for <name>" / device line (`signInOnWrite`), whose tap opens the hub (`?open=signin`), which shows the popup.
- **Matt** (`js/admin-ui.js`): Admin > Now > **Waiting to sign in** (name, device · time, "Seen Nx · Notified"), Deny / Allow,
  any code; Admin > People > a person > **Ask to sign in** switch.
- **Server** (`functions/signin.js`, trigger `signInOnWrite` in `functions/index.js`): a new waiting request pushes to the
  code's phones (the asking phone holds no address under that code, so it is never told) and stamps `pushedAt`. An Allow is
  granted ONLY when `by` is a uid whose `msgAuth` is that code, or an admin, not the asker, inside 10 minutes of `at`: then
  `msgAuth/<asker uid>` = code (re-read), and the request gets `granted: true, grantedAt`. Otherwise `bad: <why>` (a late
  Allow also sets `state: 'lapsed'`). Reads per event: `msgAuth/<by>`, `admins/<by>`, `pushSubs/<code>`.
- **Who saw it**: `seen/<uid>` = `{first, last, n, tap?, tapAt?}` on the request, from each phone's popup (each time it is
  really on screen) and Matt's Now row; `pushedAt` = notified. Shown on the admin row.
- **Rules** (`database.rules.json` `signIns`): the asker may create its own waiting request (`uid === auth.uid`, `at === now`)
  and cancel it, and read only its own; the code's phones (`msgAuth === $code`) and admins read the code's requests and may
  only answer a waiting one (`state` allowed/denied, `by === auth.uid`, `answeredAt === now`, nothing else changed) and write
  their own `seen` stamp; `granted`/`bad`/`grantedAt` only the server; nothing may be deleted. Readers (the reader key) may
  read. In `backups/rtdb-backup.mjs` BRANCHES.
- **Tests**: `tools/test-signin-ask.mjs` (pure rules, the 24-hour rule for gated and non-gated codes, the server's grant and
  refusals, the phone's writes), `tools/test-signin-rules-emu.mjs` (the rules on the real emulator), cases in
  `tools/test-no-deletes-rules.mjs` and `tools/test-admin-config.mjs`.

**Honest limit until the release:** `msgAuth/<uid>` is still client-writable, so the Allow is a courtesy, not a lock: a
script with a code can still claim it. The lock is the release step below.

### The release ("ship it"): exact steps
1. Before the lock: count phones without a key. List every code with a `players/` record updated in the last 30 days and
   check each has a `codeKeys/<CODE>` entry (Step A registers one on every app open). Phones not seen since Step A
   (2026-11-04) will need an Allow (or Matt) at their next open; their local data stays safe (a refused sync is retried,
   never cleared). Show Matt the list.
2. Make the ask set everyone in CODE, not only in the config (`SIGNIN_ASK_DEFAULT` -> a `SIGNIN_EVERYONE = true` default in
   `resolveSigninAsk`), so a first-run phone that cannot read the config still asks. Or set `adminConfig/v1/signin/everyone:
   true` (Matt's admin write) as well.
3. Rules: `msgAuth/$uid` `.write: false` (server only). Every grant then goes through `functions/claim.js` (t `key`, a phone
   with its device key) or `functions/signin.js` (an Allow). Check every phone path that writes `msgAuth` today
   (`js/messages.js ensureAuthClaim`): with the lock it must stop writing and rely on the key / Allow. A brand-new code (a
   new player, new name) needs a server grant too: add t `fresh` to `functions/claim.js` (a code with no `codeKeys`, no
   `directory/`, no `players` record) and have the name gate's Save call it.
4. Rules: `players/$id` write only if admin, or a new record with `own === auth.uid`, or `data.own === auth.uid`, or (no
   `own`) `data.profile.playerId === msgAuth[uid]` (Step B item 3 of the old plan).
5. Run `backups/rtdb-backup.mjs`, then the suites above plus `test-device-key`, `test-push`, `test-automation-guard`, on the
   emulator too; ship in one deploy (rules + functions + app), `IMPORTANT_SINCE` set so every phone takes it.
6. Update root `CLAUDE.md` "Privacy and security" and remove "NOT cleared" from this doc.

Kept from the old plan (not built): codes as addresses (challenge indexes, nudges, pushSubs, directory keys) stay readable;
hiding them fully is a separate, large rewrite. The PIN items are replaced by the Allow (Design change 3).
