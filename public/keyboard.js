// keyboard.js — a shared, touch-friendly Swedish QWERTY on-screen keyboard.
// Used everywhere text is typed in this app (the status popup's free-text
// note field, admin's name/department/role/status-label fields, ...) so
// it's the exact same layout and feel no matter which screen you're on -
// see window.attachOnscreenKeyboard below for how a page opts a field in
// (or out - some pages, like admin's people list, are normally worked from
// a desk with a real keyboard and leave this off by default).
(() => {
  // Standard Swedish physical-keyboard letter layout (Å/Ä/Ö in their usual
  // spots), rather than plain 26-letter QWERTY - this is what "the Swedish
  // keyboard" means to anyone who's used one.
  const ROWS = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', 'Å'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ö', 'Ä'],
    ['⇧', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', '⌫'],
  ];

  function buildKeyboardEl(onKey) {
    const wrap = document.createElement('div');
    wrap.className = 'onscreen-keyboard';
    let shift = false;

    function render() {
      wrap.innerHTML = '';
      ROWS.forEach((row) => {
        const rowEl = document.createElement('div');
        rowEl.className = 'kb-row';
        row.forEach((key) => {
          const isFn = key === '⇧' || key === '⌫';
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'kb-key' + (isFn ? ' kb-fn' : '') + (key === '⇧' && shift ? ' kb-active' : '');
          btn.textContent = isFn ? key : (shift ? key : key.toLowerCase());
          btn.addEventListener('click', () => {
            if (key === '⇧') { shift = !shift; render(); return; }
            if (key === '⌫') { onKey('BACKSPACE'); return; }
            onKey(shift ? key : key.toLowerCase());
            if (shift) { shift = false; render(); }
          });
          rowEl.appendChild(btn);
        });
        wrap.appendChild(rowEl);
      });
      const spaceRow = document.createElement('div');
      spaceRow.className = 'kb-row';
      const space = document.createElement('button');
      space.type = 'button';
      space.className = 'kb-key kb-space';
      space.textContent = 'mellanslag';
      space.addEventListener('click', () => onKey(' '));
      spaceRow.appendChild(space);
      const done = document.createElement('button');
      done.type = 'button';
      done.className = 'kb-key kb-fn kb-done';
      done.textContent = 'Klar';
      done.addEventListener('click', () => onKey('DONE'));
      spaceRow.appendChild(done);
      wrap.appendChild(spaceRow);
    }
    render();
    return wrap;
  }

  // Attaches the on-screen keyboard to a plain <input>/<textarea>: shows it
  // docked at the bottom of the screen on focus, hides it a moment after
  // blur (the short delay is so tapping a keyboard key - which blurs the
  // input - doesn't yank the keyboard away out from under the tap). Typing
  // edits the field's value directly (so it works for a `readonly` field
  // too, which some pages use to stop the device's own OS keyboard from
  // ALSO popping up alongside this one).
  //
  // `enabled` (default true) lets a page opt a field out entirely - pass
  // false for a page/field where a physical keyboard is assumed instead.
  window.attachOnscreenKeyboard = function (inputEl, { enabled = true } = {}) {
    if (!inputEl) return { setEnabled() {}, destroy() {} };
    let isEnabled = enabled;
    let kb = null;
    let hideTimer = null;

    function insertText(text) {
      const start = inputEl.selectionStart ?? inputEl.value.length;
      const end = inputEl.selectionEnd ?? inputEl.value.length;
      inputEl.value = inputEl.value.slice(0, start) + text + inputEl.value.slice(end);
      const pos = start + text.length;
      inputEl.setSelectionRange && inputEl.setSelectionRange(pos, pos);
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
    function backspace() {
      const start = inputEl.selectionStart ?? inputEl.value.length;
      const end = inputEl.selectionEnd ?? inputEl.value.length;
      if (start === end && start > 0) {
        inputEl.value = inputEl.value.slice(0, start - 1) + inputEl.value.slice(end);
        inputEl.setSelectionRange && inputEl.setSelectionRange(start - 1, start - 1);
      } else {
        inputEl.value = inputEl.value.slice(0, start) + inputEl.value.slice(end);
        inputEl.setSelectionRange && inputEl.setSelectionRange(start, start);
      }
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function show() {
      if (!isEnabled) return;
      clearTimeout(hideTimer);
      if (kb) return;
      kb = buildKeyboardEl((key) => {
        if (key === 'DONE') return hide(true);
        inputEl.focus();
        if (key === 'BACKSPACE') backspace(); else insertText(key);
      });
      // Keep focus on the field itself rather than the keyboard button.
      kb.addEventListener('pointerdown', (e) => e.preventDefault());
      document.body.appendChild(kb);
      document.body.classList.add('onscreen-keyboard-open');
    }
    function hide(immediate) {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (kb) { kb.remove(); kb = null; document.body.classList.remove('onscreen-keyboard-open'); }
      }, immediate ? 0 : 150);
    }
    inputEl.addEventListener('focus', show);
    inputEl.addEventListener('blur', () => hide(false));

    return {
      setEnabled(v) { isEnabled = v; if (!v) hide(true); },
      destroy() { hide(true); inputEl.removeEventListener('focus', show); },
    };
  };
})();
