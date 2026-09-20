// statuses.js — the FACTORY DEFAULTS for the status menu, used only to
// seed data/statuses.json the very first time a server starts (see
// server/status-store.js, which owns the live, admin-editable copy from
// then on). Editing this file after that first boot has no effect on an
// existing install - use the admin page's "Statusar" tab instead, or
// delete data/statuses.json to reseed from these defaults again.
//
// Labels are Swedish since that's the working language of the board/status
// popup; "code" is the stable internal id (never shown to anyone, safe to
// keep in English, and never reused - each new status through the admin
// page gets a fresh one). There is no numeric "key" any more - every
// status is a plain button someone taps or clicks; order in the list below
// is only display order (see status-store.js's addStatus/moveStatus).
//
// checksOut: true means picking this status also sets checkedIn=false
// (the person is being marked as not physically at work) - e.g. Sjuk,
// Semester. Left out (or false) means "neutral": the status is layered on
// top of whatever IN/OUT already was, same as FYS or Kommer sent.
//
// dots: 1-3 puts that many small red dots next to the person's name on the
// board, in ADDITION to the normal colored pellet - see PLUPP1/PLUPP2 below.
// Deliberately open-ended: this system doesn't define what one or two dots
// mean, that's for whoever's using it to decide between themselves. Leave
// it out for a status that shouldn't show dots.
//
// defaultTime (needsTime statuses only): what the status popup's time
// field starts at instead of blank - e.g. Kommer sent almost always means
// "some time around the usual start of the day", not literally any hour,
// so starting at 07:30 and nudging from there beats starting from
// scratch every time. Optional - leave it out and that status's time
// field starts blank instead, same as before this existed.

const PRIMARY = [
  { code: 'IN', label: 'Inne', color: '#2a9d5c' },
  { code: 'OUT', label: 'Ute', color: '#8a94a3' },
];

// The status buttons shown on the popup below IN/OUT - one flat, scrollable
// list (see status-store.js's MENU_MAX for the cap). Selecting one of these
// also sets the sensible IN/OUT value automatically via checksOut, but the
// person can still override it afterwards.
const SECONDARY = [
  { code: 'FYS', label: 'FYS', color: '#2a9d8f' },
  { code: 'LATE', label: 'Kommer sent', color: '#f4a261', needsTime: true, defaultTime: '07:30' },
  { code: 'EARLY_LEAVE', label: 'Går tidigare', color: '#f4a261', needsTime: true, defaultTime: '16:30' },
  // detailPrefix: prepended to the entered date before it's stored, so the
  // board pellet and the popup's own "current status" line both read as a
  // sentence ("Tjänsteresa · tillbaka 24/12") instead of a bare date. See
  // chooseSecondary()/detailSubmit() in statuspopup.js. A needsDate status
  // isn't limited to a single day, either - the popup itself offers a
  // "Dag"/"Vecka" choice at pick-time (see statuspopup.js's
  // buildDateDetail()), the latter written the same "V" + last digit of
  // the ISO week-year + week number format as the board's own clock
  // (board.js's isoWeekInfo) - e.g. "Tjänsteresa · tillbaka 24/12" for a
  // day, or "Semester · tillbaka V645" for week 45 of a year ending in 6.
  { code: 'TRAVEL', label: 'Tjänsteresa', color: '#3d5a80', needsDate: true, detailPrefix: 'tillbaka', checksOut: true },
  { code: 'SICK', label: 'Sjuk', color: '#e63946', checksOut: true },
  { code: 'PLUPP2', label: 'Två pluppar', color: '#e63946', dots: 2 },
  { code: 'PLUPP1', label: 'En plupp', color: '#e63946', dots: 1 },
  { code: 'WFH', label: 'Jobbar hemifrån', color: '#3d5a80', checksOut: true },
  { code: 'VACATION', label: 'Semester', color: '#457b9d', needsDate: true, detailPrefix: 'tillbaka', checksOut: true },
  { code: 'VAB', label: 'VAB', color: '#e07a5f', checksOut: true },
  { code: 'DOCTOR', label: 'Läkarbesök', color: '#e07a5f', needsTime: true },
  { code: 'PARENTAL', label: 'Föräldraledig', color: '#457b9d', checksOut: true },
  { code: 'PERSONAL', label: 'Personlig dag', color: '#6d597a', checksOut: true },
  { code: 'OTHER', label: 'Annat', color: '#6d6875', needsNote: true },
];

module.exports = { PRIMARY, SECONDARY };
