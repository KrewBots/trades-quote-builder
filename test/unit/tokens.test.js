import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newToken, newPublicId, isPublicId, hashToken, tokenMatches, checkLink, expiryFor, TOKEN_BYTES } from '../../server/tokens.js';

test('tokens are 256-bit, base64url, unique', () => {
  assert.ok(TOKEN_BYTES * 8 >= 128);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const t = newToken();
    assert.match(t, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(t, 'base64url').length, 32);
    seen.add(t);
  }
  assert.equal(seen.size, 2000);
  assert.ok(isPublicId(newPublicId()));
  assert.ok(!isPublicId('../etc'));
});

test('only hashes are stored; matching is exact', () => {
  const t = newToken();
  const h = hashToken(t);
  assert.match(h, /^[a-f0-9]{64}$/);
  assert.ok(!h.includes(t));
  assert.equal(tokenMatches(t, h), true);
  // One changed character, wrong length, other types and junk hashes all fail.
  const flipped = (t[0] === 'A' ? 'B' : 'A') + t.slice(1);
  assert.equal(tokenMatches(flipped, h), false);
  assert.equal(tokenMatches(t.slice(1), h), false);
  assert.equal(tokenMatches(`${t}A`, h), false);
  assert.equal(tokenMatches(undefined, h), false);
  assert.equal(tokenMatches(null, h), false);
  assert.equal(tokenMatches({}, h), false);
  assert.equal(tokenMatches(t, ''), false);
  assert.equal(tokenMatches(t, 'zz'), false);
  assert.equal(tokenMatches(t, undefined), false);
  // A malformed token that happens to hash to the stored value still fails (well-formedness required).
  assert.equal(tokenMatches('-', hashToken('-')), false);
});

test('expiry is the end of the valid-until day', () => {
  const q = { createdAt: new Date(2026, 9, 28, 9, 30).toISOString(), validDays: 30 };
  const end = new Date(expiryFor(q));
  assert.equal(end.getFullYear(), 2026);
  assert.equal(end.getMonth(), 10);
  assert.equal(end.getDate(), 27);
  assert.equal(end.getHours(), 23);
  assert.equal(end.getMinutes(), 59);
  assert.ok(Number.isNaN(expiryFor({ createdAt: 'nope', validDays: 3 })));
  // validDays is clamped, never negative.
  assert.equal(new Date(expiryFor({ ...q, validDays: -5 })).getDate(), 28);
});

test('checkLink: ok, invalid and expired (expiry only revealed for a correct token)', () => {
  const t = newToken();
  const rec = { tokenHash: hashToken(t), expiresAt: new Date(2026, 10, 27, 23, 59, 59, 999).toISOString() };
  const before = new Date(2026, 10, 27, 12).getTime();
  const after = new Date(2026, 10, 28, 0, 0, 1).getTime();
  assert.equal(checkLink(rec, t, before), 'ok');
  assert.equal(checkLink(rec, t, Date.parse(rec.expiresAt)), 'ok');
  assert.equal(checkLink(rec, t, after), 'expired');
  assert.equal(checkLink(rec, newToken(), before), 'invalid');
  assert.equal(checkLink(rec, newToken(), after), 'invalid');
  assert.equal(checkLink(null, t, before), 'invalid');
});
