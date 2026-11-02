"use server";

// Data for the menu pages: Follow-Up Menu, Estimates in Process, Recurring Customers,
// Operations Calendar and Salesmen Performance. Admins/supervisors see every rep (with a rep
// filter); a rep sees only their own leads. Dates are America/Chicago calendar dates.
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getStaff, isManager, type Staff } from "@/lib/crm-server";
import { signedFlags } from "@/app/actions/leads";
import { cityState } from "@/lib/crm-time";
import { chicagoYmd, presetRange, rangeInstants, RANGE_PRESETS, type RangePreset } from "@/lib/date-ranges";
import { isValidYmd, todayChicago } from "@/lib/calendar";
import { emailKindLabel } from "@/lib/crm-constants";
import { mergeCustomerViews, mergedLabel, tableHits, type EmailEventHit } from "@/lib/customer-email-views";
import { loadPriorityLabels } from "@/lib/priority-labels";
import type { PriorityLabel } from "@/lib/follow-up-domain";
import { sumCents } from "@/lib/money";
import { rowSorter } from "@/lib/job-sort";

type R<T> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." });
async function staffOrThrow(): Promise<Staff> {
  const s = await getStaff();
  if (!s) throw new Error("Your session expired. Please sign in again.");
  return s;
}

const EST_COLS = "id, job_number, lead_source, customer_name, customer_phone, customer_email, status, priority, follow_up_at, last_touched_at, primary_date, backup_date, created_at, booked_at, pickup_address, delivery_address, assigned_rep_id, owner_id, total_amount, miles, miles_source";
/** A lead is a follow-up lead only while open. BOOKED jobs are operations, not follow-ups. */
const OPEN_STATUSES = ["draft", "quoted", "signed"];

export type JobRow = {
  id: string; job_number: string | null; rep: string; rep_id: string | null; status: string; priority: number | null;
  follow_up_at: string | null; last_touched_at: string | null; primary_date: string | null; backup_date: string | null;
  created_at: string; booked_at: string | null; customer: string | null; phone: string | null; email: string | null;
  origin: string; destination: string; from_state: string; to_state: string; vehicles: string; total: number | null;
  contractSigned: boolean; ccSigned: boolean; quoteSent: boolean; quoteViewed: boolean; esignSentAt: string | null;
  miles: number | null; paid: number; lead_source: string;
  /** Operations calendar only (opsCalendarColor). */
  ops?: { carrier_assigned_at: string | null; picked_up_at: string | null; delivered_at: string | null; deleted_at: null };
};

/** Ops stamps for the calendar colors. Tolerates columns that are not migrated yet (picked_up_at first). */
async function opsFlags(ids: string[]): Promise<Map<string, Record<string, string | null>>> {
  const out = new Map<string, Record<string, string | null>>();
  if (!ids.length) return out;
  const admin = createSupabaseAdminClient();
  for (const cols of ["id, carrier_assigned_at, picked_up_at, delivered_at", "id, carrier_assigned_at, delivered_at", "id, carrier_assigned_at"]) {
    const { data, error } = await admin.from("estimates").select(cols).in("id", ids);
    if (error) continue;
    for (const r of (data || []) as unknown as Record<string, string | null>[]) out.set(String(r.id), r);
    break;
  }
  return out;
}

type Est = Record<string, unknown> & { id: string };
const stateOf = (addr: unknown) => /,\s*([A-Za-z]{2})\b[^,]*$/.exec(String(addr || ""))?.[1]?.toUpperCase() || "";

