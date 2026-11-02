// Return to customer / Return to carrier (Owner, 2026-10-31). Pure helpers, client + server safe.
//
// On the Payments tab two checkboxes sit next to Payment Deposit: "Return to customer" and
// "Return to carrier". When either is checked, Charge Now / Hold (auto-charge) / Update Payment
// turn red and become Refund Now, so the same Amount sends money OUT instead of charging.
//   Return to customer: back to the customer's card (or Cash App Pay) through Stripe, from one
//     Stripe-confirmed charge on this job. Comes off Customer Payments.
//   Return to carrier, Zelle: direct from Fast Break's bank. Stripe never touches Zelle and a
//     normal business bank account has no Zelle API, so Refund Now queues it ASAP ("Zelle to send")
//     with the carrier's Zelle, amount and memo; the office sends it in the bank app and marks it sent
//     with the Zelle confirmation number. (Bank of America CashPro can disburse Zelle by API for
//     CashPro clients; see docs/returns-and-zelle.md.)
//   Return to carrier, Cash App: through Stripe. A Stripe Connect transfer to the carrier's connected
//     account (acct_...), which pays out to their bank or Cash App debit card.
// Return to carrier has two modes (toggle next to the checkbox):
//   "deposit" -> sent now (Zelle / Cash App above), comes out of Fast Break's deposit.
//   "cod"     -> added to the carrier COD so the car gets picked up without taking from the deposit.
//                Nothing is sent now; it is recorded so accounting shows COD to carrier + the add.
// Neither carrier mode changes Customer Payments. Refunds and carrier returns always stay visible in
// accounting (Payment Records + the summary strip), whether refunded, sent, queued, or added to COD.

export type ReturnMode = "none" | "customer" | "carrier";
export const CARRIER_PAYOUT_METHODS = ["Zelle", "Cash App"] as const;
export type CarrierPayoutMethod = (typeof CARRIER_PAYOUT_METHODS)[number];

/** Only one return at a time; checking one clears the other (and the deposit box). */
export function nextReturnMode(current: ReturnMode, clicked: "customer" | "carrier", checked: boolean): ReturnMode {
  if (checked) return clicked;
  return current === clicked ? "none" : current;
}

