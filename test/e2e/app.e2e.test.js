// Browser tests at 390px (phone) and 1440px (desktop) with real Chromium, plus
// 1080x1920 portrait frames. Asserts: zero console errors, no request leaves the
// page's own origin, sample job -> live totals -> PDF download (valid PDF with
// the expected totals) -> customer signs -> Approved with timestamp -> signed PDF,
// both on site and through the emailed review link (demo mock outbox, never a
// real email), plus follow-up reminders fired with demo time travel.
//
//   npm run test:e2e
//   SCREENSHOT_DIR=/some/folder npm run test:e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { createAppServer, CSP } from '../../server.mjs';
import { SAMPLE_JOB, SAMPLE_BUSINESS } from '../../public/lib/model.js';
import { DEFAULT_PRICE_BOOK, suggestItems } from '../../public/lib/pricebook.js';
import { quoteTotals, money } from '../../public/lib/pricing.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '../..');
const shots = process.env.SCREENSHOT_DIR || path.join(app, 'test-results/screenshots');

// Screenshots and PDFs are review artifacts, not test results. Assertions run on
// in-memory data; files are written once after the suite. The output folder is
// often open in an image viewer, and on Windows a file held open by
// a viewer or scanner cannot be overwritten (EBUSY), so a busy file is reported
// by name instead of failing a product test that passed.
const artifacts = new Map();
const keep = (name, bytes) => { artifacts.set(name, bytes); };
function writeArtifacts() {
  mkdirSync(shots, { recursive: true });
  const busy = [];
  for (const [name, bytes] of artifacts) {
    try { writeFileSync(path.join(shots, name), bytes); } catch (e) { busy.push(`${name} (${e.code || e.message})`); }
  }
  console.log(`Saved ${artifacts.size - busy.length} of ${artifacts.size} screenshots/PDFs to ${shots}`);
  if (busy.length) console.warn(`WARNING: not overwritten, open in another program: ${busy.join(', ')}`);
}

// What the sample job should come to, computed independently of the page.
const sampleItems = suggestItems(SAMPLE_JOB.description, DEFAULT_PRICE_BOOK, { trade: SAMPLE_JOB.trade })
  .map((s) => ({ ...s.item, qty: s.qty }));
const sampleTotals = quoteTotals(sampleItems, SAMPLE_JOB);
const TOTAL = money(sampleTotals.total);
const STAMP = /\w{3} \d{1,2}, \d{4}, \d{1,2}:\d{2}\s?[AP]M/;

let server, origin, browser, dataDir;
before(async () => {
  // Demo mode = labelled mock outbox + time travel; a throwaway data folder per run.
  dataDir = mkdtempSync(path.join(tmpdir(), 'tqb-e2e-'));
  server = createAppServer({ dataDir, demo: true, schedulerMs: 0 });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await new Promise((r) => server.close(r));
  rmSync(dataDir, { recursive: true, force: true });
  writeArtifacts();
});

/** New page with console/network guards. */
async function open(viewport, opts = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: opts.dpr || 2, acceptDownloads: true, ...opts.context });
  const page = await context.newPage();
  const problems = { console: [], offsite: [] };
  page.on('console', (m) => { if (m.type() === 'error') problems.console.push(m.text()); });
  page.on('pageerror', (e) => problems.console.push(`pageerror: ${e.message}`));
  context.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(origin + '/') && !u.startsWith('data:') && !u.startsWith(`blob:${origin}/`)) problems.offsite.push(u);
  });
  await page.goto(opts.url || `${origin}/`);
  await page.locator('body.ready').waitFor();
  return { page, context, problems };
}
const clean = (problems) => {
  assert.deepEqual(problems.console, [], 'console errors');
  assert.deepEqual(problems.offsite, [], 'requests beyond the page origin');
};
const totalIs = (page, value, sel = '#total') => page.waitForFunction(([s, v]) => document.querySelector(s)?.textContent === v, [sel, value], { timeout: 8000 });

