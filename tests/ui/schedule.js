// The schedule of a person (status menu > Schedule): planned statuses from a day to a day, a band of colour over the days, only one status at a time, the
// person's own status shows again when a planned one has ended. Also: the close cross is in the middle of its circle. Run by run.sh against its own demo server.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:' + (process.env.PORT || 8741) + '/';
let failed = 0;
const ok = (cond, what) => { console.log((cond ? 'ok   ' : 'FAIL ') + what); if (!cond) failed++; };
const settle = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/status of (400|409)/.test(m.text())) errors.push(m.text().slice(0, 150)); });
  const post = (p, b) => page.evaluate(([p, b]) => fetch(p, { method: 'POST', headers: { 'X-Requested-With': 'x', 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json()), [p, b]);
  await page.goto(URL, { waitUntil: 'networkidle' });
  const api = () => page.evaluate(() => fetch('/api').then(r => r.json()));
  const a0 = await api();
  const person = a0.checkin.groups[0].people[0];
  const code = {}; a0.checkin.statuses.forEach(s => { code[s.label] = s.code; });
  const mine = async () => (await api()).checkin.groups.flatMap(g => g.people).find(p => p.id === person.id);
  const view = () => post('/checkin/schedule', { id: person.id });
  const today = (await view()).today;
  const day = n => { const t = new Date(today + 'T12:00:00'); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); };
  await page.reload({ waitUntil: 'networkidle' }); await settle(1000);
  const row = page.locator('.rp-r[data-id="' + person.id + '"]');
  const openMenu = async () => { await row.locator('.rp-t').click(); await settle(300); };
  const openSchedule = async () => { await openMenu(); await page.locator('[data-schedule]').click(); await settle(500); };

  // ---- the close cross is in the middle of its circle
  await openMenu();
  const cross = await page.locator('.rp-modal:not(.rp-modal2) .rp-x').evaluate(x => {
    const b = getComputedStyle(x, '::before'), cw = x.clientWidth, ch = x.clientHeight;
    return { dx: parseFloat(b.left) + parseFloat(b.marginLeft) + parseFloat(b.width) / 2 - cw / 2, dy: parseFloat(b.top) + parseFloat(b.marginTop) + parseFloat(b.height) / 2 - ch / 2, w: x.offsetWidth, h: x.offsetHeight };
  });
  ok(Math.abs(cross.dx) < 0.6 && Math.abs(cross.dy) < 0.6 && cross.w === cross.h, 'the cross is in the middle of its circle (off by ' + cross.dx.toFixed(2) + ', ' + cross.dy.toFixed(2) + ')');
  ok(await page.locator('[data-schedule]').count() === 1, 'the status menu has a Schedule button');
  await page.keyboard.press('Escape'); await settle(200);

  // ---- planned statuses are bands of colour over their days (merged cells)
  ok((await post('/checkin/schedule/add', { id: person.id, code: code['Semester'], start: day(2), end: day(4) })).ok === true, 'a status is planned through the host');
  await openSchedule();
  ok(await page.locator('.rp-sched').count() === 1 && /Schedule/.test(await page.locator('.rp-sched .rp-wn').textContent()), 'the Schedule screen opens from the menu');
  const inView = async iso => page.locator('.rp-sd:has([data-day="' + iso + '"])');
  const first = await inView(day(2));
  if (await first.count()) {
    ok((await first.getAttribute('class')).includes(' e ') && (await first.getAttribute('class')).includes(' s'), 'the first day of a planned status is the start of its band');
    const last = await inView(day(4));
    if (await last.count()) ok((await last.getAttribute('class')).includes(' f'), 'and the last day is the end of it');
  }
  const menuCount = (await api()).checkin.statuses.length;
  ok(await page.locator('.rp-scst button').count() === menuCount && await page.locator('.rp-scst.rp-opts').count() === 1, 'the schedule offers the same statuses as the status menu (' + menuCount + '), as the same buttons');
  ok(await page.locator('.rp-scrow').count() === 1 && /Semester/.test(await page.locator('.rp-scrow').textContent()), 'the planned status is in the list');
  ok(/one planned status/.test(await page.locator('.rp-sclegend').textContent()), 'a note says that a band across days is one status');

  // ---- add one here: pick the status, tap the first and the last day, Add
  ok(await page.locator('[data-sc=add]').isDisabled(), 'Add waits for a status and a day');
  await page.locator('.rp-scst button', { hasText: 'Sjuk' }).click();
  const target = day(8);
  const t = new Date(target + 'T12:00:00'), now = new Date(today + 'T12:00:00');
  if (t.getMonth() !== now.getMonth()) await page.locator('[data-sc=next]').click();
  await page.locator('.rp-sdb[data-day="' + target + '"]').click(); await page.locator('.rp-sdb[data-day="' + day(9) + '"]').click().catch(() => {});
  ok(!(await page.locator('[data-sc=add]').isDisabled()), 'a status and a day is enough for Add');
  await page.locator('[data-sc=t0]').click(); await settle(300);
  ok(await page.locator('.rp-modal3 .rp-wb[data-seg=time]').count() === 1, 'the start time is the same time page');
  for (const k of ['0', '8', '3', '0']) await page.click('.rp-modal3 [data-k="' + k + '"]');
  await page.locator('.rp-modal3 [data-set3]').click(); await settle(300);
  ok(/08:30/.test(await page.locator('[data-sc=t0]').textContent()), 'and its time is on the button');
  await page.locator('[data-sc=add]').click(); await settle(700);
  const v = await view();
  ok(v.entries.length === 2 && v.entries[1].label === 'Sjuk' && v.entries[1].start === target && v.entries[1].start_time === '08:30', 'Add plans it (' + JSON.stringify(v.entries.map(e => e.label + ' ' + e.start)) + ')');

  // ---- only one status at a time
  await page.locator('.rp-scst button', { hasText: 'VAB' }).click();
  await page.locator('.rp-sdb[data-day="' + target + '"]').click(); await page.locator('.rp-sdb[data-day="' + target + '"]').click();
  await page.locator('[data-sc=add]').click(); await settle(700);
  ok(/only one status at a time/.test(await page.locator('.rp-sched .rp-cmsg').textContent()) && (await view()).entries.length === 2, 'a status that overlaps another is refused with a message');

  // ---- a status can be left out of the schedule (Settings > Statuses > the status > Can be planned in a person's schedule)
  const all = (await api()).checkin.statuses;
  await post('/checkin/statuses', { statuses: all.map(x => Object.assign({}, x, { schedule: x.label !== 'Sjuk' && x.label !== 'VAB' })) });
  await page.keyboard.press('Escape'); await settle(300); await openSchedule();
  ok(await page.locator('.rp-scst button').count() === menuCount - 2 && await page.locator('.rp-scst button', { hasText: 'VAB' }).count() === 0, 'a status that is switched off in Settings is not in the schedule (' + (menuCount - 2) + ' left)');
  ok(await page.locator('.rp-scrow', { hasText: 'Sjuk' }).count() === 1, 'what was planned with it stays in the list');
  await post('/checkin/statuses', { statuses: all });
  await page.keyboard.press('Escape'); await settle(300); await openSchedule();

  // ---- delete
  await page.locator('.rp-scrow', { hasText: 'Sjuk' }).locator('[data-sc=del]').click(); await settle(700);
  ok((await view()).entries.map(e => e.label).join() === 'Semester', 'Delete removes it');
  await page.keyboard.press('Escape'); await settle(200);

  // ---- a planned status in force shows on the board, and the person's own status shows again when it is gone
  ok((await mine()).planned === false && (await mine()).status === '', 'before it starts the board shows the person\'s own status');
  const live = await post('/checkin/schedule/add', { id: person.id, code: code['Tjänsteresa'], start: today, end: today });
  ok(live.ok === true, 'a status for today is planned');
  await settle(1500);
  const p1 = await mine();
  ok(p1.planned === true && p1.status === code['Tjänsteresa'] && p1.in === false && /tillbaka/.test(p1.text), 'it shows at once (' + p1.text + ')');
  ok(/Tjänsteresa/.test(await row.textContent()), 'the row on the board shows it');
  await openMenu();
  ok(/From the schedule/.test(await page.locator('.rp-cur').textContent()), 'the menu says it comes from the schedule');
  await page.keyboard.press('Escape'); await settle(200);
  await post('/checkin/schedule/delete', { id: person.id, entry: live.entries.find(e => e.label === 'Tjänsteresa').id });
  await settle(1500);
  const p2 = await mine();
  ok(p2.planned === false && p2.status === '', 'when it is gone the person\'s own status shows again');

  ok(errors.length === 0, 'no JavaScript errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  console.log(failed ? 'FAILED' : 'all checks passed');
  process.exit(failed ? 1 : 0);
})();
