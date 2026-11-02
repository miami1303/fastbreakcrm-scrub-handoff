"use server";

import { getAccessibleEstimate, getStaff, isManager, publicOrigin } from "@/lib/crm-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { digitsOnly } from "@/lib/card-crypto";
import { toCents } from "@/lib/money";
import { mailMode, sendMail, sender } from "@/lib/mailer";
import { activeBlock, blockedMessage } from "@/lib/suppression";
import { createHash } from "node:crypto";
import { clickBase } from "@/lib/view-tracking";
import { newEmailToken } from "@/lib/customer-email-views";
import { docInput, loadLeadBundle } from "@/lib/lead-data";
import { formatMoney, repInfo } from "@/lib/quote-template";
import { renderTemplate } from "@/lib/templates/registry";
import { plainTextPart } from "@/lib/mail-parts";
import { paymentLinkSms, sendSms, smsMode, toE164 } from "@/lib/sms";
import { getCompanyInfo } from "@/lib/company-settings";
import { paymentMethodLines, zelleAddress } from "@/lib/payment-methods";
import {
  centsToDecimal,
  decidePayment,
  displayBrand,
  isOnlineBooking,
  isUuid,
  runWithStripeGuard,
  scrubSecrets,
  type CardSnapshot,
  type StripeReadiness,
} from "@/lib/payments/decide";
import {
  cancelCardPayment,
  chargeSavedCard,
  createCardPayment,
  createCardSetup,
  createCheckoutLink,
  createStripeCustomer,
  readStripeReadiness,
  readWebhookConfigured,
  refundCardPayment,
  retrieveCardPayment,
  retrieveSetup,
} from "@/lib/payments/stripe-gateway";
import {
  ensureCustomer,
  findByIdempotency,
  insertPayment,
  cardColumns,
  listSavedCards,
  loadEstimate,
  matchCustomersForLead,
  paidRowBase,
  setPaymentVehicle,
  vehicleIndexFrom,
  paymentsSchemaReady,
  readEsignFlags,
  rememberStripeCustomer,
  saveStripeCard,
} from "@/lib/payments/records";
import { attemptAutoChargeForEstimate } from "@/lib/payments/auto-charge";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
/** What the rep sees after Charge Now: amount, card last4 and the Stripe PaymentIntent id. */
export type ChargeReceipt = { amountCents: number; brand: string | null; last4: string | null; paymentIntentId: string | null };
type Fail = { ok: false; error: string; newKey?: boolean; receipt?: ChargeReceipt };
type EstimateRow = NonNullable<Awaited<ReturnType<typeof loadEstimate>>>;

const text = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max) || null;

function fail(error: unknown): Fail {
  const raw = error instanceof Error ? error.message : "Something went wrong.";
  const message = scrubSecrets(raw).slice(0, 300);
  console.error("[crm] stripe payment:", message);
  const suffix = /nothing was charged|not marked paid|nothing was created/i.test(message) ? "" : " Nothing was charged.";
  return { ok: false, error: message + suffix };
}

function publicStripe(stripe: StripeReadiness) {
  return {
    connected: stripe.connected,
    mode: stripe.mode,
    message: stripe.message,
    publishableKey: stripe.publishableKey,
  };
}

function checked(form: FormData, name: string) {
  const value = form.get(name);
  return value === "on" || value === "true";
}

async function paymentGate(estimateId: string) {
  const staff = await getStaff();
  if (!staff) return { ok: false as const, error: "Your session expired. Please sign in again." };
  if (!(await getAccessibleEstimate(staff, estimateId))) return { ok: false as const, error: "Estimate not found." };
  const admin = createSupabaseAdminClient();
  if (!(await paymentsSchemaReady(admin))) {
    return { ok: false as const, error: "The payments database update is not applied yet. Nothing was charged." };
  }
  const estimate = await loadEstimate(admin, estimateId);
  if (!estimate) return { ok: false as const, error: "Estimate not found." };
  return { ok: true as const, staff, admin, estimate, readiness: readStripeReadiness(), esign: await readEsignFlags(admin, estimateId) };
}

type SavedCard = {
  id: string;
  customer_id: string;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
};

function snapshotOf(card: { brand: string | null; last4: string | null; exp_month: number | null; exp_year: number | null } | null): CardSnapshot | null {
  if (!card?.last4) return null;
  return { brand: card.brand, last4: card.last4, expMonth: card.exp_month, expYear: card.exp_year };
}

/** What the Payments tab needs besides the ledger. No secret key is returned. */
export async function loadPaymentExtras(estimateId: string) {
  try {
    const staff = await getStaff();
    if (!staff) return { ok: false as const, error: "Your session expired. Please sign in again." };
    if (!(await getAccessibleEstimate(staff, estimateId))) return { ok: false as const, error: "Estimate not found." };
    const admin = createSupabaseAdminClient();
    const esign = await readEsignFlags(admin, estimateId);
    const stripe = publicStripe(readStripeReadiness());
    const webhookConfigured = readWebhookConfigured();
    if (!(await paymentsSchemaReady(admin))) {
      return {
        ok: true as const, schemaReady: false, stripe, webhookConfigured, autoCharge: false, onlineBooking: false, esign,
        matchKind: "none" as const, matchedCustomerId: null, cards: [] as Awaited<ReturnType<typeof listSavedCards>>,
        schemaMessage: "The payments database update is not applied yet. Saved cards and auto-charge wait for that. Nothing was charged.",
      };
    }
    const estimate = await loadEstimate(admin, estimateId);
    if (!estimate) return { ok: false as const, error: "Estimate not found." };
    const match = await matchCustomersForLead(admin, estimate);
    const cards = match.kind === "one" ? await listSavedCards(admin, match.matches[0].id) : [];
    return {
      ok: true as const,
      schemaReady: true,
      stripe,
      webhookConfigured,
      autoCharge: estimate.auto_charge_enabled === true,
      onlineBooking: isOnlineBooking(estimate.lead_source),
      esign,
      matchKind: match.kind,
      matchedCustomerId: match.kind === "one" ? match.matches[0].id : null,
      cards,
      schemaMessage: null as string | null,
    };
  } catch (error) { return fail(error); }
}

