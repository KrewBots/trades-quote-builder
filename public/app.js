// Trades Quote Builder: the quote editor. All data lives in this browser.
import { quoteTotals, lineAmounts, money, num, trimNum, formatStamp, formatDate } from './lib/pricing.js';
import { TRADES, suggestItems } from './lib/pricebook.js';
import { SAMPLE_BUSINESS, SAMPLE_JOB, lineFromBook, newId, isExpired, validUntil } from './lib/model.js';
import { buildQuotePdf } from './lib/quote-pdf.js';
import { paperHtml, esc } from './lib/paper.js';
import { toJpegDataUrl, readFileAsDataUrl, download } from './lib/browser.js';
import { icon, hydrateIcons, TRADE_ICON } from './lib/icons.js';
import { reducedMotion, countUp, openSheet, closeSheet, wireSheets, revealRow } from './lib/ui.js';
import * as store from './lib/store.js';

const $ = (id) => document.getElementById(id);
hydrateIcons();
wireSheets();

let business = store.loadBusiness();
let book = store.loadPriceBook();
let quote = store.getQuote(store.currentId()) || store.createQuote('plumbing');
let suggestions = [];
let editingLid = null; // the one line item open for editing

// ---------------------------------------------------------------- persistence
function save() {
  if (!store.saveQuote(quote)) toast('Could not save: browser storage is full or disabled.');
}
const locked = () => quote.status === 'approved' || quote.status === 'declined';

