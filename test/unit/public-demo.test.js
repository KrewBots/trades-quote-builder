// Public demo lock (DEMO_MODE=1): no real email whatever the settings say, rate
// limits, caps, content safety, data lifecycle and ops behaviour, through the
// real HTTP server. Rate-limit windows run on an injected clock, so nothing sleeps.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createAppServer } from '../../server.mjs';
import { createMailer, emailConfigFromEnv, lockedEmailConfig } from '../../server/mailer.js';
import { createMemoryStore } from '../../server/store.js';
import { createRateLimiter, clientIp, nextWipeAt, DEMO_LIMITS, BUSY_MESSAGE, BANNER_TEXT, withBanner } from '../../server/public-demo.js';
import { newQuote, SAMPLE_BUSINESS, SAMPLE_JOB, lineFromBook } from '../../public/lib/model.js';
import { DEFAULT_PRICE_BOOK } from '../../public/lib/pricebook.js';

const REAL_EMAIL_ENV = {
  DEMO_MODE: '1',
  TQB_EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'test-key', TQB_EMAIL_FROM: 'Real <real@example.com>',
  TQB_EMAIL_ALLOWLIST: 'jordan@example.com', SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u', SMTP_PASS: 'p',
};

/** A listening public-demo server with a controllable wall clock. */
async function start(opts = {}) {
  let now = Date.UTC(2026, 9, 28, 12, 0, 0);
  const server = createAppServer({ publicDemo: true, schedulerMs: 0, wipeSchedule: false, realNow: () => now, trustProxyHops: 1, env: {}, ...opts });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const t = {
    server, origin,
    advance(ms) { now += ms; },
    get: (p, headers = {}) => fetch(origin + p, { headers }),
    post: (p, body, headers = {}) => fetch(origin + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }),
    close: () => new Promise((r) => server.close(r)),
  };
  return t;
}

let seq = 0;
function sampleQuote(extra = {}) {
  const q = { ...newQuote({ number: 1001 + seq }), ...structuredClone(SAMPLE_JOB), ...extra };
  q.id = `q${Date.now().toString(36)}${(seq++).toString(36)}`;
  q.items = extra.items || ['p-wh-tank-50', 'p-wh-expansion'].map((id) => lineFromBook(DEFAULT_PRICE_BOOK.find((i) => i.id === id)));
  return q;
}
const sendBody = (q, extra = {}) => ({ quote: q, business: SAMPLE_BUSINESS, to: 'jordan@example.com', ...extra });
const ip = (addr) => ({ 'X-Forwarded-For': addr });
const cookieOf = (res) => (res.headers.get('set-cookie') || '').split(';')[0];
/** Smallest valid baseline JPEG header with the given size (enough for the SOF parser). */
function jpegDataUrl(width, height, padTo = 0) {
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const bytes = Buffer.from([0xff, 0xd8, ...sof, 0xff, 0xd9]);
  const b64 = bytes.toString('base64');
  return `data:image/jpeg;base64,${b64}${padTo > b64.length ? 'A'.repeat(Math.ceil((padTo - b64.length) / 4) * 4) : ''}`;
}

// ------------------------------------------------------------------ 1. demo lock
test('demo lock: env and opts that configure Resend/SMTP still give the mock outbox; nothing leaves the process', async () => {
  let fetchCalls = 0;
  let connects = 0;
  const t = await start({
    env: REAL_EMAIL_ENV, publicDemo: undefined, // DEMO_MODE=1 from env alone turns the lock on
    email: { provider: 'resend', resendKey: 'k', from: 'Real <real@example.com>', allowlist: ['jordan@example.com'], smtp: {} },
    emailDeps: { fetchImpl: async () => { fetchCalls++; return new Response('{}'); }, connect: () => { connects++; throw new Error('no'); } },
  });
  try {
    assert.equal(t.server.publicDemo, true);
    assert.equal(t.server.mailer.mock, true);
    assert.equal(t.server.mailer.locked, true);
    const c = await (await t.get('/api/config')).json();
    assert.equal(c.publicDemo, true);
    assert.deepEqual(c.email, { configured: true, provider: 'mock', mock: true, reason: '' });
    const res = await t.post('/api/quotes/send', sendBody(sampleQuote()), ip('203.0.113.1'));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).mock, true);
    assert.equal(t.server.store.listOutbox().length, 1);
    assert.equal(t.server.store.listOutbox()[0].from, 'Quote Builder demo <demo@example.invalid>', 'configured From is ignored too');
    assert.equal(fetchCalls, 0, 'no Resend call');
    assert.equal(connects, 0, 'no SMTP connection');
  } finally { await t.close(); }
});

