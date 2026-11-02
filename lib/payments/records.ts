import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayChicago } from "@/lib/calendar";
import {
  bothEsignsComplete,
  centsToDecimal,
  classifyCustomerMatches,
  displayBrand,
  formatExpiration,
  isSchemaMiss,
  isUuid,
  normalizeEmail,
  normalizeName,
  phoneDigits,
  type CardSnapshot,
  type CustomerIdentity,
} from "./decide";

type Admin = SupabaseClient;

export async function paymentsSchemaReady(admin: Admin): Promise<boolean> {
  const [estimates, customers] = await Promise.all([
    admin.from("estimates").select("auto_charge_enabled").limit(1),
    admin.from("customers").select("id").limit(1),
  ]);
  return !estimates.error && !customers.error;
}

export async function readEsignFlags(admin: Admin, estimateId: string): Promise<{ contractSigned: boolean; ccFormSigned: boolean; both: boolean }> {
  const [{ data: emails }, { data: events }] = await Promise.all([
    admin.from("crm_emails").select("id, kind").eq("estimate_id", estimateId).in("kind", ["booked_esign", "cc_form"]),
    admin.from("crm_email_events").select("email_id").eq("estimate_id", estimateId).eq("event", "signed"),
  ]);
  const signed = new Set((events || []).map((event) => event.email_id));
  const contractSigned = (emails || []).some((email) => email.kind === "booked_esign" && signed.has(email.id));
  const ccFormSigned = (emails || []).some((email) => email.kind === "cc_form" && signed.has(email.id));
  return { contractSigned, ccFormSigned, both: bothEsignsComplete({ contractSigned, ccFormSigned }) };
}

type EstimateCustomer = {
  id: string;
  job_number: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_id?: string | null;
  auto_charge_enabled?: boolean | null;
  lead_source?: string | null;
};

export async function loadEstimate(admin: Admin, estimateId: string): Promise<EstimateCustomer | null> {
  const full = await admin.from("estimates").select("id, job_number, customer_name, customer_email, customer_phone, customer_id, auto_charge_enabled, lead_source").eq("id", estimateId).maybeSingle();
  if (!full.error) return full.data;
  if (!isSchemaMiss(full.error)) return null;
  const basic = await admin.from("estimates").select("id, job_number, customer_name, customer_email, customer_phone, lead_source").eq("id", estimateId).maybeSingle();
  return basic.data;
}

export function identityOf(estimate: { customer_name?: string | null; customer_email?: string | null; customer_phone?: string | null }): CustomerIdentity {
  return { displayName: estimate.customer_name || "", email: estimate.customer_email || null, phone: estimate.customer_phone || null };
}

export async function ensureCustomer(admin: Admin, estimate: EstimateCustomer): Promise<{ ok: true; id: string; stripeCustomerId: string | null } | { ok: false; error: string }> {
  if (estimate.customer_id && isUuid(estimate.customer_id)) {
    const { data, error } = await admin.from("customers").select("id, stripe_customer_id").eq("id", estimate.customer_id).maybeSingle();
    if (error) return { ok: false, error: isSchemaMiss(error) ? "The payments database update is not applied yet. Nothing was charged." : "The customer record could not be read. Nothing was charged." };
    if (data) return { ok: true, id: data.id, stripeCustomerId: data.stripe_customer_id };
  }
  const identity = identityOf(estimate);
  const row = {
    display_name: identity.displayName,
    email: identity.email,
    phone: identity.phone,
    name_normalized: normalizeName(identity.displayName),
    email_normalized: normalizeEmail(identity.email),
    phone_digits: phoneDigits(identity.phone),
  };
  const { data, error } = await admin.from("customers").insert(row).select("id, stripe_customer_id").single();
  if (error || !data) return { ok: false, error: isSchemaMiss(error) ? "The payments database update is not applied yet. Nothing was charged." : "The customer record could not be saved. Nothing was charged." };
  await admin.from("estimates").update({ customer_id: data.id }).eq("id", estimate.id);
  return { ok: true, id: data.id, stripeCustomerId: data.stripe_customer_id };
}

export async function rememberStripeCustomer(admin: Admin, customerId: string, stripeCustomerId: string) {
  await admin.from("customers").update({ stripe_customer_id: stripeCustomerId, updated_at: new Date().toISOString() }).eq("id", customerId);
}

