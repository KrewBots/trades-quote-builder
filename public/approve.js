// Customer approval page (/approve/<id>): review the quote, sign, accept.
// Reads and writes the quote in this browser's storage only.
import { quoteTotals, formatDate } from './lib/pricing.js';
import { isExpired, validUntil } from './lib/model.js';
import { buildQuotePdf } from './lib/quote-pdf.js';
import { paperHtml } from './lib/paper.js';
import { typedSignatureJpeg, download } from './lib/browser.js';
import { hydrateIcons } from './lib/icons.js';
import { reducedMotion } from './lib/ui.js';
import { renderBrand, renderSummary, renderDone, setBadge, wireSignature } from './lib/customer.js';
import * as store from './lib/store.js';

const $ = (id) => document.getElementById(id);
hydrateIcons();
const id = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
let quote = store.getQuote(id);
const business = store.loadBusiness();
const sig = wireSignature();

function render() {
  if (!quote) {
    $('missing').hidden = false;
    return;
  }
  $('approve-grid').hidden = false;
  const from = business.name || 'Your contractor';
  document.title = `${quote.number} from ${from}`;
  renderBrand(business);
  renderSummary(quote);
  $('intro').textContent = `${from} sent you quote ${quote.number}. Please review it, then sign below.`;
  const approved = quote.status === 'approved' && quote.approval;
  $('paper').innerHTML = paperHtml(quote, business, { showAcceptance: !!approved });
  $('head').hidden = !!approved;
  $('summary-card').hidden = !!approved;
  $('sign-form').hidden = !!approved;
  $('done').hidden = !approved;
  setBadge(approved ? 'approved' : 'sign');
  $('approve-grid').classList.toggle('is-done', !!approved);
  if (approved) {
    renderDone(quote, quote.approval);
    return;
  }
  if (!$('signer').value) $('signer').value = quote.client?.name || '';
  if (isExpired(quote)) {
    $('sign-error').textContent = `This quote expired on ${formatDate(validUntil(quote))}. Ask your contractor for an updated quote.`;
    $('accept').disabled = true;
  }
  sig.init();
}

$('sign-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('signer').value.trim();
  const err = (m) => { $('sign-error').textContent = m; };
  if (name.length < 2) return err('Please enter your full name.');
  if (sig.mode === 'draw' && sig.pad.isEmpty()) return err('Please sign in the box, or switch to Type.');
  if (!$('agree').checked) return err('Please tick the box to accept the quote.');
  if (isExpired(quote)) return err('This quote has expired.');
  err('');
  $('accept').disabled = true;
  const signature = sig.mode === 'draw' ? sig.pad.toJpeg() : await typedSignatureJpeg(name);
  // Re-read in case the quote changed in another tab since this page opened.
  quote = store.getQuote(id) || quote;
  const t = quoteTotals(quote.items, quote);
  quote.status = 'approved';
  quote.approval = { name, method: sig.mode === 'draw' ? 'drawn' : 'typed', signature, signedAt: new Date().toISOString(), total: t.total };
  if (!store.saveQuote(quote)) {
    $('accept').disabled = false;
    return err('Could not save the approval: browser storage is full.');
  }
  render();
  window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
});

$('download-signed').addEventListener('click', () => {
  const { bytes, filename } = buildQuotePdf({ quote, business });
  download(bytes, filename);
});

render();
document.body.classList.add('ready');
