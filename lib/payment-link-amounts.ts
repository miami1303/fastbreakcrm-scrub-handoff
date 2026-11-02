// Payment Link amounts (pure, client + server safe). The rep should not have to count:
// the CRM offers the deposit (until a deposit is paid) and the balance due as one-click amounts.
export type LinkChoice = { key: "deposit" | "balance"; label: string; cents: number; isDeposit: boolean };
export type LinkPayment = { amount: number | string | null; is_deposit?: boolean | null; voided_at?: string | null; charge_status?: string | null };

const cents = (v: number | string | null | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const paidStatus = (s: string | null | undefined) => !s || ["recorded", "logged_manual", "succeeded", "bookkeeping_adjustment"].includes(s);

/** Stripe minimum (matches lib/payments/decide.ts MIN_STRIPE_CENTS). */
export const LINK_MIN_CENTS = 50;

export function paymentLinkChoices(o: { totalAmount: number | string | null | undefined; depositAmount: number | string | null | undefined; payments: LinkPayment[] }): LinkChoice[] {
  const live = o.payments.filter(p => !p.voided_at && paidStatus(p.charge_status));
  const paidC = live.reduce((s, p) => s + cents(p.amount), 0);
  const depositPaid = live.some(p => p.is_deposit && cents(p.amount) > 0);
  const totalC = cents(o.totalAmount);
  const depositC = cents(o.depositAmount);
  const balanceC = totalC - paidC;
  const out: LinkChoice[] = [];
  if (!depositPaid && depositC >= LINK_MIN_CENTS && depositC <= balanceC) out.push({ key: "deposit", label: "Deposit", cents: depositC, isDeposit: true });
  if (balanceC >= LINK_MIN_CENTS && !(out[0] && out[0].cents === balanceC)) out.push({ key: "balance", label: "Balance", cents: balanceC, isDeposit: false });
  return out;
}

export const centsLabel = (c: number) => `$${(c / 100).toFixed(2)}`;
export const centsInput = (c: number) => (c / 100).toFixed(2);
