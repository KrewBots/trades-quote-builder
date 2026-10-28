// Public demo lock (DEMO_MODE=1): what changes when this server is open to
// anyone on the internet. Real email is impossible, every write is rate
// limited per client IP and globally, storage is in memory and capped, and all
// data is wiped daily. Everything here is pure or injectable so tests can drive it.
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { hashToken } from './tokens.js';

export const isPublicDemo = (env = process.env) => env.DEMO_MODE === '1' || env.TQB_PUBLIC_DEMO === '1';

export const MB = 1024 * 1024;
export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;

/** Limits for the public demo. Local/self-hosted mode keeps the original, roomier limits. */
export const DEMO_LIMITS = Object.freeze({
  maxBody: 1 * MB,                 // whole JSON request (logo and signature are JPEG data URLs inside it)
  maxImageChars: 400_000,          // one logo or signature data URL
  maxImageSide: 2000,              // px, either side
  logoFileBytes: 1 * MB,           // client-side check before re-encoding
  maxItems: 50,                    // line items per quote
  maxQuotes: 300,                  // stored emailed quotes, oldest evicted
  maxOutbox: 300,                  // stored mock emails, oldest evicted
  maxStoreBytes: 50 * MB,          // quotes + outbox together, oldest evicted
  linkTtlMs: 24 * HOUR,            // review links stop working after this (real time)
  maxClockOffsetDays: 30,          // demo clock can't run further ahead than this
  wipeHourUtc: 4,                  // daily wipe at 04:00 UTC
  // Rate limits: [max, windowMs]
  requests: [240, MINUTE],         // everything (pages, assets, API) per IP
  writes: [20, 5 * MINUTE],        // POSTs per IP
  globalWrites: [600, HOUR],       // POSTs from everyone
  tokenFailures: [20, 10 * MINUTE], // wrong review links / owner keys per IP
  maxConnections: 256,
});

export const BUSY_MESSAGE = 'The demo is busy right now. Please try again in a few minutes.';

/**
 * Fixed-window counter keyed by IP (or 'all'). Memory is bounded: expired
 * windows are pruned and, past maxKeys, the oldest keys are dropped.
 */
export function createRateLimiter({ max, windowMs, maxKeys = 10_000, now = Date.now }) {
  const hits = new Map(); // key -> { start, count }
  function entry(key) {
    const t = now();
    let e = hits.get(key);
    if (!e || t - e.start >= windowMs) {
      if (e) hits.delete(key);
      e = { start: t, count: 0 };
      if (hits.size >= maxKeys) prune(t);
      hits.set(key, e);
    }
    return e;
  }
  function prune(t) {
    for (const [k, e] of hits) if (t - e.start >= windowMs) hits.delete(k);
    while (hits.size >= maxKeys) hits.delete(hits.keys().next().value);
  }
  const retryAfter = (e) => Math.max(1, Math.ceil((e.start + windowMs - now()) / 1000));
  return {
    /** Count one hit; ok=false once the window's max is used up. */
    hit(key) {
      const e = entry(key);
      e.count++;
      return e.count <= max ? { ok: true } : { ok: false, retryAfter: retryAfter(e) };
    },
    /** Is this key over the limit, without counting a hit? */
    blocked(key) {
      const e = hits.get(key);
      if (!e || now() - e.start >= windowMs || e.count < max) return null;
      return { retryAfter: retryAfter(e) };
    },
    get size() { return hits.size; },
  };
}

export function createLimiters(limits = DEMO_LIMITS, { now = Date.now } = {}) {
  const make = ([max, windowMs]) => createRateLimiter({ max, windowMs, now });
  return {
    requests: make(limits.requests),
    writes: make(limits.writes),
    globalWrites: make(limits.globalWrites),
    tokenFailures: make(limits.tokenFailures),
  };
}

/**
 * The client IP.
 * - ipHeader (e.g. 'x-real-ip'): a header the platform's edge sets to the client
 *   address itself. Railway documents X-Real-IP for this and does not append to
 *   X-Forwarded-For, so on Railway this is the only trustworthy source.
 * - Otherwise, behind `trustHops` proxies that append to X-Forwarded-For, the
 *   right-most `trustHops` entry; anything to its left is client-supplied.
 * - trustHops=0 and no header (local): the socket address.
 */
export function clientIp(req, trustHops = 0, ipHeader = null) {
  const socketIp = req.socket?.remoteAddress || 'unknown';
  if (ipHeader) {
    const v = String(req.headers[ipHeader.toLowerCase()] || '').trim();
    return isIP(v) ? v : socketIp;
  }
  if (!trustHops) return socketIp;
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ip = xff[xff.length - trustHops];
  return ip && isIP(ip) ? ip : socketIp;
}

/** Next wipe time (epoch ms) strictly after `now`, at hourUtc:00 UTC. */
export function nextWipeAt(now, hourUtc = DEMO_LIMITS.wipeHourUtc) {
  const d = new Date(now);
  const at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hourUtc);
  return at > now ? at : at + 24 * HOUR;
}

// ------------------------------------------------------------------ visitor session
// Each browser gets a random demo session cookie, so the mock Outbox only lists
// the emails that browser "sent". Visitors never see each other's quotes.
const COOKIE = 'tqb_demo';
const SID_RE = /^[A-Za-z0-9_-]{43}$/;

export function demoSession(req) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.cookie || '');
  const sid = m && SID_RE.test(m[1]) ? m[1] : null;
  if (sid) return { hash: hashToken(sid), setCookie: null };
  const fresh = randomBytes(32).toString('base64url');
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return { hash: hashToken(fresh), setCookie: `${COOKIE}=${fresh}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax${secure}` };
}

// ------------------------------------------------------------------ banner
export const BANNER_TEXT = 'Public demo: data is wiped daily. Don\'t enter real customer info. Not a real business: never pay or enter card details.';
export const BANNER_HTML = `<div class="demo-banner" role="note" data-testid="demo-banner"><b>Public demo:</b> data is wiped daily. Don't enter real customer info. Not a real business: never pay or enter card details.</div>`;

/** Insert the banner as the first thing in <body>. */
export function withBanner(html) {
  return String(html).replace(/<body([^>]*)>/i, (m) => `${m}\n  ${BANNER_HTML}`);
}

/** Log an error without its message (which can carry user input), only where it happened. */
export function logError(where, e) {
  const frames = String(e?.stack || '').split('\n').slice(1, 4).map((s) => s.trim()).join(' | ');
  console.error(`${where}: ${e?.name || 'Error'}${e?.code ? ` (${e.code})` : ''} ${frames}`);
}
