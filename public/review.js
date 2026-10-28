// Customer review page for an emailed quote (/review/<publicId>/<token>).
// The quote lives on the contractor's quote server; approving or declining is
// sent back there, and the builder picks it up from the server.
import { quoteTotals, money, formatStamp, formatDate } from './lib/pricing.js';
import { validUntil } from './lib/model.js';
import { paperHtml } from './lib/paper.js';
import { SignaturePad, typedSignatureJpeg } from './lib/browser.js';

const $ = (id) => document.getElementById(id);
const [, , pid, token] = location.pathname.split('/');
const base = `/api/review/${encodeURIComponent(pid || '')}/${encodeURIComponent(token || '')}`;
let data = null;
let mode = 'draw';
let pad;

async function call(path, body) {
  const res = await fetch(base + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.message || 'Something went wrong. Please try again.'), { status: res.status });
  return json;
}

function render() {
  const { quote, business, status } = data;
  $('approve-grid').hidden = false;
  document.body.classList.add(`trade-${quote.trade}`);
  const from = business.name || 'Your contractor';
  document.title = `${quote.number} from ${from}`;
  const approved = status === 'approved' && data.approval;
  const declined = status === 'declined';
  $('intro').textContent = approved ? `Your signed copy of quote ${quote.number} from ${from}.`
    : declined ? `You declined quote ${quote.number} from ${from}.`
      : `${from} sent you quote ${quote.number}. Please review it, then sign below.`;
  $('paper').innerHTML = paperHtml({ ...quote, status, approval: data.approval }, business, { showAcceptance: !!approved });
  $('sign-total').textContent = money(quoteTotals(quote.items, quote).total);
  $('sign-form').hidden = approved || declined;
  $('done').hidden = !approved;
  $('declined').hidden = !declined;
  $('top-badge').textContent = approved ? 'Approved' : declined ? 'Declined' : 'Review & sign';
  $('top-badge').classList.toggle('is-approved', !!approved);
  $('approve-grid').classList.toggle('is-approved', approved || declined);
  if (approved) {
    $('done-stamp').textContent = `Signed by ${data.approval.name} on ${formatStamp(data.approval.signedAt)}`;
    $('done-total').textContent = `Accepted total ${money(data.approval.total)}`;
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
  if (!pad) pad = new SignaturePad($('pad'), { onChange: (empty) => $('pad-wrap').classList.toggle('has-ink', !empty) });
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
  err('');
  $('accept').disabled = true;
  try {
    const signature = mode === 'draw' ? pad.toJpeg() : await typedSignatureJpeg(name);
    const r = await call('/approve', { name, method: mode === 'draw' ? 'drawn' : 'typed', signature });
    data = { ...data, status: r.status, approval: r.approval };
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
