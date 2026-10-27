// online-gate.js - who may play online (2026-10-08).
//
// Matt: "Get rid of the play yourself cheat." Every online game here took any two devices as two
// players, so a second phone or a private browser window with a made-up name was a free opponent
// to beat. A made-up player is always a NEW player code, so online play is now gated on the code:
// js/admin-config.js's ONLINE_BEFORE (everyone who already had a code) plus whatever Matt turns on
// from the admin page. See the block above ONLINE_BEFORE for the full reasoning.
//
// Checked in three places, so no game has to remember it:
//   - js/net.js createRoom / joinRoom / joinSeat (every live room: Chinchon, Escoba, Tic Tac Toe,
//     Mancala, Filler, Dots and Boxes, Boggle, Battleship, Yahtzee, Hoops, Air Hockey, Hold'em),
//     which also refuses a room that already holds the SAME code on another device;
//   - each turn-by-turn challenge's createGame (Hoops, Cup Pong, Darts, Skeeball), which also
//     refuses an opponent who is not allowed;
//   - the challenge pickers, which only list opponents who are allowed.
//
// A deterrent, like every check in this app: there is no server, so someone with developer tools
// can still lie to their own phone. It stops the ordinary way of doing it.

import { loadProfile } from './profile-store.js';
import { isOnlineAllowed, isAdminDevice } from './admin-config.js';
import { makeT } from './i18n.js';
import { isDevProfile } from './challenge/hooks.js';

const t = makeT({
  en: {
    no_code: 'Set up your profile before playing online.',
    not_approved: 'Online play is not turned on for your account yet. Ask Matt to turn it on.',
    same_player: 'That game is already open on another of your devices. Play someone else.',
    them_not_approved: "That player can't play online yet.",
  },
  es: {
    no_code: 'Configura tu perfil antes de jugar en línea.',
    not_approved: 'El juego en línea aún no está activado para tu cuenta. Pídele a Matt que lo active.',
    same_player: 'Esa partida ya está abierta en otro de tus dispositivos. Juega contra otra persona.',
    them_not_approved: 'Ese jugador aún no puede jugar en línea.',
  },
});

/** This device's player code, upper-cased, or '' when it has none. */
export function myPlayerCode() {
  try {
    const p = loadProfile();
    return p && p.playerId ? String(p.playerId).trim().toUpperCase() : '';
  } catch { return ''; }
}

/** Why this device may NOT play online right now, or null when it may.
 *  'no-code' | 'not-approved' | null. Matt's own devices always may. */
export function onlineGate() {
  const c = myPlayerCode();
  if (!c) return 'no-code';
  let admin = false;
  try { admin = isAdminDevice(); } catch { admin = false; }
  if (admin || isOnlineAllowed(c)) return null;
  return 'not-approved';
}

/** May this OTHER player code play online? For opponent lists and challenge checks. With `game`
 *  (a hub id) and their `name`, also: may they SEE that game? An admin-only game is never sent to a
 *  player whose launcher hides it (Matt, 2026-10-27: "NO admin only game visible to ANY player
 *  besides me"), so its picker lists only dev profiles and codes Matt opened it to, and createGame
 *  refuses anyone else (no push, no Messages line, no index row for a game they cannot see). */
export function codeMayPlayOnline(code, game, name) {
  if (!isOnlineAllowed(code)) return false;
  if (!game || !_gameShown || _gameShown(game, code)) return true;
  return !!name && isDevProfile(name);
}

/** js/hub.js registers `(hubId, code) => bool`: is that game on that player's launcher? It owns the
 *  registry (devOnly) and the admin overrides, so the rule lives in one place. Unset (a standalone
 *  game page) = no game check. */
let _gameShown = null;
export function setGameShownCheck(fn) { _gameShown = typeof fn === 'function' ? fn : null; }

/** The words for a refusal from this module, or '' when `err` is not one of ours (so a caller can
 *  write `onlineGateText(err) || itsOwnMessage`). */
export function onlineGateText(err) {
  if (err === 'no-code') return t('no_code');
  if (err === 'not-approved') return t('not_approved');
  if (err === 'same-player') return t('same_player');
  if (err === 'them-not-approved') return t('them_not_approved');
  return '';
}

export default { myPlayerCode, onlineGate, codeMayPlayOnline, setGameShownCheck, onlineGateText };
