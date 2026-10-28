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
// FOUR TRIGGERS, all deciding in pure code (decide.js) and all sending through sendTo():
//   hoopsTurnPush   hoops/index/<code>/<gameId>      a challenge, your turn, a finished match
//   messagePush     messages/index/<code>/<other>    somebody wrote to you (2026-09-24)
//   bugReportPush   bugReports/<id>                  a new report, to every admin (2026-09-24)
//   skeeChallengePush skeeChallenges/index/<code>/<id> a Skeeball challenge, or its result (2026-09-24)
//   cupPongTurnPush cuppong/index/<code>/<id>        a Cup Pong challenge, your turn, the end (2026-09-28)
//   dartsTurnPush   darts/index/<code>/<id>          a Darts challenge, your turn, the end (2026-10-01)
//   flickSoccerTurnPush flicksoccer/index/<code>/<id> a Flick Soccer challenge, your turn, the end (2026-10-11)
//   archeryTurnPush archery/index/<code>/<id>        an Archery challenge, your turn, the end (2026-10-14)
//   chinchonTurnPush chinchon/index/<code>/<id>      a Chinchón challenge, your turn, the end (2026-10-18)
//   escobaTurnPush  escoba/index/<code>/<id>         an Escoba challenge, your turn, the end (2026-10-18)
//   battleArenaTurnPush battlearena/index/<code>/<id> a Battle Arena challenge, your turn, the end (2026-10-24)
//   battleshipTurnPush battleship/index/<code>/<id>  a Battleship challenge, your turn, the end (2026-10-27)
//   roomsCleanup      every 30 min: delete live-game rooms nobody has been in for an hour
//   boardsOnSync      a device synced: rebuild the leaderboard (at most every 2 min)
//   boardsCatchUp     every 5 min: a rebuild skipped by that limit, or the first one
//   directoryBuild    hourly + on an Online play change: the small directory/ the pickers read
//   nudgePush         the Remind bell on the Multiplayer screen (2026-10-22)
//   turnReminderPush  every hour: "Reminder: your turn vs X" once a turn has waited 24 h (2026-10-20)
//   beeWatch          every 5 min: Spelling Bee copy detection + missing-log alerts, pushed to admins (2026-10-28)
//   beeOnDaily        a Spelling Bee board row changed: rebuild boards/v1/bee (at most every 2 min)
//   beeOnUndo         Matt undid a Spelling Bee void on the admin page: rebuild boards/v1/bee
//   (rebuildBoards)   every board rebuild also runs the integrity checks on every record (2026-10-28)
//   integrityOnUndo   Matt undid or redid an integrity void on the admin page: rebuild the board
//   <game>MatchCheck  an online challenge ended (darts, cuppong, battleship, hoops): integrity alerts
// Each index row already says, from the recipient's side, what changed, so no client code sends.
//
// DEPLOY (from the repo root, on Matt's PC): see functions/README.md.
import { onValueWritten, onValueCreated } from 'firebase-functions/v2/database';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import webpush from 'web-push';
import { buildBoardParts, packBoard, sumOf } from './boards.js';
import { scanRecent, rebuildBee, rebuildBeeIfDue, beeNote } from './bee.js';
import { writeFlags, checkFinishedMatch, checkContextoLogWin, integrityNote } from './integrity.js';
import { decide, decideMessage, decideBugReport, decideSkee, decideCupPong, decideDarts, decideFlickSoccer, decideArchery, decideChinchon, decideEscoba, decideBattleArena, decideBattleship, decideReminder, decideNudge, buildDirectory, REMINDER_GAMES, isActive } from './decide.js';

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
    const payload = JSON.stringify({ title, body, tag, url, game: open.game, with: open.with || '', name: open.name || '', match: open.match || '' });
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
async function adminCodes(db) {
  const admins = (await db.ref('admins').get()).val() || {};
  const codes = new Set();
  for (const uid of Object.keys(admins)) {
    if (admins[uid] !== true) continue;
    const c = (await db.ref(`msgAuth/${uid}`).get()).val();
    if (typeof c === 'string' && /^[A-Z2-9]{5}$/.test(c)) codes.add(c);
  }
  return codes;
}
export const bugReportPush = onValueCreated({ ref: '/bugReports/{id}', ...OPTS }, async (event) => {
  const note = decideBugReport(event.data.val());
  if (!note) return;
  const db = getDatabase();
  for (const c of await adminCodes(db)) await sendTo(db, c, note, `bug-${event.params.id}`, { game: 'bugs' });
});

