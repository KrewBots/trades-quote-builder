// Pluggable email sending: a labelled mock outbox (demo/test mode only), the
// Resend HTTP API, or SMTP. Real providers only ever send to addresses on the
// TQB_EMAIL_ALLOWLIST; with no allowlist they refuse to send at all. With no
// provider configured, nothing pretends to send.
import net from 'node:net';
import tls from 'node:tls';
import { randomBytes } from 'node:crypto';

export class EmailNotConfigured extends Error {
  constructor(reason) { super(reason); this.code = 'email_not_configured'; }
}
export class RecipientNotAllowed extends Error {
  constructor(to) { super(`Refusing to email ${to}: not on TQB_EMAIL_ALLOWLIST.`); this.code = 'recipient_not_allowed'; }
}

const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;
export const isEmail = (s) => typeof s === 'string' && s.length <= 254 && EMAIL_RE.test(s);
const norm = (s) => String(s || '').trim().toLowerCase();

export function parseAllowlist(value) {
  return String(value || '').split(',').map(norm).filter(isEmail);
}

/** The guard: real sends only to an exact, allowlisted address. */
export function assertAllowed(to, allowlist) {
  const t = norm(to);
  if (!isEmail(t) || !allowlist.includes(t)) throw new RecipientNotAllowed(to);
}

/** Bare address from "Name <addr@example.com>" or "addr@example.com". */
export function addressOf(from) {
  const m = /<([^<>]+)>\s*$/.exec(String(from || ''));
  return (m ? m[1] : String(from || '')).trim();
}

/**
 * The public demo's email config: the mock outbox, always. Provider, key, SMTP
 * and allowlist settings are not read at all, so no env var can turn real email on.
 */
export function lockedEmailConfig() {
  return { provider: 'mock', demo: true, locked: true, from: '', resendKey: '', smtp: { host: '', port: 0, secure: false, user: '', pass: '' }, allowlist: [] };
}

export function emailConfigFromEnv(env = process.env, { demo = false, publicDemo = false } = {}) {
  if (publicDemo) return lockedEmailConfig();
  return {
    provider: (env.TQB_EMAIL_PROVIDER || (demo ? 'mock' : '')).toLowerCase(),
    demo,
    from: env.TQB_EMAIL_FROM || '',
    resendKey: env.RESEND_API_KEY || '',
    smtp: {
      host: env.SMTP_HOST || '',
      port: Number(env.SMTP_PORT) || (env.SMTP_SECURE === 'true' ? 465 : 587),
      secure: env.SMTP_SECURE === 'true',
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
    },
    allowlist: parseAllowlist(env.TQB_EMAIL_ALLOWLIST),
  };
}

/**
 * @param cfg  from emailConfigFromEnv
 * @param deps { fetchImpl, connect, outbox(msg) -> id }  (injected so tests never touch the network)
 */
export function createMailer(cfg, deps = {}) {
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const base = { provider: cfg.provider || 'none', from: cfg.from, mock: false, configured: false, reason: "Email isn't set up." };

  if (cfg.locked || cfg.provider === 'mock') {
    if (!cfg.demo && !cfg.locked) return { ...base, provider: 'none', reason: "Email isn't set up. (The mock outbox only runs in demo mode.)", send: notConfigured };
    const from = (!cfg.locked && cfg.from) || 'Quote Builder demo <demo@example.invalid>';
    return {
      ...base, provider: 'mock', configured: true, mock: true, locked: !!cfg.locked, reason: '', from,
      async send(msg) {
        return { id: deps.outbox({ ...msg, from }), provider: 'mock' };
      },
    };
  }

  const missing = [];
  if (cfg.provider === 'resend' && !cfg.resendKey) missing.push('RESEND_API_KEY');
  if (cfg.provider === 'smtp' && !cfg.smtp.host) missing.push('SMTP_HOST');
  if ((cfg.provider === 'resend' || cfg.provider === 'smtp') && !isEmail(addressOf(cfg.from))) missing.push('TQB_EMAIL_FROM');
  if ((cfg.provider === 'resend' || cfg.provider === 'smtp') && !cfg.allowlist.length) missing.push('TQB_EMAIL_ALLOWLIST');
  if (!['resend', 'smtp'].includes(cfg.provider) || missing.length) {
    return { ...base, reason: missing.length ? `Email isn't set up: missing ${missing.join(', ')}.` : base.reason, send: notConfigured };
  }

  const ready = { ...base, configured: true, reason: '' };
  if (cfg.provider === 'resend') {
    return {
      ...ready,
      async send(msg) {
        assertAllowed(msg.to, cfg.allowlist);
        const res = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${cfg.resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: cfg.from,
            to: [msg.to],
            subject: msg.subject,
            html: msg.html,
            text: msg.text,
            ...(isEmail(msg.replyTo) ? { reply_to: msg.replyTo } : {}),
            attachments: (msg.attachments || []).map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString('base64') })),
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`Resend refused the email (${res.status}): ${body.message || body.name || 'unknown error'}`);
        return { id: body.id, provider: 'resend' };
      },
    };
  }
  return {
    ...ready,
    async send(msg) {
      assertAllowed(msg.to, cfg.allowlist);
      const raw = buildMime({ ...msg, from: cfg.from });
      await smtpSend({ ...cfg.smtp, from: addressOf(cfg.from), to: msg.to, raw, connect: deps.connect });
      return { id: null, provider: 'smtp' };
    },
  };
}

