// theme-store.js — which appearance theme every board/admin page currently
// shows. Backed by data/theme.json, the same "plain JSON file this one
// server writes to" pattern as store.js (people) and status-store.js
// (statuses). One value, shared by every screen and building - see
// README's "Appearance theme".

const fs = require('fs');
const path = require('path');
const { THEMES, DEFAULT_THEME } = require('./themes');

const VALID_IDS = new Set(THEMES.map((t) => t.id));

class ThemeStore {
  /**
   * @param {string} dataDir directory to keep theme.json in
   * @param {string} [seedTheme] config.json's `theme` field - only used the
   *   very first time this server starts (no theme.json on disk yet); after
   *   that, whatever's saved in theme.json (i.e. whatever was last set from
   *   the admin page) wins, same as statuses.js only seeding statuses.json.
   */
  constructor(dataDir, seedTheme) {
    this.file = path.join(dataDir, 'theme.json');
    fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(this.file)) {
      const seed = VALID_IDS.has(seedTheme) ? seedTheme : DEFAULT_THEME;
      this._write(seed);
    }
    this._load();
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8') || '{}');
      this.theme = VALID_IDS.has(raw.theme) ? raw.theme : DEFAULT_THEME;
    } catch (err) {
      console.error(`[theme] could not parse ${this.file}, falling back to default:`, err.message);
      this.theme = DEFAULT_THEME;
    }
  }

  _write(theme) {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ theme }, null, 2), 'utf8');
    fs.renameSync(tmp, this.file); // atomic on the same filesystem
    this.theme = theme;
  }

  get() {
    return this.theme;
  }

  /** Throws if `theme` isn't one of themes.js's known ids. */
  set(theme) {
    if (!VALID_IDS.has(theme)) {
      throw new Error('Okänt tema.');
    }
    this._write(theme);
    return this.theme;
  }
}

module.exports = { ThemeStore };
