// ai.js - Boggle's "AI". Pure, no DOM, no search of its own: solver.js has
// already exhaustively found every word on the board, so the opponent is
// just a difficulty-scaled SAMPLE of that output, never an invented word.
//
// Tiers (repo's shared beginner/intermediate/pro vocabulary):
//   Beginner     ~20% of found words, biased toward 3-4 letter words.
//   Intermediate ~45% of found words, unbiased.
//   Pro          ~70% of found words, biased toward longer/higher-scoring words.
//
// Sampling is a weighted-without-replacement selection (Efraimidis-Spirakis
// A-ES: give every candidate a key = rng()^(1/weight), keep the top N by
// key) rather than a simple biased coin flip per word, so the exact
// percentage of the pool taken always matches the tier's target regardless
// of the board's word-length mix. It's deterministic given `rng`, so
// test.js can seed it and assert Beginner < Intermediate < Pro in expected
// score on the same board.
//
// KNOWN LIMITATION (documented per the build handoff, not fixed this
// milestone): ENABLE is a large Scrabble-grade word list, so at Pro the AI
// can end up scoring on words a human would never plausibly find (obscure
// 7-9 letter entries). The length/score bias below is a reasonable proxy for
// "plays a strong game" for now; the clean fix is a second, smaller
// "common words" list for the AI to draw from while the full ENABLE list
// still validates human-typed finds -- that is future work, not this pass.

import { scoreForWord } from './game.js';

export const TIER_PCT = { beginner: 0.20, intermediate: 0.45, pro: 0.70 };

const TIER_WEIGHT = {
  beginner: (entry) => (entry.word.length <= 4 ? 4 : 1),
  intermediate: () => 1,
  pro: (entry) => entry.score,
};

/** Weighted sample of `count` items from `entries` without replacement,
 *  using per-entry `weight(entry)`. Deterministic given `rng`. */
function weightedSample(entries, count, weight, rng) {
  const keyed = entries.map((entry) => ({
    entry,
    key: Math.pow(rng(), 1 / Math.max(weight(entry), 1e-6)),
  }));
  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, count).map((k) => k.entry);
}

/** Pick the AI's found words for this round from the solver's full list.
 *  `solved` is solver.js's `{ word, path, score }[]`. Every returned entry
 *  is a real element of `solved` (same object reference) -- the AI can
 *  never invent a word that is not a genuine solver hit. */
export function selectAiWords(solved, tier, rng = Math.random) {
  if (!solved.length) return [];
  const pct = TIER_PCT[tier] ?? TIER_PCT.intermediate;
  const weight = TIER_WEIGHT[tier] || TIER_WEIGHT.intermediate;
  const count = Math.min(solved.length, Math.round(pct * solved.length));
  if (count <= 0) return [];
  if (count >= solved.length) return solved.slice();
  return weightedSample(solved, count, weight, rng);
}

export function totalScore(entries) {
  return entries.reduce((sum, e) => sum + scoreForWord(e.word), 0);
}

export default { TIER_PCT, selectAiWords, totalScore };
