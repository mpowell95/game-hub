// functions/index.js - PUSH NOTIFICATIONS for the Game Hub (2026-09-23).
//
// Matt: "are you sure there's no way to have real notifications or something close to it?" ...
// "mostly iphone, installed. go with firebase."
//
// Sending a Web Push needs a PRIVATE key (VAPID). Shipped inside the app, anybody could read it
// and push anything to every player, so it lives here, as a Firebase secret, and this function is
// the only thing that ever sends. The app's half is js/push.js (subscribe, store the subscription
// under pushSubs/<CODE>/<key>) and sw.js (show it, open the hub on tap).
//
// THREE TRIGGERS, all deciding in pure code (decide.js) and all sending through sendTo():
//   hoopsTurnPush   hoops/index/<code>/<gameId>      a challenge, your turn, a finished match
//   messagePush     messages/index/<code>/<other>    somebody wrote to you (2026-09-24)
//   bugReportPush   bugReports/<id>                  a new report, to every admin (2026-09-24)
// Each index row already says, from the recipient's side, what changed, so no client code sends.
//
// DEPLOY (from the repo root, on Matt's PC): see functions/README.md.
import { onValueWritten, onValueCreated } from 'firebase-functions/v2/database';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import webpush from 'web-push';
import { decide, decideMessage, decideBugReport, isActive } from './decide.js';

initializeApp();

// The PUBLIC half is also in js/push.js; the two must match or every subscription is refused.
const VAPID_PUBLIC_KEY = 'BH_JRWqpFFAVoohah0iW7rb3MqCm6koAqxkh-MjEOqCiAdOasw6UThw5nH_pLtP14Ea1mGObqrGlzaKUF4OtKCM';
const VAPID_PRIVATE_KEY = defineSecret('VAPID_PRIVATE_KEY');
const SUBJECT = 'https://mpowell95.github.io/game-hub/';
const HUB_URL = 'https://mpowell95.github.io/game-hub/';

const OPTS = {
  instance: 'game-hub-5b91c-default-rtdb',
  region: 'us-central1',
  secrets: [VAPID_PRIVATE_KEY],
  retry: false,
  maxInstances: 5,
};

/**
 * Push `note` to every device `code` has turned notifications on for. `open` says where a tap goes
 * ({game, with?, name?}); sw.js turns it into `?open=...` or a message to an open hub. A device
 * whose subscription the phone has dropped (404/410) is removed: a delivery address, not player
 * data, and the player recreates it with one tap.
 */
async function sendTo(db, code, note, tag, open) {
  const subs = (await db.ref(`pushSubs/${code}`).get()).val() || {};
  const keys = Object.keys(subs);
  if (!keys.length) return;
  webpush.setVapidDetails(SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY.value());
  const q = new URLSearchParams({ open: open.game });
  if (open.with) q.set('with', open.with);
  const url = `${HUB_URL}?${q}`;
  await Promise.all(keys.map(async (k) => {
    const s = subs[k];
    if (!s || !s.endpoint || !s.keys) return;
    // The hub is open on this device right now: it already shows the news, so no notification.
    if (isActive(s)) { logger.info('skipped, app open', { code, tag, sub: k }); return; }
    const { title, body } = note.text(s.lang === 'es' ? 'es' : 'en');
    const payload = JSON.stringify({ title, body, tag, url, game: open.game, with: open.with || '', name: open.name || '' });
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload,
        { TTL: 60 * 60 * 24 * 3, urgency: 'high' });
      logger.info('sent', { code, kind: note.kind, tag, sub: k });
    } catch (err) {
      const status = err && err.statusCode;
      if (status === 404 || status === 410) {
        await db.ref(`pushSubs/${code}/${k}`).remove();
        logger.info('removed expired subscription', { code, sub: k, status });
      } else {
        logger.error('push failed', { code, tag, sub: k, status, body: err && err.body });
      }
    }
  }));
}

export const hoopsTurnPush = onValueWritten({ ref: '/hoops/index/{code}/{gameId}', ...OPTS }, async (event) => {
  const { code, gameId } = event.params;
  const before = event.data.before.exists() ? event.data.before.val() : null;
  const after = event.data.after.exists() ? event.data.after.val() : null;
  // Cheap exits first, so the common write (my own move, flipping my row AWAY) costs no read.
  if (!after) return;
  const turnCame = after.yourTurn && !after.over && !(before && before.yourTurn && !before.over);
  const justOver = after.over && !(before && before.over);
  if (!turnCame && !justOver) return;
  const db = getDatabase();
  const game = (await db.ref(`hoops/games/${gameId}`).get()).val();
  const note = decide({ code, gameId, before, after, game });
  if (note) await sendTo(db, code, note, `hoops-${gameId}`, { game: 'hoops4' });
});

export const messagePush = onValueWritten({ ref: '/messages/index/{code}/{other}', ...OPTS }, async (event) => {
  const { code, other } = event.params;
  const before = event.data.before.exists() ? event.data.before.val() : null;
  const after = event.data.after.exists() ? event.data.after.val() : null;
  const note = decideMessage({ code, other, before, after });
  // One notification per conversation: a second message from the same person replaces the first.
  if (note) await sendTo(getDatabase(), code, note, `msg-${other}`, { game: 'messages', with: other, name: note.who });
});

// Every admin is told: admins/<uid> === true, and msgAuth/<uid> is the player code that device
// claimed (the Messages claim). Nobody's code is written into this file.
export const bugReportPush = onValueCreated({ ref: '/bugReports/{id}', ...OPTS }, async (event) => {
  const note = decideBugReport(event.data.val());
  if (!note) return;
  const db = getDatabase();
  const admins = (await db.ref('admins').get()).val() || {};
  const codes = new Set();
  for (const uid of Object.keys(admins)) {
    if (admins[uid] !== true) continue;
    const c = (await db.ref(`msgAuth/${uid}`).get()).val();
    if (typeof c === 'string' && /^[A-Z2-9]{5}$/.test(c)) codes.add(c);
  }
  for (const c of codes) await sendTo(db, c, note, `bug-${event.params.id}`, { game: 'bugs' });
});
