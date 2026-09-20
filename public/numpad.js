// numpad.js — number-pad check-in: an alternative to touch/click for
// board.html. Works from any physical numeric input (a keyboard's top
// digit row, or a full PC/USB numpad - 0-9, "*", "#") without any on-screen
// button needing to be tapped first; typing a digit anywhere on the board
// (as long as nothing else has keyboard focus) just starts an entry.
//
// Code shape (see admin.js's "Nummer" field / README's "Number pad
// input"): a person's own 3-digit code is department (1 digit, 1-9) +
// a running number (2 digits, 00-99) - e.g. "127" is department 1, person
// 27. After those 3 digits, one or two more digits pick a status:
//   0        -> Ute (checks out)
//   1        -> Inne (checks in)
//   2-9, 0-9 -> a two-digit code into the secondary status list, in its
//               current admin-page order (see secondaryDigitCode below) -
//               e.g. "20" is the first secondary status, "21" the second,
//               ... "29" the eleventh, "30" the twelfth, and so on.
// "1271" is therefore department 1, person 27, status 1 (Inne) - exactly
// the example this feature was built around.
//
// # with just a person selected (3 digits, no status digit yet) toggles
//   Inne/Ute directly - the single most common action, done in 3 keys.
// * clears whatever's typed so far - the same "erase/back out" role it has
//   in every popup menu here. With NOTHING typed, * instead opens a
//   directory of every active person's number (see buildDirectory below),
//   so a code is always one glance away without a separate cheat sheet.
// Backspace removes the last digit (handy on a full keyboard; a bare
// numeric keypad has no backspace key, so * is the primary way to correct
// a mistake).
//
// A status that needs a time, date, or note (see server/statuses.js's
// needsTime/needsDate/needsNote) can't be finished by digits alone - typing
// its code hands off to the normal status popup (statuspopup.js's
// openWithStatus), already open on that one field, rather than trying to
// force free text through a numeric keypad.
(() => {
  let statusDefs = { primary: [], secondary: [] };
  let cfg = {};
  let enabled = false; // flips true once /api/config confirms numericInput !== false

  const IDLE_CLEAR_MS = 6000; // abandon a half-typed entry after this long of silence
  const RESULT_MS = 1400; // how long a success/error message lingers before the readout hides

  let buffer = ''; // digits typed so far, this entry
  let matchedPerson = null; // set once the first 3 digits match someone
  let errorText = ''; // non-empty while showing an error state
  let idleTimer = null;
  let resultTimer = null;

  const $ = (id) => document.getElementById(id);
  const readout = $('numpadReadout');
  const digitsEl = $('npDigits');
  const personEl = $('npPerson');
  const avatarEl = $('npAvatar');
  const nameEl = $('npName');
  const msgEl = $('npMsg');
  const dirOverlay = $('numpadDirectory');
  const dirList = $('npDirList');

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------------------------------------------------------- digit codes
  // Shared with admin.js's own primaryDigitCode/secondaryDigitCode (kept
  // as two independent copies, same as e.g. esc() above, rather than a
  // shared module - this is the one place the codebase already draws that
  // line, see e.g. statuspopup.js/board.js both having their own esc()).
  function secondaryDigitIndex(leadDigit, secondDigit) {
    return (Number(leadDigit) - 2) * 10 + Number(secondDigit);
  }

  // --------------------------------------------------------------- reset
  function resetBuffer() {
    buffer = '';
    matchedPerson = null;
    errorText = '';
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  function armIdleClear() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      resetBuffer();
      render();
    }, IDLE_CLEAR_MS);
  }

  // ------------------------------------------------------------- render -
  function render() {
    clearTimeout(resultTimer);
    if (!buffer && !errorText) {
      readout.hidden = true;
      return;
    }
    readout.hidden = false;
    readout.classList.toggle('error', !!errorText);
    digitsEl.textContent = buffer || '—';
    if (matchedPerson) {
      personEl.hidden = false;
      avatarEl.innerHTML = window.avatarHtml(matchedPerson, 'avatar-xs');
      nameEl.textContent = [matchedPerson.name, matchedPerson.department].filter(Boolean).join(' · ');
    } else {
      personEl.hidden = true;
    }
    if (errorText) {
      msgEl.textContent = errorText;
    } else if (!matchedPerson) {
      msgEl.textContent = buffer.length < 3 ? 'Ange personens nummer…' : 'Söker…';
    } else if (buffer.length === 3) {
      msgEl.textContent = '0 = Ute · 1 = Inne · # = växla · eller en statuskod';
    } else if (buffer.length === 4 && (buffer[3] === '0' || buffer[3] === '1')) {
      msgEl.textContent = 'Sparar…';
    } else if (buffer.length === 4) {
      msgEl.textContent = 'Ange andra sifferkoden…';
    } else {
      msgEl.textContent = 'Sparar…';
    }
  }

  function flashResult(text, ok) {
    readout.hidden = false;
    readout.classList.toggle('error', !ok);
    personEl.hidden = !matchedPerson;
    digitsEl.textContent = ok ? '✓' : '✕';
    msgEl.textContent = text;
    clearTimeout(idleTimer);
    clearTimeout(resultTimer);
    resultTimer = setTimeout(() => {
      resetBuffer();
      render();
    }, RESULT_MS);
  }

  function showError(text) {
    errorText = text;
    render();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { resetBuffer(); render(); }, RESULT_MS);
  }

  // ------------------------------------------------------------- commits
  async function postCheckin(person, payload) {
    const res = await fetch('/api/checkin/set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: person.id, ...payload }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'misslyckades');
  }

  function primaryLabel(code) {
    const def = statusDefs.primary.find((s) => s.code === code);
    return def ? def.label : (code === 'IN' ? 'Inne' : 'Ute');
  }

  async function commitPrimary(primary) {
    const person = matchedPerson;
    try {
      await postCheckin(person, { primary });
      flashResult(`${person.name} — ${primaryLabel(primary)}`, true);
    } catch (e) {
      flashResult('Kunde inte spara', false);
    }
  }

  async function commitSecondary(def) {
    const person = matchedPerson;
    if (def.needsTime || def.needsDate || def.needsNote) {
      // Can't finish this one from a numpad alone (it needs a typed time/
      // date/note) - hand off to the normal popup, already open on that
      // exact field, rather than pretending the numpad can take it.
      resetBuffer();
      render();
      window.StatusPopup && window.StatusPopup.openWithStatus(person.id, def.code);
      return;
    }
    try {
      await postCheckin(person, { secondaryCode: def.code });
      flashResult(`${person.name} — ${def.label}`, true);
    } catch (e) {
      flashResult('Kunde inte spara', false);
    }
  }

  // --------------------------------------------------------- key handling
  function handleDigit(d) {
    // Stage: person code already matched (3 digits in) - this digit picks
    // a status.
    if (matchedPerson && buffer.length === 3) {
      if (d === '0' || d === '1') {
        buffer += d;
        render();
        commitPrimary(d === '1' ? 'IN' : 'OUT');
        return;
      }
      buffer += d; // leading digit of a 2-digit secondary code (2-9)
      render();
      armIdleClear();
      return;
    }
    if (matchedPerson && buffer.length === 4) {
      const index = secondaryDigitIndex(buffer[3], d);
      buffer += d;
      const def = statusDefs.secondary[index];
      if (!def) { showError('Okänd status'); return; }
      render();
      commitSecondary(def);
      return;
    }
    // Still building the 3-digit person code.
    if (buffer.length >= 3) return; // a stuck error state - wait for it to clear, or * / backspace
    buffer += d;
    if (buffer.length === 3) {
      matchedPerson = window.BoardPeople && window.BoardPeople.byCode(buffer);
      if (!matchedPerson) { showError('Okänt nummer'); return; }
    }
    render();
    armIdleClear();
  }

  function handleBackspace() {
    if (!buffer) return;
    errorText = '';
    buffer = buffer.slice(0, -1);
    matchedPerson = buffer.length >= 3 ? (window.BoardPeople && window.BoardPeople.byCode(buffer.slice(0, 3))) : null;
    if (!buffer) { resetBuffer(); render(); return; }
    render();
    armIdleClear();
  }

  function handleHash() {
    if (matchedPerson && buffer.length === 3) {
      commitPrimary(matchedPerson.status?.checkedIn ? 'OUT' : 'IN');
    }
  }

  function handleStar() {
    if (buffer || errorText) { resetBuffer(); render(); return; }
    openDirectory();
  }

  // ----------------------------------------------------------- directory
  // "*" with nothing typed - every active person's number, grouped by
  // department, so the numpad is discoverable without a separate cheat
  // sheet taped to the wall. Tapping a row is the same as having typed
  // that number: it lands in the "person selected" stage, ready for a
  // status digit (or a touch tap on the board itself, since closing this
  // doesn't touch the board underneath).
  function buildDirectory() {
    const people = (window.BoardPeople ? window.BoardPeople.list() : [])
      .filter((p) => p.active !== false && p.code)
      .sort((a, b) => a.code.localeCompare(b.code, 'sv', { numeric: true }));
    if (!people.length) {
      dirList.innerHTML = '<p class="dim">Ingen har ett nummer ännu - lägg till ett på adminsidan.</p>';
      return;
    }
    dirList.innerHTML = people.map((p) => `
      <button type="button" class="numpad-dir-row" data-id="${esc(p.id)}">
        <span class="numpad-dir-code">${esc(p.code)}</span>
        ${window.avatarHtml(p, 'avatar-xs')}
        <span class="numpad-dir-name">${esc(p.name)}</span>
        <span class="numpad-dir-dept">${esc(p.department || '')}</span>
      </button>
    `).join('');
    dirList.querySelectorAll('.numpad-dir-row').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = window.BoardPeople.get(btn.dataset.id);
        closeDirectory();
        if (!p || !p.code) return;
        resetBuffer();
        buffer = p.code;
        matchedPerson = p;
        render();
        armIdleClear();
      });
    });
  }

  function isDirectoryOpen() { return dirOverlay.classList.contains('visible'); }
  function openDirectory() {
    buildDirectory();
    dirOverlay.classList.add('visible');
  }
  function closeDirectory() { dirOverlay.classList.remove('visible'); }

  dirOverlay.querySelector('.popup-backdrop').addEventListener('click', closeDirectory);
  dirOverlay.appendChild(window.createPopupCloseButton(closeDirectory));

  // ------------------------------------------------------------ dispatch
  // Ignored entirely while: disabled (numericInput: false server-wide),
  // some other popup already has the board's attention (status popup,
  // board-settings popup) - typing there should behave like normal
  // keyboard input, not get hijacked into a check-in - or the keypress
  // landed on an actual text field (the on-screen keyboard's own hidden
  // input, an admin field on another tab, etc.).
  function otherPopupOpen() {
    return (window.StatusPopup && window.StatusPopup.isOpen())
      || (window.BoardSettingsPopup && window.BoardSettingsPopup.isOpen());
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  document.addEventListener('keydown', (e) => {
    if (!enabled) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;

    if (isDirectoryOpen()) {
      if (e.key === '*' || e.key === 'Escape') { e.preventDefault(); closeDirectory(); }
      return;
    }
    if (otherPopupOpen()) return;

    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); handleDigit(e.key); return; }
    if (e.key === '*') { e.preventDefault(); handleStar(); return; }
    if (e.key === '#' || e.key === 'Enter') { e.preventDefault(); handleHash(); return; }
    if (e.key === 'Backspace') { e.preventDefault(); handleBackspace(); return; }
    if (e.key === 'Escape') { e.preventDefault(); resetBuffer(); render(); return; }
  });

  // ----------------------------------------------------------------- boot
  function boot() {
    Promise.all([
      fetch('/api/statuses').then((r) => r.json()),
      fetch('/api/config').then((r) => r.json()),
    ]).then(([defs, c]) => {
      statusDefs = defs;
      cfg = c;
      enabled = cfg.numericInput !== false;
    });

    // board.js dispatches these on its own SSE events (see its
    // connectEvents) - stay current the same way statuspopup.js does,
    // rather than keeping a second live connection open.
    document.addEventListener('checkin:statuses', (e) => { statusDefs = e.detail; });
    document.addEventListener('checkin:config', (e) => {
      cfg = e.detail;
      enabled = cfg.numericInput !== false;
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
