/**
 * Payment rules. This file does not call Stripe or the database.
 *
 * Both e-signs: the customer e-sign page (app/d/[token], signDocument) writes a
 * "signed" event on the contract email (crm_emails.kind = booked_esign) and on
 * the credit card form email (kind = cc_form). Auto-charge may charge only when
 * BOTH of those signatures exist. This file does not sign anything.
 *
 * A negative amount is a bookkeeping correction only. It never charges, refunds,
 * or moves money. There is no refund action in this build.
 */

export const STAFF_PAYMENT_METHODS = ["Credit Card", "Zelle", "Cash App", "PayPal"] as const;
export type StaffPaymentMethod = (typeof STAFF_PAYMENT_METHODS)[number];

/** Fat-finger guard for a Stripe charge or payment link. $100,000.00 */
export const MAX_CHARGE_CENTS = 10_000_000;
/** Stripe's minimum card charge in USD cents. */
export const MIN_STRIPE_CENTS = 50;

export type StripeMode = "missing" | "test" | "live" | "mismatch";

export type StripeReadiness = {
  connected: boolean;
  mode: StripeMode;
  /** Publishable key only. Never the secret. Null unless a charge is allowed. */
  publishableKey: string | null;
  message: string;
};

export type CardSnapshot = {
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function detectStripeMode(secret: string | null | undefined, publishable: string | null | undefined): StripeReadiness {
  const sk = (secret ?? "").trim();
  const pk = (publishable ?? "").trim();
  const skMode = sk.startsWith("sk_test_") ? "test" : sk.startsWith("sk_live_") ? "live" : null;
  const pkMode = pk.startsWith("pk_test_") ? "test" : pk.startsWith("pk_live_") ? "live" : null;
  if (!skMode || !pkMode) {
    return {
      connected: false,
      mode: "missing",
      publishableKey: null,
      message: "Stripe is not connected yet. Nothing is charged through Stripe. Zelle, Cash App, and PayPal can still be logged by hand.",
    };
  }
  if (skMode !== pkMode) {
    return {
      connected: false,
      mode: "mismatch",
      publishableKey: null,
      message: "The Stripe secret key and publishable key are not both test or both live. Charges are turned off until they match. Nothing was charged.",
    };
  }
  if (skMode === "test") {
    return {
      connected: true,
      mode: "test",
      publishableKey: pk,
      message: "Stripe TEST mode. Use a Stripe test card only. No real money moves.",
    };
  }
  return {
    connected: true,
    mode: "live",
    publishableKey: pk,
    message: "Stripe LIVE mode. Charging a card moves real money.",
  };
}

export function webhookSecretConfigured(secret: string | null | undefined): boolean {
  return (secret ?? "").trim().startsWith("whsec_");
}

export function scrubSecrets(message: string): string {
  return message
    .replace(/sk_(live|test)_[A-Za-z0-9]+/g, "[secret]")
    .replace(/pk_(live|test)_[A-Za-z0-9]+/g, "[publishable]")
    .replace(/whsec_[A-Za-z0-9]+/g, "[webhook]")
    .replace(/rk_(live|test)_[A-Za-z0-9]+/g, "[secret]");
}

/** Legacy rows (no status) still count. Unconfirmed Stripe rows do not. */
export function countsAsPaid(chargeStatus: string | null | undefined): boolean {
  if (!chargeStatus) return true;
  return chargeStatus === "recorded" || chargeStatus === "logged_manual" || chargeStatus === "succeeded" || chargeStatus === "bookkeeping_adjustment";
}

export function bothEsignsComplete(input: { contractSigned: boolean; ccFormSigned: boolean }): boolean {
  return input.contractSigned === true && input.ccFormSigned === true;
}

/**
 * The existing "Update Payment" button. It only writes the ledger.
 * It never returns a charge. Card numbers stay on the old encrypted path only
 * while Stripe is not connected. A negative amount never stores a new card number.
 */
export type LegacyLedger =
  | { action: "bookkeeping"; movesMoney: false }
  | { action: "log_manual"; movesMoney: false }
  | { action: "legacy_card_record"; movesMoney: false }
  | { action: "reject"; message: string; movesMoney: false };

export function legacyLedgerKind(input: { method: string; amountCents: number; stripeConnected: boolean }): LegacyLedger {
  if (!Number.isInteger(input.amountCents) || input.amountCents === 0) {
    return { action: "reject", movesMoney: false, message: "Enter an amount other than zero. A negative amount only corrects the books and does not charge or refund anyone." };
  }
  if (input.amountCents < 0) return { action: "bookkeeping", movesMoney: false };
  // Owner 2026-10-31: a payment amount can be entered with no payment method (ledger only).
  if (!input.method.trim() || input.method === "Not specified") return { action: "log_manual", movesMoney: false };
  if (input.method === "Credit Card") {
    // FB400009 (Owner 2026-10-31): with Stripe live, a Credit Card amount typed in Payment Info
    // (card run on the merchant terminal / by phone) was refused, so the deposit never reached the
    // books or the customer side. Record the amount as a ledger entry. The card number is still
    // never stored while Stripe is connected (addPayment refuses card digits), and nothing is charged.
    if (input.stripeConnected) return { action: "log_manual", movesMoney: false };
    return { action: "legacy_card_record", movesMoney: false };
  }
  if (input.method === "Zelle" || input.method === "Cash App" || input.method === "PayPal") {
    return { action: "log_manual", movesMoney: false };
  }
  return { action: "reject", movesMoney: false, message: "Choose Credit Card, Zelle, Cash App, or PayPal." };
}

export type ExistingCharge = { status: string; stripePaymentIntentId: string | null } | null;

export type ChargeDecision =
  | { action: "reject"; reason: string; message: string; movesMoney: false }
  | { action: "duplicate"; message: string; movesMoney: false }
  | { action: "save_card_for_later"; amountCents: number; needsSetup: boolean; movesMoney: false }
  | { action: "charge_saved"; amountCents: number; movesMoney: true }
  | { action: "charge_new_card"; amountCents: number; movesMoney: true }
  | { action: "payment_link"; amountCents: number; movesMoney: false };

export type DecideInput = {
  amountCents: number;
  autoCharge: boolean;
  bothEsignsComplete: boolean;
  stripeConnected: boolean;
  savedPaymentMethod: boolean;
  purpose: "card" | "payment_link";
  idempotencyKey: string | null;
  existingCharge: ExistingCharge;
};

function reject(reason: string, message: string): ChargeDecision {
  return { action: "reject", reason, message, movesMoney: false };
}

/** What the Stripe buttons are allowed to do. Manual Zelle/Cash App/PayPal never come through here. */
export function decidePayment(input: DecideInput): ChargeDecision {
  if (!Number.isInteger(input.amountCents) || input.amountCents === 0) {
    return reject("invalid_amount", "Enter an amount other than zero. A negative amount does not move money.");
  }
  if (input.amountCents < 0) {
    return reject("negative_amount", "A negative amount only corrects the books. It does not charge, refund, or create a payment link.");
  }
  if (input.amountCents < MIN_STRIPE_CENTS) {
    return reject("amount_too_small", "Stripe needs at least $0.50. Nothing was charged.");
  }
  if (input.amountCents > MAX_CHARGE_CENTS) {
    return reject("amount_too_large", "Amount must be $100,000.00 or less. Nothing was charged.");
  }
  if (!input.idempotencyKey || !isUuid(input.idempotencyKey)) {
    return reject("missing_idempotency", "This was stopped because its safety key was missing. Nothing was charged.");
  }
  if (!input.stripeConnected) {
    return reject("stripe_not_connected", "Stripe is not connected yet. Nothing was charged and no payment link was created.");
  }
  if (input.purpose === "payment_link") {
    return { action: "payment_link", amountCents: input.amountCents, movesMoney: false };
  }
  if (input.existingCharge) {
    const status = input.existingCharge.status;
    if (status === "auto_charge_waiting" && input.autoCharge && !input.bothEsignsComplete) {
      return { action: "duplicate", movesMoney: false, message: "This card is already waiting for both e-signs. Nothing was charged." };
    }
    if (status !== "auto_charge_waiting") {
      if (status === "failed") {
        return { action: "duplicate", movesMoney: false, message: "This attempt already failed. Start again if you still want to try. Nothing was charged again." };
      }
      return { action: "duplicate", movesMoney: false, message: "This payment is already recorded. It was not charged again." };
    }
  }
  if (input.autoCharge && !input.bothEsignsComplete) {
    return { action: "save_card_for_later", amountCents: input.amountCents, needsSetup: !input.savedPaymentMethod, movesMoney: false };
  }
  if (!input.savedPaymentMethod) return { action: "charge_new_card", amountCents: input.amountCents, movesMoney: true };
  return { action: "charge_saved", amountCents: input.amountCents, movesMoney: true };
}

export function stripeCallFor(decision: ChargeDecision): "none" | "payment_intent" | "setup_intent" | "checkout" {
  switch (decision.action) {
    case "charge_saved":
    case "charge_new_card":
      return "payment_intent";
    case "save_card_for_later":
      return decision.needsSetup ? "setup_intent" : "none";
    case "payment_link":
      return "checkout";
    default:
      return "none";
  }
}

export function assertSafeToCallStripe(decision: ChargeDecision, stripeConnected: boolean): { ok: true } | { ok: false; message: string } {
  const call = stripeCallFor(decision);
  if (call === "none") return { ok: true };
  if (!stripeConnected) return { ok: false, message: "Stripe is not connected. No charge was made." };
  if ("amountCents" in decision && decision.amountCents <= 0) {
    return { ok: false, message: "Refusing to charge a zero or negative amount. No money was moved." };
  }
  return { ok: true };
}

/** The only wrapper that may invoke a Stripe call. `call` is not run when the gate says no. */
export async function runWithStripeGuard<T>(
  decision: ChargeDecision,
  stripeConnected: boolean,
  call: () => Promise<T>,
): Promise<{ called: false; blocked?: string } | { called: true; result: T }> {
  const gate = assertSafeToCallStripe(decision, stripeConnected);
  if (!gate.ok) return { called: false, blocked: gate.message };
  if (stripeCallFor(decision) === "none") return { called: false };
  return { called: true, result: await call() };
}

export function safeLast4(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}$/.test(value) ? value : null;
}

