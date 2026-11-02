// Auto-charge (Owner). A lead-level switch, not a payment method.
// While Stripe is not connected the switch stays off. When it is connected and the
// switch is on, the saved card is charged once after BOTH e-signs (contract and CC form).
// No card on file, or nothing left to charge: a message, and no charge. A second run
// does not charge again.

export type AutoChargeInput = {
  enabled: boolean;
  stripeConnected: boolean;
  hasCard: boolean;
  bothSigned: boolean;
  alreadyCharged: boolean;
  /** Cents still to charge. 0 means the deposit is already covered or the balance is 0. */
  amountCents: number;
};

export type AutoChargeDecision =
  | { action: "skip"; reason: "stripe" | "off" | "already" | "waiting" }
  | { action: "message"; message: string }
  | { action: "charge"; amountCents: number };

export const NO_CARD_MESSAGE = "No card on file. No charge was made.";
export const NOTHING_DUE_MESSAGE = "Nothing left to charge. No charge was made.";
export const STRIPE_HINT = "turns on when Stripe is connected";

/**
 * What to do once both documents may have been signed.
 * Stripe off, switch off, already charged, or still waiting: do nothing.
 * No card, or a zero amount: tell staff, and do not charge.
 */
export function autoChargeDecision(i: AutoChargeInput): AutoChargeDecision {
  if (!i.stripeConnected) return { action: "skip", reason: "stripe" };
  if (!i.enabled) return { action: "skip", reason: "off" };
  if (i.alreadyCharged) return { action: "skip", reason: "already" };
  if (!i.bothSigned) return { action: "skip", reason: "waiting" };
  if (!i.hasCard) return { action: "message", message: NO_CARD_MESSAGE };
  if (i.amountCents <= 0) return { action: "message", message: NOTHING_DUE_MESSAGE };
  return { action: "charge", amountCents: i.amountCents };
}

/**
 * Turning the switch on. Stripe must be connected and a card must be on file.
 * Turning it off is always allowed. This does not charge by itself.
 */
export function armAutoCharge(i: { stripeConnected: boolean; hasCard: boolean; wantOn: boolean }): { ok: true; on: boolean } | { ok: false; error: string } {
  if (!i.wantOn) return { ok: true, on: false };
  if (!i.stripeConnected) return { ok: false, error: `Auto-charge ${STRIPE_HINT}.` };
  if (!i.hasCard) return { ok: false, error: NO_CARD_MESSAGE };
  return { ok: true, on: true };
}

/**
 * Cents to charge: the quoted deposit that is not already paid, and never more than
 * the balance still due. With no deposit, the balance. Already paid in full → 0.
 */
export function autoChargeAmountCents(i: { depositCents: number; totalCents: number; paidCents: number }): number {
  const balance = i.totalCents - i.paidCents;
  if (balance <= 0) return 0;
  const deposit = Math.max(i.depositCents, 0);
  if (deposit > 0) return Math.min(Math.max(deposit - Math.max(i.paidCents, 0), 0), balance);
  return balance;
}
