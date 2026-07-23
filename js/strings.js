// js/strings.js — the ONE shared dictionary for hub chrome + the My Stats / Leaderboards /
// profile-page / add-to-home-screen surfaces. One file because these change together and
// precache as one asset (see HANDOFF-I18N-EXTRACTION.md, decision 2). Keys are prefixed by
// surface: hub_ (hub.js), gs_ (My Stats), lb_ (Leaderboards), pf_ (profile page), a2hs_
// (add-to-home-screen sheet).
//
// English is the source of truth: every key exists in `en`; `es` may lag (js/i18n.js's
// fallback shows English for anything missing, so partial translation can never break a
// screen). Spanish drafted by a working session; native-speaker review welcome — corrections
// are one-line edits here, nothing else moves.
//
// Per-game hub card blurbs are NOT here — they live as {en, es} objects on each GAMES entry
// in js/hub.js (decision 3: registry data stays co-located with its entry).

export const STRINGS = {
  en: {
    hub_stats_btn: 'My Stats',
    hub_stats_aria: 'My game stats',
    hub_leaderboard_btn: 'Leaderboards',
    hub_leaderboard_aria: 'Leaderboards',
    hub_profile_btn: 'My Profile',
    hub_back_aria: 'Back to hub',
    hub_challenge_btn: '🎁 Challenge',
    hub_games_aria: 'Games',
    hub_soon_tag: 'Soon',
    hub_test_tag: 'Test',
    hub_fav_add: 'Add {title} to favorites',
    hub_fav_remove: 'Remove {title} from favorites',
    hub_load_error: "Couldn't load {title}. Please try again.",
    hub_confirm_msg: 'Leave this game? Your current progress will be lost.',
    hub_confirm_keep: 'Keep playing',
    hub_confirm_leave: 'Leave game',
    hub_confirm_dialog_aria: 'Leave game',
    hub_fr_dialog_aria: 'Choose a name',
    hub_fr_title: 'Choose a name',
    hub_fr_langrow_aria: 'Language / Idioma',
    hub_fr_name_placeholder: 'Your name',
    hub_fr_save: 'Save',
    hub_fr_or: 'or',
    hub_fr_code_placeholder: 'Enter a code',
    hub_fr_link: 'Link',
    hub_fr_msg_enter_name: 'Enter a name.',
    hub_fr_msg_checking: 'Checking...',
    hub_fr_msg_taken: 'Taken. Use that code instead.',
    hub_fr_msg_invalid_code: 'Invalid code.',
    hub_fr_msg_linking: 'Linking...',
    hub_version_update_aria: 'Update available: {latest}. Tap to update.',
    hub_version_current_aria: 'Version {cur}. Tap to check for updates.',
  },
  es: {
    hub_stats_btn: 'Mis estadísticas',
    hub_stats_aria: 'Mis estadísticas de juego',
    hub_leaderboard_btn: 'Clasificación',
    hub_leaderboard_aria: 'Clasificación',
    hub_profile_btn: 'Mi perfil',
    hub_back_aria: 'Volver al hub',
    hub_challenge_btn: '🎁 Desafío',
    hub_games_aria: 'Juegos',
    hub_soon_tag: 'Pronto',
    hub_test_tag: 'Prueba',
    hub_fav_add: 'Añadir {title} a favoritos',
    hub_fav_remove: 'Quitar {title} de favoritos',
    hub_load_error: 'No se pudo cargar {title}. Inténtalo de nuevo.',
    hub_confirm_msg: '¿Salir de esta partida? Se perderá tu progreso actual.',
    hub_confirm_keep: 'Seguir jugando',
    hub_confirm_leave: 'Salir de la partida',
    hub_confirm_dialog_aria: 'Salir de la partida',
    hub_fr_dialog_aria: 'Elige un nombre',
    hub_fr_title: 'Elige un nombre',
    hub_fr_langrow_aria: 'Language / Idioma',
    hub_fr_name_placeholder: 'Tu nombre',
    hub_fr_save: 'Guardar',
    hub_fr_or: 'o',
    hub_fr_code_placeholder: 'Introduce un código',
    hub_fr_link: 'Vincular',
    hub_fr_msg_enter_name: 'Introduce un nombre.',
    hub_fr_msg_checking: 'Comprobando...',
    hub_fr_msg_taken: 'Ya está en uso. Usa ese código en su lugar.',
    hub_fr_msg_invalid_code: 'Código no válido.',
    hub_fr_msg_linking: 'Vinculando...',
    hub_version_update_aria: 'Actualización disponible: {latest}. Toca para actualizar.',
    hub_version_current_aria: 'Versión {cur}. Toca para buscar actualizaciones.',
  },
};

export default STRINGS;