// ---------------------------------------------------------------- toasts
let toastTimer;
function toast(msg, sub = '', ico = 'circle-check') {
  const t = $('toast');
  t.innerHTML = `${icon(ico)}<div>${esc(msg)}${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ---------------------------------------------------------------- render
const FIELDS = {
  'client-name': ['client', 'name'], 'client-phone': ['client', 'phone'], 'client-email': ['client', 'email'], 'client-address': ['client', 'address'],
  'job-title': ['jobTitle'], description: ['description'], terms: ['terms'],
};
const NUMBERS = { 'labor-rate': 'laborRate', markup: 'markup', tax: 'tax', 'valid-days': 'validDays' };
/** "$1,150" for whole dollars, "$12.50" otherwise: the short form used in item meta lines. */
const shortMoney = (v) => (Number.isInteger(num(v)) ? money(v).replace(/\.00$/, '') : money(v));
const hrs = (h) => `${trimNum(h)} hr${num(h) === 1 ? '' : 's'}`;

function renderAll() {
  for (const r of document.querySelectorAll('input[name="trade"]')) r.checked = r.value === quote.trade;
  for (const [id, path] of Object.entries(FIELDS)) $(id).value = path.length === 2 ? quote[path[0]][path[1]] || '' : quote[path[0]] || '';
  for (const [id, key] of Object.entries(NUMBERS)) $(id).value = trimNum(quote[key]);
  renderTaxOn();
  $('quote-number').textContent = quote.number;
  renderItems();
  renderSuggestions();
  renderTotals();
  renderStatus();
  renderHead();
  const n = Object.keys(store.loadQuotes()).length;
  setBadge('quote-count', n);
  $('open-quotes').setAttribute('aria-label', `Quotes, ${n} saved`);
}

function setBadge(id, n) {
  $(id).textContent = n;
  $(id).classList.toggle('is-zero', !n);
}

function renderTaxOn() {
  for (const b of document.querySelectorAll('[data-tax-on]')) b.setAttribute('aria-checked', String(b.dataset.taxOn === (quote.taxOn === 'parts' ? 'parts' : 'all')));
}

/** Page title, lead and the sample card / sample link placement. */
function renderHead() {
  $('page-title').textContent = quote.jobTitle?.trim() || 'New quote';
  const empty = !quote.items.length;
  $('page-lead').hidden = !(empty && !quote.jobTitle?.trim() && quote.status === 'draft');
  // One #load-sample button: a full card while the quote is empty, a quiet link next to New quote / Duplicate after.
  const btn = $('load-sample');
  if (empty) {
    $('sample-slot').append(btn);
    btn.className = 'btn btn-ink btn-md btn-block';
    btn.textContent = 'Load sample job';
  } else {
    $('total-foot').append(btn);
    btn.className = 'link quiet';
    btn.innerHTML = `${icon('briefcase')}Load sample job`;
  }
  $('sample-card').hidden = !empty;
}

const PILL = {
  draft: ['pill-neutral', '<span class="dot"></span>', 'Draft'],
  emailed: ['pill-accent', icon('mail'), 'Emailed'],
  onsite: ['pill-accent', icon('pen-line'), 'Sent'],
  approved: ['pill-success', icon('circle-check'), 'Approved'],
  declined: ['pill-danger', icon('circle-x'), 'Declined'],
  expired: ['pill-neutral', icon('hourglass'), 'Expired'],
};
function statePill(q) {
  if (q.status === 'approved') return PILL.approved;
  if (q.status === 'declined') return PILL.declined;
  if (isExpired(q)) return PILL.expired;
  if (q.status === 'sent') return q.delivery === 'email' ? PILL.emailed : PILL.onsite;
  return PILL.draft;
}
const pillHtml = ([cls, ico, label]) => `<span class="pill ${cls}">${ico}${label}</span>`;

function renderStatus() {
  const s = $('status');
  const expired = quote.status !== 'approved' && isExpired(quote);
  const state = expired ? 'expired' : quote.status;
  s.dataset.state = state;
  const approved = quote.status === 'approved';
  const [cls, ico, label] = statePill(quote);
  $('status-pill').className = `pill ${cls}`;
  $('status-pill').innerHTML = `${ico}${label}`;
  $('status-text').textContent = {
    draft: 'Draft',
    sent: quote.delivery === 'email' ? `Emailed to ${quote.email?.to || 'customer'}: awaiting approval` : 'Awaiting customer signature',
    approved: `Approved ${formatStamp(quote.approval?.signedAt)}`,
    declined: `Declined ${formatStamp(quote.decline?.at)}${quote.decline?.reason ? `: "${quote.decline.reason}"` : ''}`,
    expired: 'Expired: update the valid-for days',
  }[state];
  $('status-text').hidden = state === 'draft';
  $('lockable').disabled = locked();
  if (locked()) editingLid = null;
  $('sum-approved').hidden = !approved;
  if (approved) {
    const a = quote.approval;
    $('approved-stamp').innerHTML = `<b>Approved by ${esc(a.name)}</b><br><span class="num">${esc(formatStamp(a.signedAt))} · ${quote.delivery === 'email' ? 'signed on the review link' : 'signed on site'}</span>`;
  } else $('approved-stamp').textContent = '';
  $('send').hidden = locked();
  $('download-signed').hidden = !approved;
  $('download-pdf').hidden = approved;
  // Approved: Preview + Duplicate pair under the signed download; otherwise Duplicate is a quiet link.
  const dup = $('duplicate-quote');
  if (approved) { $('action-pair').append(dup); dup.className = 'btn btn-secondary btn-md'; $('preview-label').textContent = 'Preview'; }
  else { $('total-foot').insertBefore(dup, $('new-quote').nextSibling); dup.className = 'link quiet'; $('preview-label').textContent = 'Preview PDF'; }
  $('summary').classList.toggle('is-approved', approved);
  const fu = quote.delivery === 'email' && quote.email?.server;
  $('fu-line').hidden = !fu;
  $('fu-line').textContent = fu ? followUpText(quote) : '';
}

let shownTotal = null;
function renderTotals() {
  const t = quoteTotals(quote.items, quote);
  const from = shownTotal ?? t.total;
  shownTotal = t.total;
  countUp([$('total'), $('mobile-total')], from, t.total);
  $('sum-labor').textContent = money(t.labor);
  $('sum-hours').textContent = t.hours ? `${trimNum(t.hours)} hrs` : '';
  $('sum-parts').textContent = money(t.parts);
  $('sum-subtotal').textContent = money(t.subtotal);
  $('sum-tax-label').innerHTML = `Tax<small>${trimNum(t.taxRate)}%${quote.taxOn === 'parts' ? ' on materials' : ''}</small>`;
  $('sum-tax').textContent = money(t.tax);
  $('sum-trade').textContent = TRADES[quote.trade].label;
  $('sum-trade-pill').firstElementChild.outerHTML = icon(TRADE_ICON[quote.trade]);
  t.lines.forEach((l, i) => {
    const li = document.querySelector(`#items [data-lid="${quote.items[i].lid}"]`);
    if (!li) return;
    li.querySelector('.item-amt').textContent = money(l.amount);
    li.querySelector('.item-meta').textContent = itemMeta(quote.items[i]);
  });
}

