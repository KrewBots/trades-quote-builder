// Browser-only helpers: image -> JPEG data URLs (the PDF writer embeds JPEG),
// file downloads and the signature pad.

/** Load any image URL and re-encode it as a white-backed JPEG, at most maxSide px. */
export function toJpegDataUrl(src, maxSide = 480, quality = 0.9) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.naturalWidth || maxSide, img.naturalHeight || maxSide));
      const w = Math.max(1, Math.round((img.naturalWidth || maxSide) * k));
      const h = Math.max(1, Math.round((img.naturalHeight || maxSide) * k));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('That file could not be read as an image.'));
    img.src = src;
  });
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function download(bytes, filename, type = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Finger/mouse signature pad on a canvas. */
export class SignaturePad {
  constructor(canvas, { onChange } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onChange = onChange || (() => {});
    this.strokes = [];
    this.drawing = null;
    this.resize();
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, () => this.up());
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (!r.width) return;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.scale = dpr;
    this.redraw();
  }

  point(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  down(e) {
    e.preventDefault();
    this.canvas.setPointerCapture?.(e.pointerId);
    this.drawing = [this.point(e)];
    this.strokes.push(this.drawing);
    this.redraw();
  }

  move(e) {
    if (!this.drawing) return;
    e.preventDefault();
    for (const ev of e.getCoalescedEvents?.() || [e]) this.drawing.push(this.point(ev));
    this.redraw();
  }

  up() {
    if (!this.drawing) return;
    this.drawing = null;
    this.onChange(this.isEmpty());
  }

  clear() {
    this.strokes = [];
    this.redraw();
    this.onChange(true);
  }

  isEmpty() {
    return !this.strokes.some((s) => s.length > 2);
  }

  paint(ctx, w, h, lineWidth) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1c1a17';
    ctx.lineWidth = lineWidth;
    for (const s of this.strokes) {
      if (!s.length) continue;
      ctx.beginPath();
      ctx.moveTo(s[0].x * w, s[0].y * h);
      for (let i = 1; i < s.length - 1; i++) {
        const mx = ((s[i].x + s[i + 1].x) / 2) * w;
        const my = ((s[i].y + s[i + 1].y) / 2) * h;
        ctx.quadraticCurveTo(s[i].x * w, s[i].y * h, mx, my);
      }
      const last = s[s.length - 1];
      ctx.lineTo(last.x * w, last.y * h);
      ctx.stroke();
    }
  }

  redraw() {
    const { width: w, height: h } = this.canvas;
    this.ctx.clearRect(0, 0, w, h);
    this.paint(this.ctx, w, h, 2.25 * (this.scale || 1));
  }

  /** White-backed JPEG of the signature at a fixed export size. */
  toJpeg(width = 900, height = 260) {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    this.paint(ctx, width, height, 6);
    return c.toDataURL('image/jpeg', 0.92);
  }
}

/** Render a typed name in the handwriting font as a white-backed JPEG. */
export async function typedSignatureJpeg(name, width = 900, height = 260) {
  await document.fonts.load('600 120px Caveat');
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  let size = 150;
  const setFont = () => { ctx.font = `600 ${size}px Caveat, cursive`; };
  setFont();
  while (ctx.measureText(name).width > width - 60 && size > 40) {
    size -= 6;
    setFont();
  }
  ctx.fillStyle = '#1c1a17';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 30, height / 2 + 6);
  return c.toDataURL('image/jpeg', 0.92);
}