async function buildRows(ests: Est[]): Promise<JobRow[]> {
  if (!ests.length) return [];
  const admin = createSupabaseAdminClient();
  const ids = ests.map(e => e.id);
  const [{ data: reps }, { data: veh }, { data: emails }, { data: views }, { data: quotes }, { data: pays }, flags] = await Promise.all([
    admin.from("crm_reps").select("id, name"),
    admin.from("vehicles").select("estimate_id, year, make, model, created_at").in("estimate_id", ids).order("created_at"),
    admin.from("crm_emails").select("estimate_id, kind, created_at").in("estimate_id", ids),
    admin.from("crm_email_events").select("estimate_id").eq("event", "viewed").in("estimate_id", ids),
    admin.from("quotes").select("estimate_id, total_amount").in("estimate_id", ids),
    admin.from("payments").select("estimate_id, amount, voided_at").in("estimate_id", ids),
    signedFlags(ids),
  ]);
  const repName = new Map((reps || []).map(r => [r.id, r.name]));
  const viewed = new Set((views || []).map(v => v.estimate_id));
  const total = new Map((quotes || []).map(q => [q.estimate_id, Number(q.total_amount)]));
  return ests.map(e => {
    const vs = (veh || []).filter(v => v.estimate_id === e.id);
    const first = vs[0] ? [vs[0].year, vs[0].make, vs[0].model].filter(Boolean).join(" ") : "";
    const em = (emails || []).filter(m => m.estimate_id === e.id);
    const esign = em.filter(m => m.kind === "booked_esign" || m.kind === "cc_form").map(m => m.created_at).sort();
    return {
      id: e.id, job_number: (e.job_number as string) ?? null, rep: repName.get(e.assigned_rep_id as string) || "", rep_id: (e.assigned_rep_id as string) ?? null,
      status: String(e.status), priority: (e.priority as number | null) ?? null,
      follow_up_at: (e.follow_up_at as string) ?? null, last_touched_at: (e.last_touched_at as string) ?? null,
      primary_date: (e.primary_date as string) ?? null, backup_date: (e.backup_date as string) ?? null,
      created_at: String(e.created_at), booked_at: (e.booked_at as string) ?? null,
      customer: (e.customer_name as string) ?? null, phone: (e.customer_phone as string) ?? null, email: (e.customer_email as string) ?? null,
      origin: cityState(e.pickup_address as string), destination: cityState(e.delivery_address as string),
      from_state: stateOf(e.pickup_address), to_state: stateOf(e.delivery_address),
      vehicles: vs.length > 1 ? `${first} +${vs.length - 1} more` : first,
      total: total.has(e.id) ? total.get(e.id)! : e.total_amount != null ? Number(e.total_amount) : null,
      contractSigned: !!flags[e.id]?.quoteSigned, ccSigned: !!flags[e.id]?.ccSigned,
      quoteSent: em.some(m => m.kind === "e_quote"), quoteViewed: viewed.has(e.id), esignSentAt: esign[0] || null,
      miles: (e.miles as number | null) ?? null,
      paid: sumCents((pays || []).filter(p => p.estimate_id === e.id && !p.voided_at).map(p => p.amount)) / 100,
      lead_source: String(e.lead_source || ""),
    };
  });
}

async function repsFor(staff: Staff) {
  if (!isManager(staff)) return [];
  const { data } = await createSupabaseAdminClient().from("crm_reps").select("id, name, user_id").eq("is_active", true).order("sort_order").order("name");
  return data || [];
}

/** The user's OWN open leads (owner, or assigned to their rep row). Shared by the Follow-Up Menu
 *  and its count on the main menu so the two never disagree. */
async function myOpenLeads(userId: string, cols: string, head = false) {
  const admin = createSupabaseAdminClient();
  let q = admin.from("estimates").select(cols, head ? { count: "exact", head: true } : undefined).is("deleted_at", null).in("status", OPEN_STATUSES);
  if (!head) q = q.limit(3000);
  const { data: mine } = await admin.from("crm_reps").select("id").eq("user_id", userId);
  const repIds = (mine || []).map(r => r.id);
  return repIds.length ? q.or(`owner_id.eq.${userId},assigned_rep_id.in.(${repIds.join(",")})`) : q.eq("owner_id", userId);
}

/** Main-menu "Follow-Up Menu (N)": the total number of jobs the Follow-Up Menu holds for this user. */
export async function followUpTotalCount(): Promise<number> {
  try {
    const staff = await staffOrThrow();
    const { count } = await myOpenLeads(staff.userId, "id", true);
    return count ?? 0;
  } catch { return 0; }
}

