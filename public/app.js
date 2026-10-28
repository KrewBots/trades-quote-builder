// Trades Quote Builder: the quote editor. All data lives in this browser.
import { quoteTotals, lineAmounts, money, num, trimNum, formatStamp } from './lib/pricing.js';
import { TRADES, suggestItems } from './lib/pricebook.js';
import { SAMPLE_BUSINESS, SAMPLE_JOB, lineFromBook, newId, isExpired } from './lib/model.js';
import { buildQuotePdf } from './lib/quote-pdf.js';
import { paperHtml, esc } from './lib/paper.js';
import { toJpegDataUrl, readFileAsDataUrl, download } from './lib/browser.js';
import * as store from './lib/store.js';

const $ = (id) => document.getElementById(id);

let business = store.loadBusiness();
let book = store.loadPriceBook();
let quote = store.getQuote(store.currentId()) || store.createQuote('plumbing');
let suggestions = [];

// ---------------------------------------------------------------- persistence
function save() {
  if (!store.saveQuote(quote)) toast('Could not save: browser storage is full or disabled.');
}
const locked = () => quote.status === 'approved' || quote.status === 'declined';

// ---------------------------------------------------------------- toasts
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

// ---------------------------------------------------------------- render
const FIELDS = {
  'client-name': ['client', 'name'], 'client-phone': ['client', 'phone'], 'client-email': ['client', 'email'], 'client-address': ['client', 'address'],
  'job-title': ['jobTitle'], description: ['description'], terms: ['terms'],
};
const NUMBERS = { 'labor-rate': 'laborRate', markup: 'markup', tax: 'tax', 'valid-days': 'validDays' };

function renderAll() {
  document.body.classList.remove('trade-plumbing', 'trade-electrical');
  document.body.classList.add(`trade-${quote.trade}`);
  for (const r of document.querySelectorAll('input[name="trade"]')) r.checked = r.value === quote.trade;
  for (const [id, path] of Object.entries(FIELDS)) $(id).value = path.length === 2 ? quote[path[0]][path[1]] || '' : quote[path[0]] || '';
  for (const [id, key] of Object.entries(NUMBERS)) $(id).value = trimNum(quote[key]);
  $('tax-on').value = quote.taxOn === 'parts' ? 'parts' : 'all';
  $('quote-number').textContent = quote.number;
  renderItems();
  renderSuggestions();
  renderTotals();
  renderStatus();
  $('quote-count').textContent = Object.keys(store.loadQuotes()).length;
}

function renderStatus() {
  const s = $('status');
  const expired = quote.status !== 'approved' && isExpired(quote);
  const state = expired ? 'expired' : quote.status;
  s.dataset.state = state;
  const approved = quote.status === 'approved';
  $('status-text').textContent = {
    draft: 'Draft',
    sent: quote.delivery === 'email' ? `Emailed to ${quote.email?.to || 'customer'}: awaiting approval` : 'Awaiting customer signature',
    approved: `Approved ${formatStamp(quote.approval?.signedAt)}`,
    declined: `Declined ${formatStamp(quote.decline?.at)}${quote.decline?.reason ? `: "${quote.decline.reason}"` : ''}`,
    expired: 'Expired: update the valid-for days',
  }[state];
  $('lockable').disabled = locked();
  $('sum-approved').hidden = !approved;
  $('approved-stamp').textContent = approved ? `${quote.approval.name} · ${formatStamp(quote.approval.signedAt)}` : '';
  $('send').hidden = locked();
  $('download-signed').hidden = !approved;
  $('download-pdf').hidden = approved;
  $('summary').classList.toggle('is-approved', approved);
  const fu = quote.delivery === 'email' && quote.email?.server;
  $('fu-line').hidden = !fu;
  $('fu-line').textContent = fu ? followUpText(quote) : '';
}

