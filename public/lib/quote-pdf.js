// Lays out a quote (optionally signed) as a one-or-more page US Letter PDF.
// Helvetica / Helvetica-Bold only, so the on-screen preview (paper.js) matches.
import { PdfDoc, wrap, jpegFromDataUrl, jpegSize } from './pdf-writer.js';
import { quoteTotals, money, trimNum, formatDate, formatStamp } from './pricing.js';
import { TRADES } from './pricebook.js';
import { validUntil } from './model.js';

const INK = '#1c1a17';
const INK2 = '#4a463f';
const MUTED = '#6b655b';
const LINE = '#e7e2d9';
const LINE_STRONG = '#d6cfc2';
const TINT = '#eef1fc';
const GREEN = '#1c7449';

export const ACCEPTANCE_NOTICE = 'Simple acceptance record. Not a certified e-signature service.';

const M = 48; // page margin, 0.67 in
const RIGHT = 612 - M;
const BOTTOM = 757;
const BODY = 9.4; // table and totals text

function fit(bin, maxW, maxH) {
  const s = jpegSize(bin);
  const k = Math.min(maxW / s.width, maxH / s.height);
  return { w: s.width * k, h: s.height * k };
}

/**
 * @param {{quote: object, business: object}} input
 * @returns {{bytes: Uint8Array, filename: string, totals: object}}
 */
