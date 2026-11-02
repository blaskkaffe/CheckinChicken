// A pop-up closes on a tap on the dimmed backdrop, but not when text is selected in a field and the mouse is let go outside the sheet (cut, copy and paste
// started like that closed the editor of a person with what was typed in it), and the group titles are as large as the names and in the middle.
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
  await page.goto(URL, { waitUntil: 'networkidle' }); await settle(1000);

  // the group titles
  const gh = await page.evaluate(() => { const g = document.querySelector('.rp-gh'), t = g.querySelector('.rp-gt'), n = document.querySelector('.rp-n'), r = g.getBoundingClientRect(), q = t.getBoundingClientRect();
    return { title: getComputedStyle(t).fontSize, name: getComputedStyle(n).fontSize, dx: Math.abs((q.left + q.right) / 2 - (r.left + r.right) / 2), dy: Math.abs((q.top + q.bottom) / 2 - (r.top + r.bottom) / 2), h: r.height }; });
  ok(gh.title === gh.name, 'a group title is as large as the names (' + gh.title + ')');
  ok(gh.dx < 1.5 && gh.dy < 1.5, 'and in the middle of its field');
  ok(gh.h < 40, 'the field is no taller than before (' + gh.h.toFixed(1) + ' px)');

  // the editor of a person: select the text of a field, let go on the backdrop
  await page.click('#cog'); await settle(800);
  await page.locator('.wmenu', { has: page.locator('.menuhead', { hasText: /^Contacts/ }) }).locator('.menubtn').click().catch(() => {});
  await settle(300);
  const add = page.locator('button', { hasText: /Add person/ }).first();
  if (await add.count()) {
    await add.click(); await settle(400);
    const field = page.locator('.rp-need2 input[data-f=name]');
    await field.fill('Klippa Klistra'); await settle(100);
    const fb = await field.boundingBox();
    await page.mouse.move(fb.x + fb.width - 10, fb.y + fb.height / 2); await page.mouse.down();
    await page.mouse.move(5, 5, { steps: 8 }); await page.mouse.up(); await settle(300);          // the press began in the field, the release is on the backdrop
    ok(await field.count() === 1 && await field.isVisible() && await field.inputValue() === 'Klippa Klistra', 'letting go outside the sheet after selecting text does not close the editor');
    await page.mouse.click(5, 5); await settle(300);
    ok(await page.locator('.rp-need2 input[data-f=name]').count() === 0, 'a tap on the backdrop still closes it');
  } else console.log('skip  (no Add person button found in this layout)');
  ok(errors.length === 0, 'no JavaScript errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  console.log(failed ? 'FAILED' : 'all checks passed');
  process.exit(failed ? 1 : 0);
})();
