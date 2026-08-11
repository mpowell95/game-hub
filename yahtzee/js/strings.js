// strings.js -- every user-visible string in Yahtzee, { en, es }.
//
// This is the LAST in-hub game to get i18n. It shipped without any (July 2026) and had stood as
// `test-game-conventions.mjs`'s one standing KNOWN_GAPS entry ever since; that entry is removed
// with this file. Matt, 2026-08-11, after the HOW TO PLAY carousel landed in English:
// "confirm that these instructions display in Spanish too. Everything must also work in Spanish."
// They did not - not one string in this game translated - so the whole game is translated here,
// not just the carousel. A half-Spanish screen is worse than an English one.
//
// English is the source of truth; a missing `es` key falls back to English (js/i18n.js's chain),
// so a partial translation can never break a screen. Call t() at RENDER time, never at module
// scope - the language can change while the game is mounted.
//
// NOT translated, deliberately: "Yahtzee" itself (the game's name, and the name of the combo, in
// both languages - it is a proper noun, same rule the repo applies to card-suit and figure names),
// the ROLL/PLAY button faces (drawn artwork in the reference clone, not text this game sets), and
// the SMALL/LARGE banners inside the straight icons, which are part of those pictograms.

const STRINGS = {
  en: {
    title: 'Yahtzee',

    // --- setup / lobby ---
    mode_solo: 'Vs Computer',
    mode_host: 'Host Online',
    mode_join: 'Join Online',
    play: 'Play',
    howto: 'How to play',
    create_room: 'Create Room',
    room_code: 'Room code',
    join: 'Join',
    back: 'Back',
    host: 'Host',
    opponent: 'Opponent',
    start_match: 'Start Match',
    leave: 'Leave',
    waiting_join: 'Waiting for someone to join…',
    waiting_start: 'Waiting for the host to start the match…',
    share_code: 'Share this code with a friend.',
    create_and_share: 'Create a room and share the code with a friend.',
    enter_code: 'Enter the 4-character code your friend shared.',
    creating: 'Creating room…',
    joining: 'Joining…',

    // --- errors / status ---
    err_busy: 'Could not create a room. Try again.',
    err_offline: 'Offline — check your connection.',
    err_notfound: 'Room not found.',
    err_full: 'That room is full.',
    err_version: 'Update the app to join — the host is on a newer version.',
    err_wrong_game: 'That code is for a different game.',
    err_conn: 'Connection error.',
    err_reconnecting: 'Connection error — reconnecting…',
    resyncing: 'Resyncing…',
    opp_left: 'Your opponent left the game.',
    conn_lost: 'Connection lost. The match could not continue.',
    conn_ended: 'Connection ended',

    // --- players ---
    you: 'You',
    computer: 'Computer',
    player2: 'Player 2',

    // --- game end ---
    tie_game: 'Tie game',
    wins: '{name} wins!',
    play_again: 'PLAY AGAIN',
    back_to_setup: 'BACK TO SETUP',
    bonus_toast: '+35 BONUS!',

    // --- scorecard ---
    section_bonus: 'SECTION<br>BONUS',

    // --- combo info (hold a symbol) ---
    cat_ones: 'Ones',
    cat_twos: 'Twos',
    cat_threes: 'Threes',
    cat_fours: 'Fours',
    cat_fives: 'Fives',
    cat_sixes: 'Sixes',
    cat_threeKind: '3 of a kind',
    cat_fourKind: '4 of a kind',
    cat_fullHouse: 'Full house',
    cat_smallStraight: 'Sequence of 4',
    cat_largeStraight: 'Sequence of 5',
    cat_yahtzee: 'Yahtzee',
    cat_chance: 'Chance',
    score_sum_of: 'Score: sum of all {n}s',
    score_all_dice: 'Score: sum of all dice',
    score_n: 'Score: {n}',

    // --- how to play ---
    ht_title: 'HOW TO PLAY',
    ht_ok: 'OK',
    ht_first: 'First page',
    ht_next: 'Next page',
    ht_roll: 'Roll your dice at the start of each turn',
    ht_hold: 'Tap on the dice you wish to save.\nEach turn you can roll the dice 3 times',
    ht_commit: 'Tap the combo box you wish to submit and press <b>Play</b>',
    ht_once: 'You can only use each combo once per game',
    ht_learn: 'Learn about each combo by pressing its symbol on the board',
    ht_bonus: 'Score 63 or higher on the left column to earn 35 bonus points!',
  },

  es: {
    title: 'Yahtzee',

    mode_solo: 'Vs Computadora',
    mode_host: 'Crear Partida',
    mode_join: 'Unirse',
    play: 'Jugar',
    howto: 'Cómo se juega',
    create_room: 'Crear sala',
    room_code: 'Código de sala',
    join: 'Unirse',
    back: 'Atrás',
    host: 'Anfitrión',
    opponent: 'Rival',
    start_match: 'Empezar partida',
    leave: 'Salir',
    waiting_join: 'Esperando a que alguien se una…',
    waiting_start: 'Esperando a que el anfitrión empiece la partida…',
    share_code: 'Comparte este código con un amigo.',
    create_and_share: 'Crea una sala y comparte el código con un amigo.',
    enter_code: 'Escribe el código de 4 caracteres que te compartieron.',
    creating: 'Creando sala…',
    joining: 'Uniéndose…',

    err_busy: 'No se pudo crear la sala. Inténtalo de nuevo.',
    err_offline: 'Sin conexión, revisa tu red.',
    err_notfound: 'Sala no encontrada.',
    err_full: 'Esa sala está llena.',
    err_version: 'Actualiza la app para unirte: el anfitrión tiene una versión más nueva.',
    err_wrong_game: 'Ese código es de otro juego.',
    err_conn: 'Error de conexión.',
    err_reconnecting: 'Error de conexión, reconectando…',
    resyncing: 'Sincronizando…',
    opp_left: 'Tu rival salió de la partida.',
    conn_lost: 'Se perdió la conexión. La partida no pudo continuar.',
    conn_ended: 'Conexión terminada',

    you: 'Tú',
    computer: 'Computadora',
    player2: 'Jugador 2',

    tie_game: 'Empate',
    wins: '¡Gana {name}!',
    play_again: 'JUGAR OTRA VEZ',
    back_to_setup: 'VOLVER AL INICIO',
    bonus_toast: '¡+35 DE BONO!',

    section_bonus: 'BONO DE<br>SECCIÓN',

    cat_ones: 'Unos',
    cat_twos: 'Doses',
    cat_threes: 'Treses',
    cat_fours: 'Cuatros',
    cat_fives: 'Cincos',
    cat_sixes: 'Seises',
    cat_threeKind: 'Trío',
    cat_fourKind: 'Póker',
    cat_fullHouse: 'Full',
    cat_smallStraight: 'Escalera de 4',
    cat_largeStraight: 'Escalera de 5',
    cat_yahtzee: 'Yahtzee',
    cat_chance: 'Suerte',
    score_sum_of: 'Puntos: suma de todos los {n}',
    score_all_dice: 'Puntos: suma de todos los dados',
    score_n: 'Puntos: {n}',

    ht_title: 'CÓMO SE JUEGA',
    ht_ok: 'OK',
    ht_first: 'Primera página',
    ht_next: 'Página siguiente',
    ht_roll: 'Lanza los dados al empezar cada turno',
    ht_hold: 'Toca los dados que quieras guardar.\nCada turno puedes lanzar los dados 3 veces',
    ht_commit: 'Toca la casilla que quieras usar y pulsa <b>Jugar</b>',
    ht_once: 'Cada combinación solo se puede usar una vez por partida',
    ht_learn: 'Aprende cada combinación pulsando su símbolo en el tablero',
    ht_bonus: '¡Consigue 63 o más en la columna izquierda para ganar 35 puntos de bono!',
  },
};

export default STRINGS;
