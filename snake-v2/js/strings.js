// snake-v2/js/strings.js - Snake v2's dictionary.
//
// This is Snake's OWN dictionary plus a different title, not a copy of it. Duplicating 110 lines
// of translated Snake strings would guarantee the two drift apart the first time anyone corrects
// a Spanish line, and the correction would land in only one of them. Spreading the real
// dictionary keeps one source of truth: a fix in snake/js/strings.js is picked up here
// automatically.
//
// The `title` override is the ONLY difference, and it exists purely so the two cards are
// distinguishable in the launcher while both are installed. Everything else, including the
// tagline, is Snake's own copy: this build is meant to read as the real game, not as a test page.

import { STRINGS as SNAKE } from '../../snake/js/strings.js';

export const STRINGS = {
  en: { ...SNAKE.en, title: 'Snake v2' },
  es: { ...SNAKE.es, title: 'Snake v2' },
};

export default STRINGS;
