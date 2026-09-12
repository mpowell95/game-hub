// baseball/js/strings.js - phase 0 placeholder dictionary (js/i18n.js's makeT(STRINGS) shape).
// Root CLAUDE.md, "Before you build: USE WHAT EXISTS": every visible string goes through t() at
// render time, EN and ES. There is no game yet (see baseball/CLAUDE.md), so this is deliberately
// three keys.

export const STRINGS = {
  en: {
    title: 'Baseball',
    placeholder_title: 'Baseball is coming',
    placeholder_body: "This is plumbing only, no game yet. Check back once it's built.",
  },
  es: {
    title: 'Béisbol',
    placeholder_title: 'Béisbol está en camino',
    placeholder_body: 'Esto es solo la base técnica, todavía no hay juego. Vuelve más adelante.',
  },
};

export default STRINGS;
