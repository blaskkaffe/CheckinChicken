// server.js — the whole backend. Plain Node http server, zero npm
// dependencies (nothing to install on an offline machine). Serves the
// static board/admin pages, a small JSON API, and a Server-Sent-Events
// stream for instant push updates to every open tab.
//
// One server, one roster, any number of screens/browsers pointed at it -
// including screens in more than one building, distinguished by each
// person's own `location` field (see the admin page's "Byggnad" field and
// board.js's visible()/render()) rather than by running a separate server
// per building.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { execFile } = require('child_process');

const { Store } = require('./store');
const { StatusStore, sanitizeFields: sanitizeStatusFields } = require('./status-store');
const { ThemeStore } = require('./theme-store');
const { THEMES } = require('./themes');
const { SettingsStore } = require('./settings-store');
const { BackgroundStore } = require('./background-store');

// Read once at boot, straight from package.json, so the info button on the
// board-settings popup (public/boardsettings.js, via GET /api/version
// below) always shows exactly what's actually deployed on THIS server -
// nothing to remember to keep in sync by hand.
const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

// ---------------------------------------------------------------- config --
const CONFIG_PATH = process.env.CHECKIN_CONFIG || path.join(__dirname, '..', 'config.json');
if (!fs.existsSync(CONFIG_PATH)) {
  console.error(`Missing config file at ${CONFIG_PATH}`);
  console.error('Copy config.example.json to config.json and edit it first. See README.md.');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const {
  locationName = 'Incheckning',
  port = 8080,
  adminPasscode = '0000',
  allowNameBrowse = true,
  // How a coworker's phone number is surfaced from their status popup: it's
  // shown by default, right below their department/role line - set to
  // 'hash' for the old "hidden until tapped" behavior, or 'off' to hide it
  // entirely.
  phoneVisibility = 'always',
  // On by default: tap directly on a person's row on the board - tap their
  // INNE/UTE badge to toggle it, or anywhere else on their row to open
  // their full status popup. This is the default for every board.html tab
  // connected to THIS server - to make just one specific device a plain,
  // non-touch display while another device stays touchable, use that
  // device's own ?input=off/on URL param instead (see board.js's boot()
  // and README's "Setup") rather than changing this, which
  // would apply to every connected tab alike.
  boardClickToEdit = true,
  // Optional. Which appearance theme (see server/themes.js) this server
  // starts with - only used the very first time it boots (no data/
  // theme.json on disk yet); after that, whatever was last set from the
  // admin page's Utseende tab wins, same as statuses.js only seeding
  // statuses.json. Leave unset for 'dark'.
  theme: seedTheme = undefined,
  // Optional seeds for the admin-editable settings below (Inställningar
  // tab) - only used the very first time this server boots (no data/
  // settings.json yet). See server/settings-store.js.
  popupIdleTimeoutMs: seedPopupIdleTimeoutMs = undefined,
  onscreenKeyboardAdmin: seedOnscreenKeyboardAdmin = undefined,
} = config;

const DATA_DIR = process.env.CHECKIN_DATA_DIR || path.join(__dirname, '..', 'data');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const store = new Store(DATA_DIR);
const statusStore = new StatusStore(DATA_DIR);
const themeStore = new ThemeStore(DATA_DIR, seedTheme);
const settingsStore = new SettingsStore(DATA_DIR, {
  popupIdleTimeoutMs: seedPopupIdleTimeoutMs,
  onscreenKeyboardAdmin: seedOnscreenKeyboardAdmin,
});
const backgroundStore = new BackgroundStore(DATA_DIR);

// ------------------------------------------------------------- SSE hub ----
const sseClients = new Set(); // { res }

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) client.res.write(payload);
}

function broadcastPerson(record) {
  const payload = `event: person\ndata: ${JSON.stringify(publicPerson(record))}\n\n`;
  for (const client of sseClients) client.res.write(payload);
}

function broadcastStatuses() {
  broadcast('statuses', statusStore.getAll());
}

function broadcastTheme() {
  broadcast('theme', { theme: themeStore.get() });
}

function broadcastSettings() {
  broadcast('settings', settingsStore.get());
}

function broadcastBackgrounds() {
  broadcast('backgrounds', backgroundStore.getAll());
}