/** Follow-Up Menu: every OPEN lead (never booked / cancelled / deleted) for the circles and lists. */
export async function followUpMenuData(repId?: string): Promise<R<{ rows: JobRow[]; labels: PriorityLabel[]; reps: { id: string; name: string }[]; manager: boolean; today: string }>> {
  try {
    const staff = await staffOrThrow();
    const admin = createSupabaseAdminClient();
    // Lead separation (Owner): everyone, admins included, sees only their OWN leads here so
    // leads never get crossed. (repId is ignored; kept for the call signature.)
    void repId;
    const [{ data }, labels] = await Promise.all([await myOpenLeads(staff.userId, EST_COLS), loadPriorityLabels()]);
    return { ok: true, rows: await buildRows((data || []) as unknown as Est[]), labels, reps: [], manager: false, today: todayChicago() };
  } catch (e) { return fail(e); }
}

export type SearchParams = {
  dateFactor: "open" | "pickup" | "followUp" | "booked"; preset?: RangePreset | ""; from?: string; to?: string;
  fromState?: string; toState?: string; priority?: string; repId?: string; leadSource?: string;
  type: "all" | "followUp" | "esign" | "booked" | "cancelled"; sort: "job" | "pickup" | "total" | "followUp" | "priority";
};

/** Estimates in Process search. */
export async function searchEstimates(p: SearchParams): Promise<R<{ rows: JobRow[]; reps: { id: string; name: string }[]; manager: boolean; range: { from: string; to: string } | null; priorities: PriorityLabel[] }>> {
  try {
    const staff = await staffOrThrow();
    const admin = createSupabaseAdminClient();
    let q = admin.from("estimates").select(EST_COLS).is("deleted_at", null).neq("status", "unassigned").order("created_at", { ascending: false }).limit(3000);
    if (p.type === "booked") q = q.eq("status", "booked");
    else if (p.type === "cancelled") q = q.eq("status", "cancelled");
    else if (p.type === "followUp") q = q.in("status", OPEN_STATUSES);
    else q = q.neq("status", "cancelled");
    if (!isManager(staff)) q = q.eq("owner_id", staff.userId);
    else if (p.repId) q = q.eq("assigned_rep_id", p.repId);
    if (p.priority === "none") q = q.is("priority", null);
    else if (p.priority !== undefined && p.priority !== "" && p.priority !== "all") q = q.eq("priority", Number(p.priority));
    const [{ data }, priorities] = await Promise.all([q, loadPriorityLabels()]);
    let rows = await buildRows((data || []) as Est[]);
    const range = p.preset && RANGE_PRESETS.includes(p.preset) ? presetRange(p.preset)
      : p.from && p.to && isValidYmd(p.from) && isValidYmd(p.to) ? { from: p.from, to: p.to } : null;
    if (p.type === "esign") rows = rows.filter(r => r.esignSentAt);
    if (range) {
      const dateOf = (r: JobRow) => p.type === "esign" ? chicagoYmd(r.esignSentAt)
        : p.dateFactor === "pickup" ? r.primary_date || "" : p.dateFactor === "followUp" ? chicagoYmd(r.follow_up_at)
        : p.dateFactor === "booked" ? chicagoYmd(r.booked_at) : chicagoYmd(r.created_at);
      rows = rows.filter(r => { const d = dateOf(r); return !!d && d >= range.from && d <= range.to; });
    }
    if (p.fromState) rows = rows.filter(r => r.from_state === p.fromState!.toUpperCase());
    if (p.toState) rows = rows.filter(r => r.to_state === p.toState!.toUpperCase());
    if (p.leadSource) rows = rows.filter(r => r.lead_source.toLowerCase() === p.leadSource!.toLowerCase());
    rows.sort(rowSorter(p.sort));
    return { ok: true, rows: rows.slice(0, 1000), reps: await repsFor(staff), manager: isManager(staff), range, priorities };
  } catch (e) { return fail(e); }
}

/**
 * Recurring Customers: the customer RE-OPENED their quote link, i.e. a quote-view event
 * after that lead's first quote view. One row per lead: its latest re-open in the range.
 */
