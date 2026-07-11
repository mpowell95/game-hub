// hub.js — Game Hub shell: a launcher grid that mounts self-contained game
// modules into a single content area (no full page reload), using each
// module's standard contract:
//   init(container)  — mount the game
//   destroy()        — tear it down when the user goes back to the hub
//
// Adding a game = drop its folder under the hub and add an entry to GAMES.

import { loadProfile } from './profile-store.js';
import { isChallengeActive, isAdmin, loadChallenge } from './challenge/hooks.js';
import { markUnlockSeen } from './challenge/challenge-store.js';

const GAMES = [
  {
    id: 'connect-four',
    title: 'Connect Four',
    blurb: 'Drop discs, connect four. Four AI levels incl. a perfect endgame solver.',
    // Relative to this module (js/hub.js): up to root, then into the game folder.
    module: '../connect-four/js/ui.js',
    accent: '#1769d4',
    art: `<svg viewBox="0 0 120 120" aria-hidden="true">
            <rect width="120" height="120" fill="#1769d4"/>
            <circle cx="21" cy="24" r="11" fill="#dbe8f8"/><circle cx="47" cy="24" r="11" fill="#dbe8f8"/>
            <circle cx="73" cy="24" r="11" fill="#dbe8f8"/><circle cx="99" cy="24" r="11" fill="#dbe8f8"/>
            <circle cx="21" cy="50" r="11" fill="#dbe8f8"/><circle cx="47" cy="50" r="11" fill="#dbe8f8"/>
            <circle cx="73" cy="50" r="11" fill="#ffce3a"/><circle cx="99" cy="50" r="11" fill="#dbe8f8"/>
            <circle cx="21" cy="76" r="11" fill="#dbe8f8"/><circle cx="47" cy="76" r="11" fill="#ffce3a"/>
            <circle cx="73" cy="76" r="11" fill="#e8463f"/><circle cx="99" cy="76" r="11" fill="#dbe8f8"/>
            <circle cx="21" cy="102" r="11" fill="#e8463f"/><circle cx="47" cy="102" r="11" fill="#ffce3a"/>
            <circle cx="73" cy="102" r="11" fill="#e8463f"/><circle cx="99" cy="102" r="11" fill="#ffce3a"/>
          </svg>`,
  },
  {
    id: 'chinchon',
    title: 'Chinchón',
    blurb: 'Spanish rummy vs. smart AI. Melds, cuts & chinchón. 2–4 players.',
    module: '../chinchon/js/ui.js',
    accent: '#d4a017',
    art: `<svg viewBox="0 0 120 120" aria-hidden="true">
            <rect width="120" height="120" fill="#1f7a52"/>
            <g transform="rotate(-16 60 66)">
              <rect x="30" y="30" width="42" height="60" rx="6" fill="#f7edd4" stroke="#c9b485" stroke-width="1.5"/>
              <polygon points="46,54 58,54 55,63 49,63" fill="#c0392b"/>
              <rect x="52.5" y="63" width="3" height="6" fill="#c0392b"/>
              <rect x="48" y="69" width="12" height="3" rx="1.5" fill="#c0392b"/>
            </g>
            <g transform="rotate(13 60 66)">
              <rect x="50" y="28" width="42" height="60" rx="6" fill="#fdf8ea" stroke="#c9b485" stroke-width="1.5"/>
              <circle cx="71" cy="58" r="13" fill="#e8b53a" stroke="#a9791b" stroke-width="2"/>
              <circle cx="71" cy="58" r="8.5" fill="none" stroke="#a9791b" stroke-width="1.3"/>
              <circle cx="71" cy="58" r="2.6" fill="#a9791b"/>
            </g>
          </svg>`,
  },
  {
    id: 'business-deal',
    title: 'Business Deal',
    blurb: 'Cards, cash & schemes. Collect property sets to win vs. smart AI. 2–5 players.',
    // Business Deal lives in this repo now (business-deal/) and launches out like
    // Parchís, rather than mounting as an in-hub module. It keeps its own global-JS
    // stack and service worker (nested under business-deal/); it is not an ES module.
    href: 'business-deal/',
    accent: '#6a4cff',
    art: `<svg viewBox="0 0 120 120" aria-hidden="true">
            <rect width="120" height="120" fill="#6a4cff"/>
            <g transform="rotate(-15 60 66)"><rect x="25" y="34" width="32" height="48" rx="4" fill="#fff"/><rect x="25" y="34" width="32" height="12" rx="4" fill="#e0532f"/></g>
            <g transform="rotate(0 60 66)"><rect x="44" y="29" width="32" height="50" rx="4" fill="#fff"/><rect x="44" y="29" width="32" height="12" rx="4" fill="#178a7a"/></g>
            <g transform="rotate(15 60 66)"><rect x="63" y="34" width="32" height="48" rx="4" fill="#fff"/><rect x="63" y="34" width="32" height="12" rx="4" fill="#1f5fa8"/></g>
            <circle cx="84" cy="82" r="15" fill="#f2b705" stroke="#a9791b" stroke-width="2"/>
            <text x="84" y="88.5" font-size="19" font-weight="900" text-anchor="middle" fill="#7a5502" font-family="system-ui, -apple-system, sans-serif">$</text>
          </svg>`,
  },
  {
    id: 'parchis',
    title: 'Parchís',
    blurb: 'Spanish Parchís vs. smart AI. One die, seguros, barreras & bonos. 2–4 players.',
    // Self-contained single-file game living in this repo; launches out like Business Deal.
    href: 'parchis/',
    accent: '#c0632b',
    art: `<svg viewBox="0 0 120 120" aria-hidden="true">
            <rect width="120" height="120" fill="#7a5a34"/>
            <rect x="5" y="5" width="110" height="110" rx="6" fill="#f5ecd6"/>
            <rect x="47" y="5" width="26" height="110" fill="#ffffff"/>
            <rect x="5" y="47" width="110" height="26" fill="#ffffff"/>
            <rect x="11" y="11" width="33" height="33" rx="5" fill="#f2b705"/>
            <rect x="76" y="11" width="33" height="33" rx="5" fill="#1f5fa8"/>
            <rect x="11" y="76" width="33" height="33" rx="5" fill="#178a7a"/>
            <rect x="76" y="76" width="33" height="33" rx="5" fill="#e0532f"/>
            <g fill="#ffffff" stroke="rgba(0,0,0,0.22)">
              <circle cx="21" cy="21" r="4"/><circle cx="34" cy="21" r="4"/><circle cx="21" cy="34" r="4"/><circle cx="34" cy="34" r="4"/>
              <circle cx="86" cy="21" r="4"/><circle cx="99" cy="21" r="4"/><circle cx="86" cy="34" r="4"/><circle cx="99" cy="34" r="4"/>
              <circle cx="21" cy="86" r="4"/><circle cx="34" cy="86" r="4"/><circle cx="21" cy="99" r="4"/><circle cx="34" cy="99" r="4"/>
              <circle cx="86" cy="86" r="4"/><circle cx="99" cy="86" r="4"/><circle cx="86" cy="99" r="4"/><circle cx="99" cy="99" r="4"/>
            </g>
            <rect x="55" y="6" width="10" height="41" fill="#f2b705"/>
            <rect x="73" y="55" width="41" height="10" fill="#1f5fa8"/>
            <rect x="55" y="73" width="10" height="41" fill="#e0532f"/>
            <rect x="6" y="55" width="41" height="10" fill="#178a7a"/>
            <polygon points="49,49 71,49 60,60" fill="#f2b705"/>
            <polygon points="71,49 71,71 60,60" fill="#1f5fa8"/>
            <polygon points="71,71 49,71 60,60" fill="#e0532f"/>
            <polygon points="49,71 49,49 60,60" fill="#178a7a"/>
          </svg>`,
  },
];

