// Built-in price book: common residential plumbing and electrical jobs with
// typical labor hours and parts cost (USD, before markup). Every value is
// editable in the app and saved on this device. `keywords` drive the
// "Describe the job" suggestions.

export const TRADES = {
  plumbing: { label: 'Plumbing', rate: 125 },
  electrical: { label: 'Electrical', rate: 115 },
};

const P = 'plumbing';
const E = 'electrical';

export const DEFAULT_PRICE_BOOK = [
  // Plumbing
  { id: 'p-wh-tank-50', trade: P, name: 'Water heater replacement, 50 gal gas', hours: 4, parts: 1150, keywords: ['water heater', 'hot water', 'heater', 'tank', 'no hot water', 'gas heater'], group: 'heater' },
  { id: 'p-wh-tankless', trade: P, name: 'Tankless water heater install', hours: 8, parts: 1650, keywords: ['tankless', 'on demand', 'instant hot water'], group: 'heater' },
  { id: 'p-wh-expansion', trade: P, name: 'Thermal expansion tank', hours: 0.75, parts: 85, keywords: ['expansion tank', 'expansion', 'water heater', 'heater'] },
  { id: 'p-wh-flush', trade: P, name: 'Water heater flush and anode check', hours: 1, parts: 35, keywords: ['flush', 'anode', 'sediment', 'rumbling'] },
  { id: 'p-gas-flex', trade: P, name: 'Gas line flex connector and shutoff', hours: 0.75, parts: 48, keywords: ['gas line', 'gas connector', 'gas', 'connector'] },
  { id: 'p-toilet-replace', trade: P, name: 'Toilet replacement (customer fixture)', hours: 1.5, parts: 45, keywords: ['toilet', 'replace toilet', 'new toilet', 'commode'], group: 'toilet' },
  { id: 'p-toilet-rebuild', trade: P, name: 'Toilet tank rebuild (fill valve, flapper)', hours: 0.75, parts: 38, keywords: ['running toilet', 'toilet running', 'keeps running', 'running', 'flapper', 'fill valve', 'toilet', 'phantom flush'], group: 'toilet' },
  { id: 'p-wax-ring', trade: P, name: 'Toilet reset with new wax ring', hours: 1, parts: 18, keywords: ['wax ring', 'toilet leak', 'rocking toilet', 'toilet'], group: 'toilet' },
  { id: 'p-faucet-kitchen', trade: P, name: 'Kitchen faucet install', hours: 1.25, parts: 25, keywords: ['kitchen faucet', 'faucet', 'tap', 'kitchen sink', 'dripping faucet'], group: 'faucet' },
  { id: 'p-faucet-bath', trade: P, name: 'Bathroom faucet install', hours: 1, parts: 22, keywords: ['bathroom faucet', 'faucet', 'tap', 'vanity', 'bathroom sink', 'dripping faucet'], group: 'faucet' },
  { id: 'p-disposal', trade: P, name: 'Garbage disposal replacement, 1/2 HP', hours: 1.25, parts: 165, keywords: ['disposal', 'garbage disposal', 'disposer', 'insinkerator'] },
  { id: 'p-drain-clear', trade: P, name: 'Drain clearing, sink or tub (cable)', hours: 1, parts: 0, keywords: ['clog', 'clogged', 'blocked', 'drain', 'slow drain', 'backed up', 'sink', 'tub'] },
  { id: 'p-main-line', trade: P, name: 'Main sewer line clearing', hours: 2, parts: 0, keywords: ['main line', 'sewer', 'main drain', 'backed up', 'cleanout'] },
  { id: 'p-camera', trade: P, name: 'Sewer camera inspection', hours: 1, parts: 0, keywords: ['camera', 'inspection', 'sewer', 'roots'] },
  { id: 'p-shutoff', trade: P, name: 'Angle stop shutoff valve replacement', hours: 0.5, parts: 18, keywords: ['shutoff', 'shut off', 'angle stop', 'valve', 'supply line'] },
  { id: 'p-supply-line', trade: P, name: 'Braided supply line', hours: 0.25, parts: 12, keywords: ['supply line', 'supply hose', 'braided', 'leak'] },
  { id: 'p-main-valve', trade: P, name: 'Main water shutoff valve replacement', hours: 2.5, parts: 95, keywords: ['main valve', 'main shutoff', 'main water', 'shutoff'] },
  { id: 'p-prv', trade: P, name: 'Pressure reducing valve (PRV) replacement', hours: 2, parts: 210, keywords: ['pressure', 'prv', 'high pressure', 'water pressure', 'banging pipes'] },
  { id: 'p-pex-repair', trade: P, name: 'Leak repair, PEX or copper section', hours: 1.5, parts: 40, keywords: ['pipe leak', 'leaking pipe', 'burst', 'burst pipe', 'pipe', 'pinhole', 'copper', 'pex'] },
  { id: 'p-hose-bib', trade: P, name: 'Frost-free hose bib replacement', hours: 1, parts: 45, keywords: ['hose bib', 'spigot', 'outdoor faucet', 'sillcock', 'frost'] },
  { id: 'p-sump', trade: P, name: 'Sump pump replacement, 1/3 HP', hours: 2, parts: 240, keywords: ['sump', 'sump pump', 'basement', 'flooding'] },
  { id: 'p-shower-valve', trade: P, name: 'Shower valve cartridge replacement', hours: 1, parts: 55, keywords: ['shower', 'cartridge', 'shower valve', 'shower drip', 'temperature'] },
  { id: 'p-softener', trade: P, name: 'Water softener install', hours: 3, parts: 780, keywords: ['softener', 'hard water', 'water softener'] },
  { id: 'p-trip-fee', trade: P, name: 'Service call and diagnosis', hours: 0.5, parts: 0, keywords: ['service call', 'diagnose', 'diagnosis', 'inspect', 'look at'] },

  // Electrical
  { id: 'e-outlet', trade: E, name: 'Replace standard outlet', hours: 0.4, parts: 6, keywords: ['outlet', 'receptacle', 'plug', 'socket'], group: 'outlet' },
  { id: 'e-gfci', trade: E, name: 'GFCI outlet install', hours: 0.6, parts: 24, keywords: ['gfci', 'gfi', 'bathroom outlet', 'kitchen outlet', 'outdoor outlet', 'tripping outlet', 'outlet'], group: 'outlet' },
  { id: 'e-usb-outlet', trade: E, name: 'USB-C combo outlet', hours: 0.5, parts: 32, keywords: ['usb', 'usb outlet', 'charging outlet'] },
  { id: 'e-new-circuit', trade: E, name: 'New 20A dedicated circuit (up to 30 ft)', hours: 3, parts: 95, keywords: ['new circuit', 'dedicated circuit', 'circuit', 'microwave', 'freezer', 'add outlet'] },
  { id: 'e-switch', trade: E, name: 'Replace light switch', hours: 0.3, parts: 5, keywords: ['switch', 'light switch'], group: 'switch' },
  { id: 'e-dimmer', trade: E, name: 'Dimmer switch install', hours: 0.5, parts: 28, keywords: ['dimmer', 'dim'], group: 'switch' },
  { id: 'e-smart-switch', trade: E, name: 'Smart switch install', hours: 0.75, parts: 45, keywords: ['smart switch', 'smart', 'wifi switch'], group: 'switch' },
  { id: 'e-light-fixture', trade: E, name: 'Light fixture install (existing box)', hours: 1, parts: 15, keywords: ['light fixture', 'fixture', 'light', 'chandelier', 'pendant', 'lighting'] },
  { id: 'e-can-lights', trade: E, name: 'LED recessed light (each)', hours: 0.75, parts: 28, keywords: ['recessed', 'can light', 'can lights', 'pot light', 'downlight', 'led'] },
  { id: 'e-ceiling-fan', trade: E, name: 'Ceiling fan install (fan-rated box)', hours: 1.5, parts: 35, keywords: ['ceiling fan', 'fan'] },
  { id: 'e-panel-200', trade: E, name: 'Panel upgrade to 200A', hours: 10, parts: 1450, keywords: ['panel', 'panel upgrade', 'service upgrade', '200 amp', '200a', 'breaker box', 'fuse box'] },
  { id: 'e-breaker', trade: E, name: 'Breaker replacement', hours: 0.75, parts: 18, keywords: ['breaker', 'tripping', 'trips', 'circuit breaker'], group: 'breaker' },
  { id: 'e-afci', trade: E, name: 'AFCI/GFCI dual-function breaker', hours: 0.75, parts: 58, keywords: ['afci', 'dual function', 'arc fault', 'breaker'], group: 'breaker' },
  { id: 'e-surge', trade: E, name: 'Whole-home surge protector', hours: 1, parts: 135, keywords: ['surge', 'surge protector', 'lightning'] },
  { id: 'e-ev-charger', trade: E, name: 'EV charger install, 48A Level 2', hours: 5, parts: 260, keywords: ['ev', 'ev charger', 'electric vehicle', 'tesla', 'charger', 'car charger', 'level 2'] },
  { id: 'e-240-outlet', trade: E, name: '240V outlet (dryer, range or NEMA 14-50)', hours: 3, parts: 120, keywords: ['240', '240v', 'dryer outlet', 'range outlet', '14-50', 'nema'] },
  { id: 'e-smoke', trade: E, name: 'Hardwired smoke/CO detector (each)', hours: 0.5, parts: 42, keywords: ['smoke', 'smoke detector', 'co detector', 'carbon monoxide', 'alarm'] },
  { id: 'e-exhaust-fan', trade: E, name: 'Bathroom exhaust fan replacement', hours: 1.5, parts: 95, keywords: ['exhaust fan', 'bath fan', 'vent fan', 'bathroom fan'] },
  { id: 'e-outdoor-light', trade: E, name: 'Outdoor motion light', hours: 1, parts: 48, keywords: ['outdoor light', 'motion light', 'flood light', 'security light', 'porch light'] },
  { id: 'e-doorbell', trade: E, name: 'Video doorbell with transformer', hours: 1, parts: 35, keywords: ['doorbell', 'ring', 'video doorbell'] },
  { id: 'e-troubleshoot', trade: E, name: 'Troubleshoot dead circuit', hours: 1, parts: 0, keywords: ['dead', 'not working', 'no power', 'flicker', 'flickering', 'troubleshoot', 'diagnose'] },
  { id: 'e-permit', trade: E, name: 'Permit and inspection coordination', hours: 1, parts: 150, keywords: ['permit', 'inspection', 'code'] },
];

