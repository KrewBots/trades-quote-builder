// Mailer tests run against a mocked fetch and a fake SMTP server on 127.0.0.1.
// Nothing here can reach a real email provider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createMailer, emailConfigFromEnv, assertAllowed, parseAllowlist, buildMime, addressOf, smtpSend, RecipientNotAllowed, EmailNotConfigured } from '../../server/mailer.js';

const pdf = Buffer.from('%PDF-1.4 fake\n%%EOF');
const msg = (to = 'owner-test@example.com') => ({
  to, subject: 'Your quote Q-1001', html: '<p>Hi</p>', text: 'Hi\n.leading dot line', replyTo: 'jobs@example.com',
  attachments: [{ filename: 'Q-1001.pdf', content: pdf, contentType: 'application/pdf' }],
});
const env = (over) => ({ TQB_EMAIL_FROM: 'Quotes <quotes@example.com>', TQB_EMAIL_ALLOWLIST: 'owner-test@example.com', ...over });

test('no provider: not configured, says so, never sends', async () => {
  const m = createMailer(emailConfigFromEnv({}));
  assert.equal(m.configured, false);
  assert.equal(m.mock, false);
  assert.match(m.reason, /Email isn't set up/);
  await assert.rejects(m.send(msg()), EmailNotConfigured);
});

test('mock provider only exists in demo mode', async () => {
  const off = createMailer(emailConfigFromEnv({ TQB_EMAIL_PROVIDER: 'mock' }, { demo: false }), { outbox: () => 'x' });
  assert.equal(off.configured, false);
  await assert.rejects(off.send(msg()), EmailNotConfigured);
  const sent = [];
  const on = createMailer(emailConfigFromEnv({}, { demo: true }), { outbox: (m) => { sent.push(m); return 'id1'; } });
  assert.equal(on.configured, true);
  assert.equal(on.mock, true);
  assert.deepEqual(await on.send(msg('anyone@example.org')), { id: 'id1', provider: 'mock' });
  assert.equal(sent[0].to, 'anyone@example.org');
});

test('real providers need from, credentials and an allowlist', () => {
  assert.match(createMailer(emailConfigFromEnv({ TQB_EMAIL_PROVIDER: 'resend' })).reason, /RESEND_API_KEY.*TQB_EMAIL_FROM.*TQB_EMAIL_ALLOWLIST/);
  assert.match(createMailer(emailConfigFromEnv(env({ TQB_EMAIL_PROVIDER: 'resend', TQB_EMAIL_ALLOWLIST: '' , RESEND_API_KEY: 'k' }))).reason, /TQB_EMAIL_ALLOWLIST/);
  assert.match(createMailer(emailConfigFromEnv(env({ TQB_EMAIL_PROVIDER: 'smtp' }))).reason, /SMTP_HOST/);
  assert.equal(createMailer(emailConfigFromEnv(env({ TQB_EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.example.com' }))).configured, true);
  assert.equal(createMailer(emailConfigFromEnv(env({ TQB_EMAIL_PROVIDER: 'carrier-pigeon' }))).configured, false);
});

test('allowlist guard: exact, case-insensitive match only', () => {
  const list = parseAllowlist(' Owner-Test@Example.com , not-an-email, second@example.com');
  assert.deepEqual(list, ['owner-test@example.com', 'second@example.com']);
  assert.doesNotThrow(() => assertAllowed('OWNER-TEST@example.com', list));
  for (const bad of ['other@example.com', 'owner-test@example.com.evil.invalid', 'owner-test@example.com, x@y.z', '', undefined, 'a@b']) {
    assert.throws(() => assertAllowed(bad, list), RecipientNotAllowed, String(bad));
  }
  assert.throws(() => assertAllowed('owner-test@example.com', []), RecipientNotAllowed);
});

test('Resend: posts the email with the PDF to the Resend API (mocked fetch)', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ id: 're_123' }), { status: 200 }); };
  const m = createMailer(emailConfigFromEnv(env({ TQB_EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'test-key' })), { fetchImpl });
  assert.equal(m.configured, true);
  assert.deepEqual(await m.send(msg()), { id: 're_123', provider: 'resend' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-key');
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.to, ['owner-test@example.com']);
  assert.equal(body.from, 'Quotes <quotes@example.com>');
  assert.equal(body.reply_to, 'jobs@example.com');
  assert.equal(body.attachments[0].filename, 'Q-1001.pdf');
  assert.equal(Buffer.from(body.attachments[0].content, 'base64').toString(), pdf.toString());
});

test('Resend: refuses a recipient off the allowlist before any HTTP call; surfaces API errors', async () => {
  let called = 0;
  const fetchImpl = async () => { called++; return new Response(JSON.stringify({ message: 'invalid from' }), { status: 422 }); };
  const m = createMailer(emailConfigFromEnv(env({ TQB_EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k' })), { fetchImpl });
  await assert.rejects(m.send(msg('customer@example.org')), RecipientNotAllowed);
  assert.equal(called, 0, 'no request for a blocked recipient');
  await assert.rejects(m.send(msg()), /Resend refused the email \(422\): invalid from/);
  assert.equal(called, 1);
});

test('MIME: headers, alternative parts, base64 attachment, no header injection', () => {
  const raw = buildMime({ ...msg(), from: 'Quotes <quotes@example.com>', subject: 'Quote\r\nBcc: victim@example.com', date: new Date('2026-10-28T12:00:00Z'), boundary: 'b1' });
  const [head] = raw.split('\r\n\r\n');
  assert.ok(!/^Bcc:/m.test(head), 'CRLF in the subject cannot add headers');
  assert.match(head, /^Subject: Quote Bcc: victim@example.com$/m);
  assert.match(head, /^Reply-To: jobs@example.com$/m);
  assert.match(raw, /Content-Type: multipart\/mixed; boundary="mixed-b1"/);
  assert.match(raw, /Content-Type: text\/plain; charset=utf-8/);
  assert.match(raw, /Content-Type: text\/html; charset=utf-8/);
  assert.match(raw, /Content-Disposition: attachment; filename="Q-1001.pdf"/);
  assert.ok(raw.includes(pdf.toString('base64')));
  assert.match(buildMime({ ...msg(), from: 'a@example.com', subject: 'Café quote' }), /Subject: =\?UTF-8\?B\?/);
  assert.equal(addressOf('Quotes <quotes@example.com>'), 'quotes@example.com');
  assert.equal(addressOf('quotes@example.com'), 'quotes@example.com');
});

/** A fake SMTP server on 127.0.0.1 that records the conversation. */
async function fakeSmtp({ starttls = false } = {}) {
  const log = { commands: [], data: '' };
  const server = net.createServer((s) => {
    let inData = false;
    let buf = '';
    s.write('220 fake.local ESMTP\r\n');
    s.on('data', (d) => {
      buf += d.toString();
      if (inData) {
        const end = buf.indexOf('\r\n.\r\n');
        if (end === -1) return;
        log.data = buf.slice(0, end);
        buf = buf.slice(end + 5);
        inData = false;
        s.write('250 2.0.0 queued\r\n');
      }
      let i;
      while (!inData && (i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        log.commands.push(line);
        if (/^EHLO/.test(line)) s.write(`250-fake.local\r\n${starttls ? '250-STARTTLS\r\n' : ''}250 AUTH PLAIN\r\n`);
        else if (/^AUTH PLAIN/.test(line)) s.write('235 2.7.0 ok\r\n');
        else if (/^(MAIL FROM|RCPT TO)/.test(line)) s.write('250 ok\r\n');
        else if (line === 'DATA') { s.write('354 go\r\n'); inData = true; }
        else if (line === 'QUIT') { s.write('221 bye\r\n'); s.end(); }
        else s.write('502 no\r\n');
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { log, port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}

test('SMTP: full submission to a fake local server, with auth and dot-stuffing', async () => {
  const smtp = await fakeSmtp();
  try {
    const m = createMailer(emailConfigFromEnv(env({ TQB_EMAIL_PROVIDER: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), SMTP_USER: 'u', SMTP_PASS: 'p' })));
    await m.send(msg());
    const c = smtp.log.commands;
    assert.equal(c[0], 'EHLO localhost');
    assert.equal(c[1], `AUTH PLAIN ${Buffer.from('\0u\0p').toString('base64')}`);
    assert.equal(c[2], 'MAIL FROM:<quotes@example.com>');
    assert.equal(c[3], 'RCPT TO:<owner-test@example.com>');
    assert.equal(c[4], 'DATA');
    assert.equal(c.at(-1), 'QUIT');
    assert.match(smtp.log.data, /^From: Quotes <quotes@example.com>/m);
    assert.ok(smtp.log.data.includes(pdf.toString('base64')));
  } finally {
    await smtp.close();
  }
});

test('SMTP: blocked recipient never opens a connection; plain text refused for non-local hosts', async () => {
  let opened = 0;
  const connect = () => { opened++; throw new Error('should not connect'); };
  const m = createMailer(emailConfigFromEnv(env({ TQB_EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.example.com' })), { connect });
  await assert.rejects(m.send(msg('customer@example.org')), RecipientNotAllowed);
  assert.equal(opened, 0);

  // A non-local server without STARTTLS: refuse before sending credentials or mail.
  const smtp = await fakeSmtp();
  try {
    await assert.rejects(
      smtpSend({ host: 'mail.example.com', port: smtp.port, secure: false, user: 'u', pass: 'p', from: 'a@example.com', to: 'owner-test@example.com', raw: 'x', connect: () => net.connect({ host: '127.0.0.1', port: smtp.port }) }),
      /does not offer STARTTLS/,
    );
    assert.ok(!smtp.log.commands.some((l) => /^AUTH|^MAIL/.test(l)), 'no credentials or mail sent in plain text');
  } finally {
    await smtp.close();
  }
});
