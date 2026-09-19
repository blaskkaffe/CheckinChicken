// status-store.js — the live, admin-editable status menu. Backed by
// data/statuses.json, seeded once from server/statuses.js's defaults the
// first time a server starts; after that this file (not statuses.js) is
// the source of truth, so admin edits persist across restarts and code
// updates.
//
// One status list, shared by every screen and coop - edited from the
// admin page's "Statusar" tab. See README.md.
//
// Every status is a plain click/tap button on the status popup, all in one
// scrollable list below IN/OUT - there's no numeric key or menu-slot limit
// tied to a keypad any more, just a sane cap on the list's total length
// (see MENU_MAX below). IN/OUT are structural: always exactly two, label
// and color editable but never addable/removable/reorderable.
//
// This used to be two separate lists - `secondary` (a "main menu", shown
// directly) and `more` (behind a "Fler statusar…" button) - each with its
// own, smaller cap. They were merged into one flat list: the popup's status
// grid already scrolls on its own (see statuspopup.css's .status-grid), so
// a second screen wasn't buying anything, only an extra tap and an admin
// page that was easy to file a status into the "wrong" of two lists. A
// server upgrading from that older shape migrates its data/statuses.json
// automatically the first time it loads (see _load below) - any existing
// `more` entries are simply appended to `secondary`.

const fs = require('fs');
const path = require('path');
const DEFAULTS = require('./statuses');

const MENU_MAX = 16; // a comfortable number of buttons in one scrollable list

const PRIMARY_CODES = new Set(DEFAULTS.PRIMARY.map((p) => p.code)); // 'IN', 'OUT'

function cloneDefaults() {
  return {
    primary: DEFAULTS.PRIMARY.map((p) => ({ ...p })),
    secondary: DEFAULTS.SECONDARY.map((p) => ({ ...p })),
  };
}

// Derives a stable, human-readable internal code from a label (e.g.
// "Hemma med sjukt barn" -> "HEMMA_MED_SJUKT_BARN"), disambiguated with a
// numeric suffix if that code is already taken. Only used when ADDING a
// new status - an existing status keeps its code for life once created,
// same as a person keeps their id, so nothing that already references it
// (a person's current status.secondary) goes stale from a rename.
function slugCode(label, existingCodes) {
  const base = String(label || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents (é -> e, ö -> o)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'STATUS';
  let code = base;
  let n = 2;
  while (existingCodes.has(code)) {
    code = `${base}_${n}`;
    n += 1;
  }
  return code;
}

// Validates and normalizes a status form submission (from the admin page)
// into the shape stored on disk. Returns { fields } on success or
// { error } with a Swedish message ready to show back to the admin.
// Exported standalone (rather than baked into addStatus/updateStatus) so
// both call sites share exactly one validation pass.
function sanitizeFields(body) {
  const label = String(body.label ?? '').trim();
  if (!label) return { error: 'Namn krävs.' };
  if (label.length > 40) return { error: 'Namnet är för långt (max 40 tecken).' };

  const color = String(body.color ?? '').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { error: 'Färgen måste vara en hex-kod, t.ex. #3d5a80.' };

  const kind = ['none', 'time', 'date', 'note'].includes(body.kind) ? body.kind : 'none';

  let detailPrefix = String(body.detailPrefix ?? '').trim().slice(0, 20);
  if (kind !== 'time' && kind !== 'date') detailPrefix = '';

  let dots = Math.round(Number(body.dots) || 0);
  if (!Number.isFinite(dots) || dots < 0) dots = 0;
  if (dots > 3) return { error: 'Max 3 prickar.' };

  return {
    fields: {
      label,
      color,
      checksOut: !!body.checksOut,
      needsTime: kind === 'time',
      needsDate: kind === 'date',
      needsNote: kind === 'note',
      detailPrefix,
      dots,
    },
  };
}

class StatusStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'statuses.json');
    this._load();
  }

  _load() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (fs.existsSync(this.file)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        const secondary = Array.isArray(raw.secondary) ? raw.secondary : [];
        // Migrate the old two-list shape (see the comment up top): fold any
        // leftover `more` entries onto the end of `secondary`, then resave
        // once so this only ever happens the one time for a given install.
        const legacyMore = Array.isArray(raw.more) ? raw.more : [];
        this.data = {
          primary: Array.isArray(raw.primary) && raw.primary.length === 2 ? raw.primary : cloneDefaults().primary,
          secondary: legacyMore.length ? [...secondary, ...legacyMore] : secondary,
        };
        if (legacyMore.length) this._saveSync();
      } catch (err) {
        console.error(`[statuses] could not parse ${this.file}, falling back to defaults:`, err.message);
        this.data = cloneDefaults();
      }
    } else {
      this.data = cloneDefaults();
      this._saveSync();
    }
  }

  _saveSync() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file); // atomic on the same filesystem
  }

  /** The live list. Plain objects, no numeric key - display order only. */
  getAll() {
    return {
      primary: this.data.primary.map((s) => ({ ...s })),
      secondary: this.data.secondary.map((s) => ({ ...s })),
    };
  }

  findByCode(code) {
    if (!code) return null;
    const all = this.getAll();
    for (const scope of ['primary', 'secondary']) {
      const def = all[scope].find((s) => s.code === code);
      if (def) return { def, scope };
    }
    return null;
  }

  /** Does picking this code count as "not physically at work"? */
  checksOut(code) {
    const found = this.findByCode(code);
    return !!(found && found.def.checksOut);
  }

  countInUse(store, code) {
    return store.getAll().filter((p) => p.status?.secondary === code).length;
  }

  updatePrimary(code, { label, color }) {
    if (!PRIMARY_CODES.has(code)) throw new Error('Okänd status.');
    const i = this.data.primary.findIndex((s) => s.code === code);
    this.data.primary[i] = { ...this.data.primary[i], label, color };
    this._saveSync();
    return this.getAll().primary[i];
  }

  addStatus(fields) {
    const list = this.data.secondary;
    if (list.length >= MENU_MAX) {
      throw new Error(`Statuslistan är full (max ${MENU_MAX} - ta bort eller flytta en annan status först).`);
    }
    const existingCodes = new Set([...this.data.primary, ...this.data.secondary].map((s) => s.code));
    const code = slugCode(fields.label, existingCodes);
    list.push({ code, ...fields });
    this._saveSync();
    return this.findByCode(code).def;
  }

  updateStatus(code, fields) {
    if (PRIMARY_CODES.has(code)) throw new Error('Okänd status.');
    const list = this.data.secondary;
    const idx = list.findIndex((s) => s.code === code);
    if (idx < 0) throw new Error('Okänd status.');
    list[idx] = { ...list[idx], ...fields, code };
    this._saveSync();
    return this.findByCode(code).def;
  }

  removeStatus(code) {
    if (PRIMARY_CODES.has(code)) throw new Error('Inne/Ute kan inte tas bort.');
    const i = this.data.secondary.findIndex((s) => s.code === code);
    if (i < 0) return false;
    this.data.secondary.splice(i, 1);
    this._saveSync();
    return true;
  }

  moveStatus(code, direction) {
    if (PRIMARY_CODES.has(code)) return false;
    const list = this.data.secondary;
    const i = list.findIndex((s) => s.code === code);
    if (i < 0) return false;
    const j = i + direction;
    if (j < 0 || j >= list.length) return false;
    [list[i], list[j]] = [list[j], list[i]];
    this._saveSync();
    return true;
  }
}

module.exports = { StatusStore, MENU_MAX, PRIMARY_CODES, sanitizeFields };
