// theme.js — applies the currently-configured appearance theme
// (dark/christmas/light/...) to this page, shared by board.html and
// admin.html. Also owns the optional per-theme background picture (see
// server/background-store.js) and the "open admin" gear button.
//
// The theme is a server-wide setting, shared by every screen and building
// (set from the admin page's Utseende tab, or seeded once from
// config.json's `theme` field - see server/theme-store.js) and pushed live
// to every open tab over the existing SSE stream, the same way an edited
// status or renamed person already updates an open tab with no reload.
// See server/themes.js for the list of themes and how to add one.
//
// This file only APPLIES a theme (sets data-theme, manages the falling
// snow some themes use, and the background layer); it does its own small,
// fast fetch of /api/theme + /api/backgrounds on load so the right look is
// showing as early as possible, independent of whatever else a given
// page's own boot() is doing. Each page's own connectEvents() forwards
// live 'theme'/'backgrounds' SSE events into window.applyTheme/
// window.refreshBackgrounds so a tab left open updates immediately - see
// board.js/admin.js.
(() => {
  let themeOptions = []; // last-known copy of themes.js's list (id/label/snow)
  let backgroundsById = {}; // last-known copy of /api/backgrounds

  function snowFlagFor(theme) {
    const def = themeOptions.find((t) => t.id === theme);
    return !!(def && def.snow);
  }

  // ----------------------------------------------------- background layer -
  // A dedicated fixed element behind everything else on the page (see
  // shared.css's #bgLayer stacking rules), rather than a body
  // background-image, so its opacity can be dialed independently of
  // whatever's drawn on top of it. Sits behind the board's person cards
  // (and behind the admin page's own panels) - never on top, never
  // intercepting a tap (pointer-events: none, in the CSS).
  function ensureBackgroundLayer() {
    let el = document.getElementById('bgLayer');
    if (!el && document.body) {
      el = document.createElement('div');
      el.id = 'bgLayer';
      el.setAttribute('aria-hidden', 'true');
      document.body.prepend(el);
    }
    return el;
  }

  function applyBackgroundFor(theme) {
    if (!document.body) return;
    const layer = ensureBackgroundLayer();
    const entry = backgroundsById[theme];
    if (entry && entry.url) {
      layer.style.backgroundImage = `url('${entry.url}')`;
      layer.style.opacity = String(entry.opacity != null ? entry.opacity : 1);
      layer.classList.add('active');
    } else {
      layer.style.backgroundImage = '';
      layer.classList.remove('active');
    }
  }

  function refreshBackgrounds() {
    return fetch('/api/backgrounds')
      .then((r) => r.json())
      .then((data) => {
        backgroundsById = data || {};
        applyBackgroundFor(document.documentElement.getAttribute('data-theme') || 'dark');
      })
      .catch(() => {
        // Offline/first-paint race - keep whatever's already showing until
        // the next 'backgrounds' SSE event or reload sorts it out.
      });
  }
  window.refreshBackgrounds = refreshBackgrounds;

  function applyTheme(theme) {
    if (theme) {
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    syncSnow(snowFlagFor(theme));
    if (document.body) applyBackgroundFor(theme); else document.addEventListener('DOMContentLoaded', () => applyBackgroundFor(theme), { once: true });
  }
  window.applyTheme = applyTheme;

  fetch('/api/theme')
    .then((r) => r.json())
    .then(({ theme, options }) => {
      themeOptions = options || [];
      applyTheme(theme);
    })
    .catch(() => {
      // Offline/first-paint race, extremely unlikely on a LAN - the page
      // just keeps :root's plain default styling until the next 'theme'
      // SSE event or reload sorts it out.
    });
  refreshBackgrounds();

  // --------------------------------------------------------- falling snow -
  // Only for themes with snow:true in themes.js, and only added/removed
  // here - nothing else on the page needs to know about it. Plain CSS
  // transform/opacity keyframes (see #snowLayer in shared.css) rather than
  // a per-frame JS loop, so it stays cheap on whatever's driving the board
  // (this project targets things like a Raspberry Pi - see README's "How
  // it's built"). Fixed-position and pointer-events:none (in the CSS), so
  // it never sits between a tap and the board underneath it.
  const SNOW_COUNT = 45;
  // Size range in px (a plain round div now, see .snowflake in shared.css -
  // no more unicode flake glyphs). Blur is set inversely to size below, for
  // a soft depth-of-field look: small "far away" flakes come out faintest
  // and blurriest, large "close" ones stay almost sharp.
  const SNOW_MIN_PX = 5;
  const SNOW_MAX_PX = 16;
  const SNOW_MAX_BLUR_PX = 2.2;

  function ensureSnow() {
    if (!document.body || document.getElementById('snowLayer')) return;
    const layer = document.createElement('div');
    layer.id = 'snowLayer';
    layer.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < SNOW_COUNT; i++) {
      const flake = document.createElement('span');
      flake.className = 'snowflake';
      const duration = 8 + Math.random() * 12; // seconds to fall the full height
      const size = SNOW_MIN_PX + Math.random() * (SNOW_MAX_PX - SNOW_MIN_PX);
      const sizeFrac = (size - SNOW_MIN_PX) / (SNOW_MAX_PX - SNOW_MIN_PX); // 0 (small) .. 1 (large)
      flake.style.left = (Math.random() * 100).toFixed(2) + '%';
      flake.style.setProperty('--flake-size', size.toFixed(1) + 'px');
      flake.style.setProperty('--flake-blur', (SNOW_MAX_BLUR_PX * (1 - sizeFrac)).toFixed(2) + 'px');
      flake.style.animationDuration = duration.toFixed(2) + 's';
      // Negative delay starts each flake already mid-fall, so the screen
      // looks like steady snow immediately instead of one bare burst at
      // the top the moment the theme is switched on.
      flake.style.animationDelay = (-Math.random() * duration).toFixed(2) + 's';
      flake.style.setProperty('--drift', (Math.random() * 90 - 45).toFixed(0) + 'px');
      // Smaller/blurrier flakes read as fainter too, on top of their own
      // blur, to sell the "farther away" effect; larger ones stay bolder.
      flake.style.setProperty('--flake-opacity', (0.35 + sizeFrac * 0.5).toFixed(2));
      layer.appendChild(flake);
    }
    document.body.appendChild(layer);
  }

  function removeSnow() {
    const layer = document.getElementById('snowLayer');
    if (layer) layer.remove();
  }

  function syncSnow(wantSnow) {
    if (!wantSnow) return removeSnow();
    if (document.body) return ensureSnow();
    // <body> doesn't exist yet (theme.js loads in <head>, on purpose, so
    // data-theme is set before first paint) - try again once it does.
    document.addEventListener('DOMContentLoaded', ensureSnow, { once: true });
  }

  // ------------------------------------------------------- config button -
  // A shortcut to the admin page. Flat, minimal line-style gear icon
  // (inline SVG, currentColor) rather than an emoji, so it matches
  // whichever theme/text color is active instead of carrying its own fixed
  // (and rather busy, multi-colored) glyph.
  const GEAR_SVG = '<svg viewBox="0 0 24 24" width="1.15em" height="1.15em" fill="none" stroke="currentColor" '
    + 'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<circle cx="12" cy="12" r="3"></circle>'
    + '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 '
    + '1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 '
    + '1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a'
    + '1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 '
    + '1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a'
    + '1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';

  window.initConfigButton = function (buttonEl) {
    if (!buttonEl) return;
    buttonEl.innerHTML = GEAR_SVG;
    buttonEl.setAttribute('aria-label', 'Öppna adminsidan');
    buttonEl.addEventListener('click', () => {
      window.location.href = '/admin.html';
    });
  };

  // --------------------------------------------------------- exit button -
  // The mirror image of the gear button above: a shortcut back to the
  // board, used on the admin page's own header (see admin.js). A plain
  // left-pointing arrow, same flat line-icon style as the gear.
  const EXIT_SVG = '<svg viewBox="0 0 24 24" width="1.15em" height="1.15em" fill="none" stroke="currentColor" '
    + 'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M11 5 L4 12 L11 19"></path><path d="M4 12 H20"></path></svg>';

  window.initExitButton = function (buttonEl) {
    if (!buttonEl) return;
    buttonEl.innerHTML = EXIT_SVG;
    buttonEl.setAttribute('aria-label', 'Till tavlan');
    buttonEl.title = 'Till tavlan';
    buttonEl.addEventListener('click', () => {
      window.location.href = '/board.html';
    });
  };
})();