export async function saveStripeCard(admin: Admin, input: {
  customerId: string;
  stripeCustomerId: string | null;
  stripePaymentMethodId: string;
  card: CardSnapshot | null;
  originalJobNumber: string | null;
  originalEstimateId: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const last4 = input.card?.last4 && /^\d{4}$/.test(input.card.last4) ? input.card.last4 : null;
  const row = {
    customer_id: input.customerId,
    stripe_customer_id: input.stripeCustomerId,
    stripe_payment_method_id: input.stripePaymentMethodId,
    brand: input.card?.brand || null,
    last4,
    exp_month: input.card?.expMonth || null,
    exp_year: input.card?.expYear || null,
    original_job_number: input.originalJobNumber,
    original_estimate_id: input.originalEstimateId,
  };
  const { data: existing } = await admin.from("customer_payment_methods").select("id").eq("customer_id", input.customerId).eq("stripe_payment_method_id", input.stripePaymentMethodId).maybeSingle();
  if (existing) return { ok: true, id: existing.id };
  const { data, error } = await admin.from("customer_payment_methods").insert(row).select("id").single();
  if (error || !data) return { ok: false, error: "The card was not saved in the CRM. If Stripe saved it, it was not charged from here." };
  return { ok: true, id: data.id };
}

export function cardColumns(card: CardSnapshot | null) {
  return {
    card_type: card?.brand ? displayBrand(card.brand) : null,
    card_last4: card?.last4 || null,
    card_exp: card?.expMonth && card.expYear ? formatExpiration(card.expMonth, card.expYear).replace(/\/(\d{4})$/, (_, year: string) => `/${year.slice(2)}`) : null,
  };
}

export async function insertPayment(admin: Admin, row: Record<string, unknown>): Promise<{ ok: true; id: string } | { ok: false; error: string; duplicate: boolean }> {
  const { data, error } = await admin.from("payments").insert(row).select("id").single();
  if (!error && data) return { ok: true, id: data.id };
  if (error?.code === "23505") return { ok: false, error: "This payment is already recorded. It was not charged again.", duplicate: true };
  return { ok: false, error: isSchemaMiss(error) ? "The payments database update is not applied yet. Nothing was charged." : "The payment could not be saved. Nothing was marked paid.", duplicate: false };
}

export function paidRowBase(input: {
  estimateId: string;
  customerId: string | null;
  staffId: string | null;
  staffName: string | null;
  amountCents: number;
  method: string;
  isDeposit: boolean;
  chargeStatus: string;
  autoCharge: boolean;
  idempotencyKey: string | null;
  remark: string | null;
  confirmationNo: string | null;
  card: CardSnapshot | null;
}) {
  return {
    estimate_id: input.estimateId,
    customer_id: input.customerId,
    created_by: input.staffId,
    created_by_name: input.staffName,
    payment_date: todayChicago(),
    method: input.method,
    is_deposit: input.isDeposit,
    amount: centsToDecimal(input.amountCents),
    confirmation_no: input.confirmationNo,
    remark: input.remark,
    ...cardColumns(input.card),
    provider: input.chargeStatus === "logged_manual" || input.chargeStatus === "bookkeeping_adjustment" || input.chargeStatus === "recorded" ? "manual" : "stripe",
    charge_status: input.chargeStatus,
    auto_charge: input.autoCharge,
    idempotency_key: input.idempotencyKey,
  };
}

export async function findByIdempotency(admin: Admin, key: string) {
  const { data, error } = await admin.from("payments").select("id, estimate_id, charge_status, stripe_payment_intent_id, stripe_setup_intent_id, stripe_payment_method_id, customer_id, amount, idempotency_key").eq("idempotency_key", key).maybeSingle();
  if (error) return null;
  return data;
}

export async function listSavedCards(admin: Admin, customerId: string) {
  const { data, error } = await admin.from("customer_payment_methods").select("id, brand, last4, exp_month, exp_year, original_job_number, stripe_payment_method_id, created_at").eq("customer_id", customerId).order("created_at", { ascending: false });
  if (error) return [];
  return (data || []).map((card) => ({
    id: card.id as string,
    brand: displayBrand(card.brand),
    last4: card.last4 as string | null,
    exp: formatExpiration(card.exp_month, card.exp_year),
    originalJobNumber: (card.original_job_number as string | null) || null,
    savedAt: (card.created_at as string | null) || null,
  }));
}

export async function matchCustomersForLead(admin: Admin, estimate: EstimateCustomer) {
  const identity = identityOf(estimate);
  if (estimate.customer_id && isUuid(estimate.customer_id)) {
    const { data } = await admin.from("customers").select("id, display_name, email, phone").eq("id", estimate.customer_id).maybeSingle();
    if (data) return { kind: "one" as const, matches: [{ id: data.id as string, displayName: data.display_name || "", email: data.email as string | null, phone: data.phone as string | null }] };
  }
  const name = normalizeName(identity.displayName);
  const email = normalizeEmail(identity.email);
  const phone = phoneDigits(identity.phone);
  const rows: Array<CustomerIdentity & { id: string }> = [];
  if (name) {
    const { data } = await admin.from("customers").select("id, display_name, email, phone").eq("name_normalized", name).limit(20);
    for (const row of data || []) rows.push({ id: row.id, displayName: row.display_name || "", email: row.email, phone: row.phone });
  }
  if (email) {
    const { data } = await admin.from("customers").select("id, display_name, email, phone").eq("email_normalized", email).limit(20);
    for (const row of data || []) if (!rows.some((item) => item.id === row.id)) rows.push({ id: row.id, displayName: row.display_name || "", email: row.email, phone: row.phone });
  }
  if (phone.length >= 10) {
    const { data } = await admin.from("customers").select("id, display_name, email, phone").eq("phone_digits", phone).limit(20);
    for (const row of data || []) if (!rows.some((item) => item.id === row.id)) rows.push({ id: row.id, displayName: row.display_name || "", email: row.email, phone: row.phone });
  }
  const classified = classifyCustomerMatches(identity, rows);
  if (estimate.customer_id && !classified.matches.some((match) => match.id === estimate.customer_id)) {
    const { data } = await admin.from("customers").select("id, display_name, email, phone").eq("id", estimate.customer_id).maybeSingle();
    if (data) classified.matches.unshift({ id: data.id, displayName: data.display_name || "", email: data.email, phone: data.phone });
    if (classified.matches.length === 1) classified.kind = "one";
    else if (classified.matches.length > 1) classified.kind = "many";
  }
  return classified;
}

const LEAD_PAYMENT_COLUMNS = "id, created_at, created_by_name, payment_date, method, is_deposit, amount, confirmation_no, remark, cardholder_name, card_type, card_type_source, card_last4, card_exp, voided_at, voided_by";

/** Lead page payment list. Falls back when the new charge_status column is not applied yet. */
export async function listLeadPayments(admin: Admin, estimateId: string) {
  const full = await admin.from("payments").select(`${LEAD_PAYMENT_COLUMNS}, charge_status`).eq("estimate_id", estimateId).order("created_at", { ascending: false });
  if (!full.error) return withVehicleIndex(admin, estimateId, full.data || []);
  if (!isSchemaMiss(full.error)) return [];
  const basic = await admin.from("payments").select(LEAD_PAYMENT_COLUMNS).eq("estimate_id", estimateId).order("created_at", { ascending: false });
  return (basic.data || []).map((row) => ({ ...row, charge_status: null as string | null }));
}

/** payments.vehicle_index (migration 20261031190000), merged in when the column exists. Null = whole job. */
export async function withVehicleIndex<T extends { id: string }>(admin: Admin, estimateId: string, rows: T[]): Promise<(T & { vehicle_index: number | null })[]> {
  const idx = await admin.from("payments").select("id, vehicle_index").eq("estimate_id", estimateId);
  const map = new Map<string, number | null>(idx.error ? [] : (idx.data || []).map((r: { id: string; vehicle_index: number | null }) => [r.id, r.vehicle_index ?? null]));
  return rows.map(r => ({ ...r, vehicle_index: map.get(r.id) ?? null }));
}

/** Best effort: tag a payment with its vehicle. Ignored until the column exists. */
export async function setPaymentVehicle(admin: Admin, paymentId: string, vehicleIndex: number | null) {
  if (vehicleIndex === null || !Number.isInteger(vehicleIndex) || vehicleIndex < 0 || vehicleIndex > 99) return;
  await admin.from("payments").update({ vehicle_index: vehicleIndex }).eq("id", paymentId).then(() => null, () => null);
}

/** "vehicle_index" form field -> 0..99 or null (whole job). */
export function vehicleIndexFrom(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,2}$/.test(raw)) return null;
  return Number(raw);
}