export function buildQuotePdf({ quote, business }) {
  const totals = quoteTotals(quote.items, quote);
  const signed = quote.status === 'approved' && quote.approval;
  const doc = new PdfDoc({ title: `${business.name || 'Quote'} ${quote.number}`, author: business.name || '' });
  const label = (x, y, str, color = MUTED) => doc.text(x, y, str, { size: 8.25, color });
  let y = 0;

  const header = (first) => {
    doc.addPage();
    if (!first) {
      doc.text(M, 46, business.name || 'Quote', { size: 11, font: 'bold', color: INK });
      doc.text(RIGHT, 46, `${quote.number} (continued)`, { size: 9, color: MUTED, align: 'right' });
      doc.line(M, 58, RIGHT, 58, { color: INK, width: 0.75 });
      y = 80;
    }
  };

  // ---- Page 1 header -------------------------------------------------------
  header(true);
  let tx = M;
  const logo = jpegFromDataUrl(business.logo);
  if (logo) {
    const { w, h } = fit(logo, 45, 45);
    doc.image(logo, M, 45 + (45 - h) / 2, w, h, { radius: Math.min(w, h) * 0.2 });
    tx = M + w + 12;
  }
  const nameLines = wrap(business.name || 'Your Business', 15, 300 - (tx - M), 'bold').slice(0, 2);
  let hy = 60;
  for (const l of nameLines) { doc.text(tx, hy, l, { size: 15, font: 'bold', color: INK }); hy += 17; }
  hy -= 2;
  if (business.license) { doc.text(tx, hy, business.license, { size: 9, color: INK2 }); hy += 12.75; }
  for (const l of [[business.phone, business.email].filter(Boolean).join(' · '), business.address].filter(Boolean)) {
    doc.text(tx, hy, l, { size: 9, color: MUTED });
    hy += 12.75;
  }

  doc.text(RIGHT, 64, signed ? 'Approved quote' : 'Quote', { size: 22.5, color: INK, align: 'right' });
  const meta = [['Quote no.', quote.number], ['Date', formatDate(quote.createdAt)], ['Valid until', formatDate(validUntil(quote))]];
  let my = 85.5;
  for (const [k, v] of meta) {
    doc.text(RIGHT - 93, my, k, { size: 9, color: MUTED, align: 'right' });
    doc.text(RIGHT, my, v, { size: 9, font: 'bold', color: INK, align: 'right' });
    my += 15;
  }
  y = Math.max(hy - 12.75, my - 15) + 27.5;
  doc.line(M, y, RIGHT, y, { color: INK, width: 0.75 });
  y += 25;

  // ---- Client and job ------------------------------------------------------
  const c = quote.client || {};
  const colX = 294;
  label(M, y, 'Prepared for');
  label(colX, y, `${TRADES[quote.trade]?.label || ''} job`);
  let ly = y + 16;
  doc.text(M, ly, c.name || 'Client', { size: 11.25, font: 'bold', color: INK });
  ly += 15;
  for (const l of [c.address, c.phone, c.email].filter(Boolean)) {
    for (const w of wrap(l, 9, colX - M - 24).slice(0, 2)) { doc.text(M, ly, w, { size: 9, color: INK2 }); ly += 12.75; }
  }
  let ry = y + 16;
  for (const w of wrap(quote.jobTitle || 'Job', 11.25, RIGHT - colX, 'bold').slice(0, 2)) { doc.text(colX, ry, w, { size: 11.25, font: 'bold', color: INK }); ry += 15; }
  for (const w of wrap(quote.description, 9, RIGHT - colX).slice(0, 5)) { doc.text(colX, ry, w, { size: 9, color: INK2 }); ry += 12.75; }
  y = Math.max(ly, ry) + 24;

  // ---- Line items ----------------------------------------------------------
  const cols = { qty: 322, labor: 394.5, parts: 479, amount: RIGHT };
  const tableHead = () => {
    const o = { size: 8.25, color: MUTED };
    doc.text(M, y, 'Description', o);
    doc.text(cols.qty, y, 'Qty', { ...o, align: 'right' });
    doc.text(cols.labor, y, 'Labor', { ...o, align: 'right' });
    doc.text(cols.parts, y, 'Materials', { ...o, align: 'right' });
    doc.text(cols.amount, y, 'Amount', { ...o, align: 'right' });
    y += 13;
    doc.line(M, y, RIGHT, y, { color: INK, width: 0.75 });
  };
  tableHead();
  if (!quote.items.length) {
    doc.text(M, y + 19, 'No line items yet.', { size: BODY, color: MUTED });
    y += 30;
    doc.line(M, y, RIGHT, y, { color: LINE, width: 0.75 });
  }
  quote.items.forEach((item, i) => {
    const line = totals.lines[i];
    const nameLines = wrap(item.name, BODY, cols.qty - M - 40);
    const h = nameLines.length * 12.75 + 17.25;
    if (y + h > BOTTOM) { header(false); tableHead(); }
    nameLines.forEach((l, k) => doc.text(M, y + 19 + k * 12.75, l, { size: BODY, color: INK }));
    const o = { size: BODY, color: INK, align: 'right' };
    doc.text(cols.qty, y + 19, trimNum(line.qty), o);
    doc.text(cols.labor, y + 19, money(line.labor), o);
    doc.text(cols.parts, y + 19, money(line.parts), o);
    doc.text(cols.amount, y + 19, money(line.amount), { ...o, font: 'bold' });
    y += h;
    doc.line(M, y, RIGHT, y, { color: LINE, width: 0.75 });
  });

  // ---- Totals --------------------------------------------------------------
  const rows = [
    ['Labor', money(totals.labor)],
    ['Materials', money(totals.parts)],
    ['Subtotal', money(totals.subtotal)],
    [`Tax (${trimNum(totals.taxRate)}%${quote.taxOn === 'parts' ? ' on materials' : ''})`, money(totals.tax)],
  ];
  if (y + 24 + rows.length * 18.75 + 50 > BOTTOM) { header(false); y -= 24; }
  y += 24;
  const tx0 = 339;
  const ty0 = y;
  for (const [k, v] of rows) {
    doc.text(tx0, y, k, { size: BODY, color: INK2 });
    doc.text(RIGHT, y, v, { size: BODY, color: INK2, align: 'right' });
    y += 18.75;
  }
  y += -1;
  doc.rect(tx0, y, RIGHT - tx0, 41.5, { fill: TINT, radius: 6 });
  doc.text(tx0 + 11, y + 24.5, 'Total', { size: 9.75, font: 'bold', color: INK });
  doc.text(RIGHT - 11, y + 27, money(totals.total), { size: 18, font: 'bold', color: INK, align: 'right' });
  y += 41.5;
  // Left of the totals: validity reminder.
  label(M, ty0 - 1, 'Valid until');
  doc.text(M, ty0 + 14, formatDate(validUntil(quote)), { size: 11.25, font: 'bold', color: INK });
  doc.text(M, ty0 + 29, `Estimated on-site time: ${trimNum(totals.hours)} hrs`, { size: 9, color: INK2 });
  y += 26;

  // ---- Terms ---------------------------------------------------------------
  const termLines = String(quote.terms || '').split(/\n+/).filter((t) => t.trim())
    .map((t) => wrap(t.trim(), 9, RIGHT - M - 11));
  const termsH = 16 + termLines.reduce((n, l) => n + l.length * 12.75 + 3.75, 0);
  if (termLines.length) {
    if (y + termsH > BOTTOM) header(false);
    label(M, y, 'Terms');
    y += 16;
    for (const lines of termLines) {
      doc.text(M, y, '–', { size: 9, color: INK2 });
      lines.forEach((l, k) => doc.text(M + 10.5, y + k * 12.75, l, { size: 9, color: INK2 }));
      y += lines.length * 12.75 + 3.75;
    }
    y += 1.75;
  } else y += 8;
  y += 4;

  // ---- Acceptance ----------------------------------------------------------
  const accH = signed ? 108 : 100;
  if (y + accH > BOTTOM) header(false);
  doc.rect(M, y, RIGHT - M, accH, { stroke: LINE_STRONG, lineWidth: 0.75, radius: 7.5 });
  label(M + 15, y + 20, signed ? 'Accepted' : 'Customer acceptance', MUTED);
  if (signed) {
    const a = quote.approval;
    const sx = 376;
    const sig = jpegFromDataUrl(a.signature);
    if (sig) {
      const { w, h } = fit(sig, 200, 48);
      doc.image(sig, M + 15, y + 28 + (48 - h), w, h);
    }
    doc.line(M + 15, y + 78, sx - 24, y + 78, { color: INK, width: 0.75 });
    doc.text(M + 15, y + 92, `${a.name}${a.method === 'typed' ? ' (typed signature)' : ''}`, { size: 9, color: MUTED });
    doc.line(sx, y + 34, sx, y + 98, { color: GREEN, width: 1.5 });
    doc.text(sx + 12, y + 44, 'Approved', { size: 9.75, font: 'bold', color: GREEN });
    doc.text(sx + 12, y + 57, formatStamp(a.signedAt), { size: BODY, color: INK });
    doc.text(sx + 12, y + 70, `Accepted total: ${money(a.total ?? totals.total)}`, { size: BODY, color: INK });
    for (const [k, l] of wrap(ACCEPTANCE_NOTICE, 8.25, RIGHT - sx - 27).entries()) doc.text(sx + 12, y + 83 + k * 11, l, { size: 8.25, color: MUTED });
  } else {
    doc.text(M + 15, y + 36, 'By signing, you accept this quote, its price and the terms above.', { size: 9, color: INK2 });
    doc.line(M + 15, y + 76, RIGHT - 15 - 135 - 24, y + 76, { color: INK, width: 0.75 });
    doc.line(RIGHT - 15 - 135, y + 76, RIGHT - 15, y + 76, { color: INK, width: 0.75 });
    doc.text(M + 15, y + 89, 'Customer signature', { size: 8.25, color: MUTED });
    doc.text(RIGHT - 15 - 135, y + 89, 'Date', { size: 8.25, color: MUTED });
  }

  // ---- Footers -------------------------------------------------------------
  const n = doc.pages.length;
  doc.pages.forEach((p, i) => {
    doc.page = p;
    doc.line(M, 761, RIGHT, 761, { color: LINE, width: 0.75 });
    const left = [business.name, business.license].filter(Boolean).join(' · ') || 'Quote';
    doc.text(M, 775, left, { size: 8, color: MUTED });
    doc.text(RIGHT, 775, `${quote.number} · Page ${i + 1} of ${n}`, { size: 8, color: MUTED, align: 'right' });
  });

  const safe = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const filename = `${quote.number}-${safe(c.name) || 'quote'}${signed ? '-signed' : ''}.pdf`;
  return { bytes: doc.toBytes(), filename, totals };
}
