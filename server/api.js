// JSON API for emailed quotes, the customer review link, follow-up reminders,
// the demo mock outbox and demo time travel.
import { randomBytes } from 'node:crypto';
import { newToken, newPublicId, isPublicId, hashToken, tokenMatches, checkLink, expiryFor } from './tokens.js';
import { newFollowUps, normaliseDays, followUpPlan, followUpSchedule, stopFollowUps, DEFAULT_DAYS, DAY } from './followups.js';
import { isEmail, EmailNotConfigured, RecipientNotAllowed } from './mailer.js';
import { quoteEmail } from './email-templates.js';
import { buildQuotePdf } from '../public/lib/quote-pdf.js';
import { quoteTotals } from '../public/lib/pricing.js';
import { jpegFromDataUrl, jpegSize } from '../public/lib/pdf-writer.js';
import { logError } from './public-demo.js';

// Self-hosted defaults. The public demo passes tighter ones (server/public-demo.js DEMO_LIMITS).
const LOCAL_LIMITS = { maxBody: 2 * 1024 * 1024, maxImageChars: 400000, maxImageSide: 10000, maxItems: 200, linkTtlMs: 0 };
const EMAIL_PREVIEW_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

export function createClock({ demo = false, maxOffsetMs = Infinity } = {}) {
  let offset = 0;
  return {
    now: () => Date.now() + offset,
    get offsetMs() { return offset; },
    advance(ms) {
      if (!demo) throw new Error('Time travel is only available in demo mode');
      if (offset + ms > maxOffsetMs) throw new HttpError(409, 'clock_limit', `The demo clock can't go more than ${Math.round(maxOffsetMs / DAY)} days ahead. Press Reset first.`);
      offset += ms;
    },
    reset() { offset = 0; },
  };
}

export class HttpError extends Error {
  constructor(status, code, message, retryAfter) { super(message || code); this.status = status; this.code = code; this.retryAfter = retryAfter; }
}

function json(res, status, body, headers) {
  res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
}

async function readJson(req, maxBody) {
  if (!/^application\/json\b/.test(req.headers['content-type'] || '')) throw new HttpError(415, 'json_required');
  const tooLarge = () => new HttpError(413, 'too_large', `That's too big to send (max ${Math.round(maxBody / 1024)} KB). Try a smaller logo.`);
  if (Number(req.headers['content-length']) > maxBody) throw tooLarge();
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > maxBody) throw tooLarge();
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'bad_json'); }
}

/** Reject cross-site requests to state-changing endpoints. */
function assertSameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'cross_site');
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) throw new HttpError(403, 'cross_site');
}

const clean = (s, max) => String(s ?? '').slice(0, max);

/** A JPEG data URL within the size limits, or null. */
export function validImage(url, limits) {
  if (typeof url !== 'string' || url.length > limits.maxImageChars) return null;
  const bin = jpegFromDataUrl(url);
  const dims = bin && jpegSize(bin);
  if (!dims || !dims.width || !dims.height || dims.width > limits.maxImageSide || dims.height > limits.maxImageSide) return null;
  return url;
}

/** Keep only the quote/business fields the server needs, size-limited. */
function snapshotFrom(body, limits) {
  const q = body.quote || {};
  const b = body.business || {};
  if (typeof q.id !== 'string' || !/^[a-z0-9]{1,40}$/i.test(q.id)) throw new HttpError(400, 'bad_quote');
  if (!Array.isArray(q.items) || !q.items.length) throw new HttpError(400, 'no_items', 'Add at least one line item first.');
  if (q.items.length > limits.maxItems) throw new HttpError(400, 'too_many_items', `A quote can have at most ${limits.maxItems} line items here.`);
  if (Number.isNaN(new Date(q.createdAt).getTime())) throw new HttpError(400, 'bad_quote');
  const quote = {
    id: q.id, number: clean(q.number, 20), trade: q.trade === 'electrical' ? 'electrical' : 'plumbing', createdAt: new Date(q.createdAt).toISOString(),
    client: { name: clean(q.client?.name, 120), phone: clean(q.client?.phone, 60), email: clean(q.client?.email, 254), address: clean(q.client?.address, 200) },
    jobTitle: clean(q.jobTitle, 160), description: clean(q.description, 2000),
    items: q.items.map((i) => ({ name: clean(i.name, 160), hours: Number(i.hours) || 0, parts: Number(i.parts) || 0, qty: Number(i.qty) || 0 })),
    laborRate: Number(q.laborRate) || 0, markup: Number(q.markup) || 0, tax: Number(q.tax) || 0, taxOn: q.taxOn === 'parts' ? 'parts' : 'all',
    validDays: Number(q.validDays) || 0, terms: clean(q.terms, 4000), status: 'sent', approval: null,
  };
  const business = {
    name: clean(b.name, 120), license: clean(b.license, 120), phone: clean(b.phone, 60), email: clean(b.email, 254), address: clean(b.address, 200),
    logo: validImage(b.logo, limits) || '',
  };
  return { quote, business };
}

