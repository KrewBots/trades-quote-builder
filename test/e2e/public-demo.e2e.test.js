// The public demo (DEMO_MODE=1) in real Chromium at 390px and 1440px: banner on
// every page, the full flow (sample quote -> PDF -> "email" to the mock outbox ->
// review link on the customer's device -> sign -> Approved), per-visitor outbox,
// and the 1 MB logo limit. Zero console errors and no off-origin requests.
//
//   npm run test:e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { createAppServer } from '../../server.mjs';
import { BANNER_TEXT } from '../../server/public-demo.js';
import { SAMPLE_JOB } from '../../public/lib/model.js';
import { DEFAULT_PRICE_BOOK, suggestItems } from '../../public/lib/pricebook.js';
import { quoteTotals, money } from '../../public/lib/pricing.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(process.env.SCREENSHOT_DIR || path.resolve(here, '../../test-results/screenshots'), 'public-demo');
const artifacts = new Map();
const keep = (name, bytes) => { artifacts.set(name, bytes); };

const sampleItems = suggestItems(SAMPLE_JOB.description, DEFAULT_PRICE_BOOK, { trade: SAMPLE_JOB.trade }).map((s) => ({ ...s.item, qty: s.qty }));
const TOTAL = money(quoteTotals(sampleItems, SAMPLE_JOB).total);

let server, origin, browser;
before(async () => {
  // Real public-demo limits, except the all-requests cap: the whole suite runs from one IP.
  server = createAppServer({ publicDemo: true, schedulerMs: 0, wipeSchedule: false, env: {}, limits: { requests: [5000, 60_000] } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await new Promise((r) => server.close(r));
  mkdirSync(shots, { recursive: true });
  const busy = [];
  for (const [name, bytes] of artifacts) {
    try { writeFileSync(path.join(shots, name), bytes); } catch (e) { busy.push(`${name} (${e.code})`); }
  }
  console.log(`Saved ${artifacts.size - busy.length} of ${artifacts.size} files to ${shots}`);
  if (busy.length) console.warn(`WARNING: not overwritten, open in another program: ${busy.join(', ')}`);
});

async function open(viewport, url = `${origin}/`) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, acceptDownloads: true });
  const page = await context.newPage();
  const problems = { console: [], offsite: [] };
  page.on('console', (m) => { if (m.type() === 'error') problems.console.push(m.text()); });
  page.on('pageerror', (e) => problems.console.push(`pageerror: ${e.message}`));
  context.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(origin + '/') && !u.startsWith('data:') && !u.startsWith(`blob:${origin}/`)) problems.offsite.push(u);
  });
  await page.goto(url);
  return { page, context, problems };
}
const clean = (problems) => {
  assert.deepEqual(problems.console, [], 'console errors');
  assert.deepEqual(problems.offsite, [], 'requests beyond the page origin');
};
async function bannerOk(page) {
  const b = page.getByTestId('demo-banner');
  assert.equal(await b.isVisible(), true, 'banner visible');
  assert.equal((await b.textContent()).replace(/\s+/g, ' ').trim(), BANNER_TEXT);
  const box = await b.boundingBox();
  assert.ok(box.y <= 1 && box.height > 20, `banner at the top: ${JSON.stringify(box)}`);
}
const settled = (page, sel) => page.locator(`${sel} .sheet-inner`).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));

for (const [label, viewport] of [['390', { width: 390, height: 844 }], ['1440', { width: 1440, height: 900 }]]) {
  test(`${label}px public demo: banner everywhere; sample -> PDF -> email -> outbox -> review link -> sign -> Approved`, async () => {
    const owner = await open(viewport);
    const { page } = owner;
    await page.locator('body.ready').waitFor();
    await bannerOk(page);
    keep(`builder-${label}.png`, await page.screenshot());

    // Sample quote and PDF.
    await page.getByTestId('sample').click();
    await page.waitForFunction((v) => document.querySelector('#total')?.textContent === v, TOTAL);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-pdf').click()]);
    const pdf = readFileSync(await dl.path()).toString('latin1');
    assert.ok(pdf.startsWith('%PDF-1.4') && pdf.includes(`(${TOTAL})`), 'PDF with the total');

    // "Email" it: mock outbox only.
    await page.getByTestId('send').click();
    await page.locator('#dlg-send[open]').waitFor();
    await page.getByTestId('mode-email').click();
    assert.equal(await page.locator('#email-mock').isVisible(), true);
    await page.getByTestId('email-send').click();
    await page.getByTestId('email-sent').waitFor();
    await page.locator('#dlg-send [data-close]').click();

    await page.getByTestId('open-outbox').click();
    await page.locator('#dlg-outbox[open]').waitFor();
    await page.locator('#outbox-list .ob-item').first().waitFor();
    assert.equal(await page.locator('#outbox-list .ob-item').count(), 1, 'only this visitor\'s email');
    await page.frameLocator('#outbox-frame').getByText('Review & approve').waitFor(); // preview loads with the visitor cookie
    await settled(page, '#dlg-outbox');
    keep(`outbox-${label}.png`, await page.screenshot());
    const link = await page.locator('#outbox-list .ob-item').first().getByTestId('ob-link').getAttribute('href');
    assert.match(link, new RegExp(`^${origin}/review/[A-Za-z0-9_-]{12}/[A-Za-z0-9_-]{43}$`));
    await page.locator('#dlg-outbox [data-close]').click();

    // Another visitor sees an empty outbox.
    const other = await open(viewport);
    await other.page.locator('body.ready').waitFor();
    assert.deepEqual((await other.page.evaluate(() => fetch('/api/outbox').then((r) => r.json()))).emails, []);
    clean(other.problems);
    await other.context.close();

    // Customer: review link on their own device, banner there too.
    const cust = await open(viewport, link);
    const cp = cust.page;
    await cp.getByTestId('sign-total').waitFor();
    await bannerOk(cp);
    assert.equal(await cp.getByTestId('sign-total').textContent(), TOTAL);
    keep(`review-${label}.png`, await cp.screenshot());
    await cp.locator('[data-mode="type"]').click();
    await cp.locator('#signer').fill('Jordan Rivera');
    await cp.getByTestId('agree').check();
    await cp.getByTestId('accept').click();
    await cp.getByTestId('approved-title').waitFor();
    assert.match(await cp.getByTestId('done-stamp').textContent(), /^Signed by Jordan Rivera on /);
    await cp.evaluate(() => window.scrollTo(0, 0));
    keep(`review-approved-${label}.png`, await cp.screenshot());
    clean(cust.problems);
    await cust.context.close();

    // Builder picks up the approval.
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'approved');
    keep(`builder-approved-${label}.png`, await page.screenshot());

    // On-site approval page carries the banner as well.
    await page.goto(`${origin}/approve/doesnotexist`);
    await page.locator('#missing:not([hidden])').waitFor();
    await bannerOk(page);
    clean(owner.problems);
    await owner.context.close();
  });
}

test('public demo: a logo file over 1 MB is refused in the browser', async () => {
  const { page, context, problems } = await open({ width: 1440, height: 900 });
  await page.locator('body.ready').waitFor();
  await page.locator('#open-business').click();
  await page.locator('#logo-input').setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(1024 * 1024 + 1, 1) });
  await page.locator('#toast.show', { hasText: 'Logo file is too large (1 MB max).' }).waitFor();
  assert.equal(await page.locator('#logo-preview').isHidden(), true);
  clean(problems);
  await context.close();
});
