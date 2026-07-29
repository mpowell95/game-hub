// hash.js — FNV-1a state hash for Yahtzee's MP lockstep, same construction as
// chinchon/js/hash.js and tic-tac-toe/js/hash.js. Covers only the objectively
// SHARED truth both devices must agree on: dice values/held, both players'
// scores + bonusTotal, whose turn it is, and rolls used this turn. Deliberately
// excludes `phase` and `selected` — those are local UI state (which category a
// player is currently previewing is never synced, only the eventual commit is).

function fnv1a(str){
  let h = 0x811c9dc5;
  for(let i=0;i<str.length;i++){
    h ^= str.charCodeAt(i);
    h = (h + ((h<<1) + (h<<4) + (h<<7) + (h<<8) + (h<<24))) >>> 0;
  }
  return h >>> 0;
}

function canonicalScores(scores){
  return Object.keys(scores).sort().map(k => `${k}:${scores[k]}`).join(',');
}

export function canonicalState(state){
  const dice = state.dice.map(d => `${d.value}${d.held?'h':'-'}`).join('');
  const p0 = state.players[0], p1 = state.players[1];
  return [
    'd', dice,
    'c', state.current,
    'r', state.rollsUsed,
    'p0s', canonicalScores(p0.scores), 'p0b', p0.bonusTotal||0,
    'p1s', canonicalScores(p1.scores), 'p1b', p1.bonusTotal||0,
  ].join('|');
}

export function stateHash(state){
  return fnv1a(canonicalState(state));
}

export default { stateHash, canonicalState };
