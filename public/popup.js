// popup.js — shared behavior for every popup/modal in the app: a
// standardized round red "X" close button in the top-right corner, and an
// idle-timeout that closes the popup automatically after a stretch of no
// interaction inside it (tap, click, keypress, typing) - both used by the
// status popup (statuspopup.js) and by admin.js's add/edit dialogs.
// Default 5 minutes, editable from the admin page's Inställningar tab -
// see server/settings-store.js.
(() => {
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
