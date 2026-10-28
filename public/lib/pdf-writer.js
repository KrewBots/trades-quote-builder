// A tiny dependency-free PDF 1.4 writer: standard Helvetica fonts (WinAnsi),
// filled/stroked shapes, lines, text and JPEG images. Content streams are left
// uncompressed so the output is easy to inspect and test. Coordinates use a
// top-left origin in points (1/72 inch); y for text is the baseline.

// Glyph widths (1/1000 em) for chars 32..126 from the Adobe core font metrics.
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const HELV_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

const FONTS = { regular: { key: 'F1', base: 'Helvetica', widths: HELV }, bold: { key: 'F2', base: 'Helvetica-Bold', widths: HELV_BOLD } };

// Unicode -> WinAnsi (cp1252) for the typographic characters people actually type.
const WIN = { 0x20ac: 128, 0x2026: 133, 0x2018: 145, 0x2019: 146, 0x201c: 147, 0x201d: 148, 0x2022: 149, 0x2013: 150, 0x2014: 151, 0x2122: 153 };

/** Encode a JS string as WinAnsi bytes (a binary string). Unsupported chars become '?'. */
export function winAnsi(str) {
  let out = '';
  for (const ch of String(str ?? '')) {
    const c = ch.codePointAt(0);
    if (c === 9 || c === 10 || c === 13) out += ' ';
    else if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255)) out += ch;
    else if (WIN[c]) out += String.fromCharCode(WIN[c]);
    else out += '?';
  }
  return out;
}

export function textWidth(str, size, font = 'regular') {
  const w = FONTS[font].widths;
  let units = 0;
  for (const ch of winAnsi(str)) {
    const c = ch.charCodeAt(0);
    units += c >= 32 && c <= 126 ? w[c - 32] : 556;
  }
  return (units * size) / 1000;
}

/** Greedy word wrap to a max width; very long words are hard-broken. */
export function wrap(str, size, maxWidth, font = 'regular') {
  const lines = [];
  for (const para of String(str ?? '').split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size, font) <= maxWidth) { line = next; continue; }
      if (line) lines.push(line);
      let w = word;
      while (textWidth(w, size, font) > maxWidth && w.length > 1) {
        let cut = w.length - 1;
        while (cut > 1 && textWidth(w.slice(0, cut), size, font) > maxWidth) cut--;
        lines.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      line = w;
    }
    lines.push(line);
  }
  return lines;
}

const esc = (s) => winAnsi(s).replace(/[\\()]/g, (m) => `\\${m}`);
const f = (n) => (Math.round(n * 100) / 100).toString();

function rgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => f(parseInt(h.slice(i, i + 2), 16) / 255)).join(' ');
}

/** Pull width/height out of a baseline or progressive JPEG (SOFn marker). */
export function jpegSize(bin) {
  let i = 2;
  while (i < bin.length) {
    if (bin.charCodeAt(i) !== 0xff) { i++; continue; }
    const marker = bin.charCodeAt(i + 1);
    const len = (bin.charCodeAt(i + 2) << 8) | bin.charCodeAt(i + 3);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return {
        height: (bin.charCodeAt(i + 5) << 8) | bin.charCodeAt(i + 6),
        width: (bin.charCodeAt(i + 7) << 8) | bin.charCodeAt(i + 8),
        components: bin.charCodeAt(i + 9),
      };
    }
    i += 2 + len;
  }
  return null;
}

/** data:image/jpeg;base64,... -> binary string, or null. */
export function jpegFromDataUrl(url) {
  const m = /^data:image\/jpe?g;base64,([A-Za-z0-9+/=]+)$/.exec(url || '');
  if (!m) return null;
  let bin;
  try { bin = atob(m[1]); } catch { return null; } // malformed base64 (e.g. padding mid-string)
  try { return jpegSize(bin) ? bin : null; } catch { return null; }
}

export class PdfDoc {
  constructor({ width = 612, height = 792, title = 'Document', author = '' } = {}) {
    this.W = width;
    this.H = height;
    this.title = title;
    this.author = author;
    this.pages = [];
    this.images = [];
    this.page = null;
  }

  addPage() {
    this.page = [];
    this.pages.push(this.page);
    return this;
  }