export async function setAutoCharge(estimateId: string, enabled: boolean) {
  try {
    const gate = await paymentGate(estimateId);
    if (!gate.ok) return gate;
    const { error } = await gate.admin.from("estimates").update({ auto_charge_enabled: enabled }).eq("id", estimateId);
    if (error) return { ok: false as const, error: "Auto-charge could not be saved. Nothing was charged." };
    if (!enabled) return { ok: true as const, message: "Auto-charge is off. A card is charged only when someone presses Charge, or a transfer is logged by hand." };
    const attempt = await attemptAutoChargeForEstimate(estimateId);
    return { ok: true as const, message: attempt.charged ? attempt.message : `Auto-charge is on for this booking. ${attempt.message}` };
  } catch (error) { return fail(error); }
}

export async function searchPaymentCustomers(estimateId: string, query: string) {
  try {
    const staff = await getStaff();
    if (!staff) return { ok: false as const, error: "Your session expired. Please sign in again." };
    if (!(await getAccessibleEstimate(staff, estimateId))) return { ok: false as const, error: "Estimate not found." };
    const term = query.trim().slice(0, 80).replace(/[%_\\,]/g, "");
    if (term.length < 2) return { ok: false as const, error: "Type at least 2 characters." };
    const admin = createSupabaseAdminClient();
    if (!(await paymentsSchemaReady(admin))) return { ok: false as const, error: "The payments database update is not applied yet." };
    const like = `%${term}%`;
    // Phones are stored formatted on leads ("(305) 555-1234") and as digits on customers,
    // so a typed phone in any format is matched by its digits too.
    const digits = term.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    const digitLike = digits.length >= 4 ? `%${digits}%` : null;
    const digitPattern = digits.length >= 7 ? `%${digits.split("").join("%")}%` : null;
    const none = Promise.resolve({ data: [] as { id: string; display_name: string; email: string | null; phone: string | null }[] });
    const [byName, byEmail, byPhone, byDigits] = await Promise.all([
      admin.from("customers").select("id, display_name, email, phone").ilike("display_name", like).limit(15),
      admin.from("customers").select("id, display_name, email, phone").ilike("email", like).limit(15),
      admin.from("customers").select("id, display_name, email, phone").ilike("phone", like).limit(15),
      digitLike ? admin.from("customers").select("id, display_name, email, phone").ilike("phone_digits", digitLike).limit(15) : none,
    ]);
    const customers = new Map<string, { id: string; display_name: string; email: string | null; phone: string | null }>();
    for (const row of [...(byName.data || []), ...(byEmail.data || []), ...(byPhone.data || []), ...(byDigits.data || [])]) customers.set(row.id, row);
    const hits = [];
    for (const customer of customers.values()) {
      hits.push({
        kind: "customer" as const,
        id: customer.id,
        name: customer.display_name || "",
        email: customer.email,
        phone: customer.phone,
        jobNumber: null as string | null,
        cards: await listSavedCards(admin, customer.id),
      });
    }
    const leadCols = "id, job_number, customer_name, customer_email, customer_phone, customer_id";
    const [leadName, leadEmail, leadPhone, leadDigits] = await Promise.all([
      admin.from("estimates").select(leadCols).ilike("customer_name", like).neq("id", estimateId).limit(10),
      admin.from("estimates").select(leadCols).ilike("customer_email", like).neq("id", estimateId).limit(10),
      admin.from("estimates").select(leadCols).ilike("customer_phone", like).neq("id", estimateId).limit(10),
      digitPattern ? admin.from("estimates").select(leadCols).ilike("customer_phone", digitPattern).neq("id", estimateId).limit(10) : Promise.resolve({ data: null }),
    ]);
    const leadRows = new Map<string, NonNullable<typeof leadName.data>[number]>();
    for (const lead of [...(leadName.data || []), ...(leadEmail.data || []), ...(leadPhone.data || []), ...(leadDigits.data || [])]) leadRows.set(lead.id, lead);
    for (const lead of leadRows.values()) {
      if (hits.some(hit => hit.kind === "customer" && hit.id === lead.customer_id)) continue;
      hits.push({
        kind: "lead" as const,
        id: lead.id,
        name: lead.customer_name || "",
        email: lead.customer_email,
        phone: lead.customer_phone,
        jobNumber: lead.job_number,
        cards: lead.customer_id ? await listSavedCards(admin, lead.customer_id) : [],
      });
    }
    return { ok: true as const, hits: hits.slice(0, 20) };
  } catch (error) { return fail(error); }
}

export async function linkPaymentCustomer(estimateId: string, customerId: string) {
  try {
    const gate = await paymentGate(estimateId);
    if (!gate.ok) return gate;
    if (!isUuid(customerId)) return { ok: false as const, error: "That customer was not recognized. Nothing was linked." };
    const { data } = await gate.admin.from("customers").select("id").eq("id", customerId).maybeSingle();
    if (!data) return { ok: false as const, error: "That customer was not found. Nothing was linked." };
    const { error } = await gate.admin.from("estimates").update({ customer_id: customerId }).eq("id", estimateId);
    if (error) return { ok: false as const, error: "The customer could not be linked. Nothing was charged." };
    return { ok: true as const, message: "Customer linked. Stripe cards saved on that person are listed below. Old typed-in card numbers are not copied." };
  } catch (error) { return fail(error); }
}

export async function linkPaymentLead(estimateId: string, otherEstimateId: string) {
  try {
    const gate = await paymentGate(estimateId);
    if (!gate.ok) return gate;
    if (!isUuid(otherEstimateId) || otherEstimateId === estimateId) return { ok: false as const, error: "That job was not recognized. Nothing was linked." };
    const other = await loadEstimate(gate.admin, otherEstimateId);
    if (!other) return { ok: false as const, error: "That job was not found. Nothing was linked." };
    const created = other.customer_id && isUuid(other.customer_id)
      ? { ok: true as const, id: other.customer_id }
      : await ensureCustomer(gate.admin, other);
    if (!created.ok) return { ok: false as const, error: created.error };
    const { error } = await gate.admin.from("estimates").update({ customer_id: created.id }).eq("id", estimateId);
    if (error) return { ok: false as const, error: "The customer could not be linked. Nothing was charged." };
    return { ok: true as const, message: "Customer linked from that job. Old typed-in card numbers are not copied." };
  } catch (error) { return fail(error); }
}

/**
 * Save a card taken by phone without charging it. Opens a Stripe SetupIntent on this
 * lead's customer; the rep types the card into Stripe's fields. No payment row is made.
 */