// Hidden entries appended only when the profile name matches (see render()). The
// challenge card is Ana's mission; the admin card is Matt's Mission Control. Both
// mount the same module, which decides which face to show from the profile name.
const CHALLENGE_CARD = {
  id: 'challenge',
  title: 'Hidden Challenge',
  blurb: 'Something I made just for you.',
  module: './challenge/challenge-ui.js',
  accent: '#f2b705',
  art: `<svg viewBox="0 0 120 120" aria-hidden="true">
          <rect width="120" height="120" fill="#12151c"/>
          <circle cx="60" cy="55" r="30" fill="none" stroke="#f2b705" stroke-width="6"/>
          <text x="60" y="72" font-size="46" font-weight="900" text-anchor="middle" fill="#f2b705" font-family="system-ui, -apple-system, sans-serif">?</text>
          <g fill="#f2b705"><circle cx="22" cy="26" r="3"/><circle cx="99" cy="30" r="2.5"/><circle cx="28" cy="98" r="2.5"/><circle cx="96" cy="92" r="3"/></g>
        </svg>`,
};
const ADMIN_CARD = {
  id: 'challenge',
  title: 'Mission Control',
  blurb: 'Matt only.',
  module: './challenge/challenge-ui.js',
  accent: '#178a7a',
  art: `<svg viewBox="0 0 120 120" aria-hidden="true">
          <rect width="120" height="120" fill="#0e1b19"/>
          <circle cx="60" cy="60" r="34" fill="none" stroke="#178a7a" stroke-width="4"/>
          <circle cx="60" cy="60" r="20" fill="none" stroke="#178a7a" stroke-width="3"/>
          <line x1="60" y1="60" x2="90" y2="42" stroke="#f2b705" stroke-width="4"/>
          <circle cx="60" cy="60" r="5" fill="#f2b705"/>
        </svg>`,
};

