// Payment methods. Fast Break demo: no built-in processor or payee accounts are configured.
// Stripe methods appear only when STRIPE_* env keys are set; Zelle appears only when PAY_ZELLE is set.
export const DEFAULT_ZELLE = "";
export const DEFAULT_STRIPE_LINK_METHODS = ["card", "cashapp", "paypal", "link"] as const;
const KNOWN: Record<string, string> = {
  card: "Credit / debit card (Apple Pay, Google Pay)",
  cashapp: "Cash App Pay",
  paypal: "PayPal",
  link: "Link",
  us_bank_account: "Bank account (ACH)",
  affirm: "Affirm",
  klarna: "Klarna",
  amazon_pay: "Amazon Pay",
};
/** Stripe payment method types this CRM passes as allowed_payment_method_types (card always first). */
export function stripeLinkMethods(env: Record<string, string | undefined> = process.env): string[] {
  const raw = (env.STRIPE_LINK_METHODS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  // Zelle never goes through Stripe (direct to the company), even if someone lists it here.
  const list = (raw.length ? raw : [...DEFAULT_STRIPE_LINK_METHODS]).filter(m => m in KNOWN && m !== "zelle");
  return ["card", ...list.filter(m => m !== "card")];
}

export type MethodLine = { method: string; via: "stripe" | "direct"; detail: string | null };

/** Lines for the customer email and the CRM box. */
export function paymentMethodLines(env: Record<string, string | undefined> = process.env): MethodLine[] {
  const stripeOn = Boolean((env.STRIPE_SECRET_KEY || "").trim());
  const stripe = stripeOn ? stripeLinkMethods(env).map(m => ({ method: KNOWN[m], via: "stripe" as const, detail: "secure Stripe link" })) : [];
  const zelle = (env.PAY_ZELLE || "").trim().slice(0, 120) || DEFAULT_ZELLE;
  return zelle ? [...stripe, { method: "Zelle", via: "direct" as const, detail: `send to ${zelle} (direct to the company)` }] : stripe;
}

/** The Zelle address customers send to (direct to the company). */
export function zelleAddress(env: Record<string, string | undefined> = process.env): string {
  return (env.PAY_ZELLE || "").trim().slice(0, 120) || DEFAULT_ZELLE;
}