export async function startCardSave(estimateId: string): Promise<{ ok: true; clientSecret: string; setupIntentId: string; intentType: "setup" } | Fail> {
  try {
    const gate = await paymentGate(estimateId);
    if (!gate.ok) return gate;
    if (!gate.readiness.connected) return { ok: false, error: "Stripe is not connected. Nothing was saved." };
    const ensured = await ensureCustomer(gate.admin, gate.estimate);
    if (!ensured.ok) return { ok: false, error: ensured.error };
    const customer = { id: ensured.id, stripeCustomerId: ensured.stripeCustomerId };
    const stripeCustomerId = await stripeCustomerIdFor(gate.admin, customer, gate.estimate);
    if (!stripeCustomerId) return { ok: false, error: "Stripe's customer record could not be made. Nothing was saved." };
    const setup = await createCardSetup({
      stripeCustomerId,
      idempotencyKey: `save-card-${crypto.randomUUID()}`,
      metadata: { estimate_id: estimateId, customer_id: customer.id, job_number: gate.estimate.job_number || "", purpose: "crm_save_card", staff: gate.staff.name || "" },
    });
    if (!setup.ok) return { ok: false, error: setup.error };
    return { ok: true, clientSecret: setup.clientSecret, setupIntentId: setup.id, intentType: "setup" };
  } catch (error) { return fail(error); }
}

/** Reads the SetupIntent back from Stripe and records the card (brand, last 4, exp) on the customer. */
export async function finishCardSave(estimateId: string, setupIntentId: string): Promise<{ ok: true; message: string; cardId: string } | Fail> {
  try {
    const gate = await paymentGate(estimateId);
    if (!gate.ok) return gate;
    if (!/^seti_[A-Za-z0-9]+$/.test(setupIntentId)) return { ok: false, error: "That card save was not recognized. Nothing was saved." };
    const setup = await retrieveSetup(setupIntentId);
    if (!setup.ok) return { ok: false, error: setup.error };
    if (setup.status !== "succeeded") return { ok: false, error: "Stripe has not confirmed the card. Nothing was saved." };
    if (setup.metadata.estimate_id !== estimateId || setup.metadata.purpose !== "crm_save_card" || !setup.metadata.customer_id) {
      return { ok: false, error: "This card could not be matched to this lead. Nothing was saved." };
    }
    if (!setup.paymentMethodId || !setup.card?.last4) return { ok: false, error: "Stripe did not return a usable card. Nothing was saved." };
    const customerId = setup.metadata.customer_id;
    const { data: customer } = await gate.admin.from("customers").select("stripe_customer_id").eq("id", customerId).maybeSingle();
    const saved = await saveStripeCard(gate.admin, {
      customerId,
      stripeCustomerId: customer?.stripe_customer_id || null,
      stripePaymentMethodId: setup.paymentMethodId,
      card: setup.card,
      originalJobNumber: gate.estimate.job_number,
      originalEstimateId: estimateId,
    });
    if (!saved.ok) return { ok: false, error: saved.error };
    if (!gate.estimate.customer_id) await gate.admin.from("estimates").update({ customer_id: customerId }).eq("id", estimateId);
    const label = `${displayBrand(setup.card.brand)} ••••${setup.card.last4}`;
    return { ok: true, cardId: saved.id, message: `${label} saved on this customer. Nothing was charged. Pick it below to charge it, or leave Auto-charge on.` };
  } catch (error) { return fail(error); }
}

type BeginOk = {
  ok: true;
  charged: boolean;
  pending?: boolean;
  message: string;
  clientSecret?: string;
  intentType?: "payment" | "setup";
  receipt?: ChargeReceipt;
};

