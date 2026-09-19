// timepicker.js — fast, touch-friendly time/date inputs.
//
// buildTimeInput below is used by the status popup for a status that
// needsTime (see server/statuses.js) - a plain always-24-hour HH:MM field
// pair plus a row of one-tap shortcuts.
//
// buildDateOrWeekInput is used for a status that needsDate - a single
// drawn-to-match calendar (not a native <input type=date>/<input
// type=week>, and no separate Dag/Vecka mode switch any more) where
// tapping a day picks that day and tapping a week number picks the whole
// week, in the same place, at the moment the person is actually checking
// in. See its own comment below for the full reasoning.
//
// buildSystemClockInput (bottom of this file) is admin's own "set the
// system clock" control (Inställningar tab) - a separate, simpler widget
// rather than reusing either of the above, because that control has
// different needs: it always needs seconds (buildTimeInput doesn't have a
// seconds field), and it's for "read out this exact date to verify the
// clock" rather than "pick a date", where a full calendar would be
// overkill and the app's own consistent YYYY-MM-DD is what you want, not
// a picked-then-formatted date. Six plain +/- steppers suit that better.
// (An earlier version of this control, buildDateTimeInput, combined
// buildTimeInput with a native <input type=date> instead - removed once
// nothing else used it.)
(() => {
  function pad2(n) { return String(n).padStart(2, '0'); }
  function isoDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function isoTime(d) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

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

  /** { value } getter/setter object, backed by an always-24-hour HH:MM
   *  field pair + shortcut row.
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
   *  reliable way to force that on the native control, two plain
   *  HH/MM number fields sidestep the issue entirely: there's no AM/PM
   *  concept to mis-render in the first place. The shortcut row below
   *  still covers the fast/common path exactly as before - manual entry
   *  here is just the fallback.
   */
  window.buildTimeInput = function (container, { initial, onChange } = {}) {
    container.innerHTML = '';
    container.className = 'touch-time-input';
    const wrap = document.createElement('div');
    wrap.className = 'time-hm-wrap';

    const [initH, initM] = (initial || '').split(':');
    const hh = document.createElement('input');
    hh.type = 'number'; hh.inputMode = 'numeric'; hh.min = '0'; hh.max = '23';
    hh.className = 'time-hm-field'; hh.placeholder = 'HH'; hh.setAttribute('aria-label', 'Timme');
    hh.value = initH || '';
    const sep = document.createElement('span');
    sep.className = 'time-hm-sep'; sep.textContent = ':'; sep.setAttribute('aria-hidden', 'true');
    const mm = document.createElement('input');
    mm.type = 'number'; mm.inputMode = 'numeric'; mm.min = '0'; mm.max = '59';
    mm.className = 'time-hm-field'; mm.placeholder = 'MM'; mm.setAttribute('aria-label', 'Minut');
    mm.value = initM || '';

    function clamp(el, max) {
      if (el.value === '') return;
      let v = Math.trunc(Number(el.value));
      if (!Number.isFinite(v)) { el.value = ''; return; }
      el.value = String(Math.min(max, Math.max(0, v)));
    }
    function currentValue() {
      return (hh.value !== '' && mm.value !== '') ? `${pad2(Number(hh.value))}:${pad2(Number(mm.value))}` : '';
    }
    function fire() { onChange && onChange(currentValue()); }
    function fireClamped() { clamp(hh, 23); clamp(mm, 59); fire(); }
    hh.addEventListener('input', fire);
    mm.addEventListener('input', fire);
    hh.addEventListener('blur', fireClamped);
    mm.addEventListener('blur', fireClamped);
    // Jump to the minute field once two hour digits are typed - keeps
    // manual entry to a quick four keystrokes total, no tapping required
    // between fields.
    hh.addEventListener('input', () => { if (hh.value.length >= 2) mm.focus(); });

    wrap.appendChild(hh);
    wrap.appendChild(sep);
    wrap.appendChild(mm);
    container.appendChild(wrap);

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
      hh.value = h; mm.value = m;
      fire();
    });

    return {
      get value() { return currentValue(); },
      set value(v) {
        const [h, m] = (v || '').split(':');
        hh.value = h || ''; mm.value = m || '';
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
  window.buildDateOrWeekInput = function (container, { onChange } = {}) {
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

    container.append(nav, grid);

    function fire() {
      if (!onChange) return;
      if (!selection) return onChange(null);
      if (selection.kind === 'day') return onChange({ kind: 'day', date: isoDate(selection.date) });
      const { week, isoYear } = isoWeekParts(selection.monday);
      onChange({ kind: 'week', week, isoYear });
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
        weekBtn.addEventListener('click', () => { selection = { kind: 'week', monday: new Date(rowMonday) }; render(); fire(); });
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
          btn.addEventListener('click', () => { selection = { kind: 'day', date: d }; render(); fire(); });
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

    render();

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

      const plus = document.createElement('button');
      plus.type = 'button'; plus.className = 'clock-step' + wideClass; plus.textContent = '+';
      plus.setAttribute('aria-label', `Öka ${label.toLowerCase()}`);

      const input = document.createElement('input');
      input.type = 'number'; input.inputMode = 'numeric'; input.className = 'clock-num' + wideClass;
      input.setAttribute('aria-label', label);

      const minus = document.createElement('button');
      minus.type = 'button'; minus.className = 'clock-step' + wideClass; minus.textContent = '−';
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
