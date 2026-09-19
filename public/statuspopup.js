// statuspopup.js — the popup that appears when someone taps a person's
// row on the board (see board.js's wireClickToEdit): every status
// button for that one already-selected person, on a single screen - no
// PIN, no keypad, nothing to type at all unless the status itself needs a
// time, date or note. Lives entirely inside board.html as an overlay (see
// the #statusPopup markup there); there is no separate page for this any
// more. A second, dedicated touch device for input just loads board.html
// too, exactly like the display - tapping a card there opens this same
// popup and updates every other open board instantly over SSE. See
// README's "Setup".
(() => {
  let statusDefs = { primary: [], secondary: [] };
  let cfg = {};
  let person = null;

  const state = {
    screen: 'menu',
    detailKind: null,          // 'time' | 'date'
    detailSecondaryCode: null,
    detailPrefix: '',
    // For detailKind 'time': a plain "HH:MM" string. For 'date': whatever
    // timepicker.js's buildDateOrWeekInput hands back - null (nothing
    // picked yet), { kind: 'day', date: 'YYYY-MM-DD' } or
    // { kind: 'week', week, isoYear } - see formatDetail() below.
    detailValue: '',
    noteSecondaryCode: null,
  };

  const $ = (id) => document.getElementById(id);
  const overlay = document.getElementById('statusPopup');
  const card = document.getElementById('statusPopupCard');

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function showScreen(name) {
    card.querySelectorAll('.sp-screen').forEach((el) => el.classList.remove('active'));
    $('sp-screen-' + name).classList.add('active');
    state.screen = name;
  }

  // IN/UTE's own label is editable from the admin page's "Statusar" tab -
  // read it here rather than hardcoding "Inne"/"Ute", so a renamed label
  // shows up everywhere it's used.
  function primaryLabel(code) {
    const def = statusDefs.primary.find((s) => s.code === code);
    return def ? def.label : (code === 'IN' ? 'Inne' : 'Ute');
  }

  function currentStatusLabel(p) {
    if (!p.status) return '';
    const parts = [`Just nu: ${primaryLabel(p.status.checkedIn ? 'IN' : 'OUT')}`];
    const def = statusDefs.secondary.find((s) => s.code === p.status.secondary);
    if (def) parts.push(def.label + (p.status.detail ? ` (${p.status.detail})` : ''));
    return parts.join(' · ');
  }

  function renderStatusGrid(container, defs, onChoice) {
    container.innerHTML = defs.map((d) => {
      const cls = d.code === 'IN' ? 'primary-in' : d.code === 'OUT' ? 'primary-out' : '';
      return `<button type="button" class="status-btn ${cls}" data-code="${esc(d.code)}">${esc(d.label)}</button>`;
    }).join('');
    container.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => onChoice(btn.dataset.code));
    });
  }

  function renderMenu() {
    if (!person) return;
    $('spAvatar').innerHTML = window.avatarHtml(person, 'avatar-lg');
    $('spName').textContent = person.name;
    $('spSub').textContent = [person.department, person.role].filter(Boolean).join(' · ');
    // Shown by default, right below the department/role line, in the same
    // style - see server.js's `phoneVisibility` (default 'always') and
    // shared.css's .phone-line. In 'hash'/'off' mode the server never even
    // sends the real number (see server.js's publicPerson()), so this is
    // just about what placeholder (if any) to show in its place.
    //
    // Only 'off' actually removes the row - that's a site-wide admin
    // choice that phone numbers never appear here at all, for anyone.
    // Otherwise the row always stays, even for a person with no phone on
    // file (a non-breaking space keeps its line height so it still takes
    // up its usual room) - so this header is always the same 4 lines in
    // the same order (name, department/role, phone, current status) no
    // matter which person's card is open, instead of the status line
    // hopping up a row for anyone without a phone number.
    if (cfg.phoneVisibility === 'off') {
      $('spPhone').style.display = 'none';
    } else {
      $('spPhone').style.display = '';
      if (cfg.phoneVisibility === 'hash') $('spPhone').textContent = 'Telefonnummer dolt';
      else if (person.phone) $('spPhone').textContent = `☎ ${person.phone}`;
      else $('spPhone').textContent = ' ';
    }
    $('spCurrent').textContent = currentStatusLabel(person);
    renderStatusGrid($('spStatusGrid'), [...statusDefs.primary, ...statusDefs.secondary], onMenuChoice);
  }

  function onMenuChoice(code) {
    if (code === 'IN' || code === 'OUT') return finalize({ primary: code });
    const def = statusDefs.secondary.find((s) => s.code === code);
    if (def) chooseSecondary(def);
  }

  function chooseSecondary(def) {
    if (def.needsTime || def.needsDate) {
      state.detailKind = def.needsTime ? 'time' : 'date';
      state.detailSecondaryCode = def.code;
      state.detailPrefix = def.detailPrefix || '';
      state.detailValue = def.needsTime ? '' : null;
      $('spDetailPrompt').textContent = def.label;
      const build = def.needsTime ? window.buildTimeInput : window.buildDateOrWeekInput;
      build($('spDetailInput'), { onChange: (v) => { state.detailValue = v; } });
      return showScreen('detail');
    }
    if (def.needsNote) {
      state.noteSecondaryCode = def.code;
      $('spNoteInput').value = '';
      return showScreen('note');
    }
    finalize({ secondaryCode: def.code });
  }

  function formatDetail() {
    if (!state.detailValue) return '';
    if (state.detailKind === 'time') return state.detailValue; // "HH:MM" already
    // 'date': a needsDate status isn't limited to a single day - the
    // calendar itself (timepicker.js's buildDateOrWeekInput) lets the
    // person tap either a day or a whole week's number, so detailValue is
    // shaped by whichever they actually tapped. Same "V" + last digit of
    // the ISO week-year + week number format as the board's own clock
    // (board.js's isoWeekInfo) for a week - kept in this one spot so the
    // two never drift apart.
    if (state.detailValue.kind === 'week') return `V${state.detailValue.isoYear % 10}${state.detailValue.week}`;
    const parts = state.detailValue.date.split('-'); // "YYYY-MM-DD"
    return parts.length === 3 ? `${parts[2]}/${parts[1]}` : '';
  }

  function detailSubmit() {
    const formatted = formatDetail();
    const detail = state.detailPrefix && formatted ? `${state.detailPrefix} ${formatted}` : formatted;
    finalize({ secondaryCode: state.detailSecondaryCode, detail });
  }

  function noteSubmit() {
    finalize({ secondaryCode: state.noteSecondaryCode, note: $('spNoteInput').value.trim() });
  }

  // ------------------------------------------------------- open / close --
  let idleWatcher = null;

  function isOpen() { return overlay.classList.contains('visible'); }

  function open(id) {
    const p = window.BoardPeople && window.BoardPeople.get(id);
    if (!p) return;
    person = p;
    renderMenu();
    showScreen('menu');
    overlay.classList.add('visible');
    idleWatcher && idleWatcher.noteActivity();
  }

  function close() {
    overlay.classList.remove('visible');
    person = null;
  }
  window.StatusPopup = { open, close, isOpen };

  async function finalize(payload) {
    if (!person) return close();
    try {
      await fetch('/api/checkin/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: person.id, ...payload }),
      });
    } catch (e) {
      // The board itself just keeps showing whatever the last known-good
      // state was - see README's offline/sync notes; nothing more to do
      // here.
    }
    // No confirmation screen and no delay: the new status is already
    // visible on the board itself (pushed over SSE) the instant it lands,
    // so lingering here would only slow the next person down.
    close();
  }

  function boot() {
    Promise.all([
      fetch('/api/statuses').then((r) => r.json()),
      fetch('/api/config').then((r) => r.json()),
    ]).then(([defs, c]) => {
      statusDefs = defs;
      cfg = c;
      // A tap fast enough to beat this initial fetch (e.g. right after
      // board.html loads) would have already called open() -> renderMenu()
      // against the still-empty defaults above, showing a status grid with
      // no buttons at all. Re-render now that the real data is in, same as
      // the checkin:statuses/checkin:config SSE handlers below already do
      // for a later change - if the popup isn't open, or has since moved
      // off the menu screen, this is a no-op.
      if (person && state.screen === 'menu') renderMenu();
    });

    card.appendChild(window.createPopupCloseButton(close));
    $('spDetailSkip').addEventListener('click', detailSubmit);
    $('spDetailBack').addEventListener('click', () => showScreen('menu'));
    $('spNoteSubmit').addEventListener('click', noteSubmit);
    $('spNoteBack').addEventListener('click', () => showScreen('menu'));
    overlay.querySelector('.popup-backdrop').addEventListener('click', close);

    window.attachOnscreenKeyboard($('spNoteInput'), { enabled: true });

    idleWatcher = window.watchPopupIdle(overlay, isOpen, close);

    // board.js dispatches these on its own SSE events (it already listens
    // for all of them for the board itself) so this popup - a separate
    // script sharing the same page - never shows something stale.
    document.addEventListener('checkin:statuses', (e) => {
      statusDefs = e.detail;
      if (!person) return;
      if (state.screen === 'menu') renderMenu();
    });
    document.addEventListener('checkin:config', (e) => { cfg = e.detail; if (person && state.screen === 'menu') renderMenu(); });
    document.addEventListener('checkin:person', (e) => {
      if (person && e.detail.id === person.id) { person = e.detail; if (state.screen === 'menu') renderMenu(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
