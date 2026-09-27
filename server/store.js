// store.js — in-memory table of people, backed by a JSON file on disk.
// Zero external dependencies on purpose: this has to run offline, forever,
// on whatever spare machine this one server runs on.

const fs = require('fs');
const path = require('path');

// Default for `saveIntervalMs` below - editable at runtime from the admin
// page's Inställningar tab (see server/settings-store.js's
// rosterSaveIntervalMs and this file's setSaveIntervalMs()).
const DEFAULT_SAVE_INTERVAL_MS = 5000;

class Store {
  /**
   * @param {string} dataDir  directory to keep people.json in
   * @param {object} [options]
   * @param {number} [options.saveIntervalMs] how often a change actually
   *   gets written to disk - see applyLocal()/_flushIfDirty()'s own
   *   comments for why this isn't "immediately".
   */
  constructor(dataDir, options = {}) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'people.json');
    this.people = new Map(); // id -> record
    this._listeners = new Set(); // change callbacks: (record) => void
    // Set the instant a check-in/edit changes `this.people` but hasn't
    // made it to disk yet - see applyLocal()/_flushIfDirty().
    this._dirty = false;
    this._saveTimer = null;
    this._saveIntervalMs = options.saveIntervalMs || DEFAULT_SAVE_INTERVAL_MS;
    this._load();
    this._scheduleSaveTimer();
  }

  // (Re)starts the periodic flush at whatever `_saveIntervalMs` currently
  // is - called once from the constructor, and again by setSaveIntervalMs()
  // whenever the admin page changes it, so a new interval takes effect
  // immediately rather than only after the next server restart.
  _scheduleSaveTimer() {
    if (this._saveTimer) clearInterval(this._saveTimer);
    this._saveTimer = setInterval(() => this._flushIfDirty(), this._saveIntervalMs);
    // Never itself keep the process alive - a plain server with nothing
    // else pending (no open HTTP/SSE connections) should still be able to
    // exit cleanly rather than being held open by this timer alone.
    if (this._saveTimer.unref) this._saveTimer.unref();
  }

  // Admin-editable (server.js calls this right after a settings save) -
  // see server/settings-store.js's rosterSaveIntervalMs.
  setSaveIntervalMs(ms) {
    this._saveIntervalMs = ms;
    this._scheduleSaveTimer();
  }

  _flushIfDirty() {
    if (!this._dirty) return;
    this._saveSync();
    this._dirty = false;
  }

  // Writes whatever's pending right now, regardless of the timer - called
  // once from server.js on a clean shutdown (SIGINT/SIGTERM, e.g. a
  // `systemctl restart`), so the batching below only ever risks losing the
  // last few seconds of changes to an actual power loss or crash, never to
  // an ordinary planned restart.
  flush() {
    if (!this._dirty) return;
    this._saveSync();
    this._dirty = false;
  }

  _load() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    if (!fs.existsSync(this.file)) {
      fs.writeFileSync(this.file, '[]', 'utf8');
    }
    const raw = fs.readFileSync(this.file, 'utf8');
    let arr = [];
    try {
      arr = JSON.parse(raw || '[]');
    } catch (err) {
      console.error(`[store] could not parse ${this.file}, starting empty:`, err.message);
      arr = [];
    }
    this.people = new Map(arr.map((r) => [r.id, r]));
  }

  _saveSync() {
    const arr = [...this.people.values()];
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(arr, null, 2), 'utf8');
    fs.renameSync(tmp, this.file); // atomic on the same filesystem
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit(record) {
    for (const fn of this._listeners) {
      try {
        fn(record);
      } catch (err) {
        console.error('[store] listener error:', err);
      }
    }
  }

  getAll() {
    return [...this.people.values()].filter((r) => !r.deleted);
  }

  getById(id) {
    return this.people.get(id) || null;
  }

  /**
   * Apply an edit (from the admin UI or a kiosk check-in). Stamps
   * `recordUpdatedAt` with the current time - a plain last-modified
   * timestamp, kept mostly so `import-people.js` can tell an unchanged row
   * apart from one that was actually just edited (see its own comment).
   *
   * Used to write the WHOLE roster to disk synchronously right here, on
   * every single call - including a plain INNE/UTE tap, by far the most
   * frequent kind of edit this ever sees. That's a full-file write for
   * every tap, which scales with the roster's own size (profile photos
   * especially) and, being synchronous, blocks the server's single thread
   * - every other request and SSE push - for however long it takes. Marks
   * the in-memory copy dirty instead and returns immediately; the
   * periodic timer (_flushIfDirty, see the constructor) writes it for
   * real at most once per `_saveIntervalMs` (default 5s, admin-editable -
   * see server/settings-store.js's rosterSaveIntervalMs), so a whole burst
   * of taps (a shift change) costs one write instead of one per tap. The
   * in-memory copy (and so every SSE broadcast) is always exactly current
   * regardless - only what's on disk lags, and only by up to one interval,
   * closed to near-zero by flush() on a clean shutdown (see its own
   * comment).
   */
  applyLocal(id, patch) {
    const now = Date.now();
    const existing = this.people.get(id) || { id };
    const merged = {
      ...existing,
      ...patch,
      id,
      recordUpdatedAt: now,
    };
    this.people.set(id, merged);
    this._dirty = true;
    this._emit(merged);
    return merged;
  }
}

module.exports = { Store };