const DAY_MS = DAY;

const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/;

/**
 * @param ctx { store, mailer, clock, demo, publicUrl, publicDemo, limits, limiters, realNow }
 *   publicDemo: per-visitor outbox (req.demoSession), review links expire after limits.linkTtlMs of
 *   real time, review links never use the request's Host header, and wrong tokens/owner keys are
 *   counted per IP (req.clientIp) in limiters.tokenFailures.
 */
export function createApi(ctx) {
  const { store, mailer, clock, demo, publicDemo = false, limiters } = ctx;
  const limits = { ...LOCAL_LIMITS, ...ctx.limits };
  const realNow = ctx.realNow || Date.now;
  const nowIso = () => new Date(clock.now()).toISOString();

  /** Brute-force guard around every token / owner-key check. */
  function tokenGate(req) {
    const b = limiters?.tokenFailures.blocked(req.clientIp);
    if (b) throw new HttpError(429, 'too_many_attempts', 'Too many wrong links from this connection. Please try again later.', b.retryAfter);
  }
  function tokenFailed(req) {
    limiters?.tokenFailures.hit(req.clientIp);
  }

  function ownerRecord(req, id) {
    tokenGate(req);
    const rec = store.getQuote(id);
    if (!rec || !tokenMatches(req.headers['x-owner-key'], rec.ownerKeyHash)) { tokenFailed(req); throw new HttpError(404, 'not_found'); }
    return rec;
  }

  function baseUrlFor(req) {
    if (ctx.publicUrl) return ctx.publicUrl.replace(/\/+$/, '');
    // A public server must not build links from the Host header (anyone can send any Host).
    if (publicDemo && !LOOPBACK_HOST.test(req.headers.host || '')) throw new HttpError(503, 'not_configured', 'This demo server has no public address set.');
    return `http://${req.headers.host}`;
  }

  function statusView(rec) {
    const plan = followUpPlan(rec, clock.now());
    return {
      id: rec.id, status: rec.status, to: rec.to, sentAt: rec.sentAt, expiresAt: rec.expiresAt,
      expired: clock.now() > Date.parse(rec.expiresAt),
      approval: rec.approval, decline: rec.decline,
      followUps: {
        enabled: rec.followUps.enabled, days: rec.followUps.days,
        sent: rec.followUps.sent.map((s) => ({ day: s.day, n: s.n, at: s.at })),
        next: plan.next ? new Date(plan.next.at).toISOString() : null, nextN: plan.next?.n ?? null,
        stopped: plan.stopped, stoppedAt: rec.followUps.stoppedAt,
        schedule: followUpSchedule(rec, clock.now()),
      },
      now: nowIso(),
    };
  }

  function pdfFor(rec) {
    const quote = { ...rec.snapshot.quote, status: rec.status === 'approved' ? 'approved' : 'sent', approval: rec.approval };
    return buildQuotePdf({ quote, business: rec.snapshot.business });
  }

  async function sendQuoteEmail(rec, link, kind, n) {
    const { subject, html, text } = quoteEmail(rec.snapshot, { link, kind, n });
    const pdf = pdfFor(rec);
    return mailer.send({
      to: rec.to, subject, html, text, replyTo: rec.snapshot.business.email,
      attachments: [{ filename: pdf.filename, content: Buffer.from(pdf.bytes), contentType: 'application/pdf' }],
      meta: { quoteId: rec.id, number: rec.snapshot.quote.number, kind, n, link, session: rec.session || null },
    });
  }

  // ---------------------------------------------------------------- scheduler
  let ticking = false;
  async function tick() {
    if (ticking) return [];
    ticking = true;
    const fired = [];
    try {
      for (const rec of store.allQuotes()) {
        const plan = followUpPlan(rec, clock.now());
        if (plan.skip.length) rec.followUps.skipped.push(...plan.skip);
        if (plan.due) {
          try {
            // Reminders reuse the stored link path; the token is only known to the email, so mint a fresh
            // one for each reminder and accept any of them (older links keep working until expiry).
            const token = newToken();
            rec.extraTokenHashes = [...(rec.extraTokenHashes || []), hashToken(token)].slice(-10);
            const link = `${rec.baseUrl}/review/${rec.publicId}/${token}`;
            const sent = await sendQuoteEmail(rec, link, 'followup', plan.due.n);
            rec.followUps.sent.push({ day: plan.due.day, n: plan.due.n, at: nowIso(), emailId: sent.id });
            fired.push({ id: rec.id, n: plan.due.n });
          } catch (e) {
            rec.followUps.lastError = `${nowIso()}: ${e.message}`;
            if (publicDemo) logError('follow-up', e);
          }
        }
        if (plan.skip.length || plan.due) store.putQuote(rec);
      }
    } finally {
      ticking = false;
    }
    return fired;
  }

  /** Token check that also accepts the per-reminder links. */
  function linkState(rec, token) {
    let state = checkLink(rec, token, clock.now());
    if (state === 'invalid' && rec) {
      const ok = (rec.extraTokenHashes || []).some((h) => tokenMatches(token, h));
      if (!ok) return 'invalid';
      state = clock.now() > Date.parse(rec.expiresAt) ? 'expired' : 'ok';
    }
    // Public demo: links also stop working after a fixed real-time TTL, whatever the demo clock says.
    if (state === 'ok' && rec.linkExpiresAtReal && realNow() > rec.linkExpiresAtReal) return 'expired';
    return state;
  }

  function reviewRecord(req, pid, token) {
    tokenGate(req);
    const rec = isPublicId(pid) ? store.findByPublicId(pid) : null;
    const state = linkState(rec, token);
    if (state === 'invalid') { tokenFailed(req); throw new HttpError(404, 'not_found', 'This link is not valid.'); }
    return { rec, expired: state === 'expired' };
  }

  /** Public demo: a visitor only sees the mock emails their own browser sent. */
  const visibleTo = (req) => (e) => !publicDemo || (!!e.meta?.session && e.meta.session === req.demoSession);

  // ---------------------------------------------------------------- routes
  async function handle(req, res, url, headers) {
    const p = url.pathname;
    const m = (re) => re.exec(p);
    let r;
    try {
      if (p === '/api/config' && req.method === 'GET') {
        return json(res, 200, {
          demo,
          publicDemo,
          ...(publicDemo ? { limits: { maxItems: limits.maxItems, logoFileBytes: limits.logoFileBytes, maxBody: limits.maxBody } } : {}),
          email: { configured: mailer.configured, provider: mailer.provider, mock: mailer.mock, reason: mailer.reason },
          followUpDefaults: DEFAULT_DAYS,
          now: nowIso(),
        }, headers);
      }

      if (p === '/api/quotes/send' && req.method === 'POST') {
        assertSameOrigin(req);
        const body = await readJson(req, limits.maxBody);
        if (!mailer.configured) throw new HttpError(409, 'email_not_configured', mailer.reason);
        const to = String(body.to || '').trim();
        if (!isEmail(to)) throw new HttpError(400, 'bad_email', 'Enter the customer\'s email address.');
        const snapshot = snapshotFrom(body, limits);
        const existing = store.getQuote(snapshot.quote.id);
        if (existing) {
          tokenGate(req);
          if (!tokenMatches(req.headers['x-owner-key'], existing.ownerKeyHash)) { tokenFailed(req); throw new HttpError(409, 'quote_exists'); }
          if (existing.status !== 'sent') throw new HttpError(409, 'finalised', `This quote was already ${existing.status}.`);
        }
        const expiresAt = expiryFor(snapshot.quote);
        if (!(expiresAt > clock.now())) throw new HttpError(422, 'expired', 'This quote has expired. Increase "valid for" days first.');
        const token = newToken();
        const ownerKey = existing ? null : newToken();
        const baseUrl = baseUrlFor(req);
        const rec = {
          id: snapshot.quote.id,
          publicId: existing?.publicId || newPublicId(),
          tokenHash: hashToken(token),
          extraTokenHashes: [],
          ownerKeyHash: existing ? existing.ownerKeyHash : hashToken(ownerKey),
          baseUrl, snapshot, to, status: 'sent', sentAt: nowIso(), expiresAt: new Date(expiresAt).toISOString(),
          followUps: newFollowUps({ enabled: body.followUps?.enabled !== false, days: body.followUps?.days ?? DEFAULT_DAYS }),
          approval: null, decline: null,
          ...(publicDemo ? { session: req.demoSession || null, linkExpiresAtReal: realNow() + limits.linkTtlMs } : {}),
        };
        const link = `${baseUrl}/review/${rec.publicId}/${token}`;
        try {
          await sendQuoteEmail(rec, link, 'quote', 0);
        } catch (e) {
          if (e instanceof EmailNotConfigured) throw new HttpError(409, 'email_not_configured', e.message);
          if (e instanceof RecipientNotAllowed) throw new HttpError(403, 'recipient_not_allowed', e.message);
          if (e instanceof HttpError) throw e;
          throw new HttpError(502, 'send_failed', publicDemo ? 'Sending failed. Please try again.' : e.message);
        }
        store.putQuote(rec);
        return json(res, 200, { ok: true, ownerKey, link, mock: mailer.mock, ...statusView(rec) }, headers);
      }

      if ((r = m(/^\/api\/quotes\/([a-z0-9]{1,40})\/status$/i)) && req.method === 'GET') {
        return json(res, 200, statusView(ownerRecord(req, r[1])), headers);
      }

      if ((r = m(/^\/api\/quotes\/([a-z0-9]{1,40})\/followups$/i)) && req.method === 'POST') {
        assertSameOrigin(req);
        const rec = ownerRecord(req, r[1]);
        const body = await readJson(req, limits.maxBody);
        if (rec.status !== 'sent') throw new HttpError(409, 'finalised', `Follow-ups stopped: the quote was ${rec.status}.`);
        if (typeof body.enabled === 'boolean') rec.followUps.enabled = body.enabled;
        if (body.days !== undefined) {
          const days = normaliseDays(body.days);
          if (!days.length) throw new HttpError(400, 'bad_days', 'Enter reminder days between 1 and 60, e.g. "2, 5".');
          rec.followUps.days = days;
        }
        store.putQuote(rec);
        return json(res, 200, statusView(rec), headers);
      }

      if ((r = m(/^\/api\/review\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/)) && req.method === 'GET') {
        const { rec, expired } = reviewRecord(req, r[1], r[2]);
        return json(res, 200, {
          quote: { ...rec.snapshot.quote, status: rec.status, approval: rec.approval },
          business: rec.snapshot.business, status: rec.status, approval: rec.approval, decline: rec.decline,
          expired, expiresAt: rec.expiresAt,
        }, headers);
      }

      if ((r = m(/^\/api\/review\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/(approve|decline)$/)) && req.method === 'POST') {
        assertSameOrigin(req);
        const { rec, expired } = reviewRecord(req, r[1], r[2]);
        const body = await readJson(req, limits.maxBody);
        if (expired) throw new HttpError(410, 'expired', 'This quote has expired. Ask your contractor for an updated quote.');
        if (rec.status !== 'sent') throw new HttpError(409, 'finalised', `This quote was already ${rec.status}.`);
        if (r[3] === 'approve') {
          const name = String(body.name || '').trim();
          if (name.length < 2 || name.length > 100) throw new HttpError(400, 'bad_name', 'Please enter your full name.');
          if (!['drawn', 'typed'].includes(body.method)) throw new HttpError(400, 'bad_method');
          if (!validImage(body.signature, limits)) throw new HttpError(400, 'bad_signature', 'Please sign before approving.');
          rec.status = 'approved';
          rec.approval = { name, method: body.method, signature: body.signature, signedAt: nowIso(), total: quoteTotals(rec.snapshot.quote.items, rec.snapshot.quote).total };
        } else {
          rec.status = 'declined';
          rec.decline = { at: nowIso(), reason: clean(body.reason, 500).trim() };
        }
        stopFollowUps(rec, rec.status, nowIso());
        store.putQuote(rec);
        return json(res, 200, { ok: true, status: rec.status, approval: rec.approval, decline: rec.decline }, headers);
      }

      if ((r = m(/^\/api\/review\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/pdf$/)) && req.method === 'GET') {
        const { rec } = reviewRecord(req, r[1], r[2]);
        const pdf = pdfFor(rec);
        res.writeHead(200, { ...headers, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${safeFilename(pdf.filename)}"` });
        return res.end(Buffer.from(pdf.bytes));
      }

      // ---- demo-only: mock outbox and time travel
      if (p.startsWith('/api/outbox') || p.startsWith('/api/demo/')) {
        if (!demo) throw new HttpError(404, 'not_found');
      }
      if (p === '/api/outbox' && req.method === 'GET') {
        if (!mailer.mock) throw new HttpError(404, 'not_found');
        return json(res, 200, {
          mock: true,
          emails: store.listOutbox().filter(visibleTo(req)).map((e) => ({ id: e.id, to: e.to, from: e.from, subject: e.subject, at: e.at, kind: e.meta?.kind, n: e.meta?.n, number: e.meta?.number, quoteId: e.meta?.quoteId, link: e.meta?.link, attachments: e.attachments.map((a) => a.filename) })).reverse(),
        }, headers);
      }
      if ((r = m(/^\/api\/outbox\/([a-f0-9]{16})\/html$/)) && req.method === 'GET') {
        const e = store.getOutbox(r[1]);
        if (!e || !visibleTo(req)(e)) throw new HttpError(404, 'not_found');
        res.writeHead(200, { ...headers, 'Content-Security-Policy': EMAIL_PREVIEW_CSP, 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(e.html);
      }
      if ((r = m(/^\/api\/outbox\/([a-f0-9]{16})\/attachment\/(\d)$/)) && req.method === 'GET') {
        const e = store.getOutbox(r[1]);
        const a = e && visibleTo(req)(e) ? e.attachments[Number(r[2])] : null;
        if (!a) throw new HttpError(404, 'not_found');
        res.writeHead(200, { ...headers, 'Content-Type': a.contentType, 'Content-Disposition': `attachment; filename="${safeFilename(a.filename)}"` });
        return res.end(Buffer.from(a.content, 'base64'));
      }
      if (p === '/api/demo/clock' && req.method === 'GET') return json(res, 200, { now: nowIso(), offsetDays: clock.offsetMs / DAY_MS }, headers);
      if (p === '/api/demo/clock' && req.method === 'POST') {
        assertSameOrigin(req);
        const body = await readJson(req, limits.maxBody);
        if (body.reset) clock.reset();
        else {
          const days = Number(body.advanceDays);
          if (!Number.isFinite(days) || days <= 0 || days > 60) throw new HttpError(400, 'bad_days');
          clock.advance(days * DAY_MS);
        }
        const fired = await tick();
        return json(res, 200, { now: nowIso(), offsetDays: clock.offsetMs / DAY_MS, fired }, headers);
      }

      if (p.startsWith('/api/')) throw new HttpError(404, 'not_found');
      return false;
    } catch (e) {
      if (e instanceof HttpError) {
        return json(res, e.status, { error: e.code, message: e.message }, e.retryAfter ? { ...headers, 'Retry-After': String(e.retryAfter) } : headers);
      }
      if (publicDemo) logError('api', e); else console.error(e);
      if (res.headersSent) return res.destroy();
      return json(res, 500, { error: 'server_error', message: 'Something went wrong. Please try again.' }, headers);
    }
  }

  /** Mock-provider sink: stores the exact message in the outbox. */
  function outbox(msg) {
    const id = randomBytes(8).toString('hex');
    store.addOutbox({
      id, at: nowIso(), to: msg.to, from: msg.from, subject: msg.subject, html: msg.html, text: msg.text, meta: msg.meta,
      attachments: (msg.attachments || []).map((a) => ({ filename: a.filename, contentType: a.contentType, content: Buffer.from(a.content).toString('base64') })),
    });
    return id;
  }

  /** Public demo daily reset: every quote, mock email and the demo clock. */
  function wipe() {
    store.wipe();
    clock.reset();
  }

  return { handle, tick, outbox, wipe };
}

const safeFilename = (name) => String(name).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80) || 'quote.pdf';