export const skeeChallengePush = onValueWritten({ ref: '/skeeChallenges/index/{code}/{id}', ...OPTS }, async (event) => {
  const { code, id } = event.params;
  const before = event.data.before.exists() ? event.data.before.val() : null;
  const after = event.data.after.exists() ? event.data.after.val() : null;
  const note = decideSkee({ code, id, before, after });
  if (note) await sendTo(getDatabase(), code, note, `skee-${id}`, { game: 'skeeball' });
});

export const cupPongTurnPush = onValueWritten({ ref: '/cuppong/index/{code}/{id}', ...OPTS }, async (event) => {
  const { code, id } = event.params;
  const before = event.data.before.exists() ? event.data.before.val() : null;
  const after = event.data.after.exists() ? event.data.after.val() : null;
  const note = decideCupPong({ code, id, before, after });
  if (note) await sendTo(getDatabase(), code, note, `cuppong-${id}`, { game: 'cuppong', match: id });
});

export const dartsTurnPush = onValueWritten({ ref: '/darts/index/{code}/{id}', ...OPTS }, async (event) => {
  const { code, id } = event.params;
  const before = event.data.before.exists() ? event.data.before.val() : null;
  const after = event.data.after.exists() ? event.data.after.val() : null;
  const note = decideDarts({ code, id, before, after });
  if (note) await sendTo(getDatabase(), code, note, `darts-${id}`, { game: 'darts', match: id });
});

export const flickSoccerTurnPush = onValueWritten({ ref: '/flicksoccer/index/{code}/{id}', ...OPTS }, async (event) => {
  const { code, id } = event.params;
  const before = event.data.before.exists() ? event.data.before.val() : null;
  const after = event.data.after.exists() ? event.data.after.val() : null;
  const note = decideFlickSoccer({ code, id, before, after });
  if (note) await sendTo(getDatabase(), code, note, `flicksoccer-${id}`, { game: 'flick-soccer', match: id });
});

export const archeryTurnPush = onValueWritten({ ref: '/archery/index/{code}/{id}', ...OPTS }, async (event) => {
  const { code, id } = event.params;
  const before = event.data.before.exists() ? event.data.before.val() : null;
  const after = event.data.after.exists() ? event.data.after.val() : null;
  const note = decideArchery({ code, id, before, after });
  if (note) await sendTo(getDatabase(), code, note, `archery-${id}`, { game: 'archery', match: id });
});

export const chinchonTurnPush = onValueWritten({ ref: '/chinchon/index/{code}/{id}', ...OPTS }, async (event) => {
  const { code, id } = event.params;
  const before = event.data.before.exists() ? event.data.before.val() : null;
  const after = event.data.after.exists() ? event.data.after.val() : null;
  const note = decideChinchon({ code, id, before, after });
  if (note) await sendTo(getDatabase(), code, note, `chinchon-${id}`, { game: 'chinchon', match: id });
});

export const escobaTurnPush = onValueWritten({ ref: '/escoba/index/{code}/{id}', ...OPTS }, async (event) => {
  const { code, id } = event.params;
  const before = event.data.before.exists() ? event.data.before.val() : null;
  const after = event.data.after.exists() ? event.data.after.val() : null;
  const note = decideEscoba({ code, id, before, after });
  if (note) await sendTo(getDatabase(), code, note, `escoba-${id}`, { game: 'escoba', match: id });
});

export const battleArenaTurnPush = onValueWritten({ ref: '/battlearena/index/{code}/{id}', ...OPTS }, async (event) => {
  const { code, id } = event.params;
  const before = event.data.before.exists() ? event.data.before.val() : null;
  const after = event.data.after.exists() ? event.data.after.val() : null;
  const note = decideBattleArena({ code, id, before, after });
  if (note) await sendTo(getDatabase(), code, note, `battlearena-${id}`, { game: 'battle-arena', match: id });
});

export const battleshipTurnPush = onValueWritten({ ref: '/battleship/index/{code}/{id}', ...OPTS }, async (event) => {
  const { code, id } = event.params;
  const before = event.data.before.exists() ? event.data.before.val() : null;
  const after = event.data.after.exists() ? event.data.after.val() : null;
  const note = decideBattleship({ code, id, before, after });
  if (note) await sendTo(getDatabase(), code, note, `battleship-${id}`, { game: 'battleship', match: id });
});