/** Click a button that triggers a download; return the file as a latin1 string. */
async function grabPdf(page, click, saveAs) {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  const file = await dl.path();
  const bytes = readFileSync(file);
  if (saveAs) keep(saveAs, bytes);
  const s = bytes.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4'), 'PDF header');
  assert.ok(s.trimEnd().endsWith('%%EOF'), 'PDF trailer');
  const xref = Number(/startxref\n(\d+)\n%%EOF/.exec(s)[1]);
  assert.equal(s.slice(xref, xref + 4), 'xref', 'xref offset');
  return { s, name: dl.suggestedFilename() };
}

/** Wait until a dialog's open animation has finished (state-based, no sleep) so screenshots aren't mid-fade. */
const settled = (page, dialogSel) => page.locator(`${dialogSel} .sheet-inner`).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));

async function drawSignature(page) {
  const box = await page.getByTestId('pad').boundingBox();
  const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
  await page.mouse.move(...at(0.1, 0.62));
  await page.mouse.down();
  const pts = [[0.16, 0.3], [0.2, 0.7], [0.27, 0.4], [0.33, 0.66], [0.4, 0.35], [0.45, 0.62], [0.52, 0.45], [0.6, 0.6], [0.7, 0.38], [0.8, 0.55], [0.9, 0.48]];
  for (const p of pts) await page.mouse.move(...at(...p), { steps: 4 });
  await page.mouse.up();
}

test('server sends a strict CSP that only allows same-origin; approval route; path traversal blocked', async () => {
  const res = await fetch(origin + '/');
  assert.equal(res.headers.get('content-security-policy'), CSP);
  assert.match(CSP, /default-src 'self'/);
  assert.match(CSP, /connect-src 'self'/);
  assert.match(CSP, /script-src 'self'(;|$)/);
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  const approve = await fetch(origin + '/approve/abc123');
  assert.equal(approve.status, 200);
  assert.match(await approve.text(), /Accept this quote/);
  assert.equal((await fetch(origin + '/../package.json')).status, 404);
  assert.equal((await fetch(origin + '/approve/../../server.mjs')).status, 404);
  assert.equal((await fetch(origin + '/', { method: 'POST' })).status, 405);
});

