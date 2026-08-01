// snake-v2/js/strings.js - Snake v2's dictionary.
//
// This is Snake's OWN dictionary plus a handful of preview-only additions, not a copy of it.
// Duplicating 110 lines of translated Snake strings would guarantee the two drift apart the
// first time anyone corrects a Spanish line, and the correction would land in only one of them.
// Spreading the real dictionary keeps one source of truth: a fix in snake/js/strings.js is
// picked up here automatically.
//
// House style (root CLAUDE.md, copy conventions): NO em dashes in user-visible copy.

import { STRINGS as SNAKE } from '../../snake/js/strings.js';

const EXTRA = {
  en: {
    title: 'Snake v2',
    tagline: 'The same Snake, restyled. A preview.',
    preview_badge: 'Preview',
    preview_note: 'This is a look test. The game is identical, only the buttons and screens around it changed. Runs here are not saved to your stats, so nothing you do can affect your real Snake history.',
    preview_note_short: 'Runs here are not saved to your stats.',
    board_unchanged: 'The board is untouched on purpose. This is only about the screens around it.',
    controls: 'Controls',
    aria_preview: 'Preview build notice',
  },
  es: {
    title: 'Snake v2',
    tagline: 'El mismo Snake, con otro aspecto. Una vista previa.',
    preview_badge: 'Vista previa',
    preview_note: 'Esto es una prueba de aspecto. El juego es idéntico, solo cambian los botones y las pantallas que lo rodean. Las partidas de aquí no se guardan en tus estadísticas, así que nada de lo que hagas puede afectar a tu historial real de Snake.',
    preview_note_short: 'Las partidas de aquí no se guardan en tus estadísticas.',
    board_unchanged: 'El tablero está intacto a propósito. Esto va solo de las pantallas que lo rodean.',
    controls: 'Controles',
    aria_preview: 'Aviso de vista previa',
  },
};

export const STRINGS = {
  en: { ...SNAKE.en, ...EXTRA.en },
  es: { ...SNAKE.es, ...EXTRA.es },
};

export default STRINGS;