// THE 24-HOUR REMINDER (2026-10-20). Hourly, reads every challenge game's index (a few small nodes)
// and reminds whoever has had a turn waiting 24 hours, once per turn (decide.js decideReminder).
// What was sent is remembered in its OWN node, pushReminders/<code>/<node>~<id> = the row's
// `updated`, never on the index row: a write there would re-run that game's turn trigger. Not player
// data (a delivery log); clients never read it (root rules are false). Same tag as the game's turn
// notification, so the reminder replaces it on the phone instead of stacking.
export const turnReminderPush = onSchedule({
  schedule: 'every 60 minutes', region: OPTS.region, secrets: OPTS.secrets, retryCount: 0, maxInstances: 1,
}, async () => {
  const db = getDatabase();
  const now = Date.now();
  const sent = (await db.ref('pushReminders').get()).val() || {};
  for (const g of REMINDER_GAMES) {
    let index;
    try { index = (await db.ref(`${g.node}/index`).get()).val() || {}; }
    catch (err) { logger.error('reminder: could not read index', { node: g.node, err: String(err) }); continue; }
    for (const code of Object.keys(index)) {
      const rows = index[code] || {};
      for (const id of Object.keys(rows)) {
        const key = `${g.node}~${id}`;
        const note = decideReminder({ g, id, row: rows[id], sentFor: sent[code] && sent[code][key], now });
        if (!note) continue;
        // Stamp FIRST: a failed send is not retried, a double reminder is worse than a missed one.
        await db.ref(`pushReminders/${code}/${key}`).set(note.updated);
        await sendTo(db, code, note, `${g.tag}-${id}`, g.noMatch ? { game: g.game } : { game: g.game, match: id });
      }
    }
  }
});

// THE REMIND BELL (2026-10-22): nudges/<code>/<node>~<id> written by the other player (rules: as
// their own claimed code, once per match per 6 hours). Sent only for a real turn still waiting on
// <code> in a match with the sender (decide.js decideNudge). Same tag as the game's turn note.
export const nudgePush = onValueWritten({ ref: '/nudges/{code}/{key}', ...OPTS }, async (event) => {
  const { code, key } = event.params;
  const after = event.data.after.exists() ? event.data.after.val() : null;
  if (!after || !after.from) return;
  const db = getDatabase();
  const [node, id] = key.split('~');
  if (!node || !id) return;
  const row = (await db.ref(`${node}/index/${code}/${id}`).get()).val();
  const note = decideNudge({ key, from: after.from, row });
  if (!note) { logger.info('nudge refused', { code, key }); return; }
  const g = note.g;
  await sendTo(db, code, note, `${g.tag}-${id}`, g.noMatch ? { game: g.game } : { game: g.game, match: id });
});

// THE PLAYER DIRECTORY (2026-10-22): directory/<CODE> = { name, emoji, at }, rebuilt from players/
// (decide.js buildDirectory) so the "pick a person" lists read a few KB instead of every device's
// stats. Derived data, written only here (rules: clients read, never write); players/ is untouched.
// Hourly, and at once when Matt lets a code in or out (so a newly allowed person is pickable now).
async function rebuildDirectory() {
  const db = getDatabase();
  const all = (await db.ref('players').get()).val() || {};
  const dir = buildDirectory(all);
  await db.ref('directory').set(dir);
  logger.info('directory rebuilt', { codes: Object.keys(dir).length });
}
export const directoryBuild = onSchedule({
  schedule: 'every 60 minutes', region: OPTS.region, retryCount: 0, maxInstances: 1,
}, rebuildDirectory);
export const directoryOnApprove = onValueWritten({ ref: '/adminConfig/v1/online/{code}', instance: OPTS.instance, region: OPTS.region, retry: false, maxInstances: 1 },
  rebuildDirectory);