function renderTotals() {
  const t = quoteTotals(quote.items, quote);
  const prev = $('total').textContent;
  $('total').textContent = money(t.total);
  $('mobile-total').textContent = money(t.total);
  if (prev !== $('total').textContent) {
    for (const el of [$('total'), $('mobile-total')]) {
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }
  }
  $('sum-labor').textContent = money(t.labor);
  $('sum-hours').textContent = t.hours ? `${trimNum(t.hours)} hrs` : '';
  $('sum-parts').textContent = money(t.parts);
  $('sum-subtotal').textContent = money(t.subtotal);
  $('sum-tax-label').textContent = `Tax ${trimNum(t.taxRate)}%${quote.taxOn === 'parts' ? ' (materials)' : ''}`;
  $('sum-tax').textContent = money(t.tax);
  $('sum-trade').textContent = TRADES[quote.trade].label;
  t.lines.forEach((l, i) => {
    const el = document.querySelector(`#items [data-lid="${quote.items[i].lid}"] .item-amount`);
    if (el) el.textContent = money(l.amount);
  });
}

function renderItems() {
  const ul = $('items');
  ul.innerHTML = quote.items.map((it) => {
    const l = lineAmounts(it, quote);
    return `<li class="item" data-lid="${esc(it.lid)}">
      <div class="item-top">
        <input class="item-name" data-f="name" value="${esc(it.name)}" aria-label="Item description">
        <button type="button" class="icon-btn" data-act="remove" aria-label="Remove ${esc(it.name)}">&times;</button>
      </div>
      <div class="item-bottom">
        <div class="stepper" aria-label="Quantity">
          <button type="button" data-act="dec" aria-label="Less">&minus;</button>
          <input data-f="qty" inputmode="decimal" value="${trimNum(it.qty)}" aria-label="Quantity">
          <button type="button" data-act="inc" aria-label="More">+</button>
        </div>
        <label class="mini"><input data-f="hours" inputmode="decimal" value="${trimNum(it.hours)}" aria-label="Labor hours each"><i>hrs</i></label>
        <label class="mini"><i>$</i><input data-f="parts" inputmode="decimal" value="${trimNum(it.parts)}" aria-label="Materials cost each"></label>
        <b class="item-amount">${money(l.amount)}</b>
      </div>
    </li>`;
  }).join('');
  $('items-empty').hidden = quote.items.length > 0;
  $('item-count').textContent = quote.items.length;
}

function renderSuggestions() {
  suggestions = suggestItems(quote.description, book, { trade: quote.trade });
  const added = new Set(quote.items.map((i) => i.ref));
  $('suggestions').innerHTML = suggestions.map((s, i) => {
    const on = added.has(s.item.id);
    const cost = lineAmounts({ ...s.item, qty: s.qty }, quote).amount;
    return `<li class="sugg${on ? ' is-added' : ''}">
      <button type="button" data-sugg="${i}" ${on ? 'disabled' : ''}>
        <span class="sugg-plus" aria-hidden="true">${on ? '&#10003;' : '+'}</span>
        <span class="sugg-name">${s.qty > 1 ? `${s.qty} &times; ` : ''}${esc(s.item.name)}</span>
        <span class="sugg-price">${money(cost)}</span>
      </button></li>`;
  }).join('');
  const open = suggestions.filter((s) => !added.has(s.item.id)).length;
  $('add-all').hidden = open < 2;
  $('suggest-label').textContent = suggestions.length
    ? `${suggestions.length} matching item${suggestions.length === 1 ? '' : 's'}`
    : quote.description.trim().length > 2 ? 'No matches yet. Try words like "faucet", "outlet", "water heater".' : 'Suggestions appear as you type.';
}

// ---------------------------------------------------------------- editing
function addLine(item, qty = 1) {
  if (locked()) return;
  const existing = quote.items.find((i) => i.ref === item.id);
  if (existing) existing.qty = num(existing.qty) + qty;
  else quote.items.push(lineFromBook(item, qty));
  save();
  renderItems();
  renderSuggestions();
  renderTotals();
}

