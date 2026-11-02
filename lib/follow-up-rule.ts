/**
 * Follow Up rule (Owner, 2026-10-23):
 * - A lead is in Follow Up once its follow-up date+time (stored as an instant; entered in
 *   America/Chicago) is reached.
 * - It stays there indefinitely — it never expires on its own.
 * - It leaves ONLY when the lead is touched AFTER the due time: an email sent (any template)
 *   or a note added (any note box). A touch before the due time does not pre-clear it.
 * - Setting a new, future follow-up time clears it until that time is reached.
 */
export function isFollowUpDue(followUpAt: string | null | undefined, lastTouchedAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!followUpAt) return false;
  const due = new Date(followUpAt).getTime();
  if (Number.isNaN(due) || due > now) return false;
  const touched = lastTouchedAt ? new Date(lastTouchedAt).getTime() : NaN;
  return !(touched >= due);
}
