# database.rules.json is ONE canonical file. MERGE, do not replace.

This file holds the Realtime Database security rules for everything that shares the one
Firebase project. **Whichever effort ships next MUST MERGE its branch into this existing
file under `"rules"`, never replace the file.** Keep every branch.

## The shape changed on 2026-08-31, and the reason matters

It used to be four lines:

```json
{ "rules": { ".read": "auth != null", ".write": "auth != null" } }
```

Any signed-in (anonymous) client could read and write everything. That was a deliberate,
confirmed decision - this is a private, name-gated family app and it did not matter if a
determined visitor could read the data.

**Messages changed it.** Matt, on being told the database served every conversation to
anyone signed in: *"Only admin should be able to see every thread. Others should only see
their own."*

A granted **ancestor** `.read` cascades down and **cannot be revoked by a child rule**. So
scoping `messages/` meant the root `.read`/`.write` had to become `false` and every other
branch had to be listed explicitly with the permissions it always had. **Every branch below
`messages/` and `msgAuth/` behaves exactly as it did before**; nothing else was tightened.

**So: if you add a top-level node, you must add it to this file, or it is unreadable and
unwritable.** That is the one new obligation this shape creates.

## Admin-only writes (2026-10-14)

Matt, on learning that any signed-in device could write `adminConfig`: *"that must be fixed NOW.
NOBODY should have that power other than me."* Until then anyone with developer tools could flip a
game live, void anyone's scores, take someone off online play, or write
`adminConfig/v1/deviceResets/<statsId>`, which makes that player's phone ERASE its own stats store
on its next load (THE LAW). `bugReplies/` was the same: anyone could plant a "reply from Matt" in a
player's inbox. Both now need the writer's uid in `admins/` (console-only, three of Matt's devices
on 2026-10-14). Every writer in the app already ran only on those devices (the Admin page and the
bug inbox are gated on `isAdminDevice()`, which asks `admins/` the same question), so nothing Matt
uses changes. **`tools/delete-device-record.mjs` signs in anonymously, so its device-reset write is now
refused**: a reset has to come from the Admin page or the console.

## Current branches

| Branch | Rule |
|---|---|
| `players`, `usernames`, `rooms`, `archive` | `auth != null` read + write (unchanged) |
| `bugReports`, `bugReportShots`, `deviceReports` | `auth != null` read + write (unchanged) |
| `adminConfig`, `bugReplies` | readable by anyone signed in; **writable only by a uid in `admins/`** (2026-10-14) |
| `skeeballThrows`, `challenge`, `flight`, `selfies` | `auth != null` read + write (unchanged) |
| `admins` | readable by anyone signed in, **writable by nobody** - console only |
| `msgAuth/<uid>` | readable and writable only by that same `auth.uid` |
| `messages` | scoped, see below |
| `careers/<CODE>` | readable by anyone signed in; writable only by the uid that claimed `<CODE>` in `msgAuth`, or an admin |

`careers/<CODE>` is Baseball's career sync (BB-0-phase-0-handoff.md; `js/career-store.js`). It
reuses the SAME `msgAuth/<uid> = "<CODE>"` claim `messages/` already relies on, rather than a
second claim mechanism - a device that has claimed its code for Messages has already claimed it
for this too. Until this branch is published (see "Deploy" below), every write here is denied and
`js/career-store.js` says so loudly (`HEALTH_DENIED`) while continuing to play locally.

## How `messages/` is scoped

The rules can only see one thing about a client: its anonymous `auth.uid`. They cannot see a
player code, which lives in localStorage. So a device WRITES the link and the rules read it
back:

```
msgAuth/<auth.uid> = "<PLAYER CODE>"        written by js/messages.js on every Messages read
```

- **`messages/threads/<pairKey>`** is readable and writable only when that pair key contains
  the code this uid has claimed. The key is the two codes sorted A-Z, and a code is exactly
  five characters from an alphabet with no `_` in it, so `contains()` cannot match by accident.
- **`messages/index/<CODE>`** is readable only by the uid that claimed `<CODE>`. Its
  `<otherCode>` children are writable by either participant, because sending a message updates
  the RECIPIENT's index row as well as the sender's.
