// a2hs.js — hub-wide "Add to Home Screen" prompt. Standalone launch (no browser
// chrome) looks and plays much better than a browser tab, so on a mobile browser
// tab we suggest installing, once, as a dismissible bottom sheet. Never shown
// mid-game, never shown once already standalone. Persists nothing but the
// dismissal flag.

const DISMISS_KEY = 'hub-a2hs-dismissed-v1';
const SHOW_DELAY_MS = 1500;

// Android's native install flow. Must be captured at page load: the event only
// fires once and calling preventDefault() early is what lets us replay it later
// via a button tap instead of losing it to the browser's own mini-infobar.
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

function isDismissed() {
  try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return true; }
}
function setDismissed() {
  try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* best-effort */ }
}

function isStandalone() {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  } catch { return false; }
}

// iPadOS 13+ Safari sends a desktop-looking UA ("Macintosh...") but is still a
// touch device; maxTouchPoints is the tell.
function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/i.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

function isMobileDevice() {
  const ua = navigator.userAgent || '';
  if (!isIOS() && !/Android/i.test(ua)) return false;
  let coarse = false;
  try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch { /* ignore */ }
  const small = Math.min(window.innerWidth, window.innerHeight) <= 820;
  return coarse || small;
}

function platform() {
  if (isIOS()) return (navigator.userAgent || '').includes('CriOS') ? 'ios-chrome' : 'ios-safari';
  if (/Android/i.test(navigator.userAgent || '')) return 'android-chrome';
  return null;
}

// Never mid-game, and never stacked on top of another hub overlay (first-run
// name gate, leave-game confirm) that might already be open.
function onLauncherScreen() {
  const game = document.querySelector('[data-role="game"]');
  const firstrun = document.querySelector('[data-role="firstrun"]');
  const confirmBox = document.querySelector('[data-role="confirm"]');
  if (game && !game.hidden) return false;
  if (firstrun && !firstrun.hidden) return false;
  if (confirmBox && !confirmBox.hidden) return false;
  return true;
}

function stepHTML(text, img) {
  const shot = img
    ? `<img class="hub-a2hs-shot" src="${img}" alt="" loading="lazy" onerror="this.remove()">`
    : '';
  return `<li class="hub-a2hs-step">${shot}<span>${text}</span></li>`;
}

function bodyFor(p) {
  if (p === 'ios-safari') {
    return `<ol class="hub-a2hs-steps">
      ${stepHTML('Tap the Share button', 'icons/a2hs/ios-safari-share.png')}
      ${stepHTML('Then tap "Add to Home Screen"', 'icons/a2hs/ios-safari-add.png')}
    </ol>`;
  }
  if (p === 'ios-chrome') {
    return `<ol class="hub-a2hs-steps">
      ${stepHTML('Tap the Share button in the address bar', 'icons/a2hs/ios-chrome-share.png')}
      ${stepHTML('Then tap "Add to Home Screen"', 'icons/a2hs/ios-chrome-add.png')}
    </ol>`;
  }
  // android-chrome
  if (deferredPrompt) {
    return `<button type="button" class="hub-cbtn hub-cbtn-primary hub-a2hs-install" data-role="a2hs-install">Install</button>`;
  }
  return `<ol class="hub-a2hs-steps hub-a2hs-steps-text">
    ${stepHTML('Open the menu (⋮)')}
    ${stepHTML('Then tap "Add to Home Screen"')}
  </ol>`;
}

function showSheet(p) {
  const box = document.createElement('div');
  box.className = 'hub-a2hs';
  box.innerHTML = `
    <div class="hub-a2hs-scrim" data-role="a2hs-dismiss"></div>
    <div class="hub-a2hs-sheet" role="dialog" aria-modal="true" aria-label="Add to Home Screen">
      <button type="button" class="hub-a2hs-close" data-role="a2hs-dismiss" aria-label="Dismiss">&times;</button>
      <h2 class="hub-a2hs-title">Play it from your Home Screen</h2>
      <p class="hub-a2hs-line">Full screen, no browser bars. Add it once and launch it like an app.</p>
      ${bodyFor(p)}
    </div>`;
  document.body.appendChild(box);

  const dismiss = () => { setDismissed(); box.remove(); };
  box.querySelectorAll('[data-role="a2hs-dismiss"]').forEach((el) => el.addEventListener('click', dismiss));

  const installBtn = box.querySelector('[data-role="a2hs-install"]');
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      installBtn.disabled = true;
      try {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          await deferredPrompt.userChoice;
          deferredPrompt = null;
        }
      } catch { /* ignore */ }
      dismiss();
    });
  }
}

/** Mount the hub-wide Add-to-Home-Screen prompt. Call once at page load. */
export function initA2HSPrompt() {
  if (isDismissed() || isStandalone() || !isMobileDevice()) return;
  const p = platform();
  if (!p) return;
  setTimeout(() => {
    if (isDismissed() || isStandalone() || !onLauncherScreen()) return;
    showSheet(p);
  }, SHOW_DELAY_MS);
}

export default { initA2HSPrompt };