test('demo lock: config helpers ignore every email variable; a locked config is mock even outside demo', () => {
  assert.deepEqual(emailConfigFromEnv(REAL_EMAIL_ENV, { publicDemo: true }), lockedEmailConfig());
  const m = createMailer({ ...lockedEmailConfig(), demo: false, provider: 'smtp' }, { outbox: () => 'id' });
  assert.equal(m.mock, true);
  assert.equal(m.provider, 'mock');
  // Without the lock, TQB_EMAIL_PROVIDER still wins in plain demo mode (self-hosters can test a real provider).
  assert.equal(emailConfigFromEnv(REAL_EMAIL_ENV, { demo: true }).provider, 'resend');
});

// ------------------------------------------------------------------ 2. abuse limits
test('client IP: only the right-most X-Forwarded-For hop is trusted', () => {
  const req = (xff) => ({ headers: xff ? { 'x-forwarded-for': xff } : {}, socket: { remoteAddress: '10.0.0.9' } });
  assert.equal(clientIp(req('1.1.1.1, 9.9.9.9'), 1), '9.9.9.9');
  assert.equal(clientIp(req('9.9.9.9'), 1), '9.9.9.9');
  assert.equal(clientIp(req('not-an-ip'), 1), '10.0.0.9');
  assert.equal(clientIp(req(''), 1), '10.0.0.9');
  assert.equal(clientIp(req('1.1.1.1, 9.9.9.9'), 0), '10.0.0.9', 'no proxy trusted locally');
  assert.equal(clientIp(req('2001:db8::1'), 1), '2001:db8::1');
});

test('rate limiter: fixed window, recovers after it, bounded memory', () => {
  let now = 0;
  const rl = createRateLimiter({ max: 2, windowMs: 1000, maxKeys: 3, now: () => now });
  assert.equal(rl.hit('a').ok, true);
  assert.equal(rl.hit('a').ok, true);
  const no = rl.hit('a');
  assert.equal(no.ok, false);
  assert.equal(no.retryAfter, 1);
  assert.ok(rl.blocked('a'));
  now = 1000;
  assert.equal(rl.hit('a').ok, true, 'new window');
  for (const k of ['b', 'c', 'd', 'e', 'f']) rl.hit(k);
  assert.ok(rl.size <= 3, `size ${rl.size}`);
});

test('per-IP write limit: burst -> friendly 429 with Retry-After, other IPs unaffected, spoofed XFF ignored, recovers', async () => {
  const t = await start({ limits: { writes: [3, 60_000] } });
  try {
    const go = (addr) => t.post('/api/quotes/send', sendBody(sampleQuote()), ip(addr));
    for (let i = 0; i < 3; i++) assert.equal((await go(`198.51.100.${i}, 203.0.113.7`)).status, 200);
    const limited = await go('192.0.2.200, 203.0.113.7'); // a different spoofed left entry, same real client
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '60');
    assert.deepEqual(await limited.json(), { error: 'busy', message: BUSY_MESSAGE });
    assert.equal((await go('203.0.113.8')).status, 200, 'another client is fine');
    t.advance(60_000);
    assert.equal((await go('203.0.113.7')).status, 200, 'recovers after the window');
  } finally { await t.close(); }
});

