// Branded quote and follow-up emails. Email clients need inline styles and
// table layout; every value from the quote is HTML-escaped.
import { quoteTotals, money, trimNum, formatDate } from '../public/lib/pricing.js';
import { validUntil } from '../public/lib/model.js';
import { TRADES } from '../public/lib/pricebook.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const INK = '#1C1A17';
const INK2 = '#4A463F';
const MUTED = '#6B655B';
const LINE = '#E7E2D9';
const ACCENT = '#2D47C9';
const FONT = 'font-family:Helvetica,Arial,sans-serif;';

export const ACCEPTANCE_LINE = 'Approving records a simple acceptance on the contractor\'s quote server. It is not a certified e-signature service.';

/**
 * @param {{quote, business}} snapshot
 * @param {{link: string, kind?: 'quote'|'followup', n?: number}} opts
 */
export function quoteEmail({ quote, business }, { link, kind = 'quote', n = 1 }) {
  const t = quoteTotals(quote.items, quote);
  const biz = business.name || 'Your contractor';
  const client = quote.client?.name ? quote.client.name.split(/\s+/)[0] : '';
  const until = formatDate(validUntil(quote));
  const trade = TRADES[quote.trade]?.label || '';
  const followup = kind === 'followup';
  const subject = followup
    ? `Reminder: your quote ${quote.number} from ${biz} is waiting`
    : `Your ${trade.toLowerCase()} quote ${quote.number} from ${biz}: ${money(t.total)}`;
  const strong = (x) => `<b style="color:${INK}">${esc(x)}</b>`;
  const intro = followup
    ? `Just a reminder that your quote for ${strong(quote.jobTitle || 'your job')} is ready whenever you are. It is valid until ${strong(until)}.`
    : `Thanks for having us out. Here is your quote for ${strong(quote.jobTitle || 'your job')}. The full PDF is attached.`;

  const cell = `border-bottom:1px solid ${LINE};color:${INK};font-size:15px;line-height:20px;`;
  const rows = quote.items.map((it, i) => `<tr><td style="padding:12px 0;${cell}">${esc(it.name)}${t.lines[i].qty !== 1 ? ` <span style="color:${MUTED}">&times; ${trimNum(t.lines[i].qty)}</span>` : ''}</td><td style="padding:12px 0 12px 12px;${cell}text-align:right;white-space:nowrap;">${money(t.lines[i].amount)}</td></tr>`).join('');

  // Name only in the header: mail clients strip data: and SVG images, so no logo.
  const contact = [business.phone, business.email].filter(Boolean).map(esc).join(' &middot; ');
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#F6F4F0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F4F0;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:14px;">
  <tr><td style="padding:22px 24px;border-bottom:1px solid ${LINE};${FONT}">
    <div style="color:${INK};font-size:17px;line-height:22px;font-weight:bold;">${esc(biz)}</div>
    ${business.license ? `<div style="color:${MUTED};font-size:14px;line-height:20px;">${esc(business.license)}</div>` : ''}
  </td></tr>
  <tr><td style="padding:24px;${FONT}">
    ${followup ? `<div style="display:inline-block;background:#EEF1FC;color:#1E2E86;font-size:14px;font-weight:bold;padding:4px 10px;border-radius:99px;margin-bottom:14px;">Reminder ${n}</div>` : ''}
    <p style="margin:0 0 12px;color:${INK};font-size:16px;line-height:24px;">Hi${client ? ` ${esc(client)}` : ''},</p>
    <p style="margin:0 0 22px;color:${INK2};font-size:16px;line-height:24px;">${intro}</p>
    <div style="color:${MUTED};font-size:14px;line-height:20px;margin-bottom:4px;">Quote ${esc(quote.number)}${trade ? ` &middot; ${esc(trade)}` : ''}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${INK};">${rows}</table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;background:#EEF1FC;border-radius:10px;">
      <tr><td style="padding:16px;color:${INK};font-size:15px;font-weight:bold;">Total</td><td style="padding:16px;color:${INK};font-size:28px;line-height:32px;font-weight:bold;text-align:right;white-space:nowrap;">${money(t.total)}</td></tr>
    </table>
    <p style="margin:10px 0 24px;color:${MUTED};font-size:14px;line-height:20px;">Includes ${trimNum(t.taxRate)}% tax &middot; Valid until ${esc(until)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td>
      <a href="${esc(link)}" style="display:block;background:${ACCENT};color:#ffffff;text-decoration:none;font-weight:bold;font-size:17px;line-height:22px;padding:15px 24px;border-radius:10px;text-align:center;">Review &amp; approve</a>
    </td></tr></table>
    <p style="margin:16px 0 0;color:${MUTED};font-size:14px;line-height:20px;">This link is private to you. ${esc(ACCEPTANCE_LINE)}</p>
  </td></tr>
  <tr><td style="padding:18px 24px;border-top:1px solid ${LINE};background:#FBFAF8;border-radius:0 0 14px 14px;${FONT}color:${MUTED};font-size:14px;line-height:21px;">
    <b style="color:${INK2}">${esc(biz)}</b>${contact ? `<br>${contact}` : ''}${business.address ? `<br>${esc(business.address)}` : ''}
  </td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    `Hi${client ? ` ${client}` : ''},`,
    '',
    followup
      ? `A reminder that your quote for ${quote.jobTitle || 'your job'} is ready. It is valid until ${until}.`
      : `Here is your quote for ${quote.jobTitle || 'your job'}. The PDF is attached.`,
    '',
    ...quote.items.map((it, i) => `- ${it.name}${t.lines[i].qty !== 1 ? ` x ${trimNum(t.lines[i].qty)}` : ''}: ${money(t.lines[i].amount)}`),
    `Total (incl. tax ${trimNum(t.taxRate)}%): ${money(t.total)}`,
    `Valid until ${until}`,
    '',
    `Review & approve: ${link}`,
    '',
    ACCEPTANCE_LINE,
    '',
    [biz, business.phone, business.email].filter(Boolean).join(' | '),
  ].join('\n');

  return { subject, html, text };
}
