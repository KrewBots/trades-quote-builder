// Customer review page for an emailed quote (/review/<publicId>/<token>).
// The quote lives on the contractor's quote server; approving or declining is
// sent back there, and the builder picks it up from the server.
import { formatStamp, formatDate } from './lib/pricing.js';
import { validUntil } from './lib/model.js';
import { paperHtml } from './lib/paper.js';
import { typedSignatureJpeg } from './lib/browser.js';
import { hydrateIcons } from './lib/icons.js';
import { reducedMotion } from './lib/ui.js';
import { renderBrand, renderSummary, renderDone, setBadge, wireSignature } from './lib/customer.js';

const $ = (id) => document.getElementById(id);
hydrateIcons();
const [, , pid, token] = location.pathname.split('/');
const base = `/api/review/${encodeURIComponent(pid || '')}/${encodeURIComponent(token || '')}`;
let data = null;
const sig = wireSignature();

async function call(path, body) {
  const res = await fetch(base + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.message || 'Something went wrong. Please try again.'), { status: res.status });
  return json;
}

function render() {
  const { quote, business, status } = data;
  $('approve-grid').hidden = false;
  const from = business.name || 'Your contractor';
  document.title = `${quote.number} from ${from}`;
  renderBrand(business);
  const approved = status === 'approved' && data.approval;
  const declined = status === 'declined';
  renderSummary(quote);
  $('intro').textContent = declined ? `You declined quote ${quote.number} from ${from}.` : `${from} sent you quote ${quote.number}. Please review it, then sign below.`;
  $('paper').innerHTML = paperHtml({ ...quote, status, approval: data.approval }, business, { showAcceptance: !!approved });
  $('head').hidden = !!approved;
  $('summary-card').hidden = !!approved || declined;
  $('sign-form').hidden = approved || declined;
  $('done').hidden = !approved;
  $('declined').hidden = !declined;
  setBadge(approved ? 'approved' : declined ? 'declined' : 'sign');
  $('approve-grid').classList.toggle('is-done', !!approved || declined);
  if (approved) {
    renderDone(quote, data.approval);
    $('download-signed').href = `${base}/pdf`;
    return;
  }
  if (declined) {
    $('declined-stamp').textContent = `Declined ${formatStamp(data.decline.at)}`;
    return;
  }
  if (!$('signer').value) $('signer').value = quote.client?.name || '';
  if (data.expired) {
    $('sign-error').textContent = `This quote expired on ${formatDate(validUntil(quote))}. Ask your contractor for an updated quote.`;
    $('accept').disabled = true;
    $('decline-open').hidden = true;
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
  err('');
  $('accept').disabled = true;
  try {
    const signature = sig.mode === 'draw' ? sig.pad.toJpeg() : await typedSignatureJpeg(name);
    const r = await call('/approve', { name, method: sig.mode === 'draw' ? 'drawn' : 'typed', signature });
    data = { ...data, status: r.status, approval: r.approval };
    render();
    window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
  } catch (ex) {
    $('accept').disabled = false;
    err(ex.message);
  }
});

$('decline-open').addEventListener('click', () => {
  $('decline-box').hidden = false;
  $('decline-open').hidden = true;
  $('decline-reason').focus();
});
$('decline').addEventListener('click', async () => {
  $('decline').disabled = true;
  try {
    const r = await call('/decline', { reason: $('decline-reason').value });
    data = { ...data, status: r.status, decline: r.decline };
    render();
    window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
  } catch (ex) {
    $('decline').disabled = false;
    $('sign-error').textContent = ex.message;
  }
});

try {
  data = await call('');
  render();
} catch (ex) {
  $('missing').hidden = false;
  if (ex.status !== 404) {
    $('missing-title').textContent = 'Could not load this quote';
    $('missing-text').textContent = ex.message;
  }
}
document.body.classList.add('ready');