test('global write cap -> 503 "demo is busy"; all-request limit covers pages too; /health is never limited', async () => {
  const t = await start({ limits: { globalWrites: [2, 60_000], requests: [5, 60_000] } });
  try {
    assert.equal((await t.post('/api/demo/clock', { reset: true }, ip('203.0.113.1'))).status, 200);
    assert.equal((await t.post('/api/demo/clock', { reset: true }, ip('203.0.113.2'))).status, 200);
    const busy = await t.post('/api/demo/clock', { reset: true }, ip('203.0.113.3'));
    assert.equal(busy.status, 503);
    assert.equal((await busy.json()).message, BUSY_MESSAGE);
    for (let i = 0; i < 5; i++) assert.equal((await t.get('/', ip('203.0.113.9'))).status, 200);
    const page = await t.get('/', ip('203.0.113.9'));
    assert.equal(page.status, 429);
    assert.equal(await page.text(), BUSY_MESSAGE);
    for (let i = 0; i < 20; i++) assert.equal((await t.get('/health', ip('203.0.113.9'))).status, 200);
  } finally { await t.close(); }
});

test('token brute force: wrong review links and owner keys lock the IP out (even with a right token), then recover', async () => {
  const t = await start({ limits: { tokenFailures: [5, 600_000] } });
  try {
    const a = ip('203.0.113.50');
    const sent = await (await t.post('/api/quotes/send', sendBody(sampleQuote()), ip('203.0.113.51'))).json();
    const [pid, token] = new URL(sent.link).pathname.split('/').slice(2);
    for (let i = 0; i < 3; i++) assert.equal((await t.get(`/api/review/${pid}/${'x'.repeat(43)}`, a)).status, 404);
    for (let i = 0; i < 2; i++) assert.equal((await t.get(`/api/quotes/${sent.id}/status`, { ...a, 'X-Owner-Key': 'y'.repeat(43) })).status, 404);
    const locked = await t.get(`/api/review/${pid}/${token}`, a);
    assert.equal(locked.status, 429);
    assert.equal((await locked.json()).error, 'too_many_attempts');
    assert.equal((await t.get(`/api/review/${pid}/${token}`, ip('203.0.113.52'))).status, 200, 'other IPs unaffected');
    t.advance(600_000);
    assert.equal((await t.get(`/api/review/${pid}/${token}`, a)).status, 200);
  } finally { await t.close(); }
});

test('request size: 1 MB body cap (friendly 413), max line items, image size and dimensions validated', async () => {
  const t = await start();
  try {
    const big = await t.post('/api/quotes/send', sendBody(sampleQuote(), { pad: 'x'.repeat(DEMO_LIMITS.maxBody) }), ip('203.0.113.60'));
    assert.equal(big.status, 413);
    assert.match((await big.json()).message, /too big to send \(max 1024 KB\)/);

    const many = sampleQuote({ items: Array.from({ length: DEMO_LIMITS.maxItems + 1 }, () => ({ name: 'x', hours: 1, parts: 1, qty: 1 })) });
    const r = await t.post('/api/quotes/send', sendBody(many), ip('203.0.113.61'));
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, 'too_many_items');

    // Oversized or huge-dimension logos are dropped from the stored quote; a valid one is kept.
    for (const [logo, kept] of [[jpegDataUrl(5000, 100), false], [jpegDataUrl(100, 100, DEMO_LIMITS.maxImageChars + 10), false], [`${jpegDataUrl(100, 100)}AAAA`, false], ['data:image/svg+xml;base64,PHN2Zz4=', false], [jpegDataUrl(300, 120), true]]) {
      const q = sampleQuote();
      const res = await t.post('/api/quotes/send', sendBody(q, { business: { ...SAMPLE_BUSINESS, logo } }), ip('203.0.113.62'));
      assert.equal(res.status, 200);
      assert.equal(t.server.store.getQuote(q.id).snapshot.business.logo === logo, kept);
    }

    // Signatures get the same checks.
    const sent = await (await t.post('/api/quotes/send', sendBody(sampleQuote()), ip('203.0.113.63'))).json();
    const base = new URL(sent.link).pathname.replace('/review/', '/api/review/');
    const bad = await t.post(`${base}/approve`, { name: 'Jordan Rivera', method: 'drawn', signature: jpegDataUrl(4000, 4000) }, ip('203.0.113.63'));
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, 'bad_signature');
  } finally { await t.close(); }
});