const itemMeta = (it) => `${trimNum(it.qty)} × ${hrs(it.hours)} labor · ${shortMoney(it.parts)} materials`;

function renderItems(fresh = []) {
  const ul = $('items');
  ul.innerHTML = quote.items.map((it) => {
    const l = lineAmounts(it, quote);
    const open = it.lid === editingLid;
    const lid = esc(it.lid);
    return `<li class="item${open ? ' is-editing' : ''}" data-lid="${lid}">
      <button type="button" class="item-row" aria-expanded="${open}" aria-controls="edit-${lid}" data-act="toggle">
        <span class="item-top"><span class="item-name">${esc(it.name)}</span><span class="item-amt num">${money(l.amount)}</span></span>
        <span class="item-meta num">${esc(itemMeta(it))}</span>
      </button>
      <div class="item-edit" id="edit-${lid}"${open ? '' : ' hidden'}>
        <label class="field"><span>Description</span><input class="input" data-f="name" value="${esc(it.name)}"></label>
        <div class="item-ctl">
          <div class="stepper" role="group" aria-label="Quantity">
            <button type="button" data-act="dec" aria-label="Less">${icon('minus', 'ico-16')}</button>
            <input class="num" data-f="qty" inputmode="decimal" value="${trimNum(it.qty)}" aria-label="Quantity">
            <button type="button" data-act="inc" aria-label="More">${icon('plus', 'ico-16')}</button>
          </div>
          <label class="affix"><input data-f="hours" inputmode="decimal" value="${trimNum(it.hours)}" aria-label="Labor hours each"><i>hrs</i></label>
          <label class="affix"><i>$</i><input data-f="parts" inputmode="decimal" value="${trimNum(it.parts)}" aria-label="Materials cost each"></label>
        </div>
        <div class="item-actions">
          <button class="link danger" type="button" data-act="remove" aria-label="Remove ${esc(it.name)}">${icon('trash-2')}Remove</button>
          <button class="link" type="button" data-act="done">Done</button>
        </div>
      </div>
    </li>`;
  }).join('');
  $('items-empty').hidden = quote.items.length > 0;
  $('item-count').textContent = quote.items.length;
  for (const lid of fresh) {
    const li = ul.querySelector(`[data-lid="${CSS.escape(lid)}"]`);
    if (li) revealRow(li);
  }
}

function renderSuggestions() {
  suggestions = suggestItems(quote.description, book, { trade: quote.trade });
  const added = new Set(quote.items.map((i) => i.ref));
  $('suggestions').innerHTML = suggestions.map((s, i) => {
    const on = added.has(s.item.id);
    const cost = lineAmounts({ ...s.item, qty: s.qty }, quote).amount;
    const name = `${s.qty > 1 ? `${s.qty} × ` : ''}${s.item.name}`;
    return `<li class="sugg${on ? ' is-added' : ''}">
      <button type="button" class="row" data-sugg="${i}" aria-pressed="${on}" aria-label="${esc(`${on ? 'Remove' : 'Add'} ${name}, ${money(cost)}`)}">
        <span class="row-lead">${icon(on ? 'circle-check' : 'circle-plus', 'ico-24')}</span>
        <span class="row-main"><span class="row-title">${esc(name)}</span><span class="row-meta">${hrs(s.item.hours)} · ${shortMoney(s.item.parts)} materials</span></span>
        <span class="row-amt num">${money(cost)}</span>
      </button></li>`;
  }).join('');
  const open = suggestions.filter((s) => !added.has(s.item.id)).length;
  $('card-matches').hidden = !suggestions.length;
  $('suggest-label').textContent = `${suggestions.length} match${suggestions.length === 1 ? '' : 'es'}`;
  $('add-all').hidden = open < 2;
  $('all-added').hidden = !(suggestions.length && !open);
  $('suggest-hint').hidden = suggestions.length > 0;
  $('suggest-hint').textContent = quote.description.trim().length > 2 ? 'No matches yet. Try words like "faucet", "outlet", "water heater".' : 'Matches appear as you type.';
}

// ---------------------------------------------------------------- editing
function linesChanged(fresh = []) {
  save();
  renderItems(fresh);
  renderSuggestions();
  renderTotals();
  renderHead();
}

