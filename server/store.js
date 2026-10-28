// Server-side storage for emailed quotes and the demo outbox: one JSON file in
// the data folder (default data/ in the app folder, git-ignored).
// Writes go to a temp file first, then replace the real one, so a crash never
// leaves half a file.
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
  };
}
