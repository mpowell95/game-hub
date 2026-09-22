// minesweeper/js/strings.js — every user-visible string in Minesweeper, both languages. English
// is the source of truth (every key exists in `en`); `es` may lag and js/i18n.js's fallback shows
// English for anything missing, so a partial translation can never break a screen. Shape follows
// snake/js/strings.js, the repo's reference implementation (root CLAUDE.md, "Adding a game" item 9).
//
// Spanish drafted by a working session; native-speaker review welcome — corrections are one-line
// edits here, nothing else moves. No em dashes anywhere (root CLAUDE.md's copy rule).

export const STRINGS = {
  en: {
    // Setup screen
    title: 'Minesweeper',
    difficulty: 'Difficulty',
    easy: 'Easy',
    medium: 'Medium',
    hard: 'Hard',
    expert: 'Expert',
    board_fmt: '{w} x {h}, {n} mines',
    your_best: 'Your best time',
    no_time: '--:--',
    options: 'Options',
    safe_first: 'Safe first tap',
    long_press: 'Long press to flag',
    vibrate: 'Vibrate on flag',
    play: 'Play',
    resume: 'Resume',
    how_to_play: 'How to play',
    my_stats: 'My stats',
    // Game screen
    dig: 'Dig',
    flag: 'Flag',
    new_game: 'New game',
    mines_left_aria: 'Mines left: {n}',
    time_aria: 'Time: {t}',
    help_aria: 'How to play',
    cell_aria_hidden: 'Row {r}, column {c}, not opened',
    cell_aria_flag: 'Row {r}, column {c}, flagged',
    cell_aria_open: 'Row {r}, column {c}, {n} mines touching',
    cell_aria_empty: 'Row {r}, column {c}, empty',
    // Results
    boom: 'Boom',
    cleared: 'Cleared',
    result_sub_fmt: '{level}, {n} mines',
    stat_time: 'Time',
    stat_cleared: 'Cleared',
    stat_flags: 'Flags right',
    stat_old_best: 'Old best',
    stat_wins: 'Wins',
    new_best: 'New best time',
    play_again: 'Play again',
    change_difficulty: 'Change difficulty',
    leaderboard: 'Leaderboard',
    close: 'Close',
    // How to play
    help_lead: 'Open every square that is not a mine.',
    help_chord_cap: 'Tap a number that already has all its flags to open the rest.',
    help_loupe_cap: 'The bubble shows the square you are on. Your tap lands when you lift.',
    back: 'Back',
  },
  es: {
    // Setup screen
    title: 'Buscaminas',
    difficulty: 'Dificultad',
    easy: 'Fácil',
    medium: 'Normal',
    hard: 'Difícil',
    expert: 'Experto',
    board_fmt: '{w} x {h}, {n} minas',
    your_best: 'Tu mejor tiempo',
    no_time: '--:--',
    options: 'Opciones',
    safe_first: 'Primer toque seguro',
    long_press: 'Mantén presionado para marcar',
    vibrate: 'Vibrar al marcar',
    play: 'Jugar',
    resume: 'Continuar',
    how_to_play: 'Cómo se juega',
    my_stats: 'Mis estadísticas',
    // Game screen
    dig: 'Cavar',
    flag: 'Marcar',
    new_game: 'Partida nueva',
    mines_left_aria: 'Minas restantes: {n}',
    time_aria: 'Tiempo: {t}',
    help_aria: 'Cómo se juega',
    cell_aria_hidden: 'Fila {r}, columna {c}, sin abrir',
    cell_aria_flag: 'Fila {r}, columna {c}, marcada',
    cell_aria_open: 'Fila {r}, columna {c}, {n} minas alrededor',
    cell_aria_empty: 'Fila {r}, columna {c}, vacía',
    // Results
    boom: 'Boom',
    cleared: 'Despejado',
    result_sub_fmt: '{level}, {n} minas',
    stat_time: 'Tiempo',
    stat_cleared: 'Despejado',
    stat_flags: 'Marcas correctas',
    stat_old_best: 'Récord anterior',
    stat_wins: 'Victorias',
    new_best: 'Nuevo mejor tiempo',
    play_again: 'Jugar otra vez',
    change_difficulty: 'Cambiar dificultad',
    leaderboard: 'Tabla de posiciones',
    close: 'Cerrar',
    // How to play
    help_lead: 'Abre cada casilla que no sea una mina.',
    help_chord_cap: 'Toca un numero que ya tenga todas sus marcas para abrir el resto.',
    help_loupe_cap: 'La burbuja muestra la casilla donde estas. Tu toque se aplica al levantar.',
    back: 'Atrás',
  },
};

export default STRINGS;
