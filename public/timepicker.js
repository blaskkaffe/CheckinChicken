// timepicker.js — fast, touch-friendly time/date inputs.
//
// buildTimeInput below is used by the status popup for a status that
// needsTime (server/statuses.js, e.g. "Kommer sent") - always-24-hour
// HH:MM, drawn with the exact same captioned +/- stepper card
// (.clock-group, shared.css) as admin's own system-clock control
// (buildSystemClockInput below) - just one group instead of two, and no
// seconds field, rather than a second, differently-styled time input
// existing side by side with that one. Paired with a row of one-tap
// shortcuts.
//
// buildDateOrWeekInput is used for a status that needsDate - a single
// drawn-to-match calendar (not a native <input type=date>/<input
// type=week>, and no separate Dag/Vecka mode switch any more) where
// tapping a day picks that day and tapping a week number picks the whole
// week, in the same place, at the moment the person is actually checking
// in. See its own comment below for the full reasoning.
//
// buildSystemClockInput (bottom of this file) is admin's own "set the
// system clock" control (Inställningar tab) - kept as its own function
// rather than just being buildTimeInput plus a date group tacked on,
// because it has one real difference beyond the extra date fields: it
// always needs seconds ("read out this exact date to verify the clock"
// wants precision buildTimeInput's statuses never do), and it always
// shows a real, already-valid value (seeded from "now") rather than
// buildTimeInput's blank-until-chosen fields - setting the system clock
// has no equivalent of "no time entered", every field always has to mean
// something. (An earlier version of this control, buildDateTimeInput,
// combined buildTimeInput with a native <input type=date> instead -
// removed once nothing else used it.)
(() => {
  function pad2(n) { return String(n).padStart(2, '0'); }
  function isoDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function isoTime(d) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

  // Focuses `input` AND selects its content, so the very next keystroke
  // REPLACES whatever's already there (a prefilled defaultTime, or a
  // previous entry) instead of just appending after it - a plain
  // .focus() alone leaves the cursor wherever it lands (usually the end),
  // which is what let "0930" typed into an hour field prefilled "07" come
  // out as "0709" while this bug was still here.
  function focusAndSelect(input) {
    input.focus();
    input.select();
  }

  // Wires the numpad's own "#"/"*" onto an ordered list of plain number
  // <input> fields (see README's "Number pad input" - typing a time/date):
  // "#" (or Enter) calls `onEnter` - the caller's own "submit this" action
  // (e.g. the status popup's "Klar" button), same key numpad.js itself
  // uses to finish a check-in. "*" clears the FOCUSED field if it has
  // something in it, or - already empty - jumps back to the previous
  // field instead, so repeated "*" presses walk back out of a multi-field
  // group one field at a time, same as backing out of a check-in a digit
  // at a time. `onClear(input)` runs after a clear so the caller can
  // resync its own state and re-fire onChange.
  //
  // Deliberately separate from numpad.js's own page-level listener, which
  // steps aside the moment a real input has focus (see its own
  // isTypingTarget guard) - once focus is actually in one of THESE
  // fields, this is what's driving "#"/"*" instead, field by field rather
  // than digit-position by digit-position.
  function wireDigitFields(fields, { onClear, onEnter } = {}) {
    fields.forEach((input, i) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === '#' || e.key === 'Enter') {
          e.preventDefault();
          onEnter && onEnter();
          return;
        }
        if (e.key === '*') {
          e.preventDefault();
          if (input.value) {
            input.value = '';
            onClear && onClear(input);
          } else if (i > 0) {
            focusAndSelect(fields[i - 1]);
          }
        }
      });
    });
  }

  function addShortcuts(container, defs, onPick) {
    const row = document.createElement('div');
    row.className = 'time-shortcuts';
    defs.forEach(([label, fn]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'time-shortcut';
      btn.textContent = label;
      btn.addEventListener('click', () => onPick(fn()));
      row.appendChild(btn);
    });
    container.appendChild(row);
  }

  /** { value } getter/setter object, backed by a single always-24-hour
   *  HH:MM .clock-group (shared.css - the same captioned +/- stepper card
   *  admin's own system-clock control uses, see buildSystemClockInput
   *  below, just one group and no seconds field) + shortcut row.
   *
   *  This used to be a native <input type=time>, which is a nice wheel
   *  picker on a touchscreen - but which 12h/24h format it renders in
   *  turns out to be decided by the BROWSER's own UI language (its
   *  Chromium/OS locale), not by anything on the page - setting `lang`
   *  on the input itself, the usual advice for this, does NOT override it
   *  in Chromium (confirmed: still shows AM/PM under an en-US browser
   *  locale even with lang="sv-SE" on the input). Since this app always
   *  wants 24-hour time regardless of the device's own locale (matching
   *  the board's own clock - board.js's fmtClock), and there's no
   *  reliable way to force that on the native control, two plain HH/MM
   *  fields sidestep the issue entirely: there's no AM/PM concept to
   *  mis-render in the first place.
   *
   *  Unlike buildSystemClockInput's fields, these start blank (placeholder
   *  "HH"/"MM", not a real value) and stay that way until actually
   *  touched - typed into, stepped, or filled via a shortcut - so tapping
   *  Klar without picking a time saves no detail at all rather than
   *  silently recording some default one. The +/- steppers are the one
   *  exception that has to start SOMEWHERE: the first tap on either
   *  field's own + or - seeds THAT field from the current real time, then
   *  applies the step - the other field stays blank until it gets its own
   *  first tap (or the whole pair is filled together, in one step, by
   *  typing or a shortcut). The shortcut row below still covers the
   *  fast/common path exactly as before; the steppers/typing are for
   *  anything else.
   */
  window.buildTimeInput = function (container, { initial, onChange, onEnter } = {}) {
    container.innerHTML = '';
    container.className = 'touch-time-input';

    const [initH, initM] = (initial || '').split(':');
    const state = {
      hh: initH ? Number(initH) : null,
      mm: initM ? Number(initM) : null,
    };
    const RANGES = { hh: [0, 23], mm: [0, 59] };
    // The minute stepper jumps by 15, not 1 - these statuses (Kommer sent,
    // Går tidigare, ...) are an approximate "around this time", nudged
    // from a sensible defaultTime (server/statuses.js), not a precise
    // reading the way the system clock's own seconds-accurate fields are -
    // single-minute steps would just be a lot of extra tapping to get
    // anywhere. Typing an exact minute directly still works, same as
    // always - this only changes what +/- do.
    const STEP = { hh: 1, mm: 15 };

    function currentValue() {
      return (state.hh !== null && state.mm !== null) ? `${pad2(state.hh)}:${pad2(state.mm)}` : '';
    }
    function fire() { onChange && onChange(currentValue()); }
    function clampTyped(key, v) {
      const [lo, hi] = RANGES[key];
      return Math.max(lo, Math.min(hi, v));
    }
    // Same wrap-at-the-field's-own-boundary behavior as
    // buildSystemClockInput's own wrapStep (59 -> 0, not carried into the
    // other field) - seeded from the current real time if this field
    // hasn't been touched yet (see this function's own doc comment above).
    function wrapStep(key, dir) {
      const [lo, hi] = RANGES[key];
      const span = hi - lo + 1;
      const step = STEP[key];
      const now = new Date();
      const base = state[key] !== null ? state[key] : (key === 'hh' ? now.getHours() : now.getMinutes());
      state[key] = ((base - lo + dir * step) % span + span) % span + lo;
    }

    const inputs = {};
    function syncInputs() {
      inputs.hh.value = state.hh === null ? '' : pad2(state.hh);
      inputs.mm.value = state.mm === null ? '' : pad2(state.mm);
    }

    // Same field()/sep() shape as buildSystemClockInput's own (below) -
    // deliberately not shared as one function between the two: this one
    // has to handle a blank/null state theirs never does, and theirs
    // handles wrap-around year/month/day boundaries this one never needs.
    function field(group, key, label, placeholder) {
      const captionEl = document.createElement('span');
      captionEl.className = 'clock-field-label';
      captionEl.textContent = label;
      captionEl.setAttribute('aria-hidden', 'true');

      const plus = document.createElement('button');
      plus.type = 'button'; plus.className = 'clock-step'; plus.textContent = '+';
      plus.setAttribute('aria-label', `Öka ${label.toLowerCase()}`);

      const input = document.createElement('input');
      input.type = 'number'; input.inputMode = 'numeric'; input.className = 'clock-num';
      input.placeholder = placeholder; input.setAttribute('aria-label', label);

      const minus = document.createElement('button');
      minus.type = 'button'; minus.className = 'clock-step'; minus.textContent = '−';
      minus.setAttribute('aria-label', `Minska ${label.toLowerCase()}`);

      plus.addEventListener('click', () => { wrapStep(key, 1); syncInputs(); fire(); });
      minus.addEventListener('click', () => { wrapStep(key, -1); syncInputs(); fire(); });
      input.addEventListener('input', () => {
        if (input.value === '') { state[key] = null; fire(); return; }
        const v = Math.trunc(Number(input.value));
        if (!Number.isFinite(v)) return;
        state[key] = v;
        fire();
        // Jump to the minute field once two hour digits are typed - keeps
        // manual entry to a quick four keystrokes total, no tapping
        // required between fields.
        if (key === 'hh' && input.value.length >= 2) focusAndSelect(inputs.mm);
      });
      input.addEventListener('blur', () => {
        if (input.value === '') { state[key] = null; syncInputs(); fire(); return; }
        const v = Math.trunc(Number(input.value));
        state[key] = Number.isFinite(v) ? clampTyped(key, v) : state[key];
        syncInputs();
        fire();
      });

      group.append(captionEl, plus, input, minus);
      inputs[key] = input;
    }
    function sep(group, ch) {
      const s = document.createElement('span');
      s.className = 'clock-sep'; s.textContent = ch; s.setAttribute('aria-hidden', 'true');
      group.appendChild(s);
    }

    const group = document.createElement('div');
    group.className = 'clock-group';
    field(group, 'hh', 'Timme', 'HH'); sep(group, ':');
    field(group, 'mm', 'Minut', 'MM');
    container.appendChild(group);
    syncInputs();

    wireDigitFields([inputs.hh, inputs.mm], {
      onClear(input) {
        const key = input === inputs.hh ? 'hh' : 'mm';
        state[key] = null;
        syncInputs();
        fire();
      },
      onEnter,
    });
    // Auto-focus the hour field the moment this screen appears - see
    // README's "Number pad input": typing should just work without
    // needing to tap the field first.
    focusAndSelect(inputs.hh);

    const addMin = (mins) => {
      const base = currentValue() || isoTime(new Date());
      const [h, m] = base.split(':').map(Number);
      const d = new Date();
      d.setHours(h || 0, (m || 0) + mins, 0, 0);
      return isoTime(d);
    };
    addShortcuts(container, [
      ['Nu', () => isoTime(new Date())],
      ['+15 min', () => addMin(15)],
      ['+30 min', () => addMin(30)],
      ['+1 tim', () => addMin(60)],
    ], (v) => {
      const [h, m] = v.split(':');
      state.hh = Number(h); state.mm = Number(m);
      syncInputs();
      fire();
    });

    return {
      get value() { return currentValue(); },
      set value(v) {
        const [h, m] = (v || '').split(':');
        state.hh = h ? Number(h) : null;
        state.mm = m ? Number(m) : null;
        syncInputs();
      },
    };
  };

  // Same ISO-8601 week math as board.js's isoWeekInfo (Monday-start weeks,
  // week 1 is the one containing the year's first Thursday) - duplicated
  // rather than shared since board.js and this file are never loaded
  // together (board.js only runs on board.html, this on both board.html's
  // status popup and admin.html's status editor / system clock).
  function isoWeekParts(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
    date.setUTCDate(date.getUTCDate() - dayNum + 3); // this week's Thursday
    const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
    const week = 1 + Math.round((date - firstThursday) / (7 * 24 * 3600 * 1000));
    return { week, isoYear: date.getUTCFullYear() };
  }

  const MONTH_NAMES = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
  const DAY_HEADS = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];

  function sameDate(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

  /** { value } getter object, backed by a drawn-to-match month calendar -
   *  see .cal-* in statuspopup.css. Replaces the earlier native <input
   *  type=date>/<input type=week> pair (and the Dag/Vecka toggle that
   *  briefly switched between them): both live in the SAME grid here, so
   *  picking a day or a whole week is just tapping the right cell, no
   *  mode to pick first. Just a prev/next month nav - no year dropdown,
   *  no shortcut chips; the calendar itself, always open, is the fast
   *  path.
   *
   *  Weeks run Monday-first (ISO 8601, same as the week number itself -
   *  see the leftmost "V." column) rather than the Sunday-first order a
   *  browser's own locale might otherwise pick, since a week number is
   *  meaningless if the days sitting next to it aren't the same week's.
   *  Rows from the adjacent month (needed to fill the first/last week of
   *  the shown month) stay tappable, just dimmed - the visible days of a
   *  week are all that matters for picking a valid week, not which month
   *  they nominally belong to.
   *
   *  onChange fires with `{ kind: 'day', date: 'YYYY-MM-DD' }` or
   *  `{ kind: 'week', week, isoYear }` (isoYear already the ISO
   *  week-numbering year, same as board.js's own clock uses for its "V"
   *  + last digit + week number format - see statuspopup.js's
   *  formatDetail(), which is the one place that format is actually
   *  written out) - or `null` for "nothing picked yet".
   */
  window.buildDateOrWeekInput = function (container, { onChange, onEnter } = {}) {
    container.innerHTML = '';
    container.className = 'cal-wrap';

    const today = new Date();
    let viewYear = today.getFullYear();
    let viewMonth = today.getMonth(); // 0-11
    let selection = null; // { kind: 'day', date: Date } | { kind: 'week', monday: Date }

    const nav = document.createElement('div');
    nav.className = 'cal-nav';
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button'; prevBtn.className = 'cal-nav-btn'; prevBtn.textContent = '‹';
    prevBtn.setAttribute('aria-label', 'Föregående månad');
    const label = document.createElement('div');
    label.className = 'cal-month-label';
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button'; nextBtn.className = 'cal-nav-btn'; nextBtn.textContent = '›';
    nextBtn.setAttribute('aria-label', 'Nästa månad');
    nav.append(prevBtn, label, nextBtn);

    const grid = document.createElement('div');
    grid.className = 'cal-grid';

    // Typed entry under the calendar (see README's "Number pad input") -
    // the fast path once someone already knows the day they want, same
    // idea as buildTimeInput's HH/MM fields (and drawn to match - same
    // .clock-group card, just a 2-row variant with no +/- steppers, see
    // statuspopup.css's .cal-typed). Two-way bound with the calendar
    // itself via syncTyped()/applyTyped() below: tapping a day fills
    // these in, typing a day/month picks it on the calendar - always in
    // THIS year, since there's no year field here (a status detail is
    // never more than a few months out). Picking a whole WEEK has no
    // digit code and stays tap-only (a week isn't a day/month pair).
    const typed = document.createElement('div');
    typed.className = 'clock-group cal-typed';
    const typedInputs = {};

    container.append(nav, grid, typed);

    function fire() {
      if (!onChange) return;
      if (!selection) return onChange(null);
      if (selection.kind === 'day') return onChange({ kind: 'day', date: isoDate(selection.date) });
      const { week, isoYear } = isoWeekParts(selection.monday);
      onChange({ kind: 'week', week, isoYear });
    }

    // Keeps the typed DD/MM boxes matching whatever's actually selected -
    // a specific day mirrors into them, a week (or nothing) leaves them
    // blank, since neither has a single day/month pair to show.
    function syncTyped() {
      if (selection && selection.kind === 'day') {
        typedInputs.dd.value = pad2(selection.date.getDate());
        typedInputs.mo.value = pad2(selection.date.getMonth() + 1);
      } else {
        typedInputs.dd.value = '';
        typedInputs.mo.value = '';
      }
    }

    function render() {
      label.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
      grid.innerHTML = '';

      const headWeek = document.createElement('div');
      headWeek.className = 'cal-head cal-head-week';
      headWeek.textContent = 'V.';
      grid.appendChild(headWeek);
      DAY_HEADS.forEach((h) => {
        const el = document.createElement('div');
        el.className = 'cal-head';
        el.textContent = h;
        grid.appendChild(el);
      });

      const firstOfMonth = new Date(viewYear, viewMonth, 1);
      const mondayIndex = (firstOfMonth.getDay() + 6) % 7; // Mon=0 .. Sun=6
      const gridStart = new Date(viewYear, viewMonth, 1 - mondayIndex);
      const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
      const numRows = Math.ceil((mondayIndex + daysInMonth) / 7);

      const selWeek = selection && selection.kind === 'week' ? isoWeekParts(selection.monday) : null;

      for (let r = 0; r < numRows; r++) {
        const rowMonday = new Date(gridStart);
        rowMonday.setDate(gridStart.getDate() + r * 7);
        const { week, isoYear } = isoWeekParts(rowMonday);
        const rowSelected = !!(selWeek && selWeek.week === week && selWeek.isoYear === isoYear);

        const weekBtn = document.createElement('button');
        weekBtn.type = 'button';
        weekBtn.className = 'cal-week-num' + (rowSelected ? ' selected' : '');
        weekBtn.textContent = String(week);
        weekBtn.setAttribute('aria-label', `Välj hela vecka ${week}`);
        weekBtn.addEventListener('click', () => { selection = { kind: 'week', monday: new Date(rowMonday) }; render(); syncTyped(); fire(); });
        grid.appendChild(weekBtn);

        for (let c = 0; c < 7; c++) {
          const d = new Date(rowMonday);
          d.setDate(rowMonday.getDate() + c);
          const daySelected = !!(selection && selection.kind === 'day' && sameDate(d, selection.date));
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'cal-day';
          if (d.getMonth() !== viewMonth) btn.classList.add('cal-day-outside');
          if (sameDate(d, today)) btn.classList.add('today');
          if (rowSelected) btn.classList.add('in-selected-week');
          if (daySelected) btn.classList.add('selected');
          btn.textContent = String(d.getDate());
          btn.setAttribute('aria-label', isoDate(d));
          btn.addEventListener('click', () => { selection = { kind: 'day', date: d }; render(); syncTyped(); fire(); });
          grid.appendChild(btn);
        }
      }
    }

    prevBtn.addEventListener('click', () => {
      viewMonth -= 1;
      if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
      render();
    });
    nextBtn.addEventListener('click', () => {
      viewMonth += 1;
      if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
      render();
    });

    // Picks a day IN THIS YEAR from whatever's typed, applied live as
    // both fields fill in - same immediate feel as tapping a day cell.
    // An invalid combination (e.g. 31 in April) is simply left unapplied
    // rather than silently rounding to some other day - nothing lights up
    // on the calendar until it's a real date.
    function applyTyped() {
      const dd = Number(typedInputs.dd.value);
      const mo = Number(typedInputs.mo.value);
      if (!dd || !mo) return;
      const candidate = new Date(today.getFullYear(), mo - 1, dd);
      if (candidate.getMonth() !== mo - 1) return; // not a real day (e.g. 31/04)
      selection = { kind: 'day', date: candidate };
      viewYear = candidate.getFullYear();
      viewMonth = candidate.getMonth();
      render();
      fire();
    }

    function typedField(key, label, placeholder) {
      const captionEl = document.createElement('span');
      captionEl.className = 'clock-field-label';
      captionEl.textContent = label;
      captionEl.setAttribute('aria-hidden', 'true');

      const input = document.createElement('input');
      input.type = 'number'; input.inputMode = 'numeric'; input.className = 'clock-num';
      input.placeholder = placeholder; input.setAttribute('aria-label', label);

      input.addEventListener('input', () => {
        // Jump to the month field once two day digits are typed - same
        // no-tapping-between-fields convenience as buildTimeInput's own
        // hour -> minute jump.
        if (key === 'dd' && input.value.length >= 2) focusAndSelect(typedInputs.mo);
        applyTyped();
      });
      input.addEventListener('blur', applyTyped);

      typed.append(captionEl, input);
      typedInputs[key] = input;
    }
    function typedSep(ch) {
      const s = document.createElement('span');
      s.className = 'clock-sep'; s.textContent = ch; s.setAttribute('aria-hidden', 'true');
      typed.appendChild(s);
    }
    typedField('dd', 'Dag', 'DD');
    typedSep('/');
    typedField('mo', 'Månad', 'MM');

    // Clearing either field invalidates the whole picked day, same as
    // buildTimeInput's fields both having to hold a value for its own
    // currentValue() to be non-empty - "day 15, month unknown" isn't a
    // meaningful selection to leave lit on the calendar.
    wireDigitFields([typedInputs.dd, typedInputs.mo], {
      onClear() { selection = null; render(); fire(); },
      onEnter,
    });

    render();
    // Auto-focus the day field the moment this screen appears - see
    // README's "Number pad input": typing should just work without
    // needing to tap the field first.
    focusAndSelect(typedInputs.dd);

    return {
      get value() {
        if (!selection) return null;
        if (selection.kind === 'day') return { kind: 'day', date: isoDate(selection.date) };
        const { week, isoYear } = isoWeekParts(selection.monday);
        return { kind: 'week', week, isoYear };
      },
    };
  };

  // ---------------------------------------------------- system clock ----
  // Six independent stepper fields - HH, MM, SS, YYYY, MO, DD, each
  // captioned with what it is - grouped into a time card (HH:MM:SS) and a
  // date card (YYYY-MM-DD), each field a small number box with a + button
  // above it and a − button below it, read/written as a group. `initial`/
  // onChange value shape: "YYYY-MM-DDTHH:MM:SS" (seconds always included,
  // unlike buildDateTimeInput's old "YYYY-MM-DDTHH:MM" - see
  // setSystemClock() in server/server.js, which accepts either but this
  // always sends both).
  //
  // The +/- buttons WRAP at each field's own boundary (seconds 59 → 0,
  // hour 23 → 0, month 12 → 1, and day wraps within however many days the
  // CURRENT month/year actually has) rather than carrying into the next
  // field - simple and predictable (what you tapped is the only field
  // that changed), matching what "simple +/- steppers" usually do on a
  // physical clock or oven timer. Typing a value directly into a field
  // instead is clamped (not wrapped) on blur - typing "99" into the hour
  // box lands on 23, it doesn't wrap around to 3.
  window.buildSystemClockInput = function (container, { initial, onChange } = {}) {
    container.innerHTML = '';
    container.className = 'clock-set';

    const now = new Date();
    const state = {
      hh: now.getHours(), mm: now.getMinutes(), ss: now.getSeconds(),
      yyyy: now.getFullYear(), mo: now.getMonth() + 1, dd: now.getDate(),
    };
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(initial || '');
    if (m) {
      state.yyyy = Number(m[1]); state.mo = Number(m[2]); state.dd = Number(m[3]);
      state.hh = Number(m[4]); state.mm = Number(m[5]); state.ss = m[6] ? Number(m[6]) : 0;
    }

    const RANGES = { hh: [0, 23], mm: [0, 59], ss: [0, 59], mo: [1, 12] };
    function daysInMonth(y, mo) { return new Date(y, mo, 0).getDate(); }
    function clampDay() { state.dd = Math.min(state.dd, daysInMonth(state.yyyy, state.mo)); }

    function clampTyped(key, v) {
      if (key === 'yyyy') return Math.max(1970, Math.min(2999, v));
      if (key === 'dd') return Math.max(1, Math.min(daysInMonth(state.yyyy, state.mo), v));
      const [lo, hi] = RANGES[key];
      return Math.max(lo, Math.min(hi, v));
    }

    function wrapStep(key, dir) {
      if (key === 'yyyy') {
        state.yyyy = Math.max(1970, Math.min(2999, state.yyyy + dir));
        // Stepping off a leap year's Feb 29 needs the same re-clamp the
        // typed-input handlers below already do for 'yyyy' - otherwise the
        // stepper buttons alone could leave state.dd on a day that no
        // longer exists in the new year (e.g. Feb 29 -> a non-leap year).
        clampDay();
      }
      else if (key === 'dd') {
        const span = daysInMonth(state.yyyy, state.mo);
        state.dd = ((state.dd - 1 + dir + span) % span + span) % span + 1;
      } else {
        const [lo, hi] = RANGES[key];
        const span = hi - lo + 1;
        state[key] = ((state[key] - lo + dir) % span + span) % span + lo;
        if (key === 'mo') clampDay();
      }
    }

    const pad2 = (n) => String(n).padStart(2, '0');
    const fire = () => onChange && onChange(
      `${state.yyyy}-${pad2(state.mo)}-${pad2(state.dd)}T${pad2(state.hh)}:${pad2(state.mm)}:${pad2(state.ss)}`
    );

    const inputs = {};
    function syncInputs() {
      inputs.hh.value = pad2(state.hh); inputs.mm.value = pad2(state.mm); inputs.ss.value = pad2(state.ss);
      inputs.yyyy.value = String(state.yyyy); inputs.mo.value = pad2(state.mo); inputs.dd.value = pad2(state.dd);
    }

    // Each field is 4 plain grid items (label/+/number/-) appended
    // straight into the group's own CSS grid, rather than a nested
    // flex-column wrapper per field - see admin.css's .clock-group for
    // why: it's what lets a separator (sep() below) span exactly the full
    // height of its own column and land vertically centered next to the
    // NUMBER row specifically, lined up the same for every field,
    // regardless of the caption label above it.
    function field(group, key, label, { wide } = {}) {
      const wideClass = wide ? ' clock-field-wide' : '';

      // Visible caption ("Timme", "Minut", ...) so it's clear what each
      // field does without having to infer it from position alone. The
      // input already carries the same text as its aria-label below, so
      // this is purely decorative (aria-hidden) rather than a second,
      // redundant announcement for screen readers.
      const captionEl = document.createElement('span');
      captionEl.className = 'clock-field-label';
      captionEl.textContent = label;
      captionEl.setAttribute('aria-hidden', 'true');

      // wideClass only goes on the number input below, not these +/-
      // buttons - every clock-step button is the same fixed size
      // regardless of field (see admin.css's .clock-step), so the year
      // field's own wider number box doesn't stretch its buttons too.
      const plus = document.createElement('button');
      plus.type = 'button'; plus.className = 'clock-step'; plus.textContent = '+';
      plus.setAttribute('aria-label', `Öka ${label.toLowerCase()}`);

      const input = document.createElement('input');
      input.type = 'number'; input.inputMode = 'numeric'; input.className = 'clock-num' + wideClass;
      input.setAttribute('aria-label', label);

      const minus = document.createElement('button');
      minus.type = 'button'; minus.className = 'clock-step'; minus.textContent = '−';
      minus.setAttribute('aria-label', `Minska ${label.toLowerCase()}`);

      plus.addEventListener('click', () => { wrapStep(key, 1); syncInputs(); fire(); });
      minus.addEventListener('click', () => { wrapStep(key, -1); syncInputs(); fire(); });
      input.addEventListener('input', () => {
        const v = Math.trunc(Number(input.value));
        if (!Number.isFinite(v)) return;
        state[key] = v;
        if (key === 'mo' || key === 'yyyy') clampDay();
        fire();
      });
      input.addEventListener('blur', () => {
        const v = Math.trunc(Number(input.value));
        state[key] = Number.isFinite(v) ? clampTyped(key, v) : state[key];
        if (key === 'mo' || key === 'yyyy') clampDay();
        syncInputs();
        fire();
      });

      group.append(captionEl, plus, input, minus);
      inputs[key] = input;
    }
    function sep(group, ch) {
      const s = document.createElement('span');
      s.className = 'clock-sep'; s.textContent = ch; s.setAttribute('aria-hidden', 'true');
      group.appendChild(s);
    }

    // Time and date each get their own bordered group (see .clock-group in
    // admin.css) rather than six fields loose in a row - a clearer split
    // than the plain shared gap this used to be, and each field's caption
    // now says outright what it is instead of leaving the HH:MM:SS /
    // YYYY-MM-DD order to speak for itself.
    const timeGroup = document.createElement('div');
    timeGroup.className = 'clock-group';
    field(timeGroup, 'hh', 'Timme'); sep(timeGroup, ':');
    field(timeGroup, 'mm', 'Minut'); sep(timeGroup, ':');
    field(timeGroup, 'ss', 'Sekund');

    const dateGroup = document.createElement('div');
    dateGroup.className = 'clock-group';
    field(dateGroup, 'yyyy', 'År', { wide: true }); sep(dateGroup, '-');
    field(dateGroup, 'mo', 'Månad'); sep(dateGroup, '-');
    field(dateGroup, 'dd', 'Dag');

    container.appendChild(timeGroup);
    container.appendChild(dateGroup);
    syncInputs();
    fire();

    return {
      get value() {
        return `${state.yyyy}-${pad2(state.mo)}-${pad2(state.dd)}T${pad2(state.hh)}:${pad2(state.mm)}:${pad2(state.ss)}`;
      },
    };
  };
})();
