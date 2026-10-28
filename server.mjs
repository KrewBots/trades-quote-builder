// Local server: serves public/ with a strict CSP, plus a small JSON API for
// emailed quotes (customer review links, follow-up reminders).
//
//   node server.mjs                 -> http://localhost:4174
//   TQB_DEMO=1 node server.mjs      -> demo mode: labelled mock outbox + time travel
//   PORT=5000 node server.mjs
//
// /approve/<id> is the on-site approval page: it reads the quote from this
// browser's storage. /review/<publicId>/<token> is the emailed link: the quote
// snapshot is stored on this server (data/quotes.json, git-ignored).
// Email settings (env): TQB_EMAIL_PROVIDER=resend|smtp, TQB_EMAIL_FROM,
// RESEND_API_KEY or SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_SECURE,
// TQB_EMAIL_ALLOWLIST (real sends only go to these addresses), TQB_PUBLIC_URL.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createStore } from './server/store.js';
import { createMailer, emailConfigFromEnv } from './server/mailer.js';
import { createApi, createClock } from './server/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, 'public');
const port = Number(process.env.PORT) || 4174;
const host = process.env.HOST || '127.0.0.1';

export const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: blob:", "font-src 'self'",
  "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon',
};

/**
 * @param {object} [opts]
 * @param {string} [opts.dataDir]   where emailed quotes and the demo outbox are stored
 * @param {boolean} [opts.demo]     demo mode: mock outbox + time travel (default TQB_DEMO=1)
 * @param {object} [opts.email]     email config (default from env); opts.emailDeps injects fetch/connect
 * @param {number} [opts.schedulerMs] follow-up check interval (default 60 s; 0 disables the timer)
 */
export function createAppServer(opts = {}) {
  const demo = opts.demo ?? (process.env.TQB_DEMO === '1' || process.argv.includes('--demo'));
  const store = createStore(opts.dataDir || process.env.TQB_DATA_DIR || path.join(here, 'data'));
  const clock = createClock({ demo });
  let api;
  const mailer = createMailer(opts.email || emailConfigFromEnv(process.env, { demo }), { ...opts.emailDeps, outbox: (msg) => api.outbox(msg) });
  api = createApi({ store, mailer, clock, demo, publicUrl: opts.publicUrl ?? process.env.TQB_PUBLIC_URL });
  const server = createServer((req, res) => handle(req, res, api));
  const every = opts.schedulerMs ?? 60_000;
  const timer = every ? setInterval(() => { api.tick().catch((e) => console.error('follow-up tick failed:', e)); }, every) : null;
  timer?.unref();
  server.on('close', () => clearInterval(timer));
  Object.assign(server, { api, store, mailer, clock, demo });
  return server;
}

async function handle(req, res, api) {
  const headers = {
    'Content-Security-Policy': CSP,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cache-Control': 'no-store',
  };
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { url = new URL('/', 'http://x'); }
  if (url.pathname.startsWith('/api/')) {
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
    const body = await readFile(file);
    res.writeHead(200, { ...headers, 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createAppServer();
  server.listen(port, host, () => {
    const email = server.mailer.mock ? 'mock outbox (demo, nothing is really sent)' : server.mailer.configured ? server.mailer.provider : 'not set up';
    console.log(`Trades Quote Builder running at http://localhost:${port}${server.demo ? '  [DEMO MODE]' : ''}  email: ${email}  (Ctrl+C to stop)`);
  });
}
