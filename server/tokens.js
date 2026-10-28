// Secrets for emailed quotes. The customer's review link carries a 256-bit
// random token; the builder holds a separate 256-bit owner key. Only SHA-256
// hashes are stored, and comparisons are constant-time.
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export const TOKEN_BYTES = 32; // 256 bits (spec: at least 128)
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes as unpadded base64url

export const newToken = () => randomBytes(TOKEN_BYTES).toString('base64url');
/** Non-secret lookup id that appears in the review URL next to the token. */
export const newPublicId = () => randomBytes(9).toString('base64url');
export const isPublicId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{12}$/.test(s);

export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');

/** Constant-time check of a presented token against a stored hash. */
export function tokenMatches(presented, storedHashHex) {
  const wellFormed = typeof presented === 'string' && TOKEN_RE.test(presented);
  // Always hash and compare, so malformed and wrong tokens take the same path.
  const candidate = createHash('sha256').update(wellFormed ? presented : '-').digest();
  const stored = Buffer.from(typeof storedHashHex === 'string' ? storedHashHex : '', 'hex');
  if (stored.length !== candidate.length) return false;
  return timingSafeEqual(candidate, stored) && wellFormed;
}

/** End of the quote's valid-until day (server local time), as epoch ms. */
export function expiryFor(quote) {
  const d = new Date(quote.createdAt);
  if (Number.isNaN(d.getTime())) return NaN;
  d.setDate(d.getDate() + Math.round(Math.min(Math.max(Number(quote.validDays) || 0, 0), 3650)));
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/**
 * Check a review link. Expiry is only revealed for a correct token.
 * @returns {'ok'|'invalid'|'expired'}
 */
export function checkLink(record, token, now) {
  if (!record || !tokenMatches(token, record.tokenHash)) return 'invalid';
  return now > Date.parse(record.expiresAt) ? 'expired' : 'ok';
}
