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
// ONE TRIGGER: every write to hoops/index/<code>/<gameId>. That row already says, from <code>'s
// side, whose turn it is - so the decision is pure (decide.js) and needs no client change to send.
//
// DEPLOY (from the repo root, on Matt's PC): see functions/README.md.
import { onValueWritten } from 'firebase-functions/v2/database';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import webpush from 'web-push';
import { decide } from './decide.js';

initializeApp();

// The PUBLIC half is also in js/push.js; the two must match or every subscription is refused.
const VAPID_PUBLIC_KEY = 'BH_JRWqpFFAVoohah0iW7rb3MqCm6koAqxkh-MjEOqCiAdOasw6UThw5nH_pLtP14Ea1mGObqrGlzaKUF4OtKCM';
const VAPID_PRIVATE_KEY = defineSecret('VAPID_PRIVATE_KEY');
const SUBJECT = 'https://mpowell95.github.io/game-hub/';
const OPEN_URL = 'https://mpowell95.github.io/game-hub/?open=hoops4';

export const hoopsTurnPush = onValueWritten(
  {
    ref: '/hoops/index/{code}/{gameId}',
    instance: 'game-hub-5b91c-default-rtdb',
    region: 'us-central1',
    secrets: [VAPID_PRIVATE_KEY],
    retry: false,
    maxInstances: 5,
  },
  async (event) => {
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
    if (!note) return;

    const subs = (await db.ref(`pushSubs/${code}`).get()).val() || {};
    const keys = Object.keys(subs);
    if (!keys.length) return;
    webpush.setVapidDetails(SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY.value());

    await Promise.all(keys.map(async (k) => {
      const s = subs[k];
      if (!s || !s.endpoint || !s.keys) return;
      const { title, body } = note.text(s.lang === 'es' ? 'es' : 'en');
      const payload = JSON.stringify({ title, body, tag: `hoops-${gameId}`, url: OPEN_URL, game: 'hoops4' });
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload,
          { TTL: 60 * 60 * 24 * 3, urgency: 'high' });
        logger.info('sent', { code, gameId, kind: note.kind, sub: k });
      } catch (err) {
        const status = err && err.statusCode;
        // 404/410: the phone dropped this subscription (app deleted, permission revoked). It can
        // never be delivered to again, so it is removed - a delivery address, not player data;
        // the player gets a fresh one by turning notifications on again.
        if (status === 404 || status === 410) {
          await db.ref(`pushSubs/${code}/${k}`).remove();
          logger.info('removed expired subscription', { code, sub: k, status });
        } else {
          logger.error('push failed', { code, gameId, sub: k, status, body: err && err.body });
        }
      }
    }));
  },
);
