// The one page for a date and a time: a status that asks for a date and / or a time (date and time together, a date alone, a time alone).
// Both fields on one page, either may be left empty (one is enough), a month under the Date field and a number pad under the Time field, a physical keyboard types too.
// Run by run.sh against its own demo server.
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
  const post = (p, b) => page.evaluate(([p, b]) => fetch(p, { method: 'POST', headers: { 'X-Requested-With': 'x', 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.text()), [p, b]);
  await page.goto(URL, { waitUntil: 'networkidle' });
  const api = () => page.evaluate(() => fetch('/api').then(r => r.json()));
  const a0 = await api();
  const st = a0.checkin.statuses.slice(); st.push({ label: 'Möte', colour: 'blue', needs: 'datetime', prefix: 'till' });
  await post('/checkin/statuses', { statuses: st });
  const codes = {}; (await api()).checkin.statuses.forEach(s => { codes[s.label] = s.code; });
  await page.reload({ waitUntil: 'networkidle' }); await settle(1000);
  const person = a0.checkin.groups[0].people[0];
  const textNow = async () => (await api()).checkin.groups.flatMap(g => g.people).find(p => p.id === person.id).text;
  const open = async label => { await page.locator('.rp-r[data-id="' + person.id + '"] .rp-t').click(); await settle(300); await page.locator('.rp-sheet button[data-code="' + codes[label] + '"]').click(); await settle(300); };
  const setBtn = page.locator('.rp-need2 [data-set]');
  const set = async () => { await setBtn.click(); await settle(700); };
  const tapDay = async n => page.locator('.rp-wpanel .rp-calday').nth(n - 1).click();
  const mo = new Date().getMonth() + 1;
  const timeText = async () => (await page.locator('.rp-wb[data-seg=time] .rp-wv').textContent()).replace(/\s+/g, ' ').trim();

  // ---- date and time on one page
  await open('Möte');
  ok(await page.locator('.rp-need2 .rp-wb').count() === 2, 'a date and time status has one page with a Date field and a Time field');
  ok(/Date \(optional\)/.test(await page.locator('.rp-wb[data-seg=date] .rp-wl').textContent()) && /Time \(optional\)/.test(await page.locator('.rp-wb[data-seg=time] .rp-wl').textContent()), 'both fields say optional');
  ok(/One is enough/.test(await page.locator('.rp-whint').textContent()), 'and the page says that one of them is enough');
  ok(await setBtn.isDisabled(), 'Set waits until there is a date or a time');
  ok(await page.locator('.rp-wpanel .rp-calday').count() >= 28 && await page.locator('.rp-need2 [data-skip]').count() === 1, 'the month is under the Date field, and Skip is there');
  await tapDay(15);
  ok(!(await setBtn.isDisabled()), 'a day is enough for Set');
  ok(await page.locator('.rp-wb[data-seg=time].on').count() === 1 && await page.locator('.rp-wpanel [data-k="5"]').count() === 1, 'after the day the Time field is next, with its number pad');
  await set();
  ok(await textNow() === 'Möte · till 15/' + mo, 'the date alone is set (' + await textNow() + ')');

  await open('Möte'); await page.locator('.rp-wb[data-seg=time]').click();
  ok(await setBtn.isDisabled(), 'a new page starts empty');
  for (const k of ['8', '3', '0']) await page.click('.rp-wpanel [data-k="' + k + '"]');
  ok(await timeText() === '08 : 30', 'the time is typed on the pad: 8 3 0 is 08 : 30 (' + await timeText() + ')');
  await set();
  ok(await textNow() === 'Möte · till 08:30', 'the time alone is set (' + await textNow() + ')');

  await open('Möte'); await tapDay(20);
  for (const k of ['0', '9', '1', '5']) await page.click('.rp-wpanel [data-k="' + k + '"]');
  await set();
  ok(await textNow() === 'Möte · till 20/' + mo + ' 09:15', 'both are set (' + await textNow() + ')');

  // ---- a physical keyboard: the digits go to the field that is ringed
  await open('Möte');
  await page.keyboard.type('2412');
  ok(/24\/12/.test(await page.locator('.rp-wb[data-seg=date] .rp-wv').textContent()), 'typing 2412 sets the 24th of December');
  ok(await page.locator('.rp-wb[data-seg=time].on').count() === 1, 'and moves on to the time');
  await page.keyboard.type('0915');
  ok(await timeText() === '09 : 15', 'typing 0915 sets the time');
  await page.locator('.rp-wc[data-clear=time]').click();
  ok(await timeText() !== '09 : 15' && !(await setBtn.isDisabled()), 'the cross clears the time; the date is enough');
  await page.keyboard.press('Enter'); await settle(700);
  ok(await textNow() === 'Möte · till 24/12', 'Enter is Set (' + await textNow() + ')');

  // ---- half of something is not accepted, and Skip leaves both out
  await open('Möte'); await page.locator('.rp-wb[data-seg=time]').click(); await page.click('.rp-wpanel [data-k="1"]'); await page.click('.rp-wpanel [data-k="2"]'); await page.click('.rp-wpanel [data-k="3"]');
  ok(await setBtn.isDisabled(), 'a time with three digits is not a time yet');
  await page.locator('.rp-need2 [data-skip]').click(); await settle(700);
  ok(await textNow() === 'Möte', 'Skip sets the status without a date or a time');

  // ---- a date alone and a time alone are the same page with one field
  await open('Semester');
  ok(await page.locator('.rp-need2 .rp-wb').count() === 1 && await page.locator('.rp-wb[data-seg=date]').count() === 1 && await page.locator('.rp-whint').textContent() === '', 'a date status has the Date field only');
  ok(await setBtn.isDisabled() && await page.locator('.rp-need2 [data-skip]').count() === 1, 'Set waits for a day, Skip is there');
  await tapDay(10); await set();
  ok(/10\/\d+$/.test(await textNow()), 'a day is set (' + await textNow() + ')');
  await open('Läkarbesök');
  ok(await page.locator('.rp-need2 .rp-wb').count() === 1 && await page.locator('.rp-wb[data-seg=time]').count() === 1 && await page.locator('.rp-need2 [data-skip]').count() === 0, 'a time status has the Time field only, and no Skip');
  ok(await setBtn.isDisabled(), 'Set waits for a time');
  for (const k of ['1', '4', '4', '5']) await page.click('.rp-wpanel [data-k="' + k + '"]');
  await set();
  ok(/14:45$/.test(await textNow()), 'a time is set (' + await textNow() + ')');

  ok(errors.length === 0, 'no JavaScript errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  console.log(failed ? 'FAILED' : 'all checks passed');
  process.exit(failed ? 1 : 0);
})();
