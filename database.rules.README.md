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

## Current branches

| Branch | Rule |
|---|---|
| `players`, `usernames`, `rooms`, `adminConfig`, `archive` | `auth != null` read + write (unchanged) |
| `bugReports`, `bugReportShots`, `bugReplies`, `deviceReports` | `auth != null` read + write (unchanged) |
| `skeeballThrows`, `challenge`, `flight`, `selfies` | `auth != null` read + write (unchanged) |
| `admins` | readable by anyone signed in, **writable by nobody** - console only |
| `msgAuth/<uid>` | readable and writable only by that same `auth.uid` |
| `messages` | scoped, see below |

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

The rules are NOT deployed by any script in this repo, and a working session cannot publish
them. They are published by hand:

1. Open the [Firebase console](https://console.firebase.google.com/) and pick this project.
2. Left sidebar → **Build** → **Realtime Database**.
3. The **Rules** tab, along the top.
4. Select everything in the editor and paste in the whole contents of `database.rules.json`.
5. **Publish**, top right. Confirm if it asks.

**Deploy the app first, the rules second.** A device claims its `msgAuth` entry the first time
it loads the hub on a build that has `js/messages.js`. Publishing the rules before that build
is live just means Messages reads as empty until each device next opens the app - it heals
itself, but there is no reason to cause it.

## Backups

`backups/rtdb-backup.mjs` signs in **anonymously**, so it is not on the admins list and
**cannot read `messages/`**. It now reads branch by branch (a single root read is no longer
permitted), prints which branches it got, and warns loudly about any it was refused. It never
records a denied branch as an empty one.

To back up `messages/` as well: Firebase console → Realtime Database → the `messages` node →
the three-dot menu → **Export JSON**. That runs as you, not anonymously.

Keep `BRANCHES` in `backups/rtdb-backup.mjs` in step with this file. **A branch added here and
forgotten there is silently missing from every future backup**, which is the worst shape a
backup bug can take, because the backup is trusted.
