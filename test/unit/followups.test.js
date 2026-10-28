import { test } from 'node:test';
import assert from 'node:assert/strict';
import { followUpPlan, followUpSchedule, normaliseDays, newFollowUps, stopFollowUps, DAY, DEFAULT_DAYS } from '../../server/followups.js';

const T0 = Date.parse('2026-10-28T15:00:00Z');
const rec = (over = {}) => ({
  status: 'sent',
  sentAt: new Date(T0).toISOString(),
  expiresAt: new Date(T0 + 30 * DAY).toISOString(),
  followUps: newFollowUps(),
  ...over,
});
const at = (days, hours = 0) => T0 + days * DAY + hours * 3600e3;

test('defaults are 2 and 5 days, on', () => {
  assert.deepEqual(DEFAULT_DAYS, [2, 5]);
  const f = newFollowUps();
  assert.equal(f.enabled, true);
  assert.deepEqual(f.days, [2, 5]);
});

test('normaliseDays: strings, arrays, junk, duplicates, bounds, max 5', () => {
  assert.deepEqual(normaliseDays('2, 5'), [2, 5]);
  assert.deepEqual(normaliseDays('5;2 2'), [2, 5]);
  assert.deepEqual(normaliseDays([7, '3', 3, 0, -1, 1.5, 61, 'x']), [3, 7]);
  assert.deepEqual(normaliseDays('1,2,3,4,5,6,7'), [1, 2, 3, 4, 5]);
  assert.deepEqual(normaliseDays(''), []);
  assert.deepEqual(normaliseDays(undefined), []);
});

test('schedule: next is day 2, then due at day 2, then next is day 5', () => {
  const r = rec();
  let p = followUpPlan(r, at(0, 1));
  assert.equal(p.due, null);
  assert.equal(p.next.at, at(2));
  assert.equal(p.next.n, 1);
  p = followUpPlan(r, at(2));
  assert.equal(p.due.day, 2);
  assert.equal(p.due.n, 1);
  r.followUps.sent.push({ day: 2, n: 1, at: new Date(at(2)).toISOString() });
  p = followUpPlan(r, at(2, 1));
  assert.equal(p.due, null);
  assert.equal(p.next.at, at(5));
  assert.equal(p.lastSent.day, 2);
  p = followUpPlan(r, at(5));
  assert.equal(p.due.day, 5);
  r.followUps.sent.push({ day: 5, n: 2, at: new Date(at(5)).toISOString() });
  p = followUpPlan(r, at(9));
  assert.equal(p.due, null);
  assert.equal(p.next, null);
  assert.equal(p.stopped, null);
});

test('several overdue reminders: send only the latest, skip the earlier ones', () => {
  const p = followUpPlan(rec(), at(6));
  assert.equal(p.due.day, 5);
  assert.deepEqual(p.skip, [2]);
  const r = rec({ followUps: { ...newFollowUps(), skipped: [2] } });
  assert.equal(followUpPlan(r, at(3)).due, null, 'skipped reminders never fire later');
});

test('stops immediately on approve or decline, and when turned off', () => {
  for (const status of ['approved', 'declined']) {
    const p = followUpPlan(rec({ status }), at(2));
    assert.equal(p.stopped, status);
    assert.equal(p.due, null);
    assert.equal(p.next, null);
  }
  const off = rec({ followUps: { ...newFollowUps(), enabled: false } });
  assert.equal(followUpPlan(off, at(2)).stopped, 'off');
  assert.equal(followUpPlan(off, at(2)).due, null);
  // Turning back on resumes.
  off.followUps.enabled = true;
  assert.equal(followUpPlan(off, at(2)).due.day, 2);
});

test('stopFollowUps records when and why, once', () => {
  const r = rec();
  stopFollowUps(r, 'approved', '2026-10-29T10:00:00.000Z');
  stopFollowUps(r, 'declined', '2026-10-30T10:00:00.000Z');
  assert.equal(r.followUps.stopReason, 'approved');
  assert.equal(r.followUps.stoppedAt, '2026-10-29T10:00:00.000Z');
});

test('never schedules at or after expiry; stops once expired', () => {
  const r = rec({ expiresAt: new Date(at(4)).toISOString() });
  const p = followUpPlan(r, at(3));
  assert.equal(p.due.day, 2);
  assert.equal(p.next, null, 'day 5 is past expiry');
  assert.equal(followUpPlan(r, at(4, 1)).stopped, 'expired');
});

test('editing days after a reminder was sent keeps the sent one and schedules the rest', () => {
  const r = rec();
  r.followUps.sent.push({ day: 2, n: 1, at: new Date(at(2)).toISOString() });
  r.followUps.days = normaliseDays('2, 3, 7');
  const p = followUpPlan(r, at(2, 2));
  assert.equal(p.next.day, 3);
  assert.equal(followUpPlan(r, at(3)).due.day, 3);
});

test('followUpSchedule: sent, next and later reminders with real times; none past expiry; none once stopped', () => {
  const r = rec({ expiresAt: new Date(T0 + 4 * DAY).toISOString(), followUps: newFollowUps({ days: [2, 3, 5] }) });
  let s = followUpSchedule(r, at(0, 1));
  assert.deepEqual(s.map((x) => [x.n, x.state, x.at]), [
    [1, 'next', new Date(at(2)).toISOString()],
    [2, 'scheduled', new Date(at(3)).toISOString()],
  ], 'day 5 is past the 4-day expiry');
  r.followUps.sent.push({ day: 2, n: 1, at: new Date(at(2, 1)).toISOString() });
  s = followUpSchedule(r, at(2, 2));
  assert.deepEqual(s.map((x) => [x.n, x.state]), [[1, 'sent'], [2, 'next']]);
  assert.equal(s[0].at, new Date(at(2, 1)).toISOString(), 'sent reminder keeps its real send time');
  r.status = 'approved';
  assert.deepEqual(followUpSchedule(r, at(2, 3)).map((x) => x.state), ['sent']);
});