function addLine(item, qty = 1) {
  if (locked()) return;
  const existing = quote.items.find((i) => i.ref === item.id);
  let fresh = [];
  if (existing) existing.qty = num(existing.qty) + qty;
  else {
    const line = lineFromBook(item, qty);
    quote.items.push(line);
    fresh = [line.lid];
  }
  linesChanged(fresh);
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
    if (id === 'job-title') renderHead();
  });
}
// The description box grows with its text (5 rows minimum).
const grow = (el) => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; };
$('description').addEventListener('input', (e) => grow(e.target));

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
for (const b of document.querySelectorAll('[data-tax-on]')) {
  b.addEventListener('click', () => {
    quote.taxOn = b.dataset.taxOn;
    save();
    renderTaxOn();
    renderTotals();
  });
}

$('suggestions').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sugg]');
  if (!b || locked()) return;
  const s = suggestions[Number(b.dataset.sugg)];
  const idx = quote.items.findIndex((i) => i.ref === s.item.id);
  if (idx >= 0) { // the status icon toggles: an added match is taken off again
    if (quote.items[idx].lid === editingLid) editingLid = null;
    quote.items.splice(idx, 1);
    linesChanged();
  } else addLine(s.item, s.qty);
});
$('add-all').addEventListener('click', () => {
  const added = new Set(quote.items.map((i) => i.ref));
  const fresh = [];
  for (const s of suggestions) {
    if (added.has(s.item.id)) continue;
    const line = lineFromBook(s.item, s.qty);
    quote.items.push(line);
    fresh.push(line.lid);
  }
  linesChanged(fresh);
});

$('items').addEventListener('input', (e) => {
  const li = e.target.closest('[data-lid]');
  const f = e.target.dataset.f;
  if (!li || !f) return;
  const it = quote.items.find((i) => i.lid === li.dataset.lid);
  it[f] = f === 'name' ? e.target.value : num(e.target.value, f === 'parts' ? 1e7 : 10000);
  if (f === 'name') li.querySelector('.item-name').textContent = it.name;
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

/** Open one line item for editing (closing any other), or close it. */
function setEditing(lid, { focus } = {}) {
  editingLid = lid;
  for (const li of $('items').children) {
    const open = li.dataset.lid === lid;
    li.classList.toggle('is-editing', open);
    li.querySelector('.item-row').setAttribute('aria-expanded', String(open));
    li.querySelector('.item-edit').hidden = !open;
  }
  if (focus) $('items').querySelector(`[data-lid="${CSS.escape(focus)}"] ${lid ? '[data-act="inc"]' : '.item-row'}`)?.focus();
}

$('items').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  const li = e.target.closest('[data-lid]');
  if (!b || !li || locked()) return;
  const lid = li.dataset.lid;
  const act = b.dataset.act;
  if (act === 'toggle') return setEditing(editingLid === lid ? null : lid);
  if (act === 'done') return setEditing(null, { focus: lid });
  const idx = quote.items.findIndex((i) => i.lid === lid);
  const it = quote.items[idx];
  if (act === 'remove') {
    quote.items.splice(idx, 1);
    editingLid = null;
  } else if (act === 'inc') it.qty = num(it.qty) + 1;
  else if (act === 'dec') it.qty = Math.max(1, num(it.qty) - 1);
  linesChanged();
  if (act === 'inc' || act === 'dec') $('items').querySelector(`[data-lid="${CSS.escape(lid)}"] [data-act="${act}"]`)?.focus();
  else if (act === 'remove') $('open-book').focus();
});
$('items').addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !editingLid) return;
  const li = e.target.closest('[data-lid]');
  if (!li) return;
  e.preventDefault();
  setEditing(null, { focus: li.dataset.lid });
});