/** Starts a Stripe card payment or saves a card for later. Never marks a payment paid by itself. */
export async function beginStripeCard(estimateId: string, form: FormData): Promise<BeginOk | Fail> {
  try {
    const gate = await paymentGate(estimateId);
    if (!gate.ok) return gate;
    const { admin, staff, estimate, readiness, esign } = gate;
    const amountCents = toCents(form.get("amount"));
    if (amountCents !== null && amountCents < 0) {
      return { ok: false, error: "A negative amount only corrects the books. Use Update Payment. Nothing was charged or refunded." };
    }
    if (readiness.connected && (digitsOnly(form.get("card_number")) || digitsOnly(form.get("cvv")))) {
      return { ok: false, error: "Card numbers are not typed into this screen while Stripe is connected. Nothing was saved and nothing was charged." };
    }
    const idempotencyKey = text(form.get("idempotency_key"), 80);
    // Charge Now: the rep wants the card charged immediately, so this one request skips
    // "save for later until both e-signs". It does not change the job's auto-charge switch.
    const chargeNow = checked(form, "charge_now");
    const autoCharge = !chargeNow && checked(form, "auto_charge");
    const saved = await lookupSavedCard(admin, estimate, text(form.get("saved_card_id"), 40));
    if (saved && "error" in saved) return { ok: false, error: saved.error };
    if (saved && !saved.stripe_payment_method_id) return { ok: false, error: "That saved card cannot be charged. Nothing was charged." };

    const existing = idempotencyKey && isUuid(idempotencyKey) ? await findByIdempotency(admin, idempotencyKey) : null;
    if (existing && existing.estimate_id !== estimateId) {
      return { ok: false, error: "This safety key was already used on another job. Nothing was charged.", newKey: true };
    }
    if (existing?.charge_status === "auto_charge_waiting") {
      if (!esign.both || !autoCharge) return { ok: false, error: "This card is already waiting for both e-signs. Nothing was charged." };
      const attempt = await attemptAutoChargeForEstimate(estimateId);
      return { ok: true, charged: attempt.charged, pending: !attempt.charged && attempt.message.includes("already being processed"), message: attempt.message };
    }
    if (existing) {
      const done = existing.charge_status === "succeeded" || existing.charge_status === "recorded" || existing.charge_status === "logged_manual" || existing.charge_status === "bookkeeping_adjustment";
      return {
        ok: false,
        error: done ? "This payment is already recorded. It was not charged again." : "This attempt already finished or is still in progress. It was not charged again.",
        newKey: !done,
      };
    }

    const decision = decidePayment({
      amountCents: amountCents ?? 0,
      autoCharge,
      bothEsignsComplete: esign.both,
      stripeConnected: readiness.connected,
      savedPaymentMethod: Boolean(saved && saved.stripe_payment_method_id),
      purpose: "card",
      idempotencyKey,
      existingCharge: null,
    });
    if (decision.action === "reject" || decision.action === "duplicate" || decision.action === "payment_link") {
      const message = decision.action === "payment_link" ? "Use Send Customer Payment Link. Nothing was charged." : decision.message;
      return { ok: false, error: message };
    }

    const customerId = saved ? saved.customer_id : null;
    let customer = customerId
      ? { id: customerId, stripeCustomerId: saved?.stripe_customer_id || null }
      : null;
    if (saved) {
      await admin.from("estimates").update({ customer_id: saved.customer_id }).eq("id", estimateId);
    }

    if (decision.action === "save_card_for_later" && !decision.needsSetup) {
      if (!saved?.stripe_payment_method_id || !customer) return { ok: false, error: "The saved card could not be used. Nothing was charged." };
      const inserted = await insertPayment(admin, {
        ...paidRowBase({
          estimateId, customerId: customer.id, staffId: staff.userId, staffName: staff.name,
          amountCents: decision.amountCents, method: "Credit Card", isDeposit: checked(form, "is_deposit"),
          chargeStatus: "auto_charge_waiting", autoCharge: true, idempotencyKey, remark: text(form.get("remark"), 500),
          confirmationNo: null, card: snapshotOf(saved),
        }),
        stripe_payment_method_id: saved.stripe_payment_method_id,
      });
      if (!inserted.ok) return { ok: false, error: inserted.error, newKey: inserted.duplicate };
      await setPaymentVehicle(admin, inserted.id, vehicleIndexFrom(form.get("vehicle_index")));
      return { ok: true, charged: false, message: "Card saved for this amount. It charges only after both e-signs, and only while auto-charge is on. Nothing was charged yet." };
    }

    if (!customer) {
      const ensured = await ensureCustomer(admin, estimate);
      if (!ensured.ok) return { ok: false, error: ensured.error };
      customer = { id: ensured.id, stripeCustomerId: ensured.stripeCustomerId };
    }

    const guarded = await runWithStripeGuard(decision, readiness.connected, async () => {
      if (!customer) return { ok: false as const, error: "The customer record could not be saved. Nothing was charged." };
      const stripeCustomerId = decision.action === "charge_saved"
        ? saved?.stripe_customer_id || null
        : await stripeCustomerIdFor(admin, customer, estimate);
      if (!stripeCustomerId) return { ok: false as const, error: "Stripe's customer record is missing. Nothing was charged." };
      if (decision.action === "charge_saved" && !saved?.stripe_payment_method_id) {
        return { ok: false as const, error: "The saved card could not be used. Nothing was charged." };
      }
      const inserted = await insertPayment(admin, paidRowBase({
        estimateId, customerId: customer.id, staffId: staff.userId, staffName: staff.name,
        amountCents: decision.amountCents, method: "Credit Card", isDeposit: checked(form, "is_deposit"),
        chargeStatus: decision.action === "save_card_for_later" ? "pending" : "processing",
        autoCharge, idempotencyKey, remark: text(form.get("remark"), 500), confirmationNo: null, card: snapshotOf(saved),
      }));
      if (!inserted.ok) return { ok: false as const, error: inserted.error, newKey: inserted.duplicate };
      // Customer payment per vehicle (payments.vehicle_index; ignored until the migration is applied).
      await setPaymentVehicle(admin, inserted.id, vehicleIndexFrom(form.get("vehicle_index")));
      const metadata = {
        estimate_id: estimateId,
        crm_payment_id: inserted.id,
        job_number: estimate.job_number || "",
        amount_cents: String(decision.amountCents),
        idempotency_key: idempotencyKey || "",
        customer_id: customer.id,
      };
      if (decision.action === "charge_saved" && saved?.stripe_payment_method_id) {
        await admin.from("payments").update({ stripe_payment_method_id: saved.stripe_payment_method_id }).eq("id", inserted.id);
        const result = await chargeSavedCard({
          amountCents: decision.amountCents,
          stripeCustomerId,
          paymentMethodId: saved.stripe_payment_method_id,
          idempotencyKey: idempotencyKey || inserted.id,
          metadata,
        });
        return finishOffSession(admin, inserted.id, decision.amountCents, result, { brand: saved.brand ?? null, last4: saved.last4 ?? null });
      }
      if (decision.action === "save_card_for_later") {
        const setup = await createCardSetup({ stripeCustomerId, idempotencyKey: idempotencyKey || inserted.id, metadata });
        if (!setup.ok) {
          await admin.from("payments").update({ charge_status: "failed", remark: setup.error }).eq("id", inserted.id);
          return { ok: false as const, error: setup.error, newKey: true };
        }
        const stored = await admin.from("payments").update({ stripe_setup_intent_id: setup.id }).eq("id", inserted.id);
        if (stored.error) {
          return { ok: false as const, error: "The card box could not be saved. Nothing was charged.", newKey: true };
        }
        return { ok: true as const, charged: false, message: "Enter the card in the secure box. Saving it does not charge it.", clientSecret: setup.clientSecret, intentType: "setup" as const };
      }
      const payment = await createCardPayment({ amountCents: decision.amountCents, stripeCustomerId, idempotencyKey: idempotencyKey || inserted.id, metadata });
      if (!payment.ok) {
        await admin.from("payments").update({ charge_status: "failed", remark: payment.error }).eq("id", inserted.id);
        return { ok: false as const, error: payment.error, newKey: true };
      }
      const stored = await admin.from("payments").update({ stripe_payment_intent_id: payment.id }).eq("id", inserted.id);
      if (stored.error) {
        await cancelCardPayment(payment.id);
        await admin.from("payments").update({ charge_status: "failed", remark: "The charge could not be recorded, so it was canceled. Nothing was marked paid." }).eq("id", inserted.id);
        return { ok: false as const, error: "The charge could not be recorded, so it was canceled. Nothing was marked paid.", newKey: true };
      }
      return { ok: true as const, charged: false, message: "Enter the card in the secure box. It is not paid until Stripe confirms it.", clientSecret: payment.clientSecret, intentType: "payment" as const };
    });
    if (!guarded.called) return { ok: false, error: guarded.blocked || "Nothing was charged." };
    return guarded.result;
  } catch (error) { return fail(error); }
}

async function lookupSavedCard(admin: Admin, estimate: EstimateRow, cardId: string | null): Promise<SavedCard | { error: string } | null> {
  if (!cardId) return null;
  if (!isUuid(cardId)) return { error: "That saved card was not recognized. Nothing was charged." };
  const { data } = await admin.from("customer_payment_methods").select("id, customer_id, stripe_customer_id, stripe_payment_method_id, brand, last4, exp_month, exp_year").eq("id", cardId).maybeSingle();
  if (!data?.customer_id) return { error: "That saved card was not found. Nothing was charged." };
  const matches = await matchCustomersForLead(admin, estimate);
  const allowed = estimate.customer_id === data.customer_id || matches.matches.some(match => match.id === data.customer_id);
  if (!allowed) return { error: "That card is not on a matching customer. Nothing was charged." };
  return data;
}