// Theme and background picture are both server-wide settings (broadcast to
// every open board/admin tab over SSE - see broadcastTheme/
// broadcastBackgrounds), so they only ever change from here, behind
// requireAdmin's passcode gate (/api/admin/theme below) - never from the
// board's own tap-the-clock popup, which is deliberately limited to
// per-device settings that never touch the server at all (see board.js's
// window.BoardSettings and boardsettings.js). Throws on an invalid theme id.
function handleThemeSet(body) {
  themeStore.set(body.theme);
  broadcastTheme();
  return { theme: themeStore.get() };
}

// Same idea as handleThemeSet - admin-only (/api/admin/backgrounds below).
// Body: { theme, opacity, image? } - `image` a data: URL to set a new
// background, or the literal `null` to clear it; omit entirely to just
// change the opacity of whatever's already set. Throws on an invalid body.
function handleBackgroundsSet(body) {
  const result = Object.prototype.hasOwnProperty.call(body, 'image')
    ? backgroundStore.set(body.theme, body.image, body.opacity)
    : backgroundStore.setOpacity(body.theme, body.opacity);
  broadcastBackgrounds();
  return { theme: body.theme, background: result };
}

store.onChange(broadcastPerson);

// ------------------------------------------------------------- helpers ----

// `phoneVisibility` ('always' | 'hash' | 'off' - see config.json / README's
// "Phone numbers" section) is decided here, server-side, rather than left
// to the status popup to just not render it - so in 'hash'/'off' mode the
// real number never rides along in the API/SSE payload at all for
// someone to find in devtools, it's not merely hidden by CSS.
function publicPerson(r) {
  if (phoneVisibility === 'always') return { ...r };
  const { phone, ...rest } = r;
  return rest;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 6e6) {
        // Generous enough for a resized profile photo or a background image
        // (both sent as base64 data URLs, ~33% bigger than the raw bytes)
        // plus the rest of a JSON body, without letting a bad request
        // balloon memory or bloat data/people.json.
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error('invalid json body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/board.html' : pathname;
  rel = rel.split('?')[0];
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  // Must check for PUBLIC_DIR followed by the path separator (or an exact
  // match), not just startsWith(PUBLIC_DIR) - a bare prefix check would
  // also let through a sibling directory that happens to share the same
  // string prefix (e.g. a future "public-private" folder next to "public"
  // would pass `startsWith(PUBLIC_DIR)` even though it's a different,
  // unintended directory). Belt-and-suspenders on top of path.normalize()
  // already collapsing any "../" in rel.
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404);
      return res.end('not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  });
}

// Constant-time string compare - a plain === leaks how many leading
// characters matched through response timing (classic timing-attack
// surface). Real-world risk here is low (this is meant to run on a
// trusted, offline LAN, not exposed to the internet) but the fix costs
// nothing, so there's no reason to rely on that instead. crypto.timingSafeEqual
// requires equal-length buffers, so unequal lengths are rejected outright
// without ever calling it (and without leaking the length difference via
// an exception either).
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ''), 'utf8');
  const bufB = Buffer.from(String(b ?? ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireAdmin(req) {
  return safeEqual(req.headers['x-admin-passcode'], adminPasscode);
}

function nextId() {
  return 'p_' + crypto.randomBytes(6).toString('hex');
}

// Applies a status choice to a person record, following the "does this
// status mean you're not physically at work" rule stored on the status
// itself (checksOut - see server/status-store.js).
function applyStatusChoice(existing, { primary, secondaryCode, detail, note }) {
  let checkedIn = existing.status?.checkedIn ?? false;

  if (primary === 'IN') checkedIn = true;
  else if (primary === 'OUT') checkedIn = false;
  else if (secondaryCode) {
    if (statusStore.checksOut(secondaryCode)) checkedIn = false;
    // A "neutral" status (checksOut not set) leaves checkedIn exactly as
    // it was.
  }

  return {
    status: {
      checkedIn,
      secondary: secondaryCode || null,
      detail: detail || '',
      note: note || '',
      updatedAt: Date.now(),
    },
  };
}

// Best-effort: correct this machine's own system clock. Only useful/needed
// for an offline installation with no internet access (so no NTP) that has
// drifted - see README's "System clock". Requires the Node process to
// actually be allowed to change the time, which a plain `User=pi` systemd
// service (the default - see systemd/checkin-server.service) is NOT by
// default; this reports that plainly rather than pretending it worked.
// `datetimeLocal` is "YYYY-MM-DDTHH:mm" or "YYYY-MM-DDTHH:mm:ss" - the
// shape admin.js's system-clock stepper widget (timepicker.js's
// buildSystemClockInput) always produces (with seconds); the same shape
// an HTML <input type="datetime-local"> would also produce (without
// seconds), kept accepted here too since it's a trivial regex allowance -
// `date -s` accepts either directly (as local time) once the "T" is
// swapped for a space.
function setSystemClock(datetimeLocal) {
  return new Promise((resolve) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(String(datetimeLocal || ''))) {
      return resolve({ ok: false, error: 'Ogiltigt datum/tid.' });
    }
    const dateArg = datetimeLocal.replace('T', ' ');
    execFile('date', ['-s', dateArg], (err, stdout, stderr) => {
      if (err) {
        const perm = /permitted|permission/i.test(String(stderr || err.message));
        resolve({
          ok: false,
          error: perm
            ? 'Servern saknar behörighet att ändra systemklockan (kör den som root, eller kör setcap på "date" - se README.md, "System clock").'
            : `Kunde inte sätta klockan: ${stderr || err.message}`,
        });
        return;
      }
      resolve({ ok: true });
    });
  });
}