// ---------------------------------------------------------------- price book
let bookTrade = quote.trade;
function bookEdits() { return store.loadBookEdits(); }
function renderBookCount() {
  const edits = bookEdits();
  const edited = Object.keys(edits.items || {}).length || (edits.custom || []).length;
  $('book-count').textContent = `${book.length} items · ${edited ? 'your edited prices' : 'built-in prices'}`;
}
function renderBook() {
  const q = $('book-search').value.trim().toLowerCase();
  const editing = $('book-edit').checked;
  $('book-search').placeholder = `Search ${book.length} items`;
  for (const b of document.querySelectorAll('[data-book-trade]')) b.setAttribute('aria-selected', String(b.dataset.bookTrade === bookTrade));
  const list = book.filter((i) => i.trade === bookTrade && (!q || i.name.toLowerCase().includes(q) || (i.keywords || []).some((k) => k.includes(q))));
  const added = new Set(quote.items.map((i) => i.ref));
  $('book').classList.toggle('is-editing', editing);
  $('book-hint').textContent = editing
    ? 'Changes save on this device and apply to new line items.'
    : 'Tap an item to add it to the quote.';
  $('book').innerHTML = list.map((i) => (editing
    ? `<li class="book-row edit" data-id="${esc(i.id)}">
        <input class="input" data-bf="name" value="${esc(i.name)}" aria-label="Name">
        <div class="book-edit-ctl">
          <label class="affix"><input data-bf="hours" inputmode="decimal" value="${trimNum(i.hours)}" aria-label="Labor hours"><i>hrs</i></label>
          <label class="affix"><i>$</i><input data-bf="parts" inputmode="decimal" value="${trimNum(i.parts)}" aria-label="Materials cost"></label>
        </div>
      </li>`
    : `<li class="book-row${added.has(i.id) ? ' is-added' : ''}"><button type="button" class="row" data-add="${esc(i.id)}">
        <span class="row-main"><span class="row-title book-name">${esc(i.name)}${i.custom ? ' <span class="pill pill-neutral">custom</span>' : ''}</span>
        <span class="row-meta book-meta">${trimNum(i.hours)} hrs · ${money(i.parts)} materials</span></span>
        <span class="row-amt num book-price">${money(lineAmounts({ ...i, qty: 1 }, quote).amount)}</span>
        <span class="row-trail">${icon(added.has(i.id) ? 'circle-check' : 'circle-plus', 'ico-24')}</span>
      </button></li>`)).join('') || '<li class="empty">No items match.</li>';
}
function openBook({ edit = false } = {}) {
  bookTrade = quote.trade;
  $('book-search').value = '';
  $('book-edit').checked = edit;
  renderBook();
  openSheet($('dlg-book'));
}
$('open-book').addEventListener('click', () => openBook());
$('open-book-settings').addEventListener('click', () => openBook({ edit: true }));
$('book-search').addEventListener('input', renderBook);
$('book-edit').addEventListener('change', renderBook);
for (const b of document.querySelectorAll('[data-book-trade]')) b.addEventListener('click', () => { bookTrade = b.dataset.bookTrade; renderBook(); });
$('book').addEventListener('click', (e) => {
  const b = e.target.closest('[data-add]');
  if (!b) return;
  const item = book.find((i) => i.id === b.dataset.add);
  if (locked()) { toast('This quote is locked.', 'Duplicate it to make changes.', 'lock'); return; }
  addLine(item);
  renderBook();
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
  renderBookCount();
});
$('book-reset').addEventListener('click', () => {
  if (!confirm('Reset every price-book item to the built-in defaults? Custom items are removed.')) return;
  store.saveBookEdits({ items: {}, custom: [] });
  book = store.loadPriceBook();
  renderBook();
  renderBookCount();
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
  renderBookCount();
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
  renderBookCount();
}
let pendingLogo = null;
$('open-business').addEventListener('click', () => {
  pendingLogo = null;
  renderBusiness();
  openSheet($('dlg-business'));
});
$('logo-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const maxLogo = config.limits?.logoFileBytes || 8 * 1024 * 1024;
  if (file.size > maxLogo) { toast(`Logo file is too large (${Math.round(maxLogo / 1024 / 1024)} MB max).`, '', 'circle-alert'); return; }
  try {
    pendingLogo = await toJpegDataUrl(await readFileAsDataUrl(file), 480);
    $('logo-preview').src = pendingLogo;
    $('logo-preview').hidden = false;
    $('logo-empty').hidden = true;
  } catch (err) {
    toast(err.message, '', 'circle-alert');
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
  if (!store.saveBusiness(business)) toast('Could not save: browser storage is full.', '', 'circle-alert');
  else toast('Business details saved');
});

// ---------------------------------------------------------------- PDF
function needsItems() {
  if (quote.items.length) return false;
  toast('Add at least one line item first.', '', 'info');
  return true;
}
function downloadPdf() {
  if (needsItems()) return;
  const { bytes, filename } = buildQuotePdf({ quote, business });
  download(bytes, filename);
  toast(`Saved ${filename}`, '', 'download');
}
$('preview-pdf').addEventListener('click', () => {
  $('paper').innerHTML = paperHtml(quote, business);
  openSheet($('dlg-preview'));
});
$('download-pdf').addEventListener('click', downloadPdf);
$('preview-download').addEventListener('click', downloadPdf);
$('download-signed').addEventListener('click', downloadPdf);

// ---------------------------------------------------------------- quote server (emailed quotes)
let config = { demo: false, publicDemo: false, email: { configured: false, mock: false, reason: "Email isn't set up." }, followUpDefaults: [2, 5] };

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
const shortStamp = (d) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

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
          if (q.status === 'approved') toast(`Approved by ${q.approval.name}`, 'Signed on the review link');
          else toast('The customer declined this quote', '', 'circle-x');
        } else renderStatus();
        if ($('dlg-send').open && sendMode === 'email') renderEmailPane();
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
  $('send-foot-onsite').hidden = sendMode !== 'onsite';
  $('send-email').hidden = sendMode !== 'email';
  if (sendMode === 'email') renderEmailPane();
  else $('send-foot-email').hidden = true;
}

