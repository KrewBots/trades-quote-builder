// HTML version of the quote document: the on-screen PDF preview and the
// customer's view on the approval page. Mirrors the PDF layout in quote-pdf.js.
import { quoteTotals, money, trimNum, formatDate, formatStamp } from './pricing.js';
import { TRADES } from './pricebook.js';
import { validUntil } from './model.js';
import { ACCEPTANCE_NOTICE } from './quote-pdf.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeImg = (url) => (/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(url || '') ? url : '');

export function paperHtml(quote, business, { showAcceptance = true } = {}) {
  const t = quoteTotals(quote.items, quote);
  const c = quote.client || {};
  const signed = quote.status === 'approved' && quote.approval;
  const logo = safeImg(business.logo);
  const contact = [[business.phone, business.email].filter(Boolean).join('  |  '), business.address].filter(Boolean);
  const rows = quote.items.length
    ? quote.items.map((it, i) => {
      const l = t.lines[i];
      return `<tr><td>${esc(it.name)}</td><td class="n">${trimNum(l.qty)}</td><td class="n hide-s">${money(l.labor)}</td><td class="n hide-s">${money(l.parts)}</td><td class="n b">${money(l.amount)}</td></tr>`;
    }).join('')
    : '<tr><td colspan="5" class="muted">No line items yet.</td></tr>';
  const terms = String(quote.terms || '').split(/\n+/).filter((x) => x.trim()).map((x) => `<li>${esc(x)}</li>`).join('');

  let acceptance = '';
  if (showAcceptance && signed) {
    const a = quote.approval;
    acceptance = `<section class="p-accept is-signed">
      <div class="p-sig"><span class="p-label green">Accepted</span>${safeImg(a.signature) ? `<img src="${a.signature}" alt="Customer signature">` : ''}<span class="p-sigline">${esc(a.name)}${a.method === 'typed' ? ' (typed signature)' : ''}</span></div>
      <div class="p-stamp"><b>Approved</b><span>${esc(formatStamp(a.signedAt))}</span><span>Accepted total: ${money(a.total ?? t.total)}</span><small>${esc(ACCEPTANCE_NOTICE)}</small></div>
    </section>`;
  } else if (showAcceptance) {
    acceptance = `<section class="p-accept"><span class="p-label">Customer acceptance</span><p class="muted">By signing, you accept this quote, its price and the terms above.</p>
      <div class="p-lines"><span>Customer signature</span><span>Date</span></div></section>`;
  }

  return `<div class="p-bar"></div>
  <header class="p-head">
    <div class="p-biz">${logo ? `<img class="p-logo" src="${logo}" alt="">` : ''}<div>
      <h3>${esc(business.name || 'Your Business')}</h3>
      ${business.license ? `<p class="p-lic">${esc(business.license)}</p>` : ''}
      ${contact.map((x) => `<p class="muted">${esc(x)}</p>`).join('')}
    </div></div>
    <div class="p-meta">
      <h4>${signed ? 'Approved quote' : 'Quote'}</h4>
      <dl><dt>Quote no.</dt><dd>${esc(quote.number)}</dd><dt>Date</dt><dd>${esc(formatDate(quote.createdAt))}</dd><dt>Valid until</dt><dd>${esc(formatDate(validUntil(quote)))}</dd></dl>
    </div>
  </header>
  <section class="p-parties">
    <div><span class="p-label">Prepared for</span><b>${esc(c.name || 'Client')}</b>${[c.address, c.phone, c.email].filter(Boolean).map((x) => `<p class="muted">${esc(x)}</p>`).join('')}</div>
    <div><span class="p-label">${esc(TRADES[quote.trade]?.label || '')} job</span><b>${esc(quote.jobTitle || 'Job')}</b>${quote.description ? `<p class="muted">${esc(quote.description)}</p>` : ''}</div>
  </section>
  <table class="p-table">
    <thead><tr><th>Description</th><th class="n">Qty</th><th class="n hide-s">Labor</th><th class="n hide-s">Materials</th><th class="n">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <section class="p-totals">
    <div class="p-valid"><span class="p-label ink">Valid until</span><b>${esc(formatDate(validUntil(quote)))}</b><p class="muted">Estimated on-site time: ${trimNum(t.hours)} hrs</p></div>
    <dl>
      <dt>Labor</dt><dd>${money(t.labor)}</dd>
      <dt>Materials</dt><dd>${money(t.parts)}</dd>
      <dt>Subtotal</dt><dd>${money(t.subtotal)}</dd>
      <dt>Tax (${trimNum(t.taxRate)}%${quote.taxOn === 'parts' ? ' on materials' : ''})</dt><dd>${money(t.tax)}</dd>
      <dt class="p-total">Total</dt><dd class="p-total" data-testid="paper-total">${money(t.total)}</dd>
    </dl>
  </section>
  ${terms ? `<section class="p-terms"><span class="p-label">Terms</span><ul>${terms}</ul></section>` : ''}
  ${acceptance}`;
}
