// Customer approval page (/approve/<id>): review the quote, sign, accept.
// Reads and writes the quote in this browser's storage only.
import { quoteTotals, money, formatStamp, formatDate } from './lib/pricing.js';
import { isExpired, validUntil } from './lib/model.js';
import { buildQuotePdf } from './lib/quote-pdf.js';
import { paperHtml } from './lib/paper.js';
import { SignaturePad, typedSignatureJpeg, download } from './lib/browser.js';
import * as store from './lib/store.js';

const $ = (id) => document.getElementById(id);
const id = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
let quote = store.getQuote(id);
const business = store.loadBusiness();
let mode = 'draw';
let pad;

function render() {
  if (!quote) {
    $('missing').hidden = false;
    return;
  }
  $('approve-grid').hidden = false;
  document.body.classList.add(`trade-${quote.trade}`);
  document.title = `${quote.number} from ${business.name || 'your contractor'}`;
  const t = quoteTotals(quote.items, quote);
  const from = business.name || 'Your contractor';
  $('intro').textContent = quote.status === 'approved'
    ? `Your signed copy of quote ${quote.number} from ${from}.`
    : `${from} sent you quote ${quote.number}. Please review it, then sign below.`;
  $('paper').innerHTML = paperHtml(quote, business, { showAcceptance: quote.status === 'approved' });
  $('sign-total').textContent = money(t.total);
  const approved = quote.status === 'approved' && quote.approval;
  $('sign-form').hidden = !!approved;
  $('done').hidden = !approved;
  $('top-badge').textContent = approved ? 'Approved' : 'Review & sign';
  $('top-badge').classList.toggle('is-approved', !!approved);
  $('approve-grid').classList.toggle('is-approved', !!approved);
  if (approved) {
    $('done-stamp').textContent = `Signed by ${quote.approval.name} on ${formatStamp(quote.approval.signedAt)}`;
    $('done-total').textContent = `Accepted total ${money(quote.approval.total)}`;
    return;
  }
  if (!$('signer').value) $('signer').value = quote.client?.name || '';
  if (isExpired(quote)) {
    $('sign-error').textContent = `This quote expired on ${formatDate(validUntil(quote))}. Ask your contractor for an updated quote.`;
    $('accept').disabled = true;
  }
  if (!pad) {
    pad = new SignaturePad($('pad'), { onChange: (empty) => $('pad-wrap').classList.toggle('has-ink', !empty) });
  }
  updateTyped();
}

function updateTyped() {
  $('typed-preview').textContent = $('signer').value.trim() || 'Your name';
}

for (const b of document.querySelectorAll('[data-mode]')) {
  b.addEventListener('click', () => {
    mode = b.dataset.mode;
    for (const x of document.querySelectorAll('[data-mode]')) x.setAttribute('aria-selected', String(x === b));
    $('pad-wrap').hidden = mode !== 'draw';
    $('typed').hidden = mode !== 'type';
    $('sign-error').textContent = '';
    if (mode === 'draw') pad.resize();
  });
}
$('signer').addEventListener('input', updateTyped);
$('pad-clear').addEventListener('click', () => pad.clear());

$('sign-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('signer').value.trim();
  const err = (m) => { $('sign-error').textContent = m; };
  if (name.length < 2) return err('Please enter your full name.');
  if (mode === 'draw' && pad.isEmpty()) return err('Please sign in the box, or switch to Type.');
  if (!$('agree').checked) return err('Please tick the box to accept the quote.');
  if (isExpired(quote)) return err('This quote has expired.');
  err('');
  $('accept').disabled = true;
  const signature = mode === 'draw' ? pad.toJpeg() : await typedSignatureJpeg(name);
  // Re-read in case the quote changed in another tab since this page opened.
  quote = store.getQuote(id) || quote;
  const t = quoteTotals(quote.items, quote);
  quote.status = 'approved';
  quote.approval = { name, method: mode === 'draw' ? 'drawn' : 'typed', signature, signedAt: new Date().toISOString(), total: t.total };
  if (!store.saveQuote(quote)) {
    $('accept').disabled = false;
    return err('Could not save the approval: browser storage is full.');
  }
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('download-signed').addEventListener('click', () => {
  const { bytes, filename } = buildQuotePdf({ quote, business });
  download(bytes, filename);
});

render();
document.body.classList.add('ready');