/** The follow-up schedule as the server will run it. Before the first send there are no dates yet. */
function renderTimeline() {
  const e = quote.email || {};
  const srv = quote.delivery === 'email' && e.sentAt ? e.server : null;
  const node = (state, ico) => `<span class="node${state ? ` ${state}` : ''}">${ico ? icon(ico) : ''}</span>`;
  const items = [];
  if (srv) {
    const f = srv.followUps;
    items.push(`<li>${node('done', 'check')}<div><div class="tl-t">Quote emailed</div></div><span class="tl-d num">${shortDate(srv.sentAt)}</span></li>`);
    for (const s of f.schedule || []) {
      const st = s.state === 'sent' ? 'done' : s.state === 'next' ? 'next' : '';
      const meta = s.state === 'sent' ? 'Sent' : s.state === 'next' ? 'Next follow-up' : '';
      items.push(`<li>${node(st, s.state === 'sent' ? 'check' : 'bell')}<div><div class="tl-t">Reminder ${s.n}</div>${meta ? `<div class="tl-m">${meta}</div>` : ''}</div><span class="tl-d num">${shortDate(s.at)}</span></li>`);
    }
    if (f.stopped) {
      const why = { approved: 'Stopped: approved', declined: 'Stopped: declined', off: 'Follow-ups off', expired: 'Ended: quote expired' }[f.stopped];
      items.push(`<li>${node('', 'circle-x')}<div><div class="tl-t">${why}</div></div><span class="tl-d num"></span></li>`);
    }
  } else {
    const on = $('fu-enabled').checked;
    items.push(`<li>${node('next', 'mail')}<div><div class="tl-t">Quote emailed</div><div class="tl-m">When you send</div></div><span class="tl-d"></span></li>`);
    if (on) {
      const days = [...new Set($('fu-days').value.split(/[\s,;]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 60))].sort((a, b) => a - b).slice(0, 5);
      days.forEach((d, i) => items.push(`<li>${node('', 'bell')}<div><div class="tl-t">Reminder ${i + 1}</div></div><span class="tl-d num">Day ${d}</span></li>`));
    }
  }
  $('fu-timeline').innerHTML = items.join('');
  const until = srv?.expiresAt ? shortDate(srv.expiresAt) : formatDate(validUntil(quote)).replace(/, \d{4}$/, '');
  $('fu-help').textContent = `Reminders stop as soon as the customer approves or declines, and never go past ${until}.`;
}

