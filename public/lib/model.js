// Quote, business and settings shapes plus the fictional sample job used for demos.
import { TRADES } from './pricebook.js';
import { addDays } from './pricing.js';

export const DEFAULT_TERMS = [
  'Price includes labor, listed materials and clean-up.',
  'Any extra work found once the job starts will be quoted before it is done.',
  '50% due on acceptance, balance due on completion.',
  'Workmanship guaranteed for 12 months from completion.',
].join('\n');

export const DEFAULT_BUSINESS = { name: '', license: '', phone: '', email: '', address: '', logo: '' };

export function newId() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10);
}

export function newQuote({ number = 1001, trade = 'plumbing', now = new Date() } = {}) {
  return {
    id: newId(),
    number: `Q-${number}`,
    trade,
    createdAt: now.toISOString(),
    client: { name: '', phone: '', email: '', address: '' },
    jobTitle: '',
    description: '',
    items: [],
    laborRate: TRADES[trade].rate,
    markup: 20,
    tax: 8.25,
    taxOn: 'all',
    validDays: 30,
    terms: DEFAULT_TERMS,
    status: 'draft',
    sentAt: null,
    approval: null,
  };
}

export const validUntil = (quote) => addDays(quote.createdAt, quote.validDays);
export const isExpired = (quote, now = new Date()) => {
  const end = validUntil(quote);
  end.setHours(23, 59, 59, 999);
  return now > end;
};

/** Line item snapshot taken from a price-book entry (later book edits don't change saved quotes). */
export const lineFromBook = (item, qty = 1) => ({
  lid: newId(),
  ref: item.id,
  name: item.name,
  hours: item.hours,
  parts: item.parts,
  qty,
});

// Entirely fictional: no real business, license number, person or address.
export const SAMPLE_BUSINESS = {
  name: 'Brightline Plumbing & Electric',
  license: 'Lic. #PLB-000000 (sample)',
  phone: '(555) 010-0144',
  email: 'jobs@brightline.example',
  address: '220 Example Ave, Springfield',
  logo: '',
};

export const SAMPLE_JOB = {
  trade: 'plumbing',
  client: { name: 'Jordan Rivera', phone: '(555) 010-0199', email: 'jordan@example.com', address: '48 Maple Court, Springfield' },
  jobTitle: 'Water heater replacement',
  description: 'No hot water. Old 50 gallon gas water heater is leaking at the base. Replace it, add an expansion tank and swap the gas connector. Kitchen faucet is dripping too.',
  laborRate: 125,
  markup: 20,
  tax: 8.25,
  validDays: 30,
};
