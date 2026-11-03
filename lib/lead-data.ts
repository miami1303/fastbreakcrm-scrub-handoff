import "server-only";
import { splitSharedNotes } from "@/lib/note-kinds";
import { sanitizeRichHtml } from "@/lib/templates/sanitize";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { sumCents } from "@/lib/money";
import { customerShowsPayments } from "@/lib/vehicle-pricing";
import { countsAsPaid, isSchemaMiss } from "@/lib/payments/decide";
import { pendingPayments } from "@/lib/payments/pending";
import { getCompanyInfo } from "@/lib/company-settings";
import type { CompanyInfo } from "@/lib/templates/company";
import type { QuoteEstimate, QuoteInput, QuotePayment, QuoteRep, QuoteVehicle } from "@/lib/quote-template";

export type LeadEstimate = QuoteEstimate & {
  id: string;
  owner_id: string | null;
  assigned_rep_id: string | null;
  status: string;
  priority: number | null;
  follow_up_at: string | null;
  last_touched_at: string | null;
  booked_at: string | null;
  lead_source: string | null;
  extra_stop_notes: string | null;
  customer_remarks: string | null;
  operation_details: string | null;
  miles: number | null;
  miles_source: "osrm" | "estimate" | "manual" | null;
  miles_zips: string | null;
  extra_stop_html: string | null;
  shipment_remarks: string | null;
  deleted_at: string | null;
  deposit_amount: number | null;
  cod_amount: number | null;
  total_amount: number | null;
};
export type LeadVehicle = QuoteVehicle & { id: string };
export type LeadQuote = QuotePayment & { id: string; cod_amount: number | null; signed_at: string | null; booked_at: string | null };
export type LeadRep = QuoteRep & { id: string; user_id: string | null; is_active: boolean; in_rotation: boolean };

export type LeadBundle = {
  est: LeadEstimate;
  vehicles: LeadVehicle[];
  quote: LeadQuote | null;
  rep: LeadRep | null;
  /** Sum of payments that count as paid (negative corrections included), in dollars. */
  paidAmount: number;
  /** At least one payment that counts as paid exists. */
  hasPayment: boolean;
  /** Counted payments with the vehicle they are for (null = whole job). Customer Payment per vehicle. */
  paidRows: { amount: number | string | null; vehicle_index: number | null }[];
  /** Put in but not charged yet (lib/payments/pending.ts). 0 when nothing is pending. */
  pendingAmount: number;
  pendingLabel: string | null;
  /** Company contact info (Admin > Company Settings), read fresh for every render. */
  company: CompanyInfo;
  /** "Add Notes to Company Policy" entries for this lead (oldest first), added to its Terms & Conditions. */
  policyNotes: string[];
  /** Carrier Info notes (kind 'carrier'), NEWEST first. Cancels + reassigns stack up; the newest is current. */
  carrierNotes: { body: string; created_at: string }[];
  /** Newest Customer's Remarks note (prints as the short "Remarks" under Vehicles), or null. */
  latestCustomerRemark: string | null;
};

export async function loadLeadBundle(estimateId: string): Promise<LeadBundle | null> {
  const admin = createSupabaseAdminClient();
  const { data: est } = await admin.from("estimates").select("*").eq("id", estimateId).maybeSingle();
  if (!est || est.deleted_at) return null;
  const [{ data: vehicles }, { data: quote }, { data: pays }, company, { data: policy }, { data: shared }] = await Promise.all([
    admin.from("vehicles").select("*").eq("estimate_id", estimateId).order("created_at"),
    admin.from("quotes").select("*").eq("estimate_id", estimateId).maybeSingle(),
    paymentAmounts(admin, estimateId).then(data => ({ data })),
    getCompanyInfo(),
    admin.from("estimate_notes").select("body").eq("estimate_id", estimateId).eq("kind", "policy").order("created_at"),
    admin.from("estimate_notes").select("body, kind, created_at").eq("estimate_id", estimateId).in("kind", ["carrier", "customer"]).order("created_at", { ascending: false }),
  ]);
  let rep: LeadRep | null = null;
  if (est.assigned_rep_id) {
    const { data } = await admin.from("crm_reps").select("id, name, email, phone, title, user_id, is_active, in_rotation").eq("id", est.assigned_rep_id).maybeSingle();
    rep = data;
  } else if (est.owner_id) {
    const { data } = await admin.from("crm_reps").select("id, name, email, phone, title, user_id, is_active, in_rotation").eq("user_id", est.owner_id).maybeSingle();
    rep = data;
  }
  // Customer Payment = non-void payments that count as paid. A Stripe row that is still
  // processing, failed, or waiting does not count. Older rows have no status and still count.
  const live = (pays || []).filter(p => !p.voided_at && countsAsPaid(p.charge_status));
  const paidCents = sumCents(live.map(p => p.amount));
  const paidRows = live.map(p => ({ amount: p.amount as number | string | null, vehicle_index: (p as { vehicle_index?: number | null }).vehicle_index ?? null }));
  // Pending (Owner 2026-10-31, FB400012): a card on file with the deposit not charged yet, or a row
  // still waiting on Stripe, shows on the customer document as pending. Never counted as paid.
  let cards: { brand: string | null; last4: string | null }[] = [];
  if (est.customer_id) {
    const { data } = await admin.from("customer_payment_methods").select("brand, last4").eq("customer_id", est.customer_id).order("created_at", { ascending: false }).limit(1);
    cards = data || [];
  }
  const depositPaidC = sumCents(live.filter(p => p.is_deposit).map(p => p.amount));
  const pend = pendingPayments({ payments: pays || [], cards, depositDue: quote?.deposit_amount ?? est.deposit_amount, depositPaidC, totalAmount: quote?.total_amount ?? est.total_amount, customerPaidC: paidCents });
  const card = cards[0];
  const pendingLabel = pend.pendingC > 0 && pend.lines.some(l => l.source === "card") && card?.last4 ? `${card.brand ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) + " " : ""}••••${card.last4}` : null;
  return { est, vehicles: vehicles || [], quote: quote || null, rep, paidAmount: paidCents / 100, hasPayment: live.length > 0, paidRows, pendingAmount: pend.pendingC / 100, pendingLabel, company, policyNotes: (policy || []).map(p => p.body),
    ...splitSharedNotes(shared || []) };
}

