(() => {
  let statusDefs = { primary: [], secondary: [] };
  let secondaryByCode = new Map();
  let people = new Map(); // id -> person
  let cfg = {};
  let boardClickToEdit = true;
  // '' = "Alla Coops" (all coops, no filter); otherwise an exact
  // match against a person's `location` field. See loadLocationFilter()
  // below and window.BoardSettings (read/written by the board-settings
  // popup - boardsettings.js).
  let locationFilter = '';

  const boardEl = document.getElementById('board');
  const connPill = document.getElementById('connPill');
  const connLabel = document.getElementById('connLabel');

  // Lets statuspopup.js (a separate script/file, loaded after this one)
  // look a person up by id without a second fetch of its own, and stay
  // current automatically since this is a live reference into the same Map
  // this file already keeps up to date over SSE.
  window.BoardPeople = { get: (id) => people.get(id) };

  // ------------------------------------------------------------- clock ---
  // Swedish convention: weekday and date spelled out, 24-hour time, plus
  // the current week - e.g. "torsdag 18 september · 14:32 · V638". sv-SE
  // already gives lowercase weekday/month names, which is correct Swedish
  // style outside the start of a sentence.
  //
  // Week format: plain "V" + the ISO week number by default (e.g. "V45") -
  // reads fastest at a glance from across a room, which is what a wall
  // clock is for. Right at a year boundary that's technically ambiguous
  // (is "V1" this week or next?), so there's an opt-in per-device setting
  // (weekShowYear below, toggled from the board-settings popup - tap the
  // clock - see boardsettings.js's renderWeekFormat) that adds the last
  // digit of the ISO week-year in front of the week number instead, e.g.
  // week 45 of a year ending in 6 reads "V645".
  //
  // Swedish week numbering follows ISO 8601 (Monday-start weeks, week 1 is
  // the one containing the year's first Thursday) - NOT the same as
  // whatever Date.prototype otherwise gives you, and NOT always the same
  // as the plain calendar year either: the few days right at the turn of
  // the year can belong to the week-numbering year before or after the
  // calendar year (e.g. 2027-01-01 falls in ISO week 53 of 2026). The
  // standard "move to this week's Thursday, then count Thursdays since
  // that year's own week 1" construction below gets both the week number
  // and that week-numbering year right at once, rather than just using
  // d.getFullYear() for the digit (which would be wrong on exactly those
  // few boundary days).
  function isoWeekInfo(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
    date.setUTCDate(date.getUTCDate() - dayNum + 3); // this week's Thursday
    const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
    const week = 1 + Math.round((date - firstThursday) / (7 * 24 * 3600 * 1000));
    return { week, isoYear: date.getUTCFullYear() };
  }
  // Per-device (localStorage), same pattern as locationFilter/
  // manualScaleFactor further down: off (plain "V45") by default, and
  // never touches the server - see the comment above for what it does.
  const WEEK_SHOW_YEAR_KEY = 'checkin:weekShowYear';
  let weekShowYear = false;

  function loadWeekShowYear() {
    try {
      const saved = localStorage.getItem(WEEK_SHOW_YEAR_KEY);
      if (saved !== null) weekShowYear = saved === '1';
    } catch (e) { /* ignore - defaults to false */ }
  }

  function saveWeekShowYear() {
    try { localStorage.setItem(WEEK_SHOW_YEAR_KEY, weekShowYear ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  function fmtClock() {
    const d = new Date();
    const datePart = d.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' });
    const timePart = d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    const { week, isoYear } = isoWeekInfo(d);
    const weekPart = weekShowYear ? `V${isoYear % 10}${week}` : `V${week}`;
    document.getElementById('clock').textContent = `${datePart} · ${timePart} · ${weekPart}`;
  }
  loadWeekShowYear();
  setInterval(fmtClock, 1000 * 15);
  fmtClock();

  async function boot() {
    const [c, defs, ppl] = await Promise.all([
      fetch('/api/config').then((r) => r.json()),
      fetch('/api/statuses').then((r) => r.json()),
      // This same list feeds both the board rows below (which never
      // render a phone number) and statuspopup.js's window.BoardPeople
      // lookup (which does, per config.json's phoneVisibility) - see
      // server.js's /api/people handler.
      fetch('/api/people').then((r) => r.json()),
    ]);
    cfg = c;
    document.getElementById('locationName').textContent = cfg.locationName + ' — Incheckning';
    statusDefs = defs;
    secondaryByCode = new Map(defs.secondary.map((s) => [s.code, s]));
    people = new Map(ppl.map((p) => [p.id, p]));
    // config.json's boardClickToEdit is a per-SERVER default, identical for
    // every board.html tab that connects to it - so it alone can't tell
    // apart "the wall-mounted display" from "the counter-height touch
    // device". A URL query param lets ONE specific device override the
    // server's default for itself: board.html?input=off forces that tab
    // to be a plain, non-touch display regardless of the server setting;
    // board.html?input=on forces it touchable. See README's "Setup".
    const inputOverride = new URLSearchParams(window.location.search).get('input');
    boardClickToEdit = inputOverride === 'off' ? false
      : inputOverride === 'on' ? true
      : cfg.boardClickToEdit !== false;
    loadLocationFilter();
    loadManualScale();
    render();
    connectEvents();
    wireClickToEdit();
    document.dispatchEvent(new CustomEvent('checkin:config', { detail: cfg }));
  }

  // --------------------------------------------------- coop filter ---
  // Which coop this ONE screen shows - "" (Alla Coops) by default,
  // or one exact `location` value to show just that coop. This is a
  // per-DEVICE choice, not a server setting: it's remembered locally (so a
  // kiosk tab keeps showing what it was last set to across reloads) and
  // can be overridden for one tab via ?location=<name> in the URL (handy
  // for a wall-mounted screen you always want pinned to one coop - see
  // README's "Multiple coops").
  const LOCATION_FILTER_KEY = 'checkin:locationFilter';

  function loadLocationFilter() {
    const urlLoc = new URLSearchParams(window.location.search).get('location');
    if (urlLoc !== null) {
      locationFilter = urlLoc;
      try { localStorage.setItem(LOCATION_FILTER_KEY, urlLoc); } catch (e) { /* private-browsing etc - just not remembered */ }
      return;
    }
    try {
      const saved = localStorage.getItem(LOCATION_FILTER_KEY);
      if (saved !== null) locationFilter = saved;
    } catch (e) { /* ignore - defaults to "" (all coops) */ }
  }

  function saveLocationFilter() {
    try { localStorage.setItem(LOCATION_FILTER_KEY, locationFilter); } catch (e) { /* ignore */ }
  }

  // Distinct, non-blank `location` values currently among ACTIVE people,
  // sorted - both what fills the board-settings popup's coop list
  // (boardsettings.js's renderLocations(), via window.BoardSettings below)
  // and what decides whether it's worth showing at all.
  function allLocations() {
    const set = new Set();
    for (const p of people.values()) {
      if (p.active === false) continue;
      const loc = (p.location || '').trim();
      if (loc) set.add(loc);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'sv'));
  }

  // If a previously-picked coop no longer exists (renamed/removed),
  // fall back to "all" rather than silently filtering everyone out. Used
  // to live inside the header dropdown's own render function; now that the
  // picker itself lives in the board-settings popup (boardsettings.js -
  // see window.BoardSettings below), this is just plain bookkeeping run
  // once per render() rather than DOM upkeep.
  function ensureValidLocationFilter() {
    if (locationFilter && !allLocations().includes(locationFilter)) {
      locationFilter = '';
      saveLocationFilter();
    }
  }

  // ---------------------------------------------------------- board size -
  // A manual nudge on top of fitToScreen()'s own automatic sizing, for
  // whenever that isn't quite satisfactory (a person managing the screen
  // would rather trade some empty space for bigger text, or fit things a
  // little denser than the automatic fit alone would choose) - set from
  // the board-settings popup (tap the clock), same idea as locationFilter
  // above: a per-DEVICE preference remembered in localStorage, not a
  // server setting, since it's about one physical screen's own comfort.
  // Implemented by scaling BASE_MIN_SCALE/BASE_MAX_SCALE (see fitToScreen
  // below) up or down together - the entire existing "never overflow
  // vertically, never overflow a column's width, converge to fill the
  // available height" machinery then just runs inside a shifted range, so
  // turning it down is always safe (the fit loop still converges, just to
  // a smaller result) and turning it up is still capped by the real
  // content/screen fit the moment there genuinely isn't room to grow into
  // - it can't force an actual overflow either way.
  const SIZE_ADJUST_KEY = 'checkin:sizeAdjust';
  const MANUAL_SCALE_MIN = 0.6, MANUAL_SCALE_MAX = 1.6, MANUAL_SCALE_STEP = 0.1;
  let manualScaleFactor = 1; // 1 = "Auto" (no adjustment) - see renderSize() in boardsettings.js

  function loadManualScale() {
    try {
      const saved = parseFloat(localStorage.getItem(SIZE_ADJUST_KEY));
      if (Number.isFinite(saved) && saved > 0) manualScaleFactor = saved;
    } catch (e) { /* ignore - defaults to 1 (Auto) */ }
  }

  function saveManualScale() {
    try { localStorage.setItem(SIZE_ADJUST_KEY, String(manualScaleFactor)); } catch (e) { /* ignore */ }
  }

  function setManualScale(factor) {
    const clamped = Math.min(MANUAL_SCALE_MAX, Math.max(MANUAL_SCALE_MIN, factor));
    manualScaleFactor = Math.round(clamped * 100) / 100; // avoid float drift after repeated +/- taps
    saveManualScale();
    render();
  }

  // ---------------------------------------------- board-settings popup API
  // boardsettings.js (a separate script, loaded after this one - see
  // board.html) is the popup opened by tapping the clock: the coop
  // filter, the manual size adjustment above, the clock's week-format
  // toggle, and (indirectly, via its own fetches) the theme/background
  // pickers. It reads/writes THIS file's state through this one small
  // object rather than each maintaining its own copy - same pattern as
  // window.BoardPeople for statuspopup.js.
  window.BoardSettings = {
    getLocations: allLocations,
    getFilter: () => locationFilter,
    setFilter(loc) {
      locationFilter = loc;
      saveLocationFilter();
      render();
    },
    getManualScalePercent: () => Math.round(manualScaleFactor * 100),
    adjustManualScale(deltaSteps) {
      setManualScale(manualScaleFactor + deltaSteps * MANUAL_SCALE_STEP);
    },
    resetManualScale() { setManualScale(1); },
    manualScaleAtMin: () => manualScaleFactor <= MANUAL_SCALE_MIN + 1e-9,
    manualScaleAtMax: () => manualScaleFactor >= MANUAL_SCALE_MAX - 1e-9,
    getWeekShowYear: () => weekShowYear,
    setWeekShowYear(show) {
      weekShowYear = !!show;
      saveWeekShowYear();
      fmtClock(); // reflect immediately, don't wait for the 15s tick
    },
  };

  // ------------------------------------------------------- click to edit -
  // Tap a person's INNE/UTE badge to toggle it directly - the single most
  // common action, one tap, no menu. Tap anywhere else in their row (name,
  // photo, the secondary status pellet, or just blank space in the row) opens
  // their full status popup (statuspopup.js) - the whole row is one big
  // tap target, not just the name/photo, so it's easy to hit on a
  // touchscreen. Only truly blank space outside any row (the empty-board
  // hint, the gaps between columns) does nothing - there's no PIN/keypad
  // screen behind it any more to fall back to.
  function toggleCheckedIn(id) {
    const p = people.get(id);
    if (!p) return;
    const primary = p.status?.checkedIn ? 'OUT' : 'IN';
    fetch('/api/checkin/set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, primary }),
    }).catch(() => { /* a failed tap just leaves the badge as it was */ });
  }

  function wireClickToEdit() {
    boardEl.addEventListener('click', (e) => {
      if (!boardClickToEdit) return;
      const row = e.target.closest('.person-row');
      if (!row) return;
      if (e.target.closest('.badge')) return toggleCheckedIn(row.dataset.id);
      return window.StatusPopup && window.StatusPopup.open(row.dataset.id);
    });
  }

  // One server, one live connection per open tab - no peer to be "in sync"
  // with any more, so there's nothing to show most of the time (the pill
  // stays hidden). It only appears if the connection to THIS server itself
  // drops, so a kiosk board that's gone stale is still visible at a
  // glance rather than just silently not updating.
  function connectEvents() {
    const es = new EventSource('/api/events');
    let everConnected = false;
    es.addEventListener('person', (e) => {
      const p = JSON.parse(e.data);
      people.set(p.id, p);
      render();
      document.dispatchEvent(new CustomEvent('checkin:person', { detail: p }));
    });
    // Statuses were added/edited/removed on the admin page - re-render so
    // this board (which may have been open for days) picks up a renamed
    // label, a new color, or a status that no longer exists without
    // needing a manual reload.
    es.addEventListener('statuses', (e) => {
      statusDefs = JSON.parse(e.data);
      secondaryByCode = new Map(statusDefs.secondary.map((s) => [s.code, s]));
      render();
      document.dispatchEvent(new CustomEvent('checkin:statuses', { detail: statusDefs }));
    });
    // The theme was changed from the admin page - apply it live, same idea
    // as the 'statuses' handler above. See theme.js.
    es.addEventListener('theme', (e) => window.applyTheme(JSON.parse(e.data).theme));
    // A theme's background picture/opacity was changed - see theme.js.
    es.addEventListener('backgrounds', () => window.refreshBackgrounds());
    // Popup idle-timeout (or the admin on-screen-keyboard toggle) changed -
    // see public/popup.js.
    es.addEventListener('settings', (e) => window.applySettings && window.applySettings(JSON.parse(e.data)));
    es.onopen = () => {
      everConnected = true;
      connPill.style.display = 'none';
    };
    es.onerror = () => {
      // EventSource auto-reconnects on its own; only worth mentioning once
      // there WAS a working connection that then dropped - the very first
      // connection attempt on page load can transiently fire an error too
      // (before onopen), which isn't worth alarming anyone over.
      if (!everConnected) return;
      connPill.style.display = '';
      connLabel.textContent = 'återansluter…';
    };
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Status colors (server/statuses.js's `color`) are plain fixed hex, not
  // theme-aware, and span everything from pale orange to dark navy - a
  // single fixed text color can't read well on all of them at once
  // (that was the light-mode contrast problem: dark text on a dark blue
  // pill). So instead of hardcoding one, pick per-pill: relative luminance
  // (the standard WCAG formula) decides whether light or dark text gets
  // better contrast against THIS background, so every pill stays readable
  // in both themes regardless of which status color it happens to be.
  function readableTextOn(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return '#0b0e16';
    const [r, g, b] = m.slice(1).map((h) => {
      const c = parseInt(h, 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.45 ? '#0b0e16' : '#f5f7fb';
  }

  // --green is a solid, fairly saturated fill in both themes (unlike the
  // translucent --badge-in-bg it replaces on the INNE pill - see
  // .badge.in in board.css) and its exact shade differs enough between
  // light and dark mode that no single fixed text color reads well on
  // both. Read the live value and run it through the same contrast pick
  // as the status tags, instead of guessing.
  function inBadgeTextColor() {
    const green = getComputedStyle(document.documentElement).getPropertyValue('--green').trim();
    return readableTextOn(green);
  }

  // IN/UTE's own label is editable from the admin page's "Statusar" tab
  // (see server/status-store.js) - read it here rather than hardcoding
  // "INNE"/"UTE", so a renamed label actually shows up on the one screen
  // most people only ever glance at. Upper-cased to keep the badge's
  // existing bold, compact look regardless of how it was typed in.
  function primaryLabel(code) {
    const def = statusDefs.primary.find((s) => s.code === code);
    return (def ? def.label : (code === 'IN' ? 'Inne' : 'Ute')).toUpperCase();
  }

  // The single widest pellet this server could ever show - the longest
  // label, plus a representative detail string for whichever kind of
  // detail that status takes (a time, a date/week, or a note), among all
  // currently configured secondary statuses. Used only to stand in for
  // "no status set" when MEASURING how much room to give each row (see
  // personRowHtml's `forMeasurement` and renderBalancedColumns/
  // fitToScreen below) - never actually shown. Picking the single widest
  // one rather than, say, an average, means the measurement never
  // UNDERESTIMATES a row's worst-case width - the real pellet actually
  // shown later (if any) is always this wide or narrower, so basing
  // layout decisions on it is safe in the "never overflow" direction.
  // Recomputed fresh each call (statusDefs.secondary is at most a
  // few dozen entries - cheap) so it stays current if the admin page
  // edits the status list.
  function measurementPelletHtml() {
    if (!statusDefs.secondary.length) return '';
    let best = null;
    let bestLen = -1;
    for (const def of statusDefs.secondary) {
      const detailPlaceholder = def.needsTime ? '00:00'
        : def.needsDate ? '00/00'
        : def.needsNote ? 'Lång kommentar här'
        : '';
      const detail = def.detailPrefix && detailPlaceholder ? `${def.detailPrefix} ${detailPlaceholder}` : detailPlaceholder;
      const len = def.label.length + (detail ? detail.length + 2 : 0);
      if (len > bestLen) { bestLen = len; best = { def, detail }; }
    }
    const { def, detail } = best;
    const textColor = readableTextOn(def.color);
    return `<span class="pellet" style="background:${def.color};color:${textColor}">${esc(def.label)}${detail ? `<span class="detail">· ${esc(detail)}</span>` : ''}</span>`;
  }

  // `forMeasurement`: used only by the sizing pass (see renderBalancedColumns/
  // fitToScreen) to stand in a representative pellet for anyone who doesn't
  // currently have a status set, so the board is sized as if every row
  // might carry one - see measurementPelletHtml's own comment for why. The
  // actually-displayed HTML (forMeasurement left off/false) is completely
  // unaffected - someone with no status set still shows no pellet.
  function personRowHtml(p, opts) {
    const forMeasurement = !!(opts && opts.forMeasurement);
    const checkedIn = !!p.status?.checkedIn;
    const primaryBadge = checkedIn
      ? `<span class="badge in" style="color:${inBadgeTextColor()}">${esc(primaryLabel('IN'))}</span>`
      : `<span class="badge out">${esc(primaryLabel('OUT'))}</span>`;

    // dots (0-3, set per-status on the admin page's "Statusar" tab - see
    // server/status-store.js): a plain, undefined-meaning flag like
    // PLUPP1/PLUPP2 started out as. It still renders as a normal colored
    // pellet like every other status (below), but ALSO gets this many small
    // red dots right next to the name, so it reads at a glance from
    // across the room without needing to read the pellet text.
    const statusDef = p.status?.secondary ? secondaryByCode.get(p.status.secondary) : null;
    const pluppCount = statusDef?.dots || 0;
    const pluppHtml = pluppCount
      ? `<span class="plupp-dots" aria-hidden="true">${'●'.repeat(pluppCount)}</span>`
      : '';

    let pelletHtml = '';
    if (statusDef) {
      const detail = p.status.detail || p.status.note || '';
      const textColor = readableTextOn(statusDef.color);
      pelletHtml = `<span class="pellet" style="background:${statusDef.color};color:${textColor}">${esc(statusDef.label)}${detail ? `<span class="detail">· ${esc(detail)}</span>` : ''}</span>`;
    } else if (forMeasurement) {
      pelletHtml = measurementPelletHtml();
    }

    // The whole row - not just the small badge - tints by IN/OUT (see
    // .person-row.in / .person-row.out in board.css), so status reads at a
    // glance from across a room without having to find and read the pill.
    //
    // .person-row-top is TWO flex items, not one wrapping row: the badge
    // on its own, and everything else (avatar, name, dots, pellet) boxed up
    // in .person-row-main next to it. Because the badge sits OUTSIDE
    // .person-row-main's own flex-wrap, it can never be pushed down onto
    // a second line the way a plain "everything in one wrapping row"
    // layout would - it always stays put, pinned top-right, exactly where
    // it's always been. The pellet is the last thing inside .person-row-main,
    // so it lands right before the badge (same line) when there's room, or
    // wraps to its own line underneath - alongside avatar/name, never
    // alongside the badge - when there isn't. No JS decides which; it
    // falls out of ordinary flex wrapping given each row's actual
    // rendered width (see board.css for both pieces).
    return `<div class="person-row ${checkedIn ? 'in' : 'out'}" data-id="${esc(p.id)}">
      <div class="person-row-top">
        <div class="person-row-main">
          ${window.avatarHtml(p, 'avatar-sm')}
          <span class="person-name">${esc(p.name)}</span>
          ${pluppHtml}
          ${pelletHtml}
        </div>
        ${primaryBadge}
      </div>
    </div>`;
  }

  // Whether `p` shows up on THIS screen, given the current coop filter
  // (locationFilter - "" means "Alla Coops"/no filter):
  //  - Normally (restrictToLocation off, the default): shown whenever the
  //    filter is "all", or matches their own `location`.
  //  - restrictToLocation on (the admin page's "Visa bara i sin egen
  //    coop" checkbox): shown ONLY when the filter is their own exact
  //    coop - never under "Alla Coops", never under a different
  //    coop's filter. This is for someone who'd otherwise just be
  //    noise on the combined view (e.g. a warehouse-only role) - they
  //    still show normally on their own coop's screens.
  function visible(p) {
    if (p.active === false) return false;
    const loc = (p.location || '').trim();
    if (p.restrictToLocation) return !!loc && loc === locationFilter;
    return !locationFilter || loc === locationFilter;
  }

  function render() {
    ensureValidLocationFilter();
    MIN_SCALE = BASE_MIN_SCALE * manualScaleFactor;
    MAX_SCALE = BASE_MAX_SCALE * manualScaleFactor;
    const active = [...people.values()].filter(visible);
    if (!active.length) {
      boardEl.innerHTML = `<div class="empty-hint">Ingen är tillagd ännu. Öppna adminsidan eller importera en personallista (CSV).</div>`;
      return;
    }

    // Show a small "which coop" label on each card, above the
    // department name, only when it actually adds information: several
    // coops are in play AND this view spans more than one of them
    // (i.e. "Alla Coops" is selected). Filtered to one specific
    // coop, every card would show that exact same label - pure noise,
    // so it's left off, same as today's single-coop look.
    const showLocationLabels = !locationFilter && allLocations().length > 1;

    // Cards are grouped by (location, department) rather than department
    // alone, so two coops that happen to share a department name (e.g.
    // both have a "Reception") get their own separate cards rather than
    // being merged - see README's "Multiple coops".
    const groups = new Map(); // "location\u0001department" -> { location, dept, members }
    for (const p of active) {
      const location = (p.location || '').trim();
      const dept = p.department || 'Ej tilldelad';
      // \u0001 sorts below any normal printable character, so comparing
      // these composite keys as plain strings (see the .sort() calls
      // below and in renderBalancedColumns) already sorts by location
      // first, then department - exactly the "location, department, role,
      // name" order this board is meant to read in.
      const key = location + '\u0001' + dept;
      if (!groups.has(key)) groups.set(key, { location, dept, members: [] });
      groups.get(key).members.push(p);
    }

    const groupKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'sv'));

    // Two parallel versions of each department card's HTML: `groupHtml`
    // (real - only people who actually have a status set show a pellet) is
    // what actually gets displayed. `groupHtmlForMeasurement` stands a
    // representative pellet (see measurementPelletHtml) in for EVERYONE who
    // doesn't currently have one, and is used ONLY to decide how much
    // room to give the board (see renderBalancedColumns/fitToScreen) -
    // sizing the board as if every row might carry a status, rather than
    // however many happen to right now, keeps the layout from swinging
    // wildly (or leaving the board looking sparsely filled) as people's
    // statuses come and go through the day.
    const groupEntries = groupKeys.map((key) => {
      const { location, dept, members: raw } = groups.get(key);
      const members = raw.sort((a, b) =>
        (a.role || '').localeCompare(b.role || '', 'sv') || (a.order - b.order) || a.name.localeCompare(b.name, 'sv')
      );
      const inCount = members.filter((m) => m.status?.checkedIn).length;

      const byRole = new Map();
      for (const m of members) {
        const role = m.role || 'Övrigt';
        if (!byRole.has(role)) byRole.set(role, []);
        byRole.get(role).push(m);
      }

      const buildRoleHtml = (forMeasurement) => [...byRole.entries()].map(([role, members2]) => `
        <div class="role-group">
          <div class="role-label">${esc(role)}</div>
          ${members2.map((m) => personRowHtml(m, { forMeasurement })).join('')}
        </div>
      `).join('');

      const locationHtml = showLocationLabels
        ? `<div class="dept-location">${esc(location || 'Ej tilldelad coop')}</div>`
        : '';
      const headerHtml = `<h2><span class="dept-name">${esc(dept)}</span><span class="count">${inCount}/${members.length} inne</span></h2>`;

      const html = `<section class="dept">${locationHtml}${headerHtml}${buildRoleHtml(false)}</section>`;
      const htmlForMeasurement = `<section class="dept">${locationHtml}${headerHtml}${buildRoleHtml(true)}</section>`;
      return [key, html, htmlForMeasurement];
    });
    const groupHtml = new Map(groupEntries.map(([key, html]) => [key, { html }]));
    const groupHtmlForMeasurement = new Map(groupEntries.map(([key, , htmlForMeasurement]) => [key, { html: htmlForMeasurement }]));

    const best = renderBalancedColumns(groupKeys, groupHtmlForMeasurement);
    fitToScreen(best.cols, groupHtml, groupHtmlForMeasurement);
  }

  // ------------------------------------------------------- balanced columns
  // Cards are keyed by "location\u0001department" (see render() above) -
  // this function itself doesn't care what the keys mean, just their
  // rendered HTML and how to sort them for display, so a card being a
  // coop+department pair instead of a bare department "just works"
  // here unchanged.
  //
  // Column COUNT is chosen by actually trying every count from 1 up to
  // however many fit at a readable width, and measuring - for real, in the
  // DOM - how tall the tallest resulting column comes out at scale=1.
  // Whichever count lets fitToScreen() below reach the LARGEST final scale
  // (i.e. fills the screen most fully) wins. This can't be predicted from
  // width alone: row height is set in `cqw` (% of the COLUMN's own width -
  // see board.css's .board-col comment), but department padding/margins
  // are fixed vh, so a column's natural height isn't simply proportional
  // to its width or its headcount - it has to be measured per candidate.
  //
  // This matters most on a big or wide screen with a moderate headcount:
  // picking columns by width alone (the old approach) can land on many
  // narrow columns that each run out of people well before the bottom of
  // the screen - department cards hugging the top, with a lot of empty
  // board below them. Naively scoring each candidate purely by
  // available-height/needed-height doesn't fix this either: a narrow
  // column with little content LOOKS like it can just grow to fill the
  // gap, but a narrow column can run into names overflowing their own
  // (fixed pixel) column width well before it reaches the bottom of the
  // screen - see findWidthSafeScale() below, which caps each candidate's
  // score at what it could actually reach without that happening, the
  // exact same check fitToScreen() itself does for real afterwards (both
  // call the same function, so a candidate's predicted score always
  // matches what actually ends up on screen). Fewer, wider columns stack
  // more per column, need less (or no) scaling up to reach the same final
  // height, and have far more width to grow into before hitting that
  // ceiling - so once both height AND width are accounted for, they win
  // out over many thin columns whenever the screen is wide enough to make
  // that trade-off possible. A handful of reflows per render (one or a
  // few per candidate count) is the cost of measuring this for real
  // instead of guessing - cheap next to how rarely the board actually
  // re-renders (a check-in, an admin edit, or a resize).
  //
  // Within a chosen column count, departments are still greedily assigned
  // to whichever column is currently shortest (tallest departments first -
  // the standard "longest processing time" bin-balancing heuristic), so
  // rendered column height stays reasonably even across columns too - see
  // measureDeptWeights() below for what "tallest" is measured against.
  const COL_MIN_WIDTH = 220; // never pack columns narrower than this - a readability floor

  // Headcount alone underrates a department's real weight: every
  // department also carries its own fixed chrome (a heading, and a label
  // per role group inside it) on top of its people rows, so two columns
  // with the same total headcount can still render at very different
  // heights if one holds fewer, bigger departments and the other holds
  // more, smaller ones. Measuring each department's actual rendered
  // height once (at scale 1, all of them stacked in a single reference
  // column so they're all measured at the same width) and packing by
  // THAT instead is exact rather than a guessed correction factor, and
  // only costs one extra reflow per render.
  function measureDeptWeights(deptNames, deptHtml) {
    boardEl.style.setProperty('--scale', '1');
    boardEl.innerHTML = `<div class="board-col">${deptNames.map((d) => deptHtml.get(d).html).join('')}</div>`;
    const weights = new Map();
    [...boardEl.querySelector('.board-col').children].forEach((el, i) => {
      weights.set(deptNames[i], el.offsetHeight);
    });
    return weights;
  }

  function packColumns(order, weights, columns) {
    const cols = Array.from({ length: columns }, () => ({ load: 0, depts: [] }));
    for (const dept of order) {
      const col = cols.reduce((min, c) => (c.load < min.load ? c : min), cols[0]);
      col.depts.push(dept);
      col.load += weights.get(dept);
    }
    return cols;
  }

  // Within a column, show departments in their normal alphabetical order
  // rather than the size-sorted assignment order, so the layout still
  // reads naturally top-to-bottom.
  function buildColumnsHtml(cols, deptHtml) {
    return cols.map((col) => {
      const deptsInOrder = [...col.depts].sort((a, b) => a.localeCompare(b, 'sv'));
      return `<div class="board-col">${deptsInOrder.map((d) => deptHtml.get(d).html).join('')}</div>`;
    }).join('');
  }

  // The largest --scale, at most `hi`, that keeps every name inside its
  // own column - shared by the column-count search below AND by
  // fitToScreen()'s own final correction pass, so a candidate's predicted
  // score and what actually ends up on screen always agree (they used to
  // use two different methods - see board.js's git history/README - which
  // is why picking the "best" column count didn't always produce the
  // largest real on-screen result).
  //
  // This does NOT assume scale=1 (or any other starting point) is safe: a
  // name's actual pixel width depends on the STRING, not just the column's
  // cqw-based sizing, so a long enough name in a narrow enough column can
  // still overflow even at scale=1. MIN_SCALE is the one value that's
  // always safe to start from - it's the smallest size this board ever
  // renders text at - so the search starts there and works up towards
  // `hi`, rather than assuming a safe lower bound.
  function findWidthSafeScale(hi) {
    boardEl.style.setProperty('--scale', String(hi));
    if (!hasHorizontalOverflow()) return hi;
    boardEl.style.setProperty('--scale', String(MIN_SCALE));
    if (hasHorizontalOverflow()) return MIN_SCALE; // nothing more we can do
    let lo = MIN_SCALE, bad = hi;
    for (let i = 0; i < 10; i++) {
      const mid = (lo + bad) / 2;
      boardEl.style.setProperty('--scale', String(mid));
      if (hasHorizontalOverflow()) bad = mid; else lo = mid;
    }
    return lo;
  }

  // `deptHtml` is only ever used here to size things (both the weights
  // below and every candidate's trial render) - it's meant to be the
  // MEASUREMENT map (every row assumed to carry a representative status
  // pellet - see measurementPelletHtml/personRowHtml's `forMeasurement`), not
  // the real one, so the chosen column count and scale reflect a stable
  // "as if everyone had a status" worst case rather than however many
  // people happen to have one set right now. The caller (render(), via
  // fitToScreen below) is the one that actually swaps in the real HTML
  // for display, once a `cols` arrangement has been picked here.
  function renderBalancedColumns(deptNames, deptHtml) {
    const width = boardEl.clientWidth || window.innerWidth;
    // boardEl's own height comes from the surrounding flex layout (see
    // board.css's .board comment), not from whatever's currently inside
    // it, so this stays valid while different candidates are swapped
    // through it below.
    const available = boardEl.clientHeight || window.innerHeight;
    const maxColumns = Math.max(1, Math.min(deptNames.length, Math.floor(width / COL_MIN_WIDTH)));
    const weights = measureDeptWeights(deptNames, deptHtml);
    const order = [...deptNames].sort((a, b) => weights.get(b) - weights.get(a));

    let best = null;
    for (let c = 1; c <= maxColumns; c++) {
      const cols = packColumns(order, weights, c);
      boardEl.style.setProperty('--scale', '1');
      boardEl.innerHTML = buildColumnsHtml(cols, deptHtml);
      const needed = measureNeeded();
      const heightScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (available / needed) * 0.99));
      // Growing a narrow (many-column) candidate to fill spare height can
      // outgrow that column's own fixed pixel width before it fills the
      // available height (and a long name can do this even without
      // growing at all) - a plain height/needed ratio doesn't see that,
      // and would keep rating a too-narrow candidate as "great, just grow
      // it" right up until the real fitToScreen() pass below claws it back
      // down for real, leaving the narrow columns short of the bottom of
      // the screen after all. Cap by the same width check fitToScreen()
      // itself uses, so a candidate's score reflects what it can ACTUALLY
      // reach.
      const scale = findWidthSafeScale(heightScale);
      // A >=2% larger achievable scale is a real win; within that, prefer
      // fewer (wider, easier-to-read-at-a-glance) columns for the same fit.
      if (!best || scale > best.scale * 1.02 || (scale > best.scale * 0.98 && c < best.columns)) {
        best = { columns: c, cols, scale };
      }
    }

    // No final real-content render here any more - fitToScreen() (below)
    // re-measures against this same `cols` arrangement (still using the
    // measurement map, for the same "as if everyone had a status" reason)
    // and is the one that ends up swapping in the real HTML once it's
    // settled on a final scale, so writing real content here would just
    // be thrown away immediately.
    return best;
  }

  // -------------------------------------------------------- fit to screen
  // This board is static - it never scrolls. Instead, with enough people
  // (or one department much bigger than the rest), we shrink everything
  // down via the --scale custom property (see board.css) just enough that
  // it all fits in the fixed-height container. Measures once per render
  // against the natural (scale=1) size, so it's accurate regardless of
  // how many people/departments are on screen or which way the display is
  // oriented (landscape or portrait both just work - the grid's column
  // count adapts to width on its own, and this handles the height).
  const BASE_MIN_SCALE = 0.55; // floor so text never becomes illegible from a distance
  const BASE_MAX_SCALE = 1.3;  // ceiling so a handful of people don't get comically huge
  // Effective bounds for the CURRENT render - BASE_* above scaled by the
  // board-settings popup's manual size adjustment (manualScaleFactor, see
  // the "board size" section above). Recomputed at the top of render(), so
  // findWidthSafeScale/renderBalancedColumns/fitToScreen below (all three
  // reference these, not the BASE_* constants directly) automatically
  // operate inside whichever range is currently in effect - see
  // manualScaleFactor's own comment for why shifting the range this way,
  // rather than multiplying a final result, is what keeps this safe in
  // both directions (never actually overflows, either way).
  let MIN_SCALE = BASE_MIN_SCALE;
  let MAX_SCALE = BASE_MAX_SCALE;

  // Text sizes are in `cqw` (column width) but ALSO multiplied by --scale
  // (see board.css), so a name's actual pixel width depends on both the
  // column's own width and --scale together - and, since cqw only sizes
  // the FONT, not the string, a sufficiently long name can outgrow its
  // (fixed pixel) column even at scale 1 or below, not only when growing
  // past 1. This checks for that directly rather than assuming a safe
  // range and guessing a ceiling.
  function hasHorizontalOverflow() {
    const els = boardEl.querySelectorAll('.person-name, .dept-name');
    for (const el of els) {
      if (el.scrollWidth > el.clientWidth + 1) return true;
    }
    return false;
  }

  // boardEl itself has a fixed height + overflow:hidden, so ITS OWN
  // scrollHeight can't report "shorter than the box" (the DOM clamps
  // scrollHeight to at least clientHeight for a clipped box) - it only
  // ever tells us when content is taller. To detect "there's spare room"
  // for the grow pass below, measure the tallest .board-col instead: those
  // are plain flex children with no height of their own, so their
  // scrollHeight is the column's true, unclamped content height.
  function measureNeeded() {
    let max = 0;
    boardEl.querySelectorAll('.board-col').forEach((col) => {
      if (col.scrollHeight > max) max = col.scrollHeight;
    });
    if (!max) return boardEl.clientHeight;
    // A .board-col's own scrollHeight doesn't include ITS PARENT's
    // (boardEl's) top/bottom padding, so add that back in - otherwise
    // "needed" is consistently short by exactly that much and the loop
    // below converges just past the actual edge of the screen.
    const cs = getComputedStyle(boardEl);
    const padV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    return max + padV;
  }

  // `cols` is the column arrangement renderBalancedColumns already settled
  // on. `measureHtml` is the same "as if everyone had a status" map it
  // used to pick that arrangement (see its own comment) - phase 1 below
  // reuses it so the FINAL scale is decided against that same stable,
  // representative worst case, not however many people happen to have a
  // status set right now. `deptHtml` is the real, actually-displayed
  // content, swapped in for phase 2 once the scale is settled.
  function fitToScreen(cols, deptHtml, measureHtml) {
    // ---- phase 1: converge --scale against the MEASUREMENT content ----
    boardEl.style.setProperty('--scale', '1');
    boardEl.innerHTML = buildColumnsHtml(cols, measureHtml);
    // boardEl's own height comes from the surrounding flex layout, not
    // from whatever's currently inside it (see renderBalancedColumns'
    // comment), so measuring it once here stays valid through both
    // phases even though the content inside gets swapped out below.
    const available = boardEl.clientHeight;
    let scale = 1;
    // One damped, converging loop that shrinks OR grows toward whatever
    // scale makes the content just fill the available height: each pass
    // re-measures (since shrinking/growing text can itself change line
    // wrapping and thus the height needed) and nudges scale by the ratio
    // of available/needed, backed off by 1% as a safety margin so it
    // settles fractionally under the limit instead of oscillating around
    // it, and clamped per-step so one odd measurement can't send it
    // somewhere wild.
    for (let i = 0; i < 8; i++) {
      const needed = measureNeeded();
      const raw = scale * (available / needed) * 0.99;
      const stepClamped = Math.min(Math.max(raw, scale * 0.75), scale * 1.25);
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, stepClamped));
      if (Math.abs(next - scale) < 0.003) { scale = next; boardEl.style.setProperty('--scale', String(scale)); break; }
      scale = next;
      boardEl.style.setProperty('--scale', String(scale));
    }
    // Safety pass: never leave it actually overflowing, even if the loop
    // above ran out of iterations mid-convergence.
    for (let i = 0; i < 3; i++) {
      const needed = measureNeeded();
      if (needed <= available || scale <= MIN_SCALE) break;
      scale = Math.max(MIN_SCALE, scale * (available / needed) * 0.99);
      boardEl.style.setProperty('--scale', String(scale));
    }
    // And never leave a name truncated because growing overshot the
    // column's actual width. Uses the same precise binary search as the
    // column-count search above (findWidthSafeScale) rather than backing
    // off in coarse fixed steps - a coarse step-down here used to land on
    // a noticeably SMALLER scale than the tight one the column-count
    // search had already found achievable for this exact layout, wasting
    // real screen space for no reason (the two methods disagreeing was
    // also what made column-count selection unreliable - see
    // findWidthSafeScale's own comment).
    scale = findWidthSafeScale(scale);

    // ---- phase 2: swap in the REAL content at that scale ----
    // A representative measurement pellet is always at least as wide as any
    // real one (see measurementPelletHtml), so this is normally just a
    // straight swap with nothing left to correct - but the same safety
    // passes run again anyway, against the real content this time, so an
    // unusually long hand-typed note (server.js allows up to 200
    // characters) still can never leave the board actually overflowing.
    boardEl.innerHTML = buildColumnsHtml(cols, deptHtml);
    boardEl.style.setProperty('--scale', String(scale));
    for (let i = 0; i < 3; i++) {
      const needed = measureNeeded();
      if (needed <= available || scale <= MIN_SCALE) break;
      scale = Math.max(MIN_SCALE, scale * (available / needed) * 0.99);
      boardEl.style.setProperty('--scale', String(scale));
    }
    scale = findWidthSafeScale(scale);
    boardEl.style.setProperty('--scale', String(scale));
  }

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { render(); }, 150);
  });

  boot();
})();
