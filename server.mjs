// Local server: serves public/ with a strict CSP, plus a small JSON API for
// emailed quotes (customer review links, follow-up reminders).
//
//   node server.mjs                 -> http://localhost:4174
//   TQB_DEMO=1 node server.mjs      -> demo mode: labelled mock outbox + time travel
//   DEMO_MODE=1 node server.mjs     -> public demo: demo mode, locked for the open internet
//   PORT=5000 node server.mjs
//
// /approve/<id> is the on-site approval page: it reads the quote from this
// browser's storage. /review/<publicId>/<token> is the emailed link: the quote
// snapshot is stored on this server (data/quotes.json, git-ignored).
// Email settings (env): TQB_EMAIL_PROVIDER=resend|smtp, TQB_EMAIL_FROM,
// RESEND_API_KEY or SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_SECURE,
// TQB_EMAIL_ALLOWLIST (real sends only go to these addresses), TQB_PUBLIC_URL.
//
// Public demo (DEMO_MODE=1, see server/public-demo.js): email settings are
// ignored (mock outbox only), storage is in memory and capped, requests are rate
// limited per client IP and globally (client IP: the TQB_CLIENT_IP_HEADER header,
// default X-Real-IP on Railway; else the right-most X-Forwarded-For hop,
// TQB_TRUST_PROXY_HOPS, default 1), everything is wiped on start and daily at 04:00 UTC,
// and every page carries a "public demo" banner. Review links use TQB_PUBLIC_URL
// or https://$RAILWAY_PUBLIC_DOMAIN, never the request's Host header.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createStore, createMemoryStore } from './server/store.js';
import { createMailer, emailConfigFromEnv, lockedEmailConfig } from './server/mailer.js';
import { createApi, createClock } from './server/api.js';
import { DAY } from './server/followups.js';
import {
  isPublicDemo, DEMO_LIMITS, BUSY_MESSAGE, createLimiters, clientIp, nextWipeAt, demoSession, withBanner, logError,
} from './server/public-demo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, 'public');
const port = Number(process.env.PORT) || 4174;

export const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: blob:", "font-src 'self'",
  "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon',
};

/**
 * @param {object} [opts]
 * @param {string} [opts.dataDir]   where emailed quotes and the demo outbox are stored
 * @param {boolean} [opts.demo]     demo mode: mock outbox + time travel (default TQB_DEMO=1)
 * @param {boolean} [opts.publicDemo] public demo lock (default DEMO_MODE=1); implies demo
 * @param {object} [opts.limits]    public demo limits (default DEMO_LIMITS; tests pass smaller ones)
 * @param {number} [opts.trustProxyHops] trusted X-Forwarded-For hops (public demo default 1, else 0)
 * @param {string|null} [opts.clientIpHeader] header the edge sets to the client IP (public demo on Railway: x-real-ip)
 * @param {() => number} [opts.realNow] wall clock for rate limits, link TTL and the wipe (tests)
 * @param {object} [opts.email]     email config (default from env); opts.emailDeps injects fetch/connect
 * @param {number} [opts.schedulerMs] follow-up check interval (default 60 s; 0 disables the timer)
 */
export function createAppServer(opts = {}) {
  const env = opts.env || process.env;
  const publicDemo = opts.publicDemo ?? isPublicDemo(env);
  const demo = publicDemo || (opts.demo ?? (env.TQB_DEMO === '1' || process.argv.includes('--demo')));
  const limits = publicDemo ? { ...DEMO_LIMITS, ...opts.limits } : null;
  const realNow = opts.realNow || Date.now;
  const store = publicDemo
    ? createMemoryStore({ maxQuotes: limits.maxQuotes, maxOutbox: limits.maxOutbox, maxBytes: limits.maxStoreBytes })
    : createStore(opts.dataDir || env.TQB_DATA_DIR || path.join(here, 'data'));
  const clock = createClock({ demo, maxOffsetMs: publicDemo ? limits.maxClockOffsetDays * DAY : Infinity });
  // The public demo never reads email settings, from env or from opts: the mock outbox is the only mailer.
  const emailCfg = publicDemo ? lockedEmailConfig() : (opts.email || emailConfigFromEnv(env, { demo }));
  let api;
  const mailer = createMailer(emailCfg, { ...opts.emailDeps, outbox: (msg) => api.outbox(msg) });
  const limiters = publicDemo ? createLimiters(limits, { now: realNow }) : null;
  const publicUrl = opts.publicUrl ?? (env.TQB_PUBLIC_URL || (publicDemo && env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : undefined));
  api = createApi({ store, mailer, clock, demo, publicUrl, publicDemo, limits: limits || undefined, limiters, realNow });
  const trustHops = opts.trustProxyHops ?? (publicDemo ? Number(env.TQB_TRUST_PROXY_HOPS ?? 1) : 0);
  const ipHeader = opts.clientIpHeader !== undefined ? opts.clientIpHeader
    : publicDemo ? (env.TQB_CLIENT_IP_HEADER || (env.RAILWAY_ENVIRONMENT_ID ? 'x-real-ip' : null)) : null;
  const ctx = { api, publicDemo, limiters, trustHops, ipHeader };

  const server = createServer((req, res) => {
    handle(req, res, ctx).catch((e) => {
      logError('request', e);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Something went wrong.');
      else res.destroy();
    });
  });
  // Slow or oversized clients can't hold the process: short timeouts, few headers, bounded connections.
  server.requestTimeout = 20_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 60;
  if (publicDemo) server.maxConnections = limits.maxConnections;

  const every = opts.schedulerMs ?? 60_000;
  const timer = every ? setInterval(() => { api.tick().catch((e) => logError('follow-up tick', e)); }, every) : null;
  timer?.unref();

  // Public demo data lifecycle: wiped on start, then daily at a fixed UTC hour.
  let wipeTimer = null;
  if (publicDemo) {
    api.wipe();
    const schedule = () => {
      const wait = Math.max(1000, nextWipeAt(Date.now(), limits.wipeHourUtc) - Date.now());
      wipeTimer = setTimeout(() => { api.wipe(); console.log('daily wipe done'); schedule(); }, wait);
      wipeTimer.unref();
    };
    if (opts.wipeSchedule !== false) schedule();
  }
  server.on('close', () => { clearInterval(timer); clearTimeout(wipeTimer); });
  Object.assign(server, { api, store, mailer, clock, demo, publicDemo, limits, limiters, ipHeader });
  return server;
}