async function paymentAmounts(admin: ReturnType<typeof createSupabaseAdminClient>, estimateId: string) {
  const withVehicle = await admin.from("payments").select("amount, is_deposit, voided_at, charge_status, vehicle_index").eq("estimate_id", estimateId);
  if (!withVehicle.error) return withVehicle.data || [];
  const full = await admin.from("payments").select("amount, is_deposit, voided_at, charge_status").eq("estimate_id", estimateId);
  if (!full.error) return (full.data || []).map(row => ({ ...row, vehicle_index: null as number | null }));
  if (!isSchemaMiss(full.error)) return [];
  const basic = await admin.from("payments").select("amount, is_deposit, voided_at").eq("estimate_id", estimateId);
  return (basic.data || []).map(row => ({ ...row, charge_status: null as string | null, vehicle_index: null as number | null }));
}

export type DocMode = "e_quote" | "booked" | "cc";

export const modeFor = (kind: string): DocMode => (kind === "e_quote" ? "e_quote" : kind === "cc_form" ? "cc" : "booked");

/**
 * Customer Payment on a customer document.
 *   - Every customer document (E-Quote too, booked or not, Owner 2026-10-31): sum of all
 *     recorded payments (negative corrections included) -> Customer Payment, and
 *     Balance Due = Total - that sum.
 *     Before ANY payment is recorded: null too (Total only, never "$0.00" paid). The CRM
 *     preview and the customer page use this same rule, so they always match.
 */
export function customerPayment(b: Pick<LeadBundle, "paidAmount" | "hasPayment">, mode: DocMode): number | null {
  // Owner 2026-10-31: the customer sees Customer Payment only when the payments add up to
  // something (booked or not). A payment that nets to $0 (e.g. fully refunded) shows Total only.
  return customerShowsPayments(mode, b.hasPayment && Math.round(b.paidAmount * 100) !== 0) ? b.paidAmount : null;
}

/** Input for the customer documents (quote / booked order / CC form). */
export function docInput(b: LeadBundle, assetBaseUrl: string, mode: DocMode): QuoteInput {
  return {
    // Defense in depth: re-sanitize the rich notes at render time too.
    // Remarks under Vehicles = newest Customer's Remarks note (Owner 2026-10-31: the notes stack replaced the
    // single Remarks box); older leads with only shipment_remarks keep printing that.
    est: { ...b.est, extra_stop_html: b.est.extra_stop_html ? sanitizeRichHtml(b.est.extra_stop_html) || null : null,
      shipment_remarks: b.latestCustomerRemark || b.est.shipment_remarks },
    vehicles: b.vehicles,
    quote: b.quote,
    rep: b.rep ? { name: b.rep.name, email: b.rep.email, phone: b.rep.phone, title: b.rep.title ?? null } : null,
    paidAmount: customerPayment(b, mode),
    // Per-vehicle Customer Payment lines (only used when the job-level payment is shown).
    paidRows: customerPayment(b, mode) === null ? [] : b.paidRows,
    pendingAmount: b.pendingAmount || null,
    pendingLabel: b.pendingLabel,
    assetBaseUrl,
    company: b.company,
    policyNotes: b.policyNotes,
    // Carrier Info box: only once the job is booked. Newest first; emails trim to the newest one.
    carrierNotes: b.est.status === "booked" ? b.carrierNotes : [],
  };
}