// THE SERVER-BUILT LEADERBOARD (2026-10-22, boards.js has the why). Phones read the ~60 KB
// boards/v1/lb/z instead of all of players/ (~930 KB). Rebuilt when a device syncs, at most once every
// BOARD_GAP_MS (a rebuild reads all of players/ once, so a burst of syncs costs one read, not one
// each); a sync inside that gap marks the board dirty and boardsCatchUp rebuilds it within 5
// minutes. The package is rewritten only when a number changed (boards/v1/sums/lb). Derived data: rules let clients read it, never
// write it, and players/ is only read.
const BOARD_GAP_MS = 2 * 60 * 1000;
async function rebuildBoards(db) {
  await db.ref('boards/v1/meta/dirty').set(false);        // a sync after THIS point marks it again
  const [players, cfg, sums] = await Promise.all([
    db.ref('players').get(), db.ref('adminConfig/v1').get(), db.ref('boards/v1/sums').get(),
  ]).then((s) => s.map((x) => x.val()));
  // INTEGRITY CHECKS (2026-10-28, functions/integrity.js): a rule broken for the first time is
  // flagged once and every admin told; a strong one is voided in the package built just below.
  const { written, flags } = await writeFlags(db, players || {});
  if (written.length) {
    const codes = await adminCodes(db);
    for (const f of written) {
      logger.info('integrity flag', { id: f.id, gid: f.gid, rule: f.rule, void: f.flag.void });
      for (const c of codes) await sendTo(db, c, integrityNote('flag', f), `integrity-${f.id}-${f.gid}`, { game: 'admin' });
    }
  }
  const parts = buildBoardParts(players || {}, cfg || null, flags);
  const sum = sumOf(JSON.stringify(parts));
  const patch = { 'meta/builtAt': Date.now(), 'meta/people': Object.keys(parts.people).length };
  // The pickers' directory/ from the same read (2026-10-22: its own hourly timer had not fired
  // an hour after deploy). Written only when a name or emoji changed.
  const dir = buildDirectory(players || {});
  const dsum = sumOf(JSON.stringify(dir));
  if ((sums || {}).dir !== dsum) { await db.ref('directory').set(dir); patch['sums/dir'] = dsum; }
  // Unchanged numbers: nothing is rewritten, so a phone watching the board is sent nothing.
  if ((sums || {}).lb !== sum) { const z = packBoard(parts); patch['lb/z'] = z; patch['sums/lb'] = sum; patch['meta/bytes'] = z.length; }
  await db.ref('boards/v1').update(patch);
  logger.info('boards rebuilt', { people: patch['meta/people'], changed: !!patch['lb/z'] });
}
async function rebuildIfDue(db) {
  const now = Date.now();
  const lock = await db.ref('boards/v1/meta/lockUntil').transaction((cur) => (cur && cur > now ? undefined : now + BOARD_GAP_MS));
  if (!lock.committed) { await db.ref('boards/v1/meta/dirty').set(true); return; }
  await rebuildBoards(db);
}
// `secrets`: a rebuild may push an integrity flag to the admins (sendTo needs the VAPID key).
export const boardsOnSync = onValueWritten({ ref: '/players/{id}/updatedAt', instance: OPTS.instance, region: OPTS.region, retry: false, maxInstances: 5, secrets: [VAPID_PRIVATE_KEY] },
  async () => { await rebuildIfDue(getDatabase()); });
export const boardsOnConfig = onValueWritten({ ref: '/adminConfig/v1/corrections', instance: OPTS.instance, region: OPTS.region, retry: false, maxInstances: 1, secrets: [VAPID_PRIVATE_KEY] },
  async () => { await rebuildBoards(getDatabase()); });
export const integrityOnUndo = onValueWritten({ ref: '/adminConfig/v1/integrity', instance: OPTS.instance, region: OPTS.region, retry: false, maxInstances: 1, secrets: [VAPID_PRIVATE_KEY] },
  async () => { await rebuildBoards(getDatabase()); });
export const boardsCatchUp = onSchedule({ schedule: 'every 5 minutes', region: OPTS.region, retryCount: 0, maxInstances: 1, secrets: [VAPID_PRIVATE_KEY] }, async () => {
  const db = getDatabase();
  const meta = (await db.ref('boards/v1/meta').get()).val() || {};
  // Also every 30 minutes regardless, in case a sync's trigger was ever dropped.
  if (meta.dirty || !meta.builtAt || Date.now() - meta.builtAt > 30 * 60 * 1000) await rebuildBoards(db);
});

// EMPTY ROOMS ARE CLEARED (2026-10-23, Matt: "something should clear them if they've been empty for
// like an hour right?"). A live game's room (rooms/<CODE>) is only needed while people are in it:
// every player's phone stamps `updated` every 10 s (js/net.js heartbeat), results go into each
// player's own stats and chat lines into Messages. Nothing ever removed one, so 129 dead rooms had
// piled up. A room whose `updated` is over an hour old (or missing) has had nobody in it for an hour
// and is deleted. Queried on the indexed `updated`, so only the stale ones are read.
const ROOM_IDLE_MS = 60 * 60 * 1000;
export const roomsCleanup = onSchedule({ schedule: 'every 30 minutes', region: OPTS.region, retryCount: 0, maxInstances: 1 }, async () => {
  const db = getDatabase();
  const snap = await db.ref('rooms').orderByChild('updated').endAt(Date.now() - ROOM_IDLE_MS).get();
  const patch = {};
  snap.forEach((c) => { patch[c.key] = null; });
  const n = Object.keys(patch).length;
  if (n) await db.ref('rooms').update(patch);
  logger.info('rooms cleared', { n });
});