test('storage caps: oldest quotes and mock emails are deleted first, by count and by total bytes', async () => {
  const s = createMemoryStore({ maxQuotes: 3, maxOutbox: 2, maxBytes: 10_000 });
  for (const id of ['a', 'b', 'c', 'd']) s.putQuote({ id, publicId: id, pad: '' });
  assert.deepEqual(s.allQuotes().map((q) => q.id), ['b', 'c', 'd']);
  s.putQuote({ id: 'b', publicId: 'b', pad: 'updated' }); // an update keeps its age
  s.putQuote({ id: 'e', publicId: 'e', pad: '' });
  assert.deepEqual(s.allQuotes().map((q) => q.id), ['c', 'd', 'e']);
  for (const id of ['m1', 'm2', 'm3']) s.addOutbox({ id });
  assert.deepEqual(s.listOutbox().map((m) => m.id), ['m2', 'm3']);
  s.addOutbox({ id: 'big', pad: 'x'.repeat(9_950) });
  assert.ok(s.usage.bytes <= 10_000, `bytes ${s.usage.bytes}`);
  assert.ok(s.getOutbox('big'), 'newest entry survives');
  assert.equal(s.getQuote('c'), null, 'oldest evicted to make room');

  // Through the API: with a 2-quote cap the first emailed quote's link stops working.
  const t = await start({ limits: { maxQuotes: 2 } });
  try {
    const links = [];
    for (let i = 0; i < 3; i++) links.push((await (await t.post('/api/quotes/send', sendBody(sampleQuote()), ip(`203.0.113.7${i}`))).json()).link);
    const api = (l) => new URL(l).pathname.replace('/review/', '/api/review/');
    assert.equal((await t.get(api(links[0]), ip('203.0.113.79'))).status, 404);
    assert.equal((await t.get(api(links[2]), ip('203.0.113.79'))).status, 200);
    assert.equal(t.server.store.usage.quotes, 2);
  } finally { await t.close(); }
});

test('outbox is per visitor: another browser sees none of your emails, previews or PDFs', async () => {
  const t = await start();
  try {
    const first = await t.get('/api/config', ip('203.0.113.80'));
    const me = cookieOf(first);
    assert.match(first.headers.get('set-cookie'), /^tqb_demo=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=86400; HttpOnly; SameSite=Lax$/);
    const them = cookieOf(await t.get('/api/config', ip('203.0.113.81')));
    assert.equal((await t.post('/api/quotes/send', sendBody(sampleQuote()), { ...ip('203.0.113.80'), Cookie: me })).status, 200);
    const mine = (await (await t.get('/api/outbox', { Cookie: me })).json()).emails;
    assert.equal(mine.length, 1);
    assert.equal((await (await t.get('/api/outbox', { Cookie: them })).json()).emails.length, 0);
    assert.equal((await (await t.get('/api/outbox')).json()).emails.length, 0, 'no cookie, nothing');
    assert.equal((await t.get(`/api/outbox/${mine[0].id}/html`, { Cookie: them })).status, 404);
    assert.equal((await t.get(`/api/outbox/${mine[0].id}/attachment/0`, { Cookie: them })).status, 404);
    assert.equal((await t.get(`/api/outbox/${mine[0].id}/html`, { Cookie: me })).status, 200);
    const https = await t.get('/api/config', { 'X-Forwarded-Proto': 'https' });
    assert.match(https.headers.get('set-cookie'), /; Secure$/);
  } finally { await t.close(); }
});

