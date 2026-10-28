// HTML version of the quote document: the on-screen PDF preview and the
// customer's view on the review/approval pages. Mirrors the PDF layout in
// quote-pdf.js (Helvetica document styling); narrow papers (<480 px) fold the
// Labor/Materials columns into a sub-line under each item.
import { quoteTotals, money, trimNum, formatDate, formatStamp } from './pricing.js';
import { TRADES } from './pricebook.js';
import { validUntil } from './model.js';
import { ACCEPTANCE_NOTICE } from './quote-pdf.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const safeImg = (url) => (/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(url || '') ? url : '');

export function paperHtml(quote, business, { showAcceptance = true } = {}) {
  const t = quoteTotals(quote.items, quote);
  const c = quote.client || {};
  const signed = quote.status === 'approved' && quote.approval;
  const logo = safeImg(business.logo);
  const contact = [[business.phone, business.email].filter(Boolean).join(' · '), business.address].filter(Boolean);
  const rows = quote.items.length
    ? quote.items.map((it, i) => {
      const l = t.lines[i];
      return `<tr><td>${esc(it.name)}<small class="show-s num">Labor ${money(l.labor)} · Materials ${money(l.parts)}</small></td><td class="n">${trimNum(l.qty)}</td><td class="n hide-s">${money(l.labor)}</td><td class="n hide-s">${money(l.parts)}</td><td class="n b">${money(l.amount)}</td></tr>`;
    }).join('')
    : '<tr><td colspan="5" class="muted">No line items yet.</td></tr>';
  const terms = String(quote.terms || '').split(/\n+/).filter((x) => x.trim()).map((x) => `<li>${esc(x)}</li>`).join('');
  const until = formatDate(validUntil(quote));

  let acceptance = '';
  if (showAcceptance && signed) {
    const a = quote.approval;
    acceptance = `<section class="pp-accept is-signed">
      <div class="pp-sig"><p class="pp-lbl">Accepted</p>${safeImg(a.signature) ? `<img src="${a.signature}" alt="Customer signature">` : ''}<span class="pp-signer">${esc(a.name)}${a.method === 'typed' ? ' (typed signature)' : ''}</span></div>
      <div class="pp-stamp"><b>Approved</b><span>${esc(formatStamp(a.signedAt))}</span><span>Accepted total: ${money(a.total ?? t.total)}</span><small>${esc(ACCEPTANCE_NOTICE)}</small></div>
    </section>`;
  } else if (showAcceptance) {
    acceptance = `<section class="pp-accept"><p class="pp-lbl">Customer acceptance</p><p>By signing, you accept this quote, its price and the terms above.</p>
      <div class="pp-sigline"><span>Customer signature</span><span>Date</span></div></section>`;
  }

  return `<header class="pp-head">
    <div class="pp-biz">${logo ? `<img src="${logo}" alt="">` : ''}<div>
      <b>${esc(business.name || 'Your Business')}</b>
      ${business.license ? `<span class="pp-lic">${esc(business.license)}</span>` : ''}
      ${contact.map((x) => `<span class="pp-contact">${esc(x)}</span>`).join('')}
    </div></div>
    <div class="pp-title">
      <h4>${signed ? 'Approved quote' : 'Quote'}</h4>
      <dl class="pp-meta"><div><dt>Quote no.</dt><dd>${esc(quote.number)}</dd></div><div><dt>Date</dt><dd>${esc(formatDate(quote.createdAt))}</dd></div><div><dt>Valid until</dt><dd>${esc(until)}</dd></div></dl>
    </div>
  </header>
  <section class="pp-parties">
    <div class="pp-party"><p class="pp-lbl">Prepared for</p><b>${esc(c.name || 'Client')}</b>${[c.address, c.phone, c.email].filter(Boolean).map((x) => `<p>${esc(x)}</p>`).join('')}</div>
    <div class="pp-party"><p class="pp-lbl">${esc(TRADES[quote.trade]?.label || '')} job</p><b>${esc(quote.jobTitle || 'Job')}</b>${quote.description ? `<p>${esc(quote.description)}</p>` : ''}</div>
  </section>
  <table class="pp-items">
    <thead><tr><th>Description</th><th class="n">Qty</th><th class="n hide-s">Labor</th><th class="n hide-s">Materials</th><th class="n">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <section class="pp-low">
    <div class="pp-valid"><p class="pp-lbl">Valid until</p><b>${esc(until)}</b><p>Estimated on-site time: ${trimNum(t.hours)} hrs</p></div>
    <div class="pp-sum">
      <div><span>Labor</span><span>${money(t.labor)}</span></div>
      <div><span>Materials</span><span>${money(t.parts)}</span></div>
      <div><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
      <div><span>Tax (${trimNum(t.taxRate)}%${quote.taxOn === 'parts' ? ' on materials' : ''})</span><span>${money(t.tax)}</span></div>
      <div class="pp-total"><span>Total</span><b class="num" data-testid="paper-total">${money(t.total)}</b></div>
    </div>
  </section>
  ${terms ? `<section class="pp-terms"><p class="pp-lbl">Terms</p><ul>${terms}</ul></section>` : ''}
  ${acceptance}
  <footer class="pp-foot"><span>${esc([business.name, business.license].filter(Boolean).join(' · ') || 'Quote')}</span><span>${esc(quote.number)}</span></footer>`;
}
