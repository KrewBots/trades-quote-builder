// The emailed-quote lifecycle through the real HTTP API, with the mock outbox,
// a temp data folder and demo time travel. No email leaves the process.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAppServer } from '../../server.mjs';
import { newQuote, SAMPLE_BUSINESS, SAMPLE_JOB, lineFromBook } from '../../public/lib/model.js';
import { DEFAULT_PRICE_BOOK } from '../../public/lib/pricebook.js';
import { quoteTotals } from '../../public/lib/pricing.js';
import { DAY } from '../../server/followups.js';

let dir, server, origin;
before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'tqb-api-'));
  server = createAppServer({ dataDir: dir, demo: true, schedulerMs: 0 });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

function sampleQuote() {
  const q = { ...newQuote({ number: 1001 }), ...structuredClone(SAMPLE_JOB) };
  q.items = ['p-wh-tank-50', 'p-wh-expansion'].map((id) => lineFromBook(DEFAULT_PRICE_BOOK.find((i) => i.id === id)));
  return q;
}
const post = (p, body, headers = {}) => fetch(origin + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const get = (p, headers = {}) => fetch(origin + p, { headers });
const linkParts = (link) => new URL(link).pathname.split('/').slice(2);
async function send(q, extra = {}) {
  const res = await post('/api/quotes/send', { quote: q, business: SAMPLE_BUSINESS, to: 'jordan@example.com', ...extra });
  return { res, body: await res.json() };
}
const travel = async (days) => (await post('/api/demo/clock', { advanceDays: days })).json();
const outbox = async () => (await (await get('/api/outbox')).json()).emails;

test('config reports demo mode with the labelled mock outbox', async () => {
  const c = await (await get('/api/config')).json();
  assert.equal(c.demo, true);
  assert.deepEqual(c.email, { configured: true, provider: 'mock', mock: true, reason: '' });
  assert.deepEqual(c.followUpDefaults, [2, 5]);
});

test('email -> review link -> approve: status flips, follow-ups stop, signed PDF available', async () => {
  const q = sampleQuote();
  const { res, body } = await send(q);
  assert.equal(res.status, 200);
  assert.match(body.ownerKey, /^[A-Za-z0-9_-]{43}$/);
  assert.match(body.link, new RegExp(`^${origin}/review/[A-Za-z0-9_-]{12}/[A-Za-z0-9_-]{43}$`));
  assert.equal(body.status, 'sent');
  assert.equal(body.followUps.next, new Date(Date.parse(body.sentAt) + 2 * DAY).toISOString());

  // The email is in the outbox with the PDF and the link.
  const mail = (await outbox()).find((e) => e.quoteId === q.id);
  assert.equal(mail.to, 'jordan@example.com');
  assert.equal(mail.kind, 'quote');
  assert.equal(mail.link, body.link);
  assert.deepEqual(mail.attachments, ['Q-1001-Jordan-Rivera.pdf']);
  const html = await get(`/api/outbox/${mail.id}/html`);
  assert.match(html.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(html.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  const htmlText = await html.text();
  assert.ok(htmlText.includes('Review &amp; approve'));
  assert.ok(htmlText.includes(body.link));
  const att = Buffer.from(await (await get(`/api/outbox/${mail.id}/attachment/0`)).arrayBuffer());
  assert.ok(att.toString('latin1').startsWith('%PDF-1.4'));

  // Server-side storage: the snapshot is on disk; quote records hold only token hashes.
  // (The demo outbox keeps the exact email sent, which contains the link; real providers keep no copy.)
  const disk = JSON.parse(readFileSync(path.join(dir, 'quotes.json'), 'utf8'));
  const records = JSON.stringify(disk.quotes);
  assert.ok(records.includes(q.id));
  const [pid, token] = linkParts(body.link);
  assert.ok(!records.includes(token), 'raw review token is never stored in quote records');
  assert.ok(!JSON.stringify(disk).includes(body.ownerKey), 'raw owner key is never stored');

  // The customer opens the link.
  const review = await (await get(`/api/review/${pid}/${token}`)).json();
  assert.equal(review.status, 'sent');
  assert.equal(review.quote.number, 'Q-1001');
  assert.equal(review.business.name, SAMPLE_BUSINESS.name);

  // Owner status needs the owner key.
  assert.equal((await get(`/api/quotes/${q.id}/status`)).status, 404);
  assert.equal((await get(`/api/quotes/${q.id}/status`, { 'X-Owner-Key': token })).status, 404);

  const sig = `data:image/jpeg;base64,${Buffer.from(String.fromCharCode(0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x04, 0x00, 0x08, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9), 'latin1').toString('base64')}`;
  const bad = await post(`/api/review/${pid}/${token}/approve`, { name: 'J', method: 'drawn', signature: sig });
  assert.equal(bad.status, 400);
  const ok = await post(`/api/review/${pid}/${token}/approve`, { name: 'Jordan Rivera', method: 'drawn', signature: sig });
  assert.equal(ok.status, 200);
  const approved = await ok.json();
  assert.equal(approved.status, 'approved');
  assert.equal(approved.approval.total, quoteTotals(q.items, q).total);

  const st = await (await get(`/api/quotes/${q.id}/status`, { 'X-Owner-Key': body.ownerKey })).json();
  assert.equal(st.status, 'approved');
  assert.equal(st.approval.name, 'Jordan Rivera');
  assert.ok(Date.parse(st.approval.signedAt) > 0);
  assert.equal(st.followUps.stopped, 'approved');
  assert.equal(st.followUps.next, null);

  // Approve twice -> conflict; follow-ups can't be re-enabled; time travel sends nothing for this quote.
  assert.equal((await post(`/api/review/${pid}/${token}/approve`, { name: 'Jordan Rivera', method: 'drawn', signature: sig })).status, 409);
  assert.equal((await post(`/api/quotes/${q.id}/followups`, { enabled: true }, { 'X-Owner-Key': body.ownerKey })).status, 409);
  const before = (await outbox()).filter((e) => e.quoteId === q.id).length;
  await travel(6);
  assert.equal((await outbox()).filter((e) => e.quoteId === q.id).length, before, 'no follow-up after approval');
  await post('/api/demo/clock', { reset: true });

  const pdf = await get(`/api/review/${pid}/${token}/pdf`);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.ok((await pdf.text()).includes('(Approved quote)'));
});

test('follow-ups fire on schedule for an unapproved quote, then stop on decline', async () => {
  const q = sampleQuote();
  const { body } = await send(q, { followUps: { enabled: true, days: [2, 5] } });
  const mine = async () => (await outbox()).filter((e) => e.quoteId === q.id);
  assert.equal((await mine()).length, 1);

  let t = await travel(1);
  assert.deepEqual(t.fired.filter((f) => f.id === q.id), []);
  t = await travel(1); // day 2
  assert.deepEqual(t.fired.filter((f) => f.id === q.id), [{ id: q.id, n: 1 }]);
  let mail = await mine();
  assert.equal(mail.length, 2);
  assert.equal(mail[0].kind, 'followup');
  assert.equal(mail[0].n, 1);
  assert.match(mail[0].subject, /^Reminder: your quote Q-1001/);
  let st = await (await get(`/api/quotes/${q.id}/status`, { 'X-Owner-Key': body.ownerKey })).json();
  assert.equal(st.followUps.sent.length, 1);
  assert.equal(st.followUps.next, new Date(Date.parse(body.sentAt) + 5 * DAY).toISOString());

  // The reminder's own link works too.
  const [pid, token] = linkParts(mail[0].link);
  assert.equal((await get(`/api/review/${pid}/${token}`)).status, 200);

  // Edit the schedule, then decline -> nothing more is sent.
  const edited = await (await post(`/api/quotes/${q.id}/followups`, { days: '2, 4' }, { 'X-Owner-Key': body.ownerKey })).json();
  assert.deepEqual(edited.followUps.days, [2, 4]);
  assert.equal((await post(`/api/quotes/${q.id}/followups`, { days: 'nope' }, { 'X-Owner-Key': body.ownerKey })).status, 400);
  const dec = await (await post(`/api/review/${pid}/${token}/decline`, { reason: 'Going with another quote' })).json();
  assert.equal(dec.status, 'declined');
  await travel(5);
  assert.equal((await mine()).length, 2, 'no reminder after decline');
  st = await (await get(`/api/quotes/${q.id}/status`, { 'X-Owner-Key': body.ownerKey })).json();
  assert.equal(st.status, 'declined');
  assert.equal(st.decline.reason, 'Going with another quote');
  assert.equal(st.followUps.stopped, 'declined');
  await post('/api/demo/clock', { reset: true });
});

test('turning follow-ups off stops them; links expire at valid-until; bad links are 404', async () => {
  const q = { ...sampleQuote(), validDays: 3 };
  const { body } = await send(q);
  await post(`/api/quotes/${q.id}/followups`, { enabled: false }, { 'X-Owner-Key': body.ownerKey });
  const t = await travel(2);
  assert.deepEqual(t.fired.filter((f) => f.id === q.id), []);
  const [pid, token] = linkParts(body.link);
  await travel(2); // now past the 3-day valid-until
  const r = await (await get(`/api/review/${pid}/${token}`)).json();
  assert.equal(r.expired, true);
  assert.equal((await post(`/api/review/${pid}/${token}/decline`, {})).status, 410);
  await post('/api/demo/clock', { reset: true });
  assert.equal((await get(`/api/review/${pid}/${'A'.repeat(43)}`)).status, 404);
  assert.equal((await get(`/api/review/nope/${token}`)).status, 404);
});

test('guards: cross-site posts, non-JSON, resending without the owner key, no items, bad email', async () => {
  const q = sampleQuote();
  assert.equal((await post('/api/quotes/send', { quote: q, business: {}, to: 'x@example.com' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('/api/quotes/send', { quote: q, business: {}, to: 'x@example.com' }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await fetch(`${origin}/api/quotes/send`, { method: 'POST', body: 'to=x' })).status, 415);
  assert.equal((await send({ ...q, items: [] })).res.status, 400);
  assert.equal((await post('/api/quotes/send', { quote: q, business: {}, to: 'not an email' })).status, 400);
  const first = await send(q);
  assert.equal(first.res.status, 200);
  assert.equal((await send(q)).res.status, 409, 'someone without the owner key cannot hijack the quote');
  const again = await post('/api/quotes/send', { quote: q, business: SAMPLE_BUSINESS, to: 'jordan@example.com' }, { 'X-Owner-Key': first.body.ownerKey });
  assert.equal(again.status, 200, 'the owner can resend');
  assert.equal((await again.json()).ownerKey, null);
  // Resending rotates the token: the old link stops working.
  const [pid, oldToken] = linkParts(first.body.link);
  assert.equal((await get(`/api/review/${pid}/${oldToken}`)).status, 404);
});

test('without demo mode: no outbox, no time travel, and email says it is not set up', async () => {
  const d2 = mkdtempSync(path.join(tmpdir(), 'tqb-api2-'));
  const plain = createAppServer({ dataDir: d2, demo: false, email: { provider: '', smtp: {}, allowlist: [] }, schedulerMs: 0 });
  await new Promise((r) => plain.listen(0, '127.0.0.1', r));
  const o = `http://127.0.0.1:${plain.address().port}`;
  try {
    const c = await (await fetch(`${o}/api/config`)).json();
    assert.equal(c.demo, false);
    assert.equal(c.email.configured, false);
    assert.match(c.email.reason, /Email isn't set up/);
    assert.equal((await fetch(`${o}/api/outbox`)).status, 404);
    assert.equal((await fetch(`${o}/api/demo/clock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"advanceDays":2}' })).status, 404);
    const res = await fetch(`${o}/api/quotes/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quote: sampleQuote(), business: {}, to: 'x@example.com' }) });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, 'email_not_configured');
  } finally {
    await new Promise((r) => plain.close(r));
    rmSync(d2, { recursive: true, force: true });
  }
});
