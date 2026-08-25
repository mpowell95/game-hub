// skeeball/js/strings.js - the EN/ES dictionary (js/i18n.js's makeT; English is the source of
// truth and the fallback). Machine NAMES are proper nouns and are never routed through t() -
// same standing rule as STARHUB. Spanish keeps the arcade vocabulary players actually say.

const STRINGS = {
  en: {
    title: 'Skeeball',

    // Setup / machine select
    setup_machines: 'Machines',
    board_classic_tag: 'The boardwalk original. Nine balls, the cup ladder, two corner 100s.',
    board_popongo_tag: 'Nine color cups on bare wood. The black cups take back your last ball.',
    board_basketball_tag: 'Nine orange hoops on three rows. The 100 hangs top center.',
    board_brickcity_tag: 'Two 100s up top, tight as the ball. The bottom row takes points back.',
    board_runaway_tag: 'One 100 up top, and it will not hold still. Throw where it is going.',
    play: 'Play',
    resume: 'Resume',
    howto: 'How to play',
    rotate: 'Rotate your phone to play',
    pause: 'Pause',
    paused: 'Paused',
    locked: 'Locked',
    lock_testing: 'Coming soon',
    unlock_hint: 'Score {score} on {name} to unlock',
    unlock_goals_hint: 'Complete all three goals on {name} to unlock',
    prev_machine: 'Previous machine',
    next_machine: 'Next machine',

    // The three goals that open the next machine (js/goals.js)
    goals_h: 'Next machine',
    // Short forms for the lane rails and the game-over tiles. Kept separate from the sentences
    // above so a rail label can stay short without the full goal text going vague.
    g_hundreds: '100s landed',
    g_single: 'Single game',
    g_total: 'Total points',
    g_colors: 'All 4 colors',
    g_hoop: 'The 100 hoop',
    // BRICK CITY's three. Kept SHORT because a rail box is min(76px, 19vw) wide and wraps to two
    // lines; 'Net total points' would take three and push the number out of the box.
    // ROUND, not "rack" (Matt, 2026-08-24). The code and its comments still say rack - that is
    // this engine's internal word for nine balls - but nothing a PLAYER reads does.
    g_baskets: 'Every basket',
    g_clean: 'Clean round',
    g_net: 'Net points',
    // RUNAWAY's own. Two short words for the same reason as BRICK CITY's above - the rail box is
    // min(76px, 19vw) wide and wraps to two lines, and a third line pushes the number out of it.
    g_runaway: 'Catch the 100',
    goals_obj_h: 'Objectives',
    goals_unlocked: 'UNLOCKED',
    goals_done: 'COMPLETE',

    // The records panel - the four numbers every machine shows
    rec_top: 'Top score',
    rec_top_any: 'any player',
    rec_mine: 'Your best',
    rec_today: 'Best today',
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
    ht_a_unlock: 'Complete the three goals on the first machine and the padlock on the next machine opens',

    // Aria
    aria_lane: 'Skeeball machine. Swipe up on the lane to roll the ball.',
  },

  es: {
    title: 'Skeeball',

    setup_machines: 'Máquinas',
    board_classic_tag: 'La original del paseo marítimo. Nueve bolas, la escalera de copas y dos 100 en las esquinas.',
    board_popongo_tag: 'Nueve copas de colores sobre madera. Las copas negras te quitan la última bola.',
    board_basketball_tag: 'Nueve aros naranjas en tres filas. El 100 está arriba en el centro.',
    board_brickcity_tag: 'Dos 100 arriba, justos para la pelota. La fila de abajo te quita puntos.',
    board_runaway_tag: 'Un solo 100 arriba, y no se queda quieto. Tira a donde va a estar.',
    play: 'Jugar',
    resume: 'Seguir la partida',
    howto: 'Cómo se juega',
    rotate: 'Gira el teléfono para jugar',
    pause: 'Pausa',
    paused: 'En pausa',
    locked: 'Bloqueada',
    lock_testing: 'Muy pronto',
    unlock_hint: 'Consigue {score} en {name} para desbloquearla',
    unlock_goals_hint: 'Completa los tres objetivos de {name} para desbloquearla',
    prev_machine: 'Máquina anterior',
    next_machine: 'Máquina siguiente',

    goals_h: 'Siguiente máquina',
    g_hundreds: '100 conseguidos',
    g_single: 'Una partida',
    g_total: 'Puntos totales',
    g_colors: 'Los 4 colores',
    g_hoop: 'El aro de 100',
    g_baskets: 'Cada canasta',
    g_clean: 'Ronda limpia',
    g_net: 'Puntos netos',
    g_runaway: 'Atrapa el 100',
    goals_obj_h: 'Objetivos',
    goals_unlocked: 'DESBLOQUEADA',
    goals_done: 'COMPLETADOS',

    rec_top: 'Puntuación máxima',
    rec_top_any: 'cualquier jugador',
    rec_mine: 'Tu mejor',
    rec_today: 'Mejor hoy',
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
    ht_a_unlock: 'Completa los tres objetivos de la primera máquina y se abre el candado de la siguiente',

    aria_lane: 'Máquina de skeeball. Desliza hacia arriba en la pista para lanzar la bola.',
  },
};

export default STRINGS;
