# database.rules.json is ONE canonical file. MERGE, do not replace.

This file holds the Realtime Database security rules for BOTH efforts that share the one
Firebase project:

- **Hidden challenge** (added first, C4 scaffolding): `challenge/`, `flight/`, `selfies/`,
  `admins/` branches.
- **Multiplayer** (added when Phase M1 ships): a `rooms/` branch.

**Rule (CHALLENGE-PLAN.md amendment 9):** whichever project ships second MUST MERGE its
branch into this existing file under `"rules"`, never replace the file. Keep every branch.

## Branch notes (challenge)

- `challenge/$agent`: the single per-agent progress record. Read/write by any authed
  (anonymous) client. This is a deliberate decision (single-user comedy record); the
  mitigation is the local-first, monotonic-additive merge in the client, plus the
  obfuscated agent key and the anon-auth gate.
- `flight`: readable by any authed client; **writable only by an admin uid** (the
  `admins` allowlist), so only Matt edits the flight, and it never lives in the repo.
- `selfies/$id`: readable only by the uploader uid or an admin uid; `image` capped at
  ~150 KB (base64). The admin panel deletes `image` right after approve/reject, so a real
  photo does not linger.
- `admins/$uid`: readable by authed clients (rules reference it); writable ONLY from the
  Firebase console. One-time step: Matt opens the hub as admin once, Mission Control shows
  his anonymous uid, he pastes `admins/<uid>: true` in the console.

## Deploy

Paste into Firebase console (Realtime Database > Rules), or `firebase deploy --only
database`, once the project exists. Until deployed, the DB stays in locked mode (denies
all), which is safe.
