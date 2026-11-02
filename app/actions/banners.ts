"use server";

import { mergeCustomerViews, mergedLabel, tableHits, type EmailEventHit } from "@/lib/customer-email-views";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase";
import { getStaff, isManager } from "@/lib/crm-server";
import { PER_VIEWER_KINDS, RANGES, rangeBounds, type RangeKey } from "@/lib/crm-constants";
import { signedFlags } from "@/app/actions/leads";
import { isFollowUpDue } from "@/lib/follow-up-rule";
import { formatPriority } from "@/lib/follow-up-domain";
import { loadPriorityLabels } from "@/lib/priority-labels";

export type FollowUpItem = { id: string; job_number: string | null; customer_name: string | null; follow_up_at: string; last_touched_at: string | null; rep: string };
export type NotificationItem = { id: string; created_at: string; kind: string; message: string; amount: number | null; estimate_id: string | null; dismissed_at: string | null };

/**
 * Banner data for the signed-in user. Follow-ups: scheduled date+time reached and the lead
 * not touched (note / email) since — they stay on until touched. The browser re-checks the
 * clock itself, so a follow-up turns on at its exact time without a server round trip.
 */
export async function getBannerState(focusEstimateId?: string) {
  const staff = await getStaff();
  if (!staff) return { ok: false as const };
  const admin = createSupabaseAdminClient();
  const manager = isManager(staff);
  const horizon = new Date(Date.now() + 36 * 3600 * 1000).toISOString();

  // On a lead, an administrator sees that lead's rep's banners. The main menu stays the signed-in user.
  let scopeUserId = staff.userId;
  if (focusEstimateId && manager) {
    const { data: focus } = await admin.from("estimates").select("owner_id").eq("id", focusEstimateId).is("deleted_at", null).maybeSingle();
    if (focus?.owner_id) scopeUserId = focus.owner_id;
  }

  let fq = admin.from("estimates")
    .select("id, job_number, customer_name, follow_up_at, last_touched_at, assigned_rep_id")
    .not("follow_up_at", "is", null).lte("follow_up_at", horizon)
    .is("deleted_at", null).in("status", ["draft", "quoted", "signed"]);
  fq = fq.eq("owner_id", scopeUserId);
  const since = new Date(Date.now() - 62 * 86400 * 1000).toISOString();
  const [{ data: fu }, { data: reps }, { data: notes }, unassigned] = await Promise.all([
    fq.order("follow_up_at"),
    admin.from("crm_reps").select("id, name"),
    admin.from("crm_notifications").select("id, created_at, kind, message, amount, estimate_id, dismissed_at")
      .eq("user_id", scopeUserId).gte("created_at", since).order("created_at", { ascending: false }).limit(500),
    staff.canClaimUnassigned
      ? admin.from("estimates").select("id, job_number, customer_name, created_at").eq("status", "unassigned").is("deleted_at", null).order("created_at")
      : Promise.resolve({ data: [] as { id: string; job_number: string | null; customer_name: string | null; created_at: string }[] }),
  ]);
  // Needs carrier stays until a carrier is assigned or dates change, however old (not limited to 62 days).
  const { data: owes } = await admin.from("crm_notifications").select("id, created_at, kind, message, amount, estimate_id, dismissed_at")
    .eq("user_id", scopeUserId).in("kind", ["carrier_owes", "needs_carrier"]).is("dismissed_at", null).lt("created_at", since).limit(200);
  if (owes?.length && notes) notes.push(...owes);
  const repName = new Map((reps || []).map(r => [r.id, r.name]));
  const followUps: FollowUpItem[] = (fu || [])
    // Follow Up rule (lib/follow-up-rule.ts). Leads due in the next 36 h are included so the
    // browser switches each one on at its exact time; a touch at/after the due time removes it.
    .filter(e => isFollowUpDue(e.follow_up_at, e.last_touched_at, Math.max(Date.now(), new Date(e.follow_up_at).getTime())))
    .map(e => ({ id: e.id, job_number: e.job_number, customer_name: e.customer_name, follow_up_at: e.follow_up_at, last_touched_at: e.last_touched_at, rep: repName.get(e.assigned_rep_id) || "" }));

  // Job Assigned (Owner 2026-10-31): admins/supervisors (Owner, Jordan) get their OWN row for every
  // rep's carrier-assigned job (see notify()), salesmen only for their own jobs. So on a lead page,
  // where a manager's scope switches to that lead's rep, keep the manager's own Job Assigned rows
  // instead of the rep's: the manager still sees all reps, and opening the job clears only their row.
  let scopedNotes = notes || [];
  if (scopeUserId !== staff.userId) {
    // Same for Payment received / Customer pickup / Customer delivered / Carrier owes / Needs carrier:
    // each admin has their own row and viewing clears only that admin's row.
    const { data: own } = await admin.from("crm_notifications").select("id, created_at, kind, message, amount, estimate_id, dismissed_at")
      .eq("user_id", staff.userId).in("kind", [...PER_VIEWER_KINDS]).gte("created_at", since).order("created_at", { ascending: false }).limit(300);
    scopedNotes = [...scopedNotes.filter(n => !PER_VIEWER_KINDS.has(n.kind)), ...(own || [])]
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }
  // Cancelled (or deleted) leads drop out of every banner.
  const noteEst = [...new Set(scopedNotes.map(n => n.estimate_id).filter(Boolean))] as string[];
  // A BOOKED job is operations, not a lead: it leaves the New Lead / Assign banners too.
  const { data: liveEst } = noteEst.length
    ? await admin.from("estimates").select("id, status").in("id", noteEst).neq("status", "cancelled").is("deleted_at", null)
    : { data: [] as { id: string; status: string }[] };
  const live = new Map((liveEst || []).map(e => [e.id, e.status]));
  const LEAD_KINDS = new Set(["new_lead", "unassigned_lead"]);
  const visibleNotes = scopedNotes.filter(n => !n.estimate_id || (live.has(n.estimate_id) && !(LEAD_KINDS.has(n.kind) && live.get(n.estimate_id) === "booked")));

  const supabase = await createSupabaseServerClient();
  const { data: { session } } = await supabase.auth.getSession();
  return {
    ok: true as const,
    userId: staff.userId,
    isManager: manager,
    canClaimUnassigned: staff.canClaimUnassigned,
    role: staff.role,
    realtimeToken: session?.access_token || null,
    followUps,
    unassigned: unassigned.data || [],
    notifications: visibleNotes as NotificationItem[],
  };
}

