// avatar.js — shared by board.js, statuspopup.js and admin.js so all three
// render a person's avatar the same way: their uploaded photo if they have
// one, otherwise a colored circle with their initials. The color is a
// deterministic hash of their name, so the same person always gets the
// same color everywhere without storing anything extra.
(() => {
  const PALETTE = [
    '#e07a5f', '#3d5a80', '#2a9d8f', '#e9c46a', '#6d597a',
    '#457b9d', '#e63946', '#588157', '#b56576', '#4a4e69',
  ];

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function colorFor(name) {
    let hash = 0;
    const s = String(name || '');
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    return PALETTE[hash % PALETTE.length];
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // sizeClass is an extra CSS class (e.g. "avatar-sm", "avatar-lg") that
  // each page's own stylesheet uses to set the actual pixel/vh size.
  // `opts.showCode`: board.js's number-display mode (toggled by "*" on
  // the numpad - see numpad.js/window.BoardNumberMode) - shows this
  // person's own check-in number instead of their photo/initials, same
  // colored circle otherwise, so someone can visually match a person to
  // the number they'd type for them. A person with no code shows a plain
  // dash - never falls back to the photo/initials in this mode, since
  // that would silently look like "this person doesn't have a number"
  // and "here's their number" the same way.
  window.avatarHtml = function (person, sizeClass, opts) {
    const cls = `avatar ${sizeClass || ''}`;
    if (opts && opts.showCode) {
      const bg = colorFor(person && person.name);
      const code = (person && person.code) || '–';
      return `<span class="${cls} avatar-code" style="background-color:${bg}" role="img" aria-label="Nummer ${esc(code)}">${esc(code)}</span>`;
    }
    if (person && person.photo) {
      return `<span class="${cls}" style="background-image:url('${esc(person.photo)}')" role="img" aria-label="${esc(person.name)}"></span>`;
    }
    const bg = colorFor(person && person.name);
    return `<span class="${cls}" style="background-color:${bg}">${esc(initials(person && person.name))}</span>`;
  };
})();