- **`messages` as a whole** is readable when `admins/<auth.uid> === true`. That grant cascades,
  which is what gives Matt the read-all; nobody else can read the parent at all.

**What this buys, stated plainly:** the app, and the database behind it, no longer hand anyone
another player's messages. **What it does not buy:** it is not proof against somebody who has a
player's 5-character code and opens developer tools, because that code is printed on the
profile page and typed in to link a second device, so it is not a secret and cannot be made
one. Real per-person authentication is the only thing that would close that, and this app has
none by design.

## `admins/`

`admins/<auth.uid>: true`, one entry per device. **It already existed before any of this and
nothing in the repo wrote it** - it was set by hand in the console. It is now load-bearing: it
is what grants the read-all.

**An anonymous uid is per browser and is lost when that browser's site data is cleared**, so
this list needs topping up occasionally. The admin page's Messages section shows the current
device's auth id when it is NOT on the list, ready to copy.

## Deploy

**Since 2026-10-18 the rules deploy automatically** when a change to `database.rules.json` is merged to
`main`: `.github/workflows/firebase-deploy.yml` runs `firebase deploy --only functions,database`. Check that
workflow's run for the merge commit, the same way as the Pages deploy. (This section used to say "published
by hand"; that stopped being true on 2026-10-18 and misled a session on 2026-11-04.)

## No deletes from a device (2026-11-04)

Matt: *"Make it so devices cannot delete anything"*, then *"change the rules so only legitimate deletes are
allowed"*. Before this, `players/`, `usernames/`, `rooms/`, the bug-report nodes, `archive/`, `challenge/`
and every online-match node were `".write": "auth != null"`. Every phone signs in anonymously, so any device
(or a script with the public config) could delete one player's record or all of `players/` in one request,
and ~188 records did vanish between 2026-10-05 and 2026-11-03 with no log.

Now every one of those grants sits ONE LEVEL DOWN, on the record, and requires the record to still exist
afterwards (`newData.exists()`). A grant on a parent cascades to every child and cannot be taken back below,
which is why it had to move down rather than gain a condition. What that means:

- A record is never removed: a player (which must also keep `profile` and `stats`), a room, a match, its
  index rows, a chat line, a message, an inbox row, a bug report and its screenshots, a device report, an
  archived player, a career save, a course draft, a msgAuth claim.
- Fields INSIDE a live record may still be cleared, because the app does that: a vacated seat or
  `recovery` in a room, Hold'em's `pk/pub`, flick-soccer's `pick`, a bug report's soft-delete flags, the
  sync's `rate` report.
- The only whole-entry deletes still allowed are the app's own: your own push subscription
  (`pushSubs/<your code>`), your own old username on rename, and admin-only resets (`usernames`
  force-release, `challenge` tester reset, `adminConfig`, `readers`).
- Server code (`functions/`, admin SDK) is not bound by rules: `roomsCleanup` still clears dead rooms.
- **The Matt-only node scripts that delete** (`tools/delete-test-players.mjs`, `tools/delete-device-record.mjs`,
  `tools/clear-skeeball-stats.mjs`) sign in anonymously and are now REFUSED. That is deliberate. A delete
  Matt really wants is done in the Firebase console, after a backup.

`tools/test-no-deletes-rules.mjs` evaluates the real rule strings against every write the app sends (all
must pass) and every delete it does not (all must be refused), and fails if any rule is a bare
`".write": "auth != null"` again. Adding a node or a new kind of delete: add it to that test first.

## Backups

`backups/rtdb-backup.mjs` signs in **anonymously**, so it is not on the admins list and
**cannot read `messages/`**. It now reads branch by branch (a single root read is no longer
permitted), prints which branches it got, and warns loudly about any it was refused. It never
records a denied branch as an empty one.

To back up `messages/` as well: Firebase console → Realtime Database → the `messages` node →
the three-dot menu → **Export JSON**. That runs as you, not anonymously.

Keep `BRANCHES` in `backups/rtdb-backup.mjs` in step with this file. **A branch added here and
forgotten there is silently missing from every future backup**, which is the worst shape a
backup bug can take, because the backup is trusted. `careers` was added to `BRANCHES` in the same
commit that added this branch (BB-0-phase-0-handoff.md).