for (const r of document.querySelectorAll('input[name="trade"]')) {
  r.addEventListener('change', () => {
    const prev = TRADES[quote.trade].rate;
    quote.trade = r.value;
    if (num(quote.laborRate) === prev) quote.laborRate = TRADES[quote.trade].rate;
    save();
    renderAll();
  });
}

let suggestTimer;
for (const [id, path] of Object.entries(FIELDS)) {
  $(id).addEventListener('input', (e) => {
    if (path.length === 2) quote[path[0]][path[1]] = e.target.value;
    else quote[path[0]] = e.target.value;
    save();
    if (id === 'description') {
      clearTimeout(suggestTimer);
      suggestTimer = setTimeout(renderSuggestions, 150);
    }
  });
}
for (const [id, key] of Object.entries(NUMBERS)) {
  $(id).addEventListener('input', (e) => {
    quote[key] = num(e.target.value, key === 'validDays' ? 3650 : 1e6);
    save();
    renderTotals();
    renderSuggestions();
    if (key === 'validDays') renderStatus();
  });
  $(id).addEventListener('blur', (e) => { e.target.value = trimNum(quote[key]); });
}
$('tax-on').addEventListener('change', (e) => {
  quote.taxOn = e.target.value;
  save();
  renderTotals();
});

$('suggestions').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sugg]');
  if (!b) return;
  const s = suggestions[Number(b.dataset.sugg)];
  addLine(s.item, s.qty);
});
$('add-all').addEventListener('click', () => {
  const added = new Set(quote.items.map((i) => i.ref));
  for (const s of suggestions) if (!added.has(s.item.id)) quote.items.push(lineFromBook(s.item, s.qty));
  save();
  renderItems();
  renderSuggestions();
  renderTotals();
});

$('items').addEventListener('input', (e) => {
  const li = e.target.closest('[data-lid]');
  const f = e.target.dataset.f;
  if (!li || !f) return;
  const it = quote.items.find((i) => i.lid === li.dataset.lid);
  it[f] = f === 'name' ? e.target.value : num(e.target.value, f === 'parts' ? 1e7 : 10000);
  save();
  renderTotals();
});
$('items').addEventListener('focusout', (e) => {
  const li = e.target.closest('[data-lid]');
  const f = e.target.dataset.f;
  if (!li || !f || f === 'name') return;
  const it = quote.items.find((i) => i.lid === li.dataset.lid);
  if (it) e.target.value = trimNum(it[f]);
});
$('items').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  const li = e.target.closest('[data-lid]');
  if (!b || !li || locked()) return;
  const idx = quote.items.findIndex((i) => i.lid === li.dataset.lid);
  const it = quote.items[idx];
  if (b.dataset.act === 'remove') quote.items.splice(idx, 1);
  else if (b.dataset.act === 'inc') it.qty = num(it.qty) + 1;
  else if (b.dataset.act === 'dec') it.qty = Math.max(1, num(it.qty) - 1);
  save();
  renderItems();
  renderSuggestions();
  renderTotals();
});

