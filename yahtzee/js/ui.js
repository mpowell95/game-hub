'use strict';

// Hub module contract: init(container) / destroy() / isInProgress().
//
// MULTIPLAYER. Two human seats over the shared js/net.js room protocol,
// following the conventions Tic Tac Toe's MP pass settled (js/CLAUDE.md's
// "third consumer" section) -- js/net.js itself is untouched. Deliberately
// SIMPLER than the reference games in two ways, stated up front:
//   1. No in-room rematch series (Pool's precedent, js/CLAUDE.md's "seventh
//      consumer"): one game per room. A rematch is a fresh room.
//   2. No autosave/rejoin window: destroy() while an MP room is live always
//      leaves the room (ends it for both sides) rather than persisting a
//      save to rejoin later. Simpler and more honest than a half-abandoned
//      room with no UI to rejoin it.
//
// Seats: `state.players[0]` is always the HOST's data, `state.players[1]`
// always the GUEST's -- an ABSOLUTE representation, required so both devices
// can hash-verify the identical state. Every "self" lookup for RENDERING
// goes through localSeat()/remoteSeat() instead, which is what lets the
// existing solo engine's "box column = state.players[0], numeral column =
// state.players[1]" rendering stay completely unchanged: in solo,
// localSeat() is always 0, so "me" and "player 0" coincide exactly like
// before. Only in MP does localSeat() ever return 1 (the guest), at which
// point the SAME rendering code shows state.players[1] in the box column
// because meIdx = localSeat() = 1.
//
// Move vocabulary (net.appendMove's `move` payload): {t:'roll', dice:[...]},
// {t:'hold', i}, {t:'commit', cat}. A roll's dice VALUES are random, so --
// like a Pool shot's physics parameters (js/CLAUDE.md's "seventh consumer")
// -- the roller generates them locally and transmits the RESULT; the peer
// adopts the same values rather than trying to synchronize the RNG itself.
// Category selection is never synced (it's local-only ghost-preview UI);
// only the eventual commit is a lockstep move, and its SCORE is never
// transmitted either -- previewScore()/applyCommit() are pure functions of
// already-synced state, so both sides compute the identical result deterministically.

import * as net from '../../js/net.js';
import { onViewportResize } from '../../js/viewport.js';
import { stateHash } from './hash.js';
import { deviceId, recordYahtzee } from '../../js/game-stats.js';
import { howToHtml, createHowTo } from './howto.js';

const MODE = 'ai'; // 'ai' | 'hotseat' -- solo-mode default; irrelevant once in MP
const MP_RECOVERY_MAX_ATTEMPTS = 3;
const MP_CODE_LEN = 4;

const UPPER_KEYS = ['ones','twos','threes','fours','fives','sixes'];
const LEFT_CATS = UPPER_KEYS;
const RIGHT_CATS = ['threeKind','fourKind','fullHouse','smallStraight','largeStraight','yahtzee','chance'];
const CATEGORIES = [...LEFT_CATS, ...RIGHT_CATS];
const RIGHT_ICON_KIND = {
  threeKind:'3x', fourKind:'4x', fullHouse:'house',
  smallStraight:'small', largeStraight:'large', yahtzee:'yahtzee', chance:'chance'
};

// What each symbol MEANS. Built 2026-08-11: the reference how-to's fifth page is "Learn about
// each combo by pressing its symbol on the board", and this game had no such thing -- seven
// little red pictograms (3x, 4x, a house, two card fans, a star, a question mark) with nothing
// anywhere on the screen saying what any of them scored. A player who did not already know
// Yahtzee could not find out from inside the game.
const CAT_INFO = {
  ones:   { name:'Ones',    score:'Score: sum of all 1s' },
  twos:   { name:'Twos',    score:'Score: sum of all 2s' },
  threes: { name:'Threes',  score:'Score: sum of all 3s' },
  fours:  { name:'Fours',   score:'Score: sum of all 4s' },
  fives:  { name:'Fives',   score:'Score: sum of all 5s' },
  sixes:  { name:'Sixes',   score:'Score: sum of all 6s' },
  threeKind:    { name:'3 of a kind',   score:'Score: sum of all dice' },
  fourKind:     { name:'4 of a kind',   score:'Score: sum of all dice' },
  fullHouse:    { name:'Full house',    score:'Score: 25' },
  smallStraight:{ name:'Sequence of 4', score:'Score: 30' },
  largeStraight:{ name:'Sequence of 5', score:'Score: 40' },
  yahtzee:      { name:'Yahtzee',       score:'Score: 50' },
  chance:       { name:'Chance',        score:'Score: sum of all dice' },
};

const GAME_MARKUP = `
<div id="fit">
<div id="shakeWrap">
<div id="stage">

  <div class="yz-hdr">
    <svg class="yz-chevron yz-abs" viewBox="0 0 12 20"><path d="M10 2 L2 10 L10 18" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>

    <div class="yz-pod yz-p1 yz-active" id="pod1">
      <div class="yz-avatar" id="p1avatar">&#128578;</div>
      <div class="yz-pod-text">
        <div class="yz-pod-total" id="p1total">0</div>
        <div class="yz-pod-name" id="p1name">You</div>
      </div>
    </div>

    <div class="yz-pod yz-p2 yz-idle" id="pod2">
      <div class="yz-pod-text">
        <div class="yz-pod-total" id="p2total">0</div>
        <div class="yz-pod-name" id="p2name">Computer</div>
      </div>
      <div class="yz-avatar" id="p2avatar">&#129302;</div>
    </div>

    <button type="button" class="yz-kebab yz-abs" data-action="howto" aria-label="How to play"><span></span><span></span><span></span></button>
  </div>

  <div class="yz-rule-gold"></div>
  <div class="yz-rule-amber"></div>
  <div class="yz-rule-orange"></div>

  <div class="yz-playfield">
    <div class="yz-frame"></div>
    <div class="yz-scorecard" id="scorecard"></div>
    <div class="yz-cat-dim" id="catDim"></div>
    <div class="yz-cat-pop" id="catPop"><b id="catPopName"></b><span id="catPopScore"></span></div>
  </div>

  <!-- Dice: real static 6-face CSS cubes; JS rotates each cube to show the current value -->
  <div class="yz-die" id="dieWrap0" style="left:19px"><div class="yz-die-shadow"></div><div class="yz-cube" id="cube0"></div></div>
  <div class="yz-die" id="dieWrap1" style="left:98px"><div class="yz-die-shadow"></div><div class="yz-cube" id="cube1"></div></div>
  <div class="yz-die" id="dieWrap2" style="left:177px"><div class="yz-die-shadow"></div><div class="yz-cube" id="cube2"></div></div>
  <div class="yz-die" id="dieWrap3" style="left:256px"><div class="yz-die-shadow"></div><div class="yz-cube" id="cube3"></div></div>
  <div class="yz-die" id="dieWrap4" style="left:335px"><div class="yz-die-shadow"></div><div class="yz-cube" id="cube4"></div></div>

  <button class="yz-roll-btn" id="rollBtn"><span class="yz-label">ROLL</span></button>
  <div class="yz-roll-pip yz-lit" id="rollPip1" style="left:178px">1</div>
  <div class="yz-roll-pip yz-lit" id="rollPip2" style="left:208px">2</div>
  <div class="yz-roll-pip yz-dim" id="rollPip3" style="left:238px">3</div>
  <button class="yz-play-btn yz-off" id="playBtn"><span class="yz-label">PLAY</span></button>

  <button type="button" class="yz-mp-leave" id="mpLeaveBtn" hidden>Leave</button>

  <div id="toast"></div>
  <div id="celebration">
    <div id="cel-flash"></div>
    <div id="cel-rays"></div>
    <div id="cel-text">YAHTZEE!!</div>
    <div id="cel-confetti"></div>
  </div>
  <div id="overlay"></div>

</div>
</div>
</div>`;

let state = null;
let root = null;          // the .yz-root element mounted into container
let screenHost = null;    // swaps between the setup/lobby screen and GAME_MARKUP
let destroyed = true;     // true whenever no live instance is mounted
let resizeHandler = null;
let howTo = null;
let offViewport = null;   // unsubscribe from js/viewport.js's coalesced resize subscription
let pendingTimeouts = new Set();
let pendingFrames = new Set();

// --- setup / lobby screen state (module-level: exists before any `state`) ---
let view = 'setup';           // 'setup' | 'game'
let mpMode = 'solo';          // 'solo' | 'host' | 'join' -- deliberately not persisted
let lobby = null;             // null | 'host' | 'join'
let mpBusy = false;
let mpError = '';
let mpJoinCode = '';
let mpPendingCode = null;
let mpJoinedCode = null;
let mpLobbyRoom = null;

function scheduleTimeout(fn, ms){
  const id = setTimeout(() => { pendingTimeouts.delete(id); if(!destroyed) fn(); }, ms);
  pendingTimeouts.add(id);
  return id;
}
function scheduleFrame(fn){
  const id = requestAnimationFrame((ts) => { pendingFrames.delete(id); if(!destroyed) fn(ts); });
  pendingFrames.add(id);
  return id;
}
function wait(ms){ return new Promise(resolve => scheduleTimeout(resolve, ms)); }

