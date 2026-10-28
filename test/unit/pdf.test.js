import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PdfDoc, winAnsi, textWidth, wrap, jpegSize, jpegFromDataUrl } from '../../public/lib/pdf-writer.js';
import { buildQuotePdf, ACCEPTANCE_NOTICE } from '../../public/lib/quote-pdf.js';
import { newQuote, SAMPLE_BUSINESS, SAMPLE_JOB, lineFromBook } from '../../public/lib/model.js';
import { DEFAULT_PRICE_BOOK } from '../../public/lib/pricebook.js';
import { money } from '../../public/lib/pricing.js';

const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');

// Smallest valid baseline JPEG header we need: SOI + SOF0 (8x4, 3 components) + EOI.
const tinyJpeg = String.fromCharCode(0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x04, 0x00, 0x08, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9);
const tinyJpegUrl = `data:image/jpeg;base64,${Buffer.from(tinyJpeg, 'latin1').toString('base64')}`;

/** Check a PDF's xref offsets really point at each "n 0 obj". */
function assertValidPdf(bytes) {
  const s = latin1(bytes);
  assert.ok(s.startsWith('%PDF-1.4'), 'header');
  assert.ok(s.trimEnd().endsWith('%%EOF'), 'trailer');
  const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(s)[1]);
  assert.equal(s.slice(startxref, startxref + 4), 'xref');
  const [, count] = /xref\n0 (\d+)\n/.exec(s.slice(startxref)).map(Number);
  const entries = s.slice(startxref).split('\n').slice(3, 3 + count - 1);
  entries.forEach((e, i) => {
    const off = Number(e.slice(0, 10));
    assert.equal(s.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `object ${i + 1} offset`);
  });
  for (const m of s.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const start = m.index + m[0].length;
    assert.equal(s.slice(start + Number(m[1]), start + Number(m[1]) + 10), '\nendstream', 'stream length');
  }
  return s;
}

function sampleQuote() {
  const q = { ...newQuote({ number: 1001, now: new Date('2026-10-28T15:00:00Z') }), ...structuredClone(SAMPLE_JOB) };
  const pick = (id, qty = 1) => lineFromBook(DEFAULT_PRICE_BOOK.find((i) => i.id === id), qty);
  q.items = [pick('p-wh-tank-50'), pick('p-wh-expansion'), pick('p-gas-flex'), pick('p-faucet-kitchen')];
  return q;
}

test('winAnsi maps typographic characters and replaces the unsupported ones', () => {
  assert.equal(winAnsi('Café – “quote” — 5’'), 'Caf\xe9 \x96 \x93quote\x94 \x97 5\x92');
  assert.equal(winAnsi('line\nbreak\ttab'), 'line break tab');
  assert.equal(winAnsi('emoji 🔧'), 'emoji ?');
  assert.equal(winAnsi(null), '');
});

test('text metrics and wrapping', () => {
  assert.equal(textWidth('', 10), 0);
  assert.equal(textWidth('i', 10), 2.22);
  assert.ok(textWidth('WWW', 10, 'bold') > textWidth('iii', 10, 'bold'));
  const lines = wrap('Replace the old fifty gallon water heater and haul the old one away', 10, 120);
  assert.ok(lines.length > 1);
  for (const l of lines) assert.ok(textWidth(l, 10) <= 120, l);
  const hard = wrap('x'.repeat(200), 10, 50);
  for (const l of hard) assert.ok(textWidth(l, 10) <= 50);
  assert.equal(hard.join(''), 'x'.repeat(200));
  assert.deepEqual(wrap('a\n\nb', 10, 100), ['a', '', 'b']);
});

test('JPEG size parsing and data-URL validation', () => {
  assert.deepEqual(jpegSize(tinyJpeg), { width: 8, height: 4, components: 3 });
  assert.equal(jpegFromDataUrl(tinyJpegUrl), tinyJpeg);
  assert.equal(jpegFromDataUrl('data:image/png;base64,AAAA'), null);
  assert.equal(jpegFromDataUrl('javascript:alert(1)'), null);
  assert.equal(jpegFromDataUrl(''), null);
});