/** Labels for the main buttons. Red + Refund Now whenever a return box is checked. */
export function actionButtons(mode: ReturnMode, o: { cardLabel?: string | null; carrierMethod?: string; carrierSource?: string } = {}) {
  if (mode === "customer") {
    const label = o.cardLabel ? `Refund Now · ${o.cardLabel}` : "Refund Now";
    return { refund: true, chargeLabel: label, saveLabel: "Refund Now", className: "btn btn-refund-now" };
  }
  if (mode === "carrier" && o.carrierSource === "cod") {
    return { refund: true, chargeLabel: "Refund Now · add to carrier COD", saveLabel: "Refund Now", className: "btn btn-refund-now" };
  }
  if (mode === "carrier") {
    const via = o.carrierMethod === "Cash App" ? "Cash App (Stripe)" : "Zelle";
    return { refund: true, chargeLabel: `Refund Now · ${via} to carrier (from deposit)`, saveLabel: "Refund Now", className: "btn btn-refund-now" };
  }
  return { refund: false, chargeLabel: o.cardLabel ? `Charge Now · ${o.cardLabel}` : "Charge Now", saveLabel: "Update Payment", className: "btn btn-charge-now" };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Zelle sends to an email or a US mobile number. Returns the cleaned value or null. */
export function cleanZelleRecipient(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (EMAIL.test(v)) return v.toLowerCase().slice(0, 160);
  const digits = v.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return null;
}

/** A Stripe Connect account id for a carrier paid by Cash App through Stripe. */
export function cleanStripeAccount(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  return /^acct_[A-Za-z0-9]{8,64}$/.test(v) ? v : null;
}

/** Memo the office types into the bank's Zelle screen (and Stripe transfer description). */
export function carrierMemo(jobNumber: string | null | undefined, carrierName?: string | null): string {
  return `Fast Break job ${jobNumber || "—"} carrier refund${carrierName ? ` (${carrierName})` : ""}`.slice(0, 120);
}

export type CarrierSource = "deposit" | "cod";
export type CarrierPayoutRow = { status: string; amount: number | string | null; source?: string | null };

/** Zelle rows still waiting to be sent in the bank app. */
export function zelleToSend<T extends CarrierPayoutRow>(rows: T[]): T[] {
  return rows.filter(r => r.status === "zelle_to_send");
}

export function carrierStatusLabel(status: string, method: string): string {
  switch (status) {
    case "zelle_to_send": return "Zelle to send ASAP";
    case "processing": return method === "Cash App" ? "Stripe transfer processing" : "Processing";
    case "sent": return method === "Zelle" ? "Zelle sent" : "Sent through Stripe";
    case "failed": return "Failed — nothing sent";
    case "cancelled": return "Cancelled — nothing sent";
    case "added_to_cod": return "Added to carrier COD";
    default: return status;
  }
}

const live = (r: CarrierPayoutRow) => r.status !== "failed" && r.status !== "cancelled";
const c = (v: number | string | null) => Math.round((Number(v) || 0) * 100);

/** Returned to the carrier out of the deposit (sent or queued). Failed / cancelled rows do not count. */
export function carrierReturnedCents(rows: CarrierPayoutRow[]): number {
  return rows.filter(r => live(r) && (r.source || "deposit") === "deposit").reduce((s, r) => s + c(r.amount), 0);
}

/** Added to the carrier COD (not taken from the deposit). */
export function carrierCodAddedCents(rows: CarrierPayoutRow[]): number {
  return rows.filter(r => live(r) && r.source === "cod").reduce((s, r) => s + c(r.amount), 0);
}

export type LedgerLine = { amount: number | string | null; charge_status?: string | null; voided_at?: string | null; is_deposit?: boolean | null; confirmation_no?: string | null; remark?: string | null };
const paid = (s: string | null | undefined) => !s || s === "recorded" || s === "logged_manual" || s === "succeeded" || s === "bookkeeping_adjustment";

/** A Stripe refund to the customer (negative row written by Refund Now / Return to customer). */
export function isCustomerRefund(row: LedgerLine): boolean {
  return c(row.amount) < 0 && (/^re_/.test(row.confirmation_no || "") || /^Return to customer/i.test(row.remark || ""));
}

/**
 * Accounting strip. Refunds are shown AND applied: Customer Payments is net of refunds, and the refund
 * total is listed on its own. Carrier returns never touch Customer Payments.
 *   Deposit paid = all deposit rows, net (negative deposit corrections / deposit refunds included).
 *   Deposit kept = deposit paid - returned to carrier from deposit.
 *   Carrier COD  = quoted COD (incl. Additional charges the carrier collects) + amounts added to COD.
 *   Balance      = Total - Customer Payments (net of refunds).
 */
export function accountingSummary(o: { payments: LedgerLine[]; carrier: CarrierPayoutRow[]; totalAmount: number | string | null | undefined; codAmount: number | string | null | undefined }) {
  const rows = o.payments.filter(r => !r.voided_at && paid(r.charge_status));
  const customerPaidC = rows.reduce((s, r) => s + c(r.amount), 0);
  const refundedC = -rows.filter(isCustomerRefund).reduce((s, r) => s + c(r.amount), 0);
  // Math audit 2026-10-31: deposit rows net of deposit corrections / refunds of a deposit charge
  // (negative deposit rows). Before, only positive rows counted, so a refunded deposit still
  // showed as "Deposit paid" and "Deposit kept".
  const depositPaidC = rows.filter(r => r.is_deposit).reduce((s, r) => s + c(r.amount), 0);
  const carrierFromDepositC = carrierReturnedCents(o.carrier);
  const codAddedC = carrierCodAddedCents(o.carrier);
  const totalC = c(o.totalAmount ?? 0);
  return {
    totalC, customerPaidC, refundedC, depositPaidC, carrierFromDepositC,
    depositKeptC: depositPaidC - carrierFromDepositC,
    codAddedC, carrierCodC: c(o.codAmount ?? 0) + codAddedC,
    balanceC: totalC - customerPaidC,
  };
}
