// Server-side storage for emailed quotes and the demo outbox.
// createStore: one JSON file in the data folder (default data/ in the app
// folder, git-ignored). Writes go to a temp file first, then replace the real
// one, so a crash never leaves half a file.
// createMemoryStore: the public demo's store. Nothing touches disk, and counts
// and total size are capped: past a cap the oldest entries are deleted first.
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';

export function createStore(dir) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'quotes.json');
  let data = { quotes: {}, outbox: [] };
  if (existsSync(file)) {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    data = { quotes: parsed.quotes || {}, outbox: parsed.outbox || [] };
  }
  const save = () => {
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, file);
  };
  return {
    file,
    save,
    getQuote: (id) => data.quotes[id] || null,
    findByPublicId: (pid) => Object.values(data.quotes).find((q) => q.publicId === pid) || null,
    allQuotes: () => Object.values(data.quotes),
    putQuote(rec) {
      data.quotes[rec.id] = rec;
      save();
    },
    addOutbox(msg) {
      data.outbox.push(msg);
      save();
      return msg;
    },
    listOutbox: () => data.outbox,
    getOutbox: (id) => data.outbox.find((m) => m.id === id) || null,
    wipe() {
      data = { quotes: {}, outbox: [] };
      save();
    },
  };
}

const sizeOf = (v) => Buffer.byteLength(JSON.stringify(v));

/**
 * @param {{maxQuotes: number, maxOutbox: number, maxBytes: number}} caps
 */
export function createMemoryStore({ maxQuotes, maxOutbox, maxBytes }) {
  // Maps keep insertion order, so the first key is always the oldest.
  let quotes = new Map(); // id -> { rec, size }
  let outbox = new Map(); // id -> { msg, size }
  let bytes = 0;
  const stats = { evictedQuotes: 0, evictedOutbox: 0 };

  function dropOldest(map, counter) {
    const [k, v] = map.entries().next().value;
    map.delete(k);
    bytes -= v.size;
    stats[counter]++;
  }
  function enforce() {
    while (quotes.size > maxQuotes) dropOldest(quotes, 'evictedQuotes');
    while (outbox.size > maxOutbox) dropOldest(outbox, 'evictedOutbox');
    // Over the byte budget: drop whichever of the two oldest entries is older (mock emails first on a tie).
    while (bytes > maxBytes && (quotes.size || outbox.size)) {
      const oq = quotes.values().next().value;
      const oo = outbox.values().next().value;
      if (oo && (!oq || oo.at <= oq.at)) dropOldest(outbox, 'evictedOutbox');
      else dropOldest(quotes, 'evictedQuotes');
    }
  }
  let seq = 0;
  return {
    memory: true,
    getQuote: (id) => quotes.get(id)?.rec || null,
    findByPublicId(pid) {
      for (const { rec } of quotes.values()) if (rec.publicId === pid) return rec;
      return null;
    },
    allQuotes: () => [...quotes.values()].map((v) => v.rec),
    putQuote(rec) {
      const old = quotes.get(rec.id);
      const size = sizeOf(rec);
      if (old) { bytes += size - old.size; old.size = size; old.rec = rec; } // updates keep their age
      else { quotes.set(rec.id, { rec, size, at: ++seq }); bytes += size; }
      enforce();
    },
    addOutbox(msg) {
      const size = sizeOf(msg);
      outbox.set(msg.id, { msg, size, at: ++seq });
      bytes += size;
      enforce();
      return msg;
    },
    listOutbox: () => [...outbox.values()].map((v) => v.msg),
    getOutbox: (id) => outbox.get(id)?.msg || null,
    wipe() {
      quotes = new Map();
      outbox = new Map();
      bytes = 0;
    },
    get usage() { return { quotes: quotes.size, outbox: outbox.size, bytes, ...stats }; },
  };
}
