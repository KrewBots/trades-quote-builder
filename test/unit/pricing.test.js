import { test } from 'node:test';
import assert from 'node:assert/strict';
import { num, roundCents, lineAmounts, quoteTotals, money, trimNum, addDays } from '../../public/lib/pricing.js';

const S = { laborRate: 100, markup: 20, tax: 10 };

test('num: blanks, junk, negatives and NaN become 0; formatting is stripped; values are capped', () => {
  assert.equal(num(''), 0);
  assert.equal(num(undefined), 0);
  assert.equal(num(null), 0);
  assert.equal(num('abc'), 0);
  assert.equal(num(-5), 0);
  assert.equal(num('-5'), 0);
  assert.equal(num(NaN), 0);
  assert.equal(num(Infinity), 0);
  assert.equal(num('$1,250.50'), 1250.5);
  assert.equal(num('8.25%'), 8.25);
  assert.equal(num(' 3 '), 3);
  assert.equal(num(5e12), 1e9);
  assert.equal(num(50, 10), 10);
});

test('roundCents rounds half away from zero without float drift', () => {
  assert.equal(roundCents(1.005), 1.01);
  assert.equal(roundCents(1.004), 1);
  assert.equal(roundCents(2.675), 2.68);
  assert.equal(roundCents(0.1 + 0.2), 0.3);
  assert.equal(roundCents(10.235), 10.24);
  assert.equal(roundCents(-1.005), -1.01);
  assert.equal(roundCents(0), 0);
  assert.equal(roundCents(NaN), 0);
  assert.equal(Object.is(roundCents(-0.001), -0), false);
});

test('line: labor = hours x qty x rate; parts = cost x qty x (1 + markup)', () => {
  const l = lineAmounts({ hours: 1.5, parts: 40, qty: 2 }, S);
  assert.equal(l.labor, 300);
  assert.equal(l.parts, 96);
  assert.equal(l.amount, 396);
  assert.equal(l.hours, 3);
});

test('line amounts are rounded to cents individually', () => {
  // 0.33 h x $125 = 41.25; parts 9.99 x 1.175 = 11.73825 -> 11.74
  const l = lineAmounts({ hours: 0.33, parts: 9.99, qty: 1 }, { laborRate: 125, markup: 17.5 });
  assert.equal(l.labor, 41.25);
  assert.equal(l.parts, 11.74);
  assert.equal(l.amount, 52.99);
});

test('totals: subtotal, tax on everything, total', () => {
  const t = quoteTotals([{ hours: 4, parts: 1150, qty: 1 }, { hours: 1.25, parts: 25, qty: 1 }], { laborRate: 125, markup: 20, tax: 8.25 });
  assert.equal(t.labor, 656.25);
  assert.equal(t.parts, 1410);
  assert.equal(t.subtotal, 2066.25);
  assert.equal(t.tax, 170.47); // 170.465625 -> 170.47
  assert.equal(t.total, 2236.72);
  assert.equal(t.hours, 5.25);
});

test('totals: tax on materials only', () => {
  const t = quoteTotals([{ hours: 2, parts: 100, qty: 1 }], { laborRate: 100, markup: 0, tax: 10, taxOn: 'parts' });
  assert.equal(t.subtotal, 300);
  assert.equal(t.taxable, 100);
  assert.equal(t.tax, 10);
  assert.equal(t.total, 310);
});

test('totals always add up exactly to the cent (sum of rounded lines)', () => {
  const items = Array.from({ length: 25 }, (_, i) => ({ hours: 0.1 * (i + 1), parts: 3.33 * (i + 1), qty: (i % 3) + 1 }));
  const s = { laborRate: 97.5, markup: 22.5, tax: 7.125 };
  const t = quoteTotals(items, s);
  const cents = (n) => Math.round(n * 100);
  assert.equal(cents(t.labor), t.lines.reduce((a, l) => a + cents(l.labor), 0));
  assert.equal(cents(t.parts), t.lines.reduce((a, l) => a + cents(l.parts), 0));
  assert.equal(cents(t.subtotal), cents(t.labor) + cents(t.parts));
  assert.equal(cents(t.total), cents(t.subtotal) + cents(t.tax));
  for (const v of [t.labor, t.parts, t.subtotal, t.tax, t.total]) assert.equal(cents(v) / 100, v);
});

test('edge cases: empty quote, zero rate, zero markup and tax, bad input', () => {
  assert.deepEqual(
    (({ labor, parts, subtotal, tax, total }) => ({ labor, parts, subtotal, tax, total }))(quoteTotals([], S)),
    { labor: 0, parts: 0, subtotal: 0, tax: 0, total: 0 },
  );
  assert.equal(quoteTotals(undefined, S).total, 0);
  assert.equal(quoteTotals([{ hours: 2, parts: 50, qty: 1 }], { laborRate: 0, markup: 0, tax: 0 }).total, 50);
  const bad = quoteTotals([{ hours: 'x', parts: -20, qty: '' }], { laborRate: '', markup: 'abc', tax: -3 });
  assert.equal(bad.total, 0);
  // Fractional quantities (e.g. 2.5 ft of pipe sections) work.
  assert.equal(quoteTotals([{ hours: 1, parts: 10, qty: 2.5 }], { laborRate: 100, markup: 0, tax: 0 }).total, 275);
  // Tax rate is capped at 100%, markup at 1000%.
  assert.equal(quoteTotals([{ hours: 0, parts: 10, qty: 1 }], { laborRate: 0, markup: 5000, tax: 500 }).total, 220);
});

test('large values stay finite and correct', () => {
  const t = quoteTotals([{ hours: 1000, parts: 250000, qty: 10 }], { laborRate: 150, markup: 15, tax: 9.5 });
  assert.equal(t.labor, 1500000);
  assert.equal(t.parts, 2875000);
  assert.equal(t.total, 4790625);
});

test('formatting helpers', () => {
  assert.equal(money(2612.45), '$2,612.45');
  assert.equal(money(0), '$0.00');
  assert.equal(money(1.005), '$1.01');
  assert.equal(trimNum(1.5), '1.5');
  assert.equal(trimNum('2'), '2');
  assert.equal(trimNum(0.333333), '0.33');
  const d = addDays('2026-10-28T12:00:00', 30);
  assert.equal(d.getMonth(), 10);
  assert.equal(d.getDate(), 27);
});
