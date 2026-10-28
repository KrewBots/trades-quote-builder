// Branded quote and follow-up emails. Email clients need inline styles and
// table layout; every value from the quote is HTML-escaped.
import { quoteTotals, money, trimNum, formatDate } from '../public/lib/pricing.js';
import { validUntil } from '../public/lib/model.js';
import { TRADES } from '../public/lib/pricebook.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const INK = '#13233f';
const ORANGE = '#e8590c';
const MUTED = '#5d6676';

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
  const intro = followup
    ? `Just a reminder that your quote for <b>${esc(quote.jobTitle || 'your job')}</b> is ready whenever you are. It is valid until <b>${esc(until)}</b>.`
    : `Thanks for having us out. Here is your quote for <b>${esc(quote.jobTitle || 'your job')}</b>. The full PDF is attached.`;

  const rows = quote.items.map((it, i) => `<tr>
      <td style="padding:10px 0;border-bottom:1px solid #e6e0d5;color:${INK};font-size:15px;">${esc(it.name)}${t.lines[i].qty !== 1 ? ` <span style="color:${MUTED}">&times; ${trimNum(t.lines[i].qty)}</span>` : ''}</td>
      <td style="padding:10px 0;border-bottom:1px solid #e6e0d5;color:${INK};font-size:15px;text-align:right;white-space:nowrap;font-weight:bold;">${money(t.lines[i].amount)}</td>
    </tr>`).join('');

  const contact = [business.phone, business.email].filter(Boolean).map(esc).join(' &middot; ');
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#ece8e1;font-family:Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ece8e1;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:2px solid ${INK};">
  <tr><td style="background:${INK};padding:20px 24px;border-bottom:5px solid ${ORANGE};">
    <div style="color:#ffffff;font-size:20px;font-weight:bold;">${esc(biz)}</div>
    ${business.license ? `<div style="color:#ffb37f;font-size:12px;margin-top:4px;">${esc(business.license)}</div>` : ''}
  </td></tr>
  <tr><td style="padding:24px;">
    ${followup ? `<div style="display:inline-block;background:#fff2e8;color:${ORANGE};font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;padding:4px 10px;border-radius:99px;margin-bottom:12px;">Reminder ${n}</div>` : ''}
    <p style="margin:0 0 14px;color:${INK};font-size:16px;">Hi${client ? ` ${esc(client)}` : ''},</p>
    <p style="margin:0 0 20px;color:${INK};font-size:16px;line-height:1.5;">${intro}</p>
    <div style="font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${ORANGE};margin-bottom:4px;">Quote ${esc(quote.number)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}
      <tr><td style="padding:12px 0 0;color:${MUTED};font-size:14px;">Includes tax ${trimNum(t.taxRate)}%</td><td></td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;background:${ORANGE};border-radius:10px;">
      <tr><td style="padding:14px 16px;color:#ffffff;font-size:13px;font-weight:bold;letter-spacing:2px;">TOTAL</td>
      <td style="padding:14px 16px;color:#ffffff;font-size:26px;font-weight:bold;text-align:right;">${money(t.total)}</td></tr>
    </table>
    <p style="margin:14px 0 22px;color:${MUTED};font-size:14px;">Valid until ${esc(until)}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center">
      <a href="${esc(link)}" style="display:inline-block;background:${INK};color:#ffffff;text-decoration:none;font-weight:bold;font-size:17px;padding:16px 34px;border-radius:12px;">Review &amp; approve</a>
    </td></tr></table>
    <p style="margin:18px 0 0;color:${MUTED};font-size:12px;line-height:1.5;text-align:center;">This link is private to you. ${esc(ACCEPTANCE_LINE)}</p>
  </td></tr>
  <tr><td style="padding:16px 24px;background:#f6f3ed;color:${MUTED};font-size:12px;line-height:1.5;">
    ${esc(biz)}${contact ? `<br>${contact}` : ''}${business.address ? `<br>${esc(business.address)}` : ''}
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
