// Follow-up reminder schedule for emailed quotes. Pure functions: the server's
// scheduler and the tests both call followUpPlan with an explicit "now".

export const DAY = 24 * 60 * 60 * 1000;
export const DEFAULT_DAYS = [2, 5];
const MAX_REMINDERS = 5;

/** "2, 5" or [5, 2, 2] -> [2, 5]. Whole days 1..60, unique, sorted, at most 5. */
export function normaliseDays(input) {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(/[\s,;]+/);
  const days = [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 60))].sort((a, b) => a - b);
  return days.slice(0, MAX_REMINDERS);
}

export function newFollowUps({ enabled = true, days = DEFAULT_DAYS } = {}) {
  return { enabled: enabled !== false, days: normaliseDays(days), sent: [], skipped: [], stoppedAt: null, stopReason: null };
}

/**
 * Where a quote's reminders stand at `now`.
 * - due:   the reminder to send now (if several are overdue, only the latest; the earlier ones are skipped,
 *          so a server that was off for a week sends one reminder, not three)
 * - skip:  overdue reminders to mark as skipped
 * - next:  the next scheduled reminder after now
 * - stopped: 'approved' | 'declined' | 'off' | 'expired' | null
 * Reminders are never scheduled at or after the quote's expiry.
 */
export function followUpPlan(record, now) {
  const f = record.followUps || newFollowUps({ enabled: false });
  const sentAt = Date.parse(record.sentAt);
  const expires = Date.parse(record.expiresAt);
  const lastSent = f.sent.length ? f.sent[f.sent.length - 1] : null;
  let stopped = null;
  if (record.status === 'approved') stopped = 'approved';
  else if (record.status === 'declined') stopped = 'declined';
  else if (!f.enabled) stopped = 'off';
  else if (now >= expires) stopped = 'expired';
  if (stopped) return { due: null, skip: [], next: null, stopped, lastSent };

  const done = new Set([...f.sent.map((s) => s.day), ...f.skipped]);
  const pending = f.days
    .map((day, i) => ({ day, n: i + 1, at: sentAt + day * DAY }))
    .filter((s) => s.at < expires && !done.has(s.day));
  const overdue = pending.filter((s) => s.at <= now);
  const due = overdue.length ? overdue[overdue.length - 1] : null;
  return {
    due,
    skip: overdue.slice(0, -1).map((s) => s.day),
    next: pending.find((s) => s.at > now) || null,
    stopped: null,
    lastSent,
  };
}

/** Mark reminders as stopped (on approve/decline). Idempotent. */
export function stopFollowUps(record, reason, nowIso) {
  if (!record.followUps.stoppedAt) {
    record.followUps.stoppedAt = nowIso;
    record.followUps.stopReason = reason;
  }
}
