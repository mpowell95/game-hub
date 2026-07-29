'use strict';

// Hub module contract: init(container) / destroy() / isInProgress().
// isInProgress() uses the "no mid-game resume" meaning (same as Ball Run/Snake):
// true while a game is actually live, false once it's over or hasn't started —
// there is no autosave/resume here, so leaving mid-game is a real abandonment.

const MODE = 'ai'; // 'ai' | 'hotseat'

const UPPER_KEYS = ['ones','twos','threes','fours','fives','sixes'];
const LEFT_CATS = UPPER_KEYS;
const RIGHT_CATS = ['threeKind','fourKind','fullHouse','smallStraight','largeStraight','yahtzee','chance'];
const CATEGORIES = [...LEFT_CATS, ...RIGHT_CATS];
const RIGHT_ICON_KIND = {
  threeKind:'3x', fourKind:'4x', fullHouse:'house',
  smallStraight:'small', largeStraight:'large', yahtzee:'yahtzee', chance:'chance'
};

const MARKUP = `
<div id="fit">
<div id="shakeWrap">
<div id="stage">

  <div class="yz-hdr">
    <svg class="yz-chevron yz-abs" viewBox="0 0 12 20"><path d="M10 2 L2 10 L10 18" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>

    <div class="yz-pod yz-p1 yz-active" id="pod1">
      <div class="yz-avatar" id="p1avatar">&#128578;</div>
      <div class="yz-pod-total" id="p1total">0</div>
      <div class="yz-pod-name" id="p1name">You</div>
    </div>

    <div class="yz-pod yz-p2 yz-idle" id="pod2">
      <div class="yz-pod-total" id="p2total">0</div>
      <div class="yz-pod-name" id="p2name">Computer</div>
      <div class="yz-avatar" id="p2avatar">&#129302;</div>
    </div>

    <div class="yz-kebab yz-abs"><span></span><span></span><span></span></div>
  </div>

  <div class="yz-rule-gold"></div>
  <div class="yz-rule-amber"></div>
  <div class="yz-rule-orange"></div>

  <div class="yz-playfield">
    <div class="yz-frame"></div>
    <div class="yz-scorecard" id="scorecard"></div>
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
let destroyed = true;     // true whenever no live instance is mounted
let resizeHandler = null;
let pendingTimeouts = new Set();
let pendingFrames = new Set();

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

function newGame(){
  state = {
    players: [
      { name:'You', scores:{}, bonusTotal:0 },
      { name: MODE==='ai' ? 'Computer' : 'Player 2', scores:{}, bonusTotal:0 }
    ],
    current: 0,
    dice: [0,0,0,0,0].map(() => ({ value:1, held:false })),
    rollsUsed: 0,
    selected: null,
    phase: 'idle',
    yahtzeeBonusCount: [0,0],
    gameOver: false
  };
}

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
function isHumanTurn(){ return MODE==='hotseat' || state.current===0; }
function reducedMotion(){
  return typeof window.matchMedia==='function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

async function doRoll(){
  if(state.phase==='gameOver' || state.rollsUsed>=3) return;
  const heldMask = state.dice.map(d=>d.held);
  state.dice.forEach(d=>{ if(!d.held) d.value = 1+Math.floor(Math.random()*6); });
  state.rollsUsed++;
  state.selected = null;
  state.phase = 'rolling';
  renderHeader(); renderScorecard(); renderControls(); renderOverlay();
  await animateRoll(heldMask);
  if(destroyed) return;
  state.phase = 'awaitingPick';
  renderScorecard(); // ghost previews now that rollsUsed>=1
  renderControls();
}

function toggleHold(i){
  if(state.rollsUsed<1 || state.rollsUsed>=3 || state.phase==='gameOver') return;
  state.dice[i].held = !state.dice[i].held;
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

function selectCategory(cat){
  if(state.rollsUsed<1 || state.phase==='gameOver') return;
  const avail = availableCategories(state.players[state.current].scores, state.dice);
  if(!avail.includes(cat)) return;
  state.selected = cat;
  render();
}

function commitSelection(){
  if(state.phase==='gameOver' || !state.selected) return;
  const cat = state.selected;
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

function endTurn(effects){
  state.selected = null;
  state.dice.forEach(d=>{ d.held=false; });
  state.rollsUsed = 0;

  const gameOver = isGameOver();
  if(gameOver){
    state.phase = 'gameOver';
    state.gameOver = true;
  } else {
    state.current = 1 - state.current;
    state.phase = 'idle';
  }

  render();
  if(!gameOver){
    const incomingPod = $(state.current===0 ? 'pod1' : 'pod2');
    incomingPod.classList.add('yz-pulse');
    scheduleTimeout(()=>incomingPod.classList.remove('yz-pulse'), 300);
  }
  if(effects) animateCommitEffects(effects);

  if(!gameOver && MODE==='ai' && state.current===1){
    scheduleTimeout(aiTakeTurn, 700);
  }
}

/* ---------- AI ---------- */
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
  if(destroyed || state.current!==1 || state.phase==='gameOver') return;
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

/* ---------- FEEDBACK / ANIMATION (spec 10.2, 10.3, 10.4) ---------- */
function showToast(text){
  const t = $('toast');
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
  const el = $(idx===0 ? 'p1total' : 'p2total');
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

  const cell = committedPlayer===0
    ? root.querySelector(`.yz-score-box[data-cat="${cat}"]`)
    : root.querySelector(`.yz-opp-num[data-cat="${cat}"]`);
  if(cell){
    const numEl = cell.querySelector('.yz-num') || cell;
    if(committedPlayer===0) cell.classList.add('yz-flash');
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
// (first or bonus). Also pulses the Yahtzee category icon gold.
function celebrateYahtzee(){
  const rm = reducedMotion();
  const flash = $('cel-flash');
  const rays = $('cel-rays');
  const text = $('cel-text');
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

/* ---------- RENDER ---------- */
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

function renderHeader(){
  const p1 = state.players[0], p2 = state.players[1];
  $('p1total').textContent = totalScore(p1);
  $('p2total').textContent = totalScore(p2);
  $('p1name').textContent = p1.name;
  $('p2name').textContent = p2.name;

  const pod1 = $('pod1'), pod2 = $('pod2');
  pod1.classList.toggle('yz-active', state.current===0);
  pod1.classList.toggle('yz-idle', state.current!==0);
  pod2.classList.toggle('yz-active', state.current===1);
  pod2.classList.toggle('yz-idle', state.current!==1);

  const myEmoji = readProfileEmoji();
  $('p1avatar').textContent = myEmoji || '\u{1F642}';
  $('p2avatar').textContent = '\u{1F916}';
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

  const p1 = state.players[0], p2 = state.players[1];
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

    // Box slot: always Player 1's committed score, never a preview column.
    if(p1Val != null){
      out += `<div class="yz-score-box yz-abs" data-cat="${cat}" style="left:${boxLeft}px;top:${boxTop}px"><span class="yz-num">${p1Val}</span></div>`;
    } else if(activeIdx===0 && isOpenForActive){
      out += `<div class="yz-score-box yz-abs yz-previewable ${isSelected?'yz-selected':''}" data-cat="${cat}" style="left:${boxLeft}px;top:${boxTop}px"><span class="yz-num ${isSelected?'':'yz-ghost'}">${previewVal}</span></div>`;
    } else {
      out += `<div class="yz-score-box yz-abs" data-cat="${cat}" style="left:${boxLeft}px;top:${boxTop}px"></div>`;
    }

    // Opponent numeral slot: always Player 2's committed score, never Player 1's.
    if(p2Val != null){
      out += `<div class="yz-opp-num yz-abs" data-cat="${cat}" style="left:${oppLeft}px;top:${boxTop}px"><span class="yz-num">${p2Val}</span></div>`;
    } else if(activeIdx===1 && isOpenForActive){
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
  const p1 = state.players[0], p2 = state.players[1];
  const t1 = totalScore(p1), t2 = totalScore(p2);
  const winner = t1===t2 ? 'Tie game' : (t1>t2 ? (p1.name+' wins!') : (p2.name+' wins!'));
  overlay.innerHTML = `
    <div class="yz-overlay-card">
      <div class="yz-overlay-title">${winner}</div>
      <div class="yz-overlay-scores">${p1.name}: ${t1}<br>${p2.name}: ${t2}</div>
      <button class="yz-play-btn yz-on" id="playAgainBtn"><span class="yz-label">PLAY AGAIN</span></button>
    </div>`;
  overlay.classList.add('yz-show');
  $('playAgainBtn').addEventListener('click', ()=>{
    newGame();
    render();
  });
}

function fitStage(){
  const scale = Math.min(window.innerWidth/410, window.innerHeight/730);
  $('fit').style.transform = `scale(${scale})`;
}

function wireInput(){
  $('rollBtn').addEventListener('click', ()=>{
    if(!isHumanTurn() || state.rollsUsed>=3 || state.phase==='gameOver') return;
    doRoll();
  });
  $('playBtn').addEventListener('click', ()=>{
    if(!isHumanTurn() || !state.selected) return;
    commitSelection();
  });
  root.querySelectorAll('.yz-die').forEach((el,i)=>{
    el.addEventListener('click', ()=>{ if(isHumanTurn()) toggleHold(i); });
  });
  $('scorecard').addEventListener('click', e=>{
    const el = e.target.closest('[data-cat]');
    if(!el || !isHumanTurn()) return;
    selectCategory(el.dataset.cat);
  });
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
  container.innerHTML = `<div class="yz-root">${MARKUP}</div>`;
  root = container.querySelector('.yz-root');

  buildDiceCubes();
  newGame();
  wireInput();
  render();

  resizeHandler = fitStage;
  window.addEventListener('resize', resizeHandler);
  fitStage();

  // Dev/test seam only — not part of the visible game. Lets the verification
  // harness drive deterministic rounds (forced dice) without real randomness
  // or AI timing, so scoring math can be asserted headlessly.
  window.__yzTest = {
    getState: () => state,
    render, newGame, doRoll, toggleHold, selectCategory, commitSelection, endTurn,
    categoryScore, previewScore, availableCategories, totalScore, upperSum, upperBonus,
    isGameOver, aiChooseHolds, pickCategoryForAI,
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
  if(resizeHandler){ window.removeEventListener('resize', resizeHandler); resizeHandler = null; }
  pendingTimeouts.forEach(id => clearTimeout(id));
  pendingTimeouts.clear();
  pendingFrames.forEach(id => cancelAnimationFrame(id));
  pendingFrames.clear();
  if(root && root.parentElement) root.parentElement.innerHTML = '';
  root = null;
  state = null;
  delete window.__yzTest;
}

export function isInProgress(){
  return !destroyed && hasProgress() && !!state && state.phase !== 'gameOver';
}

export default { init, destroy, isInProgress };
