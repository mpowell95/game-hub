# Push notifications - the server half

`index.js` holds the Firebase Cloud Functions (Hoops, Messages, bug reports, Skeeball and, since
2026-09-28, `cupPongTurnPush` on `cuppong/index/<code>/<id>`; since 2026-10-01, `dartsTurnPush` on
`darts/index/<code>/<id>`; since 2026-10-11, `flickSoccerTurnPush` on `flicksoccer/index/<code>/<id>`; since 2026-10-14, `archeryTurnPush` on `archery/index/<code>/<id>`; since 2026-10-18, `chinchonTurnPush` and `escobaTurnPush` on `chinchon/` and `escoba/index/<code>/<id>`). The first watches `hoops/index/<code>/<gameId>` and, when the
other person has just done something you need to answer (a challenge, your turn, they won or
resigned), sends a Web Push to every phone you turned notifications on for (`pushSubs/<code>`).
The decision is `decide.js` (pure; `node tools/test-push.mjs` at the repo root tests it).

The app half is `js/push.js` (turn on / off) and `sw.js` (show it, open the game on tap).

## Deploying automatically (2026-10-18)

`.github/workflows/firebase-deploy.yml` deploys the functions AND `database.rules.json` on every merge
to `main` that changes `functions/`, the rules or the Firebase config (also runnable by hand from the
Actions tab). It checks first (rules are valid JSON, `tools/test-push.mjs` passes). It needs ONE repo
secret, `FIREBASE_SERVICE_ACCOUNT`: the JSON key of a service account in project `game-hub-5b91c`.
One-time setup (Matt):

1. Google Cloud console > IAM & Admin > Service Accounts (project `game-hub-5b91c`) > Create service
   account, name `github-deploy`.
2. Roles: Firebase Admin, Editor, Service Account User, Secret Manager Admin. (Broad on purpose; the
   exact minimum for a 2nd-gen functions deploy with a secret was not verified.)
3. Open it > Keys > Add key > JSON. A file downloads.
4. GitHub > mpowell95/game-hub > Settings > Secrets and variables > Actions > New repository secret,
   name `FIREBASE_SERVICE_ACCOUNT`, paste the whole file's contents. Then delete the downloaded file.

The key is a password to the Firebase project: it lives only in that GitHub secret. Rules now go live
with the merge (no console paste); a rules change still has to pass the check step.

## Deploying (Windows, PowerShell) - done once on 2026-09-24; the fallback if the workflow is broken

Matt's local `Game-Hub/` folder is stale, so deploy from a small separate clone:

```
npm install -g firebase-tools          # once
firebase login                         # once
cd $HOME
git clone --depth 1 --filter=blob:none --sparse https://github.com/mpowell95/game-hub.git game-hub-deploy
cd game-hub-deploy
git sparse-checkout set functions
cd functions; npm install; cd ..
firebase deploy --only functions
```
Next time: `cd $HOME\game-hub-deploy`, `git pull`, `cd functions; npm install; cd ..`, deploy.

The secret (`VAPID_PRIVATE_KEY`) is already set. To replace it, the masked prompt does not take a
paste in PowerShell; use a temp file:
```
Set-Content -NoNewline -Path key.txt -Value "<key>"
firebase functions:secrets:set VAPID_PRIVATE_KEY --data-file key.txt
Remove-Item key.txt
```
The first deploy on a project fails once with an Eventarc permission message; retrying after a few
minutes works. Answer 1 day to the container-image cleanup question (keeps storage free).
Database rules are published by hand in the console (`database.rules.json`).

## Checking it

Firebase console -> Functions -> `hoopsTurnPush` -> Logs: every push logs `sent`, and a phone
that dropped its subscription logs `removed expired subscription`.