// ---------------------------------------------------------------- price book
let bookTrade = quote.trade;
function bookEdits() { return store.loadBookEdits(); }
function renderBook() {
  const q = $('book-search').value.trim().toLowerCase();
  const editing = $('book-edit').checked;
  for (const b of document.querySelectorAll('[data-book-trade]')) b.setAttribute('aria-selected', String(b.dataset.bookTrade === bookTrade));
  const list = book.filter((i) => i.trade === bookTrade && (!q || i.name.toLowerCase().includes(q) || (i.keywords || []).some((k) => k.includes(q))));
  $('book').classList.toggle('is-editing', editing);
  $('book-hint').textContent = editing
    ? 'Changes save on this device and apply to new line items.'
    : 'Tap an item to add it to the quote.';
  $('book').innerHTML = list.map((i) => (editing
    ? `<li class="book-row edit" data-id="${esc(i.id)}">
        <input data-bf="name" value="${esc(i.name)}" aria-label="Name">
        <label class="mini"><input data-bf="hours" inputmode="decimal" value="${trimNum(i.hours)}" aria-label="Labor hours"><i>hrs</i></label>
        <label class="mini"><i>$</i><input data-bf="parts" inputmode="decimal" value="${trimNum(i.parts)}" aria-label="Materials cost"></label>
      </li>`
    : `<li class="book-row"><button type="button" data-add="${esc(i.id)}">
        <span class="book-name">${esc(i.name)}${i.custom ? ' <em>custom</em>' : ''}</span>
        <span class="book-meta">${trimNum(i.hours)} hrs · ${money(i.parts)} materials</span>
        <span class="book-price">${money(lineAmounts({ ...i, qty: 1 }, quote).amount)}</span>
      </button></li>`)).join('') || '<li class="empty">No items match.</li>';
}
$('open-book').addEventListener('click', () => {
  bookTrade = quote.trade;
  $('book-search').value = '';
  $('book-edit').checked = false;
  renderBook();
  $('dlg-book').showModal();
});
$('book-search').addEventListener('input', renderBook);
$('book-edit').addEventListener('change', renderBook);
for (const b of document.querySelectorAll('[data-book-trade]')) b.addEventListener('click', () => { bookTrade = b.dataset.bookTrade; renderBook(); });
$('book').addEventListener('click', (e) => {
  const b = e.target.closest('[data-add]');
  if (!b) return;
  const item = book.find((i) => i.id === b.dataset.add);
  addLine(item);
  toast(`Added: ${item.name}`);
});
$('book').addEventListener('input', (e) => {
  const li = e.target.closest('[data-id]');
  const f = e.target.dataset.bf;
  if (!li || !f) return;
  const edits = bookEdits();
  const id = li.dataset.id;
  const value = f === 'name' ? e.target.value : num(e.target.value, f === 'parts' ? 1e7 : 1000);
  const custom = (edits.custom || []).find((c) => c.id === id);
  if (custom) custom[f] = value;
  else {
    edits.items = edits.items || {};
    edits.items[id] = { ...edits.items[id], [f]: value };
  }
  store.saveBookEdits(edits);
  book = store.loadPriceBook();
});
$('book-reset').addEventListener('click', () => {
  if (!confirm('Reset every price-book item to the built-in defaults? Custom items are removed.')) return;
  store.saveBookEdits({ items: {}, custom: [] });
  book = store.loadPriceBook();
  renderBook();
  renderSuggestions();
  toast('Price book reset');
});
$('book-custom').addEventListener('click', () => {
  const edits = bookEdits();
  edits.custom = edits.custom || [];
  edits.custom.push({ id: `c-${newId()}`, trade: bookTrade, name: 'Custom item', hours: 1, parts: 0, keywords: [] });
  store.saveBookEdits(edits);
  book = store.loadPriceBook();
  $('book-edit').checked = true;
  renderBook();
  const rows = $('book').querySelectorAll('[data-bf="name"]');
  rows[rows.length - 1]?.select();
});

// ---------------------------------------------------------------- business
function renderBusiness() {
  $('biz-name').value = business.name;
  $('biz-license').value = business.license;
  $('biz-phone').value = business.phone;
  $('biz-email').value = business.email;
  $('biz-address').value = business.address;
  $('logo-preview').hidden = !business.logo;
  $('logo-empty').hidden = !!business.logo;
  if (business.logo) $('logo-preview').src = business.logo;
  else $('logo-preview').removeAttribute('src');
}
let pendingLogo = null;
$('open-business').addEventListener('click', () => {
  pendingLogo = null;
  renderBusiness();
  $('dlg-business').showModal();
});
$('logo-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const maxLogo = config.limits?.logoFileBytes || 8 * 1024 * 1024;
  if (file.size > maxLogo) { toast(`Logo file is too large (${Math.round(maxLogo / 1024 / 1024)} MB max).`); return; }
  try {
    pendingLogo = await toJpegDataUrl(await readFileAsDataUrl(file), 480);
    $('logo-preview').src = pendingLogo;
    $('logo-preview').hidden = false;
    $('logo-empty').hidden = true;
  } catch (err) {
    toast(err.message);
  }
});
$('logo-remove').addEventListener('click', () => {
  pendingLogo = '';
  $('logo-preview').hidden = true;
  $('logo-preview').removeAttribute('src');
  $('logo-empty').hidden = false;
});
$('dlg-business').addEventListener('close', () => {
  if ($('dlg-business').returnValue !== 'save') return;
  business = {
    name: $('biz-name').value.trim(), license: $('biz-license').value.trim(), phone: $('biz-phone').value.trim(),
    email: $('biz-email').value.trim(), address: $('biz-address').value.trim(), logo: pendingLogo ?? business.logo,
  };
  if (!store.saveBusiness(business)) toast('Could not save: browser storage is full.');
  else toast('Business details saved');
});

