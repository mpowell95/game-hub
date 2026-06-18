// test.js — headless test runner for the Connect Four engine.
//
// Run with:  node js/test.js   (from the connect-four/ folder)
//        or:  npm test
//
// Exits with code 0 if every Board and Game test passes, 1 otherwise — so it
// can be wired into CI later. No UI / browser required.

import { Board } from './board.js';
import { Game } from './game.js';
import { AI } from './ai.js';

console.log('=== Connect Four engine — headless tests ===\n');

const boardOk = Board.test();
console.log('');
const gameOk = Game.test();
console.log('');
const aiOk = AI.test();

const allOk = boardOk && gameOk && aiOk;
console.log(`\n=== Overall: ${allOk ? 'ALL PASS' : 'FAILURES PRESENT'} ===`);

process.exit(allOk ? 0 : 1);
