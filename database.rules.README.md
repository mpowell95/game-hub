# database.rules.json is ONE canonical file. MERGE, do not replace.

This file holds the Realtime Database security rules for BOTH efforts that share the one
Firebase project:

- **Hidden challenge:** `challenge/`, `flight/`, `selfies/`.
- **Multiplayer** (added when Phase M1 ships): a `rooms/` branch.

**Rule (CHALLENGE-PLAN.md amendment 9):** whichever project ships second MUST MERGE its
branch into this existing file under `"rules"`, never replace the file. Keep every branch.

## Current rules (deliberately minimal)

```json
{ "rules": { ".read": "auth != null", ".write": "auth != null" } }
```

Any signed-in (anonymous) client can read/write everything. This is an intentional
decision confirmed by Matt: **security is not a priority for this app** (it is a private,
name-gated gift; it does not matter if a determined visitor could read the data). So there
is NO admins allowlist and NO per-node locking:

- Mission Control is gated only by the in-app PIN (client-side). Any signed-in client may
  read the players dashboard, review selfies, and edit the flight.
- Selfie images are KEPT after a decision (Matt downloads them), not deleted.
- Each persona (recipient + any tester like `test1`) writes to its own record
  `challenge/gh-<hash-of-name>`, so testing never touches the recipient's data.

If the multiplayer effort needs stricter `rooms/` rules, add a `rooms` branch alongside the
root defaults (a more specific rule overrides the root for that path).

## Deploy

Firebase console > Realtime Database > **Rules** tab > paste > **Publish** (or
`firebase deploy --only database`).