function renderEmailPane() {
  const cfg = config.email;
  $('email-off').hidden = cfg.configured;
  // Only show the server's reason when it adds detail (e.g. which setting is missing).
  $('email-off-reason').textContent = cfg.reason && cfg.reason !== "Email isn't set up." ? ` ${cfg.reason}` : '';
  $('email-form').hidden = !cfg.configured;
  $('send-foot-email').hidden = !cfg.configured;
  if (!cfg.configured) return;
  $('email-mock').hidden = !cfg.mock;
  const e = quote.email || {};
  if (document.activeElement !== $('email-to')) $('email-to').value = e.to || quote.client.email || '';
  const fu = e.followUps || { enabled: true, days: config.followUpDefaults };
  if (document.activeElement !== $('fu-enabled')) $('fu-enabled').checked = fu.enabled !== false;
  if (document.activeElement !== $('fu-days')) $('fu-days').value = fu.days.join(', ');
  const sent = quote.delivery === 'email' && e.sentAt;
  $('email-sent').hidden = !sent;
  if (sent) {
    $('email-sent-title').textContent = cfg.mock ? 'Sent to the demo Outbox' : 'Emailed';
    $('email-sent-detail').textContent = `${e.to} · ${shortStamp(e.sentAt)}`;
    $('email-fu-detail').textContent = followUpText(quote);
  }
  renderTimeline();
  const open = quote.status !== 'approved' && quote.status !== 'declined';
  $('email-send-label').textContent = sent ? 'Resend' : 'Send email';
  $('email-send').disabled = !open;
  $('fu-save').hidden = !(sent && open);
}
$('fu-enabled').addEventListener('change', renderTimeline);
$('fu-days').addEventListener('input', () => { if (!(quote.delivery === 'email' && quote.email?.sentAt)) renderTimeline(); });

$('send').addEventListener('click', () => {
  if (needsItems()) return;
  if (!business.name) toast('Tip: add your business name under Business.', '', 'info');
  const path = `/approve/${quote.id}`;
  $('approve-url').textContent = location.origin + path;
  $('open-approve').href = path;
  $('email-error').textContent = '';
  sendMode = quote.delivery === 'email' ? 'email' : 'onsite';
  renderSendMode();
  openSheet($('dlg-send'));
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
  $('email-send-label').textContent = 'Sending…';
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
    if (r.mock) toast('Added to the demo Outbox', 'Not really sent', 'inbox');
    else toast(`Emailed to ${to}`, '', 'mail-check');
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
    toast(st.followUps.enabled ? `Follow-ups after ${st.followUps.days.join(' and ')} days` : 'Follow-ups off', '', 'bell');
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
function quoteMeta(q) {
  if (q.delivery === 'email' && q.email?.server) return `<span data-testid="ql-fu">${esc(followUpText(q))}</span>`;
  if (q.status === 'approved') return esc(`Approved ${shortDate(q.approval?.signedAt)}`);
  if (q.status === 'declined') return esc(`Declined ${shortDate(q.decline?.at)}${q.decline?.reason ? ` · ${q.decline.reason}` : ''}`);
  if (isExpired(q)) return esc(`Valid until ${shortDate(validUntil(q))}`);
  if (q.status === 'sent') return 'Awaiting signature on site';
  return 'Not sent yet';
}
function renderQuoteList() {
  const all = Object.values(store.loadQuotes()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  $('quotes-pill').textContent = all.length;
  $('quote-list').innerHTML = all.map((q) => `<li><button type="button" class="row ql-row${q.id === quote.id ? ' is-current' : ''}" data-open="${esc(q.id)}"${q.id === quote.id ? ' aria-current="true"' : ''}>
      <span class="row-main">
        <span class="row-title ql-name">${esc(q.client?.name || 'No client')}</span>
        <span class="row-sub">${esc(q.jobTitle || `${TRADES[q.trade].label} job`)}</span>
        <span class="qmeta">${icon(TRADE_ICON[q.trade], 'ico-16')}<span class="num">${esc(q.number)}</span> · ${quoteMeta(q)}</span>
      </span>
      <span class="ql-end"><span class="row-amt num">${money(quoteTotals(q.items, q).total)}</span>${pillHtml(statePill(q))}</span>
    </button></li>`).join('');
}
$('open-quotes').addEventListener('click', async () => {
  renderQuoteList();
  openSheet($('dlg-quotes'));
  await pollEmailed();
  renderQuoteList();
});
$('quote-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-open]');
  if (!b) return;
  quote = store.getQuote(b.dataset.open);
  store.setCurrent(quote.id);
  editingLid = null;
  shownTotal = null;
  closeSheet($('dlg-quotes'));
  renderAll();
});

// ---------------------------------------------------------------- demo outbox + time travel
let outboxEmails = [];
async function refreshOutboxCount() {
  if (!config.email.mock) return;
  try {
    outboxEmails = (await api('/api/outbox')).emails;
    setBadge('outbox-count', outboxEmails.length);
    $('open-outbox').setAttribute('aria-label', `Outbox (demo), ${outboxEmails.length} email${outboxEmails.length === 1 ? '' : 's'}`);
  } catch { /* ignore */ }
}
function renderOutbox(selectedId) {
  const sel = selectedId || outboxEmails[0]?.id;
  $('outbox-pill').textContent = `${outboxEmails.length} email${outboxEmails.length === 1 ? '' : 's'}`;
  $('outbox-list').innerHTML = outboxEmails.map((m) => `<li><div class="ob-item${m.id === sel ? ' is-current' : ''}" data-mail="${esc(m.id)}">
      <button type="button" class="ob-open" data-mail-open="${esc(m.id)}" aria-pressed="${m.id === sel}">
        <span class="ob-top"><span class="pill ${m.kind === 'followup' ? 'pill-accent' : 'pill-neutral'} ob-kind" data-kind="${esc(m.kind)}">${icon(m.kind === 'followup' ? 'bell' : 'mail')}${m.kind === 'followup' ? `Follow-up ${m.n}` : 'Quote'}</span><span class="row-meta num">${esc(formatStamp(m.at))}</span></span>
        <span class="ob-subj">${esc(m.subject)}</span>
        <span class="row-meta ob-meta">To ${esc(m.to)}</span>
      </button>
      <span class="ob-actions"><a class="link" href="/api/outbox/${esc(m.id)}/attachment/0" download>${icon('paperclip')}PDF</a>${m.link ? `<a class="link" href="${esc(m.link)}" target="_blank" rel="noopener" data-testid="ob-link">${icon('external-link')}Open review link</a>` : ''}</span>
    </div></li>`).join('');
  $('outbox-empty').hidden = outboxEmails.length > 0;
  $('outbox-view').hidden = !sel;
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
  openSheet($('dlg-outbox'));
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
    if (body.reset) toast('Demo clock reset', '', 'calendar-clock');
    else if (r.fired.length) toast(`${r.fired.length} follow-up${r.fired.length === 1 ? '' : 's'} sent`, 'To the demo Outbox', 'bell');
    else toast(`Demo clock +${body.advanceDays} day${body.advanceDays === 1 ? '' : 's'}`, 'No follow-ups due', 'calendar-clock');
  } catch (e) {
    toast(e.message, '', 'circle-alert');
  }
}
for (const b of document.querySelectorAll('[data-advance]')) b.addEventListener('click', () => travel({ advanceDays: Number(b.dataset.advance) }));
$('clock-reset').addEventListener('click', () => travel({ reset: true }));

