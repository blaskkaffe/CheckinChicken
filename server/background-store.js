// background-store.js — an optional background picture (+ opacity) an
// admin can set per appearance theme (see server/themes.js) from the
// Utseende tab, shown behind the person cards on the board. Backed by
// data/backgrounds.json (which theme -> which image file + how opaque) and
// the actual image bytes as plain files under data/backgrounds/ - kept as
// real files rather than inline data: URLs (unlike a person's small photo
// in people.json) since a full-screen picture is a lot bigger, and this
// avoids bloating a JSON file that's rewritten on every save.
//
// One set of pictures, shared by every screen and coop (same as
// theme.js/statuses.js).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { THEMES } = require('./themes');

const VALID_IDS = new Set(THEMES.map((t) => t.id));
const MAX_BYTES = 3 * 1024 * 1024; // 3MB - generous for a full-screen photo, still sane on a Pi's SD card
const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

// Accepts a `data:image/xxx;base64,....` URL (same shape the client already
// builds for a person's photo - see admin.js's resizePhoto) and returns
// { buffer, mime }, or null if it isn't a data URL at all.
function parseDataUrl(dataUrl) {
  const m = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  return { mime: m[1], buffer: Buffer.from(m[2], 'base64') };
}

class BackgroundStore {
  constructor(dataDir) {
    this.imgDir = path.join(dataDir, 'backgrounds');
    this.file = path.join(dataDir, 'backgrounds.json');
    fs.mkdirSync(this.imgDir, { recursive: true });
    this._load();
  }

  _load() {
    if (!fs.existsSync(this.file)) {
      this.data = {};
      this._saveSync();
      return;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8') || '{}');
      this.data = raw && typeof raw === 'object' ? raw : {};
    } catch (err) {
      console.error(`[backgrounds] could not parse ${this.file}, starting empty:`, err.message);
      this.data = {};
    }
  }

  _saveSync() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  /** Public shape, every theme that currently has a background set: { [themeId]: { url, opacity } }. */
  getAll() {
    const out = {};
    for (const [id, entry] of Object.entries(this.data)) {
      if (entry && entry.file) out[id] = { url: `/api/backgrounds/file/${encodeURIComponent(entry.file)}`, opacity: entry.opacity };
    }
    return out;
  }

  /** Resolves a stored filename to a real path under imgDir, or null if it doesn't (safely) live there. */
  filePath(name) {
    const p = path.normalize(path.join(this.imgDir, String(name || '')));
    if (p !== this.imgDir && !p.startsWith(this.imgDir + path.sep)) return null;
    if (!fs.existsSync(p)) return null;
    return p;
  }

  _removeFile(name) {
    try { fs.unlinkSync(path.join(this.imgDir, name)); } catch (err) { /* already gone - fine */ }
  }

  /**
   * Set a theme's background image + opacity from a data: URL (or clear it
   * with image=null, keeping/discarding opacity as given).
   * @param {string} themeId
   * @param {string|null} imageDataUrl  null clears the background entirely
   * @param {number} opacity  0-1
   */
  set(themeId, imageDataUrl, opacity) {
    if (!VALID_IDS.has(themeId)) throw new Error('Okänt tema.');
    const op = Number(opacity);
    if (!Number.isFinite(op) || op < 0 || op > 1) throw new Error('Opaciteten måste vara mellan 0 och 1.');

    const existing = this.data[themeId];
    if (imageDataUrl === null) {
      if (existing?.file) this._removeFile(existing.file);
      delete this.data[themeId];
      this._saveSync();
      return null;
    }

    const parsed = parseDataUrl(imageDataUrl);
    if (!parsed) throw new Error('Bilden måste vara en giltig bildfil.');
    if (parsed.buffer.length > MAX_BYTES) throw new Error('Bilden är för stor (max 3 MB).');
    const ext = EXT_BY_MIME[parsed.mime];
    if (!ext) throw new Error('Bilden måste vara JPEG, PNG, WEBP eller GIF.');

    const name = `${themeId}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}${ext}`;
    fs.writeFileSync(path.join(this.imgDir, name), parsed.buffer);
    if (existing?.file) this._removeFile(existing.file);
    this.data[themeId] = { file: name, opacity: op };
    this._saveSync();
    return this.getAll()[themeId];
  }

  /** Opacity-only update for a theme that already has an image set. */
  setOpacity(themeId, opacity) {
    if (!VALID_IDS.has(themeId)) throw new Error('Okänt tema.');
    const op = Number(opacity);
    if (!Number.isFinite(op) || op < 0 || op > 1) throw new Error('Opaciteten måste vara mellan 0 och 1.');
    if (!this.data[themeId]) throw new Error('Ingen bakgrundsbild satt för det temat än.');
    this.data[themeId].opacity = op;
    this._saveSync();
    return this.getAll()[themeId];
  }
}

module.exports = { BackgroundStore };
