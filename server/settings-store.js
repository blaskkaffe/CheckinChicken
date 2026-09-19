// settings-store.js — small set of runtime settings, edited from the admin
// page's "Inställningar" tab. Backed by data/settings.json, seeded once
// from config.json the first time a server starts (same pattern as
// theme-store.js/status-store.js) - after that this file is the source of
// truth, so admin edits persist across restarts and code updates. Shared
// by every screen and building.

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  // How long a status popup (or an admin add/edit dialog) can sit idle
  // before it closes itself automatically - see public/popup.js. Also
  // editable straight from config.json (see server.js) for the very first
  // boot; after that, whatever's saved here (i.e. last set from the admin
  // page) wins.
  popupIdleTimeoutMs: 5 * 60 * 1000,
  // Off by default: the admin page is normally worked from a desk with a
  // real keyboard. Turn on for an admin page that's itself touch-only, so
  // its own text fields (person name, department, status label, ...) get
  // the same on-screen Swedish keyboard as the board/status popup - see
  // public/keyboard.js.
  onscreenKeyboardAdmin: false,
};

function pickKnown(obj) {
  const out = {};
  for (const k of Object.keys(DEFAULTS)) {
    if (obj && obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

class SettingsStore {
  /**
   * @param {string} dataDir directory to keep settings.json in
   * @param {object} [seed] config.json's own values for these same keys -
   *   only used the very first time this server starts (no settings.json
   *   on disk yet).
   */
  constructor(dataDir, seed = {}) {
    this.file = path.join(dataDir, 'settings.json');
    fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(this.file)) {
      this._write({ ...DEFAULTS, ...pickKnown(seed) });
    }
    this._load();
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8') || '{}');
      this.data = { ...DEFAULTS, ...pickKnown(raw) };
    } catch (err) {
      console.error(`[settings] could not parse ${this.file}, falling back to defaults:`, err.message);
      this.data = { ...DEFAULTS };
    }
  }

  _write(data) {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file); // atomic on the same filesystem
    this.data = data;
  }

  get() {
    return { ...this.data };
  }

  /** Throws (with a Swedish message) on an invalid value. */
  set(patch) {
    const next = { ...this.data, ...pickKnown(patch) };
    const ms = Number(next.popupIdleTimeoutMs);
    if (!Number.isFinite(ms) || ms < 10000 || ms > 3600000) {
      throw new Error('Tidsgränsen måste vara mellan 10 sekunder och 60 minuter.');
    }
    next.popupIdleTimeoutMs = Math.round(ms);
    next.onscreenKeyboardAdmin = !!next.onscreenKeyboardAdmin;
    this._write(next);
    return this.get();
  }
}

module.exports = { SettingsStore, DEFAULTS };