export const priceBookById = (book) => new Map(book.map((i) => [i.id, i]));

/** Merge the user's saved edits/custom items over the defaults. */
export function mergePriceBook(saved) {
  const edits = saved && typeof saved === 'object' ? saved : {};
  const out = DEFAULT_PRICE_BOOK.map((d) => {
    const e = edits.items?.[d.id];
    return e ? { ...d, ...pickEditable(e) } : { ...d };
  });
  for (const c of edits.custom || []) {
    if (c && c.id && c.name && (c.trade === P || c.trade === E)) out.push({ keywords: [], ...c, ...pickEditable(c), custom: true });
  }
  return out;
}

function pickEditable(e) {
  const o = {};
  if (typeof e.name === 'string' && e.name.trim()) o.name = e.name.trim().slice(0, 120);
  if (Number.isFinite(Number(e.hours)) && Number(e.hours) >= 0) o.hours = Number(e.hours);
  if (Number.isFinite(Number(e.parts)) && Number(e.parts) >= 0) o.parts = Number(e.parts);
  return o;
}

const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, couple: 2, pair: 2 };

function normalise(text) {
  return ` ${String(text || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9.\- ]+/g, ' ').replace(/(?<!\d)\.|\.(?!\d)/g, ' ').replace(/\s+/g, ' ').trim()} `;
}
// "outlets" matches "outlet", "lights" matches "light".
const stems = (phrase) => {
  const p = phrase.toLowerCase();
  return [p, `${p}s`, `${p}es`];
};