// SPELLING BEE FAIR PLAY (2026-10-28, functions/bee.js, docs/SPELLING-BEE-INTEGRITY-SPEC.md). Detection
// and the missing-log check run every 5 minutes; a copied day is flagged once and every admin is told.
export const beeWatch = onSchedule({ schedule: 'every 5 minutes', region: OPTS.region, retryCount: 0, maxInstances: 1, secrets: [VAPID_PRIVATE_KEY] }, async () => {
  const db = getDatabase();
  const { flags, alerts } = await scanRecent(db);
  const codes = (flags.length || alerts.length) ? await adminCodes(db) : new Set();
  for (const [bk, code, f] of flags) {
    logger.info('bee flagged', { bk, code, summary: f.summary });
    for (const c of codes) await sendTo(db, c, beeNote('flag', bk, f), `bee-flag-${bk}-${code}`, { game: 'spelling-bee' });
  }
  for (const [bk, code, a] of alerts) {
    logger.info('bee log gap', { bk, code, words: a.words, logged: a.logged });
    for (const c of codes) await sendTo(db, c, beeNote('log', bk, a), `bee-log-${bk}-${code}`, { game: 'spelling-bee' });
  }
  const meta = (await db.ref('boards/v1/beeMeta').get()).val() || {};
  if (flags.length || meta.dirty || !meta.builtAt || Date.now() - meta.builtAt > 30 * 60 * 1000) {
    const r = await rebuildBee(db);
    logger.info('bee board rebuilt', r);
  }
});
export const beeOnDaily = onValueWritten({ ref: '/beeDaily/{puzzle}/{code}', instance: OPTS.instance, region: OPTS.region, retry: false, maxInstances: 5 },
  async () => { await rebuildBeeIfDue(getDatabase()); });
export const beeOnUndo = onValueWritten({ ref: '/adminConfig/v1/bee', instance: OPTS.instance, region: OPTS.region, retry: false, maxInstances: 1 },
  async () => { await rebuildBee(getDatabase()); });

// INTEGRITY ALERTS ON ONLINE CHALLENGES (2026-10-28, functions/integrity.js). When a match's `over` is
// written, its log is checked once; an alert (never a void) goes to every admin.
async function matchCheck(node, id, m) {
  const db = getDatabase();
  const written = await checkFinishedMatch(db, node, id, m);
  if (!written.length) return;
  const codes = await adminCodes(db);
  for (const a of written) {
    logger.info('integrity alert', { node, id, rule: a.rule, side: a.side, v: a.v });
    for (const c of codes) await sendTo(db, c, integrityNote('match', { ...a, node }), `integrity-${node}-${id}`, { game: 'admin' });
  }
}
const overOpts = (node) => ({ ref: `/${node}/games/{id}/over`, ...OPTS, maxInstances: 2 });
const onMatchOver = (node) => onValueWritten(overOpts(node), async (event) => {
  if (!event.data.after.exists()) return;
  const m = (await getDatabase().ref(`${node}/games/${event.params.id}`).get()).val();
  await matchCheck(node, event.params.id, m);
});
export const dartsMatchCheck = onMatchOver('darts');
export const cupPongMatchCheck = onMatchOver('cuppong');
export const battleshipMatchCheck = onMatchOver('battleship');
export const hoopsMatchCheck = onMatchOver('hoops');

// CONTEXTO, FROM THE PLAY LOG (2026-10-28): every Contexto win a phone logs is judged once
// (js/integrity.js checkContextoWin); an alert, never a void, goes to every admin.
export const contextoWinCheck = onValueCreated({ ref: '/playLog/{code}/{id}', ...OPTS, maxInstances: 5 }, async (event) => {
  const v = event.data.val();
  if (!v || v.g !== 'contexto' || v.e !== 'win') return;
  const db = getDatabase();
  const written = await checkContextoLogWin(db, event.params.code, event.params.id, v);
  if (!written.length) return;
  const codes = await adminCodes(db);
  for (const a of written) {
    logger.info('integrity alert', { node: 'contexto', code: a.code, k: a.k, rule: a.rule, v: a.v });
    for (const c of codes) await sendTo(db, c, integrityNote('match', a), `integrity-contexto-${a.code}-${a.k}`, { game: 'admin' });
  }
});