for (const [label, viewport, signMode] of [['390', { width: 390, height: 844 }, 'draw'], ['1440', { width: 1440, height: 900 }, 'type']]) {
  test(`${label}px: sample job -> live totals -> PDF -> sign (${signMode}) -> Approved -> signed PDF`, async () => {
    const started = Date.now();
    const { page, context, problems } = await open(viewport);
    keep(`start-${label}.png`, await page.screenshot());

    // 1. Sample job fills a fictional business + client and suggested items.
    await page.getByTestId('sample').click();
    await totalIs(page, TOTAL);
    assert.equal(await page.locator('#client-name').inputValue(), SAMPLE_JOB.client.name);
    assert.equal(await page.locator('#items .item').count(), sampleItems.length);
    assert.ok(sampleItems.length >= 3);
    assert.equal(await page.locator('#sum-subtotal').textContent(), money(sampleTotals.subtotal));
    assert.equal(await page.locator('#sum-tax').textContent(), money(sampleTotals.tax));
    assert.equal(await page.locator('#status').getAttribute('data-state'), 'draft');
    await page.waitForTimeout(500);
    keep(`quote-${label}.png`, await page.screenshot());
    keep(`quote-${label}-full.png`, await page.screenshot({ fullPage: true }));

    // 2. Totals update live: bump a quantity and the markup, then put them back.
    const first = page.locator('#items .item').first();
    await first.locator('.item-row').click(); // tap a line item to edit it
    await first.getByRole('button', { name: 'More' }).click();
    const bumped = quoteTotals(sampleItems.map((it, i) => ({ ...it, qty: i === 0 ? it.qty + 1 : it.qty })), SAMPLE_JOB);
    await totalIs(page, money(bumped.total));
    await first.getByRole('button', { name: 'Less' }).click();
    await totalIs(page, TOTAL);
    await page.locator('#markup').fill('30');
    await totalIs(page, money(quoteTotals(sampleItems, { ...SAMPLE_JOB, markup: 30 }).total));
    await page.locator('#markup').fill(String(SAMPLE_JOB.markup));
    await totalIs(page, TOTAL);
    if (label === '390') await totalIs(page, TOTAL, '#mobile-total');

    // 3. Describe-the-job suggestions are live and local.
    await page.locator('#description').fill(`${SAMPLE_JOB.description} Also the toilet keeps running.`);
    await page.locator('#suggestions .sugg:not(.is-added)', { hasText: 'Toilet tank rebuild' }).waitFor();

    // 4. PDF preview + download with the expected totals.
    await page.locator('#preview-pdf').click();
    await page.locator('#dlg-preview[open]').waitFor();
    assert.equal(await page.getByTestId('paper-total').textContent(), TOTAL);
    await page.waitForTimeout(400);
    keep(`pdf-preview-${label}.png`, await page.screenshot());
    const pdf = await grabPdf(page, () => page.getByTestId('preview-download').click(), label === '1440' ? 'sample-quote.pdf' : undefined);
    assert.match(pdf.name, /^Q-\d+-Jordan-Rivera\.pdf$/);
    for (const t of ['(Quote)', '(Total)', `(${TOTAL})`, `(${money(sampleTotals.subtotal)})`, `(${money(sampleTotals.tax)})`, `(${SAMPLE_BUSINESS.name})`, '(Jordan Rivera)', '(Customer signature)']) {
      assert.ok(pdf.s.includes(t), `PDF contains ${t}`);
    }
    for (const it of sampleItems) assert.ok(pdf.s.includes(`(${it.name})`), `PDF line ${it.name}`);
    assert.match(pdf.s, /\/Subtype \/Image/, 'logo in PDF');
    await page.locator('#dlg-preview [data-close]').click();

    // 5. Send for signature -> approval page.
    await page.getByTestId('send').click();
    await page.locator('#dlg-send[open]').waitFor();
    assert.equal(await page.getByTestId('mode-onsite').getAttribute('aria-selected'), 'true', 'on site is the default');
    const url = await page.locator('#approve-url').textContent();
    assert.match(url, new RegExp(`^${origin}/approve/[a-z0-9]+$`));
    await page.getByTestId('open-approve').click();
    await page.waitForURL(/\/approve\//);
    await page.locator('body.ready').waitFor();
    assert.equal(await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tqb.quotes')))[0].status), 'sent');
    assert.equal(await page.getByTestId('sign-total').textContent(), TOTAL);
    assert.equal(await page.getByTestId('paper-total').textContent(), TOTAL);
    assert.match(await page.locator('#notice').textContent(), /not a certified e-signature service/);

    // Validation: no tick -> helpful error, still not approved.
    await page.getByTestId('accept').click();
    assert.match(await page.locator('#sign-error').textContent(), /sign in the box|tick the box/);

    if (signMode === 'draw') {
      await page.locator('#sign-form').scrollIntoViewIfNeeded();
      await drawSignature(page);
      await page.locator('#pad-wrap.has-ink').waitFor();
    } else {
      await page.locator('[data-mode="type"]').click();
      await page.locator('#signer').fill('Jordan Rivera');
      assert.equal(await page.locator('#typed-preview').textContent(), 'Jordan Rivera');
    }
    await page.getByTestId('agree').check();
    await page.locator('#sign-form').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    keep(`signing-${label}.png`, await page.screenshot());
    await page.getByTestId('accept').click();

    // 6. Approved with a timestamp.
    await page.getByTestId('approved-title').waitFor();
    const stamp = await page.getByTestId('done-stamp').textContent();
    assert.match(stamp, /^Signed by Jordan Rivera on /);
    assert.match(stamp, STAMP);
    const saved = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tqb.quotes'))).find((q) => q.status === 'approved'));
    assert.equal(saved.approval.name, 'Jordan Rivera');
    assert.equal(saved.approval.method, signMode === 'draw' ? 'drawn' : 'typed');
    assert.equal(money(saved.approval.total), TOTAL);
    const signedAt = Date.parse(saved.approval.signedAt);
    assert.ok(signedAt >= started && signedAt <= Date.now(), 'signedAt is now');
    assert.match(saved.approval.signature, /^data:image\/jpeg;base64,/);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollTo(0, 0));
    keep(`approved-${label}.png`, await page.screenshot());

    // 7. Signed PDF from the approval page.
    const signed = await grabPdf(page, () => page.getByTestId('approve-download-signed').click(), label === '390' ? 'signed-quote-drawn.pdf' : 'signed-quote-typed.pdf');
    assert.match(signed.name, /-signed\.pdf$/);
    for (const t of ['(Approved quote)', '(Approved)', `(Accepted total: ${TOTAL})`, `(${TOTAL})`, '(Simple acceptance record', 'Not a certified']) {
      assert.ok(signed.s.includes(t), `signed PDF contains ${t}`);
    }
    assert.ok(signed.s.includes(signMode === 'draw' ? '(Jordan Rivera)' : '(Jordan Rivera \\(typed signature\\))'), 'signer line');
    assert.ok((signed.s.match(/\/Subtype \/Image/g) || []).length >= 2, 'logo and signature images');
    assert.ok(!signed.s.includes('(Customer signature)'));

    // 8. Back in the builder the quote shows Approved, locked, with the signed download.
    await page.locator('#back').click();
    await page.locator('body.ready').waitFor();
    assert.equal(await page.locator('#status').getAttribute('data-state'), 'approved');
    assert.match(await page.locator('#status-text').textContent(), STAMP);
    assert.match(await page.getByTestId('approved-stamp').textContent(), /Jordan Rivera/);
    assert.equal(await page.locator('#lockable').evaluate((el) => el.disabled), true);
    assert.equal(await page.locator('#client-name').isDisabled(), true);
    assert.equal(await page.getByTestId('send').isHidden(), true);
    const again = await grabPdf(page, () => page.getByTestId('download-signed').click());
    assert.ok(again.s.includes('(Approved quote)'));
    await page.waitForTimeout(400);
    keep(`builder-approved-${label}.png`, await page.screenshot());

    clean(problems);
    await context.close();
  });
}

test('1080x1920 portrait frames: quote, PDF preview, signing, approved', async () => {
  // 360x640 CSS px at 3x = 1080x1920 output, the phone layout a vertical video shows.
  const { page, context, problems } = await open({ width: 360, height: 640 }, { dpr: 3 });
  const frame = async (name) => keep(`portrait-1080x1920-${name}.png`, await page.screenshot());
  await page.getByTestId('sample').click();
  await totalIs(page, TOTAL);
  await page.waitForTimeout(2600); // let the toast clear
  await frame('1-start');
  await page.locator('#card-describe').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -70));
  await page.waitForTimeout(300);
  await frame('2-quote');
  await page.locator('#preview-pdf').click();
  await page.locator('#dlg-preview[open]').waitFor();
  await page.waitForTimeout(400);
  await frame('3-pdf-preview');
  await page.getByTestId('paper-total').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await frame('3b-pdf-preview-totals');
  await page.locator('#dlg-preview [data-close]').click();
  await page.getByTestId('send').click();
  await page.getByTestId('open-approve').click();
  await page.waitForURL(/\/approve\//);
  await page.locator('body.ready').waitFor();
  await page.locator('#sign-form').scrollIntoViewIfNeeded();
  await drawSignature(page);
  await page.getByTestId('agree').check();
  await page.locator('#sign-form').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.evaluate(() => window.scrollBy(0, -70));
  await page.waitForTimeout(300);
  await frame('4-signing');
  await page.getByTestId('accept').click();
  await page.getByTestId('approved-title').waitFor();
  await page.waitForTimeout(500);
  await page.locator('#done').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.evaluate(() => window.scrollBy(0, -70));
  await page.waitForTimeout(200);
  await frame('5-approved');
  const dims = await page.evaluate(() => [innerWidth * devicePixelRatio, innerHeight * devicePixelRatio]);
  assert.deepEqual(dims, [1080, 1920]);
  clean(problems);
  await context.close();
});

