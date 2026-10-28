// Everything is kept in this browser's localStorage. Nothing is sent anywhere.
import { DEFAULT_BUSINESS, newQuote } from './model.js';
import { mergePriceBook } from './pricebook.js';

const K = { business: 'tqb.business', book: 'tqb.pricebook', quotes: 'tqb.quotes', current: 'tqb.current', counter: 'tqb.counter' };
export const STORAGE_KEYS = K;

function read(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // storage full (very large logo) or disabled
  }
}

export const loadBusiness = () => ({ ...DEFAULT_BUSINESS, ...read(K.business, {}) });
export const saveBusiness = (b) => write(K.business, b);

export const loadBookEdits = () => read(K.book, { items: {}, custom: [] });
export const loadPriceBook = () => mergePriceBook(loadBookEdits());
export const saveBookEdits = (edits) => write(K.book, edits);

export const loadQuotes = () => read(K.quotes, {});
export const getQuote = (id) => loadQuotes()[id] || null;
export function saveQuote(q) {
  const all = loadQuotes();
  all[q.id] = q;
  return write(K.quotes, all);
}
export function deleteQuote(id) {
  const all = loadQuotes();
  delete all[id];
  write(K.quotes, all);
}

export const currentId = () => read(K.current, null);
export const setCurrent = (id) => write(K.current, id);

export function createQuote(trade) {
  const n = Number(read(K.counter, 1000)) + 1;
  write(K.counter, n);
  const q = newQuote({ number: n, trade });
  saveQuote(q);
  setCurrent(q.id);
  return q;
}
