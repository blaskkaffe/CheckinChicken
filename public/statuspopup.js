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

  // Same background color (and same luminance-picked contrasting text -
  // popup.js's window.readableTextOn) as the status's own pellet/badge on
  // the board itself (board.js's personRowHtml) - so picking a status here
  // and spotting it on the board afterward is visually the same color,
  // not just the same word.
  // The exact same digit code numpad.js would have someone type for this
  // status (see its own comment on the scheme): IN/OUT are the fixed
  // single digits 1/0; every other status gets a 2-digit code from its
  // position in the secondary list (2-9 as the leading digit, 0-9 as the
  // second) - so reordering a status on the admin "Statusar" tab changes
  // its digit code here too, same as it already changes where the status
  // shows up in this exact grid.
  function digitCodeFor(code) {
    if (code === 'IN') return '1';
    if (code === 'OUT') return '0';
    const i = statusDefs.secondary.findIndex((s) => s.code === code);
    return i < 0 ? '' : `${2 + Math.floor(i / 10)}${i % 10}`;
  }

  function renderStatusGrid(container, defs, onChoice) {
    // Codes are only worth showing if numeric input is actually on for
    // this server (server.js's `numericInput`, default true) - otherwise
    // they're just unexplained clutter on every button for a server that
    // doesn't use the numpad at all.
    const showCodes = cfg.numericInput !== false;
    container.innerHTML = defs.map((d) => {
      const cls = d.code === 'IN' ? 'primary-in' : d.code === 'OUT' ? 'primary-out' : '';
      const textColor = window.readableTextOn(d.color);
      const digit = showCodes ? digitCodeFor(d.code) : '';
      const codeHtml = digit ? `<span class="status-btn-code">${esc(digit)}</span>` : '';
      return `<button type="button" class="status-btn ${cls}" data-code="${esc(d.code)}" style="background:${esc(d.color)};color:${esc(textColor)}">${codeHtml}${esc(d.label)}</button>`;
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

  // Returns finalize()'s promise when this choice saves right away
  // (IN/OUT, or a secondary status with no detail to fill in), or
  // undefined when it instead switches to the detail/note screen to wait
  // for a time/date/note first - numpad.js (driving this same function by
  // digit code - see window.StatusPopup.choose below) uses that
  // difference to know whether to show its own "saved" flash or just step
  // out of the way and leave this popup open for the person to finish.
  function onMenuChoice(code) {
    if (code === 'IN' || code === 'OUT') return finalize({ primary: code });
    const def = statusDefs.secondary.find((s) => s.code === code);
    if (def) return chooseSecondary(def);
  }

  function chooseSecondary(def) {
    if (def.needsTime || def.needsDate) {
      state.detailKind = def.needsTime ? 'time' : 'date';
      state.detailSecondaryCode = def.code;
      state.detailPrefix = def.detailPrefix || '';
      // needsTime starts pre-filled at this status's own configured
      // defaultTime (admin's "Statusar" tab - server/statuses.js's own
      // defaultTime comment), or blank if none is set - same blank-until-
      // chosen safety buildTimeInput always had otherwise. needsDate has
      // no equivalent "default" (a status/detail concept, not a date
      // that'd ever make sense pre-filled).
      state.detailValue = def.needsTime ? (def.defaultTime || '') : null;
      $('spDetailPrompt').textContent = def.label;
      const build = def.needsTime ? window.buildTimeInput : window.buildDateOrWeekInput;
      build($('spDetailInput'), { initial: def.needsTime ? def.defaultTime : undefined, onChange: (v) => { state.detailValue = v; } });
      return showScreen('detail');
    }
    if (def.needsNote) {
      state.noteSecondaryCode = def.code;
      $('spNoteInput').value = '';
      return showScreen('note');
    }
    return finalize({ secondaryCode: def.code });
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

  // numpad.js's own way to drive this exact popup once someone's typed a
  // full status digit-code (see its own comment on the scheme) - same
  // function a touch tap on one of renderStatusGrid's buttons calls, so
  // typing a code and tapping a button always do the exact same thing.
  // Returns onMenuChoice's own return value: a Promise<boolean> (saved
  // ok?) once this choice actually saves, or undefined when it instead
  // switched to the detail/note screen and is waiting on the person to
  // fill that in by touch/keyboard - see onMenuChoice's own comment.
  window.StatusPopup = {
    open, close, isOpen,
    choose: onMenuChoice,
    isMenuScreen: () => state.screen === 'menu',
  };

  // Returns whether the save actually succeeded - the touch flow itself
  // doesn't care (no confirmation screen either way, see below), but
  // numpad.js's own "saved"/"failed" flash (driving this via `choose`
  // above) does.
  async function finalize(payload) {
    if (!person) { close(); return false; }
    let ok = true;
    try {
      const res = await fetch('/api/checkin/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: person.id, ...payload }),
      });
      if (!res.ok) ok = false;
    } catch (e) {
      // The board itself just keeps showing whatever the last known-good
      // state was - see README's offline/sync notes; nothing more to do
      // here.
      ok = false;
    }
    // No confirmation screen and no delay: the new status is already
    // visible on the board itself (pushed over SSE) the instant it lands,
    // so lingering here would only slow the next person down.
    close();
    return ok;
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
