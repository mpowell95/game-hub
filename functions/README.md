# Push notifications - the server half

`index.js` is a Firebase Cloud Function. It watches `hoops/index/<code>/<gameId>` and, when the
other person has just done something you need to answer (a challenge, your turn, they won or
resigned), sends a Web Push to every phone you turned notifications on for (`pushSubs/<code>`).
The decision is `decide.js` (pure; `node test-push.mjs` at the repo root tests it).

The app half is `js/push.js` (turn on / off) and `sw.js` (show it, open the game on tap).

## Deploying (Windows, PowerShell) - done once on 2026-09-24; repeat only after a change here

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
