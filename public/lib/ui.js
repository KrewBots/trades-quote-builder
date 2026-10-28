// Shared UI motion: sheets, the total count-up and the added-row reveal.
// Every motion is skipped when the visitor asks for reduced motion.
import { money } from './pricing.js';

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** cubic-bezier(x1, y1, x2, y2) easing as a function of progress 0..1. */
function bezier(x1, y1, x2, y2) {
  const at = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < x) lo = mid; else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}
const easeOut = bezier(0.22, 0.8, 0.26, 1);

/** "$2,612.45" with the cents in their own span (the hero total shows cents in ink-2). */
export function moneyHtml(v) {
  const m = money(v);
  const dot = m.lastIndexOf('.');
  return dot < 0 ? m : `${m.slice(0, dot)}<span class="cents">${m.slice(dot)}</span>`;
}

const running = new WeakMap();
/** Count the total up (or down) from one value to another over 420 ms. Tabular figures keep it steady. */
export function countUp(els, from, to, duration = 420) {
  const paint = (el, v) => {
    if (el.dataset.cents === undefined) el.textContent = money(v);
    else el.innerHTML = moneyHtml(v);
  };
  for (const el of els) {
    cancelAnimationFrame(running.get(el));
    if (reducedMotion() || from === to) { paint(el, to); continue; }
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / duration);
      paint(el, p === 1 ? to : Math.round((from + (to - from) * easeOut(p)) * 100) / 100);
      if (p < 1) running.set(el, requestAnimationFrame(step));
    };
    running.set(el, requestAnimationFrame(step));
  }
}

/** Open a sheet; CSS slides it up (280 ms) and fades the scrim in. */
export function openSheet(d) {
  d.classList.remove('is-closing');
  if (!d.open) d.showModal();
}

/** Slide a sheet down (200 ms), then close it with an optional return value. */
export function closeSheet(d, value) {
  if (!d.open || d.classList.contains('is-closing')) return;
  const done = () => {
    d.classList.remove('is-closing');
    if (d.open) d.close(value);
  };
  if (reducedMotion()) return done();
  d.classList.add('is-closing');
  const inner = d.querySelector('.sheet-inner');
  let finished = false;
  const once = () => { if (!finished) { finished = true; done(); } };
  inner.addEventListener('animationend', once, { once: true });
  setTimeout(once, 260);
}

/** Close buttons, scrim clicks, Escape and form submits all close sheets the same animated way. */
export function wireSheets(root = document) {
  for (const d of root.querySelectorAll('dialog.sheet')) {
    d.addEventListener('click', (e) => {
      if (e.target === d || e.target.closest('[data-close]')) closeSheet(d, 'cancel');
    });
    d.addEventListener('cancel', (e) => {
      e.preventDefault();
      closeSheet(d, 'cancel');
    });
    const form = d.querySelector('form[method="dialog"]');
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      closeSheet(d, e.submitter?.value || '');
    });
  }
}

/** A newly added row grows in (200 ms), then an accent tint fades out (600 ms). */
export function revealRow(el) {
  if (reducedMotion()) return;
  const h = el.getBoundingClientRect().height;
  el.classList.add('is-new');
  el.animate([{ height: '0px', opacity: 0 }, { height: `${h}px`, opacity: 1 }], { duration: 200, easing: 'ease-out' });
  el.animate([{ backgroundColor: '#EEF1FC' }, { backgroundColor: 'rgba(238,241,252,0)' }], { duration: 600, delay: 200, easing: 'ease-out', fill: 'backwards' })
    .finished.then(() => el.classList.remove('is-new'), () => {});
}