// ------------------------------------------------------------------ emailed quotes (demo mock outbox)
const outboxJson = async () => (await (await fetch(`${origin}/api/outbox`)).json()).emails;
const resetClock = () => fetch(`${origin}/api/demo/clock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"reset":true}' });
const shortDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const DAY_MS = 24 * 60 * 60 * 1000;

/** Owner: load the sample job (a new quote each time) and email it from the "Email to customer" tab. */
async function emailSample(page) {
  await page.getByTestId('sample').click();
  await totalIs(page, TOTAL);
  await page.getByTestId('send').click();
  await page.locator('#dlg-send[open]').waitFor();
  await page.getByTestId('mode-email').click();
  assert.equal(await page.getByTestId('email-to').inputValue(), SAMPLE_JOB.client.email);
  assert.equal(await page.getByTestId('fu-days').inputValue(), '2, 5');
  assert.equal(await page.getByTestId('fu-enabled').isChecked(), true);
  assert.equal(await page.locator('#email-mock').isVisible(), true, 'demo mock outbox is labelled');
  await page.getByTestId('email-send').click();
  await page.getByTestId('email-sent').waitFor();
  return {
    number: await page.locator('#quote-number').textContent(),
    id: await page.evaluate(() => JSON.parse(localStorage.getItem('tqb.current'))),
  };
}

/** Render one outbox email as a standalone page (what the customer's mail app shows). */
async function emailShot(context, mailId, name, opts = {}) {
  const p = await context.newPage();
  await p.goto(`${origin}/api/outbox/${mailId}/html`);
  keep(name, await p.screenshot(opts));
  await p.close();
}

for (const [label, viewport, signMode] of [['390', { width: 390, height: 844 }, 'draw'], ['1440', { width: 1440, height: 900 }, 'type']]) {
  test(`${label}px: email to customer -> outbox -> review link -> sign (${signMode}) -> builder Approved, follow-ups cancelled; time travel fires a follow-up`, async () => {
    await resetClock();
    const owner = await open(viewport);
    const { page } = owner;

    // 1. Email the sample quote.
    const q1 = await emailSample(page);
    assert.match(await page.getByTestId('email-fu-detail').textContent(), /^Next follow-up \w{3} \d{1,2}$/);
    await settled(page, '#dlg-send');
    keep(`email-send-${label}.png`, await page.screenshot());
    await page.locator('#dlg-send [data-close]').click();
    assert.equal(await page.locator('#status').getAttribute('data-state'), 'sent');
    assert.equal(await page.locator('#status-text').textContent(), `Emailed to ${SAMPLE_JOB.client.email}: awaiting approval`);
    assert.match(await page.getByTestId('fu-line').textContent(), /^Next follow-up \w{3} \d{1,2}$/);

    // 2. The Outbox shows exactly what was sent.
    await page.getByTestId('open-outbox').click();
    await page.locator('#dlg-outbox[open]').waitFor();
    const mine = (await outboxJson()).filter((e) => e.quoteId === q1.id);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].kind, 'quote');
    assert.equal(mine[0].to, SAMPLE_JOB.client.email);
    assert.ok(mine[0].subject.includes(`${q1.number} from ${SAMPLE_BUSINESS.name}: ${TOTAL}`), mine[0].subject);
    assert.deepEqual(mine[0].attachments, [`${q1.number}-Jordan-Rivera.pdf`]);
    const first = page.locator('#outbox-list .ob-item').first();
    assert.ok((await first.textContent()).includes(`To ${SAMPLE_JOB.client.email}`));
    const mailFrame = page.frameLocator('#outbox-frame');
    await mailFrame.getByText('Review & approve').waitFor();
    assert.ok((await mailFrame.locator('body').textContent()).includes(TOTAL));
    await settled(page, '#dlg-outbox');
    keep(`outbox-${label}.png`, await page.screenshot());
    const link = await first.getByTestId('ob-link').getAttribute('href');
    assert.equal(link, mine[0].link);
    assert.match(link, new RegExp(`^${origin}/review/[A-Za-z0-9_-]{12}/[A-Za-z0-9_-]{43}$`));
    await page.locator('#dlg-outbox [data-close]').click();
    await emailShot(owner.context, mine[0].id, `email-quote-${label}.png`, { fullPage: true });

    // 3. The customer opens the link in their own browser: nothing shared with the builder but the server.
    const cust = await open(viewport, { url: link });
    const cp = cust.page;
    assert.equal(await cp.getByTestId('sign-total').textContent(), TOTAL);
    assert.equal(await cp.getByTestId('paper-total').textContent(), TOTAL);
    assert.match(await cp.locator('#notice').textContent(), /not a certified e-signature service/);
    keep(`review-link-${label}.png`, await cp.screenshot());
    if (signMode === 'draw') {
      await cp.locator('#sign-form').scrollIntoViewIfNeeded();
      await drawSignature(cp);
      await cp.locator('#pad-wrap.has-ink').waitFor();
    } else {
      await cp.locator('[data-mode="type"]').click();
      await cp.locator('#signer').fill('Jordan Rivera');
    }
    await cp.getByTestId('agree').check();
    await cp.locator('#sign-form').scrollIntoViewIfNeeded();
    keep(`review-link-signing-${label}.png`, await cp.screenshot());
    await cp.getByTestId('accept').click();
    await cp.getByTestId('approved-title').waitFor();
    const stamp = await cp.getByTestId('done-stamp').textContent();
    assert.match(stamp, /^Signed by Jordan Rivera on /);
    assert.match(stamp, STAMP);
    await cp.evaluate(() => window.scrollTo(0, 0));
    keep(`review-link-approved-${label}.png`, await cp.screenshot());
    const signed = await grabPdf(cp, () => cp.getByTestId('review-download-signed').click(), `signed-quote-emailed-${label}.pdf`);
    for (const t of ['(Approved quote)', '(Approved)', `(Accepted total: ${TOTAL})`, '(Simple acceptance record']) assert.ok(signed.s.includes(t), `signed PDF contains ${t}`);
    assert.ok(signed.s.includes(signMode === 'draw' ? '(Jordan Rivera)' : '(Jordan Rivera \\(typed signature\\))'), 'signer line');
    assert.equal(await cp.evaluate(() => localStorage.getItem('tqb.quotes')), null, 'customer device stores nothing');
    clean(cust.problems);
    await cust.context.close();

    // 4. The builder learns about the approval from the server; follow-ups are cancelled.
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'approved');
    assert.match(await page.locator('#status-text').textContent(), STAMP);
    assert.match(await page.getByTestId('approved-stamp').textContent(), /Jordan Rivera/);
    assert.equal(await page.getByTestId('fu-line').textContent(), 'Follow-ups stopped: approved');
    assert.equal(await page.locator('#lockable').evaluate((el) => el.disabled), true);
    const builderSigned = await grabPdf(page, () => page.getByTestId('download-signed').click());
    assert.ok(builderSigned.s.includes('(Approved quote)'));
    keep(`builder-approved-by-email-${label}.png`, await page.screenshot());

    // 5. A second quote is never approved: time travel fires its first follow-up; the approved one gets none.
    const q2 = await emailSample(page);
    await page.locator('#dlg-send [data-close]').click();
    await page.getByTestId('open-outbox').click();
    await page.locator('#dlg-outbox[open]').waitFor();
    await page.getByTestId('advance-2').click();
    await page.locator('#outbox-list .ob-kind[data-kind="followup"]').first().waitFor();
    const all = (await outboxJson()).filter((e) => e.quoteId === q1.id || e.quoteId === q2.id);
    const reminders = all.filter((e) => e.kind === 'followup');
    assert.deepEqual(reminders.map((e) => [e.quoteId, e.n]), [[q2.id, 1]]);
    assert.ok(reminders[0].subject.startsWith(`Reminder: your quote ${q2.number}`), reminders[0].subject);
    assert.equal(all.filter((e) => e.quoteId === q1.id).length, 1, 'no follow-up for the approved quote');
    // The clock label updates after the outbox list re-renders: wait for its state, don't read it once.
    await page.waitForFunction(() => /\(\+2 days\)$/.test(document.querySelector('[data-testid="clock-now"]').textContent));
    await page.frameLocator('#outbox-frame').getByText('Reminder 1').waitFor();
    await settled(page, '#dlg-outbox');
    keep(`outbox-followup-${label}.png`, await page.screenshot());
    await page.locator('#dlg-outbox [data-close]').click();
    await emailShot(owner.context, reminders[0].id, `email-followup-${label}.png`, { fullPage: true });

    // 6. The quote list shows when the follow-up went out and when the next one is due.
    const q2Sent = Date.parse(all.find((e) => e.quoteId === q2.id && e.kind === 'quote').at);
    const expected = `Follow-up sent ${shortDate(reminders[0].at)} · next follow-up ${shortDate(q2Sent + 5 * DAY_MS)}`;
    await page.locator('#open-quotes').click();
    await page.locator('#dlg-quotes[open]').waitFor();
    await page.waitForFunction((t) => [...document.querySelectorAll('#quote-list [data-testid="ql-fu"]')].some((el) => el.textContent === t), expected);
    const fuTexts = await page.getByTestId('ql-fu').allTextContents();
    assert.ok(fuTexts.includes('Follow-ups stopped: approved'), fuTexts.join(' | '));
    await settled(page, '#dlg-quotes');
    keep(`followups-${label}.png`, await page.screenshot());

    await resetClock();
    clean(owner.problems);
    await owner.context.close();
  });
}

test('1080x1920 portrait frames: emailed quote, the email, review link, follow-up schedule', async () => {
  await resetClock();
  const portrait = { width: 360, height: 640 };
  const owner = await open(portrait, { dpr: 3 });
  const { page } = owner;
  const frame = async (p, name) => keep(`portrait-1080x1920-${name}.png`, await p.screenshot());

  const q1 = await emailSample(page);
  await settled(page, '#dlg-send');
  await frame(page, '6-email-sent');
  await page.locator('#dlg-send [data-close]').click();
  const mail = (await outboxJson()).find((e) => e.quoteId === q1.id);
  await emailShot(owner.context, mail.id, 'portrait-1080x1920-7-email.png');

  const cust = await open(portrait, { url: mail.link, dpr: 3 });
  const cp = cust.page;
  await frame(cp, '8-review-link');
  await cp.locator('#sign-form').scrollIntoViewIfNeeded();
  await drawSignature(cp);
  await cp.locator('#pad-wrap.has-ink').waitFor();
  await cp.getByTestId('agree').check();
  await cp.locator('#sign-form').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await cp.evaluate(() => window.scrollBy(0, -70));
  await frame(cp, '9-review-signing');
  await cp.getByTestId('accept').click();
  await cp.getByTestId('approved-title').waitFor();
  await cp.locator('#done').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await cp.evaluate(() => window.scrollBy(0, -70));
  await frame(cp, '10-review-approved');
  clean(cust.problems);
  await cust.context.close();
  await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'approved');

  const q2 = await emailSample(page);
  await page.locator('#dlg-send [data-close]').click();
  await page.getByTestId('open-outbox').click();
  await page.locator('#dlg-outbox[open]').waitFor();
  await page.getByTestId('advance-2').click();
  await page.locator('#outbox-list .ob-kind[data-kind="followup"]').first().waitFor();
  await page.frameLocator('#outbox-frame').getByText('Reminder 1').waitFor();
  await settled(page, '#dlg-outbox');
  await frame(page, '11-followup-outbox');
  const reminder = (await outboxJson()).find((e) => e.quoteId === q2.id && e.kind === 'followup');
  await emailShot(owner.context, reminder.id, 'portrait-1080x1920-12-followup-email.png');
  await page.locator('#dlg-outbox [data-close]').click();
  await page.locator('#open-quotes').click();
  await page.locator('#dlg-quotes[open]').waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('#quote-list [data-testid="ql-fu"]')].some((el) => el.textContent.startsWith('Follow-up sent ')));
  await settled(page, '#dlg-quotes');
  await frame(page, '13-followup-schedule');
  const dims = await page.evaluate(() => [innerWidth * devicePixelRatio, innerHeight * devicePixelRatio]);
  assert.deepEqual(dims, [1080, 1920]);

  await resetClock();
  clean(owner.problems);
  await owner.context.close();
});

test(`no email provider (not demo): the email tab says "Email isn't set up", offers no send, no outbox`, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tqb-e2e-plain-'));
  const plain = createAppServer({ dataDir: dir, demo: false, email: { provider: '', smtp: {}, allowlist: [] }, schedulerMs: 0 });
  await new Promise((r) => plain.listen(0, '127.0.0.1', r));
  const plainOrigin = `http://127.0.0.1:${plain.address().port}`;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const problems = { console: [], offsite: [] };
  page.on('console', (m) => { if (m.type() === 'error') problems.console.push(m.text()); });
  page.on('pageerror', (e) => problems.console.push(`pageerror: ${e.message}`));
  context.on('request', (r) => { if (!r.url().startsWith(`${plainOrigin}/`) && !r.url().startsWith('data:') && !r.url().startsWith(`blob:${plainOrigin}/`)) problems.offsite.push(r.url()); });
  try {
    await page.goto(`${plainOrigin}/`);
    await page.locator('body.ready').waitFor();
    assert.equal(await page.getByTestId('open-outbox').isHidden(), true, 'no outbox outside demo mode');
    await page.getByTestId('sample').click();
    await page.waitForFunction((v) => document.querySelector('#total').textContent === v, TOTAL);
    await page.getByTestId('send').click();
    await page.getByTestId('mode-email').click();
    await page.locator('#email-off').waitFor();
    assert.match(await page.locator('#email-off').textContent(), /Email isn't set up/);
    assert.equal(await page.getByTestId('email-send').isVisible(), false, 'no send button');
    await settled(page, '#dlg-send');
    keep('email-not-set-up-390.png', await page.screenshot());
    assert.equal(await page.locator('#status').getAttribute('data-state'), 'draft', 'nothing pretends to be sent');
    clean(problems);
  } finally {
    await context.close();
    await new Promise((r) => plain.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('business details + logo upload, price book edits persist, quote list, missing approval link', async () => {
  const { page, context, problems } = await open({ width: 1440, height: 900 }, { context: { reducedMotion: 'reduce' } });

  // Business settings with an uploaded logo.
  await page.locator('#open-business').click();
  await page.locator('#biz-name').fill('Test Electric Co');
  await page.locator('#biz-license').fill('Lic. #TEST-1');
  await page.locator('#logo-input').setInputFiles(path.join(app, 'public/sample-logo.svg'));
  await page.locator('#logo-preview:not([hidden])').waitFor();
  await page.locator('#biz-save').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('tqb.business') || '{}').name === 'Test Electric Co');
  const biz = await page.evaluate(() => JSON.parse(localStorage.getItem('tqb.business')));
  assert.equal(biz.name, 'Test Electric Co');
  assert.match(biz.logo, /^data:image\/jpeg;base64,/);

  // Electrical trade + price book: edit an item's price, add it, check math.
  await page.locator('.trade-opt', { hasText: 'Electrical' }).click();
  assert.equal(await page.locator('#labor-rate').inputValue(), '115');
  await page.locator('#open-book').click();
  assert.ok(await page.locator('#book .book-row').count() >= 15);
  await page.locator('#book-edit').check();
  const row = page.locator('#book .book-row.edit[data-id="e-gfci"]');
  await row.locator('[data-bf="parts"]').fill('30');
  await row.locator('[data-bf="hours"]').fill('1');
  await page.locator('#book-edit').uncheck();
  await page.locator('#book [data-add="e-gfci"]').click();
  await page.locator('#dlg-book [data-close]').click();
  // 1 h x $115 + $30 x 1.2 = $151; + 8.25% = $163.46
  await totalIs(page, '$163.46');
  await page.reload();
  await page.locator('body.ready').waitFor();
  await totalIs(page, '$163.46');
  await page.locator('#open-book').click();
  await page.locator('#book-search').fill('gfci');
  assert.match(await page.locator('#book .book-row').first().textContent(), /1 hrs · \$30\.00 materials/);
  await page.locator('#dlg-book [data-close]').click();

  // Remove the line -> totals back to zero; PDF download refuses an empty quote.
  await page.locator('#items .item .item-row').click(); // tap the line item to edit it
  await page.locator('#items .item [data-act="remove"]').click();
  await totalIs(page, '$0.00');
  await page.getByTestId('download-pdf').click();
  await page.locator('#toast.show', { hasText: 'Add at least one line item' }).waitFor();

  // Quote list shows the saved quote.
  await page.locator('#open-quotes').click();
  assert.ok(await page.locator('#quote-list li').count() >= 1);
  await page.keyboard.press('Escape');

  // An approval link for a quote not on this device explains itself.
  await page.goto(origin + '/approve/doesnotexist');
  await page.locator('#missing:not([hidden])').waitFor();
  clean(problems);
  await context.close();
});
