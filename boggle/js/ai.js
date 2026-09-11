// ai.js - Boggle's "AI". Pure, no DOM, no search of its own: solver.js has
// already exhaustively found every word on the board, so the opponent is
// just a difficulty-scaled SAMPLE of that output, never an invented word.
//
// Tiers (repo's shared beginner/intermediate/pro vocabulary):
//   Beginner     biased toward 3-4 letter words.
//   Intermediate unbiased.
//   Pro          biased toward longer/higher-scoring words.
//
// THE PERCENTAGE EACH TIER TAKES IS PER LANGUAGE, and that is not a detail --
// a flat percentage makes the SAME LABEL a different opponent in Spanish. See
// TIER_PCT below.
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

// Measured over 400 gated boards per language, through this exact sampler:
// with English's percentages applied to a Spanish board the AI averaged 37 /
// 115 / 204 against English's 27 / 76 / 129. Spanish MEDIUM was a harder
// opponent than English HARD, and Spanish HARD was 58% above it.
//
// Board word COUNT is not the reason (129 vs 121 per board, near-identical) --
// SCORING IS SUPERLINEAR IN WORD LENGTH (3-4 letters 1 point, 7 gets 5, 8+
// gets 11) and Spanish words are longer, so the same fraction of the same
// number of words is worth far more. Any future language will hit this too:
// a flat percentage is a promise about how much of the board the AI takes,
// and the difficulty label is a promise about how hard it plays. They are
// different promises, and this one has to keep the second.
//
// The Spanish values are solved numerically against the English tier averages
// on the same measurement (0.16 / 0.33 / 0.44 reproduce 27 / 76 / 130), so
// "Medium" means the same thing to a player in either language. Re-derive them
// with tune-boggle-es.mjs --ai after any change to the dice, the gate, the
// word list or scoreForWord.
const TIER_PCT_BY_LANG = {
  en: { beginner: 0.20, intermediate: 0.45, pro: 0.70 },
  es: { beginner: 0.16, intermediate: 0.33, pro: 0.44 },
};

// The English table stays the default export under its original name: it is
// the pre-existing API (test.js reads it), and an unknown language must behave
// exactly as this module did before languages existed.
export const TIER_PCT = TIER_PCT_BY_LANG.en;

/** The tier percentages for a gameplay language, English for anything
 *  unrecognised (matching game.js's diceFor and dict.js's dictLang). */
export function tierPctFor(lang) {
  return TIER_PCT_BY_LANG[lang] || TIER_PCT_BY_LANG.en;
}

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
 *  never invent a word that is not a genuine solver hit. `lang` selects the
 *  tier percentages (see TIER_PCT_BY_LANG); it defaults to English so every
 *  pre-existing caller and test keeps its exact previous behaviour. */
export function selectAiWords(solved, tier, rng = Math.random, lang = 'en') {
  if (!solved.length) return [];
  const table = tierPctFor(lang);
  const pct = table[tier] ?? table.intermediate;
  const weight = TIER_WEIGHT[tier] || TIER_WEIGHT.intermediate;
  const count = Math.min(solved.length, Math.round(pct * solved.length));
  if (count <= 0) return [];
  if (count >= solved.length) return solved.slice();
  return weightedSample(solved, count, weight, rng);
}

export function totalScore(entries) {
  return entries.reduce((sum, e) => sum + scoreForWord(e.word), 0);
}

export default { TIER_PCT, TIER_PCT_BY_LANG, tierPctFor, selectAiWords, totalScore };
