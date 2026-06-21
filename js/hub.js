// hub.js — Game Hub shell: a launcher grid that mounts self-contained game
// modules into a single content area (no full page reload), using each
// module's standard contract:
//   init(container)  — mount the game
//   destroy()        — tear it down when the user goes back to the hub
//
// Adding a game = drop its folder under the hub and add an entry to GAMES.

const GAMES = [
  {
    id: 'connect-four',
    title: 'Connect Four',
    blurb: 'Drop discs, connect four. Four AI levels incl. a perfect endgame solver.',
    // Relative to this module (js/hub.js): up to root, then into the game folder.
    module: '../connect-four/js/ui.js',
    accent: '#1769d4',
    art: `<svg viewBox="0 0 120 120" aria-hidden="true">
            <rect width="120" height="120" rx="20" fill="#1769d4"/>
            <circle cx="42" cy="42" r="17" fill="#e8463f"/>
            <circle cx="78" cy="42" r="17" fill="#ffce3a"/>
            <circle cx="42" cy="78" r="17" fill="#ffce3a"/>
            <circle cx="78" cy="78" r="17" fill="#e8463f"/>
          </svg>`,
  },
  {
    id: 'chinchon',
    title: 'Chinchón',
    blurb: 'Spanish rummy vs. smart AI. Melds, cuts & chinchón. 2–4 players.',
    module: '../chinchon/js/ui.js',
    accent: '#d4a017',
    art: `<svg viewBox="0 0 120 120" aria-hidden="true">
            <rect width="120" height="120" rx="20" fill="#1f7a52"/>
            <rect x="30" y="34" width="40" height="56" rx="7" fill="#fff" transform="rotate(-9 50 62)"/>
            <rect x="52" y="34" width="40" height="56" rx="7" fill="#fff" transform="rotate(9 72 62)"/>
            <circle cx="50" cy="60" r="8" fill="#c8920f"/>
            <circle cx="74" cy="60" r="8" fill="#d22f27"/>
          </svg>`,
  },
  {
    id: 'business-deal',
    title: 'Business Deal',
    blurb: 'Cards, cash & schemes — collect property sets to win. vs. smart AI, 2–5 players.',
    // Business Deal is its own full-screen PWA deployed alongside the hub, so
    // the card launches out to it (root-relative on the same domain) rather
    // than mounting as an in-hub module.
    href: '/business-deal/',
    accent: '#6a4cff',
    art: `<svg viewBox="0 0 120 120" aria-hidden="true">
            <rect width="120" height="120" rx="20" fill="#6a4cff"/>
            <rect x="34" y="50" width="52" height="36" rx="6" fill="#fff" opacity="0.92"/>
            <rect x="50" y="40" width="20" height="12" rx="4" fill="#fff" opacity="0.92"/>
            <line x1="34" y1="66" x2="86" y2="66" stroke="#6a4cff" stroke-width="4"/>
          </svg>`,
  },
];

class Hub {
  constructor(root) {
    this.root = root;
    this.current = null;     // { module, id } of the mounted game
    this._onBack = () => this.requestLeave();
    this.render();
  }

  render() {
    this.root.innerHTML = `
      <div class="hub">
        <header class="hub-top">
          <button type="button" class="hub-back" data-role="back" hidden aria-label="Back to hub">‹ Hub</button>
          <h1 class="hub-top-title" data-role="title">Game Hub</h1>
        </header>
        <main class="hub-main">
          <section class="hub-grid" data-role="grid" aria-label="Games">
            ${GAMES.map((g) => this.cardHTML(g)).join('')}
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
    };

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
  }

  cardHTML(g) {
    const inner = `
        <span class="hub-card-art">${g.art}</span>
        <span class="hub-card-text">
          <span class="hub-card-title">${g.title}</span>
          <span class="hub-card-blurb">${g.blurb}</span>
        </span>
        ${g.comingSoon ? '<span class="hub-soon-tag">Soon</span>' : ''}`;
    // Launch-out games are real links (new-tab / middle-click / a11y); in-hub
    // modules are buttons that mount into the content area.
    if (g.href) {
      return `<a class="hub-card" href="${g.href}" style="--card-accent:${g.accent}">${inner}</a>`;
    }
    return `<button type="button" class="hub-card${g.comingSoon ? ' is-soon' : ''}"
              data-id="${g.id}" data-coming-soon="${!!g.comingSoon}"
              style="--card-accent:${g.accent}" ${g.comingSoon ? 'aria-disabled="true"' : ''}>${inner}</button>`;
  }

  async launch(id) {
    const game = GAMES.find((g) => g.id === id);
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
    } catch (e) {
      console.error(`Failed to load game "${id}"`, e);
      this.el.game.innerHTML = `<p class="hub-error">Couldn't load ${game.title}. Please try again.</p>`;
      this.el.game.hidden = false;
      this.el.grid.hidden = true;
      this.el.back.hidden = false;
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
    this.el.title.textContent = 'Game Hub';
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
