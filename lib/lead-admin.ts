// Lead Admin tab (pure helpers, client + server safe). There is NO separate discount field in the
// CRM (no coupon / senior discount by design). "Discount" here is read from data that already
// exists: price reductions in estimate_price_history (new total lower than the old total) and
// money returned to the customer (negative, non-void payment rows from Return to Customer).
export type PriceChange = { created_at: string; changed_by_name: string | null; old_total: number | string | null; new_total: number | string | null; old_deposit?: number | string | null; new_deposit?: number | string | null };
export type PaymentRow = { id: string; created_at: string; created_by_name?: string | null; amount: number | string | null; method?: string | null; remark?: string | null; voided_at?: string | null; voided_by?: string | null };

const cents = (v: number | string | null | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

export type Reduction = { at: string; by: string; fromCents: number; toCents: number; offCents: number };

/** Every time the total was lowered (newest first), and the sum of those reductions. */
export function priceReductions(history: PriceChange[]): { rows: Reduction[]; totalOffCents: number } {
  const rows = history.flatMap(h => {
    const from = cents(h.old_total), to = cents(h.new_total);
    return from !== null && to !== null && to < from
      ? [{ at: h.created_at, by: h.changed_by_name || "", fromCents: from, toCents: to, offCents: from - to }]
      : [];
  }).sort((a, b) => b.at.localeCompare(a.at));
  return { rows, totalOffCents: rows.reduce((s, r) => s + r.offCents, 0) };
}

/** First recorded total (before any change) vs. the current total. null when there is no history. */
export function netPriceChange(history: PriceChange[], currentTotal: number | string | null | undefined): { firstCents: number; currentCents: number; diffCents: number } | null {
  const oldest = [...history].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  const first = oldest ? cents(oldest.old_total) : null;
  const current = cents(currentTotal);
  if (first === null || current === null) return null;
  return { firstCents: first, currentCents: current, diffCents: current - first };
}

/** Money returned to the customer (negative, non-void rows), newest first, and the sum (positive cents). */
export function returnsToCustomer(payments: PaymentRow[]): { rows: PaymentRow[]; totalCents: number } {
  const rows = payments.filter(p => !p.voided_at && (cents(p.amount) ?? 0) < 0).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { rows, totalCents: rows.reduce((s, p) => s - (cents(p.amount) ?? 0), 0) };
}

export const money = (c: number) => `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toFixed(2)}`;
