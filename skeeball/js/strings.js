// skeeball/js/strings.js - the EN/ES dictionary (js/i18n.js's makeT; English is the source of
// truth and the fallback). Machine NAMES are proper nouns painted on the marquee and are not
// routed through t() - same standing rule as STARHUB and the card-suit vocabulary. Spanish keeps
// the borrowed arcade vocabulary players actually say.

const STRINGS = {
  en: {
    title: 'Skeeball',

    // Setup / machine select
    setup_machines: 'Machines',
    board_classic_tag: 'The boardwalk original. Nine balls, the cup ladder, two corner 100s.',
    play: 'Play',
    resume: 'Resume rack',
    howto: 'How to play',
    locked: 'Locked',
    unlock_hint: 'Score {score} on {name} to unlock',

    // The records panel - the four numbers every machine shows
    rec_top: 'Top score',
    rec_top_any: 'any player',
    rec_mine: 'Your best',
    rec_today: 'Today',
    rec_last: 'Last game',
    rec_none: 'No games yet',
    new_game: 'New game',
    machine: 'Machine',
    stat_best: 'Best',
    stat_today: 'Today',
    stat_top: 'Top',
    // The backboard scoreboard's four column labels (2026-08-15). Matt's own words.
    sb_all_time: 'All Time',
    sb_your_best: 'Your Best',
    sb_today: 'Today',
    sb_last_game: 'Last Game',
    stat_last: 'Last',

    // Play screen
    hud_ball: 'Ball',
    hud_score_aria: 'Score',
    hint_swipe: 'Swipe up the lane to roll',
    msg_returned: 'Too soft. Have it back.',
    msg_gutter: 'Gutter.',
    msg_resumed: 'Picked up where you left off: ball {n} of {total}',
    quit: 'Back to machines',

    // Game over
    over_h: 'Rack complete',
    over_final: 'Final score',
    over_new_mine: 'NEW BEST',
    over_new_today: 'BEST TODAY',
    over_new_top: 'MACHINE RECORD',
    over_best_throw: 'Best ball',
    over_hundreds: '100s',
    over_fifties: '50s',
    over_again: 'Roll again',
    close: 'Close',

    // How to play (the repo-wide pattern: one bold goal, ONE diagram, caption, X = Y, edges)
    howto_h: 'How to play',
    ht_goal: 'Land each of the 9 balls in the highest cup you can.',
    ht_caption: 'Swipe strength decides how far up the board the ball lands.',
    ht_ex: 'Half strength = the 50 cup',
    ht_r1: 'The corner 100s take nearly full strength, aimed hard sideways.',
    ht_r2: 'Too soft for the hump and the ball rolls back. Throw it again.',
    ht_r3: 'Wherever the ball finally drops is what it scores.',
    ht_aria: 'Side view of the board: a gentle swipe lands low in the 20, a half swipe lands in the 50 cup, a full swipe sails past the 50 to the top of the board',
    ht_k1: 'gentle',
    ht_k2: 'half',
    ht_k3: 'full',

    // Aria
    aria_lane: 'Skeeball machine. Swipe up on the lane to roll the ball.',
  },

  es: {
    title: 'Skeeball',

    setup_machines: 'Máquinas',
    board_classic_tag: 'La original del paseo marítimo. Nueve bolas, la escalera de copas y dos 100 en las esquinas.',
    play: 'Jugar',
    resume: 'Seguir la partida',
    howto: 'Cómo se juega',
    locked: 'Bloqueada',
    unlock_hint: 'Consigue {score} en {name} para desbloquearla',

    rec_top: 'Récord',
    rec_top_any: 'cualquier jugador',
    rec_mine: 'Tu mejor',
    rec_today: 'Hoy',
    rec_last: 'Última partida',
    rec_none: 'Aún sin partidas',
    new_game: 'Partida nueva',
    machine: 'Máquina',
    stat_best: 'Mejor',
    stat_today: 'Hoy',
    stat_top: 'Récord',
    sb_all_time: 'Histórico',
    sb_your_best: 'Tu mejor',
    sb_today: 'Hoy',
    sb_last_game: 'Última',
    stat_last: 'Última',

    hud_ball: 'Bola',
    hud_score_aria: 'Puntos',
    hint_swipe: 'Desliza hacia arriba para lanzar',
    msg_returned: 'Muy floja. Te la devuelve.',
    msg_gutter: 'Al canal.',
    msg_resumed: 'Sigues donde lo dejaste: bola {n} de {total}',
    quit: 'Volver a las máquinas',

    over_h: 'Partida completa',
    over_final: 'Puntuación final',
    over_new_mine: 'TU MEJOR',
    over_new_today: 'MEJOR DE HOY',
    over_new_top: 'RÉCORD DE LA MÁQUINA',
    over_best_throw: 'Mejor bola',
    over_hundreds: 'Cienes',
    over_fifties: 'Cincuentas',
    over_again: 'Otra partida',
    close: 'Cerrar',

    howto_h: 'Cómo se juega',
    ht_goal: 'Mete cada una de las 9 bolas en la copa más alta que puedas.',
    ht_caption: 'La fuerza del gesto decide hasta dónde sube la bola en el tablero.',
    ht_ex: 'Media fuerza = la copa del 50',
    ht_r1: 'Los 100 de las esquinas piden casi toda la fuerza, apuntando fuerte al lado.',
    ht_r2: 'Si no sube la rampa, la bola vuelve. Lánzala otra vez.',
    ht_r3: 'La bola vale lo que marque el hueco donde acabe cayendo.',
    ht_aria: 'Vista lateral del tablero: un gesto suave cae abajo en el 20, medio gesto cae en la copa del 50 y un gesto fuerte pasa el 50 hasta lo alto del tablero',
    ht_k1: 'suave',
    ht_k2: 'medio',
    ht_k3: 'fuerte',

    aria_lane: 'Máquina de skeeball. Desliza hacia arriba en la pista para lanzar la bola.',
  },
};

export default STRINGS;