// ---------------------------------------------------------------- PDF
function needsItems() {
  if (quote.items.length) return false;
  toast('Add at least one line item first.');
  return true;
}
function downloadPdf() {
  if (needsItems()) return;
  const { bytes, filename } = buildQuotePdf({ quote, business });
  download(bytes, filename);
  toast(`Saved ${filename}`);
}
$('preview-pdf').addEventListener('click', () => {
  $('paper').innerHTML = paperHtml(quote, business);
  $('dlg-preview').showModal();
});
$('download-pdf').addEventListener('click', downloadPdf);
$('preview-download').addEventListener('click', downloadPdf);
$('download-signed').addEventListener('click', downloadPdf);

// ---------------------------------------------------------------- quote server (emailed quotes)
let config = { demo: false, email: { configured: false, mock: false, reason: "Email isn't set up." }, followUpDefaults: [2, 5] };

async function api(path, { method = 'GET', body, ownerKey } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (ownerKey) headers['X-Owner-Key'] = ownerKey;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || data.error || `Request failed (${res.status})`), { status: res.status, code: data.error });
  return data;
}

const shortDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** "Follow-up sent Oct 30 · next follow-up Nov 2", or why reminders stopped. */
function followUpText(q) {
  const f = q.email?.server?.followUps;
  if (!f) return '';
  const stopped = { approved: 'Follow-ups stopped: approved', declined: 'Follow-ups stopped: declined', off: 'Follow-ups off', expired: 'Follow-ups ended: quote expired' }[f.stopped];
  const last = f.sent.length ? f.sent[f.sent.length - 1] : null;
  const parts = [];
  if (last) parts.push(`Follow-up sent ${shortDate(last.at)}`);
  if (stopped) parts.push(stopped);
  else if (f.next) parts.push(`${last ? 'next' : 'Next'} follow-up ${shortDate(f.next)}`);
  else if (!last) parts.push('No follow-ups scheduled');
  return parts.join(' · ');
}

/** Copy server status into a local quote. Returns true when the approval state changed. */
function applyServerStatus(q, st) {
  q.email = { ...q.email, server: { status: st.status, sentAt: st.sentAt, expiresAt: st.expiresAt, followUps: st.followUps } };
  q.email.followUps = { enabled: st.followUps.enabled, days: st.followUps.days };
  if (st.status === 'approved' && q.status !== 'approved') {
    q.status = 'approved';
    q.approval = st.approval;
    return true;
  }
  if (st.status === 'declined' && q.status !== 'declined') {
    q.status = 'declined';
    q.decline = st.decline;
    return true;
  }
  return false;
}

/** Fetch the server status of every emailed quote that is still open. */
async function pollEmailed() {
  const all = Object.values(store.loadQuotes()).map((q) => (q.id === quote.id ? quote : q));
  for (const q of all) {
    if (q.delivery !== 'email' || !q.email?.ownerKey) continue;
    if (q.status !== 'sent' && q.email.server?.followUps?.stopped) continue;
    try {
      const changed = applyServerStatus(q, await api(`/api/quotes/${q.id}/status`, { ownerKey: q.email.ownerKey }));
      store.saveQuote(q);
      if (q === quote) {
        if (changed) {
          renderAll();
          toast(q.status === 'approved' ? `Approved by ${q.approval.name}` : 'The customer declined this quote');
        } else renderStatus();
      }
    } catch { /* server unreachable: try again on the next poll */ }
  }
}
setInterval(() => { if (!document.hidden) pollEmailed(); }, 3000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollEmailed(); });