export async function markSeen(ids: string[]) {
  const staff = await getStaff();
  if (!staff || !ids.length) return { ok: false as const };
  // Only the viewer's own rows; Needs carrier never clears on view (server clears it).
  await createSupabaseAdminClient().from("crm_notifications").update({ dismissed_at: new Date().toISOString() })
    .in("id", ids.slice(0, 500)).eq("user_id", staff.userId).neq("kind", "needs_carrier").is("dismissed_at", null);
  return { ok: true as const };
}

/**
 * "Recurring" tab: quote views (job-number link) and email opens (tracking pixel).
 * Admins/supervisors see every rep's activity; reps see their own leads.
 */
export async function getRecurring(range: RangeKey, tz = 0) {
  const staff = await getStaff();
  if (!staff || !RANGES.includes(range)) return { ok: false as const, rows: [] };
  const admin = createSupabaseAdminClient();
  // Range is computed in the viewer's time zone (tz = minutes from getTimezoneOffset()).
  const shifted = new Date(Date.now() - tz * 60000);
  const [s, e] = rangeBounds(range, new Date(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
  const toUtc = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) + tz * 60000).toISOString();
  const evq = (cols: string) => admin.from("crm_email_events").select(cols)
    .in("event", ["viewed", "opened"]).gte("created_at", toUtc(s)).lt("created_at", toUtc(e)).order("created_at", { ascending: false }).limit(500);
  // 'detail' marks tracked-link clicks; fall back if that column isn't there yet.
  const first = await evq("id, email_id, estimate_id, event, created_at, ip, detail");
  const { data: events } = (first.error ? await evq("id, email_id, estimate_id, event, created_at, ip") : first) as unknown as { data: EmailEventHit[] | null };
  const tableRes = await admin.from("customer_email_view_events")
    .select("id, email_id, estimate_id, event_type, created_at, user_agent")
    .gte("created_at", toUtc(s)).lt("created_at", toUtc(e)).order("created_at", { ascending: false }).limit(500);
  const merged = mergeCustomerViews(events || [], tableHits(tableRes.error ? [] : tableRes.data));
  if (!merged.length) return { ok: true as const, rows: [], priorities: [] };
  const estIds = [...new Set(merged.map(x => x.estimate_id))];
  const [{ data: ests }, { data: emails }, { data: vehicles }, { data: reps }, priorities] = await Promise.all([
    admin.from("estimates").select("id, owner_id, job_number, customer_name, status, priority, follow_up_at, primary_date, pickup_address, delivery_address, assigned_rep_id").in("id", estIds),
    admin.from("crm_emails").select("id, kind, subject, estimate_id").in("estimate_id", estIds),
    admin.from("vehicles").select("estimate_id, year, make, model").in("estimate_id", estIds),
    admin.from("crm_reps").select("id, name"),
    loadPriorityLabels(),
  ]);
  const estMap = new Map((ests || []).map(x => [x.id, x]));
  const emailMap = new Map((emails || []).map(x => [x.id, x]));
  const repName = new Map((reps || []).map(r => [r.id, r.name]));
  const flags = await signedFlags(estIds);
  const manager = isManager(staff);
  const rows = merged.flatMap(ev => {
    const est = estMap.get(ev.estimate_id);
    const em = emailMap.get(ev.email_id);
    if (!est || est.status === "cancelled" || (!manager && est.owner_id !== staff.userId)) return [];
    const v = (vehicles || []).filter(x => x.estimate_id === est.id).map(x => [x.year, x.make, x.model].filter(Boolean).join(" ")).join(", ");
    const lab = mergedLabel(em?.kind, ev);
    return [{
      id: ev.id, estimate_id: est.id, job_number: est.job_number, rep: repName.get(est.assigned_rep_id) || "",
      status: est.status, priority: est.priority, priority_text: formatPriority(priorities, est.priority, "chip"), occurred_at: ev.created_at, follow_up_at: est.follow_up_at,
      pickup_date: est.primary_date, customer: est.customer_name, origin: est.pickup_address, destination: est.delivery_address,
      vehicle: v, esign: !!flags[est.id]?.quoteSigned || !!flags[est.id]?.ccSigned,
      equote: (emails || []).some(x => x.estimate_id === est.id && x.kind === "e_quote"),
      email_kind: em?.kind || "", email_subject: em?.subject || "",
      activity: lab.automatic ? "Email Viewed (may be automatic)" : lab.label,
      method: lab.method, ip: ev.ip, suggestChat: lab.label === "Quote Viewed",
    }];
  });
  return { ok: true as const, rows, priorities };
}
