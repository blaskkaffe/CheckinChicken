// popup.js — shared behavior for every popup/modal in the app: a
// standardized round red "X" close button in the top-right corner, and an
// idle-timeout that closes the popup automatically after a stretch of no
// interaction inside it (tap, click, keypress, typing) - both used by the
// status popup (statuspopup.js) and by admin.js's add/edit dialogs.
// Default 5 minutes, editable from the admin page's Inställningar tab -
// see server/settings-store.js.
(() => {
  // Status colors (server/statuses.js's `color`) are plain fixed hex, not
  // theme-aware, and span everything from pale orange to dark navy - a
  // single fixed text color can't read well on all of them at once (dark
  // text on a dark blue pill, say). So instead of hardcoding one, pick per
  // pill: relative luminance (the standard WCAG formula) decides whether
  // light or dark text gets better contrast against THIS background, so
  // every pill stays readable in both themes regardless of which status
  // color it happens to be. Shared here (rather than living in board.js,
  // where it originated) because statuspopup.js's status buttons now use
  // the exact same per-status colors as board.js's pellets/badge - see
  // both files' own callers.
  window.readableTextOn = function (hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return '#0b0e16';
    const [r, g, b] = m.slice(1).map((h) => {
      const c = parseInt(h, 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.45 ? '#0b0e16' : '#f5f7fb';
  };

  let idleTimeoutMs = 5 * 60 * 1000; // default; refreshed below

  function readSettings(s) {
    if (s && Number.isFinite(s.popupIdleTimeoutMs)) idleTimeoutMs = s.popupIdleTimeoutMs;
  }

  fetch('/api/settings').then((r) => r.json()).then(readSettings).catch(() => {
    // Offline/first-paint race - keep the default above until the next
    // 'settings' SSE event or reload sorts it out.
  });

  // Each page's own connectEvents() forwards live 'settings' SSE events
  // here (see board.js/admin.js) so a tab left open picks up a changed
  // timeout immediately, same idea as window.applyTheme.
  window.applySettings = readSettings;

  // Builds (once per call) the standard close button, wired to call
  // `onClose` when tapped. Insert it into your popup's own markup - the
  // parent needs `position: relative` (shared.css's .modal/.popup-card
  // already have it); positioning itself comes from shared.css's
  // .popup-close.
  window.createPopupCloseButton = function (onClose) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'popup-close';
    btn.setAttribute('aria-label', 'Stäng');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">'
      + '<path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
    btn.addEventListener('click', onClose);
    return btn;
  };

  // Same size/shape as the close button above (shared.css's .popup-info
  // reuses .popup-close's own circle sizing), but a plain lowercase "i" in
  // a monospace SERIF face (Courier is the one common typeface that's
  // actually both at once - most "monospace" fonts are sans, most serif
  // fonts aren't fixed-width) rather than the close button's X glyph.
  // Currently only used by boardsettings.js (the popup opened by tapping
  // the clock) to switch to its "about" screen (name, running version,
  // logo, GitHub link) - see this button's own `onClick`.
  window.createPopupInfoButton = function (onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'popup-info';
    btn.setAttribute('aria-label', 'Om CheckinChicken');
    btn.innerHTML = '<span aria-hidden="true">i</span>';
    btn.addEventListener('click', onClick);
    return btn;
  };

  // Watches `rootEl` for activity and, whenever `isOpenFn()` is true and
  // `idleTimeoutMs` has passed since the last bit of activity, calls
  // `onIdleClose()` once. Returns a small controller:
  //   .noteActivity()  reset the clock (call this right after opening,
  //                     so it starts fresh rather than from whenever this
  //                     watcher happened to be created)
  //   .stop()           tear down the listeners/interval entirely
  window.watchPopupIdle = function (rootEl, isOpenFn, onIdleClose) {
    let lastActivityAt = Date.now();
    const bump = () => { lastActivityAt = Date.now(); };
    const events = ['pointerdown', 'keydown', 'input'];
    events.forEach((ev) => rootEl.addEventListener(ev, bump));
    const interval = setInterval(() => {
      if (isOpenFn() && Date.now() - lastActivityAt > idleTimeoutMs) {
        lastActivityAt = Date.now(); // avoid firing again next tick if onIdleClose doesn't hide it instantly
        onIdleClose();
      }
    }, 1000);
    return {
      noteActivity: bump,
      stop() {
        clearInterval(interval);
        events.forEach((ev) => rootEl.removeEventListener(ev, bump));
      },
    };
  };
})();