// ---------------------------------------------------------------- send / approve
let sendMode = 'onsite';
function renderSendMode() {
  for (const b of document.querySelectorAll('[data-send-mode]')) b.setAttribute('aria-selected', String(b.dataset.sendMode === sendMode));
  $('send-onsite').hidden = sendMode !== 'onsite';
  $('send-email').hidden = sendMode !== 'email';
  if (sendMode === 'email') renderEmailPane();
}
function renderEmailPane() {
  const cfg = config.email;
  $('email-off').hidden = cfg.configured;
  // Only show the server's reason when it adds detail (e.g. which setting is missing).
  $('email-off-reason').textContent = cfg.reason || '';
  $('email-off-reason').hidden = !cfg.reason || cfg.reason === "Email isn't set up.";
  $('email-form').hidden = !cfg.configured;
  if (!cfg.configured) return;
  $('email-mock').hidden = !cfg.mock;
  const e = quote.email || {};
  if (document.activeElement !== $('email-to')) $('email-to').value = e.to || quote.client.email || '';
  const fu = e.followUps || { enabled: true, days: config.followUpDefaults };
  $('fu-enabled').checked = fu.enabled !== false;
  if (document.activeElement !== $('fu-days')) $('fu-days').value = fu.days.join(', ');
  const sent = quote.delivery === 'email' && e.sentAt;
  $('email-sent').hidden = !sent;
  if (sent) {
    $('email-sent-title').textContent = `${cfg.mock ? 'Sent to the demo Outbox for' : 'Emailed to'} ${e.to}`;
    $('email-sent-detail').textContent = `Sent ${formatStamp(e.sentAt)}`;
    $('email-fu-detail').textContent = followUpText(quote);
  }
  const open = quote.status !== 'approved' && quote.status !== 'declined';
  $('email-send').textContent = sent ? 'Resend email' : 'Send email';
  $('email-send').disabled = !open;
  $('fu-save').hidden = !(sent && open);
}

$('send').addEventListener('click', () => {
  if (needsItems()) return;
  if (!business.name) toast('Tip: add your business name under Business.');
  const path = `/approve/${quote.id}`;
  $('approve-url').textContent = location.origin + path;
  $('open-approve').href = path;
  $('email-error').textContent = '';
  sendMode = quote.delivery === 'email' ? 'email' : 'onsite';
  renderSendMode();
  $('dlg-send').showModal();
});
for (const b of document.querySelectorAll('[data-send-mode]')) b.addEventListener('click', () => { sendMode = b.dataset.sendMode; renderSendMode(); });

// On site: marked as sent when the approval page is opened (the customer signs on this device).
$('open-approve').addEventListener('click', () => {
  if (quote.status === 'draft') {
    quote.status = 'sent';
    quote.delivery = 'onsite';
    quote.sentAt = new Date().toISOString();
    save();
  }
});

$('email-send').addEventListener('click', async () => {
  const btn = $('email-send');
  const to = $('email-to').value.trim();
  $('email-error').textContent = '';
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    const r = await api('/api/quotes/send', {
      method: 'POST',
      ownerKey: quote.email?.ownerKey,
      body: { quote, business, to, followUps: { enabled: $('fu-enabled').checked, days: $('fu-days').value } },
    });
    quote.email = { ...quote.email, to, ownerKey: r.ownerKey || quote.email?.ownerKey, link: r.link, sentAt: r.sentAt };
    applyServerStatus(quote, r);
    quote.delivery = 'email';
    quote.status = 'sent';
    quote.sentAt = r.sentAt;
    save();
    renderStatus();
    toast(r.mock ? 'Added to the demo Outbox (not really sent)' : `Emailed to ${to}`);
    refreshOutboxCount();
  } catch (e) {
    $('email-error').textContent = e.code === 'email_not_configured' ? "Email isn't set up." : e.message;
  } finally {
    renderEmailPane();
  }
});

