// boardsettings.js — the popup opened by tapping the clock on board.html:
// this screen's own title override, which coop it shows, a manual nudge
// on the board's automatic sizing, and whether the clock's week number
// includes the year digit. Also has a button to the real admin page,
// doing exactly what the old header gear icon used to.
//
// Deliberately CLIENT-SIDE ONLY, and deliberately reachable with NO
// passcode. The title override, coop filter, manual size nudge, and
// week-format choice all live entirely in this one browser's localStorage
// (see board.js's window.BoardSettings) and never touch the server at
// all - so there is
// nothing here any other screen could ever be affected by, which is what
// makes it safe to leave unlocked. The only thing keeping a random person
// on the board from opening this is not knowing to tap the clock in the
// first place, which the README ("Screen settings") judges to be enough
// given this app's threat model (a trusted, offline LAN - see server.js's
// safeEqual comment for the same reasoning applied to the admin
// passcode's own timing safety).
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

  // ----------------------------------------------------- coop filter -
  // Each coop pill toggles independently (any number can be selected at
  // once, shown together - see board.js's visible()), rather than the
  // old single-select radio-style picker. "Alla områden" is its own
  // separate toggle, not just "nothing else selected": tapping it clears
  // every individual selection outright (so it also covers any coop
  // added later, unlike manually selecting all of today's coops one by
  // one - a real difference, so this app never derives one state from
  // the other).
  function renderLocations() {
    const locations = window.BoardSettings.getLocations();
    // Same "nothing to pick between yet" case the old header dropdown used
    // to hide itself for - see board.js's ensureValidLocationFilter.
    if (locations.length < 2) {
      $('bsLocationSection').style.display = 'none';
      return;
    }
    $('bsLocationSection').style.display = '';
    const isAll = window.BoardSettings.isFilterAll();
    const items = [
      { value: '', label: 'Alla områden', all: true, active: isAll },
      ...locations.map((l) => ({ value: l, label: l, all: false, active: !isAll && window.BoardSettings.isFilterSelected(l) })),
    ];
    $('bsLocations').innerHTML = items.map((it) =>
      `<button type="button" class="bs-choice ${it.active ? 'active' : ''}" data-loc="${esc(it.value)}" data-all="${it.all ? '1' : ''}">${esc(it.label)}</button>`
    ).join('');
    $('bsLocations').querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.all) window.BoardSettings.setFilterAll();
        else window.BoardSettings.toggleFilter(btn.dataset.loc);
        renderLocations(); // reflect the new active choice(s) immediately
      });
    });
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // -------------------------------------------------------- screen title --
  // Unlike every other control here, this is a plain text field rather
  // than a set of pill buttons - so it's a single persistent element (see
  // board.html) with its own event listeners wired once, further down,
  // instead of being rebuilt on every open() like renderLocations/
  // renderWeekFormat above. This just fills in its current value each
  // time the popup opens - the server's own name shown as the empty-
  // field placeholder, so leaving it blank clearly reads as "use that".
  function renderTitle() {
    $('bsTitleInput').placeholder = window.BoardSettings.getServerTitle();
    $('bsTitleInput').value = window.BoardSettings.getTitleOverride();
  }

  // --------------------------------------------------------- board size --
  function renderSize() {
    $('bsSizeReadout').textContent = window.BoardSettings.getManualScalePercent() + '%';
    $('bsSizeDown').disabled = window.BoardSettings.manualScaleAtMin();
    $('bsSizeUp').disabled = window.BoardSettings.manualScaleAtMax();
  }

  // ------------------------------------------------------- week format --
  // Same pill-button pattern as the coop picker above - see board.js's
  // weekShowYear for what this actually changes (the clock's "V45" vs
  // "V645").
  function renderWeekFormat() {
    const showYear = window.BoardSettings.getWeekShowYear();
    const items = [
      { value: false, label: 'Endast vecka' },
      { value: true, label: 'Med årssiffra' },
    ];
    $('bsWeekFormat').innerHTML = items.map((it) =>
      `<button type="button" class="bs-choice ${it.value === showYear ? 'active' : ''}" data-show="${it.value ? '1' : ''}">${esc(it.label)}</button>`
    ).join('');
    $('bsWeekFormat').querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.BoardSettings.setWeekShowYear(!!btn.dataset.show);
        renderWeekFormat(); // reflect the new active choice immediately
      });
    });
  }

  // -------------------------------------------------------------- about --
  // The "i" button replaces the whole popup with an about screen (name,
  // version, logo, GitHub link) rather than appending it below the
  // settings - same one-screen-at-a-time pattern as statuspopup.html's
  // .sp-screen, just with no way back except closing the popup outright
  // (the red X) - reopening the clock always starts fresh on the main
  // settings screen again (see open() below).
  //
  // Version is fetched lazily (only once the about screen is actually
  // opened, and only the first time - cached in `versionText` after that)
  // rather than up front on open(), so the popup itself keeps opening with
  // zero server round trips unless someone actually asks for the version.
  let versionText = null;
  function showScreen(name) {
    card.querySelectorAll('.bs-screen').forEach((el) => el.classList.remove('active'));
    $('bs-screen-' + name).classList.add('active');
  }
  function showAbout() {
    showScreen('about');
    if (versionText) return; // already fetched this page load
    fetch('/api/version').then((r) => r.json()).then((v) => {
      versionText = `${v.name} v${v.version}`;
      $('bsVersionText').textContent = versionText;
    }).catch(() => {
      $('bsVersionText').textContent = 'Kunde inte hämta versionsinformation.';
    });
  }

  // ------------------------------------------------------- open / close --
  let idleWatcher = null;
  function isOpen() { return overlay.classList.contains('visible'); }

  function open() {
    overlay.classList.add('visible');
    idleWatcher && idleWatcher.noteActivity();
    showScreen('main'); // always reopens on the main settings, not about
    // All sections read straight out of localStorage (via
    // window.BoardSettings) - no server round trip needed to open this,
    // unlike admin.js's panels.
    renderTitle();
    renderLocations();
    renderSize();
    renderWeekFormat();
  }
  function close() { overlay.classList.remove('visible'); }
  window.BoardSettingsPopup = { open, close, isOpen };

  clockBtn.addEventListener('click', open);
  card.appendChild(window.createPopupCloseButton(close));
  card.appendChild(window.createPopupInfoButton(showAbout));
  overlay.querySelector('.popup-backdrop').addEventListener('click', close);
  idleWatcher = window.watchPopupIdle(overlay, isOpen, close);

  $('bsSizeDown').addEventListener('click', () => { window.BoardSettings.adjustManualScale(-1); renderSize(); });
  $('bsSizeUp').addEventListener('click', () => { window.BoardSettings.adjustManualScale(1); renderSize(); });
  $('bsSizeReset').addEventListener('click', () => { window.BoardSettings.resetManualScale(); renderSize(); });

  // 'change' (fires on blur/Enter), not 'input' - applying on every
  // keystroke would rewrite the header text mid-typing for no benefit,
  // since this is a per-device preference nobody else ever sees update
  // live.
  $('bsTitleInput').addEventListener('change', () => {
    window.BoardSettings.setTitleOverride($('bsTitleInput').value);
    renderTitle(); // re-normalizes (trimmed) value/placeholder into the field
  });
  $('bsTitleReset').addEventListener('click', () => {
    window.BoardSettings.setTitleOverride('');
    renderTitle();
  });

  // Same navigation the old header gear icon did (theme.js's
  // initConfigButton) - admin.html has its own passcode gate, this is
  // just the shortcut there, now reached from inside this popup instead
  // of a standing icon on the board itself (see README's "Screen
  // settings").
  $('bsAdminBtn').addEventListener('click', () => { window.location.href = '/admin.html'; });
})();
