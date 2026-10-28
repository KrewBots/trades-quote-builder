// Quote math. Everything is rounded to whole cents at the line level, then summed,
// so the numbers on screen, in the PDF and on the approval page always add up.
//
//   labor per line = hours x qty x labor rate
//   parts per line = parts cost x qty x (1 + markup %)      (customer price)
//   subtotal       = labor + parts
//   tax            = tax % of subtotal (or of parts only when taxOn = 'parts')
//   total          = subtotal + tax

/** Coerce user input to a finite, non-negative number (blank, NaN, negatives -> 0). */
export function num(value, max = 1e9) {
  const n = typeof value === 'string' ? Number(value.replace(/[$,%\s]/g, '')) : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, max);
}

/** Round half away from zero to cents, without binary float drift (1.005 -> 1.01). */
export function roundCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  const r = Number(Math.round(Number(`${Math.abs(n)}e2`)) + 'e-2');
  return sign * r || 0;
}

export function lineAmounts(item, settings) {
  const qty = num(item.qty, 10000);
  const hours = num(item.hours, 10000);
  const parts = num(item.parts);
  const rate = num(settings.laborRate);
  const markup = num(settings.markup, 1000) / 100;
  const labor = roundCents(hours * qty * rate);
  const partsPrice = roundCents(parts * qty * (1 + markup));
  return { qty, hours: hours * qty, labor, parts: partsPrice, amount: roundCents(labor + partsPrice) };
}

/**
 * @param {{qty:number,hours:number,parts:number}[]} items
 * @param {{laborRate:number, markup:number, tax:number, taxOn?:'all'|'parts'}} settings
 */
export function quoteTotals(items, settings) {
  const lines = (items || []).map((it) => lineAmounts(it, settings));
  const sum = (key) => roundCents(lines.reduce((s, l) => s + Math.round(l[key] * 100), 0) / 100);
  const labor = sum('labor');
  const parts = sum('parts');
  const subtotal = roundCents(labor + parts);
  const taxRate = num(settings.tax, 100);
  const taxable = settings.taxOn === 'parts' ? parts : subtotal;
  const tax = roundCents((taxable * taxRate) / 100);
  const total = roundCents(subtotal + tax);
  const hours = Math.round(lines.reduce((s, l) => s + l.hours, 0) * 100) / 100;
  return { lines, labor, parts, subtotal, taxRate, taxable, tax, total, hours };
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const money = (n) => usd.format(roundCents(n));

/** "1.5" -> "1.5", "2" -> "2", 0.25 -> "0.25" (hours/qty display). */
export const trimNum = (n) => String(Math.round(num(n) * 100) / 100);

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + Math.round(num(days, 3650)));
  return d;
}

export function formatDate(d) {
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatStamp(d) {
  return new Date(d).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}
