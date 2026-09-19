// store.js — in-memory table of people, backed by a JSON file on disk.
// Zero external dependencies on purpose: this has to run offline, forever,
// on whatever spare machine this one server runs on.

const fs = require('fs');
const path = require('path');

class Store {
  /**
   * @param {string} dataDir  directory to keep people.json in
   */
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'people.json');
    this.people = new Map(); // id -> record
    this._listeners = new Set(); // change callbacks: (record) => void
    this._load();
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
    this._saveSync();
    this._emit(merged);
    return merged;
  }
}

module.exports = { Store };