export async function recurringCustomers(preset: RangePreset): Promise<R<{ rows: (JobRow & { recurring_at: string; ip: string | null; subject: string; views: number })[]; range: { from: string; to: string } }>> {
  try {
    const staff = await staffOrThrow();
    if (!RANGE_PRESETS.includes(preset)) return { ok: false, error: "Pick a date range." };
    const range = presetRange(preset);
    const [start, end] = rangeInstants(range.from, range.to);
    const admin = createSupabaseAdminClient();
    const { data: inRange } = await admin.from("crm_email_events").select("estimate_id").eq("event", "viewed").gte("created_at", start).lt("created_at", end).limit(5000);
    const ids = [...new Set((inRange || []).map(x => x.estimate_id))];
    if (!ids.length) return { ok: true, rows: [], range };
    const { data: all } = await admin.from("crm_email_events").select("estimate_id, email_id, created_at, ip").eq("event", "viewed").in("estimate_id", ids).order("created_at");
    let q = admin.from("estimates").select(EST_COLS).in("id", ids).is("deleted_at", null).neq("status", "cancelled");
    if (!isManager(staff)) q = q.eq("owner_id", staff.userId);
    const { data: ests } = await q;
    const rows = await buildRows((ests || []) as Est[]);
    const { data: emails } = await admin.from("crm_emails").select("id, subject").in("estimate_id", ids);
    const subject = new Map((emails || []).map(m => [m.id, m.subject as string]));
    const out = rows.flatMap(r => {
      const evs = (all || []).filter(e => e.estimate_id === r.id);
      const repeats = evs.slice(1).filter(e => e.created_at >= start && e.created_at < end);
      const last = repeats[repeats.length - 1];
      return last ? [{ ...r, recurring_at: last.created_at, ip: last.ip ?? null, subject: subject.get(last.email_id) || "", views: evs.length }] : [];
    }).sort((a, b) => b.recurring_at.localeCompare(a.recurring_at));
    return { ok: true, rows: out, range };
  } catch (e) { return fail(e); }
}

export type ViewEventRow = {
  id: string; estimate_id: string; job_number: string | null; customer: string | null; rep: string; label: "Quote Viewed" | "Email Viewed";
  template: string; subject: string; at: string; method: "open" | "click"; views: number; ip: string | null; status: string;
  /** Pixel hit kept only by the new table. Shown as "may be automatic". */
  automatic: boolean;
  /** Quote viewed: the rep can send "Hi, let's chat!" themselves. */
  suggestChat: boolean;
};
/**
 * RECURRING (Owner, 2026-10-23): every counted open (pixel) / click (tracked link) of any email
 * the CRM sent, newest first. Quotes report "Quote Viewed", other emails "Email Viewed".
 * views = how many times that email was opened/clicked so far. Reps see their own leads.
 */
export async function viewEvents(preset: RangePreset): Promise<R<{ rows: ViewEventRow[]; range: { from: string; to: string } }>> {
  try {
    const staff = await staffOrThrow();
    if (!RANGE_PRESETS.includes(preset)) return { ok: false, error: "Pick a date range." };
    const range = presetRange(preset);
    const [start, end] = rangeInstants(range.from, range.to);
    const admin = createSupabaseAdminClient();
    const evq = (cols: string) => admin.from("crm_email_events").select(cols)
      .in("event", ["viewed", "opened"]).gte("created_at", start).lt("created_at", end).order("created_at", { ascending: false }).limit(1000);
    // 'detail' marks tracked-link clicks; fall back if that column isn't there yet.
    const first = await evq("id, email_id, estimate_id, event, created_at, ip, detail");
    const { data: evs } = (first.error ? await evq("id, email_id, estimate_id, event, created_at, ip") : first) as unknown as { data: EmailEventHit[] | null };
    const tableRes = await admin.from("customer_email_view_events")
      .select("id, email_id, estimate_id, event_type, created_at, user_agent")
      .gte("created_at", start).lt("created_at", end).order("created_at", { ascending: false }).limit(1000);
    const merged = mergeCustomerViews(evs || [], tableHits(tableRes.error ? [] : tableRes.data));
    if (!merged.length) return { ok: true, rows: [], range };
    const estIds = [...new Set(merged.map(e => e.estimate_id))];
    const emailIds = [...new Set(merged.map(e => e.email_id))];
    let eq = admin.from("estimates").select("id, job_number, customer_name, owner_id, assigned_rep_id, status").in("id", estIds).is("deleted_at", null).neq("status", "cancelled");
    if (!isManager(staff)) eq = eq.eq("owner_id", staff.userId);
    const [{ data: ests }, { data: emails }, { data: reps }, { data: allViews }, allTable] = await Promise.all([
      eq,
      admin.from("crm_emails").select("id, kind, subject").in("id", emailIds),
      admin.from("crm_reps").select("id, name"),
      admin.from("crm_email_events").select("email_id, created_at").in("email_id", emailIds).in("event", ["viewed", "opened"]),
      admin.from("customer_email_view_events").select("id, email_id, estimate_id, event_type, created_at").in("email_id", emailIds),
    ]);
    const counted = mergeCustomerViews(
      (allViews || []).map((v, i) => ({ id: `c-${i}`, email_id: v.email_id as string, estimate_id: "", event: "opened", created_at: v.created_at as string, ip: null, detail: null })),
      tableHits(allTable.error ? [] : allTable.data),
    );
    const est = new Map((ests || []).map(e => [e.id, e]));
    const em = new Map((emails || []).map(m => [m.id, m]));
    const repName = new Map((reps || []).map(r => [r.id, r.name as string]));
    const rows: ViewEventRow[] = merged.flatMap(ev => {
      const e = est.get(ev.estimate_id); const m = em.get(ev.email_id);
      if (!e || !m) return [];
      const lab = mergedLabel(m.kind, ev);
      const views = counted.filter(v => v.email_id === ev.email_id && v.created_at <= ev.created_at).length;
      return [{
        id: ev.id, estimate_id: e.id, job_number: e.job_number, customer: e.customer_name, rep: repName.get(e.assigned_rep_id) || "",
        label: lab.label, template: emailKindLabel(m.kind), subject: m.subject || "",
        at: ev.created_at, method: lab.method, views, ip: ev.ip ?? null, status: e.status,
        automatic: lab.automatic, suggestChat: lab.label === "Quote Viewed",
      }];
    });
    return { ok: true, rows, range };
  } catch (e) { return fail(e); }
}

