// import-people.js — one-time (or repeatable) bulk load of a CSV roster
// into data/people.json. Typing 50+ people through a touchscreen is no
// fun, so fill in people.csv (see people.template.csv for the format) and
// run:
//
//   node server/import-people.js path/to/people.csv
//
// Existing people are matched by NAME + DEPARTMENT + LOCATION (coop)
// and updated in place (their current status, photo, and check-in state
// are kept). New people are added. Nothing is ever deleted by this
// script. Run it again any time you add hires or move someone between
// coops - it's safe to re-run.
//
// Lines starting with # (blank lines too) are ignored, so the template can
// carry its own inline notes.

const fs = require('fs');
const path = require('path');

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node server/import-people.js path/to/people.csv');
  process.exit(1);
}

const DATA_DIR = process.env.CHECKIN_DATA_DIR || path.join(__dirname, '..', 'data');
const dataFile = path.join(DATA_DIR, 'people.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
let existing = [];
if (fs.existsSync(dataFile)) {
  existing = JSON.parse(fs.readFileSync(dataFile, 'utf8') || '[]');
}

// Stable identity: people are keyed on location + department + name, the
// things a person filling in the CSV actually controls. If two different
// people happen to share the exact same name within the same department
// and coop, they'll collide onto one id - rename one of them in the
// CSV (e.g. add a last initial) to tell them apart.
function slug(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[åä]/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'x';
}

const byKey = new Map(existing.map((r) => [slug(r.location) + '|' + slug(r.department) + '|' + slug(r.name), r]));

// A CSV boolean cell: "1"/"true"/"yes"/"x" (any case) count as checked,
// anything else (including blank) is false - matches the admin page's
// "Visa bara i sin egen coop" checkbox (restrictToLocation).
function parseBool(s) {
  return ['1', 'true', 'yes', 'ja', 'x'].includes(String(s || '').trim().toLowerCase());
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length && !l.trim().startsWith('#'));
  const header = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((c) => c.trim());
    const row = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ''));
    return row;
  });
}

const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
let added = 0;
let matched = 0;
let changed = 0;

for (const [i, row] of rows.entries()) {
  if (!row.name) continue;
  const name = row.name.trim();
  const department = row.department || 'Ej tilldelad';
  const location = (row.location || '').trim();
  const key = slug(location) + '|' + slug(department) + '|' + slug(name);
  const prev = byKey.get(key);
  const now = Date.now();

  const reference = {
    id: prev?.id || 'p_' + key.replace(/\|/g, '_'),
    name,
    department,
    role: row.role || '',
    phone: row.phone || prev?.phone || '',
    location,
    restrictToLocation: row.restrictToLocation !== undefined ? parseBool(row.restrictToLocation) : !!prev?.restrictToLocation,
    // Numeric check-in code (see admin.js's "Nummer" field / README's
    // "Number pad input") - blank if the column's left out or empty,
    // same as every other optional column here.
    code: row.code !== undefined ? row.code.trim() : (prev?.code || ''),
    order: prev?.order ?? i,
    active: true,
  };

  const referenceChanged = !prev || ['name', 'department', 'role', 'active', 'phone', 'location', 'restrictToLocation', 'code'].some((k) => prev[k] !== reference[k]);

  const record = {
    ...reference,
    // CSV import never sets a photo (that's admin-only), so always carry
    // whatever was there before straight through - otherwise re-running
    // this script (which is safe to do any time, e.g. to add new hires)
    // would silently wipe everyone's photo.
    photo: prev?.photo ?? null,
    status: prev?.status || { checkedIn: false, secondary: null, detail: '', note: '', updatedAt: now },
    deleted: false,
    recordUpdatedAt: referenceChanged ? now : (prev.recordUpdatedAt ?? now),
  };
  if (prev) { matched++; if (referenceChanged) changed++; }
  else added++;
  byKey.set(key, record);
}

fs.writeFileSync(dataFile, JSON.stringify([...byKey.values()], null, 2), 'utf8');
console.log(`Imported ${rows.length} rows: ${added} new, ${changed} changed, ${matched - changed} unchanged.`);
console.log(`Wrote ${dataFile}`);
console.log('Restart the server (or it will pick this up on next restart).');
