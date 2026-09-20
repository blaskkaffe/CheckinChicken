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
//               current admin-page order (see statuspopup.js's own
//               digitCodeFor) - e.g. "20" is the first secondary status,
//               "21" the second, ... "29" the eleventh, "30" the twelfth,
//               and so on.
// "1271" is therefore department 1, person 27, status 1 (Inne) - exactly
// the example this feature was built around.
//
// What each key does depends on whether anything's been typed yet:
//   Nothing typed:
//     # toggles the whole BOARD between normal avatars and a "number
//       mode" that shows every person's own code instead (see
//       window.BoardNumberMode, driven from board.js) - a visual lookup,
//       the "cheat sheet" for what to type for someone. Its OTHER job
//       (below) only exists once a person is matched, so this gives it
//       something to do before that.
//     * does nothing - it's purely a "clear" key (see below), and there's
//       nothing to clear yet.
//   Something typed (a person's number, in progress or fully matched):
//     * clears the current entry - the same "erase/back out" role it has
//       in every popup menu here.
//     # toggles Inne/Ute directly, once a person is fully matched (3
//       digits) - the single most common action, done in 3 keys + #.
//   Backspace removes the last digit typed (a bare numeric keypad has no
//   backspace key - use * there instead).
//
// The moment a full 3-digit code matches someone, this opens the exact
// same status popup a touch tap on their row would (statuspopup.js's
// open()) - every status button, now also showing its own digit code
// (statuspopup.js's renderStatusGrid) - rather than a blind guessing
// game. From there, typing the rest of a status's digit code picks that
// same button (window.StatusPopup.choose) exactly as tapping it would; a
// status needing a time/date/note switches that popup to its own detail/
// note screen, same as a touch tap - a numpad can't type free text, so
// finishing that one field is left to touch/the on-screen keyboard.
(() => {
  let statusDefs = { primary: [], secondary: [] };
  let cfg = {};
  let enabled = false; // flips true once /api/config confirms numericInput !== false

  const IDLE_CLEAR_MS = 6000; // abandon a half-typed entry after this long of silence
  const RESULT_MS = 1400; // how long a success/error message lingers before the readout hides

  let buffer = ''; // digits typed so far, this entry
  let matchedPerson = null; // set once the first 3 digits match someone
  let errorText = ''; // non-empty while showing an error state
  // Whether the currently-open status popup (if any) is the one THIS
  // module opened, by matching a typed number - as opposed to one someone
  // opened by tapping a row, which numpad.js should never drive digit
  // presses into (see the keydown dispatcher below).
  let numpadOwnsPopup = false;
  let idleTimer = null;
  let resultTimer = null;
  // True for the ~1.4s a success/error checkmark is showing after a
  // commit (see flashResult) - buffer/matchedPerson are stale leftovers
  // from the JUST-FINISHED entry during that window, not a new one in
  // progress, so the very next keypress (the next person already starting
  // to type) must not be read as continuing them - see the dispatcher
  // below, which clears this stale state the moment any key lands while
  // it's true, before processing that key.
  let flashing = false;

  const $ = (id) => document.getElementById(id);
  const readout = $('numpadReadout');
  const digitsEl = $('npDigits');
  const personEl = $('npPerson');
  const avatarEl = $('npAvatar');
  const nameEl = $('npName');
  const msgEl = $('npMsg');

  // ---------------------------------------------------------- digit codes
  // The reverse of statuspopup.js's digitCodeFor - a two-digit code typed
  // in (leading digit, second digit) back to that status's index in the
  // secondary list. Kept as an independent copy, same as e.g. esc() would
  // be - this is the one place the codebase already draws that line, see
  // e.g. statuspopup.js/board.js both having their own esc().
  function secondaryDigitIndex(leadDigit, secondDigit) {
    return (Number(leadDigit) - 2) * 10 + Number(secondDigit);
  }

  function primaryLabel(code) {
    const def = statusDefs.primary.find((s) => s.code === code);
    return def ? def.label : (code === 'IN' ? 'Inne' : 'Ute');
  }

  // --------------------------------------------------------------- reset
  // `closePopup` (default true): whether to also close a popup THIS
  // module opened. Passed false when handing off to that popup's own
  // detail/note screen (a status needing a time/date/note) - there the
  // popup should stay open for the person to finish, only this module's
  // own small readout goes away.
  function resetBuffer(closePopup) {
    if (closePopup !== false && numpadOwnsPopup) {
      window.StatusPopup && window.StatusPopup.close();
    }
    numpadOwnsPopup = false;
    buffer = '';
    matchedPerson = null;
    errorText = '';
    flashing = false;
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
      msgEl.textContent = '0 = Ute · 1 = Inne · # = växla · eller välj en status';
    } else if (buffer.length === 4 && (buffer[3] === '0' || buffer[3] === '1')) {
      msgEl.textContent = 'Sparar…';
    } else if (buffer.length === 4) {
      msgEl.textContent = 'Ange andra sifferkoden…';
    } else {
      msgEl.textContent = 'Sparar…';
    }
  }

  function flashResult(text, ok) {
    flashing = true;
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

  // Person-not-found: nothing to show but the small readout, and no
  // popup was ever opened for this attempt - a full reset once the
  // message has had a moment to be read.
  function showError(text) {
    errorText = text;
    render();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { resetBuffer(); render(); }, RESULT_MS);
  }

  // Bad status code with a person ALREADY matched and their popup already
  // open: drop back to just the person's 3 digits (not a full reset) and
  // leave the popup open - the whole point of showing it is so they can
  // look at the real buttons and either retype a valid code or just tap
  // one, rather than starting the person lookup over from scratch.
  function showStatusCodeError(text) {
    errorText = text;
    buffer = matchedPerson.code;
    render();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      errorText = '';
      render();
      armIdleClear();
    }, RESULT_MS);
  }

  // ------------------------------------------------------------- commit -
  // Drives the real status popup exactly as a touch tap on `code`'s own
  // button would (statuspopup.js's window.StatusPopup.choose ==
  // onMenuChoice) - it returns a Promise<boolean> once this choice
  // actually saves (IN/OUT, or a status with nothing else to fill in), or
  // undefined when it instead switched that popup to its own detail/note
  // screen and is waiting on the person - see choose's own comment.
  async function commitCode(code, label) {
    const person = matchedPerson;
    const result = window.StatusPopup && window.StatusPopup.choose(code);
    if (result && typeof result.then === 'function') {
      numpadOwnsPopup = false; // choose() already closed it, one way or another
      const ok = await result;
      flashResult(`${person.name} — ${label}`, ok);
    } else {
      // Switched to the detail/note screen - step out of the way, leave
      // the popup open for the person to finish by touch/on-screen
      // keyboard.
      resetBuffer(false);
      render();
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
        commitCode(d === '1' ? 'IN' : 'OUT', primaryLabel(d === '1' ? 'IN' : 'OUT'));
        return;
      }
      buffer += d; // leading digit of a 2-digit secondary code (2-9)
      render();
      armIdleClear();
      return;
    }
    if (matchedPerson && buffer.length === 4) {
      const index = secondaryDigitIndex(buffer[3], d);
      const def = statusDefs.secondary[index];
      if (!def) { showStatusCodeError('Okänd status'); return; }
      buffer += d;
      render();
      commitCode(def.code, def.label);
      return;
    }
    // Still building the 3-digit person code.
    if (buffer.length >= 3) return; // a stuck error state - wait for it to clear, or * / backspace
    buffer += d;
    if (buffer.length === 3) {
      matchedPerson = window.BoardPeople && window.BoardPeople.byCode(buffer);
      if (!matchedPerson) { showError('Okänt nummer'); return; }
      // Full pincode typed - open the same popup a touch tap on this
      // person's row would, so every status (with its own digit code) is
      // right there to either tap or keep typing towards.
      window.StatusPopup && window.StatusPopup.open(matchedPerson.id);
      numpadOwnsPopup = true;
    }
    render();
    armIdleClear();
  }

  function handleBackspace() {
    if (!buffer) return;
    errorText = '';
    buffer = buffer.slice(0, -1);
    if (buffer.length < 3 && matchedPerson) {
      // Editing back out of a full match - close the popup this module
      // opened for it, same as * would.
      if (numpadOwnsPopup) { window.StatusPopup && window.StatusPopup.close(); numpadOwnsPopup = false; }
      matchedPerson = null;
    }
    if (!buffer) { resetBuffer(false); render(); return; }
    render();
    armIdleClear();
  }

  function handleHash() {
    if (matchedPerson && buffer.length === 3) {
      const code = matchedPerson.status?.checkedIn ? 'OUT' : 'IN';
      commitCode(code, primaryLabel(code));
      return;
    }
    if (!buffer && !errorText) {
      // Nothing typed: # has nothing else to do at this stage, so it
      // doubles as the board's own number-display toggle (see
      // window.BoardNumberMode) - the same key that's about to mean
      // "Inne/Ute" the moment a person's matched.
      window.BoardNumberMode && window.BoardNumberMode.toggle();
    }
    // Still mid-entry (1-2 digits, no match yet): no-op either way.
  }

  function handleStar() {
    // * is purely "clear" - nothing typed means nothing to clear.
    if (buffer || errorText) { resetBuffer(); render(); }
  }

  // ------------------------------------------------------------ dispatch
  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  document.addEventListener('keydown', (e) => {
    if (!enabled) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;
    if (window.BoardSettingsPopup && window.BoardSettingsPopup.isOpen()) return;

    // A status popup is open: only keep driving it by digits if THIS
    // module opened it AND it's still on the plain menu screen - the
    // moment either isn't true (someone tapped a row themselves, or a
    // status needing a time/date/note switched screens, by touch or by
    // this module's own commitCode above), typing should behave like
    // normal keyboard input again, not get hijacked into a check-in.
    if (window.StatusPopup && window.StatusPopup.isOpen()) {
      const drivingIt = numpadOwnsPopup && window.StatusPopup.isMenuScreen();
      if (!drivingIt) return;
    }

    let action = null;
    if (/^[0-9]$/.test(e.key)) action = () => handleDigit(e.key);
    else if (e.key === '*') action = handleStar;
    else if (e.key === '#' || e.key === 'Enter') action = handleHash;
    else if (e.key === 'Backspace') action = handleBackspace;
    else if (e.key === 'Escape') action = () => { resetBuffer(); render(); };
    if (!action) return;

    e.preventDefault();
    // A fresh keypress always means "start paying attention to ME now" -
    // if the readout is still just showing the PREVIOUS entry's result
    // (see `flashing`'s own comment), clear that leftover state first so
    // this key is read as the start of a new entry, not a continuation of
    // one that already finished.
    if (flashing) { resetBuffer(); render(); }
    action();
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