/** Operations Calendar: jobs with a primary or 2nd pickup date in [from, to]. phase "booked" = booked only. */
export async function operationsJobs(from: string, to: string, phase: "booked" | "all", repId?: string): Promise<R<{ rows: JobRow[]; reps: { id: string; name: string }[]; manager: boolean }>> {
  try {
    const staff = await staffOrThrow();
    if (!isValidYmd(from) || !isValidYmd(to)) return { ok: false, error: "Bad date range." };
    const admin = createSupabaseAdminClient();
    let q = admin.from("estimates").select(EST_COLS).is("deleted_at", null)
      .or(`and(primary_date.gte.${from},primary_date.lte.${to}),and(backup_date.gte.${from},backup_date.lte.${to})`).limit(3000);
    q = phase === "booked" ? q.eq("status", "booked") : q.in("status", [...OPEN_STATUSES, "booked"]);
    if (!isManager(staff)) q = q.eq("owner_id", staff.userId);
    else if (repId) q = q.eq("assigned_rep_id", repId);
    const { data } = await q;
    const rows = await buildRows((data || []) as Est[]);
    const flags = await opsFlags(rows.map(r => r.id));
    for (const r of rows) {
      const f = flags.get(r.id) || {};
      r.ops = { carrier_assigned_at: f.carrier_assigned_at ?? null, picked_up_at: f.picked_up_at ?? null, delivered_at: f.delivered_at ?? null, deleted_at: null };
    }
    return { ok: true, rows, reps: await repsFor(staff), manager: isManager(staff) };
  } catch (e) { return fail(e); }
}

/** Salesmen Performance: per rep, leads created, quotes sent, booked jobs and booked total.
 *  Admins/supervisors see every rep; a salesperson sees only their own row (Reports). */
