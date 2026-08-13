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

    // How to play
    howto_h: 'How to play',
    help_lead: 'Nine balls. Roll each one up the lane and off the hump into a cup.',
    help_caption: 'How hard you swipe is how high the ball lands. The cups climb the middle: 30, then 40, then 50. Miss the cups inside the big ring and it rolls down for 20; anywhere else on the board rolls down for 10.',
    help_ex: 'Swipe at about two-thirds strength = the 50 cup',
    help_rule1: 'The corner 100 pockets need nearly full power and a committed sideways aim.',
    help_rule2: 'A ball too soft to clear the hump rolls back. It is not spent, roll it again.',
    help_rule3: 'Only two balls score nothing: one too weak to reach the board, and one that falls off into a bottom corner.',
    help_diagram_aria: 'Side view of the skeeball lane showing three throw arcs: a soft throw dying short of the board, a medium throw dropping into the cups, and a hard throw sailing over the 50 onto the high board for 10',
    help_k1: 'soft: dies short',
    help_k2: 'smooth: the cups',
    help_k3: 'hard: only a 10',

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
    help_lead: 'Nueve bolas. Lanza cada una por la pista y por encima de la rampa hasta una copa.',
    help_caption: 'La fuerza del gesto decide a qué altura cae la bola. Las copas suben por el centro: 30, luego 40, luego 50. Si falla las copas dentro del aro grande, baja rodando y vale 20; en cualquier otra parte del tablero, vale 10.',
    help_ex: 'Deslizar a dos tercios de fuerza = la copa del 50',
    help_rule1: 'Los huecos de 100 de las esquinas piden casi toda la potencia y apuntar decidido hacia el lado.',
    help_rule2: 'Una bola que no sube la rampa vuelve rodando. No se gasta, lánzala otra vez.',
    help_rule3: 'Solo dos bolas no puntúan: una tan floja que no llega al tablero, y una que cae por una esquina de abajo.',
    help_diagram_aria: 'Vista lateral de la pista de skeeball con tres arcos de lanzamiento: uno flojo que muere antes del tablero, uno medio que cae en las copas y uno fuerte que pasa el 50 y cae arriba, valiendo 10',
    help_k1: 'floja: se queda corta',
    help_k2: 'media: las copas',
    help_k3: 'fuerte: solo un 10',

    aria_lane: 'Máquina de skeeball. Desliza hacia arriba en la pista para lanzar la bola.',
  },
};

export default STRINGS;
