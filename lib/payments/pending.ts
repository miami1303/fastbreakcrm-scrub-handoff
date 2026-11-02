// Pending payments (Owner 2026-10-31, test lead FB400012): a payment "put in" but not charged yet
// must still show in Payment Records, the Payments summary and the customer document, without
// ever counting as money received. Pure helper, client + server safe.
//   Pending rows  = non-void ledger rows still waiting on Stripe (pending / processing /
//                   auto_charge_waiting) with a positive amount.
//   Card on file  = no pending row, a saved card on this customer, and the deposit due is not paid
//                   yet -> the unpaid deposit is pending on that card (nothing charged).
// Customer Payments / Deposit paid never include pending money; Balance after pending does.

export const PENDING_STATUSES = ["pending", "processing", "auto_charge_waiting"] as const;
const cents = (v: unknown) => Math.round((Number(v) || 0) * 100);

export type PendingRow = { amount: number | string | null; charge_status?: string | null; voided_at?: string | null; card_last4?: string | null; is_deposit?: boolean | null };
export type PendingCard = { brand?: string | null; last4?: string | null };
export type PendingLine = { source: "row" | "card"; amountC: number; label: string; isDeposit: boolean };

export function isPendingRow(r: PendingRow): boolean {
  return !r.voided_at && cents(r.amount) > 0 && (PENDING_STATUSES as readonly string[]).includes(r.charge_status || "");
}

export function pendingPayments(o: {
  payments: PendingRow[]; cards?: PendingCard[] | null;
  depositDue: number | string | null | undefined; depositPaidC: number;
  totalAmount: number | string | null | undefined; customerPaidC: number;
}): { pendingC: number; lines: PendingLine[]; balanceAfterC: number } {
  const lines: PendingLine[] = o.payments.filter(isPendingRow).map(r => ({
    source: "row", amountC: cents(r.amount), isDeposit: !!r.is_deposit,
    label: `${r.charge_status === "auto_charge_waiting" ? "Held until e-signs" : "Waiting on Stripe"}${r.card_last4 ? ` · ••••${r.card_last4}` : ""}`,
  }));
  const card = (o.cards || [])[0];
  const depositLeftC = cents(o.depositDue) - o.depositPaidC;
  if (lines.length === 0 && card?.last4 && depositLeftC > 0) {
    lines.push({ source: "card", amountC: depositLeftC, isDeposit: true, label: `Deposit on ${card.brand ? `${card.brand} ` : ""}••••${card.last4} · not charged yet` });
  }
  const pendingC = lines.reduce((s, l) => s + l.amountC, 0);
  return { pendingC, lines, balanceAfterC: cents(o.totalAmount) - o.customerPaidC - pendingC };
}