async function stripeCustomerIdFor(admin: Admin, customer: { id: string; stripeCustomerId: string | null }, estimate: EstimateRow) {
  if (customer.stripeCustomerId) return customer.stripeCustomerId;
  const created = await createStripeCustomer({
    name: estimate.customer_name || "",
    email: estimate.customer_email,
    phone: estimate.customer_phone,
    crmCustomerId: customer.id,
  });
  if (!created.ok) return null;
  await rememberStripeCustomer(admin, customer.id, created.id);
  customer.stripeCustomerId = created.id;
  return created.id;
}

async function finishOffSession(
  admin: Admin,
  paymentId: string,
  amountCents: number,
  result: Awaited<ReturnType<typeof chargeSavedCard>>,
  savedCard: { brand: string | null; last4: string | null } = { brand: null, last4: null },
): Promise<BeginOk | Fail> {
  const receipt = (paymentIntentId: string | null, card?: { brand: string | null; last4: string | null } | null): ChargeReceipt => ({
    amountCents, paymentIntentId, brand: card?.brand || savedCard.brand, last4: card?.last4 || savedCard.last4,
  });
  if (!result.ok) {
    if (result.paymentIntentId) await cancelCardPayment(result.paymentIntentId);
    await admin.from("payments").update({
      charge_status: "failed",
      stripe_payment_intent_id: result.paymentIntentId,
      remark: result.error,
    }).eq("id", paymentId);
    return { ok: false, error: result.error, newKey: true, receipt: receipt(result.paymentIntentId) };
  }
  if (result.status === "processing") {
    await admin.from("payments").update({ stripe_payment_intent_id: result.id, remark: "Stripe has not confirmed this yet. It was not marked paid." }).eq("id", paymentId);
    return { ok: true, charged: false, pending: true, message: "Stripe has not confirmed this yet. It was not marked paid.", receipt: receipt(result.id, result.card) };
  }
  if (result.status !== "succeeded" || result.amount !== amountCents || result.currency !== "usd") {
    await cancelCardPayment(result.id);
    await admin.from("payments").update({ charge_status: "failed", stripe_payment_intent_id: result.id, remark: "Stripe did not confirm the charge. It was not marked paid." }).eq("id", paymentId);
    return { ok: false, error: "Stripe did not confirm the charge. It was not marked paid.", newKey: true, receipt: receipt(result.id, result.card) };
  }
  await admin.from("payments").update({
    charge_status: "succeeded",
    confirmation_no: result.id,
    stripe_payment_intent_id: result.id,
    amount: centsToDecimal(amountCents),
    remark: "Charged from the saved card.",
    ...(result.card?.last4 ? cardColumns(result.card) : {}),
  }).eq("id", paymentId);
  return { ok: true, charged: true, message: "Stripe confirmed this charge.", receipt: receipt(result.id, result.card) };
}

/** Marks a payment paid only after reading the PaymentIntent back from Stripe. */
export async function finalizeStripePayment(estimateId: string, idempotencyKey: string): Promise<{ ok: true; charged: boolean; message: string; receipt?: ChargeReceipt } | Fail> {
  try {
    const gate = await paymentGate(estimateId);
    if (!gate.ok) return gate;
    if (!isUuid(idempotencyKey)) return { ok: false, error: "This payment could not be matched. Nothing was marked paid." };
    const row = await findByIdempotency(gate.admin, idempotencyKey);
    if (!row || row.estimate_id !== estimateId) return { ok: false, error: "This payment was not found. Nothing was marked paid." };
    if (row.charge_status === "succeeded") return { ok: true, charged: true, message: "This payment is already recorded." };
    if (row.charge_status === "bookkeeping_adjustment" || row.charge_status === "logged_manual") {
      return { ok: false, error: "This record does not move money." };
    }
    if (row.stripe_setup_intent_id && !row.stripe_payment_intent_id) return finalizeSetup(gate, row);
    if (!row.stripe_payment_intent_id) return { ok: false, error: "Stripe has not started this payment. Nothing was marked paid." };
    const payment = await retrieveCardPayment(row.stripe_payment_intent_id);
    if (!payment.ok) return { ok: false, error: payment.error };
    const expected = toCents(row.amount);
    const matches = payment.metadata.estimate_id === estimateId
      && payment.metadata.crm_payment_id === row.id
      && payment.currency === "usd"
      && expected !== null
      && expected > 0
      && payment.amount === expected;
    if (payment.status !== "succeeded" || !matches) {
      if (payment.status !== "processing") {
        await gate.admin.from("payments").update({ charge_status: "failed", remark: "Stripe did not confirm this payment. It was not marked paid." }).eq("id", row.id);
      }
      return { ok: false, error: "Stripe did not confirm this payment. It was not marked paid.", receipt: { amountCents: payment.amount, brand: payment.card?.brand || null, last4: payment.card?.last4 || null, paymentIntentId: payment.id } };
    }
    await gate.admin.from("payments").update({
      charge_status: "succeeded",
      confirmation_no: payment.id,
      amount: centsToDecimal(expected),
      ...(payment.card?.last4 ? cardColumns(payment.card) : {}),
    }).eq("id", row.id);
    if (payment.paymentMethodId && row.customer_id && payment.card?.last4) {
      const { data: customer } = await gate.admin.from("customers").select("stripe_customer_id").eq("id", row.customer_id).maybeSingle();
      await saveStripeCard(gate.admin, {
        customerId: row.customer_id,
        stripeCustomerId: customer?.stripe_customer_id || null,
        stripePaymentMethodId: payment.paymentMethodId,
        card: payment.card,
        originalJobNumber: gate.estimate.job_number,
        originalEstimateId: estimateId,
      });
    }
    return { ok: true, charged: true, message: "Stripe confirmed this payment.", receipt: { amountCents: expected, brand: payment.card?.brand || null, last4: payment.card?.last4 || null, paymentIntentId: payment.id } };
  } catch (error) { return fail(error); }
}