test('PdfDoc writes a structurally valid PDF with escaped text and images', () => {
  const d = new PdfDoc({ title: 'T (1)' }).addPage();
  d.text(10, 10, 'Price (incl. tax) \\ total');
  d.rect(0, 0, 10, 10, { fill: '#ff0000', stroke: '#000000' });
  d.line(0, 0, 10, 10, { dash: [2, 2] });
  assert.equal(d.image(tinyJpeg, 0, 0, 8, 4), true);
  assert.equal(d.image('not a jpeg', 0, 0, 8, 4), false);
  d.addPage().text(10, 10, 'Page two');
  const s = assertValidPdf(d.toBytes());
  assert.match(s, /\(Price \\\(incl\. tax\\\) \\\\ total\) Tj/);
  assert.match(s, /\/Count 2/);
  assert.match(s, /\/Subtype \/Image \/Width 8 \/Height 4/);
  assert.match(s, /\/Title \(T \\\(1\\\)\)/);
});

test('quote PDF contains the business, client, every line and the exact totals', () => {
  const q = sampleQuote();
  const { bytes, filename, totals } = buildQuotePdf({ quote: q, business: { ...SAMPLE_BUSINESS, logo: tinyJpegUrl } });
  const s = assertValidPdf(bytes);
  assert.equal(filename, 'Q-1001-Jordan-Rivera.pdf');
  assert.equal(money(totals.total), '$2,612.45');
  for (const t of ['Quote', 'Brightline Plumbing & Electric', 'Lic. #PLB-000000 \\(sample\\)', 'Jordan Rivera', 'Q-1001', 'Valid until',
    'Total', money(totals.total), money(totals.subtotal), money(totals.tax), 'Tax \\(8.25%\\)', 'Customer signature', 'Page 1 of 1']) {
    assert.ok((t.startsWith('Page') ? s.includes(`${t})`) : s.includes(`(${t})`)), `PDF shows ${t}`);
  }
  for (const it of q.items) assert.ok(s.includes(`(${it.name})`), it.name);
  assert.match(s, /\/Subtype \/Image/, 'logo embedded');
  assert.ok(!s.includes('(Approved quote)'));
});

test('signed quote PDF shows the acceptance record, signature and notice', () => {
  const q = sampleQuote();
  q.status = 'approved';
  q.approval = { name: 'Jordan Rivera', method: 'drawn', signature: tinyJpegUrl, signedAt: '2026-10-28T19:04:00Z', total: 2612.45 };
  const { bytes, filename } = buildQuotePdf({ quote: q, business: SAMPLE_BUSINESS });
  const s = assertValidPdf(bytes);
  assert.equal(filename, 'Q-1001-Jordan-Rivera-signed.pdf');
  assert.ok(s.includes('(Approved quote)'));
  assert.ok(s.includes('(Approved)'));
  assert.ok(s.includes('(Accepted total: $2,612.45)'));
  assert.ok(s.includes('(Oct 28, 2026'), 'timestamp');
  assert.ok(s.includes('Not a certified') && ACCEPTANCE_NOTICE.includes('Not a certified e-signature service'));
  assert.match(s, /\/Subtype \/Image/, 'signature embedded');
  assert.ok(!s.includes('(Customer signature)'));
});

test('long quotes paginate and every page gets a footer', () => {
  const q = sampleQuote();
  q.items = DEFAULT_PRICE_BOOK.map((i) => lineFromBook(i, 1));
  const s = assertValidPdf(buildQuotePdf({ quote: q, business: SAMPLE_BUSINESS }).bytes);
  const pages = Number(/\/Count (\d+)/.exec(s)[1]);
  assert.ok(pages >= 2, `${pages} pages`);
  for (let p = 1; p <= pages; p++) assert.ok(s.includes(`Page ${p} of ${pages})`), `footer ${p}`);
  assert.ok(s.includes('(Q-1001 \\(continued\\))'));
});

test('empty and minimal quotes still produce a valid PDF', () => {
  const q = newQuote();
  const { bytes, filename } = buildQuotePdf({ quote: q, business: {} });
  const s = assertValidPdf(bytes);
  assert.ok(s.includes('(No line items yet.)'));
  assert.ok(s.includes('($0.00)'));
  assert.match(filename, /^Q-1001-quote\.pdf$/);
});