async function notConfigured() {
  throw new EmailNotConfigured("Email isn't set up.");
}

// ------------------------------------------------------------------ MIME
const header = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const b64lines = (buf) => Buffer.from(buf).toString('base64').replace(/.{1,76}/g, '$&\r\n');

export function buildMime({ from, to, subject, html, text, replyTo, attachments = [], date = new Date(), boundary = randomBytes(12).toString('hex') }) {
  const mixed = `mixed-${boundary}`;
  const alt = `alt-${boundary}`;
  const domain = addressOf(from).split('@')[1] || 'localhost';
  const lines = [
    `From: ${header(from)}`,
    `To: ${header(to)}`,
    ...(isEmail(replyTo) ? [`Reply-To: ${header(replyTo)}`] : []),
    `Subject: ${encWord(header(subject))}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    '',
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64lines(Buffer.from(text || '', 'utf8')),
    `--${alt}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64lines(Buffer.from(html || '', 'utf8')),
    `--${alt}--`,
    '',
  ];
  for (const a of attachments) {
    const name = header(a.filename).replace(/"/g, '');
    lines.push(`--${mixed}`, `Content-Type: ${a.contentType || 'application/octet-stream'}; name="${name}"`,
      'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${name}"`, '', b64lines(a.content));
  }
  lines.push(`--${mixed}--`, '');
  return lines.join('\r\n');
}

// ------------------------------------------------------------------ SMTP
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** SMTP reply reader over a socket: resolves {code, lines} per complete (multi-line) reply. */
function replies(socket) {
  let buf = '';
  const queue = [];
  const waiting = [];
  let failure = null;
  const push = (r) => (waiting.length ? waiting.shift().resolve(r) : queue.push(r));
  let current = [];
  socket.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      current.push(line);
      if (/^\d{3}(?: |$)/.test(line)) {
        push({ code: Number(line.slice(0, 3)), lines: current });
        current = [];
      }
    }
  });
  const fail = (e) => { failure = e; while (waiting.length) waiting.shift().reject(e); };
  socket.on('error', fail);
  socket.on('close', () => fail(new Error('SMTP connection closed')));
  return {
    next() {
      if (queue.length) return Promise.resolve(queue.shift());
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
    },
    detach() { socket.removeAllListeners('data'); socket.removeAllListeners('error'); socket.removeAllListeners('close'); },
  };
}

/**
 * Minimal SMTP submission: implicit TLS (secure) or STARTTLS. Plain text is only
 * allowed to a localhost server (used by the tests' fake SMTP server).
 */
export async function smtpSend({ host, port, secure, user, pass, from, to, raw, connect, timeoutMs = 20000 }) {
  const open = connect || ((o) => (o.secure ? tls.connect({ host: o.host, port: o.port, servername: o.host }) : net.connect({ host: o.host, port: o.port })));
  let socket = open({ host, port, secure });
  socket.setTimeout(timeoutMs, () => socket.destroy(new Error('SMTP timed out')));
  let r = replies(socket);
  const expect = async (codes, what) => {
    const reply = await r.next();
    if (!codes.includes(reply.code)) throw new Error(`SMTP ${what} failed: ${reply.lines.join(' | ')}`);
    return reply;
  };
  const cmd = (line, codes, what) => { socket.write(`${line}\r\n`); return expect(codes, what); };
  try {
    await expect([220], 'greeting');
    let ehlo = await cmd('EHLO localhost', [250], 'EHLO');
    if (!secure) {
      if (ehlo.lines.some((l) => /STARTTLS/i.test(l))) {
        await cmd('STARTTLS', [220], 'STARTTLS');
        r.detach();
        socket = tls.connect({ socket, servername: host });
        r = replies(socket);
        ehlo = await cmd('EHLO localhost', [250], 'EHLO after STARTTLS');
      } else if (!LOCAL_HOSTS.has(host)) {
        throw new Error('SMTP server does not offer STARTTLS; refusing to send in plain text.');
      }
    }
    if (user) await cmd(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`).toString('base64')}`, [235], 'AUTH');
    await cmd(`MAIL FROM:<${from}>`, [250], 'MAIL FROM');
    await cmd(`RCPT TO:<${to}>`, [250, 251], 'RCPT TO');
    await cmd('DATA', [354], 'DATA');
    // Dot-stuffing: a line starting with "." gets an extra ".".
    socket.write(`${raw.replace(/\r\n\./g, '\r\n..').replace(/^\./, '..')}\r\n.\r\n`);
    await expect([250], 'message');
    await cmd('QUIT', [221], 'QUIT').catch(() => {});
  } finally {
    socket.destroy();
  }
}