$('fu-save').addEventListener('click', async () => {
  $('email-error').textContent = '';
  try {
    const st = await api(`/api/quotes/${quote.id}/followups`, {
      method: 'POST', ownerKey: quote.email.ownerKey, body: { enabled: $('fu-enabled').checked, days: $('fu-days').value },
    });
    applyServerStatus(quote, st);
    save();
    renderStatus();
    renderEmailPane();
    toast(st.followUps.enabled ? `Follow-ups after ${st.followUps.days.join(' and ')} days` : 'Follow-ups off');
  } catch (e) {
    $('email-error').textContent = e.message;
  }
});

// On-site approval may happen in another tab: pick it up live.
window.addEventListener('storage', (e) => {
  if (e.key === store.STORAGE_KEYS.quotes) {
    const fresh = store.getQuote(quote.id);
    if (fresh) { quote = fresh; renderAll(); }
  }
});

// ---------------------------------------------------------------- quotes
const STATUS_LABEL = { approved: 'Approved', declined: 'Declined', sent: 'Sent', draft: 'Draft' };
function renderQuoteList() {
  const all = Object.values(store.loadQuotes()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  $('quote-list').innerHTML = all.map((q) => `<li><button type="button" data-open="${esc(q.id)}" class="${q.id === quote.id ? 'is-current' : ''}">
      <span class="ql-num">${esc(q.number)}</span>
      <span class="ql-name">${esc(q.client?.name || 'No client')}<small>${esc(q.jobTitle || TRADES[q.trade].label)}</small></span>
      <span class="ql-total">${money(quoteTotals(q.items, q).total)}</span>
      <span class="ql-status" data-state="${esc(q.status)}">${q.status === 'sent' && q.delivery === 'email' ? 'Emailed' : STATUS_LABEL[q.status] || 'Draft'}</span>
      ${q.delivery === 'email' && q.email?.server ? `<span class="ql-fu" data-testid="ql-fu">${esc(followUpText(q))}</span>` : ''}
    </button></li>`).join('');
}
$('open-quotes').addEventListener('click', async () => {
  renderQuoteList();
  $('dlg-quotes').showModal();
  await pollEmailed();
  renderQuoteList();
});
$('quote-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-open]');
  if (!b) return;
  quote = store.getQuote(b.dataset.open);
  store.setCurrent(quote.id);
  $('dlg-quotes').close();
  renderAll();
});