class Hub {
  constructor(root) {
    this.root = root;
    this.current = null;     // { module, id } of the mounted game
    this._onBack = () => this.requestLeave();
    this.render();
  }

  render() {
    // Gate the hidden challenge entry on a hashed name match (inert for everyone else).
    const prof = loadProfile();
    const active = !!(prof && isChallengeActive(prof.name));
    const admin = !active && !!(prof && isAdmin(prof.name));
    this.games = GAMES.concat(active ? [CHALLENGE_CARD] : admin ? [ADMIN_CARD] : []);
    this.root.innerHTML = `
      <div class="hub">
        <header class="hub-top">
          <button type="button" class="hub-back" data-role="back" hidden aria-label="Back to hub">‹ Hub</button>
          <h1 class="hub-top-title" data-role="title">Matt's Game Hub</h1>
          <a class="hub-profile" data-role="profile" href="profile/">Set up your profile</a>
        </header>
        <main class="hub-main">
          <section class="hub-grid" data-role="grid" aria-label="Games">
            ${this.games.map((g) => this.cardHTML(g)).join('')}
          </section>
          <section class="hub-game" data-role="game" hidden></section>
        </main>
        <div class="hub-confirm" data-role="confirm" hidden>
          <div class="hub-confirm-scrim" data-role="confirm-cancel"></div>
          <div class="hub-confirm-card" role="dialog" aria-modal="true" aria-label="Leave game">
            <p class="hub-confirm-msg">Leave this game? Your current progress will be lost.</p>
            <div class="hub-confirm-actions">
              <button type="button" class="hub-cbtn hub-cbtn-ghost" data-role="confirm-cancel">Keep playing</button>
              <button type="button" class="hub-cbtn hub-cbtn-danger" data-role="confirm-leave">Leave game</button>
            </div>
          </div>
        </div>
      </div>`;

    this.el = {
      back: this.root.querySelector('[data-role="back"]'),
      title: this.root.querySelector('[data-role="title"]'),
      grid: this.root.querySelector('[data-role="grid"]'),
      game: this.root.querySelector('[data-role="game"]'),
      confirm: this.root.querySelector('[data-role="confirm"]'),
      profile: this.root.querySelector('[data-role="profile"]'),
    };

    // Reflect any saved profile in the header entry (textContent keeps names XSS-safe).
    this.el.profile.textContent = prof && prof.name ? `👤 ${prof.name}` : 'Set up your profile';
    this.el.profile.classList.toggle('hub-profile-empty', !(prof && prof.name));

    this.el.back.addEventListener('click', this._onBack);
    this.root.querySelectorAll('[data-role="confirm-cancel"]').forEach((el) =>
      el.addEventListener('click', () => { this.el.confirm.hidden = true; }));
    this.root.querySelector('[data-role="confirm-leave"]').addEventListener('click', () => {
      this.el.confirm.hidden = true;
      this.showLauncher();
    });
    this.el.grid.addEventListener('click', (e) => {
      const card = e.target.closest('.hub-card');
      if (!card) return;
      if (card.tagName === 'A') return;            // launch-out: real link, native nav
      if (card.dataset.comingSoon === 'true') return;
      this.launch(card.dataset.id);                // in-hub module: mount in place
    });

    this.maybePlayUnlock(active);
  }