async function finalizeSetup(
  gate: Extract<Awaited<ReturnType<typeof paymentGate>>, { ok: true }>,
  row: NonNullable<Awaited<ReturnType<typeof findByIdempotency>>>,
): Promise<{ ok: true; charged: boolean; message: string } | Fail> {
  const setup = await retrieveSetup(row.stripe_setup_intent_id || "");
  if (!setup.ok || setup.status !== "succeeded") return { ok: false, error: "The card was not saved. Nothing was charged." };
  if (setup.metadata.estimate_id !== gate.estimate.id || setup.metadata.crm_payment_id !== row.id) {
    return { ok: false, error: "This card could not be matched to the booking. Nothing was charged." };
  }
  if (!setup.paymentMethodId || !setup.card?.last4 || !row.customer_id) {
    return { ok: false, error: "Stripe did not return a usable card. Nothing was charged." };
  }
  const { data: customer } = await gate.admin.from("customers").select("stripe_customer_id").eq("id", row.customer_id).maybeSingle();
  const saved = await saveStripeCard(gate.admin, {
    customerId: row.customer_id,
    stripeCustomerId: customer?.stripe_customer_id || null,
    stripePaymentMethodId: setup.paymentMethodId,
    card: setup.card,
    originalJobNumber: gate.estimate.job_number,
    originalEstimateId: gate.estimate.id,
  });
  if (!saved.ok) return { ok: false, error: saved.error };
  await gate.admin.from("payments").update({
    charge_status: "auto_charge_waiting",
    stripe_payment_method_id: setup.paymentMethodId,
    remark: "Card saved. Waiting until both e-signs are complete. Nothing was charged yet.",
    ...cardColumns(setup.card),
  }).eq("id", row.id);
  if (gate.esign.both && gate.estimate.auto_charge_enabled) {
    const attempt = await attemptAutoChargeForEstimate(gate.estimate.id);
    return { ok: true, charged: attempt.charged, message: attempt.message };
  }
  return { ok: true, charged: false, message: "Card saved. It is charged only after both e-signs, and only while auto-charge is on. Nothing was charged yet." };
}

export async function cancelIncompletePayment(estimateId: string, idempotencyKey: string) {
  try {
    const gate = await paymentGate(estimateId);
    if (!gate.ok) return gate;
    if (!isUuid(idempotencyKey)) return { ok: true as const, message: "Nothing was waiting." };
    const row = await findByIdempotency(gate.admin, idempotencyKey);
    if (!row || row.estimate_id !== estimateId) return { ok: true as const, message: "Nothing was waiting." };
    if (row.charge_status === "succeeded") return { ok: false as const, error: "This payment already went through. It was not canceled." };
    if (row.stripe_payment_intent_id) {
      const payment = await retrieveCardPayment(row.stripe_payment_intent_id);
      if (payment.ok && payment.status === "succeeded") return { ok: false as const, error: "Stripe already confirmed this payment. It was not canceled." };
      await cancelCardPayment(row.stripe_payment_intent_id);
    }
    await gate.admin.from("payments").update({
      charge_status: "failed",
      remark: "Closed before Stripe confirmed it. Nothing was marked paid.",
    }).eq("id", row.id).in("charge_status", ["pending", "processing"]);
    return { ok: true as const, message: "Closed. Nothing was marked paid." };
  } catch (error) { return fail(error); }
}

/** Creates a Stripe-hosted payment page. Opening it, or coming back, does not mark the job paid. */
export async function sendPaymentLink(estimateId: string, form: FormData): Promise<{ ok: true; url: string; emailed: boolean; texted?: boolean; mailto: string | null; message: string } | Fail> {
  try {
    const gate = await paymentGate(estimateId);
    if (!gate.ok) return gate;
    const amountCents = toCents(form.get("amount"));
    if (amountCents !== null && amountCents < 0) {
      return { ok: false as const, error: "A negative amount only corrects the books. It does not create a payment link or move money." };
    }
    const channel = form.get("channel") === "text" ? "text" : "email";
    // Text: refuse BEFORE creating a Stripe link when texting is not set up or there is no phone.
    if (channel === "text") {
      if (!smsMode()) return { ok: false as const, error: "Texting is not set up yet (SMS API pending). Nothing was created. Use Email." };
      if (!toE164(gate.estimate.customer_phone)) return { ok: false as const, error: "The customer's phone number is not a valid US number. Nothing was created." };
    }
    const key = text(form.get("idempotency_key"), 80);
    const decision = decidePayment({
      amountCents: amountCents ?? 0,
      autoCharge: false,
      bothEsignsComplete: false,
      stripeConnected: gate.readiness.connected,
      savedPaymentMethod: false,
      purpose: "payment_link",
      idempotencyKey: key,
      existingCharge: null,
    });
    if (decision.action !== "payment_link") {
      return { ok: false as const, error: "message" in decision ? decision.message : "No payment link was created." };
    }
    if (key) {
      const priorPay = await findByIdempotency(gate.admin, key);
      if (priorPay) return { ok: false as const, error: "This safety key was already used for a payment. Nothing new was created.", newKey: true };
    }
    const { data: prior } = await gate.admin.from("payment_links").select("url, amount").eq("idempotency_key", key || "").maybeSingle();
    if (prior?.url) {
      if (toCents(prior.amount) !== decision.amountCents) {
        return { ok: false as const, error: "This link was already created for a different amount. Nothing new was charged.", newKey: true };
      }
      return { ok: true as const, url: prior.url, emailed: false, mailto: null as string | null, message: "This link was already created. It was not charged again. Copy it to send again." };
    }
    const ensured = await ensureCustomer(gate.admin, gate.estimate);
    if (!ensured.ok) return { ok: false as const, error: ensured.error };
    let stripeCustomerId = ensured.stripeCustomerId;
    if (!stripeCustomerId) {
      const created = await createStripeCustomer({
        name: gate.estimate.customer_name || "",
        email: gate.estimate.customer_email,
        phone: gate.estimate.customer_phone,
        crmCustomerId: ensured.id,
      });
      if (created.ok) {
        stripeCustomerId = created.id;
        await rememberStripeCustomer(gate.admin, ensured.id, created.id);
      }
    }
    const origin = await publicOrigin();
    const isDeposit = checked(form, "is_deposit");
    const job = gate.estimate.job_number || "this job";
    const guarded = await runWithStripeGuard(decision, gate.readiness.connected, () => createCheckoutLink({
      amountCents: decision.amountCents,
      idempotencyKey: key || "",
      stripeCustomerId,
      customerEmail: gate.estimate.customer_email,
      successUrl: `${origin}/estimates/${estimateId}/payments?pay=return`,
      cancelUrl: `${origin}/estimates/${estimateId}/payments?pay=cancel`,
      description: `${isDeposit ? "Deposit" : "Payment"} for job ${job}`.slice(0, 120),
      metadata: {
        estimate_id: estimateId,
        customer_id: ensured.id,
        job_number: job,
        amount_cents: String(decision.amountCents),
        idempotency_key: key || "",
      },
    }));
    if (!guarded.called) return { ok: false as const, error: guarded.blocked || "No payment link was created." };
    if (!guarded.result.ok) return { ok: false as const, error: guarded.result.error };
    await gate.admin.from("payment_links").insert({
      estimate_id: estimateId,
      amount: centsToDecimal(decision.amountCents),
      url: guarded.result.url,
      stripe_checkout_session_id: guarded.result.id,
      idempotency_key: key,
      is_deposit: isDeposit,
      created_by: gate.staff.userId,
    });
    if (channel === "text") {
      const t = await textLink(gate.admin, gate.estimate, guarded.result.url, gate.staff, decision.amountCents);
      return { ok: true as const, url: guarded.result.url, emailed: false, texted: t.texted, mailto: null, message: t.message };
    }
    const delivery = await emailLink(gate.admin, gate.estimate, guarded.result.url, origin, gate.staff, decision.amountCents);
    return { ok: true as const, url: guarded.result.url, emailed: delivery.emailed, mailto: delivery.mailto, message: delivery.message };
  } catch (error) { return fail(error); }
}