export function safeExpPart(value: unknown, max: number): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d{1,4}$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(number) || number < 1 || number > max) return null;
  return number;
}

export function displayBrand(brand: string | null | undefined): string {
  const key = (brand ?? "").trim().toLowerCase();
  const known: Record<string, string> = {
    visa: "Visa", mastercard: "Mastercard", amex: "Amex", american_express: "Amex",
    discover: "Discover", diners: "Diners", diners_club: "Diners", jcb: "JCB", unionpay: "UnionPay",
  };
  return known[key] || (key ? "Card" : "Card");
}

export function formatExpiration(month: number | null, year: number | null): string {
  if (!month || !year) return "";
  return `${String(month).padStart(2, "0")}/${year}`;
}

export function normalizeName(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function phoneDigits(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export type CustomerIdentity = { displayName: string; email: string | null; phone: string | null };

export function matchReasons(lead: CustomerIdentity, customer: CustomerIdentity): Array<"name" | "email" | "phone"> {
  const reasons: Array<"name" | "email" | "phone"> = [];
  const leadName = normalizeName(lead.displayName);
  const customerName = normalizeName(customer.displayName);
  if (leadName && leadName === customerName) reasons.push("name");
  const leadEmail = normalizeEmail(lead.email);
  const customerEmail = normalizeEmail(customer.email);
  if (leadEmail && leadEmail === customerEmail) reasons.push("email");
  const leadPhone = phoneDigits(lead.phone);
  const customerPhone = phoneDigits(customer.phone);
  if (leadPhone.length >= 10 && leadPhone === customerPhone) reasons.push("phone");
  return reasons;
}

export function classifyCustomerMatches<T extends CustomerIdentity>(lead: CustomerIdentity, customers: T[]): { kind: "none" | "one" | "many"; matches: T[] } {
  const matches = customers.filter((customer) => matchReasons(lead, customer).length > 0);
  if (matches.length === 0) return { kind: "none", matches };
  if (matches.length === 1) return { kind: "one", matches };
  return { kind: "many", matches };
}

export function isSchemaMiss(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const message = error.message || "";
  return error.code === "42703" || error.code === "42P01" || error.code === "PGRST204" || error.code === "PGRST205"
    || /schema cache|does not exist|could not find the/i.test(message);
}

export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function isOnlineBooking(leadSource: string | null | undefined): boolean {
  const value = leadSource ?? "";
  return value === "Web Lead" || /online|website/i.test(value);
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" ? (value as UnknownRecord) : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function metadataString(object: UnknownRecord, key: string): string | null {
  const metadata = asRecord(object.metadata);
  return metadata ? readString(metadata[key]) : null;
}

export function cardSnapshotFromUnknown(value: unknown): CardSnapshot | null {
  const record = asRecord(value);
  if (!record) return null;
  const details = asRecord(record.payment_method_details);
  const card = asRecord(record.card) ?? (details ? asRecord(details.card) : null);
  if (!card) {
    const charge = asRecord(record.latest_charge);
    return charge ? cardSnapshotFromUnknown(charge) : null;
  }
  const last4 = safeLast4(card.last4);
  const brand = readString(card.brand);
  if (!last4 && !brand) return null;
  return { brand, last4, expMonth: safeExpPart(card.exp_month, 12), expYear: safeExpPart(card.exp_year, 9999) };
}

export type WebhookEffect =
  | { kind: "ignore"; reason: string }
  | { kind: "dispute"; disputeId: string; paymentIntentId: string | null; chargeId: string | null; status: string; reason: string; amountCents: number; created: boolean }
  | {
      kind: "payment_intent";
      paymentIntentId: string;
      estimateId: string;
      crmPaymentId: string | null;
      amountCents: number;
      succeeded: boolean;
      card: CardSnapshot | null;
    }
  | {
      kind: "checkout_paid";
      sessionId: string;
      paymentIntentId: string | null;
      estimateId: string;
      customerId: string | null;
      amountCents: number;
      card: CardSnapshot | null;
    }
  | {
      kind: "setup_succeeded";
      setupIntentId: string;
      paymentMethodId: string | null;
      estimateId: string;
      customerId: string | null;
      idempotencyKey: string | null;
      amountCents: number | null;
      card: CardSnapshot | null;
    };

/** Already-verified events only. Refunds, unpaid checkouts, and non-positive amounts are ignored. */
export function interpretStripeEvent(event: { type?: string; data?: { object?: unknown } }): WebhookEffect {
  const type = event.type ?? "";
  if (type.startsWith("refund.") || type === "charge.refunded" || type === "charge.refund.updated") {
    return { kind: "ignore", reason: "refunds_are_done_in_stripe" };
  }
  const object = asRecord(event.data?.object);
  if (!object) return { kind: "ignore", reason: "missing_object" };

  // Chargebacks / disputes: tracked on the lead (red Chargeback pill + ATTN email). Never moves money.
  if (type.startsWith("charge.dispute.")) {
    const disputeId = readString(object.id);
    if (!disputeId) return { kind: "ignore", reason: "missing_dispute_id" };
    const amount = typeof object.amount === "number" ? object.amount : 0;
    return {
      kind: "dispute", disputeId,
      paymentIntentId: readString(object.payment_intent) ?? null,
      chargeId: readString(object.charge) ?? null,
      status: readString(object.status) ?? (type === "charge.dispute.closed" ? "closed" : "needs_response"),
      reason: readString(object.reason) ?? "",
      amountCents: amount,
      created: type === "charge.dispute.created",
    };
  }

  if (type === "payment_intent.succeeded" || type === "payment_intent.payment_failed") {
    const paymentIntentId = readString(object.id);
    const estimateId = metadataString(object, "estimate_id");
    const amount = object.amount;
    const currency = readString(object.currency)?.toLowerCase() ?? "";
    if (!paymentIntentId || !isUuid(estimateId)) return { kind: "ignore", reason: "missing_payment_context" };
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0 || currency !== "usd") {
      return { kind: "ignore", reason: "amount_not_a_positive_usd_charge" };
    }
    const crmPaymentId = metadataString(object, "crm_payment_id");
    return {
      kind: "payment_intent",
      paymentIntentId,
      estimateId: estimateId as string,
      crmPaymentId: isUuid(crmPaymentId) ? crmPaymentId : null,
      amountCents: amount,
      succeeded: type === "payment_intent.succeeded",
      card: cardSnapshotFromUnknown(object),
    };
  }

  if (type === "checkout.session.completed") {
    if (object.payment_status !== "paid") return { kind: "ignore", reason: "checkout_not_paid" };
    const sessionId = readString(object.id);
    const estimateId = metadataString(object, "estimate_id");
    const amount = object.amount_total;
    const currency = readString(object.currency)?.toLowerCase() ?? "";
    if (!sessionId || !isUuid(estimateId)) return { kind: "ignore", reason: "missing_payment_context" };
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0 || currency !== "usd") {
      return { kind: "ignore", reason: "amount_not_a_positive_usd_charge" };
    }
    const paymentIntent = object.payment_intent;
    const paymentIntentId = typeof paymentIntent === "string" ? paymentIntent : readString(asRecord(paymentIntent)?.id);
    const customerId = metadataString(object, "customer_id");
    return {
      kind: "checkout_paid",
      sessionId,
      paymentIntentId,
      estimateId: estimateId as string,
      customerId: isUuid(customerId) ? customerId : null,
      amountCents: amount,
      card: cardSnapshotFromUnknown(object),
    };
  }

  if (type === "setup_intent.succeeded") {
    const setupIntentId = readString(object.id);
    const estimateId = metadataString(object, "estimate_id");
    if (!setupIntentId || !isUuid(estimateId)) return { kind: "ignore", reason: "missing_payment_context" };
    const paymentMethod = object.payment_method;
    const paymentMethodId = typeof paymentMethod === "string" ? paymentMethod : readString(asRecord(paymentMethod)?.id);
    const customerId = metadataString(object, "customer_id");
    const idempotencyKey = metadataString(object, "idempotency_key");
    const amountRaw = metadataString(object, "amount_cents");
    const amountCents = amountRaw && /^\d+$/.test(amountRaw) ? Number(amountRaw) : null;
    return {
      kind: "setup_succeeded",
      setupIntentId,
      paymentMethodId,
      estimateId: estimateId as string,
      customerId: isUuid(customerId) ? customerId : null,
      idempotencyKey: isUuid(idempotencyKey) ? idempotencyKey : null,
      amountCents: amountCents && amountCents > 0 ? amountCents : null,
      card: cardSnapshotFromUnknown(paymentMethod) ?? cardSnapshotFromUnknown(object),
    };
  }

  return { kind: "ignore", reason: "unhandled_event" };
}