// ---------------------------------------------------------------- demo outbox + time travel
let outboxEmails = [];
async function refreshOutboxCount() {
  if (!config.email.mock) return;
  try {
    outboxEmails = (await api('/api/outbox')).emails;
    $('outbox-count').textContent = outboxEmails.length;
  } catch { /* ignore */ }
}
function renderOutbox(selectedId) {
  const sel = selectedId || outboxEmails[0]?.id;
  $('outbox-list').innerHTML = outboxEmails.map((m) => `<li><div class="ob-item${m.id === sel ? ' is-current' : ''}" data-mail="${esc(m.id)}">
      <button type="button" class="ob-open" data-mail-open="${esc(m.id)}">
        <span class="ob-kind" data-kind="${esc(m.kind)}">${m.kind === 'followup' ? `Follow-up ${m.n}` : 'Quote'}</span>
        <span class="ob-subj">${esc(m.subject)}</span>
        <span class="ob-meta">To ${esc(m.to)} · ${esc(formatStamp(m.at))}</span>
      </button>
      <span class="ob-actions"><a href="/api/outbox/${esc(m.id)}/attachment/0" download>PDF</a>${m.link ? ` · <a href="${esc(m.link)}" target="_blank" rel="noopener" data-testid="ob-link">Open review link</a>` : ''}</span>
    </div></li>`).join('');
  $('outbox-empty').hidden = outboxEmails.length > 0;
  $('outbox-frame').hidden = !sel;
  if (sel && $('outbox-frame').dataset.id !== sel) {
    $('outbox-frame').dataset.id = sel;
    $('outbox-frame').src = `/api/outbox/${sel}/html`;
  }
}
async function renderClock() {
  try {
    const c = await api('/api/demo/clock');
    $('clock-now').textContent = `${formatStamp(c.now)}${c.offsetDays ? ` (+${trimNum(c.offsetDays)} days)` : ''}`;
  } catch { /* ignore */ }
}
$('open-outbox').addEventListener('click', async () => {
  await refreshOutboxCount();
  renderOutbox();
  await renderClock();
  $('dlg-outbox').showModal();
});
$('outbox-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mail-open]');
  if (b) renderOutbox(b.dataset.mailOpen);
});
async function travel(body) {
  try {
    const r = await api('/api/demo/clock', { method: 'POST', body });
    await refreshOutboxCount();
    renderOutbox();
    await renderClock();
    await pollEmailed();
    toast(body.reset ? 'Demo clock reset' : r.fired.length ? `${r.fired.length} follow-up${r.fired.length === 1 ? '' : 's'} sent` : `Demo clock +${body.advanceDays} day${body.advanceDays === 1 ? '' : 's'}: no follow-ups due`);
  } catch (e) {
    toast(e.message);
  }
}
for (const b of document.querySelectorAll('[data-advance]')) b.addEventListener('click', () => travel({ advanceDays: Number(b.dataset.advance) }));
$('clock-reset').addEventListener('click', () => travel({ reset: true }));

async function loadConfig() {
  try {
    config = await api('/api/config');
  } catch { /* server without the API: email stays "not set up" */ }
  $('open-outbox').hidden = !(config.demo && config.email.mock);
  await refreshOutboxCount();
}

$('new-quote').addEventListener('click', () => {
  quote = store.createQuote(quote.trade);
  renderAll();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  toast(`Started ${quote.number}`);
});
$('duplicate-quote').addEventListener('click', () => {
  const copy = store.createQuote(quote.trade);
  quote = { ...structuredClone(quote), id: copy.id, number: copy.number, createdAt: copy.createdAt, status: 'draft', sentAt: null, approval: null, decline: null, delivery: null, email: null };
  quote.items = quote.items.map((i) => ({ ...i, lid: newId() }));
  save();
  renderAll();
  toast(`Copied to ${quote.number}`);
});

// ---------------------------------------------------------------- sample job
$('load-sample').addEventListener('click', async () => {
  if (business.name && business.name !== SAMPLE_BUSINESS.name
    && !confirm('Load the sample job? It replaces your business details with a fictional sample business.')) return;
  let logo = '';
  try { logo = await toJpegDataUrl('/sample-logo.svg', 360); } catch { /* sample works without a logo */ }
  business = { ...SAMPLE_BUSINESS, logo };
  store.saveBusiness(business);
  // Reuse an untouched blank quote instead of leaving an empty draft behind.
  const blank = quote.status === 'draft' && !quote.items.length && !quote.client.name && !quote.jobTitle && !quote.description;
  const fresh = blank ? quote : store.createQuote(SAMPLE_JOB.trade);
  quote = { ...fresh, ...structuredClone(SAMPLE_JOB) };
  const picks = suggestItems(quote.description, book, { trade: quote.trade });
  quote.items = picks.map((s) => lineFromBook(s.item, s.qty));
  save();
  renderAll();
  toast('Sample job loaded (fictional business and client)');
});

$('mobile-finish').addEventListener('click', () => $('summary').scrollIntoView({ behavior: 'smooth', block: 'start' }));
for (const d of document.querySelectorAll('dialog')) {
  d.addEventListener('click', (e) => {
    if (e.target === d || e.target.closest('[data-close]')) d.close();
  });
}

renderAll();
loadConfig().finally(() => {
  pollEmailed();
  document.body.classList.add('ready');
});
