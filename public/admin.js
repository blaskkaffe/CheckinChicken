(() => {
  let passcode = '';
  let gateBuffer = '';
  // Blocks a second, overlapping tryEnter() call while one is already
  // in flight - see tryEnter's own comment for why that matters.
  let entering = false;
  let roster = [];
  let editingId = null;
  let cfg = {};
  // undefined = leave photo untouched, null = remove it, string = new data URL
  let pendingPhoto;

  let statusDefs = { primary: [], secondary: [] };
  let editingStatusCode = null;
  // 'primary' | 'secondary' - which fields the status modal shows (see
  // applyStatusModalVisibility). 'primary' only for IN/UTE; every other
  // status (the one flat, admin-editable list) is 'secondary'.
  let editingStatusScope = 'secondary';

  let themeOptions = []; // from /api/theme - the full list from server/themes.js
  let currentTheme = null;
  let backgroundsById = {}; // from /api/backgrounds
  let settings = {};
  const kbHandles = []; // every attachOnscreenKeyboard() handle, so the settings toggle can flip them all at once

  const MAX_PHOTO_PX = 200; // resized client-side so we never sync a huge image
  const MAX_BG_PX = 1600; // background pictures are shown full-screen, so allow a lot more detail than an avatar

  function resizePhoto(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('kunde inte läsa filen'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('kunde inte läsa bilden'));
        img.onload = () => {
          const side = Math.min(img.width, img.height);
          const sx = (img.width - side) / 2;
          const sy = (img.height - side) / 2;
          const canvas = document.createElement('canvas');
          canvas.width = MAX_PHOTO_PX;
          canvas.height = MAX_PHOTO_PX;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, sx, sy, side, side, 0, 0, MAX_PHOTO_PX, MAX_PHOTO_PX);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // Same idea as resizePhoto, but keeps the original aspect ratio (a
  // background isn't cropped to a square) and allows a much bigger frame
  // since it's shown full-screen, not as a small avatar circle.
  function resizeBackground(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('kunde inte läsa filen'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('kunde inte läsa bilden'));
        img.onload = () => {
          const scale = Math.min(1, MAX_BG_PX / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  const $ = (id) => document.getElementById(id);

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', 'X-Admin-Passcode': passcode, ...(opts.headers || {}) },
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `request failed (${res.status})`);
    return res.json();
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Distinct, non-blank `location` values currently in the roster - fills
  // the "Byggnad" field's datalist suggestions (fLocation/locationList),
  // same idea as the existing department datalist just below.
  function locationOptions() {
    return [...new Set(roster.map((p) => p.location).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sv'));
  }

  // ------------------------------------------------------------- gate ----
  // A big touch-friendly numpad, same look as the old per-person PIN pad
  // used to have, instead of a small text field - the admin passcode is
  // usually typed standing at a touchscreen, same as everything else here.
  function renderGateDots() {
    const len = Math.max(4, gateBuffer.length);
    $('gatePinDots').innerHTML = Array.from({ length: len }, (_, i) =>
      `<span class="dot ${i < gateBuffer.length ? 'filled' : ''}"></span>`
    ).join('');
  }

  function buildGateKeypad() {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'];
    $('gateKeypad').innerHTML = keys.map((k) => {
      const cls = k === '⌫' ? 'key-star' : k === '✓' ? 'key-hash' : '';
      return `<button type="button" class="${cls}" data-key="${esc(k)}">${esc(k)}</button>`;
    }).join('');
    $('gateKeypad').querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const k = btn.dataset.key;
        if (k === '⌫') { gateBuffer = gateBuffer.slice(0, -1); return renderGateDots(); }
        if (k === '✓') return tryEnter();
        gateBuffer += k;
        renderGateDots();
      });
    });
  }

  // The ✓ key is the only way in now (see admin.html's gate comment), but
  // it's still one tap on a touchscreen, and this whole function is a long
  // chain of awaited fetches - a second tap (or the keyboard event firing
  // twice) before the first call has finished would run a second copy of
  // all of it in parallel, opening a second SSE connection (connectEvents)
  // and a second on-screen-keyboard instance per field (wireOnscreenKeyboards)
  // that nothing ever tears down. `entering` just blocks that: set the
  // moment a call starts, cleared in every exit path (success clears it
  // implicitly by never needing another attempt in this session; the catch
  // block below clears it explicitly so a mistyped code can be retried).
  async function tryEnter() {
    if (entering) return;
    entering = true;
    passcode = gateBuffer;
    try {
      roster = await api('/api/admin/people');
      $('gate').style.display = 'none';
      closePopupChrome(); // stop the gate's own idle-watcher now that it's hidden
      $('main').style.display = 'block';
      cfg = await fetch('/api/config').then((r) => r.json());
      $('aLocationName').textContent = `${cfg.locationName} — Personallista`;
      $('aThemeLocationName').textContent = cfg.locationName || 'den här platsen';
      renderRoster();
      await loadStatuses();
      // Re-render now that statusDefs is actually populated - the render
      // just above ran against the still-empty default, so if IN/OUT has
      // been renamed from "Inne"/"Ute" the Status column would otherwise
      // show the wrong text until something else (e.g. a 'person' SSE
      // event) happened to trigger another render.
      renderRoster();
      await loadTheme();
      await loadBackgrounds();
      await loadSettings();
      connectEvents();
      wireOnscreenKeyboards();
    } catch (e) {
      $('gateError').textContent = 'Fel kod.';
      gateBuffer = '';
      renderGateDots();
      entering = false;
    }
  }

  function connectEvents() {
    const es = new EventSource('/api/events');
    es.addEventListener('person', async () => {
      // Re-fetch (the public /api/people endpoint the board uses omits
      // some admin-only bookkeeping) so this table never drifts stale.
      try { roster = await api('/api/admin/people'); renderRoster(); } catch (e) {}
    });
    // Someone (maybe this same admin page in another tab) edited the
    // status menu - keep this page's copy from going stale too. Also
    // re-renders the People roster, not just the Statusar tab itself -
    // its own Status column reads the same IN/OUT labels (see
    // primaryLabel), so a rename needs to reach both places, not just
    // the tab it was made from.
    es.addEventListener('statuses', (e) => {
      statusDefs = JSON.parse(e.data);
      renderStatuses();
      renderRoster();
    });
    // The theme was changed - possibly from this very picker in another
    // tab, possibly by someone else. window.applyTheme (theme.js) updates
    // the page itself; renderThemeSelect keeps this tab's dropdown from
    // silently going stale too.
    es.addEventListener('theme', (e) => {
      const { theme } = JSON.parse(e.data);
      window.applyTheme(theme);
      currentTheme = theme;
      renderThemeSelect();
      renderBackgroundPanel();
    });
    es.addEventListener('backgrounds', async () => {
      await loadBackgrounds();
      window.refreshBackgrounds && window.refreshBackgrounds();
    });
    es.addEventListener('settings', (e) => {
      settings = JSON.parse(e.data);
      window.applySettings && window.applySettings(settings);
      renderSettingsForm();
    });
  }

  // -------------------------------------------------------- tabs --------
  function showTab(tab) {
    $('tabPeople').classList.toggle('active', tab === 'people');
    $('tabStatuses').classList.toggle('active', tab === 'statuses');
    $('tabAppearance').classList.toggle('active', tab === 'appearance');
    $('tabSettings').classList.toggle('active', tab === 'settings');
    $('peoplePanel').style.display = tab === 'people' ? '' : 'none';
    $('statusesPanel').style.display = tab === 'statuses' ? '' : 'none';
    $('appearancePanel').style.display = tab === 'appearance' ? '' : 'none';
    $('settingsPanel').style.display = tab === 'settings' ? '' : 'none';
  }

  // Sorted by location (building), then department, then by `order` (the
  // field the up/down arrows below edit), then name - the same order the
  // board itself groups people in (see board.js's render()).
  function sortedRoster() {
    return [...roster].sort((a, b) =>
      (a.location || '').localeCompare(b.location || '', 'sv') ||
      (a.department || '').localeCompare(b.department || '', 'sv') ||
      (a.order || 0) - (b.order || 0) ||
      a.name.localeCompare(b.name, 'sv')
    );
  }

  async function move(id, direction) {
    // Swap `order` with whichever neighbor is adjacent WITHIN THE SAME
    // BUILDING + DEPARTMENT in the currently-sorted table - moving someone
    // across that boundary isn't what these arrows are for (edit their
    // Byggnad/Avdelning fields directly for that).
    const rows = sortedRoster();
    const i = rows.findIndex((p) => p.id === id);
    const j = i + direction;
    if (j < 0 || j >= rows.length) return;
    const a = rows[i], b = rows[j];
    if ((a.location || '') !== (b.location || '') || (a.department || '') !== (b.department || '')) return;
    const aOrder = a.order || 0, bOrder = b.order || 0;
    try {
      await api('/api/admin/people', { method: 'POST', body: JSON.stringify({ ...stripStatus(a), order: bOrder }) });
      await api('/api/admin/people', { method: 'POST', body: JSON.stringify({ ...stripStatus(b), order: aOrder }) });
      roster = await api('/api/admin/people');
      renderRoster();
    } catch (e) { /* ignore - a failed reorder just leaves things as they were */ }
  }

  // The admin POST endpoint takes a flat record, not the nested `status`
  // object GET returns - this strips it back down to what's needed for a
  // reorder (everything else stays as it already is server-side, since the
  // endpoint only overwrites fields that are present in the body).
  function stripStatus(p) {
    return {
      id: p.id, name: p.name, department: p.department, role: p.role, order: p.order, active: p.active,
      location: p.location, restrictToLocation: p.restrictToLocation,
    };
  }

  // Mirrors board.js's own primaryLabel() (same fallback: the admin-set
  // label if one's configured, else the hardcoded Swedish default) - read
  // from statusDefs rather than hardcoded here too, so renaming IN/OUT on
  // the Statusar tab actually shows up in this table instead of leaving
  // it stuck on stale text. Lowercased (board.js's own version uppercases
  // it instead, for its big wall-display badge) to match this table's own
  // existing lowercase convention ("inaktiv", "redigera") rather than
  // suddenly introducing all-caps into a quiet admin list.
  function primaryLabel(code) {
    const def = statusDefs.primary.find((s) => s.code === code);
    return (def ? def.label : (code === 'IN' ? 'Inne' : 'Ute')).toLowerCase();
  }

  function renderRoster() {
    const rows = sortedRoster();
    $('rosterBody').innerHTML = rows.map((p, i) => {
      const prev = rows[i - 1], next = rows[i + 1];
      const canUp = prev && (prev.department || '') === (p.department || '');
      const canDown = next && (next.department || '') === (p.department || '');
      return `
      <tr data-id="${p.id}">
        <td class="reorder-cell">
          <button type="button" class="reorder-btn" data-dir="-1" ${canUp ? '' : 'disabled'} title="Flytta upp">&#9650;</button>
          <button type="button" class="reorder-btn" data-dir="1" ${canDown ? '' : 'disabled'} title="Flytta ner">&#9660;</button>
        </td>
        <td>${window.avatarHtml(p, 'avatar-xs')}</td>
        <td>${esc(p.name)}${p.restrictToLocation ? ` <span class="pill-inactive" title="Visas bara i ${esc(p.location || 'sin byggnad')}">bara ${esc(p.location || 'egen byggnad')}</span>` : ''}</td>
        <td>${esc(p.location || '')}</td>
        <td>${esc(p.department)}</td>
        <td>${esc(p.role)}</td>
        <td>${p.active === false ? '<span class="pill-inactive">inaktiv</span>' : primaryLabel(p.status?.checkedIn ? 'IN' : 'OUT')}</td>
        <td>redigera</td>
      </tr>
    `;
    }).join('');
    $('rosterBody').querySelectorAll('tr').forEach((tr) => {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('.reorder-btn')) return;
        openModal(roster.find((p) => p.id === tr.dataset.id));
      });
      tr.querySelectorAll('.reorder-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          move(tr.dataset.id, Number(btn.dataset.dir));
        });
      });
    });

    const depts = [...new Set(roster.map((p) => p.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sv'));
    $('deptList').innerHTML = depts.map((d) => `<option value="${esc(d)}"></option>`).join('');
    $('locationList').innerHTML = locationOptions().map((l) => `<option value="${esc(l)}"></option>`).join('');
  }

  function renderPhotoPreview(person) {
    const effectivePhoto = pendingPhoto !== undefined ? pendingPhoto : (person?.photo || null);
    $('fPhotoPreview').innerHTML = window.avatarHtml({ name: person?.name || $('fName').value, photo: effectivePhoto }, 'avatar-md');
  }

  function openModal(person) {
    editingId = person ? person.id : null;
    pendingPhoto = undefined;
    $('modalTitle').textContent = person ? 'Redigera person' : 'Lägg till person';
    $('fName').value = person?.name || '';
    $('fDept').value = person?.department || '';
    $('fRole').value = person?.role || '';
    $('fPhone').value = person?.phone || '';
    $('fActive').checked = person ? person.active !== false : true;
    $('fLocation').value = person?.location || '';
    $('fRestrict').checked = !!person?.restrictToLocation;
    $('fPhotoInput').value = '';
    renderPhotoPreview(person);
    $('modalError').textContent = '';
    $('modalBackdrop').style.display = 'flex';
    openPopupChrome($('modalBackdrop').querySelector('.modal'), closeModal);
  }
  function closeModal() { $('modalBackdrop').style.display = 'none'; closePopupChrome(); }

  async function saveModal() {
    const name = $('fName').value.trim();
    const department = $('fDept').value.trim();
    const role = $('fRole').value.trim();
    const phone = $('fPhone').value.trim();
    const active = $('fActive').checked;
    const location = $('fLocation').value.trim();
    const restrictToLocation = $('fRestrict').checked;

    if (!name) return ($('modalError').textContent = 'Namn krävs.');
    if (phone.length > 40) return ($('modalError').textContent = 'Telefonnumret ser för långt ut.');
    if (location.length > 60) return ($('modalError').textContent = 'Byggnadens namn ser för långt ut.');
    const payload = { id: editingId, name, department, role, phone, active, location, restrictToLocation };
    if (pendingPhoto !== undefined) payload.photo = pendingPhoto;

    try {
      await api('/api/admin/people', { method: 'POST', body: JSON.stringify(payload) });
      roster = await api('/api/admin/people');
      renderRoster();
      closeModal();
    } catch (e) {
      $('modalError').textContent = e.message;
    }
  }

  // Deactivating is just unchecking "Aktiv" and saving, same as any other
  // field edit (see saveModal() above) - sets active=false rather than
  // deleting outright, so the person stays visible (greyed out) in the
  // roster and can be re-activated later by editing them again and
  // ticking "Aktiv" back on. There used to be a separate "Inaktivera"
  // button here too, doing the exact same POST with a confirm() dialog in
  // front of it - removed as redundant with the checkbox that already
  // does this.

  // ----------------------------------------------------- statuses tab ---
  async function loadStatuses() {
    statusDefs = await fetch('/api/statuses').then((r) => r.json());
    renderStatuses();
  }

  function extraSummary(s) {
    if (s.needsTime) return 'Tid' + (s.detailPrefix ? ` (${esc(s.detailPrefix)})` : '');
    // "Datum" covers both: the popup itself offers a Dag/Vecka choice at
    // pick-time (see statuspopup.js) rather than that being decided here.
    if (s.needsDate) return 'Datum (dag/vecka)' + (s.detailPrefix ? ` (${esc(s.detailPrefix)})` : '');
    if (s.needsNote) return 'Anteckning';
    return '<span class="dim">–</span>';
  }

  function renderPrimaryTable() {
    $('primaryBody').innerHTML = statusDefs.primary.map((s) => `
      <tr data-code="${esc(s.code)}">
        <td><span class="color-swatch" style="background:${esc(s.color)}"></span></td>
        <td>${esc(s.label)}</td>
        <td>redigera</td>
      </tr>
    `).join('');
    $('primaryBody').querySelectorAll('tr').forEach((tr) => {
      tr.addEventListener('click', () => {
        openStatusModal('primary', statusDefs.primary.find((s) => s.code === tr.dataset.code));
      });
    });
  }

  function renderMenuTable(bodyId, list, scope) {
    $(bodyId).innerHTML = list.map((s, i) => `
      <tr data-code="${esc(s.code)}">
        <td class="reorder-cell">
          <button type="button" class="reorder-btn" data-dir="-1" ${i === 0 ? 'disabled' : ''} title="Flytta upp">&#9650;</button>
          <button type="button" class="reorder-btn" data-dir="1" ${i === list.length - 1 ? 'disabled' : ''} title="Flytta ner">&#9660;</button>
        </td>
        <td><span class="color-swatch" style="background:${esc(s.color)}"></span></td>
        <td>${esc(s.label)}</td>
        <td>${extraSummary(s)}</td>
        <td>${s.checksOut ? '✓' : '<span class="dim">–</span>'}</td>
        <td>${s.dots ? esc(String(s.dots)) : '<span class="dim">–</span>'}</td>
        <td>redigera</td>
      </tr>
    `).join('');
    $(bodyId).querySelectorAll('tr').forEach((tr) => {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('.reorder-btn')) return;
        openStatusModal(scope, list.find((s) => s.code === tr.dataset.code));
      });
      tr.querySelectorAll('.reorder-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          moveStatusRow(tr.dataset.code, Number(btn.dataset.dir));
        });
      });
    });
  }

  const MENU_MAX = 16; // must match server/status-store.js's MENU_MAX

  function renderStatuses() {
    renderPrimaryTable();
    renderMenuTable('statusBody', statusDefs.secondary, 'secondary');
    const full = statusDefs.secondary.length >= MENU_MAX;
    $('addStatusBtn').disabled = full;
    $('addStatusBtn').title = full ? `Listan är full (max ${MENU_MAX}) - ta bort eller flytta en status härifrån först.` : '';
  }

  async function moveStatusRow(code, direction) {
    try {
      await api('/api/admin/statuses-move', { method: 'POST', body: JSON.stringify({ code, direction }) });
      await loadStatuses();
    } catch (e) { /* a failed reorder just leaves things as they were */ }
  }

  function applyKindVisibility() {
    const kind = $('sKind').value;
    $('sPrefixRow').style.display = (kind === 'time' || kind === 'date') ? '' : 'none';
  }

  // IN/UTE (scope 'primary') are structural: always exactly two, can't be
  // added, removed, or reordered - only their label/color are editable.
  // Everything else here (extra field, "counts as away", dots) is
  // meaningless for them, so it's simplest to just hide those rows
  // entirely rather than have them silently do nothing if touched.
  function applyStatusModalVisibility(scope) {
    const isPrimary = scope === 'primary';
    $('sKindRow').style.display = isPrimary ? 'none' : '';
    $('sChecksOutRow').style.display = isPrimary ? 'none' : '';
    $('sDotsRow').style.display = isPrimary ? 'none' : '';
    if (isPrimary) $('sPrefixRow').style.display = 'none';
  }

  function openStatusModal(scope, def) {
    editingStatusScope = scope;
    editingStatusCode = def ? def.code : null;
    $('statusModalTitle').textContent = def ? 'Redigera status' : 'Lägg till status';
    $('sLabel').value = def?.label || '';
    const color = def?.color || '#3d5a80';
    $('sColorPicker').value = color;
    $('sColorHex').value = color;
    const kind = def?.needsTime ? 'time' : def?.needsDate ? 'date' : def?.needsNote ? 'note' : 'none';
    $('sKind').value = kind;
    $('sPrefix').value = def?.detailPrefix || '';
    $('sChecksOut').checked = !!def?.checksOut;
    $('sDots').value = String(def?.dots || 0);
    applyStatusModalVisibility(scope);
    applyKindVisibility();
    $('statusModalDelete').style.display = (def && scope !== 'primary') ? '' : 'none';
    $('statusModalError').textContent = '';
    $('statusModalBackdrop').style.display = 'flex';
    openPopupChrome($('statusModalBackdrop').querySelector('.modal'), closeStatusModal);
  }
  function closeStatusModal() { $('statusModalBackdrop').style.display = 'none'; closePopupChrome(); }

  async function saveStatusModal() {
    const label = $('sLabel').value.trim();
    const color = $('sColorHex').value.trim();
    if (!label) return ($('statusModalError').textContent = 'Namn krävs.');
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return ($('statusModalError').textContent = 'Färgen måste vara en hex-kod, t.ex. #3d5a80.');

    const payload = { code: editingStatusCode, label, color };
    if (editingStatusScope !== 'primary') {
      payload.kind = $('sKind').value;
      payload.detailPrefix = $('sPrefix').value.trim();
      payload.checksOut = $('sChecksOut').checked;
      payload.dots = Number($('sDots').value) || 0;
    }
    try {
      await api('/api/admin/statuses', { method: 'POST', body: JSON.stringify(payload) });
      await loadStatuses();
      closeStatusModal();
    } catch (e) {
      $('statusModalError').textContent = e.message;
    }
  }

  async function deleteStatusFromModal() {
    if (!editingStatusCode || editingStatusScope === 'primary') return;
    if (!confirm(`Ta bort statusen "${$('sLabel').value}"?`)) return;
    try {
      await api(`/api/admin/statuses/${encodeURIComponent(editingStatusCode)}`, { method: 'DELETE' });
      await loadStatuses();
      closeStatusModal();
    } catch (e) {
      $('statusModalError').textContent = e.message;
    }
  }

  // ----------------------------------------------------- appearance tab --
  async function loadTheme() {
    const res = await fetch('/api/theme').then((r) => r.json());
    themeOptions = res.options || [];
    currentTheme = res.theme;
    renderThemeSelect();
  }

  function renderThemeSelect() {
    $('themeSelect').innerHTML = themeOptions
      .map((t) => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('');
    $('themeSelect').value = currentTheme;
  }

  async function saveTheme(theme) {
    $('themeError').textContent = '';
    try {
      const res = await api('/api/admin/theme', { method: 'POST', body: JSON.stringify({ theme }) });
      currentTheme = res.theme;
      // Apply here too rather than waiting on the 'theme' SSE event this
      // same save just triggers - same instant-feedback idea as any other
      // admin action, and harmless if the event arrives a moment later and
      // applies the same value again.
      window.applyTheme(currentTheme);
      renderBackgroundPanel();
    } catch (e) {
      $('themeError').textContent = e.message;
      renderThemeSelect(); // snap the dropdown back to the value that's actually active
    }
  }

  // ------------------------------------------------- background picture --
  async function loadBackgrounds() {
    backgroundsById = await fetch('/api/backgrounds').then((r) => r.json());
    renderBackgroundPanel();
  }

  function renderBackgroundPanel() {
    const themeDef = themeOptions.find((t) => t.id === currentTheme);
    $('aBgThemeLabel').textContent = themeDef ? themeDef.label : (currentTheme || '');
    const entry = backgroundsById[currentTheme];
    $('bgPreview').style.backgroundImage = entry ? `url('${entry.url}')` : '';
    $('bgOpacity').value = entry ? entry.opacity : 0.35;
    $('bgRemove').style.display = entry ? '' : 'none';
  }

  async function uploadBackground(file) {
    $('bgError').textContent = '';
    try {
      const image = await resizeBackground(file);
      const opacity = Number($('bgOpacity').value) || 0.35;
      await api('/api/admin/backgrounds', { method: 'POST', body: JSON.stringify({ theme: currentTheme, image, opacity }) });
      await loadBackgrounds();
      window.refreshBackgrounds && window.refreshBackgrounds();
    } catch (e) {
      $('bgError').textContent = e.message;
    }
  }

  async function removeBackground() {
    $('bgError').textContent = '';
    try {
      await api('/api/admin/backgrounds', { method: 'POST', body: JSON.stringify({ theme: currentTheme, image: null, opacity: 1 }) });
      await loadBackgrounds();
      window.refreshBackgrounds && window.refreshBackgrounds();
    } catch (e) {
      $('bgError').textContent = e.message;
    }
  }

  let opacitySaveTimer = null;
  function scheduleOpacitySave() {
    clearTimeout(opacitySaveTimer);
    opacitySaveTimer = setTimeout(async () => {
      if (!backgroundsById[currentTheme]) return; // nothing to adjust opacity of yet
      try {
        await api('/api/admin/backgrounds', { method: 'POST', body: JSON.stringify({ theme: currentTheme, opacity: Number($('bgOpacity').value) }) });
        await loadBackgrounds();
        window.refreshBackgrounds && window.refreshBackgrounds();
      } catch (e) {
        $('bgError').textContent = e.message;
      }
    }, 300);
  }

  // ------------------------------------------------------- settings tab --
  async function loadSettings() {
    settings = await fetch('/api/settings').then((r) => r.json());
    renderSettingsForm();
    window.applySettings && window.applySettings(settings);
  }

  function renderSettingsForm() {
    $('sIdleMinutes').value = Math.round((settings.popupIdleTimeoutMs || 300000) / 60000);
    $('sOnscreenKbAdmin').checked = !!settings.onscreenKeyboardAdmin;
  }

  async function saveSettings() {
    $('settingsError').textContent = '';
    const minutes = Number($('sIdleMinutes').value);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 60) {
      return ($('settingsError').textContent = 'Tidsgränsen måste vara mellan 1 och 60 minuter.');
    }
    try {
      settings = await api('/api/admin/settings', {
        method: 'POST',
        body: JSON.stringify({
          popupIdleTimeoutMs: minutes * 60000,
          onscreenKeyboardAdmin: $('sOnscreenKbAdmin').checked,
        }),
      });
      window.applySettings && window.applySettings(settings);
      applyOnscreenKeyboardSetting();
    } catch (e) {
      $('settingsError').textContent = e.message;
    }
  }

  async function saveSystemClock() {
    $('clockError').textContent = '';
    $('clockSuccess').textContent = '';
    if (!clockValue) return ($('clockError').textContent = 'Välj datum och tid först.');
    try {
      await api('/api/admin/system-clock', { method: 'POST', body: JSON.stringify({ datetimeLocal: clockValue }) });
      $('clockSuccess').textContent = 'Klockan uppdaterad.';
    } catch (e) {
      $('clockError').textContent = e.message;
    }
  }

  // --------------------------------------------------- on-screen keyboard
  // Off by default on the admin page (a real keyboard is normally at hand
  // here) - see settings.onscreenKeyboardAdmin, editable in Inställningar.
  function wireOnscreenKeyboards() {
    [$('fName'), $('fDept'), $('fRole'), $('fPhone'), $('sLabel'), $('sColorHex'), $('sPrefix')].forEach((el) => {
      if (el) kbHandles.push(window.attachOnscreenKeyboard(el, { enabled: !!settings.onscreenKeyboardAdmin }));
    });
  }
  function applyOnscreenKeyboardSetting() {
    kbHandles.forEach((h) => h.setEnabled(!!settings.onscreenKeyboardAdmin));
  }

  // Leaving admin entirely (the header's back button, and the login gate's
  // own close button / idle-timeout - see openPopupChrome below) - there's
  // no state to preserve on the way out, just go look at the board.
  function exitToBoard() { window.location.href = '/board.html'; }

  // ------------------------------------------------- shared popup chrome -
  // Every popup/modal in the app gets the same standardized close button +
  // idle-auto-close (see public/popup.js) - including these two admin
  // dialogs (and the login gate itself, now that it's styled as a popup
  // too - see admin.html's #gate), not just the board's status popup.
  let activePopupIdle = null;
  function openPopupChrome(modalEl, onClose) {
    closePopupChrome();
    // modalEl is a fixed, reused DOM node (the add/edit/status modal, or
    // the login gate), not recreated per open - so without this, every
    // open() stacks another close button on top of whichever one(s) a
    // previous open() already appended and never cleaned up.
    modalEl.querySelectorAll(':scope > .popup-close').forEach((btn) => btn.remove());
    modalEl.appendChild(window.createPopupCloseButton(onClose));
    activePopupIdle = window.watchPopupIdle(modalEl, () => modalEl.closest('.modal-backdrop').style.display !== 'none', onClose);
  }
  function closePopupChrome() {
    if (activePopupIdle) { activePopupIdle.stop(); activePopupIdle = null; }
  }

  $('tabPeople').addEventListener('click', () => showTab('people'));
  $('tabStatuses').addEventListener('click', () => showTab('statuses'));
  $('tabAppearance').addEventListener('click', () => showTab('appearance'));
  $('tabSettings').addEventListener('click', () => showTab('settings'));
  $('themeSelect').addEventListener('change', () => saveTheme($('themeSelect').value));
  $('addStatusBtn').addEventListener('click', () => openStatusModal('secondary', null));
  $('statusModalCancel').addEventListener('click', closeStatusModal);
  $('statusModalSave').addEventListener('click', saveStatusModal);
  $('statusModalDelete').addEventListener('click', deleteStatusFromModal);
  $('sKind').addEventListener('change', applyKindVisibility);
  $('sColorPicker').addEventListener('input', () => { $('sColorHex').value = $('sColorPicker').value; });
  $('sColorHex').addEventListener('input', () => {
    const v = $('sColorHex').value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) $('sColorPicker').value = v;
  });

  buildGateKeypad();
  renderGateDots();
  // Same popup chrome as every other dialog (round close button + idle
  // auto-close) - both just take you back to the board, since there's
  // nothing part-way-through to preserve on a login screen.
  openPopupChrome($('gate').querySelector('.modal'), exitToBoard);
  window.initExitButton($('exitBtn'));
  $('addBtn').addEventListener('click', () => openModal(null));
  $('modalCancel').addEventListener('click', closeModal);
  $('modalSave').addEventListener('click', saveModal);

  $('fPhotoInput').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      pendingPhoto = await resizePhoto(file);
      renderPhotoPreview(roster.find((p) => p.id === editingId));
    } catch (err) {
      $('modalError').textContent = err.message;
    }
  });
  $('fPhotoRemove').addEventListener('click', () => {
    pendingPhoto = null;
    $('fPhotoInput').value = '';
    renderPhotoPreview(roster.find((p) => p.id === editingId));
  });

  $('bgInput').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) uploadBackground(file);
    e.target.value = '';
  });
  $('bgRemove').addEventListener('click', removeBackground);
  $('bgOpacity').addEventListener('input', () => {
    $('bgPreview').style.opacity = String($('bgOpacity').value);
    scheduleOpacitySave();
  });

  $('settingsSave').addEventListener('click', saveSettings);

  let clockValue = '';
  window.buildSystemClockInput($('clockPicker'), {
    onChange: (v) => { clockValue = v; },
  });
  $('clockSave').addEventListener('click', saveSystemClock);
})();
