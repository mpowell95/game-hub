// golf/js/strings.js - {en, es}. English is the source of truth; a missing Spanish key falls
// back to English (js/i18n.js). Call t() at RENDER time, never at module scope.
//
// STAGE A of the rewrite: the old game's vocabulary (spin, fringe, mph, the three meters) went
// with the game. This is the placeholder screen's set only - Stage D writes the real one, in
// both languages, for every string the rebuilt game shows.

export const STRINGS = {
  en: {
    title: 'Golf',
    rebuilding: 'Golf is being rebuilt. It will be back soon.',
  },
  es: {
    title: 'Golf',
    rebuilding: 'Golf se esta reconstruyendo. Volvera pronto.',
  },
};