  /** On first activation for the challenge profile, play the unlock announcement once. */
  maybePlayUnlock(active) {
    if (!active) return;
    try {
      if (loadChallenge().unlockSeen) return;
      markUnlockSeen();
      import('./challenge/unlock.js').then((m) => m.playUnlock()).catch(() => {});
    } catch { /* never break the hub */ }
  }

  cardHTML(g) {
    // Square tile: full-bleed art with the title in a caption. The blurb moves to
    // the accessible label (it is no longer shown on the compact tile face).
    const inner = `
        <span class="hub-card-art">${g.art}</span>
        <span class="hub-card-label">${g.title}</span>
        ${g.comingSoon ? '<span class="hub-soon-tag">Soon</span>' : ''}`;
    const aria = `${g.title}. ${g.blurb}`;
    // Launch-out games are real links (new-tab / middle-click / a11y); in-hub
    // modules are buttons that mount into the content area.
    if (g.href) {
      return `<a class="hub-card" href="${g.href}" style="--card-accent:${g.accent}" aria-label="${aria}">${inner}</a>`;
    }
    return `<button type="button" class="hub-card${g.comingSoon ? ' is-soon' : ''}"
              data-id="${g.id}" data-coming-soon="${!!g.comingSoon}"
              style="--card-accent:${g.accent}" aria-label="${aria}" ${g.comingSoon ? 'aria-disabled="true"' : ''}>${inner}</button>`;
  }

  async launch(id) {
    const game = this.games.find((g) => g.id === id);
    if (!game || game.comingSoon) return;

    // Tear down any previously mounted game first.
    await this.unmount();

    try {
      const module = await import(game.module);
      module.init(this.el.game);
      this.current = { module, id };
      this.el.title.textContent = game.title;
      this.el.back.hidden = false;
      this.el.grid.hidden = true;
      this.el.game.hidden = false;
      this.el.profile.hidden = true;
    } catch (e) {
      console.error(`Failed to load game "${id}"`, e);
      this.el.game.innerHTML = `<p class="hub-error">Couldn't load ${game.title}. Please try again.</p>`;
      this.el.game.hidden = false;
      this.el.grid.hidden = true;
      this.el.back.hidden = false;
      this.el.profile.hidden = true;
    }
  }

  /** Back-to-hub intent: confirm first if the game reports it's mid-play. */
  requestLeave() {
    const m = this.current && this.current.module;
    let inProgress = false;
    try { inProgress = !!(m && typeof m.isInProgress === 'function' && m.isInProgress()); } catch { /* ignore */ }
    if (inProgress) { this.el.confirm.hidden = false; return; }
    this.showLauncher();
  }

  async unmount() {
    if (this.current && typeof this.current.module.destroy === 'function') {
      try { this.current.module.destroy(); } catch (e) { console.warn('destroy() failed', e); }
    }
    this.current = null;
    this.el.game.innerHTML = '';
  }

  async showLauncher() {
    await this.unmount();
    this.el.game.hidden = true;
    this.el.grid.hidden = false;
    this.el.back.hidden = true;
    this.el.title.textContent = "Matt's Game Hub";
    this.el.profile.hidden = false;
  }

  destroy() {
    this.unmount();
    this.el.back.removeEventListener('click', this._onBack);
    this.root.innerHTML = '';
  }
}

let hubInstance = null;

/** Mount the hub shell into `root`. */
export function initHub(root) {
  if (hubInstance) hubInstance.destroy();
  hubInstance = new Hub(root);
  return hubInstance;
}

export default { initHub };
