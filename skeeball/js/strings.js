// skeeball/js/strings.js - every user-visible string in Skeeball, { en, es }.
// English is the source of truth; a missing Spanish key falls back to English (js/i18n.js), so a
// partial translation can never break a screen. Called through t() at RENDER time, never at
// module scope. Reference implementation: snake/js/strings.js.

export const STRINGS = {
  en: {
    title: 'Skeeball',
    tagline: 'Flick the ball up the lane. Faster goes further, and the far rings pay more.',

    // setup
    difficulty: 'Opponent',
    diff_easy: 'Easy',
    diff_medium: 'Medium',
    diff_hard: 'Hard',
    rounds: 'Rounds',
    rounds_1: '1 round',
    rounds_3: '3 rounds',
    rounds_hint: 'Nine balls each per round.',
    play: 'Play',
    resume: 'Resume game',
    locked: 'Locked',
    prev_machine: 'Previous machine',
    next_machine: 'Next machine',
    howto: 'How to play',

    // hud
    you: 'You',
    round_of: 'Round {n}/{total}',
    balls_left: '{n} left',
    your_turn: 'Your turn',
    opp_turn: '{name} is throwing',

    // in play. "Too hard!" is gone with the zero it announced: an overthrown ball now bounces
    // off the back wall and scores where it comes to rest (game.js). Never bring either back.
    drag_to_throw: 'Flick up the lane to throw',
    short: 'Short!',

    // handover / end
    scored_points: '{name} scored {n} points',
    tap_continue: 'Tap to continue',
    game_over: 'Game over',
    you_won: 'You win!',
    you_lost: '{name} wins',
    tie: 'Tied game',
    final_score: '{you} - {opp}',
    new_best: 'New best!',
    play_again: 'Play again',
    change_setup: 'Change setup',

    // how to play - the CAROUSEL's pages (skeeball/js/howto.js). One caption per page, in
    // teaching order. Keep them to three short lines: the illustration is doing the explaining.
    ht_title: 'How to play',
    ht_ok: 'OK',
    ht_first: 'First page',
    ht_next: 'Last page',
    ht_flick: 'Flick up the lane to throw.\nThe ball rolls up the ramp and drops into a ring.',
    ht_power: 'How FAST you flick sets the power.\nA gentle one drops in the 20, a quick one reaches the 50.\nToo hard and it slams the top of the board and rattles back down.',
    ht_aim: 'The ANGLE of your flick is your aim.\nThe two 100 cups sit wide at the back, so they need a fast throw AND a real diagonal.',
    ht_badge: 'The blue x3 badge moves after every throw.\nLand in the ring it is sitting on and that score triples.',
    ht_rack: 'Nine balls, one rack.\nBeat a machine\'s target score and the next machine unlocks.',
    ball: 'BALL',
    score: 'SCORE',

    // the old static help sheet's lines. Kept because the strings themselves are still accurate
    // and cheap, and removing a key is how a stale reference becomes a blank string.
    help_goal: 'Land the ball in the highest ring you can.',
    help_flick: 'Flick up the lane: how FAST you flick sets the power, the angle of the flick sets the aim.',
    help_rings: 'The rings run 10 at the front to 50 at the back. Clip a rim and the ball bounces, rattles around the basin and drops wherever it really lands.',
    help_cups: 'The two 100 cups sit in the far corners. Flick hard AND wide, or bank off a rail.',
    help_mult: 'The blue x3 badge moves every throw. Hit the target it is sitting on and the score triples.',

    // aria
    board_classic: 'Classic',
    board_stars: 'Star Alley',
    your_best: 'Your best',
    today: 'Today',
    world_best: 'Record',
    unlock_hint: 'Score {n} on {board} to unlock',
    unlocked: '{board} unlocked!',
    unlock_progress: 'Score {n} to unlock {board}',
    more_maps: 'More machines coming soon.',
    change_machine: 'Change machine',
    miss: 'Missed!',
    m_world: 'RECORD',
    m_score: 'SCORE',
    m_best: 'BEST',
    help_unlock: 'Beat a machine\'s target score and the next one unlocks.',
    aria_lane: 'Skeeball lane. Flick up to throw.',
    aria_close: 'Close',
    aria_help: 'How to play Skeeball',
    aria_scores: 'Scores',
  },
  es: {
    title: 'Skeeball',
    tagline: 'Lanza la bola por la pista. Mas rapido llega mas lejos, y el fondo vale más.',

    difficulty: 'Rival',
    diff_easy: 'Fácil',
    diff_medium: 'Media',
    diff_hard: 'Difícil',
    rounds: 'Rondas',
    rounds_1: '1 ronda',
    rounds_3: '3 rondas',
    rounds_hint: 'Nueve bolas cada uno por ronda.',
    play: 'Jugar',
    resume: 'Continuar partida',
    locked: 'Bloqueada',
    prev_machine: 'Maquina anterior',
    next_machine: 'Maquina siguiente',
    howto: 'Cómo se juega',

    you: 'Tú',
    round_of: 'Ronda {n}/{total}',
    balls_left: 'Quedan {n}',
    your_turn: 'Tu turno',
    opp_turn: '{name} está lanzando',

    drag_to_throw: 'Desliza hacia arriba para lanzar',
    short: '¡Corta!',

    scored_points: '{name} ha hecho {n} puntos',
    tap_continue: 'Toca para continuar',
    game_over: 'Fin de la partida',
    you_won: '¡Ganas!',
    you_lost: 'Gana {name}',
    tie: 'Empate',
    final_score: '{you} - {opp}',
    new_best: '¡Nuevo récord!',
    play_again: 'Jugar otra vez',
    change_setup: 'Cambiar ajustes',

    // how to play - la version carrusel
    ht_title: 'Como jugar',
    ht_ok: 'Vale',
    ht_first: 'Primera pagina',
    ht_next: 'Ultima pagina',
    ht_flick: 'Desliza hacia arriba para lanzar.\nLa bola sube por la rampa y cae en un aro.',
    ht_power: 'La VELOCIDAD del deslizamiento marca la fuerza.\nSuave y cae en el 20, rapido y llega al 50.\nDemasiado y golpea arriba del tablero y baja rebotando.',
    ht_aim: 'El ANGULO del deslizamiento es tu punteria.\nLos dos vasos de 100 estan al fondo y a los lados: piden fuerza Y una diagonal clara.',
    ht_badge: 'La chapa azul x3 cambia de sitio en cada lanzamiento.\nAcierta el aro donde este y ese valor se triplica.',
    ht_rack: 'Nueve bolas, una tanda.\nSupera la puntuacion objetivo y se desbloquea la siguiente maquina.',
    ball: 'BOLA',
    score: 'PUNTOS',

    help_goal: 'Mete la bola en el aro más alto que puedas.',
    help_flick: 'Desliza hacia arriba: la velocidad marca la fuerza, el ángulo marca la puntería.',
    help_rings: 'Los aros van del 10 delante al 50 al fondo. Si rozas un borde, la bola rebota, da vueltas por el plato y cae donde de verdad aterriza.',
    help_cups: 'Las dos copas de 100 están en las esquinas del fondo. Lanza fuerte Y abierto, o rebota en una banda.',
    help_mult: 'La chapa azul x3 cambia de sitio en cada lanzamiento. Acierta donde esté y la puntuación se triplica.',

    board_classic: 'Clásica',
    board_stars: 'Pista Estrella',
    your_best: 'Tu récord',
    today: 'Hoy',
    world_best: 'Récord',
    unlock_hint: 'Haz {n} en {board} para desbloquear',
    unlocked: '¡{board} desbloqueada!',
    unlock_progress: 'Haz {n} para desbloquear {board}',
    more_maps: 'Pronto habrá más máquinas.',
    change_machine: 'Cambiar de máquina',
    miss: '¡Fallo!',
    m_world: 'RÉCORD',
    m_score: 'PUNTOS',
    m_best: 'MEJOR',
    help_unlock: 'Supera la puntuación objetivo de una máquina y se desbloquea la siguiente.',
    aria_lane: 'Pista de skeeball. Desliza hacia arriba para lanzar.',
    aria_close: 'Cerrar',
    aria_help: 'Cómo se juega al Skeeball',
    aria_scores: 'Puntuaciones',
  },
};

export default STRINGS;