/** For the Payments UI: is texting configured, and every way to pay (Stripe methods + Zelle direct). No secrets. */
export async function paymentLinkSetup(): Promise<{ sms: boolean; methods: ReturnType<typeof paymentMethodLines> }> {
  return { sms: !!smsMode(), methods: paymentMethodLines() };
}

/** Texts the payment link (only when SMS is configured; see lib/sms.ts). Logged as an Operations note. */
async function textLink(admin: Admin, estimate: EstimateRow, url: string, staff: { userId: string; name: string }, amountCents: number) {
  const company = await getCompanyInfo();
  const body = paymentLinkSms({ company: company.quoteCompanyName, job: estimate.job_number || "", amount: formatMoney(amountCents / 100), url, phone: company.mainPhone, zelle: zelleAddress() });
  const r = await sendSms(estimate.customer_phone || "", body);
  await admin.from("estimate_notes").insert({
    estimate_id: estimate.id, kind: "operations", author_name: staff.name,
    body: r.ok ? `Payment link texted to ${estimate.customer_phone} (${formatMoney(amountCents / 100)}).` : `Payment link text failed: ${scrubSecrets(r.error)}`,
  });
  if (r.ok) await admin.from("estimates").update({ last_touched_at: new Date().toISOString() }).eq("id", estimate.id);
  return r.ok
    ? { texted: true, message: `Texted to ${estimate.customer_phone}. The link is also here to copy.` }
    : { texted: false, message: `The text was not sent: ${scrubSecrets(r.error)} Copy the link to send it another way.` };
}

/**
 * Emails the payment link in the shared branded layout and logs it in crm_emails (kind
 * 'payment_link', own token, pixel + click tracking, opt-out, exact HTML snapshot) so it shows
 * in the Email Center's Previous Emails and on Recurring like every other CRM email.
 * Before the 20261030230000 migration adds the kind, it is still emailed (as before) but not logged.
 */