export async function salesPerformance(from: string, to: string): Promise<R<{ rows: { rep: string; leads: number; quotes: number; booked: number; bookedTotal: number; depositTotal: number }[]; sources: { source: string; leads: number; booked: number }[] }>> {
  try {
    const staff = await staffOrThrow();
    const manager = isManager(staff);
    if (!isValidYmd(from) || !isValidYmd(to)) return { ok: false, error: "Pick a date range." };
    const [start, end] = rangeInstants(from, to);
    const admin = createSupabaseAdminClient();
    const [{ data: reps }, { data: created }, { data: booked }, { data: quotes }, { data: deposits }] = await Promise.all([
      admin.from("crm_reps").select("id, name").eq("is_active", true).order("sort_order").order("name"),
      admin.from("estimates").select("assigned_rep_id, owner_id, lead_source").is("deleted_at", null).gte("created_at", start).lt("created_at", end),
      admin.from("estimates").select("id, assigned_rep_id, owner_id, lead_source, total_amount, chargeback_status, chargeback_amount").is("deleted_at", null).eq("status", "booked").gte("booked_at", start).lt("booked_at", end),
      admin.from("crm_emails").select("estimate_id").eq("kind", "e_quote").gte("created_at", start).lt("created_at", end),
      admin.from("payments").select("estimate_id, amount, is_deposit, voided_at, created_at").eq("is_deposit", true).is("voided_at", null).gte("created_at", start).lt("created_at", end),
    ]);
    const qIds = [...new Set((quotes || []).map(q => q.estimate_id))];
    const { data: qEst } = qIds.length ? await admin.from("estimates").select("id, assigned_rep_id, owner_id").in("id", qIds) : { data: [] as { id: string; assigned_rep_id: string | null; owner_id: string | null }[] };
    const bIds = (booked || []).map(b => b.id);
    const { data: bq } = bIds.length ? await admin.from("quotes").select("estimate_id, total_amount").in("estimate_id", bIds) : { data: [] as { estimate_id: string; total_amount: number }[] };
    const bTotal = new Map((bq || []).map(q => [q.estimate_id, Number(q.total_amount)]));
    const quoteEst = new Map((qEst || []).map(e => [e.id, e]));
    type Mine = { assigned_rep_id: string | null; owner_id: string | null };
    const groups: { name: string; mine: (x: Mine) => boolean }[] = manager
      ? (reps || []).map(r => ({ name: r.name, mine: (x: Mine) => x.assigned_rep_id === r.id }))
      : [{ name: staff.name, mine: (x: Mine) => x.owner_id === staff.userId }];
    // Deposit total: sum of is_deposit payments in the range, attributed to the job's rep.
    // Refunds (negative amounts) and lost chargebacks deduct from the deposit.
    const depEstIds = [...new Set((deposits || []).map(d => d.estimate_id))];
    const { data: depEst } = depEstIds.length ? await admin.from("estimates").select("id, assigned_rep_id, owner_id, chargeback_status, chargeback_amount").in("id", depEstIds) : { data: [] as { id: string; assigned_rep_id: string | null; owner_id: string | null; chargeback_status: string | null; chargeback_amount: number | null }[] };
    const depEstMap = new Map((depEst || []).map(e => [e.id, e]));
    const rows = groups.map(g => {
      const b = (booked || []).filter(g.mine);
      const deps = (deposits || []).filter(d => {
        const e = depEstMap.get(d.estimate_id);
        return !!e && g.mine(e);
      });
      const depositSum = deps.reduce((t, d) => t + Number(d.amount || 0), 0);
      // Deduct lost chargebacks on jobs this rep booked in the range.
      const lostCb = b.filter(x => (x as { chargeback_status?: string | null }).chargeback_status === "lost")
        .reduce((t, x) => t + Number((x as { chargeback_amount?: number | null }).chargeback_amount || 0), 0);
      return {
        rep: g.name,
        leads: (created || []).filter(g.mine).length,
        quotes: (quotes || []).filter(q => { const e = quoteEst.get(q.estimate_id); return !!e && g.mine(e); }).length,
        booked: b.length,
        bookedTotal: sumCents(b.map(x => bTotal.get(x.id) ?? x.total_amount ?? 0)) / 100,
        depositTotal: Math.round((depositSum - lostCb) * 100) / 100,
      };
    });
    // Count by Lead Source (rep-side only): leads created and jobs booked in the range.
    const scope = (x: Mine) => manager || x.owner_id === staff.userId;
    const srcOf = (x: { lead_source?: string | null }) => (x.lead_source || "").trim() || "(none)";
    const names = [...new Set([...(created || []).filter(scope).map(srcOf), ...(booked || []).filter(scope).map(srcOf)])];
    const sources = names.map(source => ({
      source,
      leads: (created || []).filter(x => scope(x) && srcOf(x) === source).length,
      booked: (booked || []).filter(x => scope(x) && srcOf(x) === source).length,
    })).sort((a, b) => b.leads - a.leads || b.booked - a.booked || a.source.localeCompare(b.source));
    return { ok: true, rows, sources };
  } catch (e) { return fail(e); }
}