// ------------------------------------------------------------- routes -----

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;
  const method = req.method;

  try {
    // ---- read-only info everyone can fetch ----
    if (method === 'GET' && pathname === '/api/config') {
      return sendJson(res, 200, {
        locationName, allowNameBrowse, phoneVisibility, boardClickToEdit,
      });
    }

    if (method === 'GET' && pathname === '/api/statuses') {
      return sendJson(res, 200, statusStore.getAll());
    }

    // Version straight from package.json - see the info ("i") button on
    // the board-settings popup (tap the clock). `name` is the proper-cased
    // display name rather than PKG.name verbatim (npm package names have
    // to stay lowercase, but there's no reason the popup should show it
    // that way) - the version number is the one thing here actually worth
    // reading live rather than just hardcoding both.
    if (method === 'GET' && pathname === '/api/version') {
      return sendJson(res, 200, { name: 'CheckinChicken', version: PKG.version });
    }

    // `options` is the full list from themes.js (id/label/snow) - sent
    // along so the admin page's picker and every page's own snow-or-not
    // decision (see public/theme.js) both just read this response, rather
    // than needing their own separate copy of the theme list.
    if (method === 'GET' && pathname === '/api/theme') {
      return sendJson(res, 200, { theme: themeStore.get(), options: THEMES });
    }

    // Runtime, admin-editable settings (popup idle-close timeout, whether
    // the admin page itself shows the on-screen keyboard) - see
    // server/settings-store.js.
    if (method === 'GET' && pathname === '/api/settings') {
      return sendJson(res, 200, settingsStore.get());
    }

    // Per-theme background image + opacity, keyed by theme id - see
    // server/background-store.js. A theme with nothing set just doesn't
    // appear in this object.
    if (method === 'GET' && pathname === '/api/backgrounds') {
      return sendJson(res, 200, backgroundStore.getAll());
    }

    if (method === 'GET' && pathname.startsWith('/api/backgrounds/file/')) {
      const name = decodeURIComponent(pathname.slice('/api/backgrounds/file/'.length));
      const filePath = backgroundStore.filePath(name);
      if (!filePath) { res.writeHead(404); return res.end('not found'); }
      fs.readFile(filePath, (err, buf) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(buf);
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/people') {
      // board.html is both the passive display AND, via its status popup
      // (tap a name/photo), the one place a phone number actually needs to
      // be looked up - so the same fetch/SSE feed used to draw the board
      // rows (which never render a phone number at all - see
      // board.js's personRowHtml) is also what statuspopup.js reads from
      // (window.BoardPeople). publicPerson() above already strips the
      // phone field entirely unless `phoneVisibility` is 'always'.
      return sendJson(res, 200, store.getAll().map(publicPerson));
    }

    // ---- live updates (every open page subscribes) ----
    if (method === 'GET' && pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      const client = { res };
      sseClients.add(client);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => {
        clearInterval(ping);
        sseClients.delete(client);
      });
      return;
    }

    // ---- status popup: set a status for an already-selected person ----
    if (method === 'POST' && pathname === '/api/checkin/set') {
      // Identified by id - the person is always already selected (a tap on
      // the board, or a Browse-by-name result) by the time this is called.
      const body = await readBody(req);
      const { id } = body;
      let { primary, secondaryCode, detail, note } = body;
      const person = id ? store.getById(id) : null;
      if (!person || person.deleted) return sendJson(res, 404, { error: 'unknown person' });

      // Anyone on the LAN can call this endpoint (there's no login for a
      // plain check-in), so it's worth validating the SHAPE of what gets
      // written even though there's no login: reject a `primary`/
      // `secondaryCode` that isn't one this server actually knows about
      // (rather than silently storing arbitrary text a stale tab, or a
      // hand-crafted request, happened to send - it would just show as a
      // blank tag forever, per the `if (def)` guards in board.js/
      // statuspopup.js, which is confusing and needless), and cap
      // `detail`/`note` to a sane length so a bad client can't slowly
      // bloat data/people.json (see the similar `phone` length cap and
      // readBody's own size cap above).
      if (primary !== undefined && primary !== 'IN' && primary !== 'OUT') {
        return sendJson(res, 400, { error: 'unknown primary status' });
      }
      if (secondaryCode && !statusStore.findByCode(secondaryCode)) {
        return sendJson(res, 400, { error: 'unknown status' });
      }
      if (typeof detail === 'string' && detail.length > 60) detail = detail.slice(0, 60);
      if (typeof note === 'string' && note.length > 200) note = note.slice(0, 200);

      const patch = applyStatusChoice(person, { primary, secondaryCode, detail, note });
      const updated = store.applyLocal(person.id, patch);
      return sendJson(res, 200, publicPerson(updated));
    }

    // ---- admin: manage the roster ----
    if (pathname.startsWith('/api/admin/')) {
      if (!requireAdmin(req)) return sendJson(res, 401, { error: 'bad admin passcode' });

      if (method === 'POST' && pathname === '/api/admin/people') {
        const body = await readBody(req);
        const id = body.id || nextId();
        const existing = store.getById(id) || {};
        // location = which building/site this person belongs to - free
        // text, same as department (see board.js's render(), which groups
        // and sorts the board by location, then department, then role,
        // then name). Blank by default; a blank person just doesn't show
        // up when a screen is filtered to one specific building (see
        // "restrictToLocation" below and board.js's visible()), but still
        // shows under "Alla byggnader".
        const location = body.location !== undefined ? String(body.location).trim() : (existing.location ?? '');
        // restrictToLocation = "only ever show this person on their OWN
        // building's filtered board view - hide them from every other
        // building's view AND from the combined 'all buildings' view too".
        // Off by default - everyone shows everywhere, same as before this
        // feature existed.
        const restrictToLocation = body.restrictToLocation !== undefined ? !!body.restrictToLocation : !!existing.restrictToLocation;
        const record = {
          ...existing,
          id,
          name: body.name ?? existing.name ?? '',
          department: body.department ?? existing.department ?? '',
          role: body.role ?? existing.role ?? '',
          order: body.order ?? existing.order ?? 0,
          active: body.active ?? existing.active ?? true,
          // Small data: URL (resized client-side before upload) or null to
          // remove it; omit the field entirely to leave it untouched.
          photo: body.photo !== undefined ? body.photo : (existing.photo ?? null),
          // Optional, free-form (international formats vary) - shown to
          // coworkers by default on the status popup.
          phone: body.phone !== undefined ? String(body.phone) : (existing.phone ?? ''),
          location,
          restrictToLocation,
          status: existing.status || { checkedIn: false, secondary: null, detail: '', note: '', updatedAt: Date.now() },
          deleted: false,
        };
        if (record.photo && (typeof record.photo !== 'string' || !record.photo.startsWith('data:image/') || record.photo.length > 400000)) {
          return sendJson(res, 400, { error: 'photo must be a small image data URL (under ~300KB)' });
        }
        if (record.phone && record.phone.length > 40) {
          return sendJson(res, 400, { error: 'phone number looks too long' });
        }
        if (record.location && record.location.length > 60) {
          return sendJson(res, 400, { error: 'byggnadens namn ser för långt ut' });
        }
        store.applyLocal(id, record);
        return sendJson(res, 200, store.getById(id));
      }

      if (method === 'DELETE' && pathname.startsWith('/api/admin/people/')) {
        const id = pathname.split('/').pop();
        const existing = store.getById(id);
        if (!existing) return sendJson(res, 404, { error: 'not found' });
        const saved = store.applyLocal(id, { ...existing, deleted: true });
        return sendJson(res, 200, saved);
      }

      // full records (admin screen only)
      if (method === 'GET' && pathname === '/api/admin/people') {
        return sendJson(res, 200, store.getAll());
      }

      // ---- admin: manage the status menu ----
      // Add or edit a status. Body: { code?, label, color, kind,
      // detailPrefix, dots, checksOut }. `code` present and not IN/OUT ->
      // edit that status; `code` present and IS IN/OUT -> only label/color
      // are touched (see updatePrimary - IN/OUT can't be added, removed,
      // or reordered, since so much else assumes there are exactly two and
      // their meaning); no `code` -> add a new one.
      if (method === 'POST' && pathname === '/api/admin/statuses') {
        const body = await readBody(req);
        try {
          const existing = body.code ? statusStore.findByCode(body.code) : null;
          if (existing && existing.scope === 'primary') {
            const label = String(body.label ?? '').trim();
            const color = String(body.color ?? '').trim();
            if (!label) return sendJson(res, 400, { error: 'Namn krävs.' });
            if (label.length > 40) return sendJson(res, 400, { error: 'Namnet är för långt (max 40 tecken).' });
            if (!/^#[0-9a-fA-F]{6}$/.test(color)) return sendJson(res, 400, { error: 'Färgen måste vara en hex-kod, t.ex. #3d5a80.' });
            const updated = statusStore.updatePrimary(body.code, { label, color });
            broadcastStatuses();
            return sendJson(res, 200, updated);
          }
          const { fields, error } = sanitizeStatusFields(body);
          if (error) return sendJson(res, 400, { error });
          const saved = body.code
            ? statusStore.updateStatus(body.code, fields)
            : statusStore.addStatus(fields);
          broadcastStatuses();
          return sendJson(res, 200, saved);
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }

      if (method === 'DELETE' && pathname.startsWith('/api/admin/statuses/')) {
        const code = decodeURIComponent(pathname.split('/').pop());
        const inUse = statusStore.countInUse(store, code);
        if (inUse > 0) {
          return sendJson(res, 400, {
            error: `${inUse} ${inUse === 1 ? 'person har' : 'personer har'} den här statusen just nu - byt deras status först.`,
          });
        }
        try {
          const removed = statusStore.removeStatus(code);
          if (!removed) return sendJson(res, 404, { error: 'not found' });
          broadcastStatuses();
          return sendJson(res, 200, { ok: true });
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }

      if (method === 'POST' && pathname === '/api/admin/statuses-move') {
        const { code, direction } = await readBody(req);
        statusStore.moveStatus(code, direction === -1 ? -1 : 1);
        broadcastStatuses();
        return sendJson(res, 200, statusStore.getAll());
      }

      // ---- admin: appearance (Utseende tab) ----
      if (method === 'POST' && pathname === '/api/admin/theme') {
        const body = await readBody(req);
        try {
          return sendJson(res, 200, handleThemeSet(body));
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }

      if (method === 'POST' && pathname === '/api/admin/backgrounds') {
        const body = await readBody(req);
        try {
          return sendJson(res, 200, handleBackgroundsSet(body));
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }

      // ---- admin: settings (Inställningar tab) ----
      if (method === 'POST' && pathname === '/api/admin/settings') {
        const body = await readBody(req);
        try {
          const updated = settingsStore.set(body);
          broadcastSettings();
          return sendJson(res, 200, updated);
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }

      // Best-effort system clock correction - see setSystemClock() above
      // for why this can fail (no root/permission), which is reported back
      // rather than silently ignored.
      if (method === 'POST' && pathname === '/api/admin/system-clock') {
        const { datetimeLocal } = await readBody(req);
        const result = await setSystemClock(datetimeLocal);
        return sendJson(res, result.ok ? 200 : 400, result);
      }
    }

    // ---- static files (board.html, admin.html, css, js) ----
    if (method === 'GET') {
      return serveStatic(req, res, pathname);
    }

    res.writeHead(404);
    res.end('not found');
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(port, () => {
  console.log(`[checkin] ${locationName} listening on http://0.0.0.0:${port}`);
  console.log(`[checkin] board:  http://<this-machine-ip>:${port}/board.html`);
  console.log(`[checkin] admin:  http://<this-machine-ip>:${port}/admin.html`);
});
