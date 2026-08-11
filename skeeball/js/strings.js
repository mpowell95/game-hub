// skeeball/js/strings.js - every user-visible string in Skeeball, { en, es }.
// English is the source of truth; a missing Spanish key falls back to English (js/i18n.js), so a
// partial translation can never break a screen. Called through t() at RENDER time, never at
// module scope. Reference implementation: snake/js/strings.js.

export const STRINGS = {
  en: {
    title: 'Skeeball',
    tagline: 'Flick the ball up the lane. The far rings pay more.',

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
    howto: 'How to play',

    // hud
    you: 'You',
    round_of: 'Round {n}/{total}',
    balls_left: '{n} left',
    your_turn: 'Your turn',
    opp_turn: '{name} is throwing',

    // in play
    drag_to_throw: 'Flick up the lane to throw',
    short: 'Short!',
    over: 'Too hard!',

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

    // how to play
    help_goal: 'Land the ball in the highest ring you can.',
    help_flick: 'Flick up the lane: how FAR you flick sets the power, the angle sets the aim.',
    help_rings: 'The rings run 10 at the front to 50 at the back. Too soft and it rolls back for nothing, too hard and it flies over for 10.',
    help_cups: 'The two 100 cups sit in the far corners. Flick hard AND wide, or bank off a rail.',
    help_mult: 'The blue x3 badge moves every throw. Hit the target it is sitting on and the score triples.',

    // aria
    aria_lane: 'Skeeball lane. Flick up to throw.',
    aria_close: 'Close',
    aria_help: 'How to play Skeeball',
    aria_scores: 'Scores',
  },
  es: {
    title: 'Skeeball',
    tagline: 'Lanza la bola por la pista. Los aros del fondo valen más.',

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
    howto: 'Cómo se juega',

    you: 'Tú',
    round_of: 'Ronda {n}/{total}',
    balls_left: 'Quedan {n}',
    your_turn: 'Tu turno',
    opp_turn: '{name} está lanzando',

    drag_to_throw: 'Desliza hacia arriba para lanzar',
    short: '¡Corta!',
    over: '¡Demasiado fuerte!',

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

    help_goal: 'Mete la bola en el aro más alto que puedas.',
    help_flick: 'Desliza hacia arriba: cuánto deslizas marca la fuerza, el ángulo marca la puntería.',
    help_rings: 'Los aros van del 10 delante al 50 al fondo. Si te quedas corto vuelve sin puntos, y si te pasas sale por arriba y solo son 10.',
    help_cups: 'Las dos copas de 100 están en las esquinas del fondo. Lanza fuerte Y abierto, o rebota en una banda.',
    help_mult: 'La chapa azul x3 cambia de sitio en cada lanzamiento. Acierta donde esté y la puntuación se triplica.',

    aria_lane: 'Pista de skeeball. Desliza hacia arriba para lanzar.',
    aria_close: 'Cerrar',
    aria_help: 'Cómo se juega al Skeeball',
    aria_scores: 'Puntuaciones',
  },
};

export default STRINGS;
