// The old provider hook does not charge cards.
// Real Stripe charges go through lib/payments/stripe-gateway.ts, and only when
// STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY are both set and are
// both test or both live. PAYMENTS_PROVIDER is not used and does not turn charging on.
// While those keys are missing, Update Payment only writes the ledger (encrypted card
// numbers on the old path). It never calls Stripe.

export type ChargeRequest = { estimateId: string; amount: number; description: string };
export type ChargeResult = { ok: true; reference: string } | { ok: false; error: string };

export interface PaymentProvider {
  id: "manual" | "stripe";
  label: string;
  collectsCardInCrm: boolean;
  /**
   * True only when createCharge actually moves money. The stub stays false, so
   * Auto-charge stays off and labeled "turns on when Stripe is connected".
   * Set this to true in the same change that implements a real Stripe charge.
   */
  ready: boolean;
  createCharge?(req: ChargeRequest): Promise<ChargeResult>;
}

const manual: PaymentProvider = { id: "manual", label: "Manual (run card through merchant)", collectsCardInCrm: true, ready: false };

/** Always the ledger. Never a live Stripe client. */
export function activePaymentProvider(): PaymentProvider {
  return manual;
}

/** Hard refusal. Kept so an old caller cannot move money through this file. */
export async function createCharge(): Promise<ChargeResult> {
  return {
    ok: false,
    error: "This path does not charge cards. Nothing was charged.",
  };
}

/** Auto-charge may run only when the active provider is Stripe and that charge is real. */
export function stripeConnected(): boolean {
  const p = activePaymentProvider();
  return p.id === "stripe" && p.ready === true;
}
