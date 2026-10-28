import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PRICE_BOOK, TRADES, mergePriceBook, suggestItems } from '../../public/lib/pricebook.js';

const book = DEFAULT_PRICE_BOOK;
const ids = (r) => r.map((x) => x.item.id);

test('price book has at least 30 items covering both trades, all well-formed', () => {
  assert.ok(book.length >= 30, `${book.length} items`);
  const plumbing = book.filter((i) => i.trade === 'plumbing');
  const electrical = book.filter((i) => i.trade === 'electrical');
  assert.ok(plumbing.length >= 15, `${plumbing.length} plumbing`);
  assert.ok(electrical.length >= 15, `${electrical.length} electrical`);
  assert.equal(new Set(book.map((i) => i.id)).size, book.length, 'ids are unique');
  for (const i of book) {
    assert.ok(TRADES[i.trade], i.id);
    assert.ok(i.name.length > 3, i.id);
    assert.ok(Number.isFinite(i.hours) && i.hours > 0 && i.hours <= 12, `${i.id} hours ${i.hours}`);
    assert.ok(Number.isFinite(i.parts) && i.parts >= 0 && i.parts < 5000, `${i.id} parts ${i.parts}`);
    assert.ok(Array.isArray(i.keywords) && i.keywords.length > 0, `${i.id} keywords`);
    for (const k of i.keywords) assert.equal(k, k.toLowerCase(), `${i.id} keyword ${k}`);
  }
});

test('mergePriceBook applies saved edits and custom items, ignoring junk', () => {
  const merged = mergePriceBook({
    items: { 'e-outlet': { hours: 0.5, parts: 9.5, name: '  Outlet swap  ' }, 'p-sump': { hours: -1, parts: 'x' } },
    custom: [
      { id: 'c-1', trade: 'plumbing', name: 'Bidet seat install', hours: 1, parts: 20 },
      { id: 'c-2', trade: 'roofing', name: 'Not our trade', hours: 1, parts: 1 },
      { id: 'c-3', trade: 'electrical', name: '' },
      null,
    ],
  });
  const outlet = merged.find((i) => i.id === 'e-outlet');
  assert.equal(outlet.hours, 0.5);
  assert.equal(outlet.parts, 9.5);
  assert.equal(outlet.name, 'Outlet swap');
  const sump = merged.find((i) => i.id === 'p-sump');
  assert.equal(sump.hours, book.find((i) => i.id === 'p-sump').hours, 'invalid edits are ignored');
  assert.ok(merged.some((i) => i.id === 'c-1' && i.custom));
  assert.ok(!merged.some((i) => i.id === 'c-2' || i.id === 'c-3'));
  assert.equal(merged.length, book.length + 1);
  // Defaults themselves are never mutated.
  assert.notEqual(book.find((i) => i.id === 'e-outlet').name, 'Outlet swap');
  assert.equal(mergePriceBook(null).length, book.length);
  assert.equal(mergePriceBook('garbage').length, book.length);
});

test('suggestions: sample water-heater job', () => {
  const r = suggestItems('No hot water. Old 50 gallon gas water heater is leaking at the base. Replace it, add an expansion tank and swap the gas connector. Kitchen faucet is dripping too.', book, { trade: 'plumbing' });
  const got = ids(r);
  for (const want of ['p-wh-tank-50', 'p-wh-expansion', 'p-gas-flex', 'p-faucet-kitchen']) assert.ok(got.includes(want), `${want} in ${got}`);
  assert.ok(!got.includes('p-faucet-bath'), 'only the best faucet is suggested');
  assert.ok(!got.includes('p-wh-tankless'), 'only the best water heater is suggested');
});

test('suggestions: quantities from digits and number words, plurals match', () => {
  const r = suggestItems('Install 6 can lights in the kitchen and replace two outlets', book, { trade: 'electrical' });
  const cans = r.find((x) => x.item.id === 'e-can-lights');
  assert.ok(cans, ids(r).join());
  assert.equal(cans.qty, 6);
  const outlet = r.find((x) => x.item.group === 'outlet');
  assert.ok(outlet);
  assert.equal(outlet.qty, 2);
});

test('suggestions: electrical jobs', () => {
  assert.equal(ids(suggestItems('Customer wants a Tesla charger in the garage', book, { trade: 'electrical' }))[0], 'e-ev-charger');
  assert.ok(ids(suggestItems('upgrade the old fuse box to 200 amp', book, {})).includes('e-panel-200'));
  assert.ok(ids(suggestItems('Add a GFCI in the bathroom', book, { trade: 'electrical' })).includes('e-gfci'));
  assert.ok(ids(suggestItems('ceiling fan in bedroom', book, {})).includes('e-ceiling-fan'));
});

test('suggestions: plumbing jobs and case/punctuation insensitivity', () => {
  assert.ok(ids(suggestItems('TOILET keeps RUNNING!!', book, { trade: 'plumbing' })).includes('p-toilet-rebuild'));
  assert.ok(ids(suggestItems('Clogged kitchen sink, slow drain.', book, { trade: 'plumbing' })).includes('p-drain-clear'));
  assert.ok(ids(suggestItems("Sump pump died; basement's flooding", book, {})).includes('p-sump'));
});

test('suggestions: preferred trade ranks first; limit applies; nothing for empty or unrelated text', () => {
  const r = suggestItems('need a new circuit for the microwave and fix the leaking pipe', book, { trade: 'plumbing' });
  assert.equal(r[0].item.trade, 'plumbing');
  assert.ok(suggestItems('water heater faucet toilet outlet panel fan sump disposal', book, { limit: 3 }).length <= 3);
  assert.deepEqual(suggestItems('', book, {}), []);
  assert.deepEqual(suggestItems('  ', book, {}), []);
  assert.deepEqual(suggestItems('paint the fence blue', book, {}), []);
  // Partial words never match ("fanatic" is not "fan").
  assert.ok(!ids(suggestItems('he is a fanatic', book, {})).includes('e-ceiling-fan'));
});
