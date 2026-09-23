# Push notifications - the server half

`index.js` is a Firebase Cloud Function. It watches `hoops/index/<code>/<gameId>` and, when the
other person has just done something you need to answer (a challenge, your turn, they won or
resigned), sends a Web Push to every phone you turned notifications on for (`pushSubs/<code>`).
The decision is `decide.js` (pure; `node test-push.mjs` at the repo root tests it).

The app half is `js/push.js` (turn on / off) and `sw.js` (show it, open the game on tap).

## One-time setup (Windows, PowerShell)

1. Firebase console -> project `game-hub-5b91c` -> **Upgrade** -> **Blaze** plan. Cloud Functions
   need it. Set a budget alert while you are there.
2. `npm install -g firebase-tools`
3. `firebase login`
4. In the repo folder: `git pull`, then `cd functions`, `npm install`, `cd ..`
5. `firebase functions:secrets:set VAPID_PRIVATE_KEY` and paste the private key when asked.
   (Its public half is in `js/push.js` and `index.js`; the two must be a pair.)
6. `firebase deploy --only functions`
   The first deploy switches on the Google Cloud services it needs and can take several minutes.
   If it fails with a permissions / Eventarc message on the very first try, wait a few minutes and
   run it again.
7. Firebase console -> Realtime Database -> Rules: paste `database.rules.json` -> Publish
   (it adds `pushSubs`).

After a change to anything in this folder, only step 6 is needed. The app itself still deploys
through GitHub Pages as always; this folder is never served to a phone.

## Checking it

Firebase console -> Functions -> `hoopsTurnPush` -> Logs: every push logs `sent`, and a phone
that dropped its subscription logs `removed expired subscription`.