  /** Rectangle path ops; with a radius the corners are quarter circles drawn as Bezier curves. */
  rectPath(x, y, w, h, radius = 0) {
    const r = Math.min(radius, w / 2, h / 2);
    const b = this.H - y - h; // PDF origin is bottom-left
    if (!(r > 0)) return `${f(x)} ${f(b)} ${f(w)} ${f(h)} re`;
    const k = r * 0.5523; // control-point distance for a quarter circle
    const t = b + h;
    const r2 = x + w;
    return [
      `${f(x + r)} ${f(b)} m`, `${f(r2 - r)} ${f(b)} l`,
      `${f(r2 - r + k)} ${f(b)} ${f(r2)} ${f(b + r - k)} ${f(r2)} ${f(b + r)} c`, `${f(r2)} ${f(t - r)} l`,
      `${f(r2)} ${f(t - r + k)} ${f(r2 - r + k)} ${f(t)} ${f(r2 - r)} ${f(t)} c`, `${f(x + r)} ${f(t)} l`,
      `${f(x + r - k)} ${f(t)} ${f(x)} ${f(t - r + k)} ${f(x)} ${f(t - r)} c`, `${f(x)} ${f(b + r)} l`,
      `${f(x)} ${f(b + r - k)} ${f(x + r - k)} ${f(b)} ${f(x + r)} ${f(b)} c h`,
    ].join(' ');
  }

  rect(x, y, w, h, { fill, stroke, lineWidth = 1, radius = 0 } = {}) {
    const ops = [];
    if (fill) ops.push(`${rgb(fill)} rg`);
    if (stroke) ops.push(`${rgb(stroke)} RG ${f(lineWidth)} w`);
    ops.push(`${this.rectPath(x, y, w, h, radius)} ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
    this.page.push(ops.join(' '));
    return this;
  }

  line(x1, y1, x2, y2, { color = '#000000', width = 1, dash } = {}) {
    this.page.push(`${rgb(color)} RG ${f(width)} w ${dash ? `[${dash.join(' ')}] 0 d ` : ''}${f(x1)} ${f(this.H - y1)} m ${f(x2)} ${f(this.H - y2)} l S${dash ? ' [] 0 d' : ''}`);
    return this;
  }

  text(x, y, str, { size = 10, font = 'regular', color = '#000000', align = 'left', spacing = 0 } = {}) {
    let tx = x;
    const w = textWidth(str, size, font) + spacing * Math.max(0, winAnsi(str).length - 1);
    if (align === 'right') tx = x - w;
    else if (align === 'center') tx = x - w / 2;
    this.page.push(`BT /${FONTS[font].key} ${f(size)} Tf ${rgb(color)} rg ${spacing ? `${f(spacing)} Tc ` : ''}${f(tx)} ${f(this.H - y)} Td (${esc(str)}) Tj${spacing ? ' 0 Tc' : ''} ET`);
    return this;
  }

  /** Draw a JPEG (binary string), optionally clipped to rounded corners. Returns false when the data is not a usable JPEG. */
  image(bin, x, y, w, h, { radius = 0 } = {}) {
    const size = jpegSize(bin || '');
    if (!size) return false;
    let img = this.images.find((i) => i.bin === bin);
    if (!img) {
      img = { bin, ...size, name: `Im${this.images.length + 1}` };
      this.images.push(img);
    }
    const clip = radius > 0 ? `${this.rectPath(x, y, w, h, radius)} W n ` : '';
    this.page.push(`q ${clip}${f(w)} 0 0 ${f(h)} ${f(x)} ${f(this.H - y - h)} cm /${img.name} Do Q`);
    return true;
  }

  /** @returns {Uint8Array} */
  toBytes() {
    const objs = [];
    const add = (body) => { objs.push(body); return objs.length; };
    const catalog = add(null);
    const pagesId = add(null);
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const date = `D:${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
    const info = add(`<< /Title (${esc(this.title)}) /Author (${esc(this.author)}) /Producer (Trades Quote Builder) /CreationDate (${date}) >>`);
    const imageIds = this.images.map((img) => add(
      `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /${img.components === 1 ? 'DeviceGray' : img.components === 4 ? 'DeviceCMYK' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bin.length} >>\nstream\n${img.bin}\nendstream`,
    ));
    const xobjects = this.images.map((img, i) => `/${img.name} ${imageIds[i]} 0 R`).join(' ');
    const resources = `<< /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${xobjects ? ` /XObject << ${xobjects} >>` : ''} >>`;
    const pageIds = this.pages.map((ops) => {
      const content = ops.join('\n');
      const c = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.W} ${this.H}] /Resources ${resources} /Contents ${c} 0 R >>`);
    });
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offsets = [];
    objs.forEach((body, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  }
}
