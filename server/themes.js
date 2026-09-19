// themes.js — the list of appearance themes an admin can pick between (see
// server/theme-store.js for where the CURRENT choice is kept, and
// public/theme.js for how a page applies it). This file is the one place
// that says which themes exist at all - everything else (admin's picker,
// the server's own validation of an admin's choice, and each page's snow
// effect) reads from it rather than having its own separate list.
//
// To add a new theme:
//   1. Add an entry below - `id` is what ends up in data-theme="..." and
//      in data/theme.json, `label` is the Swedish name shown in the admin
//      picker, `snow` turns the falling-snow effect on or off for it.
//   2. Add a matching `:root[data-theme="<id>"] { ... }` block in
//      public/shared.css, right after the existing ones, with the SAME set
//      of --variables the others define (copy one as a starting point -
//      see the comment above that section in shared.css). Missing a
//      variable there just silently falls back to :root's default, so
//      double-check the new block sets all of them.
// That's it - nothing else needs to change to add a theme.
const THEMES = [
  { id: 'dark', label: 'Mörkt (standard)', snow: false },
  { id: 'christmas', label: 'Jul', snow: true },
  { id: 'light', label: 'Ljust', snow: false },
];

const DEFAULT_THEME = 'dark';

module.exports = { THEMES, DEFAULT_THEME };
