// boardsettings.js — the popup opened by tapping the clock on board.html:
// which building this screen shows, and a manual nudge on the board's
// automatic sizing. Also has a button to the real admin page, doing
// exactly what the old header gear icon used to.
//
// Deliberately CLIENT-SIDE ONLY, and deliberately reachable with NO
// passcode. The building filter and manual size nudge both live entirely
// in this one browser's localStorage (see board.js's window.BoardSettings)
// and never touch the server at all - so there is nothing here any other
// screen could ever be affected by, which is what makes it safe to leave
// unlocked. The only thing keeping a random person on the board from
// opening this is not knowing to tap the clock in the first place, which
// the README ("Screen settings") judges to be enough given this app's
// threat model (a trusted, offline LAN - see server.js's safeEqual comment
// for the same reasoning applied to the admin passcode's own timing
// safety).
//
// Everything server-wide - theme, background picture, roster, statuses,
// ... - stays admin-only, behind admin.html's own passcode gate, on
// purpose: a setting that would change what every OTHER screen shows too
// should always require the passcode, not just knowing where the clock is.
// This popup's only connection to any of that is the "Adminsidan" button
// at the bottom, which just navigates there (same as the old header gear
// icon did) rather than changing anything itself.
(() => {
  const $ = (id) => document.getElementById(id);
  const overlay = $('boardSettings');
  const card = $('boardSettingsCard');
  const clockBtn = document.getElementById('clock');

  // ----------------------------------------------------- building filter -
  function renderLocations() {
    const locations = window.BoardSettings.getLocations();
    const filter = window.BoardSettings.getFilter();
    // Same "nothing to pick between yet" case the old header dropdown used
    // to hide itself for - see board.js's ensureValidLocationFilter.
    if (locations.length < 2) {
      $('bsLocationSection').style.display = 'none';
      return;
    }
    $('bsLocationSection').style.display = '';
    const items = [{ value: '', label: 'Alla byggnader' }, ...locations.map((l) => ({ value: l, label: l }))];
    $('bsLocations').innerHTML = items.map((it) =>
      `<button type="button" class="bs-choice ${it.value === filter ? 'active' : ''}" data-loc="${esc(it.value)}">${esc(it.label)}</button>`
    ).join('');
    $('bsLocations').querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.BoardSettings.setFilter(btn.dataset.loc);
        renderLocations(); // reflect the new active choice immediately
      });
    });
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // --------------------------------------------------------- board size --
  function renderSize() {
    $('bsSizeReadout').textContent = window.BoardSettings.getManualScalePercent() + '%';
    $('bsSizeDown').disabled = window.BoardSettings.manualScaleAtMin();
    $('bsSizeUp').disabled = window.BoardSettings.manualScaleAtMax();
  }

  // ------------------------------------------------------- open / close --
  let idleWatcher = null;
  function isOpen() { return overlay.classList.contains('visible'); }

  function open() {
    overlay.classList.add('visible');
    idleWatcher && idleWatcher.noteActivity();
    // Both sections read straight out of localStorage (via
    // window.BoardSettings) - no server round trip needed to open this,
    // unlike admin.js's panels.
    renderLocations();
    renderSize();
  }
  function close() { overlay.classList.remove('visible'); }
  window.BoardSettingsPopup = { open, close, isOpen };

  clockBtn.addEventListener('click', open);
  card.appendChild(window.createPopupCloseButton(close));
  overlay.querySelector('.popup-backdrop').addEventListener('click', close);
  idleWatcher = window.watchPopupIdle(overlay, isOpen, close);

  $('bsSizeDown').addEventListener('click', () => { window.BoardSettings.adjustManualScale(-1); renderSize(); });
  $('bsSizeUp').addEventListener('click', () => { window.BoardSettings.adjustManualScale(1); renderSize(); });
  $('bsSizeReset').addEventListener('click', () => { window.BoardSettings.resetManualScale(); renderSize(); });

  // Same navigation the old header gear icon did (theme.js's
  // initConfigButton) - admin.html has its own passcode gate, this is
  // just the shortcut there, now reached from inside this popup instead
  // of a standing icon on the board itself (see README's "Screen
  // settings").
  $('bsAdminBtn').addEventListener('click', () => { window.location.href = '/admin.html'; });
})();