/**
 * Suggest price-book items from a plain-language job description (local keyword match).
 * Longer phrases score higher; items from the selected trade are preferred.
 * Returns [{ item, qty, score, matched }] sorted by score.
 */
export function suggestItems(description, book, { trade, limit = 6 } = {}) {
  const text = normalise(description);
  if (text.trim().length < 3) return [];
  const results = [];
  for (const item of book) {
    let score = 0;
    let best = null;
    let qty = 1;
    for (const kw of item.keywords || []) {
      for (const form of stems(kw)) {
        const at = text.indexOf(` ${form} `);
        if (at === -1) continue;
        const words = kw.split(' ').length;
        const s = words * 3 + kw.length / 10;
        if (s > score) {
          score = s;
          best = kw;
          // A number right before the phrase sets quantity: "install 6 can lights", "two outlets".
          const before = text.slice(0, at).trim().split(' ');
          const prev = before[before.length - 1];
          const prev2 = before[before.length - 2];
          const n = Number(prev) || NUMBER_WORDS[prev] || ((prev === 'new' || prev === 'gfci' || prev === 'led') && (Number(prev2) || NUMBER_WORDS[prev2]));
          qty = n && n > 0 && n <= 50 && Number.isInteger(n) ? n : 1;
        }
        break;
      }
    }
    if (!score) continue;
    if (item.name.toLowerCase().split(/\W+/).some((w) => w.length > 4 && text.includes(` ${w} `))) score += 1;
    if (trade && item.trade === trade) score += 2;
    results.push({ item, qty, score, matched: best });
  }
  results.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  // Only the best match per group: "kitchen faucet" should not also suggest the bathroom faucet.
  const groups = new Set();
  return results.filter(({ item }) => {
    if (!item.group) return true;
    if (groups.has(item.group)) return false;
    groups.add(item.group);
    return true;
  }).slice(0, limit);
}
