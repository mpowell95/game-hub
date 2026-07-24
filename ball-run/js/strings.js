// ball-run/js/strings.js — every user-visible string in Ball Run, both languages. Follows the
// per-game dictionary convention (root CLAUDE.md, "Adding a game" item 9; reference: snake/).
// English is the source of truth; es may lag (js/i18n.js's fallback shows English for anything
// missing). Difficulty keys (easy/medium/hard) are storage vocabulary (ballrun.difficulty) and
// stay canonical — only display labels translate. config.js's own DIFFICULTIES[].label stays
// English (a tuning/config module, same discipline as sim.js/track.js); ui.js maps the same keys
// onto t() here instead of importing it for display.

export const STRINGS = {
  en: {
    title: 'BALL RUN',
    blurb: 'Steer your ball by dragging your finger left and right. Avoid obstacles and stay on the track. Survive as long as you can!',
    best_passed: 'Best: {n} passed',
    no_runs_yet: 'No runs yet',
    diff_easy: 'EASY',
    diff_medium: 'MEDIUM',
    diff_hard: 'HARD',
    diff_aria: 'Difficulty',
    play: 'PLAY',
    howto_aria: 'How to play',
    score_aria: 'Obstacles passed',
    resume: 'Tap to resume',
    close: 'Close',
    run_over: 'Run over',
    fell_off: 'You fell off!',
    crashed: 'Crashed!',
    obstacles_passed: '{n} obstacles passed',
    distance_m: 'Distance: {n} m',
    new_best: 'New best!',
    best_n: 'Best: {n}',
    play_again: 'Play Again',
    back_to_hub: 'Back to hub',
    howto_title: 'HOW TO PLAY',
    help_goal: 'Survive as long as you can.',
    help_diagram_aria: 'Dragging left and right steers the ball on the track; falling off the edge ends the run',
    help_caption: 'Drag anywhere to steer. Falling off the track ends the run.',
    help_bullet1: 'Speed increases as you go.',
  },
  es: {
    title: 'CARRERA DE BOLAS',
    blurb: 'Guía tu bola arrastrando el dedo a izquierda y derecha. Esquiva obstáculos y no te salgas de la pista. ¡Sobrevive todo lo que puedas!',
    best_passed: 'Mejor: {n} superados',
    no_runs_yet: 'Todavía sin carreras',
    diff_easy: 'FÁCIL',
    diff_medium: 'NORMAL',
    diff_hard: 'DIFÍCIL',
    diff_aria: 'Dificultad',
    play: 'JUGAR',
    howto_aria: 'Cómo se juega',
    score_aria: 'Obstáculos superados',
    resume: 'Toca para continuar',
    close: 'Cerrar',
    run_over: 'Carrera terminada',
    fell_off: '¡Te caíste!',
    crashed: '¡Chocaste!',
    obstacles_passed: '{n} obstáculos superados',
    distance_m: 'Distancia: {n} m',
    new_best: '¡Nuevo récord!',
    best_n: 'Mejor: {n}',
    play_again: 'Jugar otra vez',
    back_to_hub: 'Volver al hub',
    howto_title: 'CÓMO SE JUEGA',
    help_goal: 'Sobrevive todo lo que puedas.',
    help_diagram_aria: 'Arrastrar a izquierda y derecha guía la bola por la pista; caerse del borde termina la carrera',
    help_caption: 'Arrastra en cualquier punto para guiar la bola. Caerte de la pista termina la carrera.',
    help_bullet1: 'La velocidad aumenta a medida que avanzas.',
  },
};

export default STRINGS;