// ------------------------------------------------------------------ 3. content safety
test('content safety: user text is escaped in the email, never becomes a link; review links ignore the Host header', async () => {
  const t = await start();
  try {
    const evil = '<script>alert(1)</script><a href="https://evil.example/pay">Pay here</a>';
    const q = sampleQuote({ jobTitle: evil, client: { ...SAMPLE_JOB.client, name: evil } });
    q.items[0].name = evil;
    const cookie = cookieOf(await t.get('/api/config'));
    const sent = await (await t.post('/api/quotes/send', sendBody(q, { business: { ...SAMPLE_BUSINESS, name: evil, email: 'https://evil.example' } }), { ...ip('203.0.113.90'), Cookie: cookie })).json();
    const [mail] = (await (await t.get('/api/outbox', { Cookie: cookie })).json()).emails;
    const html = await (await t.get(`/api/outbox/${mail.id}/html`, { Cookie: cookie })).text();
    assert.ok(!/<script/i.test(html), 'no script tag');
    assert.ok(html.includes('&lt;script&gt;'), 'escaped');
    const hrefs = [...html.matchAll(/<a\s[^>]*href="([^"]*)"/gi)].map((m) => m[1]);
    assert.deepEqual(hrefs, [sent.link], 'the only link is our own review link');
    assert.ok(sent.link.startsWith(t.origin + '/review/'));

    // A forged Host header can't point review links somewhere else.
    const forged = await new Promise((resolve, reject) => {
      const body = JSON.stringify(sendBody(sampleQuote()));
      const r = http.request(`${t.origin}/api/quotes/send`, { method: 'POST', headers: { Host: 'evil.example', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-Forwarded-For': '203.0.113.91' } }, (res) => {
        let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
      });
      r.on('error', reject); r.end(body);
    });
    assert.equal(forged.status, 503);
    assert.equal(forged.body.error, 'not_configured');
  } finally { await t.close(); }
  // With a configured public URL (Railway's domain), links always use it.
  const t2 = await start({ env: { RAILWAY_PUBLIC_DOMAIN: 'tqb-demo.up.railway.app' } });
  try {
    const sent = await (await t2.post('/api/quotes/send', sendBody(sampleQuote()), ip('203.0.113.92'))).json();
    assert.match(sent.link, /^https:\/\/tqb-demo\.up\.railway\.app\/review\//);
  } finally { await t2.close(); }
});

test('no indexing: robots.txt disallows all, X-Robots-Tag on every response, noindex meta and the banner on every page', async () => {
  const t = await start();
  try {
    const robots = await t.get('/robots.txt');
    assert.equal(await robots.text(), 'User-agent: *\nDisallow: /\n');
    for (const p of ['/', '/approve/abc123', '/review/AAAAAAAAAAAA/' + 'B'.repeat(43), '/api/config', '/styles.css', '/nope']) {
      const res = await t.get(p);
      assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow', p);
      if (res.headers.get('content-type')?.startsWith('text/html')) {
        const html = await res.text();
        assert.match(html, /<meta name="robots" content="noindex, nofollow">/, p);
        const banner = /<body[^>]*>\s*<div class="demo-banner"[^>]*>(.*?)<\/div>/s.exec(html);
        assert.ok(banner, `banner first in body: ${p}`);
        assert.equal(banner[1].replace(/<[^>]+>/g, '').replace(/&#39;|'/g, "'"), BANNER_TEXT);
      }
    }
    assert.equal(withBanner('<body class="x">hi</body>').indexOf('demo-banner') > 0, true);
  } finally { await t.close(); }
});

// ------------------------------------------------------------------ 4. data lifecycle
test('review links expire after 24 h of real time, even if the demo clock is rewound', async () => {
  const t = await start();
  try {
    const sent = await (await t.post('/api/quotes/send', sendBody(sampleQuote()), ip('203.0.113.100'))).json();
    const base = new URL(sent.link).pathname.replace('/review/', '/api/review/');
    assert.equal((await (await t.get(base, ip('203.0.113.100'))).json()).expired, false);
    t.advance(24 * 3600_000 + 1);
    assert.equal((await (await t.get(base, ip('203.0.113.100'))).json()).expired, true);
    const late = await t.post(`${base}/approve`, { name: 'Jordan Rivera', method: 'typed', signature: jpegDataUrl(200, 60) }, ip('203.0.113.100'));
    assert.equal(late.status, 410);
  } finally { await t.close(); }
});

test('demo clock is capped at 30 days ahead', async () => {
  const t = await start();
  try {
    assert.equal((await t.post('/api/demo/clock', { advanceDays: 30 }, ip('203.0.113.110'))).status, 200);
    const over = await t.post('/api/demo/clock', { advanceDays: 1 }, ip('203.0.113.110'));
    assert.equal(over.status, 409);
    assert.equal((await over.json()).error, 'clock_limit');
  } finally { await t.close(); }
});

test('wipe: next wipe is the next 04:00 UTC; the timer clears quotes, outbox and the demo clock; start is empty', () => {
  assert.equal(nextWipeAt(Date.UTC(2026, 9, 28, 3, 59)), Date.UTC(2026, 9, 28, 4));
  assert.equal(nextWipeAt(Date.UTC(2026, 9, 28, 4)), Date.UTC(2026, 9, 29, 4));
  assert.equal(nextWipeAt(Date.UTC(2026, 11, 31, 23)), Date.UTC(2027, 0, 1, 4));

  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 9, 28, 3, 59, 0) });
  try {
    const server = createAppServer({ publicDemo: true, schedulerMs: 0, env: {} });
    assert.equal(server.store.allQuotes().length, 0);
    server.store.putQuote({ id: 'q1', publicId: 'p1' });
    server.store.addOutbox({ id: 'm1' });
    server.clock.advance(86_400_000);
    mock.timers.tick(59_000);
    assert.equal(server.store.allQuotes().length, 1, 'not yet');
    mock.timers.tick(1_000);
    assert.equal(server.store.allQuotes().length, 0);
    assert.equal(server.store.listOutbox().length, 0);
    assert.equal(server.clock.offsetMs, 0);
    server.store.putQuote({ id: 'q2', publicId: 'p2' });
    mock.timers.tick(24 * 3600_000);
    assert.equal(server.store.allQuotes().length, 0, 'and again the next day');
    server.close();
  } finally { mock.timers.reset(); }
});

// ------------------------------------------------------------------ 5. ops
test('ops: security headers, HSTS behind HTTPS, /health, errors without details or stack traces, logs without user data', async () => {
  const t = await start();
  try {
    const res = await t.get('/', { 'X-Forwarded-Proto': 'https' });
    assert.equal(res.headers.get('strict-transport-security'), 'max-age=31536000');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal((await t.get('/')).headers.get('strict-transport-security'), null, 'plain HTTP: no HSTS');
    const health = await t.get('/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });

    const logs = [];
    const orig = console.error;
    console.error = (...a) => logs.push(a.join(' '));
    t.server.store.findByPublicId = () => { throw new Error('secret jordan@example.com detail'); };
    try {
      const boom = await t.get(`/api/review/AAAAAAAAAAAA/${'B'.repeat(43)}`);
      assert.equal(boom.status, 500);
      const text = await boom.text();
      assert.deepEqual(JSON.parse(text), { error: 'server_error', message: 'Something went wrong. Please try again.' });
      assert.ok(!/secret|at |\.js/.test(text));
    } finally { console.error = orig; }
    assert.equal(logs.length, 1);
    assert.ok(!logs[0].includes('jordan@example.com') && !logs[0].includes('secret'), logs[0]);
    assert.match(logs[0], /^api: Error /);
  } finally { await t.close(); }
});

test('ops: slow clients are cut off (request and header timeouts set, connections bounded)', async () => {
  const t = await start();
  try {
    assert.equal(t.server.requestTimeout, 20_000);
    assert.equal(t.server.headersTimeout, 10_000);
    assert.equal(t.server.maxConnections, DEMO_LIMITS.maxConnections);
  } finally { await t.close(); }
});