// What is stored where, stated per mode.
const STORAGE_NOTE = {
  publicDemo: 'Saved in this browser only. Quotes you email are kept on this demo server for up to 24 hours, only you can see them, and everything is wiped daily.',
  local: 'Saved on this device. Emailed quotes are also stored on your quote server so the review link works.',
};
async function loadConfig() {
  try {
    config = await api('/api/config');
  } catch { /* server without the API: email stays "not set up" */ }
  $('open-outbox').hidden = !(config.demo && config.email.mock);
  $('storage-note').textContent = config.publicDemo ? STORAGE_NOTE.publicDemo : STORAGE_NOTE.local;
  await refreshOutboxCount();
}

$('new-quote').addEventListener('click', () => {
  quote = store.createQuote(quote.trade);
  editingLid = null;
  renderAll();
  window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
  toast(`Started ${quote.number}`, '', 'file-plus');
});
$('duplicate-quote').addEventListener('click', () => {
  const copy = store.createQuote(quote.trade);
  quote = { ...structuredClone(quote), id: copy.id, number: copy.number, createdAt: copy.createdAt, status: 'draft', sentAt: null, approval: null, decline: null, delivery: null, email: null };
  quote.items = quote.items.map((i) => ({ ...i, lid: newId() }));
  editingLid = null;
  save();
  renderAll();
  toast(`Copied to ${quote.number}`, '', 'copy');
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
  editingLid = null;
  save();
  renderAll();
  renderItems(quote.items.map((i) => i.lid));
  grow($('description'));
  toast('Sample job loaded', 'Fictional business and client', 'briefcase');
});

// ---------------------------------------------------------------- bottom bar
$('mobile-finish').addEventListener('click', () => $('summary').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }));
// The bar slides away while the total card itself is on screen.
new IntersectionObserver(([e]) => $('mobilebar').classList.toggle('is-away', e.isIntersecting), { threshold: 0.15 }).observe($('summary'));

renderAll();
grow($('description'));
loadConfig().finally(() => {
  pollEmailed();
  document.body.classList.add('ready');
});
