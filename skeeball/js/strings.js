// skeeball/js/strings.js - the EN/ES dictionary (js/i18n.js's makeT; English is the source of
// truth and the fallback). Machine NAMES are proper nouns and are never routed through t() -
// same standing rule as STARHUB. Spanish keeps the arcade vocabulary players actually say.

const STRINGS = {
  en: {
    title: 'Skeeball',

    // Setup / machine select
    setup_machines: 'Machines',
    board_classic_tag: 'The boardwalk original. Nine balls, the cup ladder, two corner 100s.',
    play: 'Play',
    resume: 'Resume',
    howto: 'How to play',
    rotate: 'Rotate your phone to play',
    pause: 'Pause',
    paused: 'Paused',
    locked: 'Locked',
    unlock_hint: 'Score {score} on {name} to unlock',
    car_hint: 'Swipe to switch machines',
    prev_machine: 'Previous machine',
    next_machine: 'Next machine',

    // The three goals that open the next machine (js/goals.js)
    goals_h: 'Next machine',
    // Short forms for the lane rails and the game-over tiles. Kept separate from the sentences
    // above so a rail label can stay short without the full goal text going vague.
    g_hundreds: '100s landed',
    g_single: 'Single game',
    g_total: 'Total points',
    goals_unlocked: 'UNLOCKED',
    // Dev only, gated on isDevProfile. Delete both when Skeeball ships.
    devreset: 'Reset Skeeball stats',
    devreset_confirm: 'Delete every Skeeball stat on this device?\n\nYour best, today, average, lifetime points and all three goal counters go. The next hub load removes them from the server too, and nothing syncs them back.\n\nEvery other game is untouched. This cannot be undone.',

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
    // The backboard scoreboard's four column labels.
    sb_all_time: 'Hub Wide Record',
    sb_your_best: 'Your Best',
    sb_today: 'Today',
    sb_last_game: 'Last Game',
    stat_last: 'Last',

    // Play screen
    hud_ball: 'Ball',
    hud_score_aria: 'Score',
    msg_gutter: 'MISS!',
    quit: 'Back to setup screen',

    // Game over
    over_h: 'Game over',
    over_final: 'Final score',
    over_new_mine: 'NEW BEST',
    over_new_today: 'BEST TODAY',
    over_new_top: 'MACHINE RECORD',
    over_best_throw: 'Best ball',
    over_hundreds: '100s',
    over_fifties: '50s',
    over_hub_record: 'Hub-wide record',
    over_your_avg: 'Your average',
    over_hub_avg: 'Hub average',
    over_again: 'Play again',
    close: 'Close',

    // How to play: pictures-first, four panels, two tiny captions; arias carry the full
    // meaning for screen readers
    howto_h: 'How to play',
    ht_roll: 'Swipe up to roll',
    ht_unlock: 'Hit the target to unlock machines',
    ht_ok: 'OK',
    ht_swipe: 'Swipe to roll',
    ht_balls: '9 balls per game',
    ht_a_swipe: 'Swipe up the lane to roll the ball',
    ht_a_holes: 'The board: higher holes are worth more, 20 up to 50, with a 100 in each top corner',
    ht_a_balls: 'Nine balls in the tray, one game',
    ht_a_unlock: 'Score {score} on the first machine and the padlock on the next machine opens',

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
    rotate: 'Gira el teléfono para jugar',
    pause: 'Pausa',
    paused: 'En pausa',
    locked: 'Bloqueada',
    unlock_hint: 'Consigue {score} en {name} para desbloquearla',
    car_hint: 'Desliza para cambiar de máquina',
    prev_machine: 'Máquina anterior',
    next_machine: 'Máquina siguiente',

    goals_h: 'Siguiente máquina',
    g_hundreds: '100 conseguidos',
    g_single: 'Una partida',
    g_total: 'Puntos totales',
    goals_unlocked: 'DESBLOQUEADA',
    devreset: 'Reiniciar estadísticas de Skeeball',
    devreset_confirm: '¿Borrar todas las estadísticas de Skeeball en este dispositivo?\n\nTu mejor puntuación, la de hoy, el promedio, los puntos totales y los tres objetivos se van. La próxima carga del hub también los quita del servidor, y nada los restaura.\n\nNingún otro juego se ve afectado. Esto no se puede deshacer.',

    rec_top: 'Puntuación máxima',
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
    sb_all_time: 'Récord del Hub',
    sb_your_best: 'Tu mejor',
    sb_today: 'Hoy',
    sb_last_game: 'Última',
    stat_last: 'Última',

    hud_ball: 'Bola',
    hud_score_aria: 'Puntos',
    msg_gutter: 'FALLO!',
    quit: 'Volver a la pantalla inicial',

    over_h: 'Fin de la partida',
    over_final: 'Puntuación final',
    over_new_mine: 'TU MEJOR',
    over_new_today: 'MEJOR DE HOY',
    over_new_top: 'RÉCORD DE LA MÁQUINA',
    over_best_throw: 'Mejor bola',
    over_hundreds: 'Cienes',
    over_fifties: 'Cincuentas',
    over_hub_record: 'Récord del Hub',
    over_your_avg: 'Tu promedio',
    over_hub_avg: 'Promedio del Hub',
    over_again: 'Otra partida',
    close: 'Cerrar',

    howto_h: 'Cómo se juega',
    ht_roll: 'Desliza hacia arriba para lanzar',
    ht_unlock: 'Alcanza la meta para desbloquear máquinas',
    ht_ok: 'Vale',
    ht_swipe: 'Desliza para lanzar',
    ht_balls: '9 bolas por partida',
    ht_a_swipe: 'Desliza hacia arriba por la pista para lanzar la bola',
    ht_a_holes: 'El tablero: los huecos más altos valen más, del 20 al 50, con un 100 en cada esquina superior',
    ht_a_balls: 'Nueve bolas en la bandeja, una partida',
    ht_a_unlock: 'Consigue {score} en la primera máquina y se abre el candado de la siguiente',

    aria_lane: 'Máquina de skeeball. Desliza hacia arriba en la pista para lanzar la bola.',
  },
};

export default STRINGS;