function $(id){ return document.getElementById(id); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function readProfileEmoji(){
  // Reads the Game Hub's shared profile (localStorage["gamehub.profile"]) if present.
  // Defaults-only, read-only: never written here. Missing/malformed data = no profile.
  try{
    const raw = localStorage.getItem('gamehub.profile');
    if(!raw) return null;
    const p = JSON.parse(raw);
    return (p && typeof p.emoji === 'string' && p.emoji) ? p.emoji : null;
  }catch(e){ return null; }
}
function readProfileName(){
  try{
    const raw = localStorage.getItem('gamehub.profile');
    if(!raw) return null;
    const p = JSON.parse(raw);
    return (p && typeof p.name === 'string' && p.name.trim()) ? p.name.trim() : null;
  }catch(e){ return null; }
}
function myIdentity(){
  return { name: readProfileName() || 'You', avatar: readProfileEmoji() || '\u{1F642}', deviceId: deviceId() };
}

/* ---------- STATE ---------- */
function newGame(mpInfo){
  state = {
    players: [
      { name: mpInfo ? mpInfo.hostName : 'You', scores:{}, bonusTotal:0 },
      { name: mpInfo ? mpInfo.guestName : (MODE==='ai' ? 'Computer' : 'Player 2'), scores:{}, bonusTotal:0 }
    ],
    current: mpInfo ? mpInfo.dealer : 0,
    dice: [0,0,0,0,0].map(() => ({ value:1, held:false })),
    rollsUsed: 0,
    selected: null,
    phase: 'idle',
    yahtzeeBonusCount: [0,0],
    gameOver: false,
    statsCommitted: false,
    mp: mpInfo ? {
      role: mpInfo.role, code: mpInfo.code, localSeat: mpInfo.role==='host' ? 0 : 1,
      opp: mpInfo.opp, appliedSeq: 0, movesById: new Map(), maxKnownSeq: 0,
      delivering: false, redeliverRequested: false, awaitingRecovery: false,
      recoveryAttempts: 0, lastRecoveryHandled: null, lastRecoveryApplied: null,
      opponentLeft: false, statusMsg: '', ended: false,
    } : null
  };
}

function localSeat(){ return (state && state.mp) ? state.mp.localSeat : 0; }
function remoteSeat(){ return 1 - localSeat(); }

/* ---------- SCORING ---------- */
function sum(arr){ return arr.reduce((a,b)=>a+b,0); }
function counts(vals){ const c={}; vals.forEach(v=>{ c[v]=(c[v]||0)+1; }); return c; }
function diceValues(dice){ return dice.map(d=>d.value); }
function isYahtzeeRoll(dice){ return Object.values(counts(diceValues(dice))).some(n=>n===5); }

function categoryScore(cat, dice){
  const vals = diceValues(dice);
  const c = counts(vals);
  const upperIdx = UPPER_KEYS.indexOf(cat);
  if(upperIdx>=0){
    const face = upperIdx+1;
    return vals.filter(v=>v===face).length*face;
  }
  switch(cat){
    case 'threeKind': return Object.values(c).some(n=>n>=3) ? sum(vals) : 0;
    case 'fourKind':  return Object.values(c).some(n=>n>=4) ? sum(vals) : 0;
    case 'fullHouse': {
      const cs = Object.values(c).sort((a,b)=>a-b);
      return (cs.length===2 && cs[0]===2 && cs[1]===3) ? 25 : 0;
    }
    case 'smallStraight': {
      const set = new Set(vals);
      const runs = [[1,2,3,4],[2,3,4,5],[3,4,5,6]];
      return runs.some(r=>r.every(v=>set.has(v))) ? 30 : 0;
    }
    case 'largeStraight': {
      const key = [...new Set(vals)].sort((a,b)=>a-b).join(',');
      return (key==='1,2,3,4,5' || key==='2,3,4,5,6') ? 40 : 0;
    }
    case 'yahtzee': return Object.values(c).some(n=>n===5) ? 50 : 0;
    case 'chance':  return sum(vals);
  }
  return 0;
}

// Applies the joker rule on top of categoryScore when the current roll is a
// Yahtzee and the player's yahtzee box already holds 50 (a bonus situation).
function previewScore(playerScores, cat, dice){
  const vals = diceValues(dice);
  const isYz = isYahtzeeRoll(dice);
  const yzBoxUsed = playerScores.yahtzee === 50;
  if(isYz && yzBoxUsed && cat!=='yahtzee'){
    const face = vals[0];
    const upperKey = UPPER_KEYS[face-1];
    if(cat === upperKey) return face*5;
    if(cat === 'fullHouse') return 25;
    if(cat === 'smallStraight') return 30;
    if(cat === 'largeStraight') return 40;
    if(cat === 'threeKind' || cat === 'fourKind' || cat === 'chance') return sum(vals);
    if(UPPER_KEYS.includes(cat)) return 0; // non-matching upper box, joker fallback
  }
  return categoryScore(cat, dice);
}

// Which categories the current roll may legally be committed to. Enforces
// the joker rule's "matching upper box first" constraint.
function availableCategories(playerScores, dice){
  const open = CATEGORIES.filter(c=>playerScores[c]==null);
  const isYz = isYahtzeeRoll(dice);
  const yzBoxUsed = playerScores.yahtzee === 50;
  if(isYz && yzBoxUsed){
    const face = diceValues(dice)[0];
    const upperKey = UPPER_KEYS[face-1];
    if(playerScores[upperKey]==null) return [upperKey];
  }
  return open;
}

function upperSum(scores){ return UPPER_KEYS.reduce((s,k)=>s+(scores[k]||0),0); }
function upperBonus(scores){ return upperSum(scores) >= 63 ? 35 : 0; }
function totalScore(p){
  const filled = CATEGORIES.reduce((s,c)=>s+(p.scores[c]||0),0);
  return filled + upperBonus(p.scores) + (p.bonusTotal||0);
}
function isGameOver(){
  return state.players.every(p => CATEGORIES.every(c => p.scores[c]!=null));
}
function hasProgress(){
  if(!state) return false;
  return state.rollsUsed>0 || state.players.some(p => CATEGORIES.some(c => p.scores[c]!=null));
}

/* ---------- TURN / COMMIT FLOW ---------- */
function isHumanTurn(){
  if(state.mp) return state.current === localSeat();
  return MODE==='hotseat' || state.current===0;
}
function reducedMotion(){
  return typeof window.matchMedia==='function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Mutates state with the given (already-decided) dice values, respecting
// each die's current held flag. Shared by the local roller (random values)
// and the MP remote-apply path (transmitted values) -- see the module header.
function applyRollResult(values){
  const heldMaskBefore = state.dice.map(d=>d.held);
  values.forEach((v,i)=>{ if(!state.dice[i].held) state.dice[i].value = v; });
  state.rollsUsed++;
  state.selected = null;
  state.phase = 'rolling';
  return heldMaskBefore;
}

// Gating note: this is called both by the click handler (which already checks
// isHumanTurn() before calling in) and by the AI's own turn (aiTakeTurn),
// which is legitimately acting on player 1's behalf while state.current===1 --
// isHumanTurn() would incorrectly report that as "not my turn" and block the
// AI from ever rolling, so it is NOT re-checked here. Remote MP moves never
// call this function at all (mpApplyNextEntry mutates state directly).
async function doRoll(){
  if(state.phase==='gameOver' || state.rollsUsed>=3) return;
  const values = state.dice.map(d => d.held ? d.value : 1+Math.floor(Math.random()*6));
  const heldMaskBefore = applyRollResult(values);
  if(state.mp) mpAfterLocalMove({ t:'roll', dice: values });
  renderHeader(); renderScorecard(); renderControls(); renderOverlay();
  await animateRoll(heldMaskBefore);
  if(destroyed) return;
  state.phase = 'awaitingPick';
  renderScorecard(); // ghost previews now that rollsUsed>=1
  renderControls();
}

function toggleHold(i){
  if(state.rollsUsed<1 || state.rollsUsed>=3 || state.phase==='gameOver') return;
  state.dice[i].held = !state.dice[i].held;
  if(state.mp) mpAfterLocalMove({ t:'hold', i });
  render();
  const liftY = state.dice[i].held ? -10 : 0;
  const dieEl = $('dieWrap'+i);
  const dur = reducedMotion() ? 20 : 140;
  dieEl.animate([
    { transform:`translateY(${liftY}px) rotate(0deg)` },
    { transform:`translateY(${liftY}px) rotate(3deg)` },
    { transform:`translateY(${liftY}px) rotate(-3deg)` },
    { transform:`translateY(${liftY}px) rotate(0deg)` }
  ], { duration:dur, easing:'ease-out' });
}

/* ---------- Combo info: press a symbol to learn what it is (2026-08-11) ----------
 * The reference opens this on a PRESS and closes it on release. A pure press-and-hold is a bad
 * fit here though: the same icons are also how you pick a category, and this game already routes
 * every tap through one delegated click listener. So the rule is: hold for 320ms to learn,
 * release to dismiss; a short tap still selects, exactly as before. Nothing about picking a
 * category changed, which is why no existing test needed touching. */
const CAT_HOLD_MS = 320;
let catHoldTimer = null;
let catHoldFired = false;

function showCatInfo(cat, iconEl){
  const info = CAT_INFO[cat];
  const pop = $('catPop'), dim = $('catDim');
  if(!info || !pop || !dim || !iconEl) return;
  $('catPopName').textContent = info.name;
  $('catPopScore').textContent = info.score;
  // Positioned against the PLAYFIELD, which is the popover's own offset parent, so this stays
  // correct at any stage scale (the whole stage is transform-scaled to fit the phone).
  const field = root.querySelector('.yz-playfield');
  const fr = field.getBoundingClientRect(), ir = iconEl.getBoundingClientRect();
  const scale = fr.width / 410 || 1;
  const left = (ir.left - fr.left) / scale + (ir.width / scale) / 2;
  const top = (ir.top - fr.top) / scale;
  pop.style.left = Math.max(8, Math.min(410 - 8, left)) + 'px';
  pop.style.top = Math.max(6, top - 10) + 'px';
  pop.classList.add('yz-show');
  dim.classList.add('yz-show');
}

function hideCatInfo(){
  const pop = $('catPop'), dim = $('catDim');
  if(pop) pop.classList.remove('yz-show');
  if(dim) dim.classList.remove('yz-show');
}

function selectCategory(cat){
  if(state.rollsUsed<1 || state.phase==='gameOver') return;
  const avail = availableCategories(state.players[state.current].scores, state.dice);
  if(!avail.includes(cat)) return;
  state.selected = cat;
  render();
}

// The full scoring/turn-advance logic for committing `cat`. Shared by the
// local click handler and the MP remote-apply path, so a Yahtzee committed
// by either player runs through identical scoring, bonus and celebration
// logic -- both sides see the same flash/bounce/celebration for ANY commit,
// not just their own.
function applyCommit(cat){
  const committedPlayer = state.current;
  const p = state.players[committedPlayer];
  const dice = state.dice;
  const value = previewScore(p.scores, cat, dice);
  const isYz = isYahtzeeRoll(dice);
  const wasBonus = isYz && p.scores.yahtzee === 50;
  const bonusBefore = upperBonus(p.scores);
  const beforeTotals = [totalScore(state.players[0]), totalScore(state.players[1])];

  p.scores[cat] = value;
  if(wasBonus){
    p.bonusTotal = (p.bonusTotal||0) + 100;
    state.yahtzeeBonusCount[committedPlayer]++;
  }
  const bonusAfter = upperBonus(p.scores);
  const upperBonusFired = bonusAfter > bonusBefore;
  const celebrate = (cat==='yahtzee' && value===50) || wasBonus;
  const afterTotals = [totalScore(state.players[0]), totalScore(state.players[1])];

  endTurn({ celebrate, upperBonusFired, cat, committedPlayer, beforeTotals, afterTotals });
}

function commitSelection(){
  if(state.phase==='gameOver' || !state.selected) return;
  const cat = state.selected;
  const isMp = !!state.mp;
  applyCommit(cat);
  if(isMp) mpAfterLocalMove({ t:'commit', cat });
}

// Records this device's own result once the match is over. Each device records
// its own perspective independently (per js/CLAUDE.md's head-to-head/MP stats
// convention) -- that is not double-counting, gamehub.stats is keyed per player.
// `_statsCommitted`-style idempotence guard (state.statsCommitted) matches every
// other game's pattern, since endTurn can in principle run more than once at a
// gameOver boundary (e.g. a late remote entry after local gameOver already fired).
function commitStatsOnce(){
  if(!state || state.statsCommitted) return;
  state.statsCommitted = true;
  const me = state.players[localSeat()], opp = state.players[remoteSeat()];
  const myTotal = totalScore(me), oppTotal = totalScore(opp);
  const won = myTotal===oppTotal ? null : (myTotal>oppTotal);
  const yahtzees = (me.scores.yahtzee===50 ? 1 : 0) + (state.yahtzeeBonusCount[localSeat()]||0);
  const difficulty = state.mp ? 'mp' : MODE;
  try{ recordYahtzee(difficulty, won, { yahtzees, score: myTotal }); }
  catch(e){ /* never block the result */ }
}

function endTurn(effects){
  state.selected = null;
  state.dice.forEach(d=>{ d.held=false; });
  state.rollsUsed = 0;

  const gameOver = isGameOver();
  if(gameOver){
    state.phase = 'gameOver';
    state.gameOver = true;
    commitStatsOnce();
  } else {
    state.current = 1 - state.current;
    state.phase = 'idle';
  }

  render();
  if(!gameOver){
    const incomingPod = $(state.current===localSeat() ? 'pod1' : 'pod2');
    if(incomingPod){
      incomingPod.classList.add('yz-pulse');
      scheduleTimeout(()=>incomingPod.classList.remove('yz-pulse'), 300);
    }
  }
  if(effects) animateCommitEffects(effects);

  if(!gameOver && !state.mp && MODE==='ai' && state.current===1){
    scheduleTimeout(aiTakeTurn, 700);
  }
}

/* ---------- AI (solo mode only) ---------- */
function aiChooseHolds(dice){
  const vals = diceValues(dice);
  const c = counts(vals);
  let bestVal=null, bestCount=0;
  for(const v in c){ if(c[v]>bestCount){ bestCount=c[v]; bestVal=+v; } }
  const uniqueSorted = [...new Set(vals)].sort((a,b)=>a-b);
  const holdVals = new Set();
  for(let i=0;i<=uniqueSorted.length-4;i++){
    if(uniqueSorted[i+3]-uniqueSorted[i]===3){
      for(let k=i;k<i+4;k++) holdVals.add(uniqueSorted[k]);
      break;
    }
  }
  if(holdVals.size===0 && bestCount>=2) holdVals.add(bestVal);
  return holdVals;
}

function pickCategoryForAI(scores, dice){
  const avail = availableCategories(scores, dice);
  let best=null, bestVal=-1;
  for(const cat of avail){
    const v = previewScore(scores, cat, dice) || 0;
    if(best===null || v>bestVal){ best=cat; bestVal=v; continue; }
    if(v===bestVal){
      const catIsLower = !UPPER_KEYS.includes(cat);
      const bestIsLower = !UPPER_KEYS.includes(best);
      if(catIsLower && !bestIsLower){ best=cat; bestVal=v; }
    }
  }
  return best;
}

async function aiTakeTurn(){
  if(destroyed || state.mp || state.current!==1 || state.phase==='gameOver') return;
  state.phase = 'rolling';
  while(state.rollsUsed<3){
    await wait(300);
    if(destroyed) return;
    await doRoll();
    if(destroyed) return;
    await wait(400);
    if(destroyed) return;
    if(state.rollsUsed<3){
      const holdVals = aiChooseHolds(state.dice);
      state.dice.forEach(d=>{ d.held = holdVals.has(d.value); });
      render();
    }
  }
  const best = pickCategoryForAI(state.players[1].scores, state.dice);
  state.selected = best;
  render();
  await wait(600);
  if(destroyed) return;
  commitSelection();
}

/* ---------- MULTIPLAYER: room lifecycle, lockstep, recovery ---------- */

async function mpHostCreate(){
  if(mpBusy) return;
  mpBusy = true; mpError = '';
  lobby = 'host';
  renderSetupScreen();
  const res = await net.createRoom('yahtzee', {}, myIdentity());
  mpBusy = false;
  if(destroyed) return;
  if(res.error){
    mpError = res.error==='busy' ? 'Could not create a room. Try again.' : 'Offline — check your connection.';
    lobby = null;
    renderSetupScreen();
    return;
  }
  mpPendingCode = res.code;
  net.heartbeat(res.code, 'host');
  await net.onRoom(res.code, room => mpRoomCallback(room));
  if(destroyed) return;
  renderSetupScreen();
}

async function mpJoinSubmit(){
  if(mpBusy) return;
  const code = mpJoinCode;
  if(code.length !== MP_CODE_LEN) return;
  mpBusy = true; mpError = '';
  renderSetupScreen();
  const res = await net.joinRoom(code, myIdentity());
  mpBusy = false;
  if(destroyed) return;
  if(res.error){
    mpError = res.error==='not-found' ? 'Room not found.'
      : res.error==='full' ? 'That room is full.'
      : res.error==='version' ? 'Update the app to join — the host is on a newer version.'
      : 'Offline — check your connection.';
    renderSetupScreen();
    return;
  }
  if(res.room && res.room.game && res.room.game !== 'yahtzee'){
    mpError = 'That code is for a different game.';
    renderSetupScreen();
    return;
  }
  mpPendingCode = code;
  mpJoinedCode = code;
  lobby = 'join';
  net.heartbeat(code, 'guest');
  await net.onRoom(code, room => mpRoomCallback(room));
  if(destroyed) return;
  mpLobbyRoom = res.room;
  renderSetupScreen();
  if(res.room && res.room.status==='active' && res.room.round) mpGuestStartMatch(res.room);
}

async function mpHostStartMatch(){
  const room = mpLobbyRoom;
  if(!room || !room.guest || (state && state.mp) || mpBusy) return;
  const dealer = 0; // host opens; no rematch series to alternate across
  try{ await net.startRound(mpPendingCode, 1, null, dealer); }
  catch(e){ mpError = 'Connection error.'; renderSetupScreen(); return; }
  if(destroyed) return;
  beginMPGame('host', mpPendingCode, { name: room.guest.name, avatar: room.guest.avatar }, dealer);
}

function mpGuestStartMatch(room){
  if((state && state.mp) || destroyed || !room || !room.round) return;
  const dealer = room.round.dealer|0;
  beginMPGame('guest', mpJoinedCode, { name: room.host.name, avatar: room.host.avatar }, dealer);
}

function beginMPGame(role, code, opp, dealer){
  const me = myIdentity();
  const hostName = role==='host' ? me.name : opp.name;
  const guestName = role==='host' ? opp.name : me.name;
  newGame({ role, code, opp, dealer, hostName, guestName });
  lobby = null;
  view = 'game';
  mountGameScreen();
  render();
}

function mpAfterLocalMove(move){
  const mp = state.mp;
  if(!mp) return;
  const seq = ++mp.appliedSeq;
  const hash = stateHash(state);
  net.appendMove(mp.code, mp.role, seq, move, hash).catch(()=>{
    if(state && state.mp) state.mp.statusMsg = 'Connection error — reconnecting…';
  });
}

async function mpTryDeliverNextMove(){
  const mp = state && state.mp;
  if(!mp || mp.delivering || mp.awaitingRecovery || destroyed) return;
  mp.delivering = true;
  try{
    // eslint-disable-next-line no-constant-condition
    while(true){
      const applied = await mpApplyNextEntry();
      if(destroyed || !state || !state.mp) return;
      if(!applied) break;
    }
  } finally {
    if(!state || !state.mp) return;
    if(state.mp.redeliverRequested){
      state.mp.redeliverRequested = false;
      state.mp.delivering = false;
      mpTryDeliverNextMove();
      return;
    }
    state.mp.delivering = false;
  }
}

// Applies the single log entry at appliedSeq+1 if present, legal and
// hash-consistent. Returns whether the drain loop should keep going.
async function mpApplyNextEntry(){
  const mp = state.mp;
  if(!mp || mp.awaitingRecovery || !mp.movesById || state.phase==='gameOver') return false;
  const seq = mp.appliedSeq + 1;
  const entry = mp.movesById.get(seq);
  if(!entry || !entry.move) return false;
  const move = entry.move;
  let agreed = true;

  if(move.t === 'roll'){
    if(state.current !== remoteSeat() || state.rollsUsed>=3 || !Array.isArray(move.dice) || move.dice.length!==5){
      agreed = false;
    } else {
      const heldMaskBefore = applyRollResult(move.dice);
      renderHeader(); renderScorecard(); renderControls(); renderOverlay();
      await animateRoll(heldMaskBefore);
      if(destroyed || !state || !state.mp) return false;
      state.phase = 'awaitingPick';
      renderScorecard();
      renderControls();
    }
  } else if(move.t === 'hold'){
    if(state.rollsUsed<1 || state.rollsUsed>=3 || typeof move.i!=='number' || move.i<0 || move.i>4){
      agreed = false;
    } else {
      state.dice[move.i].held = !state.dice[move.i].held;
      renderDice(); renderScorecard();
    }
  } else if(move.t === 'commit'){
    const p = state.players[state.current];
    if(state.current !== remoteSeat() || !p || p.scores[move.cat]!=null ||
       !availableCategories(p.scores, state.dice).includes(move.cat)){
      agreed = false;
    } else {
      applyCommit(move.cat);
    }
  } else {
    agreed = false;
  }

  if(agreed) agreed = (stateHash(state) === entry.h);
  if(!agreed) return mpOnDivergence(seq);

  mp.appliedSeq = seq;
  mp.recoveryAttempts = 0;
  return true;
}

function mpOnDivergence(seq){
  const mp = state.mp;
  mp.recoveryAttempts = (mp.recoveryAttempts||0) + 1;
  if(mp.recoveryAttempts > MP_RECOVERY_MAX_ATTEMPTS){ mpEndDueToError(); return false; }
  mp.statusMsg = 'Resyncing…';
  if(mp.role === 'host'){
    mp.appliedSeq = seq;
    net.writeRecovery(mp.code, seq, mpSnapshot()).catch(()=>{});
    render();
    return true;
  }
  mp.awaitingRecovery = true;
  net.requestRecovery(mp.code, seq).catch(()=>{});
  render();
  return false;
}

// Deliberately absolute/seat-indexed: no localSeat-relative field is
// transmitted, so a receiver applies it unchanged regardless of which seat
// it is.
function mpSnapshot(){
  return {
    players: state.players.map(p => ({ name:p.name, scores:{...p.scores}, bonusTotal:p.bonusTotal||0 })),
    current: state.current,
    dice: state.dice.map(d => ({ value:d.value, held:d.held })),
    rollsUsed: state.rollsUsed,
    yahtzeeBonusCount: state.yahtzeeBonusCount.slice(),
    gameOver: state.gameOver,
  };
}
function applyMpSnapshot(snap){
  state.players[0].scores = {...snap.players[0].scores}; state.players[0].bonusTotal = snap.players[0].bonusTotal||0;
  state.players[1].scores = {...snap.players[1].scores}; state.players[1].bonusTotal = snap.players[1].bonusTotal||0;
  state.current = snap.current;
  state.dice.forEach((d,i)=>{ d.value = snap.dice[i].value; d.held = snap.dice[i].held; });
  state.rollsUsed = snap.rollsUsed;
  state.yahtzeeBonusCount = snap.yahtzeeBonusCount.slice();
  state.gameOver = snap.gameOver;
  state.phase = snap.gameOver ? 'gameOver' : 'idle';
  state.selected = null;
}

function mpRoomCallback(room){
  if(destroyed) return;
  mpLobbyRoom = room;
  if(state && state.mp){ mpOnRoomUpdate(room); return; }
  if(lobby) renderSetupScreen();
  if(lobby==='join' && mpJoinedCode && room && room.status==='active' && room.round){
    mpGuestStartMatch(room);
  }
}

function mpOnRoomUpdate(room){
  const mp = state && state.mp;
  if(!mp || !room) return;
  if(room.status==='ended' && !mp.opponentLeft){
    mp.opponentLeft = true;
    mpEndDueToOpponentLeft();
    return;
  }
  const roundN = room.round ? (room.round.n|0) : 0;
  if(roundN === 1){
    const entries = Object.values(room.moves||{});
    mp.movesById = new Map(entries.map(m=>[m.seq,m]));
    mp.maxKnownSeq = entries.reduce((mx,e)=>Math.max(mx, e.seq|0), 0);
    if(mp.delivering) mp.redeliverRequested = true;
    else mpTryDeliverNextMove();
  }
  if(room.recovery){
    if(mp.role==='host' && room.recovery.requested!=null && room.recovery.requested!==mp.lastRecoveryHandled){
      mp.lastRecoveryHandled = room.recovery.requested;
      net.writeRecovery(mp.code, mp.appliedSeq, mpSnapshot()).catch(()=>{});
    }
    if(mp.role==='guest' && room.recovery.state && room.recovery.seq!==mp.lastRecoveryApplied){
      mp.lastRecoveryApplied = room.recovery.seq;
      applyMpRecovery(room.recovery);
    }
  }
}

function applyMpRecovery(recovery){
  const mp = state && state.mp;
  if(!mp || destroyed || !recovery || !recovery.state) return;
  applyMpSnapshot(recovery.state);
  mp.appliedSeq = recovery.seq|0;
  mp.maxKnownSeq = Math.max(mp.maxKnownSeq|0, mp.appliedSeq);
  mp.recoveryAttempts = 0;
  mp.awaitingRecovery = false;
  mp.statusMsg = '';
  net.clearRecovery(mp.code).catch(()=>{});
  render();
  mpTryDeliverNextMove();
}

function mpEndDueToOpponentLeft(){
  if(!state || !state.mp) return;
  state.mp.ended = true;
  net.disconnect();
  renderMpEndOverlay('Your opponent left the game.');
}
function mpEndDueToError(){
  if(!state || !state.mp) return;
  state.mp.ended = true;
  net.leaveRoom(state.mp.code, state.mp.role).catch(()=>{});
  renderMpEndOverlay('Connection lost. The match could not continue.');
}
function renderMpEndOverlay(message){
  const overlay = $('overlay');
  if(!overlay) return;
  overlay.innerHTML = `
    <div class="yz-overlay-card">
      <div class="yz-overlay-title">Connection ended</div>
      <div class="yz-overlay-scores">${esc(message)}</div>
      <button class="yz-play-btn yz-on" id="mpBackToSetupBtn"><span class="yz-label">BACK</span></button>
    </div>`;
  overlay.classList.add('yz-show');
  $('mpBackToSetupBtn').addEventListener('click', () => { returnToSetup(); });
}

function returnToSetup(){
  net.disconnect();
  state = null;
  view = 'setup';
  mpMode = 'solo'; lobby = null; mpBusy = false; mpError = '';
  mpJoinCode = ''; mpPendingCode = null; mpJoinedCode = null; mpLobbyRoom = null;
  mountSetupScreen();
}

/* ---------- FEEDBACK / ANIMATION (spec 10.2, 10.3, 10.4) ---------- */
function showToast(text){
  const t = $('toast');
  if(!t) return;
  t.textContent = text;
  t.classList.add('yz-show');
  scheduleTimeout(()=>t.classList.remove('yz-show'), 1200);
}

function rowIndexForCategory(cat){
  const li = LEFT_CATS.indexOf(cat);
  if(li>=0) return li+1;
  return RIGHT_CATS.indexOf(cat)+1;
}

function tickerAnimate(idx, from, to){
  if(from===to) return;
  const el = $(idx===localSeat() ? 'p1total' : 'p2total');
  if(!el) return;
  const dur = reducedMotion() ? 30 : 450;
  let start = null;
  function step(ts){
    if(start===null) start = ts;
    const t = Math.min(1, (ts-start)/dur);
    const eased = 1 - Math.pow(1-t, 3);
    el.textContent = Math.round(from + (to-from)*eased);
    if(t<1) scheduleFrame(step);
    else el.textContent = to;
  }
  scheduleFrame(step);
}

// Score-commit: box flash, numeral bounce, header count-up ticker, row shimmer sweep (spec 10.2).
function animateCommitEffects(effects){
  const { cat, committedPlayer, beforeTotals, afterTotals, upperBonusFired, celebrate } = effects;

  [0,1].forEach(idx => tickerAnimate(idx, beforeTotals[idx], afterTotals[idx]));

  const meIdx = localSeat();
  const cell = committedPlayer===meIdx
    ? root.querySelector(`.yz-score-box[data-cat="${cat}"]`)
    : root.querySelector(`.yz-opp-num[data-cat="${cat}"]`);
  if(cell){
    const numEl = cell.querySelector('.yz-num') || cell;
    if(committedPlayer===meIdx) cell.classList.add('yz-flash');
    numEl.classList.add('yz-bounce');
    scheduleTimeout(()=>{ cell.classList.remove('yz-flash'); numEl.classList.remove('yz-bounce'); }, 600);

    const rowIdx = rowIndexForCategory(cat);
    const band = root.querySelectorAll('.yz-row-band')[rowIdx-1];
    if(band){
      band.classList.add('yz-shimmer');
      scheduleTimeout(()=>band.classList.remove('yz-shimmer'), 550);
    }
  }

  if(upperBonusFired) showToast('+35 BONUS!');
  if(celebrate) celebrateYahtzee();
}

function stageShake(){
  const el = $('shakeWrap');
  if(!el) return;
  const rm = reducedMotion();
  const dur = rm ? 30 : 380;
  const delay = rm ? 0 : 120;
  el.animate([
    { transform:'translate(0,0)' },
    { transform:'translate(5px,-3px)' },
    { transform:'translate(-5px,3px)' },
    { transform:'translate(4px,-4px)' },
    { transform:'translate(-4px,2px)' },
    { transform:'translate(2px,-2px)' },
    { transform:'translate(0,0)' }
  ], { duration:dur, delay, easing:'ease-in-out' });
}

const CONFETTI_COLORS = ['#FFC93C','#FE4B4B','#10AEEF','#7DBE3C','#FFFFFF','#C610A7'];
function spawnConfetti(){
  const layer = $('cel-confetti');
  if(!layer) return;
  layer.innerHTML = '';
  const g = 1150; // px/s^2
  const pieces = [];
  for(let i=0;i<70;i++){
    const el = document.createElement('div');
    el.className = 'yz-confetti-piece';
    const size = 6 + Math.random()*7;
    const rect = Math.random()<0.5;
    el.style.width = size+'px';
    el.style.height = (rect ? size*0.6 : size)+'px';
    el.style.background = CONFETTI_COLORS[Math.floor(Math.random()*CONFETTI_COLORS.length)];
    el.style.borderRadius = rect ? '2px' : '50%';
    layer.appendChild(el);
    pieces.push({
      el,
      vx:(Math.random()*2-1)*340,
      vy:-260 - Math.random()*360,
      rot: Math.random()*360,
      vrot:(Math.random()<0.5?-1:1)*(720*(0.5+Math.random())),
    });
  }
  const total = 2600;
  const start = performance.now();
  function frame(now){
    const t = (now-start)/1000; // seconds
    if(t*1000 > total){ layer.innerHTML=''; return; }
    const fadeStart = (total-500)/1000;
    const opacity = t>fadeStart ? Math.max(0, 1-(t-fadeStart)/0.5) : 1;
    pieces.forEach(p=>{
      const x = p.vx*t;
      const y = p.vy*t + 0.5*g*t*t;
      const rot = p.rot + p.vrot*t;
      p.el.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`;
      p.el.style.opacity = opacity;
    });
    scheduleFrame(frame);
  }
  scheduleFrame(frame);
}

// The YAHTZEE!! celebration set piece (spec 10.3): flash, rotating rays, gradient
// stroked text, 70-piece confetti burst, stage shake. Fires on every Yahtzee commit
// (first or bonus, local or remote). Also pulses the Yahtzee category icon gold.
function celebrateYahtzee(){
  const rm = reducedMotion();
  const flash = $('cel-flash');
  const rays = $('cel-rays');
  const text = $('cel-text');
  if(!flash || !rays || !text) return;
  [flash, rays, text].forEach(el=>{ el.classList.remove('yz-play'); void el.offsetWidth; el.classList.add('yz-play'); });

  if(!rm) spawnConfetti();
  stageShake();

  const icon = root.querySelector('.yz-cat-icon[data-cat="yahtzee"]');
  if(icon){
    icon.classList.remove('yz-pulse-gold'); void icon.offsetWidth; icon.classList.add('yz-pulse-gold');
    scheduleTimeout(()=>icon.classList.remove('yz-pulse-gold'), 1900);
  }

  const total = rm ? 300 : 2600;
  scheduleTimeout(()=>{ [flash, rays, text].forEach(el=>el.classList.remove('yz-play')); }, total+50);
}

/* ---------- Dice: real CSS 3D cubes ---------- */
const FACE_ROT = {
  1:{x:0,y:0}, 2:{x:-90,y:0}, 3:{x:0,y:-90}, 4:{x:0,y:90}, 5:{x:90,y:0}, 6:{x:0,y:180}
};

function buildDiceCubes(){
  for(let i=0;i<5;i++){
    const cube = $('cube'+i);
    let html = '';
    for(let f=1; f<=6; f++){
      html += `<div class="yz-face yz-f${f}">${pipFaceHTML(f)}</div>`;
    }
    cube.innerHTML = html;
    setDieFace(i, 1, true);
  }
}

function setDieFace(i, value, instant){
  const cube = $('cube'+i);
  const rot = FACE_ROT[value];
  if(instant){
    cube.style.transition = 'none';
    cube.style.transform = `rotateX(${rot.x}deg) rotateY(${rot.y}deg)`;
    void cube.offsetWidth;
    cube.style.transition = '';
  } else {
    cube.style.transform = `rotateX(${rot.x}deg) rotateY(${rot.y}deg)`;
  }
}

// Real 3D tumble per spec 10.1: launch, tumble (extra full spins + wobble + arc),
// drop (overshoot), squash. Held dice never spin. Staggered 55ms across dice index.
function animateRoll(heldMaskBefore){
  const rm = reducedMotion();
  const stagger = rm ? 5 : 55;
  const totalDur = rm ? 90 : 860;
  const promises = [];
  let lastLandAt = 0;

  state.dice.forEach((d,i)=>{
    if(heldMaskBefore[i]) return; // held dice don't animate/spin
    const delay = i*stagger;
    lastLandAt = Math.max(lastLandAt, delay+totalDur);

    const cube = $('cube'+i);
    const dieEl = $('dieWrap'+i);
    const shadow = dieEl.querySelector('.yz-die-shadow');
    const rot = FACE_ROT[d.value];
    const extraX = 360*(2+Math.floor(Math.random()*2));
    const extraY = 360*(2+Math.floor(Math.random()*2));
    const wobble = (Math.random()*14-7);

    promises.push(new Promise(resolve=>{
      scheduleTimeout(()=>{
        cube.style.transition = rm ? `transform ${totalDur*0.9}ms linear` : 'transform .72s cubic-bezier(.22,.8,.24,1)';
        cube.style.transform = `rotateX(${extraX+rot.x}deg) rotateY(${extraY+rot.y}deg)`;
        if(shadow) shadow.animate([
          { transform:'scale(1)', opacity:.4 },
          { transform:'scale(.55)', opacity:.22, offset:.5 },
          { transform:'scale(1)', opacity:.4 }
        ], { duration: totalDur, easing:'ease-out' });

        const anim = dieEl.animate([
          { transform:'translateY(0) scale(1)', offset:0 },
          { transform:'translateY(-22px) scale(1.14)', offset:0.105 },
          { transform:`translateY(-34px) translateX(${wobble}px) scale(1.14)`, offset:0.45 },
          { transform:'translateY(0) scale(1)', offset:0.907 },
          { transform:'scaleY(.86) scaleX(1.08)', offset:0.94 },
          { transform:'scale(1)', offset:1 }
        ], { duration: totalDur, easing:'cubic-bezier(.34,1.56,.64,1)' });

        anim.onfinish = ()=>{ cube.style.transition=''; resolve(); };
      }, delay);
    }));
  });

  if(promises.length){
    scheduleTimeout(trayShake, Math.max(0, lastLandAt-60));
  }
  return Promise.all(promises);
}

function trayShake(){
  const rm = reducedMotion();
  const dur = rm ? 20 : 180;
  state.dice.forEach((d,i)=>{
    const liftY = d.held ? -10 : 0;
    const el = $('dieWrap'+i);
    el.animate([
      { transform:`translate(0px, ${liftY}px)` },
      { transform:`translate(-2px, ${liftY}px)` },
      { transform:`translate(2px, ${liftY}px)` },
      { transform:`translate(0px, ${liftY}px)` }
    ], { duration:dur, easing:'ease-out' });
  });
}

/* ---------- RENDER: the game screen ---------- */
function pipIcon(n){
  const map = {
    1:['yz-p-c'], 2:['yz-p-tl','yz-p-br'], 3:['yz-p-tl','yz-p-c','yz-p-br'],
    4:['yz-p-tl','yz-p-tr','yz-p-bl','yz-p-br'], 5:['yz-p-tl','yz-p-tr','yz-p-c','yz-p-bl','yz-p-br'],
    6:['yz-p-tl','yz-p-tr','yz-p-ml','yz-p-mr','yz-p-bl','yz-p-br']
  };
  return `<div class="yz-pips">${map[n].map(c=>`<i class="${c}"></i>`).join('')}</div>`;
}

function sparkleSVG(x,y){
  return `<svg class="yz-sparkle yz-abs" style="left:${x}px;top:${y}px" viewBox="0 0 9 9">
    <path d="M4.5 0 L5.6 3.4 L9 4.5 L5.6 5.6 L4.5 9 L3.4 5.6 L0 4.5 L3.4 3.4 Z" fill="#fff"/>
  </svg>`;
}

function rightIcon(kind){
  switch(kind){
    case '3x': return `<span class="yz-xn">3<small>x</small></span>`;
    case '4x': return `<span class="yz-xn">4<small>x</small></span>`;
    case 'house': return `<div class="yz-house"></div>`;
    case 'small': return `<div class="yz-straight-fan"><div class="yz-card"></div><div class="yz-card"></div><div class="yz-card"></div><div class="yz-banner">SMALL</div></div>`;
    case 'large': return `<div class="yz-straight-fan"><div class="yz-card"></div><div class="yz-card"></div><div class="yz-card"></div><div class="yz-banner">LARGE</div></div>`;
    case 'yahtzee': return `<span class="yz-yahtzee-word">Yahtzee</span>`;
    case 'chance': return `<span class="yz-chance-q">?</span>`;
  }
  return '';
}

function pipFaceHTML(n){
  const positions = {
    1:[[28,28]],
    2:[[15,15],[41,41]],
    3:[[15,15],[28,28],[41,41]],
    4:[[15,15],[41,15],[15,41],[41,41]],
    5:[[15,15],[41,15],[28,28],[15,41],[41,41]],
    6:[[15,15],[41,15],[15,28],[41,28],[15,41],[41,41]]
  };
  return positions[n].map(([x,y])=>`<div class="yz-pip" style="left:${x-4.5}px;top:${y-4.5}px"></div>`).join('');
}

function render(){
  renderHeader();
  renderScorecard();
  renderDice();
  renderControls();
  renderOverlay();
}

function renderHeader(){
  const meIdx = localSeat(), themIdx = remoteSeat();
  const p1 = state.players[meIdx], p2 = state.players[themIdx];
  $('p1total').textContent = totalScore(p1);
  $('p2total').textContent = totalScore(p2);
  $('p1name').textContent = p1.name;
  $('p2name').textContent = p2.name;

  const pod1 = $('pod1'), pod2 = $('pod2');
  pod1.classList.toggle('yz-active', state.current===meIdx);
  pod1.classList.toggle('yz-idle', state.current!==meIdx);
  pod2.classList.toggle('yz-active', state.current===themIdx);
  pod2.classList.toggle('yz-idle', state.current!==themIdx);

  const myEmoji = readProfileEmoji();
  $('p1avatar').textContent = myEmoji || '\u{1F642}';
  $('p2avatar').textContent = state.mp ? (state.mp.opp.avatar || '\u{1F642}') : '\u{1F916}';

  const leaveBtn = $('mpLeaveBtn');
  if(leaveBtn) leaveBtn.hidden = !state.mp;
}

function renderScorecard(){
  const card = $('scorecard');
  const rowH = 66.5;
  const rowTop = i => (i-1)*rowH;

  let html = '';
  for(let i=1;i<=7;i++){
    const bg = (i % 2 === 1) ? 'var(--yz-row-a)' : 'var(--yz-row-b)';
    html += `<div class="yz-row-band" style="top:${rowTop(i)}px;background:${bg}"></div>`;
  }
  for(let i=1;i<=6;i++){
    const y = rowTop(i+1) - 2;
    html += `<div class="yz-groove" style="top:${y}px"><div class="yz-groove-d"></div><div class="yz-groove-l"></div></div>`;
  }
  html += `<div class="yz-col-rule" style="left:118px"></div>`;
  html += `<div class="yz-col-rule" style="left:307px"></div>`;
  html += `<div class="yz-center-divider" style="left:190px"></div>`;

  const meIdx = localSeat(), themIdx = remoteSeat();
  const p1 = state.players[meIdx], p2 = state.players[themIdx];
  const activeIdx = state.current;
  const activeScores = state.players[activeIdx].scores;
  const canPreview = state.rollsUsed>=1 && state.phase!=='gameOver';
  const avail = canPreview ? availableCategories(activeScores, state.dice) : [];

  function cell(cat, iconHTML, iconLeft, wide, boxLeft, oppLeft, i){
    const iconTop = rowTop(i) + 9.25;
    const boxTop = rowTop(i) + 9.75;
    let out = `<div class="yz-cat-icon ${wide?'yz-wide':''} yz-abs" data-cat="${cat}" style="left:${iconLeft}px;top:${iconTop}px">${iconHTML}</div>`;

    const p1Val = p1.scores[cat];
    const p2Val = p2.scores[cat];
    const isOpenForActive = avail.includes(cat);
    const previewVal = isOpenForActive ? previewScore(activeScores, cat, state.dice) : null;
    const isSelected = state.selected === cat;

    // Box slot: always the LOCAL viewer's committed score, never a preview column.
    if(p1Val != null){
      out += `<div class="yz-score-box yz-abs" data-cat="${cat}" style="left:${boxLeft}px;top:${boxTop}px"><span class="yz-num">${p1Val}</span></div>`;
    } else if(activeIdx===meIdx && isOpenForActive){
      out += `<div class="yz-score-box yz-abs yz-previewable ${isSelected?'yz-selected':''}" data-cat="${cat}" style="left:${boxLeft}px;top:${boxTop}px"><span class="yz-num ${isSelected?'':'yz-ghost'}">${previewVal}</span></div>`;
    } else {
      out += `<div class="yz-score-box yz-abs" data-cat="${cat}" style="left:${boxLeft}px;top:${boxTop}px"></div>`;
    }

    // Opponent numeral slot: always the REMOTE/opponent's committed score.
    if(p2Val != null){
      out += `<div class="yz-opp-num yz-abs" data-cat="${cat}" style="left:${oppLeft}px;top:${boxTop}px"><span class="yz-num">${p2Val}</span></div>`;
    } else if(activeIdx===themIdx && isOpenForActive){
      out += `<div class="yz-opp-num yz-abs yz-previewable ${isSelected?'yz-selected':''}" data-cat="${cat}" style="left:${oppLeft}px;top:${boxTop}px"><span class="yz-num ${isSelected?'':'yz-ghost-text'}">${previewVal}</span></div>`;
    } else {
      out += `<div class="yz-opp-num yz-abs" data-cat="${cat}" style="left:${oppLeft}px;top:${boxTop}px"></div>`;
    }
    return out;
  }

  LEFT_CATS.forEach((cat,idx)=>{
    const i = idx+1;
    html += cell(cat, pipIcon(i), 7, false, 69, 120, i);
  });
  RIGHT_CATS.forEach((cat,idx)=>{
    const i = idx+1;
    html += cell(cat, rightIcon(RIGHT_ICON_KIND[cat]), 196, true, 258, 309, i);
  });

  // THE SECTION BONUS, shown at last (2026-08-11). The maths has always been here
  // (upperBonus(): 63 in the upper column earns 35) and a "+35 BONUS!" toast fired when it
  // landed -- but the card never showed the target or how close either player was, so the one
  // thing worth playing for in the upper column was invisible until the moment it was already
  // won. The reference how-to's sixth page is entirely about this rule, which is what surfaced
  // the gap. It goes in row 7's left half, the one cell on this card that was empty (six upper
  // categories, seven rows), and follows the card's own box-vs-numeral contract: the pill in the
  // box column is the LOCAL viewer's progress, the one in the numeral column is the opponent's.
  {
    const bTop = rowTop(7);
    const mine = upperSum(p1.scores), theirs = upperSum(p2.scores);
    const pill = (val, left) => {
      const got = val >= 63;
      return `<div class="yz-bonus-pill ${got ? 'yz-bonus-got' : ''} yz-abs" style="left:${left}px;top:${bTop + 22}px">`
        + `<span class="yz-num">${val}/63</span></div>`;
    };
    // The label STACKS. Laid out side by side it ran to ~94px and the first pill (which has to
    // sit at 63, the box column's own x, to keep the box-vs-numeral contract) covered the "+35".
    html += `<div class="yz-bonus-lab yz-abs" style="left:7px;top:${bTop + 10}px">`
      + `<span class="yz-bonus-cap">SECTION<br>BONUS</span>`
      + `<span class="yz-bonus-plus ${(mine >= 63 || theirs >= 63) ? 'yz-bonus-got' : ''}">+35</span></div>`;
    html += pill(mine, 63);
    html += pill(theirs, 114);
  }

  html += sparkleSVG(363-16, 383-12);
  html += sparkleSVG(404-16, 372-12);

  card.innerHTML = html;
}

function renderDice(){
  state.dice.forEach((d,i)=>{
    setDieFace(i, d.value, true);
    $('dieWrap'+i).classList.toggle('yz-held', d.held);
  });
}

function renderControls(){
  const rollBtn = $('rollBtn');
  const canRoll = isHumanTurn() && state.rollsUsed<3 && state.phase!=='gameOver';
  rollBtn.classList.toggle('yz-disabled', !canRoll);
  rollBtn.disabled = !canRoll;

  for(let i=1;i<=3;i++){
    const pip = $('rollPip'+i);
    const lit = state.rollsUsed>=i;
    pip.classList.toggle('yz-lit', lit);
    pip.classList.toggle('yz-dim', !lit);
  }

  const playBtn = $('playBtn');
  const canPlay = isHumanTurn() && !!state.selected && state.phase!=='gameOver';
  playBtn.classList.toggle('yz-on', canPlay);
  playBtn.classList.toggle('yz-off', !canPlay);
  playBtn.disabled = !canPlay;
}

function renderOverlay(){
  const overlay = $('overlay');
  if(state.phase!=='gameOver'){
    overlay.classList.remove('yz-show');
    overlay.innerHTML = '';
    return;
  }
  const meIdx = localSeat(), themIdx = remoteSeat();
  const p1 = state.players[meIdx], p2 = state.players[themIdx];
  const t1 = totalScore(p1), t2 = totalScore(p2);
  const winner = t1===t2 ? 'Tie game' : (t1>t2 ? (p1.name+' wins!') : (p2.name+' wins!'));
  const playAgainLabel = state.mp ? 'BACK TO SETUP' : 'PLAY AGAIN';
  overlay.innerHTML = `
    <div class="yz-overlay-card">
      <div class="yz-overlay-title">${esc(winner)}</div>
      <div class="yz-overlay-scores">${esc(p1.name)}: ${t1}<br>${esc(p2.name)}: ${t2}</div>
      <button class="yz-play-btn yz-on" id="playAgainBtn"><span class="yz-label">${playAgainLabel}</span></button>
    </div>`;
  overlay.classList.add('yz-show');
  $('playAgainBtn').addEventListener('click', ()=>{
    if(state.mp){ if(state.mp.code) net.leaveRoom(state.mp.code, state.mp.role).catch(()=>{}); returnToSetup(); return; }
    newGame();
    render();
  });
}

function fitStage(){
  const scale = Math.min(window.innerWidth/410, window.innerHeight/730);
  const fit = $('fit');
  if(fit) fit.style.transform = `scale(${scale})`;
}

/* ---------- SETUP / LOBBY SCREEN ---------- */
function setupHeadHTML(){
  return `
    <div class="yz-setup-title">Yahtzee</div>
    <div class="yz-seg" data-role="mode-seg">
      <button type="button" class="yz-seg-btn ${mpMode==='solo'?'yz-seg-active':''}" data-mode="solo">Vs Computer</button>
      <button type="button" class="yz-seg-btn ${mpMode==='host'?'yz-seg-active':''}" data-mode="host">Host Online</button>
      <button type="button" class="yz-seg-btn ${mpMode==='join'?'yz-seg-active':''}" data-mode="join">Join Online</button>
    </div>`;
}

function joinBodyHTML(){
  const msg = mpError || (mpBusy ? 'Joining…' : 'Enter the 4-character code your friend shared.');
  return `<div class="yz-mp-lobby">
    <span class="yz-mp-label">Room code</span>
    <input class="yz-mp-code-input" data-role="mp-code-input" maxlength="${MP_CODE_LEN}" value="${esc(mpJoinCode)}"
      autocapitalize="characters" autocomplete="off" spellcheck="false" aria-label="Room code">
    <p class="yz-mp-msg" data-role="mp-msg">${esc(msg)}</p>
    <button type="button" class="yz-setup-btn yz-setup-btn-primary" data-action="mp-join-submit">Join</button>
  </div>`;
}

function lobbyHTML(){
  const back = `<button type="button" class="yz-setup-btn yz-setup-btn-ghost" data-action="mp-cancel">Back</button>`;
  if(lobby === 'host'){
    const room = mpLobbyRoom;
    const guest = room && room.guest;
    const code = mpPendingCode;
    const msg = mpError || (mpBusy ? 'Creating room…' : 'Share this code with a friend.');
    return `<div class="yz-mp-lobby">
      <span class="yz-mp-label">Room code</span>
      <div class="yz-mp-code">${code ? esc(code) : '····'}</div>
      <span class="yz-mp-label">Opponent</span>
      <div class="yz-mp-oppslot">${guest
        ? `<span class="yz-mp-oppav">${esc(guest.avatar||'\u{1F642}')}</span><span class="yz-mp-oppname">${esc(guest.name||'')}</span>`
        : `<span class="yz-mp-oppempty">Waiting for someone to join…</span>`}</div>
      <p class="yz-mp-msg" data-role="mp-msg">${esc(msg)}</p>
      <button type="button" class="yz-setup-btn yz-setup-btn-primary" data-action="mp-start" ${guest?'':'disabled'}>Start Match</button>
      ${back}
    </div>`;
  }
  const room = mpLobbyRoom;
  const host = room && room.host;
  return `<div class="yz-mp-lobby">
    <span class="yz-mp-label">Room code</span>
    <div class="yz-mp-code">${esc(mpJoinedCode||'')}</div>
    <span class="yz-mp-label">Host</span>
    <div class="yz-mp-oppslot">${host
      ? `<span class="yz-mp-oppav">${esc(host.avatar||'\u{1F642}')}</span><span class="yz-mp-oppname">${esc(host.name||'')}</span>`
      : `<span class="yz-mp-oppempty">—</span>`}</div>
    <p class="yz-mp-msg" data-role="mp-msg">Waiting for the host to start the match…</p>
    ${back}
  </div>`;
}

function setupScreenHTML(){
  if(lobby) return `<div class="yz-setup">${setupHeadHTML()}${lobbyHTML()}</div>`;
  if(mpMode === 'join') return `<div class="yz-setup">${setupHeadHTML()}${joinBodyHTML()}</div>`;
  const hosting = mpMode === 'host';
  return `<div class="yz-setup">${setupHeadHTML()}
    ${hosting
      ? `<p class="yz-mp-msg">${esc(mpError || (mpBusy?'Creating room…':'Create a room and share the code with a friend.'))}</p>
         <button type="button" class="yz-setup-btn yz-setup-btn-primary" data-action="mp-host" ${mpBusy?'disabled':''}>Create Room</button>`
      : `<button type="button" class="yz-setup-btn yz-setup-btn-primary" data-action="start-solo">Play</button>`}
    <button type="button" class="yz-howto-link" data-action="howto">How to play</button>
  </div>`;
}

function renderSetupScreen(){
  if(!screenHost) return;
  screenHost.innerHTML = setupScreenHTML();
}

function mountSetupScreen(){
  screenHost.innerHTML = setupScreenHTML();
}

function mountGameScreen(){
  screenHost.innerHTML = GAME_MARKUP;
  buildDiceCubes();
  resizeHandler = () => { fitStage(); if(howTo) howTo.refit(); };
  offViewport = onViewportResize(resizeHandler);
  fitStage();
  const leaveBtn = $('mpLeaveBtn');
  if(leaveBtn) leaveBtn.hidden = !(state && state.mp);
}

/* ---------- INPUT (delegated on the persistent root) ---------- */
function wireInput(){
  root.addEventListener('click', onRootClick);
  root.addEventListener('input', onRootInput);
  // Combo info. Bound to the game's OWN root, never document (root CLAUDE.md's scroll/touch
  // rules), and pointer events rather than touch so a mouse and a finger behave the same.
  root.addEventListener('pointerdown', onRootPointerDown);
  root.addEventListener('pointerup', onRootPointerEnd);
  root.addEventListener('pointercancel', onRootPointerEnd);
  root.addEventListener('pointerleave', onRootPointerEnd);
}

function onRootPointerDown(e){
  if(howTo && howTo.isOpen()) return;
  const icon = e.target.closest('.yz-cat-icon[data-cat]');
  if(!icon) return;
  catHoldFired = false;
  clearTimeout(catHoldTimer);
  catHoldTimer = setTimeout(() => {
    catHoldFired = true;
    showCatInfo(icon.dataset.cat, icon);
  }, CAT_HOLD_MS);
}

function onRootPointerEnd(){
  clearTimeout(catHoldTimer);
  catHoldTimer = null;
  if(catHoldFired) hideCatInfo();
}

function onRootInput(e){
  const el = e.target.closest('[data-role="mp-code-input"]');
  if(!el) return;
  const clean = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, MP_CODE_LEN);
  if(el.value !== clean) el.value = clean;
  mpJoinCode = clean;
  if(mpError){ mpError = ''; }
  const msgEl = screenHost.querySelector('[data-role="mp-msg"]');
  if(msgEl) msgEl.textContent = 'Enter the 4-character code your friend shared.';
  if(clean.length === MP_CODE_LEN) mpJoinSubmit();
}

function onRootClick(e){
  // --- how to play: checked FIRST. The sheet covers the whole screen, so a tap inside it must
  //     never fall through to the board or the setup screen underneath. ---
  if(howTo){
    if(e.target.closest('[data-action="ht-close"]')){ howTo.close(); return; }
    if(e.target.closest('[data-action="ht-next"]')){ howTo.next(); return; }
    if(e.target.closest('[data-action="ht-first"]')){ howTo.first(); return; }
    if(e.target.closest('[data-action="howto"]')){ howTo.open(0); return; }
    if(howTo.isOpen()) return;
  }

  // --- setup screen actions ---
  const modeBtn = e.target.closest('[data-mode]');
  if(modeBtn && view==='setup' && !lobby){
    mpMode = modeBtn.dataset.mode;
    mpError = '';
    renderSetupScreen();
    return;
  }
  const startSolo = e.target.closest('[data-action="start-solo"]');
  if(startSolo){
    newGame();
    view = 'game';
    mountGameScreen();
    render();
    return;
  }
  if(e.target.closest('[data-action="mp-host"]')){ mpHostCreate(); return; }
  if(e.target.closest('[data-action="mp-join-submit"]')){ mpJoinSubmit(); return; }
  if(e.target.closest('[data-action="mp-start"]')){ mpHostStartMatch(); return; }
  if(e.target.closest('[data-action="mp-cancel"]')){
    if(mpPendingCode) net.leaveRoom(mpPendingCode, lobby==='host'?'host':'guest').catch(()=>{});
    else net.disconnect();
    lobby = null; mpMode = 'solo'; mpError = '';
    mpPendingCode = null; mpJoinedCode = null; mpLobbyRoom = null;
    renderSetupScreen();
    return;
  }

  // --- game screen actions ---
  if(!state) return;
  if(e.target.closest('#rollBtn')){
    if(!isHumanTurn() || state.rollsUsed>=3 || state.phase==='gameOver') return;
    doRoll();
    return;
  }
  if(e.target.closest('#playBtn')){
    if(!isHumanTurn() || !state.selected) return;
    commitSelection();
    return;
  }
  if(e.target.closest('#mpLeaveBtn')){
    if(state.mp && state.mp.code) net.leaveRoom(state.mp.code, state.mp.role).catch(()=>{});
    returnToSetup();
    return;
  }
  const dieEl = e.target.closest('.yz-die');
  if(dieEl){
    const dice = [...root.querySelectorAll('.yz-die')];
    const i = dice.indexOf(dieEl);
    if(i>=0 && isHumanTurn()) toggleHold(i);
    return;
  }
  const catEl = e.target.closest('[data-cat]');
  if(catEl){
    // A hold that already opened the info popover must not ALSO commit to picking that
    // category on the click that follows the release.
    if(catHoldFired){ catHoldFired = false; return; }
    if(isHumanTurn()) selectCategory(catEl.dataset.cat);
  }
}

function ensureCss(){
  const href = new URL('../css/yahtzee.css', import.meta.url).href;
  if (![...document.styleSheets].some(s => s.href === href) &&
      !document.querySelector(`link[href="${href}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }
  const fontHref = 'https://fonts.googleapis.com/css2?family=Baloo+2:wght@700;800&family=Luckiest+Guy&display=swap';
  if (!document.querySelector(`link[href="${fontHref}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = fontHref;
    document.head.appendChild(link);
  }
}

export function init(container){
  if(!destroyed) destroy();
  destroyed = false;

  ensureCss();
  // The how-to sheet lives on the PERSISTENT root, not inside #screenHost: screenHost's innerHTML
  // is replaced wholesale every time the game swaps between the setup screen and the board, and a
  // sheet mounted in there would be destroyed mid-read. It is position:fixed, so where it sits in
  // the tree costs nothing.
  container.innerHTML = `<div class="yz-root"><div id="screenHost"></div>${howToHtml()}</div>`;
  root = container.querySelector('.yz-root');
  screenHost = root.querySelector('#screenHost');
  howTo = createHowTo(root);

  view = 'setup'; mpMode = 'solo'; lobby = null; mpBusy = false; mpError = '';
  mpJoinCode = ''; mpPendingCode = null; mpJoinedCode = null; mpLobbyRoom = null;
  mountSetupScreen();
  wireInput();

  // Dev/test seam only — not part of the visible game. Lets the verification
  // harness drive deterministic rounds (forced dice) without real randomness
  // or AI timing, so scoring math can be asserted headlessly. For MP tests,
  // exposes the internal move-apply pipeline directly (see __yzTest.mp*).
  window.__yzTest = {
    getState: () => state,
    render, newGame, doRoll, toggleHold, selectCategory, commitSelection, endTurn,
    categoryScore, previewScore, availableCategories, totalScore, upperSum, upperBonus,
    isGameOver, aiChooseHolds, pickCategoryForAI, localSeat, remoteSeat,
    startSolo(){
      newGame();
      view = 'game';
      mountGameScreen();
      render();
    },
    forceDice(values){
      values.forEach((v,i)=>{ if(!state.dice[i].held) state.dice[i].value = v; });
      state.rollsUsed = Math.max(state.rollsUsed, 1);
      state.selected = null;
      state.phase = 'awaitingPick';
      render();
    },
    CATEGORIES, UPPER_KEYS, LEFT_CATS, RIGHT_CATS
  };
}

export function destroy(){
  destroyed = true;
  if(offViewport){ offViewport(); offViewport = null; } resizeHandler = null;
  pendingTimeouts.forEach(id => clearTimeout(id));
  pendingTimeouts.clear();
  pendingFrames.forEach(id => cancelAnimationFrame(id));
  pendingFrames.clear();

  // MP: leaving always ends the room cleanly for both sides (no autosave/
  // rejoin window in this game — see the module header for why).
  if(state && state.mp && state.mp.code){
    net.leaveRoom(state.mp.code, state.mp.role).catch(()=>{});
  } else if(lobby && mpPendingCode){
    net.leaveRoom(mpPendingCode, lobby==='host'?'host':'guest').catch(()=>{});
  } else {
    net.disconnect();
  }

  if(howTo){ howTo.destroy(); howTo = null; }
  clearTimeout(catHoldTimer); catHoldTimer = null; catHoldFired = false;
  if(root){
    root.removeEventListener('click', onRootClick);
    root.removeEventListener('input', onRootInput);
    root.removeEventListener('pointerdown', onRootPointerDown);
    root.removeEventListener('pointerup', onRootPointerEnd);
    root.removeEventListener('pointercancel', onRootPointerEnd);
    root.removeEventListener('pointerleave', onRootPointerEnd);
  }
  if(root && root.parentElement) root.parentElement.innerHTML = '';
  root = null; screenHost = null;
  state = null;
  view = 'setup'; lobby = null; mpPendingCode = null; mpJoinedCode = null; mpLobbyRoom = null;
  delete window.__yzTest;
}

export function isInProgress(){
  if(destroyed) return false;
  if(lobby) return true;             // mid-lobby: leaving abandons a room the other side may have joined
  if(state && state.mp) return state.phase !== 'gameOver' && !state.mp.ended;
  return hasProgress() && !!state && state.phase !== 'gameOver';
}

export default { init, destroy, isInProgress };