async function emailLink(admin: Admin, estimate: EstimateRow, url: string, origin: string, staff: { userId: string; name: string }, amountCents: number) {
  const email = (estimate.customer_email || "").trim();
  const job = estimate.job_number || "your job";
  const mailto = email
    ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`Payment link for job ${job}`)}&body=${encodeURIComponent(`Pay here: ${url}\n\nComing back to the office screen does not mark this paid.`)}`
    : null;
  if (!email) return { emailed: false, mailto, message: "No customer email is on this lead, so nothing was emailed. Copy the link to text it." };
  const block = await activeBlock(email);
  if (block) return { emailed: false, mailto, message: `${blockedMessage(block)} The link is here to copy.` };
  if (!mailMode()) return { emailed: false, mailto, message: "Email is not set up, so this was not emailed. Copy the link or open the mail draft." };
  const bundle = await loadLeadBundle(estimate.id);
  if (!bundle) return { emailed: false, mailto, message: "The lead was not found, so this was not emailed. Copy the link." };
  const token = newEmailToken();
  const input = docInput(bundle, origin, "e_quote");
  input.paymentLink = { url, amount: formatMoney(amountCents / 100) };
  // Total / Customer Payment / Balance, like the booked order, but only once the payments add up
  // to something (Owner 2026-10-31: no "Customer Payment $0.00" for the customer).
  input.paidAmount = Math.round(bundle.paidAmount * 100) !== 0 ? bundle.paidAmount : null;
  input.paidRows = input.paidAmount === null ? [] : bundle.paidRows;
  input.paymentMethods = paymentMethodLines();
  input.links = {
    trackingPixelUrl: `${origin}/api/email/open/${token}`,
    clickBase: clickBase(origin, token),
    optOutHref: `${origin}/u/${token}`,
  };
  const rendered = renderTemplate("payment_link", input);
  const unsubscribeUrl = `${origin}/u/${token}`;
  const text = plainTextPart({ text: rendered.text, link: { label: `Payment link for job ${job}`, url }, company: bundle.company, unsubscribeUrl });
  const repEmail = repInfo(input).email || null;
  const from = sender(bundle.company, repEmail);
  const cc = repEmail && repEmail.toLowerCase() !== email.toLowerCase() ? repEmail : null;
  const { data: row, error } = await admin.from("crm_emails").insert({
    estimate_id: estimate.id, token, kind: "payment_link", subject: rendered.subject, sent_to: email,
    sent_by: staff.userId, sent_by_name: staff.name, doc_sha256: createHash("sha256").update(rendered.html, "utf8").digest("hex"), html_snapshot: rendered.html,
    sent_from: from.address, sent_cc: cc, reply_to: from.replyTo, delivery: mailMode(),
  }).select("id, estimate_id").single();
  if (error) console.error("[crm] payment link email not logged (apply 20261030230000_payment_link_email_kind.sql):", error.message);
  const logged = !error && !!row;
  // Not logged -> no tracking links (they would point at a token that does not exist).
  const html = logged ? rendered.html : renderTemplate("payment_link", { ...input, links: null }).html;
  const sent = await sendMail({
    from: { name: from.name, address: from.address },
    to: email, cc, replyTo: from.replyTo, subject: rendered.subject, html, text,
    unsubscribeUrl: logged ? unsubscribeUrl : null,
  });
  if (logged && sent) {
    await admin.from("crm_email_events").insert({
      email_id: row.id, estimate_id: row.estimate_id, event: sent.ok ? "delivered" : "delivery_failed",
      detail: (sent.ok ? `${sent.mode} ${sent.id}` : `${sent.mode}: ${scrubSecrets(sent.error)}`).slice(0, 500),
    });
  }
  if (sent?.ok) {
    await admin.from("estimates").update({ last_touched_at: new Date().toISOString() }).eq("id", estimate.id);
    return { emailed: true, mailto, message: `Emailed to ${email}${logged ? " (logged in the Email Center)" : ""}. The link is also here to copy.` };
  }
  const reason = sent && !sent.ok ? scrubSecrets(sent.error) : "";
  return { emailed: false, mailto, message: `The CRM did not email this${reason ? `: ${reason}` : ""}. Copy the link or open the mail draft.` };
}

/**
 * RETURN TO CUSTOMER (refunds). Separate from Charge Now and Update Payment.
 * Admin / supervisor only. Refunds part or all of one Stripe-confirmed charge on this job,
 * then writes a negative ledger row (so the balance goes back up). Idempotency key required.
 */
export async function returnToCustomer(estimateId: string, form: FormData): Promise<{ ok: true; message: string; receipt: { amountCents: number; refundId: string; status: string; paymentIntentId: string } } | Fail> {
  try {
    const gate = await paymentGate(estimateId);
    if (!gate.ok) return gate;
    const { admin, staff, readiness } = gate;
    if (!isManager(staff)) return { ok: false, error: "Only an admin or supervisor can return money to a customer. Nothing was returned." };
    if (!readiness.connected) return { ok: false, error: "Stripe is not connected. Nothing was returned to the customer." };
    const key = text(form.get("idempotency_key"), 80);
    if (!key || !isUuid(key)) return { ok: false, error: "This was stopped because its safety key was missing. Nothing was returned.", newKey: true };
    const paymentId = text(form.get("payment_id"), 40);
    if (!paymentId || !isUuid(paymentId)) return { ok: false, error: "Pick the charge to return money from. Nothing was returned." };
    const amountCents = toCents(form.get("amount"));
    if (amountCents === null || amountCents <= 0) return { ok: false, error: "Enter the amount to return (more than $0). Nothing was returned." };
    const reason = text(form.get("reason"), 300);

    const existing = await findByIdempotency(admin, key);
    if (existing) return { ok: false, error: "This return was already sent. It was not sent again.", newKey: true };

    const { data: original } = await admin.from("payments")
      .select("id, estimate_id, amount, method, charge_status, stripe_payment_intent_id, voided_at, customer_id, is_deposit")
      .eq("id", paymentId).maybeSingle();
    if (!original || original.estimate_id !== estimateId) return { ok: false, error: "That charge was not found on this job. Nothing was returned." };
    if (original.voided_at) return { ok: false, error: "That charge was voided in the CRM. Nothing was returned." };
    if (original.charge_status !== "succeeded" || !original.stripe_payment_intent_id) {
      return { ok: false, error: "Only a Stripe charge that Stripe confirmed can be returned here. Nothing was returned." };
    }
    const originalC = toCents(original.amount) ?? 0;
    // Math audit 2026-10-31: count refunds already made from this same charge (refunded or
    // still processing), so two partial refunds can never add up to more than the charge.
    const { data: earlier } = await admin.from("payments").select("amount, charge_status, voided_at, remark")
      .eq("estimate_id", estimateId).lt("amount", 0).ilike("remark", `%from ${original.stripe_payment_intent_id}%`);
    const alreadyC = -(earlier || []).filter(r => !r.voided_at && r.charge_status !== "failed").reduce((t, r) => t + (toCents(r.amount) ?? 0), 0);
    const leftC = originalC - alreadyC;
    if (amountCents > leftC) return { ok: false, error: `That is more than what is left on the charge (${(leftC / 100).toFixed(2)} of ${(originalC / 100).toFixed(2)}; ${(alreadyC / 100).toFixed(2)} already returned). Nothing was returned.` };
    const { data: originalVehicle } = await admin.from("payments").select("vehicle_index").eq("id", original.id).maybeSingle().then(r => r, () => ({ data: null }));

    const inserted = await insertPayment(admin, {
      ...paidRowBase({
        estimateId, customerId: original.customer_id || null, staffId: staff.userId, staffName: staff.name,
        // A refund of a deposit charge is a negative deposit row, so "Deposit paid" goes down with it.
        amountCents: -amountCents, method: original.method || "Credit Card", isDeposit: !!original.is_deposit, chargeStatus: "processing",
        autoCharge: false, idempotencyKey: key,
        remark: `Return to customer from ${original.stripe_payment_intent_id}${reason ? ` — ${reason}` : ""}`,
        confirmationNo: null, card: null,
      }),
    });
    if (!inserted.ok) return { ok: false, error: inserted.error.replace("charged again", "sent again"), newKey: inserted.duplicate };
    await setPaymentVehicle(admin, inserted.id, (originalVehicle as { vehicle_index?: number | null } | null)?.vehicle_index ?? null);

    const refund = await refundCardPayment({
      paymentIntentId: original.stripe_payment_intent_id,
      amountCents,
      idempotencyKey: key,
      metadata: { estimate_id: estimateId, crm_payment_id: inserted.id, original_crm_payment_id: original.id, kind: "return_to_customer" },
    });
    if (!refund.ok) {
      await admin.from("payments").update({ charge_status: "failed", remark: refund.error }).eq("id", inserted.id);
      return { ok: false, error: refund.error, newKey: true };
    }
    const done = refund.status === "succeeded" || refund.status === "pending";
    await admin.from("payments").update({
      charge_status: done ? "succeeded" : "failed",
      confirmation_no: refund.id,
      remark: `Return to customer ${refund.id} (${refund.status}) from ${original.stripe_payment_intent_id}${reason ? ` — ${reason}` : ""}`,
    }).eq("id", inserted.id);
    if (!done) return { ok: false, error: `Stripe did not accept the return (${refund.status}).`, newKey: true };
    return {
      ok: true,
      message: refund.status === "pending" ? "Stripe accepted the refund. It is pending at the bank." : `Stripe refunded the customer${original.method === "Cash App" ? " (Cash App)" : "'s card"}.`,
      receipt: { amountCents: refund.amount, refundId: refund.id, status: refund.status, paymentIntentId: original.stripe_payment_intent_id },
    };
  } catch (error) { return fail(error); }
}
