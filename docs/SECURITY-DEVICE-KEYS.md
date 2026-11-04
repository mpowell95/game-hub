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

## Step B (NOT built; player-visible, needs Matt's "ship it")
1. Server: t `pin` (6 digits, 10 min, 5 tries), t `fresh` (a brand-new unused code: no `codeKeys`, no
   `directory/`, no `players` record with it), `pinMake` (claimed phone or admin makes a PIN), admin any.
   Push Matt "new phone linked to X".
2. Screens: Profile > Your devices > Add a phone (shows PIN); name gate's link asks code + PIN;
   Admin > People > a person > Make a PIN. Remove "That's me" by name.
3. Rules: `msgAuth` `.write: false` (server only); `players/$id` write only if admin, or new record with
   `own === auth.uid`, or `data.own === auth.uid`, or (no `own`) `data.profile.playerId === msgAuth[uid]`.
4. Before the lock: count `codeKeys` against active codes (`players` updated in last 30 days); every active
   phone must have a key. Phones not seen since step A will need a PIN; their local data stays safe (a refused
   sync is retried, never cleared).
5. Codes as addresses (challenge indexes, nudges, pushSubs, directory keys) stay readable; with PINs a
   code alone no longer grants identity. Hiding them fully is a separate, large rewrite.
