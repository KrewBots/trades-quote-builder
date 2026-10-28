// Lays out a quote (optionally signed) as a one-or-more page US Letter PDF.
import { PdfDoc, wrap, jpegFromDataUrl, jpegSize } from './pdf-writer.js';
import { quoteTotals, money, trimNum, formatDate, formatStamp } from './pricing.js';
import { TRADES } from './pricebook.js';
import { validUntil } from './model.js';

const INK = '#13233f';
const ORANGE = '#e8590c';
const MUTED = '#5d6676';
const RULE = '#d8d2c6';
const ZEBRA = '#f6f3ed';
const GREEN = '#1f7a45';

export const ACCEPTANCE_NOTICE = 'Simple acceptance record. Not a certified e-signature service.';

const M = 48; // page margin
const RIGHT = 612 - M;
const BOTTOM = 728;

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
  const label = (x, y, str, color = ORANGE) => doc.text(x, y, str.toUpperCase(), { size: 7.5, font: 'bold', color, spacing: 1.1 });
  let y = 0;

  const header = (first) => {
    doc.addPage();
    doc.rect(0, 0, 612, 7, { fill: ORANGE });
    if (!first) {
      doc.text(M, 40, business.name || 'Quote', { size: 11, font: 'bold', color: INK });
      doc.text(RIGHT, 40, `${quote.number} (continued)`, { size: 9, color: MUTED, align: 'right' });
      doc.line(M, 52, RIGHT, 52, { color: RULE });
      y = 72;
    }
  };

  // ---- Page 1 header -------------------------------------------------------
  header(true);
  let tx = M;
  const logo = jpegFromDataUrl(business.logo);
  if (logo) {
    const { w, h } = fit(logo, 64, 64);
    doc.image(logo, M, 30 + (64 - h) / 2, w, h);
    tx = M + w + 14;
  }
  const nameLines = wrap(business.name || 'Your Business', 16, 300 - (tx - M), 'bold').slice(0, 2);
  let hy = 48;
  for (const l of nameLines) { doc.text(tx, hy, l, { size: 16, font: 'bold', color: INK }); hy += 18; }
  if (business.license) { doc.text(tx, hy, business.license, { size: 8.5, font: 'bold', color: ORANGE }); hy += 12; }
  for (const l of [[business.phone, business.email].filter(Boolean).join('  |  '), business.address].filter(Boolean)) {
    doc.text(tx, hy, l, { size: 8.5, color: MUTED });
    hy += 11.5;
  }

  doc.text(RIGHT, 56, signed ? 'APPROVED QUOTE' : 'QUOTE', { size: signed ? 20 : 26, font: 'bold', color: INK, align: 'right', spacing: 1.5 });
  const meta = [['Quote no.', quote.number], ['Date', formatDate(quote.createdAt)], ['Valid until', formatDate(validUntil(quote))]];
  let my = 74;
  for (const [k, v] of meta) {
    doc.text(RIGHT - 92, my, k, { size: 8.5, color: MUTED, align: 'right' });
    doc.text(RIGHT, my, v, { size: 8.5, font: 'bold', color: INK, align: 'right' });
    my += 12;
  }
  y = Math.max(hy, my) + 14;
  doc.line(M, y, RIGHT, y, { color: INK, width: 1.2 });
  y += 24;

  // ---- Client and job ------------------------------------------------------
  const c = quote.client || {};
  const colX = 320;
  label(M, y, 'Prepared for');
  label(colX, y, `${TRADES[quote.trade]?.label || ''} job`);
  let ly = y + 16;
  doc.text(M, ly, c.name || 'Client', { size: 11.5, font: 'bold', color: INK });
  ly += 14;
  for (const l of [c.address, c.phone, c.email].filter(Boolean)) {
    for (const w of wrap(l, 9, 250).slice(0, 2)) { doc.text(M, ly, w, { size: 9, color: MUTED }); ly += 12; }
  }
  let ry = y + 16;
  for (const w of wrap(quote.jobTitle || 'Job', 11.5, RIGHT - colX, 'bold').slice(0, 2)) { doc.text(colX, ry, w, { size: 11.5, font: 'bold', color: INK }); ry += 14; }
  for (const w of wrap(quote.description, 8.5, RIGHT - colX).slice(0, 5)) { doc.text(colX, ry, w, { size: 8.5, color: MUTED }); ry += 11; }
  y = Math.max(ly, ry) + 18;

  // ---- Line items ----------------------------------------------------------
  const cols = { qty: 352, labor: 420, parts: 488, amount: RIGHT - 8 };
  const tableHead = () => {
    doc.rect(M, y, RIGHT - M, 22, { fill: INK });
    const o = { size: 8, font: 'bold', color: '#ffffff', spacing: 0.8 };
    doc.text(M + 10, y + 14.5, 'DESCRIPTION', o);
    doc.text(cols.qty, y + 14.5, 'QTY', { ...o, align: 'right' });
    doc.text(cols.labor, y + 14.5, 'LABOR', { ...o, align: 'right' });
    doc.text(cols.parts, y + 14.5, 'MATERIALS', { ...o, align: 'right' });
    doc.text(cols.amount, y + 14.5, 'AMOUNT', { ...o, align: 'right' });
    y += 22;
  };
  tableHead();
  if (!quote.items.length) {
    doc.text(M + 10, y + 18, 'No line items yet.', { size: 9.5, color: MUTED });
    y += 28;
  }
  quote.items.forEach((item, i) => {
    const line = totals.lines[i];
    const nameLines = wrap(item.name, 9.5, 260);
    const h = nameLines.length * 12 + 12;
    if (y + h > BOTTOM) { header(false); tableHead(); }
    if (i % 2 === 1) doc.rect(M, y, RIGHT - M, h, { fill: ZEBRA });
    nameLines.forEach((l, k) => doc.text(M + 10, y + 15 + k * 12, l, { size: 9.5, color: INK }));
    const o = { size: 9.5, color: INK, align: 'right' };
    doc.text(cols.qty, y + 15, trimNum(line.qty), o);
    doc.text(cols.labor, y + 15, money(line.labor), o);
    doc.text(cols.parts, y + 15, money(line.parts), o);
    doc.text(cols.amount, y + 15, money(line.amount), { ...o, font: 'bold' });
    y += h;
  });
  doc.line(M, y, RIGHT, y, { color: RULE });
  y += 16;

  // ---- Totals --------------------------------------------------------------
  const rows = [
    ['Labor', money(totals.labor)],
    ['Materials', money(totals.parts)],
    ['Subtotal', money(totals.subtotal)],
    [`Tax (${trimNum(totals.taxRate)}%${quote.taxOn === 'parts' ? ' on materials' : ''})`, money(totals.tax)],
  ];
  if (y + rows.length * 16 + 44 > BOTTOM) header(false);
  const tx0 = 352;
  const ty0 = y;
  for (const [k, v] of rows) {
    doc.text(tx0, y + 10, k, { size: 9.5, color: MUTED });
    doc.text(RIGHT - 8, y + 10, v, { size: 9.5, color: INK, align: 'right' });
    y += 16;
  }
  y += 4;
  doc.rect(tx0 - 10, y, RIGHT - tx0 + 10, 32, { fill: ORANGE });
  doc.text(tx0, y + 21, 'TOTAL', { size: 10, font: 'bold', color: '#ffffff', spacing: 1.2 });
  doc.text(RIGHT - 8, y + 21.5, money(totals.total), { size: 15, font: 'bold', color: '#ffffff', align: 'right' });
  y += 32;
  // Left of the totals: validity reminder.
  label(M, ty0 + 10, 'Valid until', INK);
  doc.text(M, ty0 + 26, formatDate(validUntil(quote)), { size: 12, font: 'bold', color: INK });
  doc.text(M, ty0 + 40, `Estimated on-site time: ${trimNum(totals.hours)} hrs`, { size: 8.5, color: MUTED });
  y += 26;

  // ---- Terms ---------------------------------------------------------------
  const terms = wrap(quote.terms || '', 8.5, RIGHT - M - 14);
  const termsH = 20 + terms.length * 11.5;
  if (y + termsH > BOTTOM) header(false);
  label(M, y, 'Terms');
  y += 14;
  for (const t of terms) {
    if (t) {
      doc.rect(M + 1, y - 4, 3, 3, { fill: ORANGE });
      doc.text(M + 10, y, t, { size: 8.5, color: INK });
    }
    y += 11.5;
  }
  y += 12;

  // ---- Acceptance ----------------------------------------------------------
  const accH = 112;
  if (y + accH > BOTTOM) header(false);
  doc.rect(M, y, RIGHT - M, accH, { stroke: signed ? GREEN : RULE, lineWidth: signed ? 1.4 : 1 });
  label(M + 14, y + 18, signed ? 'Accepted' : 'Customer acceptance', signed ? GREEN : ORANGE);
  if (signed) {
    const a = quote.approval;
    const sig = jpegFromDataUrl(a.signature);
    if (sig) {
      const { w, h } = fit(sig, 210, 56);
      doc.image(sig, M + 14, y + 26 + (56 - h) / 2, w, h);
    }
    doc.line(M + 14, y + 86, M + 240, y + 86, { color: INK, width: 0.8 });
    doc.text(M + 14, y + 98, `${a.name}${a.method === 'typed' ? ' (typed signature)' : ''}`, { size: 8.5, color: MUTED });
    const sx = 330;
    doc.text(sx, y + 38, 'Approved', { size: 13, font: 'bold', color: GREEN });
    doc.text(sx, y + 54, formatStamp(a.signedAt), { size: 9.5, font: 'bold', color: INK });
    doc.text(sx, y + 68, `Accepted total: ${money(a.total ?? totals.total)}`, { size: 9, color: INK });
    for (const [k, l] of wrap(ACCEPTANCE_NOTICE, 7.5, RIGHT - sx - 12).entries()) doc.text(sx, y + 84 + k * 9.5, l, { size: 7.5, color: MUTED });
  } else {
    doc.text(M + 14, y + 34, 'By signing, you accept this quote, its price and the terms above.', { size: 8.5, color: MUTED });
    doc.line(M + 14, y + 82, M + 300, y + 82, { color: INK, width: 0.8 });
    doc.line(M + 330, y + 82, RIGHT - 14, y + 82, { color: INK, width: 0.8 });
    doc.text(M + 14, y + 96, 'Customer signature', { size: 8, color: MUTED });
    doc.text(M + 330, y + 96, 'Date', { size: 8, color: MUTED });
  }

  // ---- Footers -------------------------------------------------------------
  const n = doc.pages.length;
  doc.pages.forEach((p, i) => {
    doc.page = p;
    doc.line(M, 752, RIGHT, 752, { color: RULE });
    const left = [business.name, business.license].filter(Boolean).join('  |  ') || 'Quote';
    doc.text(M, 766, left, { size: 7.5, color: MUTED });
    doc.text(RIGHT, 766, `${quote.number}  |  Page ${i + 1} of ${n}`, { size: 7.5, color: MUTED, align: 'right' });
  });

  const safe = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const filename = `${quote.number}-${safe(c.name) || 'quote'}${signed ? '-signed' : ''}.pdf`;
  return { bytes: doc.toBytes(), filename, totals };
}