function tooMany(res, headers, isApi, { status = 429, retryAfter, message = BUSY_MESSAGE }) {
  const h = { ...headers, ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}) };
  if (isApi) res.writeHead(status, { ...h, 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'busy', message }));
  else res.writeHead(status, { ...h, 'Content-Type': 'text/plain; charset=utf-8' }).end(message);
}

async function handle(req, res, { api, publicDemo, limiters, trustHops, ipHeader }) {
  const headers = {
    'Content-Security-Policy': CSP,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-Robots-Tag': 'noindex, nofollow',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cache-Control': 'no-store',
  };
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { url = new URL('/', 'http://x'); }
  const isApi = url.pathname.startsWith('/api/');

  if (publicDemo) {
    // Railway terminates TLS at its edge, so HTTPS shows up as X-Forwarded-Proto.
    if (req.headers['x-forwarded-proto'] === 'https') headers['Strict-Transport-Security'] = 'max-age=31536000';
    if (url.pathname !== '/health') {
      req.clientIp = clientIp(req, trustHops, ipHeader);
      let r = limiters.requests.hit(req.clientIp);
      if (!r.ok) return tooMany(res, headers, isApi, r);
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        r = limiters.writes.hit(req.clientIp);
        if (!r.ok) return tooMany(res, headers, isApi, r);
        r = limiters.globalWrites.hit('all');
        if (!r.ok) return tooMany(res, headers, isApi, { ...r, status: 503 });
      }
      const s = demoSession(req);
      req.demoSession = s.hash;
      if (s.setCookie) headers['Set-Cookie'] = s.setCookie;
    }
  }

  if (url.pathname === '/health') {
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405, { ...headers, Allow: 'GET, HEAD' }).end();
    return res.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }).end(req.method === 'HEAD' ? undefined : '{"ok":true}');
  }
  if (isApi) {
    await api.handle(req, res, url, headers);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...headers, Allow: 'GET, HEAD' }).end('Method not allowed');
    return;
  }
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { rel = '/'; }
  if (/^\/approve\/[A-Za-z0-9_-]{1,40}\/?$/.test(rel)) rel = '/approve.html';
  else if (/^\/review\/[A-Za-z0-9_-]{1,40}\/[A-Za-z0-9_-]{1,100}\/?$/.test(rel)) rel = '/review.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403, headers).end('Forbidden'); return; }
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    let body = await readFile(file);
    const ext = path.extname(file);
    if (publicDemo && ext === '.html') body = Buffer.from(withBanner(body.toString('utf8')));
    res.writeHead(200, { ...headers, 'Content-Type': TYPES[ext] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createAppServer();
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => {
    const email = server.mailer.mock ? 'mock outbox (demo, nothing is really sent)' : server.mailer.configured ? server.mailer.provider : 'not set up';
    const mode = server.publicDemo ? '  [PUBLIC DEMO]' : server.demo ? '  [DEMO MODE]' : '';
    console.log(`Trades Quote Builder running at http://localhost:${port}${mode}  email: ${email}  (Ctrl+C to stop)`);
  });
  // Graceful shutdown: stop accepting, let in-flight requests finish, then exit (forced after 8 s).
  let stopping = false;
  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: shutting down`);
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 8000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('unhandledRejection', (e) => logError('unhandledRejection', e));
}
