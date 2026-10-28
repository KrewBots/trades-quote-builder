// Shared parts of the two customer pages (emailed review link and on-site approval):
// contractor branding, the summary card, the sign card and the approved receipt.
import { quoteTotals, money, trimNum, formatDate, formatStamp } from './pricing.js';
import { validUntil } from './model.js';
import { esc, safeImg } from './paper.js';
import { icon } from './icons.js';
import { moneyHtml } from './ui.js';
import { SignaturePad } from './browser.js';

const $ = (id) => document.getElementById(id);

/** App bar shows the contractor's logo and name, not the app's. */
export function renderBrand(business) {
  const logo = safeImg(business.logo);
  $('biz-logo').hidden = !logo;
  $('biz-mark').hidden = !!logo;
  if (logo) $('biz-logo').src = logo;
  $('biz-name').textContent = business.name || 'Your contractor';
}

/** Page head + summary card for a quote waiting for a signature. */
export function renderSummary(quote) {
  const t = quoteTotals(quote.items, quote);
  $('head-number').textContent = quote.number;
  $('head-title').textContent = `Your quote for ${quote.jobTitle || 'your job'}`;
  $('sum-valid').textContent = `Valid until ${formatDate(validUntil(quote)).replace(/, \d{4}$/, '')}`;
  $('sum-total').innerHTML = moneyHtml(t.total);
  const n = quote.items.length;
  $('sum-detail').textContent = `Includes ${trimNum(t.taxRate)}% tax · ${n} line item${n === 1 ? '' : 's'}`;
  $('sign-total').textContent = money(t.total);
}

export function setBadge(state) {
  const b = $('top-badge');
  const [cls, ico, label] = {
    sign: ['pill-accent', 'pen-line', 'Review and sign'],
    approved: ['pill-success', 'circle-check', 'Approved'],
    declined: ['pill-danger', 'circle-x', 'Declined'],
  }[state];
  b.className = `pill ${cls}`;
  b.innerHTML = `${icon(ico)}${label}`;
}

/** The approved receipt: drawn check, heading, accepted total and the signature. */
export function renderDone(quote, approval) {
  const first = String(approval.name || '').split(/\s+/)[0];
  $('done-lead').textContent = `Thanks, ${first}. Your acceptance is recorded with this quote.`;
  $('done-total').innerHTML = moneyHtml(approval.total ?? quoteTotals(quote.items, quote).total);
  $('r-number').textContent = quote.number;
  $('r-job').textContent = quote.jobTitle || 'Job';
  $('r-signer').textContent = `${approval.name}${approval.method === 'typed' ? ' (typed)' : ''}`;
  $('r-stamp').textContent = formatStamp(approval.signedAt);
  const sig = safeImg(approval.signature);
  $('r-sig').hidden = !sig;
  if (sig) $('r-sig').src = sig;
  $('done-stamp').textContent = `Signed by ${approval.name} on ${formatStamp(approval.signedAt)}`;
}

/** Draw / Type switch and the signature pad. Returns the current mode and pad. */
export function wireSignature() {
  const state = { mode: 'draw', pad: null };
  const typed = () => { $('typed-preview').textContent = $('signer').value.trim() || 'Your name'; };
  state.init = () => {
    if (!state.pad) state.pad = new SignaturePad($('pad'), { onChange: (empty) => $('pad-wrap').classList.toggle('has-ink', !empty) });
    typed();
  };
  for (const b of document.querySelectorAll('[data-mode]')) {
    b.addEventListener('click', () => {
      state.mode = b.dataset.mode;
      for (const x of document.querySelectorAll('[data-mode]')) x.setAttribute('aria-selected', String(x === b));
      $('pad-wrap').hidden = state.mode !== 'draw';
      $('typed').hidden = state.mode !== 'type';
      $('sign-error').textContent = '';
      if (state.mode === 'draw') state.pad.resize();
    });
  }
  $('signer').addEventListener('input', typed);
  $('pad-clear').addEventListener('click', () => state.pad.clear());
  return state;
}

export { esc };
